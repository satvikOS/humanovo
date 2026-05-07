"""
RAG Retrieval Lambda Handler

Retrieves relevant knowledge for RAG (Retrieval Augmented Generation)
with hybrid search, caching, and source attribution.
"""

import hashlib
import json
import logging
import os
from datetime import datetime
from typing import Any

import boto3

try:
    from aws_lambda_powertools import Logger, Metrics
    from aws_lambda_powertools.event_handler import APIGatewayHttpResolver, Response
    from aws_lambda_powertools.utilities.typing import LambdaContext
    logger = Logger()
    metrics = Metrics()
except ImportError as _import_err:
    logging.error(f"aws_lambda_powertools import failed: {_import_err}")
    logger = logging.getLogger("rag_retrieval")
    logger.setLevel(logging.DEBUG)

    import re as _re_stub

    class APIGatewayHttpResolver:
        """Stub resolver when powertools is unavailable."""
        def __init__(self):
            self._routes = []
            self.current_event = None
        def _register(self, method, path, func):
            param_names = _re_stub.findall(r'<(\w+)>', path)
            pattern = _re_stub.sub(r'<\w+>', r'([^/]+)', path)
            pattern_re = _re_stub.compile(f'^{pattern}$')
            self._routes.append((method, pattern_re, param_names, func))
        def get(self, path):
            def decorator(func):
                self._register("GET", path, func)
                return func
            return decorator
        def post(self, path):
            def decorator(func):
                self._register("POST", path, func)
                return func
            return decorator
        def patch(self, path):
            def decorator(func):
                self._register("PATCH", path, func)
                return func
            return decorator
        def delete(self, path):
            def decorator(func):
                self._register("DELETE", path, func)
                return func
            return decorator
        def resolve(self, event, context):
            import json as _json
            http = event.get("requestContext", {}).get("http", {})
            method = http.get("method", "GET")
            path = event.get("rawPath", "/").split("?")[0]
            # strip stage prefix
            parts = path.split("/")
            if len(parts) > 1 and parts[1] not in ("api",):
                path = "/" + "/".join(parts[2:])
            class _Evt:
                def __init__(self, ev):
                    self.raw_event = ev
                    self.query_string_parameters = ev.get("queryStringParameters") or {}
                    try:
                        self.json_body = _json.loads(ev.get("body", "{}") or "{}")
                    except Exception:
                        self.json_body = {}
                @property
                def body(self):
                    return self.raw_event.get("body", "")
            self.current_event = _Evt(event)
            for m, pat, params, func in self._routes:
                if m != method:
                    continue
                match = pat.match(path)
                if match:
                    args = match.groups()
                    kwargs = dict(zip(params, args))
                    result = func(**kwargs)
                    if isinstance(result, dict) or isinstance(result, list):
                        return {"statusCode": 200, "headers": {"Content-Type": "application/json"}, "body": _json.dumps(result, default=str)}
                    if hasattr(result, "status_code"):
                        return {"statusCode": result.status_code, "headers": {"Content-Type": getattr(result, "content_type", "application/json")}, "body": result.body if isinstance(result.body, str) else _json.dumps(result.body, default=str)}
                    return {"statusCode": 200, "headers": {"Content-Type": "application/json"}, "body": _json.dumps(result, default=str)}
            return {"statusCode": 404, "headers": {"Content-Type": "application/json"}, "body": _json.dumps({"detail": f"Not found: {method} {path}"})}

    class Response:
        def __init__(self, status_code=200, body="", content_type="application/json", headers=None):
            self.status_code = status_code
            self.body = body
            self.content_type = content_type

    LambdaContext = object

    class _NoopMetrics:
        def add_metric(self, **kwargs): pass
        def log_metrics(self, **kwargs):
            def decorator(func): return func
            return decorator
    metrics = _NoopMetrics()

app = APIGatewayHttpResolver()

# AWS Clients
dynamodb = boto3.resource("dynamodb")
elasticache = None  # Lazy init for Redis
bedrock_runtime = boto3.client("bedrock-runtime")
opensearch = None  # Lazy init

