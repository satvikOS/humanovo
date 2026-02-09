"""
Evidence Lambda Handler - Evidence search and management.
"""

import json
import os
from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import uuid4

import boto3
from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.event_handler import APIGatewayHttpResolver
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger()
tracer = Tracer()
metrics = Metrics()

app = APIGatewayHttpResolver()

dynamodb = boto3.resource("dynamodb")
EVIDENCE_TABLE = os.environ.get("EVIDENCE_TABLE", "genup-dev-evidence")


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o) if o % 1 else int(o)
        return super().default(o)


def serialize_item(item: dict) -> dict:
    return json.loads(json.dumps(item, cls=DecimalEncoder))


@app.get("/api/v1/evidence")
@tracer.capture_method
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
@tracer.capture_method
def get_evidence(evidence_id: str):
    """Get a single evidence item."""
    table = dynamodb.Table(EVIDENCE_TABLE)
    response = table.get_item(Key={"id": evidence_id})
    item = response.get("Item")

    if not item:
        return {"error": "Evidence not found"}, 404

    return serialize_item(item)


@app.post("/api/v1/evidence/search")
@tracer.capture_method
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


@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics(capture_cold_start_metric=True)
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """Lambda handler entry point."""
    return app.resolve(event, context)
