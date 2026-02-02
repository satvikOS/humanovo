"""
Ingestion Scheduler Lambda Handler

Orchestrates scheduled data ingestion from multiple sources.
Triggered by EventBridge on a schedule to maintain the knowledge base.
"""

import json
import os
from datetime import datetime, timedelta
from typing import Any

import boto3
from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger()
tracer = Tracer()
metrics = Metrics()

# AWS Clients
lambda_client = boto3.client("lambda")
dynamodb = boto3.resource("dynamodb")
sns = boto3.client("sns")

# Configuration
PUBMED_FETCHER_ARN = os.environ.get("PUBMED_FETCHER_ARN", "")
CLINICAL_TRIALS_FETCHER_ARN = os.environ.get("CLINICAL_TRIALS_FETCHER_ARN", "")
BRAVE_SEARCH_ARN = os.environ.get("BRAVE_SEARCH_ARN", "")
INGESTION_STATE_TABLE = os.environ.get("INGESTION_STATE_TABLE", "genup-dev-ingestion-state")
NOTIFICATION_TOPIC_ARN = os.environ.get("NOTIFICATION_TOPIC_ARN", "")

# Ingestion schedule configuration
INGESTION_SCHEDULE = {
    "pubmed": {
        "enabled": True,
        "priority": 1,  # Highest priority
        "max_results": 200,
        "queries": [
            # High priority - trending topics
            {"query": "cancer immunotherapy 2024", "priority": 10},
            {"query": "CRISPR gene editing clinical trial", "priority": 10},
            {"query": "mRNA vaccine technology", "priority": 9},
            # Core research areas
            {"query": "TP53 tumor suppressor mutations", "priority": 8},
            {"query": "BRCA1 BRCA2 breast cancer", "priority": 8},
            {"query": "CAR-T cell therapy", "priority": 8},
            {"query": "checkpoint inhibitor PD-1 PD-L1", "priority": 8},
            # Emerging areas
            {"query": "AlphaFold protein structure prediction", "priority": 7},
            {"query": "single cell RNA sequencing", "priority": 7},
            {"query": "liquid biopsy ctDNA", "priority": 7},
            # Disease-specific
            {"query": "Alzheimer disease amyloid tau", "priority": 6},
            {"query": "diabetes GLP-1 agonist", "priority": 6},
            {"query": "rare disease gene therapy", "priority": 6},
        ],
    },
    "clinical_trials": {
        "enabled": True,
        "priority": 2,
        "max_results": 150,
        "conditions": [
            # Oncology
            {"condition": "cancer", "priority": 10},
            {"condition": "breast cancer", "priority": 9},
            {"condition": "lung cancer", "priority": 9},
            {"condition": "leukemia", "priority": 8},
            {"condition": "lymphoma", "priority": 8},
            # Neurology
            {"condition": "Alzheimer", "priority": 8},
            {"condition": "Parkinson", "priority": 7},
            # Other high-value areas
            {"condition": "gene therapy", "priority": 9},
            {"condition": "immunotherapy", "priority": 9},
            {"condition": "CAR-T", "priority": 9},
            {"condition": "diabetes", "priority": 7},
            {"condition": "cardiovascular", "priority": 7},
        ],
    },
    "brave_search": {
        "enabled": True,
        "priority": 3,  # Lower priority, respect rate limits
        "max_results": 20,  # Conservative due to 2000/month limit
        "queries": [
            # Only high-value searches to conserve quota
            {"query": "FDA drug approval 2024", "priority": 10},
            {"query": "clinical trial breakthrough results", "priority": 9},
            {"query": "gene therapy approval news", "priority": 8},
        ],
    },
}


@tracer.capture_method
def get_ingestion_state(source: str) -> dict:
    """Get current ingestion state for a source."""
    table = dynamodb.Table(INGESTION_STATE_TABLE)

    try:
        response = table.get_item(Key={"source": source})
        return response.get("Item", {})
    except Exception:
        return {}


@tracer.capture_method
def update_ingestion_state(
    source: str,
    status: str,
    records_fetched: int = 0,
    error: str = "",
) -> None:
    """Update ingestion state after run."""
    table = dynamodb.Table(INGESTION_STATE_TABLE)

    table.put_item(
        Item={
            "source": source,
            "status": status,
            "last_run": datetime.utcnow().isoformat(),
            "records_fetched": records_fetched,
            "error": error,
        }
    )


