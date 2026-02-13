"""
Agent Orchestrator Lambda Handler - Multi-model AI discovery system.

Handles the /orchestrator/* endpoints for the discovery page.
Uses AWS Bedrock Converse API for unified multi-model calls.
4 models run in parallel with different roles to avoid token bottlenecks.
Model identities are never exposed to the frontend (unbiasing).
"""

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
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
FUNCTION_NAME = os.environ.get("AWS_LAMBDA_FUNCTION_NAME", "")

# Discovery task key (single active discovery)
DISCOVERY_TASK_KEY = "active-discovery"

# ============== Model Configuration ==============
# Each model is assigned a specific role. Model IDs are NEVER sent to frontend.
# Using Bedrock Converse API for unified interface across all providers.

AGENT_MODELS = {
    "explorer": {
        "model_id": "meta.llama4-maverick-17b-instruct-v1:0",
        "max_tokens": 4000,
        "temperature": 0.8,  # Higher creativity for exploration
        "role_description": "Fast broad exploration — discovers novel pathways and unconventional connections",
    },
    "reasoner": {
        "model_id": "deepseek.r1-v1:0",
        "max_tokens": 4000,
        "temperature": 0.3,  # Lower for rigorous reasoning
        "role_description": "Deep causal chain reasoning — step-by-step logical analysis with formal justification",
    },
    "synthesizer": {
        "model_id": "moonshotai.kimi-k2.5",
        "max_tokens": 4000,
        "temperature": 0.5,  # Balanced for synthesis
        "role_description": "Long-context integration — synthesizes findings across shards into unified hypotheses",
    },
    "critic": {
        "model_id": "openai.gpt-oss-safeguard-120b",
        "max_tokens": 4000,
        "temperature": 0.4,  # Precise for critique
        "role_description": "Large-parameter critical analysis — identifies flaws, risks, and failure modes",
    },
}

