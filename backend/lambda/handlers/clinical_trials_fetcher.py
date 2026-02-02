"""
ClinicalTrials.gov Fetcher Lambda Handler

Continuously fetches clinical trial data with incremental updates,
deduplication, and knowledge engine integration.
"""

import hashlib
import json
import os
from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

import boto3
from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger()
tracer = Tracer()
metrics = Metrics()

# AWS Clients
dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")
sqs = boto3.client("sqs")
bedrock_runtime = boto3.client("bedrock-runtime")

# Configuration
KNOWLEDGE_TABLE = os.environ.get("KNOWLEDGE_TABLE", "genup-dev-knowledge")
CHECKPOINT_TABLE = os.environ.get("CHECKPOINT_TABLE", "genup-dev-ingestion-checkpoints")
RAW_BUCKET = os.environ.get("RAW_BUCKET", "genup-dev-raw-data")
EMBEDDING_QUEUE = os.environ.get("EMBEDDING_QUEUE_URL", "")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "anthropic.claude-3-5-sonnet-20241022-v2:0")

# ClinicalTrials.gov API v2
CT_BASE_URL = "https://clinicaltrials.gov/api/v2"
CT_BATCH_SIZE = 100
MAX_RESULTS_PER_RUN = 500

# Default search conditions for continuous ingestion
DEFAULT_CONDITIONS = [
    "cancer",
    "breast cancer",
    "lung cancer",
    "leukemia",
    "lymphoma",
    "diabetes",
    "alzheimer",
    "parkinson",
    "cardiovascular",
    "autoimmune",
    "rare disease",
    "gene therapy",
    "immunotherapy",
    "CAR-T",
]

# Phase mappings
PHASE_MAP = {
    "EARLY_PHASE1": "Early Phase 1",
    "PHASE1": "Phase 1",
    "PHASE2": "Phase 2",
    "PHASE3": "Phase 3",
    "PHASE4": "Phase 4",
    "NA": "Not Applicable",
}


@tracer.capture_method
def compute_content_hash(content: str, title: str) -> str:
    """Compute hash for deduplication."""
    normalized = f"{title.lower().strip()}|{content.lower().strip()}"
    return hashlib.md5(normalized.encode()).hexdigest()


@tracer.capture_method
def check_duplicate(content_hash: str) -> dict | None:
    """Check if content already exists in knowledge base."""
    table = dynamodb.Table(KNOWLEDGE_TABLE)

    try:
        response = table.query(
            IndexName="hash-index",
            KeyConditionExpression="content_hash = :hash",
            ExpressionAttributeValues={":hash": content_hash},
            Limit=1,
        )
        items = response.get("Items", [])
        return items[0] if items else None
    except Exception as e:
        logger.warning("Duplicate check failed", error=str(e))
        return None


@tracer.capture_method
def get_checkpoint(condition: str) -> dict:
    """Get last ingestion checkpoint for a condition."""
    table = dynamodb.Table(CHECKPOINT_TABLE)

    try:
        response = table.get_item(
            Key={
                "source": "clinical_trials",
                "query_hash": hashlib.md5(condition.encode()).hexdigest(),
            }
        )
        return response.get("Item", {})
    except Exception:
        return {}


@tracer.capture_method
def save_checkpoint(condition: str, last_date: str, last_count: int) -> None:
    """Save ingestion checkpoint."""
    table = dynamodb.Table(CHECKPOINT_TABLE)

    table.put_item(
        Item={
            "source": "clinical_trials",
            "query_hash": hashlib.md5(condition.encode()).hexdigest(),
            "query": condition,
            "last_date": last_date,
            "last_count": last_count,
            "updated_at": datetime.utcnow().isoformat(),
        }
    )


