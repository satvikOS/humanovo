"""
Hypothesis Generation Lambda Handler

Generates biomedical hypotheses using AWS Bedrock (Claude) with RAG.
"""

import json
import logging
import os
import traceback
from datetime import datetime
from typing import Any
from uuid import uuid4

import boto3

try:
    from aws_lambda_powertools import Logger, Metrics
    from aws_lambda_powertools.event_handler import APIGatewayHttpResolver, Response
    from aws_lambda_powertools.utilities.typing import LambdaContext
    logger = Logger()
    metrics = Metrics()
except ImportError as _import_err:
    logging.error(f"aws_lambda_powertools import failed: {_import_err}")
    logger = logging.getLogger("hypothesis_generation")
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
bedrock_runtime = boto3.client("bedrock-runtime")
dynamodb = boto3.resource("dynamodb")

# Configuration
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "anthropic.claude-3-5-sonnet-20241022-v2:0")
HYPOTHESES_TABLE = os.environ.get("HYPOTHESES_TABLE", "genup-dev-hypotheses")
EVIDENCE_TABLE = os.environ.get("EVIDENCE_TABLE", "genup-dev-evidence")


def invoke_bedrock(prompt: str, max_tokens: int = 2000) -> str:
    """Invoke AWS Bedrock with Claude model."""
    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": max_tokens,
        "temperature": 0.7,
        "messages": [{"role": "user", "content": prompt}],
        "system": """You are a biomedical research assistant specialized in generating novel,
scientifically grounded hypotheses. Your hypotheses should be:
1. Testable and specific
2. Based on provided evidence
3. Novel but plausible
4. Include a clear mechanism
5. Reference supporting evidence

Format each hypothesis with:
- HYPOTHESIS: Clear statement
- MECHANISM: Proposed biological mechanism
- RATIONALE: Evidence-based reasoning
- CONFIDENCE: Low/Medium/High
""",
    }

    response = bedrock_runtime.invoke_model(
        modelId=BEDROCK_MODEL_ID,
        contentType="application/json",
        accept="application/json",
        body=json.dumps(body),
    )

    response_body = json.loads(response["body"].read())
    return response_body["content"][0]["text"]


def retrieve_evidence(query: str, project_id: str = None, limit: int = 10) -> list[dict]:
    """Retrieve relevant evidence from DynamoDB."""
    table = dynamodb.Table(EVIDENCE_TABLE)

    # Simple scan with filter (in production, use OpenSearch for vector search)
    scan_params = {"Limit": limit * 2}

    if project_id:
        scan_params["FilterExpression"] = "project_id = :pid"
        scan_params["ExpressionAttributeValues"] = {":pid": project_id}

    response = table.scan(**scan_params)
    items = response.get("Items", [])

    # Basic relevance scoring (in production, use embeddings)
    query_terms = set(query.lower().split())
    scored_items = []

    for item in items:
        content = item.get("content", "").lower()
        title = item.get("title", "").lower()
        score = sum(1 for term in query_terms if term in content or term in title)
        if score > 0:
            scored_items.append((score, item))

    scored_items.sort(key=lambda x: x[0], reverse=True)
    return [item for _, item in scored_items[:limit]]


def parse_hypotheses(response_text: str) -> list[dict]:
    """Parse LLM response into structured hypotheses."""
    hypotheses = []
    current = {}

    for line in response_text.split("\n"):
        line = line.strip()
        if line.startswith("HYPOTHESIS:"):
            if current.get("statement"):
                hypotheses.append(current)
            current = {"statement": line.replace("HYPOTHESIS:", "").strip()}
        elif line.startswith("MECHANISM:"):
            current["mechanism"] = line.replace("MECHANISM:", "").strip()
        elif line.startswith("RATIONALE:"):
            current["rationale"] = line.replace("RATIONALE:", "").strip()
        elif line.startswith("CONFIDENCE:"):
            conf = line.replace("CONFIDENCE:", "").strip().lower()
            current["confidence_score"] = {"low": 0.3, "medium": 0.6, "high": 0.85}.get(conf, 0.5)
        elif current and line and "statement" in current:
            # Continue previous field
            if "rationale" in current:
                current["rationale"] += " " + line
            elif "mechanism" in current:
                current["mechanism"] += " " + line
            else:
                current["statement"] += " " + line

    if current.get("statement"):
        hypotheses.append(current)

    return hypotheses


def save_hypothesis(hypothesis: dict, project_id: str, evidence_ids: list[str]) -> dict:
    """Save hypothesis to DynamoDB."""
    table = dynamodb.Table(HYPOTHESES_TABLE)

    now = datetime.utcnow().isoformat()
    hypothesis_id = str(uuid4())

    item = {
        "id": hypothesis_id,
        "project_id": project_id,
        "statement": hypothesis.get("statement", ""),
        "mechanism": hypothesis.get("mechanism", ""),
        "rationale": hypothesis.get("rationale", ""),
        "confidence_score": hypothesis.get("confidence_score", 0.5),
        "novelty_score": hypothesis.get("novelty_score", 0.5),
        "status": "generated",
        "evidence_ids": evidence_ids,
        "created_at": now,
        "updated_at": now,
    }

    table.put_item(Item=item)
    return item


@app.post("/api/v1/hypotheses/generate")
def generate_hypotheses():
    """Generate hypotheses based on a research query."""
    body = app.current_event.json_body or {}

    query = body.get("query", "")
    project_id = body.get("project_id", "")
    max_hypotheses = min(body.get("max_hypotheses", 5), 10)
    focus_entities = body.get("focus_entities", [])

    if not query:
        return {"error": "Query is required"}, 400

    logger.info("Generating hypotheses", query=query[:100], project_id=project_id)
    metrics.add_metric(name="HypothesisGenerationRequests", unit="Count", value=1)

    # Retrieve relevant evidence
    evidence = retrieve_evidence(query, project_id, limit=15)
    evidence_ids = [e.get("id", "") for e in evidence]

    # Build prompt with evidence
    evidence_text = "\n".join(
        [
            f"- [{e.get('source_type', 'unknown')}] {e.get('title', 'Untitled')}: {e.get('content', '')[:300]}"
            for e in evidence[:10]
        ]
    )

    entities_text = ""
    if focus_entities:
        entities_text = f"\nFocus on these entities: {', '.join(focus_entities)}"

    prompt = f"""Research Question: {query}
{entities_text}

Available Evidence:
{evidence_text if evidence_text else "No specific evidence available. Generate hypotheses based on general biomedical knowledge."}

Generate {max_hypotheses} novel, testable hypotheses that address the research question.
Each hypothesis should propose a specific mechanism and cite the relevant evidence."""

    # Generate with Bedrock
    response_text = invoke_bedrock(prompt, max_tokens=3000)

    # Parse response
    hypotheses_data = parse_hypotheses(response_text)

    # Save hypotheses
    saved_hypotheses = []
    for h in hypotheses_data[:max_hypotheses]:
        h["novelty_score"] = 0.6  # Default novelty score
        saved = save_hypothesis(h, project_id, evidence_ids)
        saved_hypotheses.append(saved)

    metrics.add_metric(name="HypothesesGenerated", unit="Count", value=len(saved_hypotheses))

    return {
        "hypotheses": saved_hypotheses,
        "evidence_used": len(evidence),
        "query": query,
    }


def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """Lambda handler entry point."""
    try:
        return app.resolve(event, context)
    except Exception as e:
        import json, traceback
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"detail": f"Internal error: {str(e)}", "traceback": traceback.format_exc()}),
        }
