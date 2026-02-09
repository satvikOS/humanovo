"""
Projects Lambda Handler - CRUD operations for research projects.
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
PROJECTS_TABLE = os.environ.get("PROJECTS_TABLE", "genup-dev-projects")
HYPOTHESES_TABLE = os.environ.get("HYPOTHESES_TABLE", "genup-dev-hypotheses")
EVIDENCE_TABLE = os.environ.get("EVIDENCE_TABLE", "genup-dev-evidence")


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o) if o % 1 else int(o)
        return super().default(o)


def serialize_item(item: dict) -> dict:
    """Convert DynamoDB Decimal types to Python native types."""
    return json.loads(json.dumps(item, cls=DecimalEncoder))


@app.get("/api/v1/projects")
@tracer.capture_method
def list_projects():
    """List all projects."""
    table = dynamodb.Table(PROJECTS_TABLE)
    params = app.current_event.query_string_parameters or {}
    page = int(params.get("page", "1"))
    page_size = int(params.get("page_size", "50"))

    response = table.scan(Limit=page_size * page)
    items = response.get("Items", [])

    # Paginate
    start = (page - 1) * page_size
    end = start + page_size
    page_items = items[start:end] if start < len(items) else []

    return {
        "items": [serialize_item(p) for p in page_items],
        "total": len(items),
        "page": page,
        "page_size": page_size,
    }


@app.post("/api/v1/projects")
@tracer.capture_method
def create_project():
    """Create a new project."""
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
        "hypothesis_count": 0,
        "evidence_count": 0,
        "user_id": "default",
        "created_at": now,
        "updated_at": now,
    }

    table.put_item(Item=item)
    metrics.add_metric(name="ProjectsCreated", unit="Count", value=1)
    logger.info("Project created", project_id=project_id, name=item["name"])

    return serialize_item(item)


@app.get("/api/v1/projects/<project_id>")
@tracer.capture_method
def get_project(project_id: str):
    """Get a single project."""
    table = dynamodb.Table(PROJECTS_TABLE)
    response = table.get_item(Key={"id": project_id})
    item = response.get("Item")

    if not item:
        return {"error": "Project not found"}, 404

    return serialize_item(item)


@app.patch("/api/v1/projects/<project_id>")
@tracer.capture_method
def update_project(project_id: str):
    """Update a project."""
    body = app.current_event.json_body or {}
    table = dynamodb.Table(PROJECTS_TABLE)

    # Build update expression
    update_parts = []
    expr_names = {}
    expr_values = {":updated_at": datetime.utcnow().isoformat()}
    update_parts.append("#updated_at = :updated_at")
    expr_names["#updated_at"] = "updated_at"

    for field in ["name", "description", "disease_focus", "research_question", "tags"]:
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

    return serialize_item(response.get("Attributes", {}))


@app.delete("/api/v1/projects/<project_id>")
@tracer.capture_method
def delete_project(project_id: str):
    """Delete a project."""
    table = dynamodb.Table(PROJECTS_TABLE)
    table.delete_item(Key={"id": project_id})
    return {"message": "Project deleted"}


@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics(capture_cold_start_metric=True)
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """Lambda handler entry point."""
    return app.resolve(event, context)
