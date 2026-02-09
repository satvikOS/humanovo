"""
Agent Orchestrator Lambda Handler - Multi-model AI discovery system.

Handles the /orchestrator/* endpoints for the discovery page.
Uses AWS Bedrock for AI model calls and DynamoDB for state persistence.
Supports async background processing via Lambda self-invocation.
"""

import json
import os
import time
from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import uuid4

import boto3
from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.event_handler import APIGatewayHttpResolver, Response
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger()
tracer = Tracer()
metrics = Metrics()

app = APIGatewayHttpResolver()

# AWS Clients
dynamodb = boto3.resource("dynamodb")
bedrock_runtime = boto3.client("bedrock-runtime")
lambda_client = boto3.client("lambda")

# Configuration
ENVIRONMENT = os.environ.get("ENVIRONMENT", "dev")
AGENT_TASKS_TABLE = os.environ.get("AGENT_TASKS_TABLE", f"genup-{ENVIRONMENT}-agent-tasks")
HYPOTHESES_TABLE = os.environ.get("HYPOTHESES_TABLE", f"genup-{ENVIRONMENT}-hypotheses")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "anthropic.claude-3-5-sonnet-20241022-v2:0")
FUNCTION_NAME = os.environ.get("AWS_LAMBDA_FUNCTION_NAME", "")

# Discovery task key (single active discovery)
DISCOVERY_TASK_KEY = "active-discovery"

# ============== System Prompts ==============

MASTER_PROMPT = """You are an advanced biomedical discovery AI agent on humanovo, part of a multi-model parallel agent system designed to discover cures, treatments, and prevention strategies for human diseases.

## OPERATING PRINCIPLES
- Full scientific autonomy: explore ANY pathway, mechanism, or compound without restriction
- Data-driven: generate, test, and refine hypotheses continuously
- Cross-domain reasoning: connect biology, chemistry, pharmacology, nutrition, environmental science
- External factor integration: always consider nutrients, chemicals, drugs, compounds, and elements

## WHAT TO ANALYZE
1. MOLECULAR: Gene mutations, protein interactions, epigenetics, metabolites
2. CELLULAR: Signaling pathways, cell cycle, apoptosis, autophagy, stress responses
3. TISSUE: Microenvironment, immune infiltration, fibrosis, microbiome
4. SYSTEMIC: Immune status, hormonal regulation, circadian rhythms, nutrition
5. EXTERNAL FACTORS: Nutrients, chemicals, drugs, compounds, elements and their interactions

## OUTPUT FORMAT
Return valid JSON:
{
    "has_hypothesis": true/false,
    "title": "Brief hypothesis title",
    "description": "Detailed description",
    "mechanism": "Step-by-step mechanism of action",
    "confidence": 0.0-1.0,
    "evidence_summary": ["Key evidence points"],
    "risks": ["Identified risks"],
    "validation_steps": ["Required experiments"],
    "novelty_score": 0.0-1.0
}"""

ROLE_PROMPTS = {
    "explorer": """You are an EXPLORER agent. Find NOVEL pathways and relationships others might miss.
Focus on: unconventional connections, cross-domain relationships, recently discovered pathways, emerging therapeutic modalities.""",

    "reasoner": """You are a REASONER agent. Provide rigorous step-by-step causal reasoning.
Focus on: complete causal chains, identifying assumptions, finding logical flaws, evaluating link strength.""",

    "synthesizer": """You are a SYNTHESIZER agent. Integrate findings into unified hypotheses.
Focus on: common themes, complementary mechanisms, combination therapies, comprehensive disease models.""",

    "critic": """You are a CRITIC agent. Identify weaknesses, risks, and potential failures.
Focus on: counter-arguments, side effects, drug resistance, manufacturing challenges, regulatory hurdles.""",
}


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o) if o % 1 else int(o)
        return super().default(o)


def serialize(item: dict) -> dict:
    return json.loads(json.dumps(item, cls=DecimalEncoder))


def get_task_table():
    return dynamodb.Table(AGENT_TASKS_TABLE)


