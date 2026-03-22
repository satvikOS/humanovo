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
from aws_lambda_powertools.event_handler import APIGatewayHttpResolver, Response
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


def _ensure_project_fields(item: dict) -> dict:
    """Ensure project has all fields the frontend expects."""
    item.setdefault("status", "active")
    item.setdefault("hypothesis_count", 0)
    item.setdefault("evidence_count", 0)
    item.setdefault("simulation_count", 0)
    item.setdefault("tags", [])
    return item


@app.get("/api/v1/projects")
@tracer.capture_method
def list_projects():
    """List all projects with pagination."""
    table = dynamodb.Table(PROJECTS_TABLE)
    params = app.current_event.query_string_parameters or {}
    page = int(params.get("page", "1"))
    page_size = int(params.get("page_size", "50"))
    search = params.get("search", "")

    # Full scan to get all items (DynamoDB scan Limit controls read capacity, not result count)
    all_items = []
    scan_kwargs = {}
    while True:
        response = table.scan(**scan_kwargs)
        all_items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_kwargs["ExclusiveStartKey"] = last_key

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
        "status": "active",
        "hypothesis_count": 0,
        "evidence_count": 0,
        "simulation_count": 0,
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
    """Get a single project including its hypotheses."""
    table = dynamodb.Table(PROJECTS_TABLE)
    response = table.get_item(Key={"id": project_id})
    item = response.get("Item")

    if not item:
        # Return 400 instead of 404 to avoid CloudFront's custom_error_response
        # intercepting 404s and returning index.html instead of JSON
        return Response(
            status_code=400,
            content_type="application/json",
            body=json.dumps({"detail": "Project not found", "error": "not_found"}),
        )

    project = serialize_item(_ensure_project_fields(item))

    # Fetch hypotheses linked to this project from hypotheses table
    try:
        hyp_table = dynamodb.Table(HYPOTHESES_TABLE)
        hyp_response = hyp_table.query(
            IndexName="project_id-created_at-index",
            KeyConditionExpression="project_id = :pid",
            ExpressionAttributeValues={":pid": project_id},
            ScanIndexForward=False,
        )
        db_hypotheses = hyp_response.get("Items", [])

        if db_hypotheses:
            hypotheses_list = []
            for h in db_hypotheses:
                h_serialized = serialize_item(h)
                hyp_dict = {
                    "id": h_serialized.get("id", ""),
                    "title": h_serialized.get("statement", ""),
                    "description": h_serialized.get("rationale", ""),
                    "mechanism": h_serialized.get("mechanism", ""),
                    "confidence": h_serialized.get("confidence_score", 0.5),
                    "model_used": "AI Pipeline",
                    "validated": h_serialized.get("status") == "validated",
                    "external_factors": [],
                    "created_at": h_serialized.get("created_at", ""),
                }
                hypotheses_list.append(hyp_dict)
            project["hypotheses"] = hypotheses_list
            project["hypothesis_count"] = len(hypotheses_list)
    except Exception as e:
        logger.warning(f"Failed to fetch hypotheses for project {project_id}: {e}")
        # If the GSI doesn't exist, fall back to scan with filter
        try:
            hyp_table = dynamodb.Table(HYPOTHESES_TABLE)
            hyp_response = hyp_table.scan(
                FilterExpression="project_id = :pid",
                ExpressionAttributeValues={":pid": project_id},
            )
            db_hypotheses = hyp_response.get("Items", [])
            if db_hypotheses:
                hypotheses_list = []
                for h in db_hypotheses:
                    h_serialized = serialize_item(h)
                    hyp_dict = {
                        "id": h_serialized.get("id", ""),
                        "title": h_serialized.get("statement", ""),
                        "description": h_serialized.get("rationale", ""),
                        "mechanism": h_serialized.get("mechanism", ""),
                        "confidence": h_serialized.get("confidence_score", 0.5),
                        "model_used": "AI Pipeline",
                        "validated": h_serialized.get("status") == "validated",
                        "external_factors": [],
                        "created_at": h_serialized.get("created_at", ""),
                    }
                    hypotheses_list.append(hyp_dict)
                project["hypotheses"] = hypotheses_list
                project["hypothesis_count"] = len(hypotheses_list)
        except Exception as e2:
            logger.warning(f"Fallback hypothesis scan also failed: {e2}")

    return project


@app.get("/api/v1/projects/<project_id>/hypotheses")
@tracer.capture_method
def list_project_hypotheses(project_id: str):
    """List hypotheses for a specific project."""
    params = app.current_event.query_string_parameters or {}
    limit = int(params.get("limit", "100"))
    offset = int(params.get("offset", "0"))

    hyp_table = dynamodb.Table(HYPOTHESES_TABLE)

    # Try GSI first, fall back to scan
    try:
        hyp_response = hyp_table.query(
            IndexName="project_id-created_at-index",
            KeyConditionExpression="project_id = :pid",
            ExpressionAttributeValues={":pid": project_id},
            ScanIndexForward=False,
        )
        items = hyp_response.get("Items", [])
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


@app.get("/api/v1/projects/<project_id>/stats")
@tracer.capture_method
def get_project_stats(project_id: str):
    """Get statistics for a project."""
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
