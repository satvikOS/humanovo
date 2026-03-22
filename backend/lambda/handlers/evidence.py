"""
Evidence Lambda Handler - Evidence search and management.
"""

print("[EVIDENCE] Module loading...")

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
    print("[EVIDENCE] Powertools loaded OK")
except ImportError as _import_err:
    logging.error(f"aws_lambda_powertools import failed: {_import_err}")
    logger = logging.getLogger("evidence")
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

    print("[EVIDENCE] Using STUB resolver (powertools unavailable)")

app = APIGatewayHttpResolver()
print(f"[EVIDENCE] App initialized, type={type(app).__name__}")

# AWS Clients — defensive init
try:
    dynamodb = boto3.resource("dynamodb")
    print("[EVIDENCE] DynamoDB resource initialized")
except Exception as _e:
    logger.error(f"DynamoDB init failed: {_e}")
    dynamodb = None

EVIDENCE_TABLE = os.environ.get("EVIDENCE_TABLE", "genup-dev-evidence")
print(f"[EVIDENCE] Table: evidence={EVIDENCE_TABLE}")


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o) if o % 1 else int(o)
        return super().default(o)


def serialize_item(item: dict) -> dict:
    return json.loads(json.dumps(item, cls=DecimalEncoder))


@app.get("/api/v1/evidence")
def list_evidence():
    """List evidence items."""
    table = dynamodb.Table(EVIDENCE_TABLE)
    params = app.current_event.query_string_parameters or {}
    page = int(params.get("page", "1"))
    page_size = int(params.get("page_size", "50"))

    response = table.scan(Limit=page_size * 2)
    items = response.get("Items", [])

    start = (page - 1) * page_size
    end = start + page_size
    page_items = items[start:end] if start < len(items) else []

    return {
        "items": [serialize_item(e) for e in page_items],
        "total": len(items),
    }


@app.get("/api/v1/evidence/<evidence_id>")
def get_evidence(evidence_id: str):
    """Get a single evidence item."""
    table = dynamodb.Table(EVIDENCE_TABLE)
    response = table.get_item(Key={"id": evidence_id})
    item = response.get("Item")

    if not item:
        return {"error": "Evidence not found"}, 404

    return serialize_item(item)


@app.post("/api/v1/evidence/search")
def search_evidence():
    """Search evidence."""
    body = app.current_event.json_body or {}
    query = body.get("query", "")

    table = dynamodb.Table(EVIDENCE_TABLE)
    response = table.scan(Limit=50)
    items = response.get("Items", [])

    # Basic keyword search
    if query:
        query_lower = query.lower()
        items = [
            i for i in items
            if query_lower in i.get("title", "").lower()
            or query_lower in i.get("content", "").lower()
            or query_lower in i.get("abstract", "").lower()
        ]

    return {
        "items": [serialize_item(e) for e in items[:20]],
        "total": len(items),
    }


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Lambda handler entry point — catches ALL errors to prevent 500 with no body."""
    print(f"[EVIDENCE HANDLER] method={event.get('requestContext', {}).get('http', {}).get('method', '?')} path={event.get('rawPath', '?')}")
    try:
        return app.resolve(event, context)
    except Exception as e:
        print(f"[EVIDENCE HANDLER] UNHANDLED ERROR: {e}\n{traceback.format_exc()}")
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "detail": f"Internal server error: {str(e)}",
                "traceback": traceback.format_exc(),
            }),
        }
