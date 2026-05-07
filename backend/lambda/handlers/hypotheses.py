"""
Hypotheses Lambda Handler - CRUD operations for hypotheses.
Uses DynamoDB for storage.
"""

# ruff: noqa: E402
# Lambda handlers print cold-start markers before imports so a
# subsequent import crash is tagged in CloudWatch with the handler
# name. The pattern is intentional; suppress E402 module-wide.
print("[HYPOTHESES] Module loading...")

import json
import logging
import math
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
    print("[HYPOTHESES] Powertools loaded OK")
except ImportError as _import_err:
    logging.error(f"aws_lambda_powertools import failed: {_import_err}")
    logger = logging.getLogger("hypotheses")
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

    print("[HYPOTHESES] Using STUB resolver (powertools unavailable)")

app = APIGatewayHttpResolver()

dynamodb = boto3.resource("dynamodb")
HYPOTHESES_TABLE = os.environ.get("HYPOTHESES_TABLE", "genup-dev-hypotheses")


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            f = float(o)
            # Guard against NaN/Infinity from corrupted data
            if not math.isfinite(f):
                return 0.0
            return f if o % 1 else int(o)
        return super().default(o)


def serialize_item(item: dict) -> dict:
    return json.loads(json.dumps(item, cls=DecimalEncoder))


@app.get("/api/v1/hypotheses")
def list_hypotheses():
    """List hypotheses with optional filtering."""
    table = dynamodb.Table(HYPOTHESES_TABLE)
    params = app.current_event.query_string_parameters or {}
    page = int(params.get("page", "1"))
    page_size = int(params.get("page_size", "50"))
    project_id = params.get("project_id")
    status_filter = params.get("status")

    if project_id:
        response = table.query(
            IndexName="project_id-created_at-index",
            KeyConditionExpression="project_id = :pid",
            ExpressionAttributeValues={":pid": project_id},
            ScanIndexForward=False,
        )
    else:
        response = table.scan(Limit=page_size * 2)

    items = response.get("Items", [])

    if status_filter:
        items = [i for i in items if i.get("status") == status_filter]

    start = (page - 1) * page_size
    end = start + page_size
    page_items = items[start:end] if start < len(items) else []

    return {
        "items": [serialize_item(h) for h in page_items],
        "total": len(items),
        "page": page,
        "page_size": page_size,
    }


@app.post("/api/v1/hypotheses")
def create_hypothesis():
    """Create a new hypothesis."""
    body = app.current_event.json_body or {}
    table = dynamodb.Table(HYPOTHESES_TABLE)

    now = datetime.utcnow().isoformat()
    hypothesis_id = str(uuid4())

    item = {
        "id": hypothesis_id,
        "project_id": body.get("project_id", ""),
        "statement": body.get("statement", ""),
        "mechanism": body.get("mechanism", ""),
        "rationale": body.get("rationale", ""),
        "status": "draft",
        "confidence_score": Decimal(str(body.get("confidence_score", 0.5))),
        "novelty_score": Decimal(str(body.get("novelty_score", 0.5))),
        "evidence_refs": body.get("evidence_refs", []),
        "contradiction_count": 0,
        "supporting_count": 0,
        "tags": body.get("tags", []),
        "version": 1,
        "created_at": now,
        "updated_at": now,
    }

    table.put_item(Item=item)
    metrics.add_metric(name="HypothesesCreated", unit="Count", value=1)

    return serialize_item(item)


@app.get("/api/v1/hypotheses/<hypothesis_id>")
def get_hypothesis(hypothesis_id: str):
    """Get a single hypothesis."""
    table = dynamodb.Table(HYPOTHESES_TABLE)
    response = table.get_item(Key={"id": hypothesis_id})
    item = response.get("Item")

    if not item:
        return {"error": "Hypothesis not found"}, 404

    return serialize_item(item)


@app.patch("/api/v1/hypotheses/<hypothesis_id>")
def update_hypothesis(hypothesis_id: str):
    """Update a hypothesis."""
    body = app.current_event.json_body or {}
    table = dynamodb.Table(HYPOTHESES_TABLE)

    update_parts = []
    expr_names = {}
    expr_values = {":updated_at": datetime.utcnow().isoformat()}
    update_parts.append("#updated_at = :updated_at")
    expr_names["#updated_at"] = "updated_at"

    for field in ["statement", "mechanism", "rationale", "status", "tags", "user_notes"]:
        if field in body:
            update_parts.append(f"#{field} = :{field}")
            expr_names[f"#{field}"] = field
            expr_values[f":{field}"] = body[field]

    for field in ["confidence_score", "novelty_score"]:
        if field in body:
            val = body[field]
            # Guard against NaN/Infinity values
            if val is None or (isinstance(val, float) and not math.isfinite(val)):
                val = 0.0
            update_parts.append(f"#{field} = :{field}")
            expr_names[f"#{field}"] = field
            expr_values[f":{field}"] = Decimal(str(val))

    response = table.update_item(
        Key={"id": hypothesis_id},
        UpdateExpression="SET " + ", ".join(update_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
        ReturnValues="ALL_NEW",
    )

    return serialize_item(response.get("Attributes", {}))


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Lambda handler entry point — catches ALL errors to prevent 500 with no body."""
    print(f"[HYPOTHESES] method={event.get('requestContext', {}).get('http', {}).get('method', '?')} path={event.get('rawPath', '?')}")
    try:
        return app.resolve(event, context)
    except Exception as e:
        print(f"[HYPOTHESES] UNHANDLED ERROR: {e}\n{traceback.format_exc()}")
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "detail": f"Internal server error: {str(e)}",
                "traceback": traceback.format_exc(),
            }),
        }