@tracer.capture_method
def should_run_source(source: str, config: dict) -> bool:
    """Determine if source should run based on state and config."""
    if not config.get("enabled", True):
        return False

    state = get_ingestion_state(source)
    last_run = state.get("last_run")

    if not last_run:
        return True

    # Check cooldown based on priority
    priority = config.get("priority", 5)
    if priority <= 2:
        cooldown_hours = 4  # High priority: every 4 hours
    elif priority <= 4:
        cooldown_hours = 8  # Medium priority: every 8 hours
    else:
        cooldown_hours = 24  # Low priority: daily

    last_run_dt = datetime.fromisoformat(last_run)
    cooldown_end = last_run_dt + timedelta(hours=cooldown_hours)

    return datetime.utcnow() > cooldown_end


@tracer.capture_method
def invoke_fetcher(
    arn: str,
    payload: dict,
    async_invoke: bool = True,
) -> dict:
    """Invoke a fetcher Lambda function."""
    if not arn:
        logger.warning("Fetcher ARN not configured")
        return {"success": False, "error": "Fetcher not configured"}

    invocation_type = "Event" if async_invoke else "RequestResponse"

    try:
        response = lambda_client.invoke(
            FunctionName=arn,
            InvocationType=invocation_type,
            Payload=json.dumps(payload),
        )

        if invocation_type == "Event":
            return {"success": True, "message": "Invoked asynchronously"}

        payload_response = json.loads(response["Payload"].read())
        return payload_response

    except Exception as e:
        logger.error("Fetcher invocation failed", arn=arn, error=str(e))
        return {"success": False, "error": str(e)}


@tracer.capture_method
def run_pubmed_ingestion() -> dict:
    """Run PubMed ingestion."""
    config = INGESTION_SCHEDULE["pubmed"]

    if not should_run_source("pubmed", config):
        logger.info("Skipping PubMed ingestion (cooldown)")
        return {"skipped": True, "reason": "cooldown"}

    # Sort queries by priority
    queries = sorted(config["queries"], key=lambda x: x["priority"], reverse=True)

    # Invoke fetcher with top queries
    top_queries = [q["query"] for q in queries[:5]]  # Limit per run

    result = invoke_fetcher(
        PUBMED_FETCHER_ARN,
        {
            "queries": top_queries,
            "max_results": config["max_results"],
            "extract_entities": True,
        },
    )

    status = "completed" if result.get("success", False) else "failed"
    records = result.get("body", {}).get("total_indexed", 0) if isinstance(result.get("body"), dict) else 0

    update_ingestion_state("pubmed", status, records, result.get("error", ""))

    return result


@tracer.capture_method
def run_clinical_trials_ingestion() -> dict:
    """Run ClinicalTrials.gov ingestion."""
    config = INGESTION_SCHEDULE["clinical_trials"]

    if not should_run_source("clinical_trials", config):
        logger.info("Skipping ClinicalTrials ingestion (cooldown)")
        return {"skipped": True, "reason": "cooldown"}

    # Sort conditions by priority
    conditions = sorted(config["conditions"], key=lambda x: x["priority"], reverse=True)
    top_conditions = [c["condition"] for c in conditions[:5]]

    result = invoke_fetcher(
        CLINICAL_TRIALS_FETCHER_ARN,
        {
            "conditions": top_conditions,
            "max_results": config["max_results"],
            "extract_entities": True,
        },
    )

    status = "completed" if result.get("success", False) else "failed"
    records = result.get("body", {}).get("total_indexed", 0) if isinstance(result.get("body"), dict) else 0

    update_ingestion_state("clinical_trials", status, records, result.get("error", ""))

    return result


@tracer.capture_method
def run_brave_search_ingestion() -> dict:
    """Run Brave Search ingestion (rate-limited)."""
    config = INGESTION_SCHEDULE["brave_search"]

    if not should_run_source("brave_search", config):
        logger.info("Skipping Brave Search ingestion (cooldown)")
        return {"skipped": True, "reason": "cooldown"}

    # Very conservative - only 1 query per scheduled run
    queries = sorted(config["queries"], key=lambda x: x["priority"], reverse=True)
    top_query = queries[0]["query"] if queries else ""

    if not top_query:
        return {"skipped": True, "reason": "no queries"}

    result = invoke_fetcher(
        BRAVE_SEARCH_ARN,
        {
            "query": top_query,
            "max_results": config["max_results"],
        },
    )

    status = "completed" if result.get("success", False) else "failed"
    records = result.get("body", {}).get("total_indexed", 0) if isinstance(result.get("body"), dict) else 0

    update_ingestion_state("brave_search", status, records, result.get("error", ""))

    return result


@tracer.capture_method
def send_notification(subject: str, message: str) -> None:
    """Send notification about ingestion results."""
    if not NOTIFICATION_TOPIC_ARN:
        return

    try:
        sns.publish(
            TopicArn=NOTIFICATION_TOPIC_ARN,
            Subject=subject[:100],
            Message=message,
        )
    except Exception as e:
        logger.warning("Notification failed", error=str(e))


