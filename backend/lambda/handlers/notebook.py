"""
Notebook Lambda Handler - CRUD operations for notebook pages.
Uses DynamoDB for storage.
"""

print("[NOTEBOOK] Module loading...")

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
    print("[NOTEBOOK] Powertools loaded OK")
except ImportError as _import_err:
    logging.error(f"aws_lambda_powertools import failed: {_import_err}")
    logger = logging.getLogger("notebook")
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

    print("[NOTEBOOK] Using STUB resolver (powertools unavailable)")

app = APIGatewayHttpResolver()
print(f"[NOTEBOOK] App initialized, type={type(app).__name__}")

# AWS Clients — defensive init
try:
    dynamodb = boto3.resource("dynamodb")
    print("[NOTEBOOK] DynamoDB resource initialized")
except Exception as _e:
    logger.error(f"DynamoDB init failed: {_e}")
    dynamodb = None

NOTEBOOK_TABLE = os.environ.get("NOTEBOOK_TABLE", "genup-dev-notebook")
print(f"[NOTEBOOK] Tables: notebook={NOTEBOOK_TABLE}")


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o) if o % 1 else int(o)
        return super().default(o)


def serialize_item(item: dict) -> dict:
    """Convert DynamoDB Decimal types to Python native types."""
    return json.loads(json.dumps(item, cls=DecimalEncoder))


def _ensure_page_fields(item: dict) -> dict:
    """Ensure page has all fields the frontend expects."""
    item.setdefault("content_type", "markdown")
    item.setdefault("tags", [])
    item.setdefault("version", 1)
    item.setdefault("versions", [])
    item.setdefault("user_id", "default")
    return item


@app.get("/api/v1/notebook/pages")
def list_pages():
    """List all notebook pages with pagination."""
    print("[LIST] Endpoint hit")
    try:
        table = dynamodb.Table(NOTEBOOK_TABLE)
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
                if search_lower in (p.get("title", "") or "").lower()
                or search_lower in (p.get("content", "") or "").lower()
                or any(search_lower in (t or "").lower() for t in p.get("tags", []))
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
            "items": [serialize_item(_ensure_page_fields(p)) for p in page_items],
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
            body=json.dumps({"detail": f"Failed to list pages: {str(e)}"}),
        )


@app.get("/api/v1/notebook/pages/<page_id>")
def get_page(page_id: str):
    """Get a single notebook page."""
    print(f"[GET] page_id={page_id}")
    try:
        table = dynamodb.Table(NOTEBOOK_TABLE)
        response = table.get_item(Key={"id": page_id})
        item = response.get("Item")

        if not item:
            return Response(
                status_code=400,
                content_type="application/json",
                body=json.dumps({"detail": "Page not found", "error": "not_found"}),
            )

        return serialize_item(_ensure_page_fields(item))
    except Exception as e:
        print(f"[GET] ERROR: {e}\n{traceback.format_exc()}")
        return Response(
            status_code=500,
            content_type="application/json",
            body=json.dumps({"detail": f"Failed to get page: {str(e)}"}),
        )


@app.post("/api/v1/notebook/pages")
def create_page():
    """Create a new notebook page."""
    print("[CREATE] Endpoint hit")
    try:
        body = app.current_event.json_body or {}
        table = dynamodb.Table(NOTEBOOK_TABLE)

        now = datetime.utcnow().isoformat()
        page_id = str(uuid4())

        item = {
            "id": page_id,
            "title": body.get("title", "Untitled Page"),
            "content": body.get("content", ""),
            "content_type": body.get("content_type", "markdown"),
            "tags": body.get("tags", []),
            "version": 1,
            "versions": [],
            "user_id": body.get("user_id", "default"),
            "created_at": now,
            "updated_at": now,
        }

        print(f"[CREATE] Writing to DynamoDB: id={page_id} title={item['title']}")
        table.put_item(Item=item)
        print(f"[CREATE] Success: {page_id}")
        metrics.add_metric(name="NotebookPagesCreated", unit="Count", value=1)

        return serialize_item(item)
    except Exception as e:
        print(f"[CREATE] ERROR: {e}\n{traceback.format_exc()}")
        return Response(
            status_code=500,
            content_type="application/json",
            body=json.dumps({"detail": f"Failed to create page: {str(e)}"}),
        )


