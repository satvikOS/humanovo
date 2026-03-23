"""
Brave Search Fetcher Lambda Handler

Fetches web search results from Brave Search API with strict rate limiting.
API Limits: 1 request/second, 2000 requests/month

Used sparingly for high-value web content not available in academic databases.
"""

import hashlib
import json
import os
import time
from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

import boto3
from aws_lambda_powertools import Logger, Metrics
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger()
metrics = Metrics()

# AWS Clients
dynamodb = boto3.resource("dynamodb")
ssm = boto3.client("ssm")
s3 = boto3.client("s3")
sqs = boto3.client("sqs")
bedrock_runtime = boto3.client("bedrock-runtime")

# Configuration
KNOWLEDGE_TABLE = os.environ.get("KNOWLEDGE_TABLE", "genup-dev-knowledge")
RATE_LIMIT_TABLE = os.environ.get("RATE_LIMIT_TABLE", "genup-dev-rate-limits")
RAW_BUCKET = os.environ.get("RAW_BUCKET", "genup-dev-raw-data")
EMBEDDING_QUEUE = os.environ.get("EMBEDDING_QUEUE_URL", "")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "anthropic.claude-3-5-sonnet-20241022-v2:0")

# Brave API configuration
BRAVE_API_BASE = "https://api.search.brave.com/res/v1"
BRAVE_API_KEY_PARAM = "/genup/brave_api_key"

# Rate limiting constants (STRICT)
REQUESTS_PER_SECOND = 1
MONTHLY_QUOTA = 2000
DAILY_BUDGET = 60  # Conservative daily budget (2000/30 ≈ 66)

# Healthcare keywords for filtering
HEALTHCARE_KEYWORDS = [
    "health", "medical", "clinical", "treatment", "therapy",
    "disease", "patient", "drug", "study", "research",
    "ncbi", "pubmed", "nih", "fda", "who", "cdc",
    "cancer", "gene", "protein", "mutation", "trial",
    "pharmaceutical", "biotech", "diagnosis", "prognosis",
]


def get_brave_api_key() -> str:
    """Get Brave API key from SSM Parameter Store."""
    try:
        response = ssm.get_parameter(Name=BRAVE_API_KEY_PARAM, WithDecryption=True)
        return response["Parameter"]["Value"]
    except Exception as e:
        logger.error("Failed to get Brave API key", error=str(e))
        # Fallback to environment variable
        return os.environ.get("BRAVE_API_KEY", "")


def check_rate_limit() -> tuple[bool, dict]:
    """
    Check if we can make a request based on rate limits.

    Returns:
        (allowed, status_dict)
    """
    table = dynamodb.Table(RATE_LIMIT_TABLE)
    now = datetime.utcnow()
    month_key = now.strftime("%Y-%m")
    day_key = now.strftime("%Y-%m-%d")

    try:
        # Get monthly usage
        monthly_response = table.get_item(
            Key={"limit_type": "brave_monthly", "period": month_key}
        )
        monthly_usage = monthly_response.get("Item", {}).get("count", 0)

        # Get daily usage
        daily_response = table.get_item(
            Key={"limit_type": "brave_daily", "period": day_key}
        )
        daily_usage = daily_response.get("Item", {}).get("count", 0)

        # Get last request time for 1 req/sec limit
        last_request_response = table.get_item(
            Key={"limit_type": "brave_last_request", "period": "current"}
        )
        last_request_ts = last_request_response.get("Item", {}).get("timestamp", "")

        status = {
            "monthly_usage": monthly_usage,
            "monthly_quota": MONTHLY_QUOTA,
            "daily_usage": daily_usage,
            "daily_budget": DAILY_BUDGET,
            "monthly_remaining": MONTHLY_QUOTA - monthly_usage,
            "daily_remaining": DAILY_BUDGET - daily_usage,
        }

        # Check monthly limit
        if monthly_usage >= MONTHLY_QUOTA:
            logger.warning("Monthly quota exceeded", usage=monthly_usage)
            return False, {**status, "blocked_reason": "monthly_quota_exceeded"}

        # Check daily budget
        if daily_usage >= DAILY_BUDGET:
            logger.warning("Daily budget exceeded", usage=daily_usage)
            return False, {**status, "blocked_reason": "daily_budget_exceeded"}

        # Check 1 request per second
        if last_request_ts:
            last_dt = datetime.fromisoformat(last_request_ts)
            elapsed = (now - last_dt).total_seconds()
            if elapsed < 1.0:
                # Wait for remaining time
                wait_time = 1.0 - elapsed
                logger.info("Rate limit wait", wait_time=wait_time)
                time.sleep(wait_time)

        return True, status

    except Exception as e:
        logger.error("Rate limit check failed", error=str(e))
        # Fail closed - don't make request if we can't check limits
        return False, {"blocked_reason": "check_failed", "error": str(e)}