@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics(capture_cold_start_metric=True)
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """
    Lambda handler for scheduled ingestion orchestration.

    Triggered by EventBridge rules:
    - Every 4 hours for full ingestion
    - Every 15 minutes for high-priority sources
    """
    schedule_type = event.get("schedule_type", "full")
    sources = event.get("sources", [])  # Optional: specific sources to run

    logger.info("Starting scheduled ingestion", schedule_type=schedule_type)
    metrics.add_metric(name="ScheduledIngestionRuns", unit="Count", value=1)

    results = {}
    total_records = 0
    errors = []

    # Run sources based on schedule type
    if schedule_type == "full" or "pubmed" in sources or not sources:
        logger.info("Running PubMed ingestion")
        results["pubmed"] = run_pubmed_ingestion()
        if not results["pubmed"].get("skipped"):
            body = results["pubmed"].get("body", {})
            if isinstance(body, dict):
                total_records += body.get("total_indexed", 0)
            if results["pubmed"].get("error"):
                errors.append(f"PubMed: {results['pubmed']['error']}")

    if schedule_type == "full" or "clinical_trials" in sources or not sources:
        logger.info("Running ClinicalTrials ingestion")
        results["clinical_trials"] = run_clinical_trials_ingestion()
        if not results["clinical_trials"].get("skipped"):
            body = results["clinical_trials"].get("body", {})
            if isinstance(body, dict):
                total_records += body.get("total_indexed", 0)
            if results["clinical_trials"].get("error"):
                errors.append(f"ClinicalTrials: {results['clinical_trials']['error']}")

    if schedule_type == "full" or "brave_search" in sources:
        logger.info("Running Brave Search ingestion")
        results["brave_search"] = run_brave_search_ingestion()
        if not results["brave_search"].get("skipped"):
            body = results["brave_search"].get("body", {})
            if isinstance(body, dict):
                total_records += body.get("total_indexed", 0)
            if results["brave_search"].get("error"):
                errors.append(f"BraveSearch: {results['brave_search']['error']}")

    # Send notification if there were results or errors
    if total_records > 0 or errors:
        subject = f"GenUp Ingestion: {total_records} new records"
        if errors:
            subject += f" ({len(errors)} errors)"

        message = f"""GenUp Knowledge Base Ingestion Report
Time: {datetime.utcnow().isoformat()}
Schedule Type: {schedule_type}

Records Indexed: {total_records}

Results:
{json.dumps(results, indent=2, default=str)}

Errors:
{chr(10).join(errors) if errors else 'None'}
"""
        send_notification(subject, message)

    metrics.add_metric(name="TotalRecordsIngested", unit="Count", value=total_records)

    logger.info(
        "Scheduled ingestion complete",
        total_records=total_records,
        errors=len(errors),
    )

    return {
        "statusCode": 200,
        "body": {
            "message": "Scheduled ingestion complete",
            "total_records": total_records,
            "results": results,
            "errors": errors,
        },
    }


# Manual trigger handler
@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics(capture_cold_start_metric=True)
def handler_manual(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """
    Manual trigger handler for on-demand ingestion.

    Bypasses cooldown checks for manual runs.
    """
    sources = event.get("sources", ["pubmed", "clinical_trials"])
    force = event.get("force", True)  # Bypass cooldown by default

    logger.info("Manual ingestion triggered", sources=sources, force=force)

    results = {}

    for source in sources:
        if source == "pubmed":
            update_ingestion_state("pubmed", "running")
            results["pubmed"] = invoke_fetcher(
                PUBMED_FETCHER_ARN,
                {
                    "queries": INGESTION_SCHEDULE["pubmed"]["queries"][:3],
                    "max_results": 50,
                    "extract_entities": True,
                },
                async_invoke=False,  # Wait for result
            )
        elif source == "clinical_trials":
            update_ingestion_state("clinical_trials", "running")
            results["clinical_trials"] = invoke_fetcher(
                CLINICAL_TRIALS_FETCHER_ARN,
                {
                    "conditions": [c["condition"] for c in INGESTION_SCHEDULE["clinical_trials"]["conditions"][:3]],
                    "max_results": 50,
                    "extract_entities": True,
                },
                async_invoke=False,
            )
        elif source == "brave_search":
            update_ingestion_state("brave_search", "running")
            results["brave_search"] = invoke_fetcher(
                BRAVE_SEARCH_ARN,
                {
                    "query": INGESTION_SCHEDULE["brave_search"]["queries"][0]["query"],
                    "max_results": 10,
                },
                async_invoke=False,
            )

    return {
        "statusCode": 200,
        "body": {
            "message": "Manual ingestion complete",
            "results": results,
        },
    }
