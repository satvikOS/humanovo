"""
Bulk ETL Lambda Handler

Triggered by EventBridge (monthly) or manual invocation to download
and load open biomedical datasets into DynamoDB for grounding.

Cost: $0 — runs within Lambda free tier, stores in DynamoDB free tier.

EventBridge rule (monthly):
  Schedule: rate(30 days)
  Target: this Lambda
  Input: {"schedule_type": "monthly"}

Manual invocation:
  aws lambda invoke --function-name genup-dev-bulk_etl \
    --payload '{"datasets": ["gene_ontology", "hpo"]}' out.json
"""

import json
import os
from typing import Any

import boto3
from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger()
tracer = Tracer()
metrics = Metrics()

# Import paths — Lambda bundles the backend code
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from app.etl.bulk_loader import BulkLoader, load_priority_datasets
from app.etl.datasets import DATASETS, get_datasets_by_priority


@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics(capture_cold_start_metric=True)
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """
    Main handler for scheduled and manual bulk ETL.

    Event shapes:
      Scheduled (monthly):
        {"schedule_type": "monthly"}
        → loads priority datasets only (small ontologies)

      Full load:
        {"schedule_type": "full", "max_records": 100000}
        → loads all datasets

      Specific datasets:
        {"datasets": ["gene_ontology", "chebi"], "max_records": 50000}
        → loads only specified datasets

      Re-process (skip download):
        {"datasets": ["gene_ontology"], "skip_download": true}
        → re-parse from already-downloaded S3 data
    """
    schedule_type = event.get("schedule_type", "")
    specific_datasets = event.get("datasets")
    max_records = event.get("max_records", 50_000)
    skip_download = event.get("skip_download", False)

    logger.info(
        "Bulk ETL triggered",
        schedule_type=schedule_type,
        datasets=specific_datasets,
        max_records=max_records,
    )

    try:
        loader = BulkLoader()

        if specific_datasets:
            # Load specific datasets
            result = loader.load_all(
                datasets=specific_datasets,
                max_records_per_dataset=max_records,
                skip_download=skip_download,
            )
        elif schedule_type == "full":
            # Load everything
            result = loader.load_all(
                max_records_per_dataset=max_records,
                skip_download=skip_download,
            )
        else:
            # Monthly/default: priority datasets only
            result = loader.load_all(
                datasets=[
                    "gene_ontology",
                    "human_phenotype_ontology",
                    "disease_ontology",
                    "hgnc_gene_names",
                    "reactome_pathway_names",
                    "reactome_pathways",
                ],
                max_records_per_dataset=max_records,
                skip_download=skip_download,
            )

        metrics.add_metric(
            name="BulkETLRecordsLoaded",
            unit="Count",
            value=result.get("records_loaded", 0),
        )
        metrics.add_metric(
            name="BulkETLDatasetsProcessed",
            unit="Count",
            value=result.get("datasets_processed", 0),
        )

        return {
            "statusCode": 200,
            "body": {
                "message": "Bulk ETL complete",
                **result,
            },
        }

    except Exception as e:
        logger.error("Bulk ETL failed", error=str(e))
        metrics.add_metric(name="BulkETLErrors", unit="Count", value=1)

        return {
            "statusCode": 500,
            "body": {"error": str(e)},
        }


@logger.inject_lambda_context
@tracer.capture_lambda_handler
def handler_status(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """Check bulk ETL status — what's loaded and when."""
    dynamodb = boto3.resource("dynamodb")
    state_table = dynamodb.Table(
        os.environ.get("INGESTION_STATE_TABLE", "genup-dev-ingestion-state")
    )

    status = {}
    for dataset_key in DATASETS:
        try:
            response = state_table.get_item(
                Key={"source": f"bulk_etl:{dataset_key}"}
            )
            item = response.get("Item", {})
            status[dataset_key] = {
                "name": DATASETS[dataset_key].name,
                "status": item.get("status", "not_loaded"),
                "last_run": item.get("last_run", "never"),
                "records": item.get("records_fetched", 0),
            }
        except Exception:
            status[dataset_key] = {
                "name": DATASETS[dataset_key].name,
                "status": "unknown",
            }

    return {
        "statusCode": 200,
        "body": {"datasets": status},
    }