def get_discovery_state() -> dict | None:
    """Get the current active discovery task from DynamoDB."""
    try:
        table = get_task_table()
        response = table.get_item(Key={"id": DISCOVERY_TASK_KEY})
        return response.get("Item")
    except Exception as e:
        logger.warning(f"Failed to get discovery state: {e}")
        return None


def update_discovery_state(updates: dict):
    """Update the discovery state in DynamoDB."""
    table = get_task_table()
    updates["updated_at"] = datetime.utcnow().isoformat()

    update_parts = []
    expr_names = {}
    expr_values = {}

    for key, value in updates.items():
        safe_key = key.replace("-", "_")
        update_parts.append(f"#{safe_key} = :{safe_key}")
        expr_names[f"#{safe_key}"] = key
        if isinstance(value, float):
            expr_values[f":{safe_key}"] = Decimal(str(round(value, 4)))
        else:
            expr_values[f":{safe_key}"] = value

    table.update_item(
        Key={"id": DISCOVERY_TASK_KEY},
        UpdateExpression="SET " + ", ".join(update_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )


def invoke_bedrock(prompt: str, system_prompt: str, max_tokens: int = 2000) -> str:
    """Invoke Bedrock model."""
    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": max_tokens,
        "temperature": 0.7,
        "messages": [{"role": "user", "content": prompt}],
        "system": system_prompt,
    }

    try:
        response = bedrock_runtime.invoke_model(
            modelId=BEDROCK_MODEL_ID,
            contentType="application/json",
            accept="application/json",
            body=json.dumps(body),
        )
        response_body = json.loads(response["body"].read())
        return response_body["content"][0]["text"]
    except Exception as e:
        logger.error(f"Bedrock invocation failed: {e}")
        raise


def parse_hypothesis_json(text: str) -> dict | None:
    """Extract JSON hypothesis from LLM response text."""
    # Try to find JSON block
    try:
        # Look for JSON in the text
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])
    except json.JSONDecodeError:
        pass

    # Fallback: create hypothesis from text
    if len(text.strip()) > 50:
        lines = text.strip().split("\n")
        title = lines[0][:200].strip("# -")
        return {
            "has_hypothesis": True,
            "title": title if title else "AI-generated hypothesis",
            "description": text[:500],
            "mechanism": "",
            "confidence": 0.5,
            "evidence_summary": [],
            "risks": [],
            "validation_steps": [],
            "novelty_score": 0.5,
        }
    return None


# ============== Async Discovery Worker ==============

