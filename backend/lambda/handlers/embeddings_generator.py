"""
Embeddings Generator Lambda Handler

Generates vector embeddings for knowledge base records using
AWS Bedrock Titan Embeddings, with batch processing and caching.
"""

import json
import os
from datetime import datetime
from decimal import Decimal
from typing import Any

import boto3
from aws_lambda_powertools import Logger, Metrics
from aws_lambda_powertools.utilities.batch import BatchProcessor, EventType
from aws_lambda_powertools.utilities.batch.types import PartialItemFailureResponse
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger()
metrics = Metrics()

# AWS Clients
dynamodb = boto3.resource("dynamodb")
bedrock_runtime = boto3.client("bedrock-runtime")
opensearch = None  # Lazy init

# Configuration
KNOWLEDGE_TABLE = os.environ.get("KNOWLEDGE_TABLE", "genup-dev-knowledge")
EMBEDDINGS_TABLE = os.environ.get("EMBEDDINGS_TABLE", "genup-dev-embeddings")
OPENSEARCH_ENDPOINT = os.environ.get("OPENSEARCH_ENDPOINT", "")
OPENSEARCH_INDEX = os.environ.get("OPENSEARCH_INDEX", "genup-knowledge")
EMBEDDING_MODEL_ID = os.environ.get("EMBEDDING_MODEL_ID", "amazon.titan-embed-text-v2:0")
EMBEDDING_DIMENSION = 1024  # Titan v2 dimension

# Batch processor for SQS
processor = BatchProcessor(event_type=EventType.SQS)


def get_opensearch_client():
    """Get or create OpenSearch client."""
    global opensearch
    if opensearch is None and OPENSEARCH_ENDPOINT:
        from opensearchpy import OpenSearch, RequestsHttpConnection
        from requests_aws4auth import AWS4Auth

        credentials = boto3.Session().get_credentials()
        region = os.environ.get("AWS_REGION", "us-east-1")

        awsauth = AWS4Auth(
            credentials.access_key,
            credentials.secret_key,
            region,
            "aoss",
            session_token=credentials.token,
        )

        opensearch = OpenSearch(
            hosts=[{"host": OPENSEARCH_ENDPOINT, "port": 443}],
            http_auth=awsauth,
            use_ssl=True,
            verify_certs=True,
            connection_class=RequestsHttpConnection,
        )

    return opensearch


def generate_embedding(text: str) -> list[float]:
    """Generate embedding using Bedrock Titan Embeddings."""
    # Truncate to model's max input
    text = text[:8000]

    try:
        response = bedrock_runtime.invoke_model(
            modelId=EMBEDDING_MODEL_ID,
            contentType="application/json",
            accept="application/json",
            body=json.dumps({
                "inputText": text,
                "dimensions": EMBEDDING_DIMENSION,
                "normalize": True,
            }),
        )

        response_body = json.loads(response["body"].read())
        return response_body.get("embedding", [])
    except Exception as e:
        logger.error("Embedding generation failed", error=str(e))
        raise


def save_embedding_dynamodb(record_id: str, embedding: list[float], source: str) -> None:
    """Save embedding to DynamoDB."""
    table = dynamodb.Table(EMBEDDINGS_TABLE)

    # Convert floats to Decimals for DynamoDB
    embedding_decimals = [Decimal(str(v)) for v in embedding]

    table.put_item(
        Item={
            "id": record_id,
            "embedding": embedding_decimals,
            "source": source,
            "dimension": len(embedding),
            "created_at": datetime.utcnow().isoformat(),
        }
    )


def save_embedding_opensearch(
    record_id: str,
    embedding: list[float],
    content: str,
    metadata: dict,
) -> None:
    """Save embedding to OpenSearch for vector search."""
    client = get_opensearch_client()
    if not client:
        return

    doc = {
        "embedding": embedding,
        "content": content[:10000],  # Truncate for storage
        "source": metadata.get("source", ""),
        "source_id": metadata.get("source_id", ""),
        "title": metadata.get("title", ""),
        "created_at": datetime.utcnow().isoformat(),
        **{k: v for k, v in metadata.items() if k not in ["embedding", "content"]},
    }

    try:
        client.index(
            index=OPENSEARCH_INDEX,
            id=record_id,
            body=doc,
            refresh=False,  # Don't wait for refresh
        )
    except Exception as e:
        logger.error("OpenSearch indexing failed", record_id=record_id, error=str(e))
        raise


def update_knowledge_record(record_id: str, status: str = "completed") -> None:
    """Update knowledge record with embedding status."""
    table = dynamodb.Table(KNOWLEDGE_TABLE)

    table.update_item(
        Key={"id": record_id},
        UpdateExpression="SET embedding_status = :s, embedding_updated_at = :t",
        ExpressionAttributeValues={
            ":s": status,
            ":t": datetime.utcnow().isoformat(),
        },
    )


def get_knowledge_record(record_id: str) -> dict | None:
    """Get knowledge record for metadata."""
    table = dynamodb.Table(KNOWLEDGE_TABLE)

    try:
        response = table.get_item(Key={"id": record_id})
        return response.get("Item")
    except Exception:
        return None


