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
            path = event.get("rawPath", "")
            for route_method, pattern_re, param_names, handler_fn in self._routes:
                if route_method != method:
                    continue
                m = pattern_re.match(path)
                if m:
                    self.current_event = type("Event", (), {
                        "json_body": json.loads(event.get("body", "{}") or "{}"),
                        "query_string_parameters": event.get("queryStringParameters") or {},
                    })()
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

        return {
            "items": [serialize_item(_ensure_project_fields(p)) for p in page_items],
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
                hypotheses_list = []
                for h in db_hypotheses:
                    h_serialized = serialize_item(h)
                    hypotheses_list.append({
                        "id": h_serialized.get("id", ""),
                        "title": h_serialized.get("statement", ""),
                        "description": h_serialized.get("rationale", ""),
                        "mechanism": h_serialized.get("mechanism", ""),
                        "confidence": h_serialized.get("confidence_score", 0.5),
                        "model_used": "AI Pipeline",
                        "validated": h_serialized.get("status") == "validated",
                        "external_factors": [],
                        "created_at": h_serialized.get("created_at", ""),
                    })
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
            "items": [serialize_item(h) for h in page_items],
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
    """Get statistics for a project."""
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
        return {
            "project_id": item["id"],
            "hypothesis_count": item.get("hypothesis_count", 0),
            "evidence_count": item.get("evidence_count", 0),
            "simulation_count": item.get("simulation_count", 0),
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