def record_request() -> None:
    """Record a successful request for rate limiting."""
    table = dynamodb.Table(RATE_LIMIT_TABLE)
    now = datetime.utcnow()
    month_key = now.strftime("%Y-%m")
    day_key = now.strftime("%Y-%m-%d")

    try:
        # Increment monthly counter
        table.update_item(
            Key={"limit_type": "brave_monthly", "period": month_key},
            UpdateExpression="SET #count = if_not_exists(#count, :zero) + :one",
            ExpressionAttributeNames={"#count": "count"},
            ExpressionAttributeValues={":zero": 0, ":one": 1},
        )

        # Increment daily counter
        table.update_item(
            Key={"limit_type": "brave_daily", "period": day_key},
            UpdateExpression="SET #count = if_not_exists(#count, :zero) + :one, #ttl = :ttl",
            ExpressionAttributeNames={"#count": "count", "#ttl": "ttl"},
            ExpressionAttributeValues={
                ":zero": 0,
                ":one": 1,
                ":ttl": int((now + timedelta(days=2)).timestamp()),
            },
        )

        # Update last request timestamp
        table.put_item(
            Item={
                "limit_type": "brave_last_request",
                "period": "current",
                "timestamp": now.isoformat(),
            }
        )

    except Exception as e:
        logger.error("Failed to record request", error=str(e))


def brave_search(query: str, count: int = 10) -> list[dict]:
    """
    Search using Brave API.

    Args:
        query: Search query
        count: Number of results (max 20)

    Returns:
        List of search results
    """
    import urllib.request
    import urllib.parse

    api_key = get_brave_api_key()
    if not api_key:
        logger.error("Brave API key not configured")
        return []

    # Check rate limit first
    allowed, status = check_rate_limit()
    if not allowed:
        logger.warning("Rate limit blocked", status=status)
        metrics.add_metric(name="BraveRateLimitBlocked", unit="Count", value=1)
        return []

    params = {
        "q": query,
        "count": min(count, 20),
        "country": "US",
        "search_lang": "en",
        "safesearch": "moderate",
    }

    url = f"{BRAVE_API_BASE}/web/search?{urllib.parse.urlencode(params)}"

    try:
        req = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "Accept-Encoding": "gzip",
                "X-Subscription-Token": api_key,
            },
        )

        with urllib.request.urlopen(req, timeout=30) as response:
            data = json.loads(response.read())

            # Record successful request
            record_request()
            metrics.add_metric(name="BraveAPIRequests", unit="Count", value=1)

            results = []

            # Parse web results
            for result in data.get("web", {}).get("results", []):
                results.append({
                    "title": result.get("title", ""),
                    "url": result.get("url", ""),
                    "description": result.get("description", ""),
                    "source": result.get("profile", {}).get("name", ""),
                    "age": result.get("age", ""),
                    "language": result.get("language", ""),
                })

            # Parse news results if available
            for result in data.get("news", {}).get("results", []):
                results.append({
                    "title": result.get("title", ""),
                    "url": result.get("url", ""),
                    "description": result.get("description", ""),
                    "source": result.get("source", ""),
                    "age": result.get("age", ""),
                    "is_news": True,
                })

            logger.info("Brave search completed", query=query[:50], results=len(results))
            return results

    except Exception as e:
        logger.error("Brave search failed", error=str(e))
        return []


def is_healthcare_relevant(result: dict) -> bool:
    """Check if a result is healthcare-relevant."""
    text = f"{result.get('title', '')} {result.get('description', '')} {result.get('url', '')}".lower()
    return any(kw in text for kw in HEALTHCARE_KEYWORDS)


def compute_content_hash(content: str, title: str) -> str:
    """Compute hash for deduplication."""
    normalized = f"{title.lower().strip()}|{content.lower().strip()}"
    return hashlib.md5(normalized.encode()).hexdigest()


def check_duplicate(content_hash: str) -> bool:
    """Check if content already exists."""
    table = dynamodb.Table(KNOWLEDGE_TABLE)

    try:
        response = table.query(
            IndexName="hash-index",
            KeyConditionExpression="content_hash = :hash",
            ExpressionAttributeValues={":hash": content_hash},
            Limit=1,
        )
        return len(response.get("Items", [])) > 0
    except Exception:
        return False


