"""
Projects Lambda Handler - CRUD operations for research projects.
Uses DynamoDB for storage.
"""

print("[PROJECTS] Module loading...")

import json
import logging
import os
import traceback
from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import uuid4

import boto3

# Defensive powertools imports — Lambda must NEVER crash on cold start
try:
    from aws_lambda_powertools import Logger, Metrics
    from aws_lambda_powertools.event_handler import APIGatewayHttpResolver, Response
    from aws_lambda_powertools.utilities.typing import LambdaContext
    logger = Logger()
    metrics = Metrics()
    print("[PROJECTS] Powertools loaded OK")
except ImportError as _import_err:
    logging.error(f"aws_lambda_powertools import failed: {_import_err}")
    logger = logging.getLogger("projects")
    logger.setLevel(logging.DEBUG)

    import re as _re_stub

    class APIGatewayHttpResolver:
        """Stub resolver when powertools is unavailable."""
        def __init__(self):
            self._routes = []
            self.current_event = None
        def _register(self, method, path, func):
            param_names = _re_stub.findall(r'<(\w+)>', path)
            pattern = _re_stub.sub(r'<\w+>', r'([^/]+)', path)
            pattern_re = _re_stub.compile(f'^{pattern}$')
            self._routes.append((method, pattern_re, param_names, func))
        def get(self, path):
            def decorator(func):
                self._register("GET", path, func)
                return func
            return decorator
        def post(self, path):
            def decorator(func):
                self._register("POST", path, func)
                return func
            return decorator
        def patch(self, path):
            def decorator(func):
                self._register("PATCH", path, func)
                return func
            return decorator
        def delete(self, path):
            def decorator(func):
                self._register("DELETE", path, func)
                return func
            return decorator
        def resolve(self, event, context):
            method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
            path = event.get("rawPath", "/").split("?")[0]
            # strip stage prefix (e.g. /dev)
            parts = path.split("/")
            if len(parts) > 1 and parts[1] not in ("api",):
                path = "/" + "/".join(parts[2:])
            self.current_event = type("Event", (), {
                "json_body": json.loads(event.get("body", "{}") or "{}"),
                "query_string_parameters": event.get("queryStringParameters") or {},
            })()
            for route_method, pattern_re, param_names, handler_fn in self._routes:
                if route_method != method:
                    continue
                m = pattern_re.match(path)
                if m:
                    kwargs = {name: m.group(i + 1) for i, name in enumerate(param_names)}
                    result = handler_fn(**kwargs)
                    if isinstance(result, dict):
                        return {"statusCode": 200, "headers": {"Content-Type": "application/json"}, "body": json.dumps(result, cls=DecimalEncoder)}
                    if isinstance(result, Response):
                        return {"statusCode": result.status_code, "headers": {"Content-Type": result.content_type}, "body": result.body}
                    return result
            return {"statusCode": 404, "headers": {"Content-Type": "application/json"}, "body": json.dumps({"detail": f"Not Found: {method} {path}"})}

    class Response:
        def __init__(self, status_code=200, body="", content_type="application/json", headers=None):
            self.status_code = status_code
            self.body = body
            self.content_type = content_type

    LambdaContext = object

    class _NoopMetrics:
        def add_metric(self, **kwargs): pass
    metrics = _NoopMetrics()

    print("[PROJECTS] Using STUB resolver (powertools unavailable)")

app = APIGatewayHttpResolver()
print(f"[PROJECTS] App initialized, type={type(app).__name__}")

# AWS Clients — defensive init
try:
    dynamodb = boto3.resource("dynamodb")
    print("[PROJECTS] DynamoDB resource initialized")
except Exception as _e:
    logger.error(f"DynamoDB init failed: {_e}")
    dynamodb = None

PROJECTS_TABLE = os.environ.get("PROJECTS_TABLE", "genup-dev-projects")
HYPOTHESES_TABLE = os.environ.get("HYPOTHESES_TABLE", "genup-dev-hypotheses")
EVIDENCE_TABLE = os.environ.get("EVIDENCE_TABLE", "genup-dev-evidence")
SIMULATIONS_TABLE = os.environ.get("SIMULATIONS_TABLE", "genup-dev-simulations")
print(f"[PROJECTS] Tables: projects={PROJECTS_TABLE} hypotheses={HYPOTHESES_TABLE}")


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o) if o % 1 else int(o)
        return super().default(o)


