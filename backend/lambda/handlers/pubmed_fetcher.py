"""
PubMed Fetcher Lambda Handler

Continuously fetches new publications from PubMed with incremental updates,
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
ssm = boto3.client("ssm")
bedrock_runtime = boto3.client("bedrock-runtime")

# Configuration
KNOWLEDGE_TABLE = os.environ.get("KNOWLEDGE_TABLE", "genup-dev-knowledge")
CHECKPOINT_TABLE = os.environ.get("CHECKPOINT_TABLE", "genup-dev-ingestion-checkpoints")
RAW_BUCKET = os.environ.get("RAW_BUCKET", "genup-dev-raw-data")
EMBEDDING_QUEUE = os.environ.get("EMBEDDING_QUEUE_URL", "")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "anthropic.claude-3-5-sonnet-20241022-v2:0")

# PubMed API configuration
PUBMED_BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
PUBMED_BATCH_SIZE = 100
MAX_RESULTS_PER_RUN = 500

# Default research queries for continuous ingestion
DEFAULT_QUERIES = [
    "cancer genomics mutations 2024",
    "CRISPR gene therapy clinical",
    "mRNA vaccine technology",
    "immunotherapy checkpoint inhibitors",
    "protein folding AlphaFold",
    "CAR-T cell therapy",
    "drug resistance mechanisms",
    "biomarker discovery",
    "precision medicine oncology",
    "rare disease genetics",
]


def get_api_key() -> str:
    """Get NCBI API key from SSM Parameter Store."""
    try:
        response = ssm.get_parameter(Name="/genup/ncbi_api_key", WithDecryption=True)
        return response["Parameter"]["Value"]
    except Exception:
        return ""


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
        logger.warning("Duplicate check failed, assuming not duplicate", error=str(e))
        return None


@tracer.capture_method
def get_checkpoint(query: str) -> dict:
    """Get last ingestion checkpoint for a query."""
    table = dynamodb.Table(CHECKPOINT_TABLE)

    try:
        response = table.get_item(
            Key={"source": "pubmed", "query_hash": hashlib.md5(query.encode()).hexdigest()}
        )
        return response.get("Item", {})
    except Exception:
        return {}


@tracer.capture_method
def save_checkpoint(query: str, last_date: str, last_count: int) -> None:
    """Save ingestion checkpoint."""
    table = dynamodb.Table(CHECKPOINT_TABLE)

    table.put_item(
        Item={
            "source": "pubmed",
            "query_hash": hashlib.md5(query.encode()).hexdigest(),
            "query": query,
            "last_date": last_date,
            "last_count": last_count,
            "updated_at": datetime.utcnow().isoformat(),
        }
    )


@tracer.capture_method
def fetch_pubmed_ids(query: str, start_date: str | None = None, max_results: int = 100) -> list[str]:
    """Fetch PubMed IDs matching the query."""
    import urllib.request
    import urllib.parse
    import xml.etree.ElementTree as ET

    api_key = get_api_key()

    # Build query with date filter for incremental updates
    if start_date:
        query = f"{query} AND {start_date}:3000[PDAT]"

    params = {
        "db": "pubmed",
        "term": query,
        "retmax": min(max_results, MAX_RESULTS_PER_RUN),
        "retmode": "xml",
        "sort": "date",
        "usehistory": "y",
    }

    if api_key:
        params["api_key"] = api_key

    url = f"{PUBMED_BASE_URL}/esearch.fcgi?{urllib.parse.urlencode(params)}"

    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            data = response.read()
            root = ET.fromstring(data)

            id_list = root.find("IdList")
            if id_list is None:
                return []

            return [id_elem.text for id_elem in id_list.findall("Id") if id_elem.text]
    except Exception as e:
        logger.error("PubMed search failed", error=str(e))
        return []


@tracer.capture_method
def fetch_pubmed_details(pmids: list[str]) -> list[dict]:
    """Fetch detailed records for PubMed IDs."""
    import urllib.request
    import urllib.parse
    import xml.etree.ElementTree as ET

    if not pmids:
        return []

    api_key = get_api_key()

    params = {
        "db": "pubmed",
        "id": ",".join(pmids),
        "retmode": "xml",
        "rettype": "abstract",
    }

    if api_key:
        params["api_key"] = api_key

    url = f"{PUBMED_BASE_URL}/efetch.fcgi?{urllib.parse.urlencode(params)}"

    try:
        with urllib.request.urlopen(url, timeout=60) as response:
            data = response.read()
            root = ET.fromstring(data)

            articles = []
            for article in root.findall(".//PubmedArticle"):
                try:
                    articles.append(parse_pubmed_article(article))
                except Exception as e:
                    logger.warning("Failed to parse article", error=str(e))

            return articles
    except Exception as e:
        logger.error("PubMed fetch failed", error=str(e))
        return []


def parse_pubmed_article(article) -> dict:
    """Parse a PubMed article XML element."""
    medline = article.find(".//MedlineCitation")
    if medline is None:
        return {}

    pmid_elem = medline.find(".//PMID")
    pmid = pmid_elem.text if pmid_elem is not None else ""

    article_elem = medline.find(".//Article")
    if article_elem is None:
        return {}

    # Title
    title_elem = article_elem.find(".//ArticleTitle")
    title = title_elem.text if title_elem is not None else ""

    # Abstract
    abstract_parts = []
    for abstract_text in article_elem.findall(".//AbstractText"):
        label = abstract_text.get("Label", "")
        text = abstract_text.text or ""
        if label:
            abstract_parts.append(f"{label}: {text}")
        else:
            abstract_parts.append(text)
    abstract = " ".join(abstract_parts)

    # Authors
    authors = []
    for author in article_elem.findall(".//Author"):
        lastname = author.find("LastName")
        forename = author.find("ForeName")
        if lastname is not None and forename is not None:
            authors.append(f"{forename.text} {lastname.text}")
        elif lastname is not None:
            authors.append(lastname.text)

    # Journal
    journal_elem = article_elem.find(".//Journal/Title")
    journal = journal_elem.text if journal_elem is not None else ""

    # Publication date
    pub_date = ""
    date_elem = article_elem.find(".//PubDate")
    if date_elem is not None:
        year = date_elem.find("Year")
        month = date_elem.find("Month")
        day = date_elem.find("Day")
        if year is not None:
            pub_date = year.text
            if month is not None:
                pub_date = f"{year.text}-{month.text}"
                if day is not None:
                    pub_date = f"{year.text}-{month.text}-{day.text}"

    # MeSH terms
    mesh_terms = []
    for mesh in medline.findall(".//MeshHeading/DescriptorName"):
        if mesh.text:
            mesh_terms.append(mesh.text)

    # Keywords
    keywords = []
    for kw in medline.findall(".//Keyword"):
        if kw.text:
            keywords.append(kw.text)

    return {
        "pmid": pmid,
        "title": title,
        "abstract": abstract,
        "authors": authors,
        "journal": journal,
        "publication_date": pub_date,
        "mesh_terms": mesh_terms,
        "keywords": keywords,
        "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
    }


@tracer.capture_method
def extract_entities_bedrock(title: str, abstract: str) -> dict:
    """Extract biomedical entities using Bedrock Claude."""
    if not abstract:
        return {"genes": [], "proteins": [], "drugs": [], "diseases": [], "pathways": []}

    prompt = f"""Extract biomedical entities from this research article. Return JSON only.

