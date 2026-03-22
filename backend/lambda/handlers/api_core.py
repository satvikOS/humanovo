"""
API Core Lambda Handler - Health check and status endpoints.
"""

import json
import os
from datetime import datetime
from typing import Any

import boto3
from aws_lambda_powertools import Logger, Metrics
from aws_lambda_powertools.event_handler import APIGatewayHttpResolver
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger()
metrics = Metrics()

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


@logger.inject_lambda_context
@metrics.log_metrics(capture_cold_start_metric=True)
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """Lambda handler entry point."""
    return app.resolve(event, context)