def extract_entities_bedrock(title: str, content: str) -> dict:
    """Extract entities using Bedrock."""
    if not content:
        return {}

    prompt = f"""Extract biomedical entities from this web content. Return JSON only.

Title: {title}
Content: {content[:1500]}

Extract if present:
- genes: Gene names
- drugs: Drug/compound names
- diseases: Disease names
- organizations: Healthcare organizations

Return ONLY valid JSON like:
{{"genes": [], "drugs": [], "diseases": [], "organizations": []}}"""

    try:
        response = bedrock_runtime.invoke_model(
            modelId=BEDROCK_MODEL_ID,
            contentType="application/json",
            accept="application/json",
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 300,
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

    return {}


def save_to_knowledge_base(result: dict, entities: dict) -> str:
    """Save result to knowledge base."""
    table = dynamodb.Table(KNOWLEDGE_TABLE)

    title = result.get("title", "")
    content = result.get("description", "")
    content_hash = compute_content_hash(content, title)

    if check_duplicate(content_hash):
        metrics.add_metric(name="DuplicatesSkipped", unit="Count", value=1)
        return ""

    record_id = str(uuid4())
    now = datetime.utcnow().isoformat()

    item = {
        "id": record_id,
        "source": "brave_search",
        "source_id": result.get("url", ""),
        "content_hash": content_hash,
        "title": title,
        "content": content,
        "url": result.get("url", ""),
        "source_name": result.get("source", ""),
        "is_news": result.get("is_news", False),
        "entities": entities,
        "embedding_status": "pending",
        "created_at": now,
        "updated_at": now,
        "version": 1,
    }

    table.put_item(Item=item)

    # Queue for embedding
    if EMBEDDING_QUEUE:
        try:
            sqs.send_message(
                QueueUrl=EMBEDDING_QUEUE,
                MessageBody=json.dumps({
                    "record_id": record_id,
                    "content": f"{title} {content}"[:8000],
                    "source": "brave_search",
                }),
            )
        except Exception as e:
            logger.warning("Failed to queue embedding", error=str(e))

    return record_id


def store_raw_data(results: list[dict], query: str) -> None:
    """Store raw data to S3."""
    timestamp = datetime.utcnow().strftime("%Y/%m/%d/%H%M%S")
    query_slug = query.replace(" ", "_")[:30]
    key = f"brave_search/{timestamp}_{query_slug}.json"

    try:
        s3.put_object(
            Bucket=RAW_BUCKET,
            Key=key,
            Body=json.dumps({
                "query": query,
                "results": results,
                "fetched_at": datetime.utcnow().isoformat(),
            }),
            ContentType="application/json",
        )
    except Exception as e:
        logger.warning("Failed to store raw data", error=str(e))


@logger.inject_lambda_context
@metrics.log_metrics(capture_cold_start_metric=True)
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """
    Lambda handler for Brave Search ingestion.

    IMPORTANT: This handler respects strict rate limits:
    - 1 request per second
    - 2000 requests per month
    - Conservative daily budget of 60 requests
    """
    query = event.get("query", "")
    max_results = min(event.get("max_results", 10), 20)
    healthcare_filter = event.get("healthcare_filter", True)
    extract_entities = event.get("extract_entities", True)

    if not query:
        return {
            "statusCode": 400,
            "body": {"error": "Query is required"},
        }

    logger.info("Brave search ingestion", query=query[:50])

    # Enhance query for healthcare if filtering enabled
    search_query = query
    if healthcare_filter:
        search_query = f"{query} (research OR clinical OR treatment OR study)"

    # Perform search
    results = brave_search(search_query, max_results)

    if not results:
        return {
            "statusCode": 200,
            "body": {
                "message": "No results or rate limited",
                "query": query,
                "fetched": 0,
                "indexed": 0,
            },
        }

    # Store raw data
    store_raw_data(results, query)

    # Filter for healthcare relevance
    if healthcare_filter:
        results = [r for r in results if is_healthcare_relevant(r)]

    indexed = 0
    duplicates = 0

    for result in results:
        # Check duplicate first
        content_hash = compute_content_hash(
            result.get("description", ""),
            result.get("title", ""),
        )
        if check_duplicate(content_hash):
            duplicates += 1
            continue

        # Extract entities
        entities = {}
        if extract_entities:
            entities = extract_entities_bedrock(
                result.get("title", ""),
                result.get("description", ""),
            )

        # Save to knowledge base
        record_id = save_to_knowledge_base(result, entities)
        if record_id:
            indexed += 1

    metrics.add_metric(name="BraveResultsIndexed", unit="Count", value=indexed)

    logger.info(
        "Brave search ingestion complete",
        query=query[:50],
        fetched=len(results),
        indexed=indexed,
        duplicates=duplicates,
    )

    return {
        "statusCode": 200,
        "body": {
            "message": "Brave search ingestion complete",
            "query": query,
            "fetched": len(results),
            "indexed": indexed,
            "duplicates_skipped": duplicates,
        },
    }


# Get rate limit status handler
@logger.inject_lambda_context
def handler_status(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """Get current rate limit status."""
    allowed, status = check_rate_limit()
    return {
        "statusCode": 200,
        "body": {
            "can_make_request": allowed,
            **status,
        },
    }
