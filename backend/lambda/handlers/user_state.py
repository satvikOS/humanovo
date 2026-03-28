"""
User State Lambda Handler - Sync user state (localStorage) across devices.
Uses DynamoDB for storage with last-write-wins conflict resolution.
"""

print("[USER_STATE] Module loading...")

import json
import logging
import math
import os
import traceback
from datetime import datetime
from decimal import Decimal
from typing import Any

import boto3

# Defensive powertools imports — Lambda must NEVER crash on cold start
try:
    from aws_lambda_powertools import Logger, Metrics
    from aws_lambda_powertools.event_handler import APIGatewayHttpResolver, Response
    from aws_lambda_powertools.utilities.typing import LambdaContext
    logger = Logger()
    metrics = Metrics()
    print("[USER_STATE] Powertools loaded OK")
except ImportError as _import_err:
    logging.error(f"aws_lambda_powertools import failed: {_import_err}")
    logger = logging.getLogger("user_state")
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
        def put(self, path):
            def decorator(func):
                self._register("PUT", path, func)
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

    print("[USER_STATE] Using STUB resolver (powertools unavailable)")

app = APIGatewayHttpResolver()

dynamodb = boto3.resource("dynamodb")
USER_STATE_TABLE = os.environ.get("USER_STATE_TABLE", "genup-dev-user-state")

# Valid state keys that can be synced
VALID_KEYS = {
    "experiments",
    "mc-simulations",
    "eq-history",
    "comp-history",
    "activity-log",
    "notebook-index",
    "workspace-tabs",
    "workspace-active-tab",
}


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            f = float(o)
            if not math.isfinite(f):
                return 0.0
            return f if o % 1 else int(o)
        return super().default(o)


def serialize_item(item: dict) -> dict:
    return json.loads(json.dumps(item, cls=DecimalEncoder))


@app.get("/api/v1/user-state")
def list_state_keys():
    """List all stored state keys with their updated_at timestamps."""
    table = dynamodb.Table(USER_STATE_TABLE)
    response = table.scan(
        ProjectionExpression="#k, updated_at",
        ExpressionAttributeNames={"#k": "key"},
    )
    items = response.get("Items", [])

    return {
        "items": [
            {"key": item["key"], "updated_at": item.get("updated_at", "")}
            for item in items
        ],
    }


@app.get("/api/v1/user-state/<key>")
def get_state(key: str):
    """Get a state value by key."""
    table = dynamodb.Table(USER_STATE_TABLE)
    response = table.get_item(Key={"key": key})
    item = response.get("Item")

    if not item:
        return Response(
            status_code=404,
            body=json.dumps({"detail": f"State key not found: {key}"}),
            content_type="application/json",
        )

    result = {
        "key": item["key"],
        "value": json.loads(item["value"]) if isinstance(item.get("value"), str) else item.get("value"),
        "updated_at": item.get("updated_at", ""),
    }
    return serialize_item(result)


@app.put("/api/v1/user-state/<key>")
def put_state(key: str):
    """Set a state value by key. Body: { value: any }."""
    body = app.current_event.json_body or {}

    if "value" not in body:
        return Response(
            status_code=400,
            body=json.dumps({"detail": "Request body must include 'value' field"}),
            content_type="application/json",
        )

    now = datetime.utcnow().isoformat()
    value_json = json.dumps(body["value"])

    table = dynamodb.Table(USER_STATE_TABLE)
    item = {
        "key": key,
        "value": value_json,
        "updated_at": now,
    }
    table.put_item(Item=item)

    metrics.add_metric(name="UserStatePut", unit="Count", value=1)

    return {
        "key": key,
        "value": body["value"],
        "updated_at": now,
    }


@app.delete("/api/v1/user-state/<key>")
def delete_state(key: str):
    """Delete a state key."""
    table = dynamodb.Table(USER_STATE_TABLE)

    # Check existence first
    response = table.get_item(Key={"key": key})
    if not response.get("Item"):
        return Response(
            status_code=404,
            body=json.dumps({"detail": f"State key not found: {key}"}),
            content_type="application/json",
        )

    table.delete_item(Key={"key": key})
    metrics.add_metric(name="UserStateDelete", unit="Count", value=1)

    return {"detail": f"State key '{key}' deleted"}


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Lambda handler entry point — catches ALL errors to prevent 500 with no body."""
    print(f"[USER_STATE] method={event.get('requestContext', {}).get('http', {}).get('method', '?')} path={event.get('rawPath', '?')}")
    try:
        return app.resolve(event, context)
    except Exception as e:
        print(f"[USER_STATE] UNHANDLED ERROR: {e}\n{traceback.format_exc()}")
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "detail": f"Internal server error: {str(e)}",
                "traceback": traceback.format_exc(),
            }),
        }