@app.patch("/api/v1/notebook/pages/<page_id>")
def update_page(page_id: str):
    """Update a notebook page with version history."""
    print(f"[UPDATE] page_id={page_id}")
    try:
        body = app.current_event.json_body or {}
        table = dynamodb.Table(NOTEBOOK_TABLE)

        # Fetch current item to build version history
        response = table.get_item(Key={"id": page_id})
        existing = response.get("Item")

        if not existing:
            return Response(
                status_code=400,
                content_type="application/json",
                body=json.dumps({"detail": "Page not found", "error": "not_found"}),
            )

        now = datetime.utcnow().isoformat()
        current_version = int(existing.get("version", 1))
        new_version = current_version + 1

        # Save current state as a version history entry
        versions = existing.get("versions", []) or []
        version_entry = {
            "version": current_version,
            "content": existing.get("content", ""),
            "title": existing.get("title", ""),
            "created_at": existing.get("updated_at", existing.get("created_at", now)),
        }
        versions.append(version_entry)

        update_parts = []
        expr_names = {}
        expr_values = {
            ":updated_at": now,
            ":version": new_version,
            ":versions": versions,
        }
        update_parts.append("#updated_at = :updated_at")
        expr_names["#updated_at"] = "updated_at"
        update_parts.append("#version = :version")
        expr_names["#version"] = "version"
        update_parts.append("#versions = :versions")
        expr_names["#versions"] = "versions"

        for field in ["title", "content", "content_type", "tags"]:
            if field in body:
                update_parts.append(f"#{field} = :{field}")
                expr_names[f"#{field}"] = field
                expr_values[f":{field}"] = body[field]

        response = table.update_item(
            Key={"id": page_id},
            UpdateExpression="SET " + ", ".join(update_parts),
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values,
            ReturnValues="ALL_NEW",
        )

        print(f"[UPDATE] Success: {page_id} v{new_version}")
        return serialize_item(_ensure_page_fields(response.get("Attributes", {})))
    except Exception as e:
        print(f"[UPDATE] ERROR: {e}\n{traceback.format_exc()}")
        return Response(
            status_code=500,
            content_type="application/json",
            body=json.dumps({"detail": f"Failed to update page: {str(e)}"}),
        )


@app.delete("/api/v1/notebook/pages/<page_id>")
def delete_page(page_id: str):
    """Delete a notebook page."""
    print(f"[DELETE] page_id={page_id}")
    try:
        table = dynamodb.Table(NOTEBOOK_TABLE)
        table.delete_item(Key={"id": page_id})
        return {"message": "Page deleted"}
    except Exception as e:
        print(f"[DELETE] ERROR: {e}\n{traceback.format_exc()}")
        return Response(
            status_code=500,
            content_type="application/json",
            body=json.dumps({"detail": f"Failed to delete page: {str(e)}"}),
        )


@app.get("/api/v1/notebook/pages/<page_id>/versions")
def get_page_versions(page_id: str):
    """Get version history for a notebook page."""
    print(f"[VERSIONS] page_id={page_id}")
    try:
        table = dynamodb.Table(NOTEBOOK_TABLE)
        response = table.get_item(Key={"id": page_id})
        item = response.get("Item")

        if not item:
            return Response(
                status_code=400,
                content_type="application/json",
                body=json.dumps({"detail": "Page not found", "error": "not_found"}),
            )

        versions = item.get("versions", []) or []

        # Add current version to the list
        current_version = {
            "version": int(item.get("version", 1)),
            "content": item.get("content", ""),
            "title": item.get("title", ""),
            "created_at": item.get("updated_at", item.get("created_at", "")),
        }
        all_versions = versions + [current_version]

        return {
            "page_id": page_id,
            "current_version": int(item.get("version", 1)),
            "versions": [serialize_item(v) for v in all_versions],
        }
    except Exception as e:
        print(f"[VERSIONS] ERROR: {e}\n{traceback.format_exc()}")
        return Response(
            status_code=500,
            content_type="application/json",
            body=json.dumps({"detail": f"Failed to get versions: {str(e)}"}),
        )


@app.get("/api/v1/notebook/pages/<page_id>/export")
def export_page(page_id: str):
    """Export a notebook page in markdown format."""
    print(f"[EXPORT] page_id={page_id}")
    try:
        table = dynamodb.Table(NOTEBOOK_TABLE)
        response = table.get_item(Key={"id": page_id})
        item = response.get("Item")

        if not item:
            return Response(
                status_code=400,
                content_type="application/json",
                body=json.dumps({"detail": "Page not found", "error": "not_found"}),
            )

        title = item.get("title", "Untitled")
        content = item.get("content", "")
        tags = item.get("tags", [])
        created_at = item.get("created_at", "")
        updated_at = item.get("updated_at", "")

        # Build markdown export
        lines = [
            f"# {title}",
            "",
        ]
        if tags:
            lines.append(f"**Tags:** {', '.join(tags)}")
            lines.append("")
        lines.append(f"**Created:** {created_at}")
        lines.append(f"**Updated:** {updated_at}")
        lines.append("")
        lines.append("---")
        lines.append("")
        lines.append(content)

        markdown = "\n".join(lines)

        return Response(
            status_code=200,
            content_type="text/markdown",
            body=markdown,
        )
    except Exception as e:
        print(f"[EXPORT] ERROR: {e}\n{traceback.format_exc()}")
        return Response(
            status_code=500,
            content_type="application/json",
            body=json.dumps({"detail": f"Failed to export page: {str(e)}"}),
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