Title: {title}
Abstract: {abstract[:2000]}

Extract these entity types:
- genes: Gene names and symbols
- proteins: Protein names
- drugs: Drug/compound names
- diseases: Disease names
- pathways: Biological pathways

Return ONLY valid JSON like:
{{"genes": ["TP53", "BRCA1"], "proteins": ["p53"], "drugs": ["cisplatin"], "diseases": ["cancer"], "pathways": ["apoptosis"]}}"""

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

        # Extract JSON from response
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])
    except Exception as e:
        logger.warning("Entity extraction failed", error=str(e))

    return {"genes": [], "proteins": [], "drugs": [], "diseases": [], "pathways": []}


@tracer.capture_method
def save_to_knowledge_base(record: dict, entities: dict) -> str:
    """Save record to knowledge base with entities."""
    table = dynamodb.Table(KNOWLEDGE_TABLE)

    content = f"{record.get('title', '')} {record.get('abstract', '')}"
    content_hash = compute_content_hash(content, record.get("title", ""))

    # Check for duplicate
    existing = check_duplicate(content_hash)
    if existing:
        logger.info("Duplicate found, skipping", pmid=record.get("pmid"))
        metrics.add_metric(name="DuplicatesSkipped", unit="Count", value=1)
        return existing.get("id", "")

    record_id = str(uuid4())
    now = datetime.utcnow().isoformat()

    item = {
        "id": record_id,
        "source": "pubmed",
        "source_id": record.get("pmid", ""),
        "content_hash": content_hash,
        "title": record.get("title", ""),
        "content": record.get("abstract", ""),
        "authors": record.get("authors", []),
        "journal": record.get("journal", ""),
        "publication_date": record.get("publication_date", ""),
        "url": record.get("url", ""),
        "mesh_terms": record.get("mesh_terms", []),
        "keywords": record.get("keywords", []),
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
                    "source": "pubmed",
                }),
            )
        except Exception as e:
            logger.warning("Failed to queue embedding", error=str(e))

    return record_id


@tracer.capture_method
def store_raw_data(records: list[dict], query: str) -> str:
    """Store raw fetched data to S3 for auditing."""
    timestamp = datetime.utcnow().strftime("%Y/%m/%d/%H%M%S")
    query_slug = query.replace(" ", "_")[:30]
    key = f"pubmed/{timestamp}_{query_slug}.json"

    try:
        s3.put_object(
            Bucket=RAW_BUCKET,
            Key=key,
            Body=json.dumps({"query": query, "records": records, "fetched_at": datetime.utcnow().isoformat()}),
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
    Lambda handler for PubMed ingestion.

    Can be triggered by:
    - EventBridge schedule (continuous ingestion)
    - API Gateway (on-demand ingestion)
    - Direct invocation with custom query
    """
    # Get query from event or use defaults
    queries = event.get("queries", [])
    if not queries:
        # Single query from event
        query = event.get("query", "")
        if query:
            queries = [query]
        else:
            # Use default queries for scheduled runs
            queries = DEFAULT_QUERIES

    max_results = event.get("max_results", 100)
    extract_entities = event.get("extract_entities", True)

    total_fetched = 0
    total_indexed = 0
    total_duplicates = 0
    results = []

    for query in queries:
        logger.info("Processing query", query=query[:50])

        # Get checkpoint for incremental updates
        checkpoint = get_checkpoint(query)
        start_date = checkpoint.get("last_date")

        # If no checkpoint, start from 30 days ago
        if not start_date:
            start_date = (datetime.utcnow() - timedelta(days=30)).strftime("%Y/%m/%d")

        # Fetch PubMed IDs
        pmids = fetch_pubmed_ids(query, start_date, max_results)

        if not pmids:
            logger.info("No new articles found", query=query[:50])
            continue

        # Fetch details in batches
        for i in range(0, len(pmids), PUBMED_BATCH_SIZE):
            batch = pmids[i:i + PUBMED_BATCH_SIZE]
            articles = fetch_pubmed_details(batch)

            total_fetched += len(articles)

            # Store raw data
            store_raw_data(articles, query)

            # Process each article
            for article in articles:
                if not article.get("abstract"):
                    continue

                # Extract entities if enabled
                entities = {}
                if extract_entities:
                    entities = extract_entities_bedrock(
                        article.get("title", ""),
                        article.get("abstract", ""),
                    )

                # Save to knowledge base
                content_hash = compute_content_hash(
                    article.get("abstract", ""),
                    article.get("title", ""),
                )

                if check_duplicate(content_hash):
                    total_duplicates += 1
                else:
                    record_id = save_to_knowledge_base(article, entities)
                    if record_id:
                        total_indexed += 1

        # Update checkpoint
        today = datetime.utcnow().strftime("%Y/%m/%d")
        save_checkpoint(query, today, len(pmids))

        results.append({
            "query": query,
            "fetched": len(pmids),
            "indexed": total_indexed,
        })

    metrics.add_metric(name="ArticlesFetched", unit="Count", value=total_fetched)
    metrics.add_metric(name="ArticlesIndexed", unit="Count", value=total_indexed)
    metrics.add_metric(name="DuplicatesFound", unit="Count", value=total_duplicates)

    logger.info(
        "PubMed ingestion complete",
        queries=len(queries),
        fetched=total_fetched,
        indexed=total_indexed,
        duplicates=total_duplicates,
    )

    return {
        "statusCode": 200,
        "body": {
            "message": "PubMed ingestion complete",
            "queries_processed": len(queries),
            "total_fetched": total_fetched,
            "total_indexed": total_indexed,
            "duplicates_skipped": total_duplicates,
            "results": results,
        },
    }