def serialize_item(item: dict) -> dict:
    """Convert DynamoDB Decimal types to Python native types."""
    return json.loads(json.dumps(item, cls=DecimalEncoder))


def _ensure_project_fields(item: dict) -> dict:
    """Ensure project has all fields the frontend expects."""
    item.setdefault("status", "active")
    item.setdefault("hypothesis_count", 0)
    item.setdefault("evidence_count", 0)
    item.setdefault("simulation_count", 0)
    item.setdefault("tags", [])
    return item


def _normalize_hypothesis(h: dict) -> dict:
    """Map DynamoDB hypothesis fields to frontend-expected fields."""
    return {
        "id": h.get("id", ""),
        "title": h.get("title") or h.get("statement", ""),
        "description": h.get("description") or h.get("rationale", ""),
        "mechanism": h.get("mechanism", ""),
        "confidence_score": h.get("confidence_score", h.get("confidence", 0.5)),
        "confidence": h.get("confidence_score", h.get("confidence", 0.5)),
        "novelty_score": h.get("novelty_score", 0.5),
        "feasibility_score": h.get("feasibility_score", 0.5),
        "impact_score": h.get("impact_score", 0.5),
        "round_number": h.get("round_number", h.get("version", 1)),
        "discovery_type": h.get("discovery_type", ""),
        "status": h.get("status", "generated"),
        "evidence_summary": h.get("evidence_summary", []),
        "risks": h.get("risks", []),
        "validation_steps": h.get("validation_steps", []),
        "key_citations": h.get("key_citations", []),
        "tags": h.get("tags", []),
        "project_id": h.get("project_id", ""),
        "created_at": h.get("created_at", ""),
        "updated_at": h.get("updated_at", ""),
    }