# Configuration
KNOWLEDGE_TABLE = os.environ.get("KNOWLEDGE_TABLE", "genup-dev-knowledge")
EMBEDDINGS_TABLE = os.environ.get("EMBEDDINGS_TABLE", "genup-dev-embeddings")
CACHE_TABLE = os.environ.get("CACHE_TABLE", "genup-dev-rag-cache")
OPENSEARCH_ENDPOINT = os.environ.get("OPENSEARCH_ENDPOINT", "")
OPENSEARCH_INDEX = os.environ.get("OPENSEARCH_INDEX", "genup-knowledge")
REDIS_ENDPOINT = os.environ.get("REDIS_ENDPOINT", "")
EMBEDDING_MODEL_ID = os.environ.get("EMBEDDING_MODEL_ID", "amazon.titan-embed-text-v2:0")
EMBEDDING_DIMENSION = 1024

# Cache settings
CACHE_TTL_SECONDS = 3600  # 1 hour
MAX_CACHED_RESULTS = 100


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


def get_redis_client():
    """Get or create Redis client."""
    global elasticache
    if elasticache is None and REDIS_ENDPOINT:
        import redis

        elasticache = redis.Redis(
            host=REDIS_ENDPOINT,
            port=6379,
            decode_responses=True,
            socket_timeout=5,
        )
    return elasticache


def compute_cache_key(query: str, filters: dict, k: int) -> str:
    """Compute cache key for query."""
    key_data = f"{query}|{json.dumps(filters, sort_keys=True)}|{k}"
    return f"rag:{hashlib.md5(key_data.encode()).hexdigest()}"


def get_cached_results(cache_key: str) -> list[dict] | None:
    """Get cached results from Redis or DynamoDB."""
    # Try Redis first
    redis_client = get_redis_client()
    if redis_client:
        try:
            cached = redis_client.get(cache_key)
            if cached:
                metrics.add_metric(name="CacheHits", unit="Count", value=1)
                return json.loads(cached)
        except Exception as e:
            logger.warning("Redis cache read failed", error=str(e))

    # Fall back to DynamoDB cache
    table = dynamodb.Table(CACHE_TABLE)
    try:
        response = table.get_item(Key={"cache_key": cache_key})
        item = response.get("Item")
        if item:
            # Check TTL
            expires = item.get("expires_at", "")
            if expires and datetime.fromisoformat(expires) > datetime.utcnow():
                metrics.add_metric(name="CacheHits", unit="Count", value=1)
                return item.get("results", [])
    except Exception as e:
        logger.warning("DynamoDB cache read failed", error=str(e))

    metrics.add_metric(name="CacheMisses", unit="Count", value=1)
    return None


def set_cached_results(cache_key: str, results: list[dict]) -> None:
    """Cache results in Redis and DynamoDB."""
    # Limit cached results
    cached_results = results[:MAX_CACHED_RESULTS]

    # Cache in Redis
    redis_client = get_redis_client()
    if redis_client:
        try:
            redis_client.setex(
                cache_key,
                CACHE_TTL_SECONDS,
                json.dumps(cached_results),
            )
        except Exception as e:
            logger.warning("Redis cache write failed", error=str(e))

    # Also cache in DynamoDB for persistence
    table = dynamodb.Table(CACHE_TABLE)
    try:
        expires = datetime.utcnow().isoformat()
        table.put_item(
            Item={
                "cache_key": cache_key,
                "results": cached_results,
                "created_at": datetime.utcnow().isoformat(),
                "expires_at": expires,
            }
        )
    except Exception as e:
        logger.warning("DynamoDB cache write failed", error=str(e))


def generate_query_embedding(query: str) -> list[float]:
    """Generate embedding for query."""
    try:
        response = bedrock_runtime.invoke_model(
            modelId=EMBEDDING_MODEL_ID,
            contentType="application/json",
            accept="application/json",
            body=json.dumps({
                "inputText": query[:8000],
                "dimensions": EMBEDDING_DIMENSION,
                "normalize": True,
            }),
        )

        response_body = json.loads(response["body"].read())
        return response_body.get("embedding", [])
    except Exception as e:
        logger.error("Query embedding failed", error=str(e))
        return []