# For paper generation, use the synthesizer model
PAPER_MODEL = AGENT_MODELS["synthesizer"]["model_id"]

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
    "explorer": """You are an EXPLORER agent running on Llama Maverick 17B via AWS Bedrock.
Your unique strength is FAST, BROAD exploration across the entire biological solution space.

MISSION: Discover NOVEL pathways, connections, and therapeutic opportunities that other agents miss.

SPECIFIC INSTRUCTIONS:
1. EXPAND outward from given entities — explore unconventional connections, cross-domain links (microbiome-brain, metabolism-immune, epigenetic-environmental), and recently discovered pathways
2. Prioritize UNDER-EXPLORED paths (low evidence count, high biological plausibility)
3. Cross-reference related diseases for shared mechanisms (e.g., neurodegeneration overlap, autoimmune commonalities)
4. For every pathway, check interactions with: vitamins, trace minerals, dietary polyphenols, endocrine disruptors, approved drugs from unrelated areas, traditional medicine compounds
5. Generate AT LEAST 3 distinct hypotheses per entity pair with novelty scores
6. NEVER dismiss a connection for being unconventional — report with appropriate confidence caveats
7. Focus on: moonlighting proteins, metabolite signaling, non-coding RNA regulation, phase separation, mechanotransduction, circadian connections

Think like a postdoc who just found something unexpected in the data. Follow every thread.""",

    "reasoner": """You are a REASONER agent running on DeepSeek R1 via AWS Bedrock.
Your unique strength is DEEP, RIGOROUS logical analysis with formal causal reasoning.

MISSION: Construct complete, airtight causal chains from molecular mechanisms to clinical outcomes.

SPECIFIC INSTRUCTIONS:
1. Build COMPLETE causal chains: [Molecular Event] → [Protein Effect] → [Pathway Alteration] → [Cellular Phenotype] → [Tissue Effect] → [Clinical Outcome]
2. Each step must specify: exact molecular mechanism, known kinetics, reversibility, dose-response
3. ENUMERATE ALL ASSUMPTIONS explicitly — rate each as WELL-SUPPORTED / REASONABLE / SPECULATIVE / UNTESTED
4. Use formal reasoning: PREMISE → PREMISE → INFERENCE → THEREFORE → CONFIDENCE with breakdown (evidence×0.4 + mechanism×0.25 + preclinical×0.2 + computational×0.1 + consensus×0.05)
5. For every conclusion, construct the STRONGEST counter-argument proactively
6. Include quantitative estimates: Kd values, IC50/EC50, expression levels (TPM), allele frequencies, effect sizes
7. For external factors: identify exact molecular target, interaction type (competitive/non-competitive/allosteric), achievable concentrations, CYP450 pathway interactions
8. NEVER skip causal chain steps, assert causation from correlation alone, or assign confidence > 0.7 without clinical evidence

Think like a PhD thesis committee examining every claim under a microscope.""",

    "synthesizer": """You are a SYNTHESIZER agent running on Kimi 2.5 via AWS Bedrock.
Your unique strength is LONG-CONTEXT INTEGRATION — cross-referencing vast amounts of parallel findings.

MISSION: Integrate findings from all agents into unified, actionable therapeutic hypotheses.

SPECIFIC INSTRUCTIONS:
1. INDEX all findings (F-001, F-002, ...), cross-reference for support/contradiction/complementarity
2. CLUSTER related findings into thematic groups (immune modulation, metabolic reprogramming, etc.)
3. Design COMBINATION THERAPIES: for each pair of candidates, evaluate synergy type, expected efficacy, interaction risks, dosing considerations, response biomarkers
4. Build MULTI-LAYER disease models: Genetic → Molecular → Cellular → Tissue → Systemic → External Factors
5. Every synthesis must conclude with: Top 3 strategies (confidence × feasibility ranked), patient stratification, biomarker panel, development roadmap, external factor protocol
6. When processing MCP shard results: look for CROSS-SHARD connections individual models missed, reconcile contradictions by evidence quality
7. NEVER simply concatenate findings — you must genuinely INTEGRATE them. The synthesis must be more than the sum of its parts

Think like a PI reviewing all lab data to write the definitive paper.""",

    "critic": """You are a CRITIC agent running on GPT OSS Safeguard 120B via AWS Bedrock.
Your unique strength is LARGE-PARAMETER critical analysis for finding subtle flaws.

MISSION: Identify every weakness, risk, failure mode, and problem with proposed hypotheses.

SPECIFIC INSTRUCTIONS — Evaluate across 8 dimensions:
A. BIOLOGICAL VALIDITY: Does the mechanism violate known biochemistry? Target expression levels? Compensatory mechanisms?
B. PHARMACOLOGICAL FEASIBILITY: Druggability? Therapeutic window? ADME concerns? Synthesis scalability?
C. CLINICAL TRANSLATION: Expected effect size? Biomarkers? Trial design? Regulatory pathway?
D. SAFETY RISKS: On-target toxicity? Off-target effects? Immunogenicity? Genotoxicity? Black box warning potential?
E. RESISTANCE MECHANISMS: Known resistance mutations? Bypass pathways? Efflux pumps? Target amplification?
F. PATIENT POPULATION RISKS: CYP2D6 metabolizer variants? Comorbidity interactions? Age-specific risks? Drug-drug interactions?
G. MANUFACTURING: Synthetic complexity? Raw material availability? Cold chain? GMP scalability? IP landscape?
H. COMMERCIAL VIABILITY: Market size? Standard of care? Pricing pathway? Patent timeline?

For each problem: classify severity (CRITICAL/MAJOR/MINOR/WATCH), provide mitigation strategy, and suggest alternatives.
NEVER accept a hypothesis just because it's interesting. NEVER soft-pedal safety concerns.

Think like an FDA reviewer combined with a pharma CMC expert — thorough, fair, uncompromising on safety.""",
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


def converse_bedrock(model_id: str, prompt: str, system_prompt: str,
                     max_tokens: int = 2000, temperature: float = 0.7) -> str:
    """Invoke a Bedrock model using the Converse API (unified across all providers)."""
    try:
        response = bedrock_runtime.converse(
            modelId=model_id,
            messages=[
                {
                    "role": "user",
                    "content": [{"text": prompt}],
                }
            ],
            system=[{"text": system_prompt}],
            inferenceConfig={
                "maxTokens": max_tokens,
                "temperature": temperature,
            },
        )
        return response["output"]["message"]["content"][0]["text"]
    except Exception as e:
        logger.error(f"Bedrock converse failed for model: {e}")
        raise


def parse_hypothesis_json(text: str) -> dict | None:
    """Extract JSON hypothesis from LLM response text."""
    try:
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