@app.get("/api/v1/projects")
def list_projects():
    """List all projects with pagination."""
    print("[LIST] Endpoint hit")
    try:
        table = dynamodb.Table(PROJECTS_TABLE)
        params = app.current_event.query_string_parameters or {}
        page = int(params.get("page", "1"))
        page_size = int(params.get("page_size", "50"))
        search = params.get("search", "")

        # Full scan to get all items
        all_items = []
        scan_kwargs = {}
        while True:
            response = table.scan(**scan_kwargs)
            all_items.extend(response.get("Items", []))
            last_key = response.get("LastEvaluatedKey")
            if not last_key:
                break
            scan_kwargs["ExclusiveStartKey"] = last_key

        print(f"[LIST] Scanned {len(all_items)} items")

        # Filter by search term if provided
        if search:
            search_lower = search.lower()
            all_items = [
                p for p in all_items
                if search_lower in (p.get("name", "") or "").lower()
                or search_lower in (p.get("description", "") or "").lower()
                or search_lower in (p.get("disease_focus", "") or "").lower()
            ]

        # Sort by updated_at descending
        all_items.sort(key=lambda x: x.get("updated_at", ""), reverse=True)

        total = len(all_items)
        total_pages = max(1, (total + page_size - 1) // page_size)

        # Paginate
        start = (page - 1) * page_size
        end = start + page_size
        page_items = all_items[start:end] if start < total else []

        # Enrich projects with live counts from related tables
        enriched_items = []
        hyp_table = dynamodb.Table(HYPOTHESES_TABLE)
        ev_table = dynamodb.Table(EVIDENCE_TABLE)
        sim_table = dynamodb.Table(SIMULATIONS_TABLE)
        for p in page_items:
            project = serialize_item(_ensure_project_fields(p))
            pid = project["id"]
            # Live hypothesis count
            try:
                try:
                    hyp_resp = hyp_table.query(
                        IndexName="project_id-created_at-index",
                        KeyConditionExpression="project_id = :pid",
                        ExpressionAttributeValues={":pid": pid},
                        Select="COUNT",
                    )
                except Exception:
                    hyp_resp = hyp_table.scan(
                        FilterExpression="project_id = :pid",
                        ExpressionAttributeValues={":pid": pid},
                        Select="COUNT",
                    )
                project["hypothesis_count"] = hyp_resp.get("Count", 0)
            except Exception:
                pass
            # Live evidence count
            try:
                ev_resp = ev_table.scan(
                    FilterExpression="project_id = :pid",
                    ExpressionAttributeValues={":pid": pid},
                    Select="COUNT",
                )
                project["evidence_count"] = ev_resp.get("Count", 0)
            except Exception:
                pass
            # Live simulation count
            try:
                sim_resp = sim_table.scan(
                    FilterExpression="project_id = :pid",
                    ExpressionAttributeValues={":pid": pid},
                    Select="COUNT",
                )
                project["simulation_count"] = sim_resp.get("Count", 0)
            except Exception:
                pass
            enriched_items.append(project)

        return {
            "items": enriched_items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        }
    except Exception as e:
        print(f"[LIST] ERROR: {e}\n{traceback.format_exc()}")
        return Response(
            status_code=500,
            content_type="application/json",
            body=json.dumps({"detail": f"Failed to list projects: {str(e)}"}),
        )


@app.post("/api/v1/projects")
def create_project():
    """Create a new project."""
    print("[CREATE] Endpoint hit")
    try:
        body = app.current_event.json_body or {}
        table = dynamodb.Table(PROJECTS_TABLE)

        now = datetime.utcnow().isoformat()
        project_id = str(uuid4())

        item = {
            "id": project_id,
            "name": body.get("name", "Untitled Project"),
            "description": body.get("description", ""),
            "disease_focus": body.get("disease_focus", ""),
            "research_question": body.get("research_question", ""),
            "tags": body.get("tags", []),
            "status": "active",
            "hypothesis_count": 0,
            "evidence_count": 0,
            "simulation_count": 0,
            "user_id": "default",
            "created_at": now,
            "updated_at": now,
        }

        print(f"[CREATE] Writing to DynamoDB: id={project_id} name={item['name']}")
        table.put_item(Item=item)
        print(f"[CREATE] Success: {project_id}")
        metrics.add_metric(name="ProjectsCreated", unit="Count", value=1)

        return serialize_item(item)
    except Exception as e:
        print(f"[CREATE] ERROR: {e}\n{traceback.format_exc()}")
        return Response(
            status_code=500,
            content_type="application/json",
            body=json.dumps({"detail": f"Failed to create project: {str(e)}"}),
        )


@app.get("/api/v1/projects/<project_id>")
def get_project(project_id: str):
    """Get a single project including its hypotheses."""
    print(f"[GET] project_id={project_id}")
    try:
        table = dynamodb.Table(PROJECTS_TABLE)
        response = table.get_item(Key={"id": project_id})
        item = response.get("Item")

        if not item:
            return Response(
                status_code=400,
                content_type="application/json",
                body=json.dumps({"detail": "Project not found", "error": "not_found"}),
            )

        project = serialize_item(_ensure_project_fields(item))

        # Fetch hypotheses linked to this project
        try:
            hyp_table = dynamodb.Table(HYPOTHESES_TABLE)
            try:
                hyp_response = hyp_table.query(
                    IndexName="project_id-created_at-index",
                    KeyConditionExpression="project_id = :pid",
                    ExpressionAttributeValues={":pid": project_id},
                    ScanIndexForward=False,
                )
            except Exception:
                # GSI might not exist, fall back to scan
                hyp_response = hyp_table.scan(
                    FilterExpression="project_id = :pid",
                    ExpressionAttributeValues={":pid": project_id},
                )
            db_hypotheses = hyp_response.get("Items", [])
            if db_hypotheses:
                hypotheses_list = [_normalize_hypothesis(serialize_item(h)) for h in db_hypotheses]
                project["hypotheses"] = hypotheses_list
                project["hypothesis_count"] = len(hypotheses_list)
        except Exception as e:
            print(f"[GET] Hypotheses fetch failed (non-fatal): {e}")

        return project
    except Exception as e:
        print(f"[GET] ERROR: {e}\n{traceback.format_exc()}")
        return Response(
            status_code=500,
            content_type="application/json",
            body=json.dumps({"detail": f"Failed to get project: {str(e)}"}),
        )


@app.get("/api/v1/projects/<project_id>/hypotheses")
def list_project_hypotheses(project_id: str):
    """List hypotheses for a specific project."""
    try:
        params = app.current_event.query_string_parameters or {}
        limit = int(params.get("limit", "100"))
        offset = int(params.get("offset", "0"))

        hyp_table = dynamodb.Table(HYPOTHESES_TABLE)
        try:
            hyp_response = hyp_table.query(
                IndexName="project_id-created_at-index",
                KeyConditionExpression="project_id = :pid",
                ExpressionAttributeValues={":pid": project_id},
                ScanIndexForward=False,
            )
        except Exception:
            hyp_response = hyp_table.scan(
                FilterExpression="project_id = :pid",
                ExpressionAttributeValues={":pid": project_id},
            )
        items = hyp_response.get("Items", [])
        total = len(items)
        page_items = items[offset:offset + limit]

        return {
            "items": [_normalize_hypothesis(serialize_item(h)) for h in page_items],
            "total": total,
        }
    except Exception as e:
        print(f"[LIST_HYPOTHESES] ERROR: {e}\n{traceback.format_exc()}")
        return Response(
            status_code=500,
            content_type="application/json",
            body=json.dumps({"detail": f"Failed to list hypotheses: {str(e)}"}),
        )


@app.get("/api/v1/projects/<project_id>/stats")
def get_project_stats(project_id: str):
    """Get statistics for a project with live counts from related tables."""
    try:
        table = dynamodb.Table(PROJECTS_TABLE)
        response = table.get_item(Key={"id": project_id})
        item = response.get("Item")

        if not item:
            return Response(
                status_code=400,
                content_type="application/json",
                body=json.dumps({"detail": "Project not found"}),
            )

        item = serialize_item(_ensure_project_fields(item))

        # Live count hypotheses from the hypotheses table
        hypothesis_count = 0
        try:
            hyp_table = dynamodb.Table(HYPOTHESES_TABLE)
            try:
                hyp_resp = hyp_table.query(
                    IndexName="project_id-created_at-index",
                    KeyConditionExpression="project_id = :pid",
                    ExpressionAttributeValues={":pid": project_id},
                    Select="COUNT",
                )
            except Exception:
                hyp_resp = hyp_table.scan(
                    FilterExpression="project_id = :pid",
                    ExpressionAttributeValues={":pid": project_id},
                    Select="COUNT",
                )
            hypothesis_count = hyp_resp.get("Count", 0)
        except Exception as e:
            print(f"[STATS] Hypothesis count failed: {e}")
            hypothesis_count = item.get("hypothesis_count", 0)

        # Live count evidence
        evidence_count = 0
        try:
            ev_table = dynamodb.Table(EVIDENCE_TABLE)
            ev_resp = ev_table.scan(
                FilterExpression="project_id = :pid",
                ExpressionAttributeValues={":pid": project_id},
                Select="COUNT",
            )
            evidence_count = ev_resp.get("Count", 0)
        except Exception as e:
            print(f"[STATS] Evidence count failed: {e}")
            evidence_count = item.get("evidence_count", 0)

        # Live count simulations
        simulation_count = 0
        try:
            sim_table = dynamodb.Table(SIMULATIONS_TABLE)
            sim_resp = sim_table.scan(
                FilterExpression="project_id = :pid",
                ExpressionAttributeValues={":pid": project_id},
                Select="COUNT",
            )
            simulation_count = sim_resp.get("Count", 0)
        except Exception as e:
            print(f"[STATS] Simulation count failed: {e}")
            simulation_count = item.get("simulation_count", 0)

        return {
            "project_id": item["id"],
            "hypothesis_count": hypothesis_count,
            "evidence_count": evidence_count,
            "simulation_count": simulation_count,
            "status": item.get("status", "active"),
            "created_at": item.get("created_at", ""),
            "updated_at": item.get("updated_at", ""),
        }
    except Exception as e:
        return Response(
            status_code=500,
            content_type="application/json",
            body=json.dumps({"detail": f"Failed to get stats: {str(e)}"}),
        )


@app.get("/api/v1/projects/<project_id>/discovery-runs")
def list_discovery_runs(project_id: str):
    """List discovery runs for a project from the hypotheses table (discovery metadata)."""
    try:
        params = app.current_event.query_string_parameters or {}
        limit = int(params.get("limit", "50"))

        # Query hypotheses for this project to build discovery run summaries
        hyp_table = dynamodb.Table(HYPOTHESES_TABLE)
        try:
            hyp_resp = hyp_table.query(
                IndexName="project_id-created_at-index",
                KeyConditionExpression="project_id = :pid",
                ExpressionAttributeValues={":pid": project_id},
                ScanIndexForward=False,
            )
        except Exception:
            hyp_resp = hyp_table.scan(
                FilterExpression="project_id = :pid",
                ExpressionAttributeValues={":pid": project_id},
            )

        hypotheses = hyp_resp.get("Items", [])

        # Group hypotheses by run_id if available, otherwise return empty
        runs_map = {}
        for h in hypotheses:
            h = serialize_item(h)
            run_id = h.get("run_id") or h.get("discovery_run_id")
            if not run_id:
                continue
            if run_id not in runs_map:
                runs_map[run_id] = {
                    "id": run_id,
                    "status": "completed",
                    "disease": h.get("disease", ""),
                    "discovery_type": h.get("discovery_type", "treatment"),
                    "num_rounds": 1,
                    "best_hypothesis_id": None,
                    "total_cost_cents": 0,
                    "total_duration_seconds": None,
                    "created_at": h.get("created_at", ""),
                    "hypothesis_count": 0,
                }
            run = runs_map[run_id]
            run["hypothesis_count"] += 1
            conf = float(h.get("confidence_score", 0))
            if run["best_hypothesis_id"] is None or conf > float(runs_map[run_id].get("_best_conf", 0)):
                run["best_hypothesis_id"] = h.get("id")
                run["_best_conf"] = conf

        # Clean up internal fields and apply limit
        runs = list(runs_map.values())[:limit]
        for r in runs:
            r.pop("_best_conf", None)

        return {"items": runs, "total": len(runs)}
    except Exception as e:
        print(f"[DISCOVERY_RUNS] ERROR: {e}\n{traceback.format_exc()}")
        return {"items": [], "total": 0}


@app.get("/api/v1/projects/<project_id>/synthesis-runs")
def list_synthesis_runs(project_id: str):
    """List synthesis runs for a project (stub - returns empty for now)."""
    return {"items": [], "total": 0}


@app.patch("/api/v1/projects/<project_id>")
def update_project(project_id: str):
    """Update a project."""
    try:
        body = app.current_event.json_body or {}
        table = dynamodb.Table(PROJECTS_TABLE)

        update_parts = []
        expr_names = {}
        expr_values = {":updated_at": datetime.utcnow().isoformat()}
        update_parts.append("#updated_at = :updated_at")
        expr_names["#updated_at"] = "updated_at"

        for field in ["name", "description", "disease_focus", "research_question", "tags", "status"]:
            if field in body:
                update_parts.append(f"#{field} = :{field}")
                expr_names[f"#{field}"] = field
                expr_values[f":{field}"] = body[field]

        response = table.update_item(
            Key={"id": project_id},
            UpdateExpression="SET " + ", ".join(update_parts),
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values,
            ReturnValues="ALL_NEW",
        )

        return serialize_item(_ensure_project_fields(response.get("Attributes", {})))
    except Exception as e:
        return Response(
            status_code=500,
            content_type="application/json",
            body=json.dumps({"detail": f"Failed to update project: {str(e)}"}),
        )


@app.delete("/api/v1/projects/<project_id>")
def delete_project(project_id: str):
    """Delete a project."""
    try:
        table = dynamodb.Table(PROJECTS_TABLE)
        table.delete_item(Key={"id": project_id})
        return {"message": "Project deleted"}
    except Exception as e:
        return Response(
            status_code=500,
            content_type="application/json",
            body=json.dumps({"detail": f"Failed to delete project: {str(e)}"}),
        )


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Lambda handler entry point — catches ALL errors to prevent 500 with no body."""
    print(f"[HANDLER] method={event.get('requestContext', {}).get('http', {}).get('method', '?')} path={event.get('rawPath', '?')}")
    try:
        return app.resolve(event, context)
    except Exception as e:
        print(f"[HANDLER] UNHANDLED ERROR: {e}\n{traceback.format_exc()}")
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "detail": f"Internal server error: {str(e)}",
                "traceback": traceback.format_exc(),
            }),
        }