def vector_search_opensearch(
    embedding: list[float],
    k: int = 10,
    filters: dict | None = None,
) -> list[dict]:
    """Perform vector search in OpenSearch."""
    client = get_opensearch_client()
    if not client:
        return []

    # Build query
    knn_query = {
        "knn": {
            "embedding": {
                "vector": embedding,
                "k": k,
            }
        }
    }

    # Add filters if provided
    if filters:
        filter_clauses = []
        if filters.get("source"):
            filter_clauses.append({"term": {"source": filters["source"]}})
        if filters.get("date_from"):
            filter_clauses.append({"range": {"publication_date": {"gte": filters["date_from"]}}})
        if filters.get("date_to"):
            filter_clauses.append({"range": {"publication_date": {"lte": filters["date_to"]}}})

        if filter_clauses:
            knn_query = {
                "bool": {
                    "must": [knn_query],
                    "filter": filter_clauses,
                }
            }

    try:
        response = client.search(
            index=OPENSEARCH_INDEX,
            body={
                "size": k,
                "query": knn_query,
                "_source": ["content", "title", "source", "source_id", "entities", "publication_date"],
            },
        )

        results = []
        for hit in response.get("hits", {}).get("hits", []):
            source = hit.get("_source", {})
            results.append({
                "id": hit.get("_id"),
                "score": hit.get("_score", 0),
                "title": source.get("title", ""),
                "content": source.get("content", ""),
                "source": source.get("source", ""),
                "source_id": source.get("source_id", ""),
                "publication_date": source.get("publication_date", ""),
                "entities": source.get("entities", {}),
            })

        return results
    except Exception as e:
        logger.error("OpenSearch vector search failed", error=str(e))
        return []


def keyword_search_dynamodb(
    query: str,
    k: int = 10,
    filters: dict | None = None,
) -> list[dict]:
    """Perform keyword search in DynamoDB (fallback)."""
    table = dynamodb.Table(KNOWLEDGE_TABLE)

    # Simple scan with keyword matching (production should use OpenSearch)
    scan_params = {"Limit": k * 3}

    if filters and filters.get("source"):
        scan_params["FilterExpression"] = "#s = :source"
        scan_params["ExpressionAttributeNames"] = {"#s": "source"}
        scan_params["ExpressionAttributeValues"] = {":source": filters["source"]}

    try:
        response = table.scan(**scan_params)
        items = response.get("Items", [])

        # Score by keyword match
        query_terms = set(query.lower().split())
        scored = []

        for item in items:
            content = f"{item.get('title', '')} {item.get('content', '')}".lower()
            matches = sum(1 for term in query_terms if term in content)
            if matches > 0:
                scored.append((matches / len(query_terms), item))

        scored.sort(key=lambda x: x[0], reverse=True)

        return [
            {
                "id": item.get("id"),
                "score": score,
                "title": item.get("title", ""),
                "content": item.get("content", "")[:2000],
                "source": item.get("source", ""),
                "source_id": item.get("source_id", ""),
                "publication_date": item.get("publication_date", ""),
                "entities": item.get("entities", {}),
            }
            for score, item in scored[:k]
        ]
    except Exception as e:
        logger.error("DynamoDB keyword search failed", error=str(e))
        return []


def hybrid_search(
    query: str,
    k: int = 10,
    filters: dict | None = None,
    vector_weight: float = 0.7,
) -> list[dict]:
    """Perform hybrid search combining vector and keyword search."""
    results = {}

    # Vector search
    embedding = generate_query_embedding(query)
    if embedding:
        vector_results = vector_search_opensearch(embedding, k * 2, filters)
        for r in vector_results:
            rid = r["id"]
            results[rid] = r
            results[rid]["vector_score"] = r["score"]
            results[rid]["keyword_score"] = 0

    # Keyword search
    keyword_results = keyword_search_dynamodb(query, k * 2, filters)
    for r in keyword_results:
        rid = r["id"]
        if rid in results:
            results[rid]["keyword_score"] = r["score"]
        else:
            results[rid] = r
            results[rid]["vector_score"] = 0
            results[rid]["keyword_score"] = r["score"]

    # Combine scores
    for rid in results:
        vs = results[rid].get("vector_score", 0)
        ks = results[rid].get("keyword_score", 0)
        # Normalize and combine
        results[rid]["combined_score"] = (vector_weight * vs) + ((1 - vector_weight) * ks)

    # Sort by combined score
    sorted_results = sorted(
        results.values(),
        key=lambda x: x.get("combined_score", 0),
        reverse=True,
    )

    return sorted_results[:k]


def format_for_rag(results: list[dict], max_tokens: int = 4000) -> str:
    """Format results for RAG context."""
    context_parts = []
    current_tokens = 0

    for i, result in enumerate(results):
        title = result.get("title", "Untitled")
        source = result.get("source", "unknown").upper()
        source_id = result.get("source_id", "")
        content = result.get("content", "")[:1500]

        # Build source attribution
        attribution = f"[{source}"
        if source_id:
            attribution += f": {source_id}"
        attribution += "]"

        part = f"""
---
Source {i + 1} {attribution}
Title: {title}
{content}
---
"""
        # Rough token estimate (1 token ≈ 4 chars)
        part_tokens = len(part) // 4
        if current_tokens + part_tokens > max_tokens:
            break

        context_parts.append(part)
        current_tokens += part_tokens

    return "\n".join(context_parts)


