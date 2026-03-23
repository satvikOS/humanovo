"""
Simulation Lambda Handler - Monte Carlo simulation management.
"""

import json
import logging
import os
import traceback
from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import uuid4

import boto3

try:
    from aws_lambda_powertools import Logger, Metrics
    from aws_lambda_powertools.event_handler import APIGatewayHttpResolver, Response
    from aws_lambda_powertools.utilities.typing import LambdaContext
    logger = Logger()
    metrics = Metrics()
except ImportError as _import_err:
    logging.error(f"aws_lambda_powertools import failed: {_import_err}")
    logger = logging.getLogger("simulation")
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
            import json as _json
            http = event.get("requestContext", {}).get("http", {})
            method = http.get("method", "GET")
            path = event.get("rawPath", "/").split("?")[0]
            # strip stage prefix
            parts = path.split("/")
            if len(parts) > 1 and parts[1] not in ("api",):
                path = "/" + "/".join(parts[2:])
            class _Evt:
                def __init__(self, ev):
                    self.raw_event = ev
                    self.query_string_parameters = ev.get("queryStringParameters") or {}
                    try:
                        self.json_body = _json.loads(ev.get("body", "{}") or "{}")
                    except Exception:
                        self.json_body = {}
                @property
                def body(self):
                    return self.raw_event.get("body", "")
            self.current_event = _Evt(event)
            for m, pat, params, func in self._routes:
                if m != method:
                    continue
                match = pat.match(path)
                if match:
                    args = match.groups()
                    kwargs = dict(zip(params, args))
                    result = func(**kwargs)
                    if isinstance(result, dict) or isinstance(result, list):
                        return {"statusCode": 200, "headers": {"Content-Type": "application/json"}, "body": _json.dumps(result, default=str)}
                    if hasattr(result, "status_code"):
                        return {"statusCode": result.status_code, "headers": {"Content-Type": getattr(result, "content_type", "application/json")}, "body": result.body if isinstance(result.body, str) else _json.dumps(result.body, default=str)}
                    return {"statusCode": 200, "headers": {"Content-Type": "application/json"}, "body": _json.dumps(result, default=str)}
            return {"statusCode": 404, "headers": {"Content-Type": "application/json"}, "body": _json.dumps({"detail": f"Not found: {method} {path}"})}

    class Response:
        def __init__(self, status_code=200, body="", content_type="application/json", headers=None):
            self.status_code = status_code
            self.body = body
            self.content_type = content_type

    LambdaContext = object

    class _NoopMetrics:
        def add_metric(self, **kwargs): pass
        def log_metrics(self, **kwargs):
            def decorator(func): return func
            return decorator
    metrics = _NoopMetrics()

app = APIGatewayHttpResolver()

dynamodb = boto3.resource("dynamodb")
SIMULATIONS_TABLE = os.environ.get("SIMULATIONS_TABLE", "genup-dev-simulations")


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o) if o % 1 else int(o)
        return super().default(o)


def serialize_item(item: dict) -> dict:
    return json.loads(json.dumps(item, cls=DecimalEncoder))


@app.get("/api/v1/simulations")
def list_simulations():
    """List simulations."""
    table = dynamodb.Table(SIMULATIONS_TABLE)
    params = app.current_event.query_string_parameters or {}
    page = int(params.get("page", "1"))
    page_size = int(params.get("page_size", "50"))

    response = table.scan(Limit=page_size * 2)
    items = response.get("Items", [])

    start = (page - 1) * page_size
    end = start + page_size
    page_items = items[start:end] if start < len(items) else []

    return {
        "items": [serialize_item(s) for s in page_items],
        "total": len(items),
        "page": page,
        "page_size": page_size,
    }


@app.post("/api/v1/simulations")
def create_simulation():
    """Create a new simulation."""
    body = app.current_event.json_body or {}
    table = dynamodb.Table(SIMULATIONS_TABLE)

    now = datetime.utcnow().isoformat()
    sim_id = str(uuid4())

    item = {
        "id": sim_id,
        "project_id": body.get("project_id", ""),
        "hypothesis_id": body.get("hypothesis_id", ""),
        "name": body.get("name", "Untitled Simulation"),
        "description": body.get("description", ""),
        "simulation_type": body.get("simulation_type", "monte_carlo"),
        "status": "queued",
        "iterations": body.get("iterations", 1000),
        "iterations_completed": 0,
        "parameters": body.get("parameters", []),
        "outcomes": [],
        "created_at": now,
    }

    table.put_item(Item=item)

    return {"id": sim_id, "status": "queued", "message": "Simulation queued"}


@app.get("/api/v1/simulations/<simulation_id>")
def get_simulation(simulation_id: str):
    """Get a simulation."""
    table = dynamodb.Table(SIMULATIONS_TABLE)
    response = table.get_item(Key={"id": simulation_id})
    item = response.get("Item")

    if not item:
        return {"error": "Simulation not found"}, 404

    return serialize_item(item)


@app.post("/api/v1/simulations/<simulation_id>/cancel")
def cancel_simulation(simulation_id: str):
    """Cancel a simulation."""
    table = dynamodb.Table(SIMULATIONS_TABLE)
    table.update_item(
        Key={"id": simulation_id},
        UpdateExpression="SET #status = :status",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={":status": "cancelled"},
    )
    return {"id": simulation_id, "status": "cancelled"}


def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """Lambda handler entry point."""
    try:
        return app.resolve(event, context)
    except Exception as e:
        import json, traceback
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"detail": f"Internal error: {str(e)}", "traceback": traceback.format_exc()}),
        }