@tracer.capture_method
def fetch_clinical_trials(
    condition: str,
    last_update_after: str | None = None,
    page_size: int = 100,
    page_token: str | None = None,
) -> tuple[list[dict], str | None]:
    """Fetch clinical trials from ClinicalTrials.gov API v2."""
    import urllib.request
    import urllib.parse

    params = {
        "query.cond": condition,
        "pageSize": min(page_size, CT_BATCH_SIZE),
        "format": "json",
        "fields": (
            "NCTId,BriefTitle,OfficialTitle,BriefSummary,DetailedDescription,"
            "Condition,Phase,OverallStatus,StartDate,CompletionDate,"
            "LeadSponsorName,LocationCountry,LocationCity,EnrollmentCount,"
            "InterventionType,InterventionName,EligibilityCriteria,"
            "PrimaryOutcomeMeasure,SecondaryOutcomeMeasure,LastUpdatePostDate"
        ),
    }

    if last_update_after:
        params["filter.advanced"] = f"AREA[LastUpdatePostDate]RANGE[{last_update_after},MAX]"

    if page_token:
        params["pageToken"] = page_token

    url = f"{CT_BASE_URL}/studies?{urllib.parse.urlencode(params)}"

    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as response:
            data = json.loads(response.read())

            studies = data.get("studies", [])
            next_token = data.get("nextPageToken")

            return studies, next_token
    except Exception as e:
        logger.error("ClinicalTrials.gov fetch failed", error=str(e))
        return [], None


def parse_clinical_trial(study: dict) -> dict:
    """Parse a clinical trial study into a normalized format."""
    proto = study.get("protocolSection", {})
    id_module = proto.get("identificationModule", {})
    desc_module = proto.get("descriptionModule", {})
    status_module = proto.get("statusModule", {})
    sponsor_module = proto.get("sponsorCollaboratorsModule", {})
    design_module = proto.get("designModule", {})
    eligibility_module = proto.get("eligibilityModule", {})
    outcomes_module = proto.get("outcomesModule", {})
    interventions_module = proto.get("armsInterventionsModule", {})
    conditions_module = proto.get("conditionsModule", {})

    # NCT ID
    nct_id = id_module.get("nctId", "")

    # Titles
    brief_title = id_module.get("briefTitle", "")
    official_title = id_module.get("officialTitle", "")

    # Description
    brief_summary = desc_module.get("briefSummary", "")
    detailed_desc = desc_module.get("detailedDescription", "")

    # Status
    overall_status = status_module.get("overallStatus", "")
    start_date = status_module.get("startDateStruct", {}).get("date", "")
    completion_date = status_module.get("completionDateStruct", {}).get("date", "")
    last_update = status_module.get("lastUpdatePostDateStruct", {}).get("date", "")

    # Sponsor
    lead_sponsor = sponsor_module.get("leadSponsor", {}).get("name", "")

    # Phases
    phases = design_module.get("phases", [])
    phase_str = ", ".join([PHASE_MAP.get(p, p) for p in phases]) if phases else "Unknown"

    # Enrollment
    enrollment = design_module.get("enrollmentInfo", {}).get("count", 0)

    # Conditions
    conditions = conditions_module.get("conditions", [])

    # Interventions
    interventions = []
    for intervention in interventions_module.get("interventions", []):
        interventions.append({
            "type": intervention.get("type", ""),
            "name": intervention.get("name", ""),
            "description": intervention.get("description", ""),
        })

    # Outcomes
    primary_outcomes = []
    for outcome in outcomes_module.get("primaryOutcomes", []):
        primary_outcomes.append(outcome.get("measure", ""))

    secondary_outcomes = []
    for outcome in outcomes_module.get("secondaryOutcomes", []):
        secondary_outcomes.append(outcome.get("measure", ""))

    # Eligibility
    eligibility = eligibility_module.get("eligibilityCriteria", "")

    return {
        "nct_id": nct_id,
        "brief_title": brief_title,
        "official_title": official_title,
        "brief_summary": brief_summary,
        "detailed_description": detailed_desc,
        "overall_status": overall_status,
        "phase": phase_str,
        "start_date": start_date,
        "completion_date": completion_date,
        "last_update": last_update,
        "lead_sponsor": lead_sponsor,
        "enrollment": enrollment,
        "conditions": conditions,
        "interventions": interventions,
        "primary_outcomes": primary_outcomes,
        "secondary_outcomes": secondary_outcomes,
        "eligibility": eligibility,
        "url": f"https://clinicaltrials.gov/study/{nct_id}",
    }