@app.post("/api/v1/rag/retrieve")
def retrieve():
    """Retrieve relevant context for RAG."""
    body = app.current_event.json_body or {}

    query = body.get("query", "")
    k = min(body.get("k", 10), 50)
    filters = body.get("filters", {})
    use_cache = body.get("use_cache", True)
    format_output = body.get("format", "list")  # list, rag, or raw

    if not query:
        return {"error": "Query is required"}, 400

    logger.info("RAG retrieval", query=query[:50], k=k)
    metrics.add_metric(name="RetrievalRequests", unit="Count", value=1)

    # Check cache
    cache_key = compute_cache_key(query, filters, k)
    if use_cache:
        cached = get_cached_results(cache_key)
        if cached:
            logger.info("Returning cached results", count=len(cached))
            if format_output == "rag":
                return {"context": format_for_rag(cached), "sources": len(cached)}
            return {"results": cached, "cached": True}

    # Perform hybrid search
    results = hybrid_search(query, k, filters)

    # Cache results
    if results:
        set_cached_results(cache_key, results)

    metrics.add_metric(name="ResultsReturned", unit="Count", value=len(results))

    if format_output == "rag":
        return {
            "context": format_for_rag(results),
            "sources": len(results),
            "source_ids": [r.get("source_id") for r in results],
        }

    return {"results": results, "cached": False}


@app.post("/api/v1/rag/ask")
def ask():
    """Answer a question using RAG."""
    body = app.current_event.json_body or {}

    question = body.get("question", "")
    k = min(body.get("k", 10), 30)
    filters = body.get("filters", {})

    if not question:
        return {"error": "Question is required"}, 400

    logger.info("RAG question", question=question[:50])
    metrics.add_metric(name="RAGQuestions", unit="Count", value=1)

    # Retrieve context
    results = hybrid_search(question, k, filters)
    context = format_for_rag(results)

    # Generate answer with Bedrock
    prompt = f"""Based on the following biomedical research sources, answer the question.
If the information is not in the sources, say so clearly.
Always cite your sources using the source numbers provided.

SOURCES:
{context}

QUESTION: {question}

Provide a comprehensive, evidence-based answer with citations:"""

    try:
        response = bedrock_runtime.invoke_model(
            modelId="anthropic.claude-3-5-sonnet-20241022-v2:0",
            contentType="application/json",
            accept="application/json",
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 2000,
                "temperature": 0.3,
                "messages": [{"role": "user", "content": prompt}],
            }),
        )

        response_body = json.loads(response["body"].read())
        answer = response_body["content"][0]["text"]

        return {
            "answer": answer,
            "sources": [
                {
                    "title": r.get("title"),
                    "source": r.get("source"),
                    "source_id": r.get("source_id"),
                }
                for r in results
            ],
            "sources_count": len(results),
        }

    except Exception as e:
        logger.error("RAG answer generation failed", error=str(e))
        return {"error": "Failed to generate answer", "context": context}, 500


@app.post("/api/v1/rag/invalidate-cache")
def invalidate_cache():
    """Invalidate cached results for a query."""
    body = app.current_event.json_body or {}

    query = body.get("query", "")
    invalidate_all = body.get("invalidate_all", False)

    if invalidate_all:
        # Clear all cache (Redis only - DynamoDB has TTL)
        redis_client = get_redis_client()
        if redis_client:
            try:
                keys = redis_client.keys("rag:*")
                if keys:
                    redis_client.delete(*keys)
                return {"message": f"Invalidated {len(keys)} cached queries"}
            except Exception as e:
                logger.error("Cache invalidation failed", error=str(e))
                return {"error": str(e)}, 500

        return {"message": "Redis not configured"}

    if not query:
        return {"error": "Query is required"}, 400

    cache_key = compute_cache_key(query, {}, 10)
    redis_client = get_redis_client()
    if redis_client:
        redis_client.delete(cache_key)

    return {"message": "Cache invalidated", "key": cache_key}


def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """Lambda handler entry point."""
    try:
        return app.resolve(event, context)
    except Exception as e:
        import json
        import traceback
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"detail": f"Internal error: {str(e)}", "traceback": traceback.format_exc()}),
        }