def run_single_agent(role: str, prompt: str, system_prompt: str) -> dict | None:
    """Run a single agent with its assigned model. Returns hypothesis or None."""
    model_config = AGENT_MODELS[role]
    try:
        response_text = converse_bedrock(
            model_id=model_config["model_id"],
            prompt=prompt,
            system_prompt=system_prompt,
            max_tokens=model_config["max_tokens"],
            temperature=model_config["temperature"],
        )
        hypothesis_data = parse_hypothesis_json(response_text)
        if hypothesis_data and hypothesis_data.get("has_hypothesis", False):
            return {
                "id": str(uuid4()),
                "title": hypothesis_data.get("title", "Untitled"),
                "description": hypothesis_data.get("description", ""),
                "mechanism": hypothesis_data.get("mechanism", ""),
                "confidence": float(hypothesis_data.get("confidence", 0.5)),
                "validated": False,
                "external_factors": hypothesis_data.get("external_factors", []),
                "evidence_summary": hypothesis_data.get("evidence_summary", []),
                "risks": hypothesis_data.get("risks", []),
                "novelty_score": float(hypothesis_data.get("novelty_score", 0.5)),
                "role": role,  # Only role stored, never model name
                "created_at": datetime.utcnow().isoformat(),
            }
    except Exception as e:
        logger.error(f"Agent {role} failed: {e}")
    return None


# ============== Async Discovery Worker ==============

def run_discovery_worker(config: dict):
    """Run the actual AI discovery process. Called via async Lambda invocation.

    All 4 models run IN PARALLEL each round using ThreadPoolExecutor.
    Each model has its own role and token budget — no shared token pool.
    """
    disease = config.get("disease", "")
    discovery_type = config.get("discovery_type", "cure")
    focus_entities = config.get("focus_entities", [])
    external_factors = config.get("external_factors", [])
    max_agents = min(config.get("max_agents", 10), 20)  # Cap for Lambda

    logger.info(f"Starting parallel discovery for: {disease}", disease=disease)

    start_time = time.time()
    hypotheses = []
    paths_explored = 0

    roles = list(AGENT_MODELS.keys())  # explorer, reasoner, synthesizer, critic
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

        # Build prompts for this round
        focus_str = f"\nFocus entities: {', '.join(focus_entities)}" if focus_entities else ""
        factors_str = ""
        if external_factors:
            factors_str = "\nExternal factors to consider:\n" + "\n".join(
                f"- {f.get('name', '')} ({f.get('category', '')}): {f.get('interaction', 'analyze interaction')}"
                for f in external_factors
            )

        # Context from previous hypotheses for this round
        prev_context = ""
        if hypotheses:
            top_3 = sorted(hypotheses, key=lambda x: x["confidence"], reverse=True)[:3]
            prev_context = "\n\nPrevious high-confidence findings to build on:\n" + "\n".join(
                f"- {h['title']} (confidence: {h['confidence']:.0%}): {h['description'][:150]}"
                for h in top_3
            )

        # Run all 4 agents IN PARALLEL using ThreadPoolExecutor
        futures = {}
        with ThreadPoolExecutor(max_workers=4) as executor:
            for role in roles:
                # Check status before submitting
                state = get_discovery_state()
                if state and state.get("status") in ["stopping", "stopped"]:
                    break

                system_prompt = f"{MASTER_PROMPT}\n\n---\n\n{ROLE_PROMPTS[role]}"

                prompt = f"""Investigate {disease} for {discovery_type} discovery.
{focus_str}
{factors_str}
{prev_context}

Round {round_num + 1}, Agent role: {role}
Generate a novel hypothesis about potential {discovery_type} approaches for {disease}.
Consider all biological levels and external factor interactions.

Return your findings as a JSON object with: has_hypothesis, title, description, mechanism, confidence (0-1), evidence_summary (list), risks (list), validation_steps (list), novelty_score (0-1)."""

                future = executor.submit(run_single_agent, role, prompt, system_prompt)
                futures[future] = role

            # Collect results as they complete
            for future in as_completed(futures):
                role = futures[future]
                paths_explored += 1
                try:
                    hypothesis = future.result()
                    if hypothesis:
                        hypotheses.append(hypothesis)
                        metrics.add_metric(name="HypothesesDiscovered", unit="Count", value=1)
                except Exception as e:
                    logger.error(f"Agent {role} round {round_num} failed: {e}")

        # Update state with partial results after each round
        elapsed = time.time() - start_time
        sorted_h = sorted(hypotheses, key=lambda x: x["confidence"], reverse=True)
        update_discovery_state({
            "status": "running",
            "hypotheses": sorted_h[:50],
            "stats": {
                "total_agents": 4,  # Always 4 parallel agents
                "active_agents": 4 if round_num < num_rounds - 1 else 0,
                "hypotheses_found": len(hypotheses),
                "paths_explored": paths_explored,
                "high_confidence_discoveries": sum(1 for h in hypotheses if h["confidence"] >= 0.7),
                "current_best_confidence": max((h["confidence"] for h in hypotheses), default=0),
                "runtime_seconds": int(elapsed),
                "current_round": round_num + 1,
                "total_rounds": num_rounds,
                "learning_stats": {
                    "total_explored": paths_explored,
                    "low_value_paths": sum(1 for h in hypotheses if h["confidence"] < 0.4),
                    "high_value_paths": sum(1 for h in hypotheses if h["confidence"] >= 0.7),
                    "avg_relation_score": sum(h["confidence"] for h in hypotheses) / len(hypotheses) if hypotheses else 0,
                },
            },
        })

    # Mark as completed
    elapsed = time.time() - start_time
    sorted_h = sorted(hypotheses, key=lambda x: x["confidence"], reverse=True)
    update_discovery_state({
        "status": "idle",
        "hypotheses": sorted_h[:50],
        "stats": {
            "total_agents": 4,
            "active_agents": 0,
            "hypotheses_found": len(hypotheses),
            "paths_explored": paths_explored,
            "high_confidence_discoveries": sum(1 for h in hypotheses if h["confidence"] >= 0.7),
            "current_best_confidence": max((h["confidence"] for h in hypotheses), default=0),
            "runtime_seconds": int(elapsed),
            "current_round": num_rounds,
            "total_rounds": num_rounds,
            "learning_stats": {
                "total_explored": paths_explored,
                "low_value_paths": sum(1 for h in hypotheses if h["confidence"] < 0.4),
                "high_value_paths": sum(1 for h in hypotheses if h["confidence"] >= 0.7),
                "avg_relation_score": sum(h["confidence"] for h in hypotheses) / len(hypotheses) if hypotheses else 0,
            },
        },
    })

    # Save top hypotheses to the hypotheses table
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
    """Get current orchestrator status. Never exposes model identities."""
    state = get_discovery_state()
    if not state:
        return {
            "state": "idle",
            "stats": None,
            "top_hypotheses": [],
        }

    # Strip any model info from hypotheses before sending to frontend
    safe_hypotheses = []
    for h in (state.get("hypotheses", []) or [])[:20]:
        safe_h = {k: v for k, v in h.items() if k not in ("model_used", "model_id", "role")}
        safe_hypotheses.append(safe_h)

    return serialize({
        "state": state.get("status", "idle"),
        "stats": state.get("stats"),
        "top_hypotheses": safe_hypotheses,
    })