@tracer.capture_method
def extract_entities_bedrock(title: str, summary: str, interventions: list[dict]) -> dict:
    """Extract biomedical entities using Bedrock Claude."""
    intervention_text = ", ".join([i.get("name", "") for i in interventions])

    prompt = f"""Extract biomedical entities from this clinical trial. Return JSON only.

Title: {title}
Summary: {summary[:1500]}
Interventions: {intervention_text}

Extract these entity types:
- genes: Gene names and symbols targeted
- proteins: Protein targets
- drugs: Drug/compound names being tested
- diseases: Conditions being treated
- biomarkers: Biomarkers mentioned

Return ONLY valid JSON like:
{{"genes": ["EGFR"], "proteins": ["HER2"], "drugs": ["pembrolizumab"], "diseases": ["lung cancer"], "biomarkers": ["PD-L1"]}}"""

    try:
        response = bedrock_runtime.invoke_model(
            modelId=BEDROCK_MODEL_ID,
            contentType="application/json",
            accept="application/json",
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 500,
                "temperature": 0,
                "messages": [{"role": "user", "content": prompt}],
            }),
        )

        response_body = json.loads(response["body"].read())
        text = response_body["content"][0]["text"]

        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])
    except Exception as e:
        logger.warning("Entity extraction failed", error=str(e))

    return {"genes": [], "proteins": [], "drugs": [], "diseases": [], "biomarkers": []}


@tracer.capture_method
def save_to_knowledge_base(trial: dict, entities: dict) -> str:
    """Save clinical trial to knowledge base."""
    table = dynamodb.Table(KNOWLEDGE_TABLE)

    # Create comprehensive content for embedding
    content = f"{trial.get('brief_title', '')} {trial.get('brief_summary', '')} {trial.get('detailed_description', '')}"
    content_hash = compute_content_hash(content, trial.get("brief_title", ""))

    # Check for duplicate
    existing = check_duplicate(content_hash)
    if existing:
        # Update if newer version
        existing_update = existing.get("last_update", "")
        new_update = trial.get("last_update", "")
        if new_update > existing_update:
            logger.info("Updating existing record", nct_id=trial.get("nct_id"))
            record_id = existing.get("id")
            # Update the record
            table.update_item(
                Key={"id": record_id},
                UpdateExpression="SET content = :c, overall_status = :s, last_update = :u, updated_at = :t, version = version + :one",
                ExpressionAttributeValues={
                    ":c": content,
                    ":s": trial.get("overall_status", ""),
                    ":u": new_update,
                    ":t": datetime.utcnow().isoformat(),
                    ":one": 1,
                },
            )
            return record_id
        else:
            metrics.add_metric(name="DuplicatesSkipped", unit="Count", value=1)
            return existing.get("id", "")

    record_id = str(uuid4())
    now = datetime.utcnow().isoformat()

    item = {
        "id": record_id,
        "source": "clinical_trials",
        "source_id": trial.get("nct_id", ""),
        "content_hash": content_hash,
        "title": trial.get("brief_title", ""),
        "official_title": trial.get("official_title", ""),
        "content": content,
        "brief_summary": trial.get("brief_summary", ""),
        "overall_status": trial.get("overall_status", ""),
        "phase": trial.get("phase", ""),
        "start_date": trial.get("start_date", ""),
        "completion_date": trial.get("completion_date", ""),
        "last_update": trial.get("last_update", ""),
        "lead_sponsor": trial.get("lead_sponsor", ""),
        "enrollment": trial.get("enrollment", 0),
        "conditions": trial.get("conditions", []),
        "interventions": trial.get("interventions", []),
        "primary_outcomes": trial.get("primary_outcomes", []),
        "eligibility": trial.get("eligibility", "")[:5000],  # Truncate
        "url": trial.get("url", ""),
        "entities": entities,
        "embedding_status": "pending",
        "created_at": now,
        "updated_at": now,
        "version": 1,
    }

    table.put_item(Item=item)

    # Queue for embedding generation
    if EMBEDDING_QUEUE:
        try:
            sqs.send_message(
                QueueUrl=EMBEDDING_QUEUE,
                MessageBody=json.dumps({
                    "record_id": record_id,
                    "content": content[:8000],
                    "source": "clinical_trials",
                }),
            )
        except Exception as e:
            logger.warning("Failed to queue embedding", error=str(e))

    return record_id


@tracer.capture_method
def store_raw_data(trials: list[dict], condition: str) -> str:
    """Store raw fetched data to S3 for auditing."""
    timestamp = datetime.utcnow().strftime("%Y/%m/%d/%H%M%S")
    condition_slug = condition.replace(" ", "_")[:30]
    key = f"clinical_trials/{timestamp}_{condition_slug}.json"

    try:
        s3.put_object(
            Bucket=RAW_BUCKET,
            Key=key,
            Body=json.dumps({
                "condition": condition,
                "trials": trials,
                "fetched_at": datetime.utcnow().isoformat(),
            }),
            ContentType="application/json",
        )
        return key
    except Exception as e:
        logger.warning("Failed to store raw data", error=str(e))
        return ""


