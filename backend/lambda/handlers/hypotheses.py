"""
Hypotheses Lambda Handler - CRUD operations for hypotheses.
Uses DynamoDB for storage.
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
HYPOTHESES_TABLE = os.environ.get("HYPOTHESES_TABLE", "genup-dev-hypotheses")


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o) if o % 1 else int(o)
        return super().default(o)


def serialize_item(item: dict) -> dict:
    return json.loads(json.dumps(item, cls=DecimalEncoder))


@app.get("/api/v1/hypotheses")
@tracer.capture_method
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
@tracer.capture_method
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
@tracer.capture_method
def get_hypothesis(hypothesis_id: str):
    """Get a single hypothesis."""
    table = dynamodb.Table(HYPOTHESES_TABLE)
    response = table.get_item(Key={"id": hypothesis_id})
    item = response.get("Item")

    if not item:
        return {"error": "Hypothesis not found"}, 404

    return serialize_item(item)


@app.patch("/api/v1/hypotheses/<hypothesis_id>")
@tracer.capture_method
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
            update_parts.append(f"#{field} = :{field}")
            expr_names[f"#{field}"] = field
            expr_values[f":{field}"] = Decimal(str(body[field]))

    response = table.update_item(
        Key={"id": hypothesis_id},
        UpdateExpression="SET " + ", ".join(update_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
        ReturnValues="ALL_NEW",
    )

    return serialize_item(response.get("Attributes", {}))


@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics(capture_cold_start_metric=True)
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """Lambda handler entry point."""
    return app.resolve(event, context)