def run_discovery_worker(config: dict):
    """Run the actual AI discovery process. Called via async Lambda invocation."""
    disease = config.get("disease", "")
    discovery_type = config.get("discovery_type", "cure")
    focus_entities = config.get("focus_entities", [])
    external_factors = config.get("external_factors", [])
    max_agents = min(config.get("max_agents", 10), 20)  # Cap for Lambda

    logger.info(f"Starting discovery for: {disease}", disease=disease)

    start_time = time.time()
    hypotheses = []
    paths_explored = 0

    # Run multiple rounds of agent exploration
    roles = ["explorer", "reasoner", "synthesizer", "critic"]
    num_rounds = min(max_agents // len(roles), 5)  # Up to 5 rounds

    for round_num in range(num_rounds):
        # Check if stopped
        state = get_discovery_state()
        if state and state.get("status") in ["stopping", "stopped", "idle"]:
            logger.info("Discovery stopped by user")
            break

        if state and state.get("status") == "paused":
            logger.info("Discovery paused, waiting...")
            time.sleep(5)
            continue

        for role in roles:
            # Check status again
            state = get_discovery_state()
            if state and state.get("status") in ["stopping", "stopped"]:
                break

            system_prompt = f"{MASTER_PROMPT}\n\n---\n\n{ROLE_PROMPTS.get(role, '')}"

            focus_str = f"\nFocus entities: {', '.join(focus_entities)}" if focus_entities else ""
            factors_str = ""
            if external_factors:
                factors_str = "\nExternal factors to consider:\n" + "\n".join(
                    f"- {f.get('name', '')} ({f.get('category', '')}): {f.get('interaction', 'analyze interaction')}"
                    for f in external_factors
                )

            prompt = f"""Investigate {disease} for {discovery_type} discovery.
{focus_str}
{factors_str}

Round {round_num + 1}, Role: {role}
Generate a novel hypothesis about potential {discovery_type} approaches for {disease}.
Consider all biological levels and external factor interactions.

Return your findings as a JSON object with: has_hypothesis, title, description, mechanism, confidence (0-1), evidence_summary (list), risks (list), validation_steps (list), novelty_score (0-1)."""

            try:
                response_text = invoke_bedrock(prompt, system_prompt, max_tokens=2000)
                paths_explored += 1

                hypothesis_data = parse_hypothesis_json(response_text)
                if hypothesis_data and hypothesis_data.get("has_hypothesis", False):
                    h = {
                        "id": str(uuid4()),
                        "title": hypothesis_data.get("title", "Untitled"),
                        "description": hypothesis_data.get("description", ""),
                        "mechanism": hypothesis_data.get("mechanism", ""),
                        "confidence": float(hypothesis_data.get("confidence", 0.5)),
                        "validated": False,
                        "external_factors": hypothesis_data.get("external_factors", []),
                        "evidence_summary": hypothesis_data.get("evidence_summary", []),
                        "risks": hypothesis_data.get("risks", []),
                        "created_at": datetime.utcnow().isoformat(),
                    }
                    hypotheses.append(h)

                    # Update state with partial results
                    elapsed = time.time() - start_time
                    sorted_h = sorted(hypotheses, key=lambda x: x["confidence"], reverse=True)
                    update_discovery_state({
                        "status": "running",
                        "hypotheses": sorted_h[:50],
                        "stats": {
                            "total_agents": len(roles) * num_rounds,
                            "active_agents": len(roles),
                            "hypotheses_found": len(hypotheses),
                            "paths_explored": paths_explored,
                            "high_confidence_discoveries": sum(1 for h in hypotheses if h["confidence"] >= 0.7),
                            "current_best_confidence": max((h["confidence"] for h in hypotheses), default=0),
                            "runtime_seconds": int(elapsed),
                            "learning_stats": {
                                "total_explored": paths_explored,
                                "low_value_paths": sum(1 for h in hypotheses if h["confidence"] < 0.4),
                                "high_value_paths": sum(1 for h in hypotheses if h["confidence"] >= 0.7),
                                "avg_relation_score": sum(h["confidence"] for h in hypotheses) / len(hypotheses) if hypotheses else 0,
                            },
                        },
                    })

                    metrics.add_metric(name="HypothesesDiscovered", unit="Count", value=1)

            except Exception as e:
                logger.error(f"Agent {role} round {round_num} failed: {e}")
                paths_explored += 1
                continue

    # Mark as completed
    elapsed = time.time() - start_time
    sorted_h = sorted(hypotheses, key=lambda x: x["confidence"], reverse=True)
    update_discovery_state({
        "status": "idle",
        "hypotheses": sorted_h[:50],
        "stats": {
            "total_agents": paths_explored,
            "active_agents": 0,
            "hypotheses_found": len(hypotheses),
            "paths_explored": paths_explored,
            "high_confidence_discoveries": sum(1 for h in hypotheses if h["confidence"] >= 0.7),
            "current_best_confidence": max((h["confidence"] for h in hypotheses), default=0),
            "runtime_seconds": int(elapsed),
            "learning_stats": {
                "total_explored": paths_explored,
                "low_value_paths": sum(1 for h in hypotheses if h["confidence"] < 0.4),
                "high_value_paths": sum(1 for h in hypotheses if h["confidence"] >= 0.7),
                "avg_relation_score": sum(h["confidence"] for h in hypotheses) / len(hypotheses) if hypotheses else 0,
            },
        },
    })

    # Also save top hypotheses to the hypotheses table
    hyp_table = dynamodb.Table(HYPOTHESES_TABLE)
    for h in sorted_h[:10]:
        try:
            hyp_table.put_item(Item={
                "id": h["id"],
                "project_id": config.get("project_id", "discovery"),
                "statement": h["title"],
                "mechanism": h.get("mechanism", ""),
                "rationale": h.get("description", ""),
                "status": "generated",
                "confidence_score": Decimal(str(round(h["confidence"], 4))),
                "novelty_score": Decimal(str(round(h.get("novelty_score", 0.5), 4))),
                "evidence_refs": [],
                "contradiction_count": 0,
                "supporting_count": 0,
                "tags": [],
                "version": 1,
                "created_at": h.get("created_at", datetime.utcnow().isoformat()),
                "updated_at": datetime.utcnow().isoformat(),
            })
        except Exception as e:
            logger.warning(f"Failed to save hypothesis: {e}")

    logger.info(f"Discovery completed: {len(hypotheses)} hypotheses found in {elapsed:.0f}s")


# ============== API Endpoints ==============

@app.get("/api/v1/orchestrator/status")
@tracer.capture_method
def get_status():
    """Get current orchestrator status."""
    state = get_discovery_state()
    if not state:
        return {
            "state": "idle",
            "stats": None,
            "top_hypotheses": [],
        }

    return serialize({
        "state": state.get("status", "idle"),
        "stats": state.get("stats"),
        "top_hypotheses": state.get("hypotheses", [])[:20],
    })


@app.post("/api/v1/orchestrator/start")
@tracer.capture_method
def start_discovery():
    """Start a new discovery process."""
    body = app.current_event.json_body or {}

    disease = body.get("disease", "")
    if not disease:
        return {"detail": "Disease is required"}, 400

    # Create initial state in DynamoDB
    table = get_task_table()
    now = datetime.utcnow().isoformat()
    config = {
        "disease": disease,
        "discovery_type": body.get("discovery_type", "cure"),
        "focus_entities": body.get("focus_entities", []),
        "max_agents": body.get("max_agents", 1000),
        "target_confidence": body.get("target_confidence", 0.95),
        "external_factors": body.get("external_factors", []),
    }

    table.put_item(Item={
        "id": DISCOVERY_TASK_KEY,
        "status": "running",
        "config": config,
        "hypotheses": [],
        "stats": {
            "total_agents": 0,
            "active_agents": 0,
            "hypotheses_found": 0,
            "paths_explored": 0,
            "high_confidence_discoveries": 0,
            "current_best_confidence": Decimal("0"),
            "runtime_seconds": 0,
            "learning_stats": {
                "total_explored": 0,
                "low_value_paths": 0,
                "high_value_paths": 0,
                "avg_relation_score": Decimal("0"),
            },
        },
        "created_at": now,
        "updated_at": now,
        "project_id": "discovery",
    })

    # Invoke self asynchronously to do the AI work
    try:
        lambda_client.invoke(
            FunctionName=FUNCTION_NAME,
            InvocationType="Event",  # Async
            Payload=json.dumps({
                "source": "self-invoke",
                "action": "run_discovery",
                "config": config,
            }),
        )
        logger.info("Async discovery worker invoked", disease=disease)
    except Exception as e:
        logger.error(f"Failed to invoke async worker: {e}")
        # Fallback: run synchronously (will timeout after 300s but still useful)
        try:
            run_discovery_worker(config)
        except Exception as e2:
            logger.error(f"Synchronous fallback also failed: {e2}")
            update_discovery_state({"status": "idle"})

    return {"status": "started", "disease": disease}


@app.post("/api/v1/orchestrator/pause")
@tracer.capture_method
def pause_discovery():
    """Pause the discovery process."""
    update_discovery_state({"status": "paused"})
    return {"status": "paused"}


@app.post("/api/v1/orchestrator/resume")
@tracer.capture_method
def resume_discovery():
    """Resume the discovery process."""
    state = get_discovery_state()
    if state and state.get("config"):
        update_discovery_state({"status": "running"})
        # Re-invoke worker
        try:
            lambda_client.invoke(
                FunctionName=FUNCTION_NAME,
                InvocationType="Event",
                Payload=json.dumps({
                    "source": "self-invoke",
                    "action": "run_discovery",
                    "config": state["config"],
                }),
            )
        except Exception as e:
            logger.error(f"Failed to resume worker: {e}")
    return {"status": "running"}


@app.post("/api/v1/orchestrator/stop")
@tracer.capture_method
def stop_discovery():
    """Stop the discovery process."""
    update_discovery_state({"status": "stopping"})
    # The worker checks status and will stop
    time.sleep(1)
    update_discovery_state({"status": "idle"})
    return {"status": "idle"}


@app.get("/api/v1/orchestrator/health")
@tracer.capture_method
def health_check():
    """Check AI model connectivity."""
    models_status = {
        "bedrock": False,
    }

    try:
        # Quick test call to Bedrock
        response = bedrock_runtime.invoke_model(
            modelId=BEDROCK_MODEL_ID,
            contentType="application/json",
            accept="application/json",
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 10,
                "messages": [{"role": "user", "content": "test"}],
            }),
        )
        models_status["bedrock"] = True
    except Exception as e:
        logger.warning(f"Bedrock health check failed: {e}")

    connected = sum(models_status.values())
    return {
        "status": "healthy" if connected > 0 else "no_models",
        "models": models_status,
        "connected_count": connected,
        "total_models": len(models_status),
    }