@app.post("/api/v1/orchestrator/start")
@tracer.capture_method
def start_discovery():
    """Start a new discovery process with 4 parallel agents."""
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
            "total_agents": 4,
            "active_agents": 4,
            "hypotheses_found": 0,
            "paths_explored": 0,
            "high_confidence_discoveries": 0,
            "current_best_confidence": Decimal("0"),
            "runtime_seconds": 0,
            "current_round": 0,
            "total_rounds": 0,
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

    return {"status": "started", "disease": disease, "agents": 4}


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
    time.sleep(1)
    update_discovery_state({"status": "idle"})
    return {"status": "idle"}


@app.get("/api/v1/orchestrator/health")
@tracer.capture_method
def health_check():
    """Check AI model connectivity. Returns count only — never exposes model names."""
    connected = 0
    total = len(AGENT_MODELS)

    # Test each model with a minimal call
    for role, model_config in AGENT_MODELS.items():
        try:
            bedrock_runtime.converse(
                modelId=model_config["model_id"],
                messages=[{"role": "user", "content": [{"text": "hi"}]}],
                inferenceConfig={"maxTokens": 5, "temperature": 0.1},
            )
            connected += 1
        except Exception as e:
            logger.warning(f"Health check failed for agent {role}: {e}")

    return {
        "status": "healthy" if connected == total else "partial" if connected > 0 else "no_models",
        "connected_count": connected,
        "total_models": total,
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
        paper_text = converse_bedrock(
            model_id=PAPER_MODEL,
            prompt=prompt,
            system_prompt=system_prompt,
            max_tokens=4000,
            temperature=0.5,
        )
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