def record_handler(record: dict) -> None:
    """Process a single SQS record."""
    body = json.loads(record["body"])

    record_id = body.get("record_id")
    content = body.get("content", "")
    source = body.get("source", "unknown")

    if not record_id or not content:
        logger.warning("Invalid record, missing id or content")
        return

    logger.info("Processing embedding", record_id=record_id, source=source)

    try:
        # Generate embedding
        embedding = generate_embedding(content)

        if not embedding:
            logger.error("Empty embedding generated", record_id=record_id)
            update_knowledge_record(record_id, "failed")
            return

        # Get full record for metadata
        knowledge_record = get_knowledge_record(record_id)
        metadata = {}
        if knowledge_record:
            metadata = {
                "source": knowledge_record.get("source", source),
                "source_id": knowledge_record.get("source_id", ""),
                "title": knowledge_record.get("title", ""),
                "entities": knowledge_record.get("entities", {}),
                "publication_date": knowledge_record.get("publication_date", ""),
            }

        # Save to DynamoDB
        save_embedding_dynamodb(record_id, embedding, source)

        # Save to OpenSearch for vector search
        if OPENSEARCH_ENDPOINT:
            save_embedding_opensearch(record_id, embedding, content, metadata)

        # Update knowledge record status
        update_knowledge_record(record_id, "completed")

        metrics.add_metric(name="EmbeddingsGenerated", unit="Count", value=1)
        logger.info("Embedding generated successfully", record_id=record_id)

    except Exception as e:
        logger.error("Embedding generation failed", record_id=record_id, error=str(e))
        update_knowledge_record(record_id, "failed")
        raise


@logger.inject_lambda_context
@metrics.log_metrics(capture_cold_start_metric=True)
def handler(event: dict[str, Any], context: LambdaContext) -> PartialItemFailureResponse:
    """
    Lambda handler for embedding generation.

    Triggered by SQS queue with records to process.
    Uses batch processing with partial failure handling.
    """
    return processor.process(event, record_handler)


# Direct invocation handler for single records
@logger.inject_lambda_context
@metrics.log_metrics(capture_cold_start_metric=True)
def handler_direct(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """
    Direct invocation handler for embedding a single record.

    Used for on-demand embedding generation.
    """
    record_id = event.get("record_id")
    content = event.get("content", "")

    if not record_id:
        return {"statusCode": 400, "body": {"error": "record_id is required"}}

    # If no content provided, fetch from knowledge base
    if not content:
        record = get_knowledge_record(record_id)
        if not record:
            return {"statusCode": 404, "body": {"error": "Record not found"}}
        content = record.get("content", "")

    if not content:
        return {"statusCode": 400, "body": {"error": "No content to embed"}}

    try:
        embedding = generate_embedding(content)

        # Get metadata
        knowledge_record = get_knowledge_record(record_id)
        source = knowledge_record.get("source", "unknown") if knowledge_record else "unknown"

        # Save embedding
        save_embedding_dynamodb(record_id, embedding, source)

        if OPENSEARCH_ENDPOINT and knowledge_record:
            metadata = {
                "source": knowledge_record.get("source", ""),
                "source_id": knowledge_record.get("source_id", ""),
                "title": knowledge_record.get("title", ""),
            }
            save_embedding_opensearch(record_id, embedding, content, metadata)

        update_knowledge_record(record_id, "completed")

        return {
            "statusCode": 200,
            "body": {
                "record_id": record_id,
                "embedding_dimension": len(embedding),
                "status": "completed",
            },
        }

    except Exception as e:
        logger.error("Direct embedding failed", record_id=record_id, error=str(e))
        update_knowledge_record(record_id, "failed")
        return {"statusCode": 500, "body": {"error": str(e)}}


# Batch re-embedding handler
@logger.inject_lambda_context
@metrics.log_metrics(capture_cold_start_metric=True)
def handler_batch(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """
    Batch handler for re-embedding records.

    Scans knowledge base for records with pending/failed embeddings.
    """
    table = dynamodb.Table(KNOWLEDGE_TABLE)
    limit = event.get("limit", 100)

    # Scan for pending records
    response = table.scan(
        FilterExpression="embedding_status IN (:pending, :failed)",
        ExpressionAttributeValues={
            ":pending": "pending",
            ":failed": "failed",
        },
        Limit=limit,
        ProjectionExpression="id, content, #s",
        ExpressionAttributeNames={"#s": "source"},
    )

    records = response.get("Items", [])
    processed = 0
    failed = 0

    for record in records:
        record_id = record.get("id")
        content = record.get("content", "")
        source = record.get("source", "unknown")

        if not content:
            continue

        try:
            embedding = generate_embedding(content)

            save_embedding_dynamodb(record_id, embedding, source)
            update_knowledge_record(record_id, "completed")
            processed += 1

        except Exception as e:
            logger.error("Batch embedding failed", record_id=record_id, error=str(e))
            update_knowledge_record(record_id, "failed")
            failed += 1

    metrics.add_metric(name="BatchEmbeddingsProcessed", unit="Count", value=processed)
    metrics.add_metric(name="BatchEmbeddingsFailed", unit="Count", value=failed)

    return {
        "statusCode": 200,
        "body": {
            "processed": processed,
            "failed": failed,
            "has_more": "LastEvaluatedKey" in response,
        },
    }