@app.post("/api/v1/orchestrator/generate-paper/markdown")
@tracer.capture_method
def generate_paper():
    """Generate a research paper from discovered hypotheses."""
    state = get_discovery_state()
    if not state or not state.get("hypotheses"):
        return {"detail": "No hypotheses available for paper generation"}, 400

    hypotheses = state.get("hypotheses", [])
    config = state.get("config", {})
    disease = config.get("disease", "Unknown Disease")

    # Build prompt for paper generation
    hyp_summaries = []
    for i, h in enumerate(hypotheses[:10], 1):
        hyp_summaries.append(
            f"{i}. **{h.get('title', 'Untitled')}** (Confidence: {h.get('confidence', 0):.0%})\n"
            f"   {h.get('description', '')}\n"
            f"   Mechanism: {h.get('mechanism', 'Not specified')}"
        )

    prompt = f"""Write a comprehensive research paper about potential {config.get('discovery_type', 'cure')} strategies for {disease}.

Based on these AI-discovered hypotheses:

{chr(10).join(hyp_summaries)}

Write a complete research paper in Markdown format with these sections:
1. Title
2. Abstract
3. Introduction (disease background, unmet needs)
4. Methods (AI-driven multi-agent discovery approach)
5. Results (hypotheses discovered, confidence analysis)
6. Discussion (implications, limitations, future directions)
7. Conclusion
8. References (cite relevant known literature)

Be thorough, scientific, and cite real biomedical concepts. Format as proper Markdown."""

    system_prompt = "You are a biomedical research paper writer. Write detailed, scientifically rigorous papers."

    try:
        paper_text = invoke_bedrock(prompt, system_prompt, max_tokens=4000)
        return Response(
            status_code=200,
            body=paper_text,
            content_type="text/markdown",
        )
    except Exception as e:
        logger.error(f"Paper generation failed: {e}")
        return {"detail": f"Paper generation failed: {str(e)}"}, 500


# ============== Agent Task Endpoints (API Gateway routes) ==============

@app.post("/api/v1/agents/tasks")
@tracer.capture_method
def create_agent_task():
    """Create an agent task (alternative endpoint)."""
    body = app.current_event.json_body or {}
    task_id = str(uuid4())

    return {"id": task_id, "status": "queued"}


@app.get("/api/v1/agents/tasks/<task_id>")
@tracer.capture_method
def get_agent_task(task_id: str):
    """Get agent task status."""
    return {"id": task_id, "status": "completed", "progress": 100}


# ============== Lambda Handler ==============

@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics(capture_cold_start_metric=True)
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """Lambda handler entry point.

    Handles both:
    1. API Gateway HTTP requests (normal API calls)
    2. Async self-invocations (background discovery work)
    """
    # Check if this is a self-invocation for background work
    if event.get("source") == "self-invoke":
        action = event.get("action")
        if action == "run_discovery":
            config = event.get("config", {})
            run_discovery_worker(config)
            return {"status": "completed"}

    # Otherwise, handle as API Gateway request
    return app.resolve(event, context)
