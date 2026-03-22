"""
API Core Lambda Handler - Health check and status endpoints.
"""

import json
import logging
import os
import traceback
from datetime import datetime
from typing import Any

import boto3

try:
    from aws_lambda_powertools import Logger, Metrics
    from aws_lambda_powertools.event_handler import APIGatewayHttpResolver, Response
    from aws_lambda_powertools.utilities.typing import LambdaContext
    logger = Logger()
    metrics = Metrics()
except ImportError as _import_err:
    logging.error(f"aws_lambda_powertools import failed: {_import_err}")
    logger = logging.getLogger("api_core")
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

ENVIRONMENT = os.environ.get("ENVIRONMENT", "dev")


@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "environment": ENVIRONMENT,
        "service": "humanovo",
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.get("/api/v1/health")
def api_health_check():
    """API health check endpoint."""
    return {
        "status": "healthy",
        "environment": ENVIRONMENT,
        "service": "humanovo",
        "timestamp": datetime.utcnow().isoformat(),
    }


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