@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics(capture_cold_start_metric=True)
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """
    Lambda handler for ClinicalTrials.gov ingestion.

    Can be triggered by:
    - EventBridge schedule (continuous ingestion)
    - API Gateway (on-demand ingestion)
    - Direct invocation with custom conditions
    """
    # Get conditions from event or use defaults
    conditions = event.get("conditions", [])
    if not conditions:
        condition = event.get("condition", "")
        if condition:
            conditions = [condition]
        else:
            conditions = DEFAULT_CONDITIONS

    max_results = event.get("max_results", 100)
    extract_entities = event.get("extract_entities", True)

    total_fetched = 0
    total_indexed = 0
    total_updated = 0
    total_duplicates = 0
    results = []

    for condition in conditions:
        logger.info("Processing condition", condition=condition)

        # Get checkpoint for incremental updates
        checkpoint = get_checkpoint(condition)
        last_update_date = checkpoint.get("last_date")

        # If no checkpoint, start from 30 days ago
        if not last_update_date:
            last_update_date = (datetime.utcnow() - timedelta(days=30)).strftime("%Y-%m-%d")

        # Fetch trials with pagination
        all_trials = []
        page_token = None
        fetched_count = 0

        while fetched_count < max_results:
            remaining = max_results - fetched_count
            trials, page_token = fetch_clinical_trials(
                condition,
                last_update_date,
                min(CT_BATCH_SIZE, remaining),
                page_token,
            )

            if not trials:
                break

            all_trials.extend(trials)
            fetched_count += len(trials)

            if not page_token:
                break

        if not all_trials:
            logger.info("No new trials found", condition=condition)
            continue

        total_fetched += len(all_trials)

        # Parse and process trials
        parsed_trials = []
        for study in all_trials:
            try:
                parsed = parse_clinical_trial(study)
                parsed_trials.append(parsed)
            except Exception as e:
                logger.warning("Failed to parse trial", error=str(e))

        # Store raw data
        store_raw_data(parsed_trials, condition)

        # Process each trial
        condition_indexed = 0
        for trial in parsed_trials:
            if not trial.get("brief_summary"):
                continue

            # Extract entities if enabled
            entities = {}
            if extract_entities:
                entities = extract_entities_bedrock(
                    trial.get("brief_title", ""),
                    trial.get("brief_summary", ""),
                    trial.get("interventions", []),
                )

            # Save to knowledge base
            content = f"{trial.get('brief_title', '')} {trial.get('brief_summary', '')}"
            content_hash = compute_content_hash(content, trial.get("brief_title", ""))

            existing = check_duplicate(content_hash)
            if existing:
                # Check if update needed
                if trial.get("last_update", "") > existing.get("last_update", ""):
                    total_updated += 1
                else:
                    total_duplicates += 1
                    continue

            record_id = save_to_knowledge_base(trial, entities)
            if record_id:
                condition_indexed += 1

        total_indexed += condition_indexed

        # Update checkpoint
        today = datetime.utcnow().strftime("%Y-%m-%d")
        save_checkpoint(condition, today, len(parsed_trials))

        results.append({
            "condition": condition,
            "fetched": len(parsed_trials),
            "indexed": condition_indexed,
        })

    metrics.add_metric(name="TrialsFetched", unit="Count", value=total_fetched)
    metrics.add_metric(name="TrialsIndexed", unit="Count", value=total_indexed)
    metrics.add_metric(name="TrialsUpdated", unit="Count", value=total_updated)
    metrics.add_metric(name="DuplicatesFound", unit="Count", value=total_duplicates)

    logger.info(
        "ClinicalTrials ingestion complete",
        conditions=len(conditions),
        fetched=total_fetched,
        indexed=total_indexed,
        updated=total_updated,
        duplicates=total_duplicates,
    )

    return {
        "statusCode": 200,
        "body": {
            "message": "ClinicalTrials ingestion complete",
            "conditions_processed": len(conditions),
            "total_fetched": total_fetched,
            "total_indexed": total_indexed,
            "total_updated": total_updated,
            "duplicates_skipped": total_duplicates,
            "results": results,
        },
    }
