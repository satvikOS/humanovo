"""
Simulation Lambda Handler - Monte Carlo simulation management.
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
SIMULATIONS_TABLE = os.environ.get("SIMULATIONS_TABLE", "genup-dev-simulations")


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o) if o % 1 else int(o)
        return super().default(o)


def serialize_item(item: dict) -> dict:
    return json.loads(json.dumps(item, cls=DecimalEncoder))


@app.get("/api/v1/simulations")
@tracer.capture_method
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
@tracer.capture_method
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
@tracer.capture_method
def get_simulation(simulation_id: str):
    """Get a simulation."""
    table = dynamodb.Table(SIMULATIONS_TABLE)
    response = table.get_item(Key={"id": simulation_id})
    item = response.get("Item")

    if not item:
        return {"error": "Simulation not found"}, 404

    return serialize_item(item)


@app.post("/api/v1/simulations/<simulation_id>/cancel")
@tracer.capture_method
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


@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics(capture_cold_start_metric=True)
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """Lambda handler entry point."""
    return app.resolve(event, context)
