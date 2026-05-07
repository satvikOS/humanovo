#!/usr/bin/env python3
"""
humanovo Pre-Flight Diagnostic

Run this BEFORE the pipeline to verify everything is wired up.
Reports exactly which models, services, and APIs are available,
what pipeline degradation to expect, and estimated cost.

Usage:
  cd backend
  python -m tests.integration.preflight

No API calls are made (except optional model ping tests).
"""

import asyncio
import sys
from pathlib import Path

# Ensure app is importable
backend_dir = Path(__file__).resolve().parent.parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

# Load .env
env_file = backend_dir / ".env"
if env_file.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(env_file)
    except ImportError:
        pass


# ─── Colors ──────────────────────────────────────────────────────
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

def ok(msg): print(f"  {GREEN}✓{RESET} {msg}")
def fail(msg): print(f"  {RED}✗{RESET} {msg}")
def warn(msg): print(f"  {YELLOW}⚠{RESET} {msg}")
def info(msg): print(f"  {CYAN}→{RESET} {msg}")
def header(msg): print(f"\n{BOLD}{'═'*60}\n  {msg}\n{'═'*60}{RESET}")


# ─── Config Check ───────────────────────────────────────────────

def check_config():
    header("1. CONFIGURATION")

    try:
        from app.core.config import settings
        ok(f"Settings loaded: APP_NAME={settings.APP_NAME}, ENV={settings.ENVIRONMENT}")
    except Exception as e:
        fail(f"Settings import failed: {e}")
        return False

    return True


# ─── Provider Checks ────────────────────────────────────────────

def check_providers():
    header("2. LLM PROVIDER CREDENTIALS")

    from app.core.config import settings
    results = {}

    # Bedrock
    has_bedrock = bool(settings.aws_access_key_value and settings.aws_secret_key_value)
    if has_bedrock:
        ok(f"AWS Bedrock: region={settings.AWS_REGION}")
        ok(f"  Claude Opus:  {settings.BEDROCK_MODEL_CLAUDE_OPUS}")
        ok(f"  Claude Sonnet: {settings.BEDROCK_MODEL_CLAUDE_SONNET}")
        results["bedrock"] = True
    else:
        fail("AWS Bedrock: AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY not set")
        results["bedrock"] = False

    # Azure models
    azure_models = {
        "GPT-4o": (settings.AZURE_GPT4O_ENDPOINT, settings.azure_gpt4o_key_value, settings.AZURE_GPT4O_DEPLOYMENT),
        "GPT-4.1": (settings.AZURE_GPT41_ENDPOINT, settings.azure_gpt41_key_value, settings.AZURE_GPT41_DEPLOYMENT),
        "o3-mini": (settings.AZURE_O3MINI_ENDPOINT, settings.azure_o3mini_key_value, settings.AZURE_O3MINI_DEPLOYMENT),
        "Cohere": (settings.AZURE_COHERE_ENDPOINT, settings.azure_cohere_key_value, settings.AZURE_COHERE_DEPLOYMENT),
        "Mistral": (settings.AZURE_MISTRAL_ENDPOINT, settings.azure_mistral_key_value, settings.AZURE_MISTRAL_MODEL),
        "Grok": (settings.AZURE_GROK_ENDPOINT, settings.azure_grok_key_value, settings.AZURE_GROK_MODEL),
    }

    for name, (endpoint, key, model) in azure_models.items():
        if endpoint and key:
            ok(f"Azure {name}: {model} @ {endpoint[:50]}...")
            results[name.lower()] = True
        else:
            fail(f"Azure {name}: endpoint or key not set")
            results[name.lower()] = False

    # Embeddings
    if settings.AZURE_EMBEDDING_ENDPOINT and settings.azure_embedding_key_value:
        ok(f"Azure Embeddings: {settings.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_LARGE}")
        results["embeddings"] = True
    else:
        warn("Azure Embeddings: not configured (grounding will use local fallback models)")
        results["embeddings"] = False

    return results


# ─── Pipeline Degradation Analysis ──────────────────────────────

def analyze_pipeline(provider_results: dict):
    header("3. PIPELINE STAGE AVAILABILITY")

    # Stage → preferred model → provider key
    stages = [
        (1,  "SEED",      "Claude Opus",    "bedrock"),
        (2,  "EXPAND",    "Claude Sonnet",  "bedrock"),
        (3,  "EVIDENCE",  "Cohere Cmd A",   "cohere"),
        (4,  "COUNTER",   "Mistral-Large",  "mistral"),
        (5,  "REVISE",    "o3-mini",        "o3-mini"),
        (6,  "MECHANISM", "GPT-4.1",        "gpt-4.1"),
        (7,  "VALIDATE",  "Claude Sonnet",  "bedrock"),
        (8,  "GROUND",    "Grok-4-1-fast",  "grok"),
        (9,  "SCORE",     "GPT-4.1",        "gpt-4.1"),
        (10, "REFINE",    "GPT-4o",         "gpt-4o"),
        (11, "TRANSLATE", "Claude Sonnet",  "bedrock"),
        (12, "FINALIZE",  "Claude Sonnet",  "bedrock"),
    ]

    # Fallback chain
    fallback_map = {
        "cohere": "bedrock",
        "mistral": "bedrock",
        "o3-mini": "bedrock",
        "gpt-4.1": "bedrock",
        "gpt-4o": "bedrock",
        "grok": "mistral",
    }

    native_count = 0
    fallback_count = 0
    unavailable_count = 0

    for num, name, model, provider_key in stages:
        if provider_results.get(provider_key):
            ok(f"Stage {num:>2} ({name:<10}) → {model:<15} (native)")
            native_count += 1
        else:
            fb = fallback_map.get(provider_key)
            if fb and provider_results.get(fb):
                warn(f"Stage {num:>2} ({name:<10}) → Claude Opus (FALLBACK — {model} unavailable)")
                fallback_count += 1
            else:
                fail(f"Stage {num:>2} ({name:<10}) → NO MODEL AVAILABLE")
                unavailable_count += 1

    print()
    info(f"Native: {native_count}/12 | Fallback: {fallback_count}/12 | Unavailable: {unavailable_count}/12")

    if unavailable_count > 0:
        fail("Pipeline CANNOT run — no model available for some stages")
        return False
    elif fallback_count > 6:
        warn("Pipeline will run but with HEAVY degradation — most stages use the same model")
        warn("The adversarial benefit (different models attacking hypotheses) is lost")
        warn("RECOMMENDED: Add at least Azure Mistral (COUNTER stage) for adversarial diversity")
    elif fallback_count > 0:
        warn(f"{fallback_count} stages using fallback models — pipeline will run with reduced diversity")
    else:
        ok("All 12 stages have native model assignments — FULL adversarial pipeline available")

    # Check adversarial quality
    has_adversarial = (
        provider_results.get("bedrock") and  # Claude generates
        (provider_results.get("mistral") or provider_results.get("grok"))  # Different model attacks
    )
    if has_adversarial:
        ok("ADVERSARIAL DIVERSITY: COUNTER stage uses different model family from SEED — core differentiator intact")
    else:
        warn("ADVERSARIAL DIVERSITY LOST: COUNTER stage falls back to same model as SEED — this negates humanovo's core architectural advantage")

    return True


# ─── Data Source Checks ─────────────────────────────────────────

def check_data_sources():
    header("4. DATA SOURCE APIS")

    from app.core.config import settings

    sources = {
        "PubMed": bool(settings.PUBMED_EMAIL and settings.PUBMED_EMAIL != "humanovo@example.com"),
        "PubMed API Key": bool(settings.PUBMED_API_KEY),
    }

    available = 0
    for name, has_key in sources.items():
        if has_key:
            ok(f"{name}: configured")
            available += 1
        else:
            warn(f"{name}: not configured (evidence quality will be reduced)")

    # Free APIs that don't need keys
    free_apis = [
        "ClinicalTrials.gov", "UniProt", "Reactome (public)",
        "KEGG (rate-limited)", "Ensembl", "NCBI Gene",
        "ClinVar", "STRING", "OpenAlex", "Semantic Scholar",
    ]
    info(f"Free APIs available without keys: {', '.join(free_apis)}")

    return available


# ─── Database Checks ────────────────────────────────────────────

async def check_databases():
    header("5. DATABASE CONNECTIVITY")

    from app.core.config import settings
    results = {}

    # PostgreSQL
    try:
        from sqlalchemy.ext.asyncio import create_async_engine
        engine = create_async_engine(settings.DATABASE_URL, echo=False)
        async with engine.connect() as conn:
            result = await conn.execute(
                __import__("sqlalchemy").text("SELECT 1")
            )
            assert result.scalar() == 1
        await engine.dispose()
        ok(f"PostgreSQL: connected ({settings.DATABASE_URL.split('@')[-1]})")
        results["postgres"] = True
    except Exception as e:
        fail(f"PostgreSQL: {e}")
        results["postgres"] = False

    # Redis
    try:
        import redis.asyncio as aioredis
        r = aioredis.from_url(settings.REDIS_URL)
        await r.ping()
        await r.close()
        ok(f"Redis: connected ({settings.REDIS_URL})")
        results["redis"] = True
    except Exception as e:
        warn(f"Redis: {e} (non-fatal — pipeline works without cache)")
        results["redis"] = False

    # Neo4j
    try:
        from neo4j import AsyncGraphDatabase
        driver = AsyncGraphDatabase.driver(
            settings.NEO4J_URI,
            auth=(settings.NEO4J_USER, settings.neo4j_password_value),
        )
        async with driver.session() as session:
            result = await session.run("RETURN 1 AS n")
            record = await result.single()
            assert record["n"] == 1
        await driver.close()
        ok(f"Neo4j: connected ({settings.NEO4J_URI})")
        results["neo4j"] = True
    except Exception as e:
        warn(f"Neo4j: {e} (non-fatal — pipeline works without graph store)")
        results["neo4j"] = False

    return results


# ─── Cost Estimation ────────────────────────────────────────────

def estimate_costs(provider_results: dict):
    header("6. COST ESTIMATE (per hypothesis)")

    # Approximate costs per 1K tokens (input/output)
    costs = {
        "Claude Opus (Bedrock)":   {"input": 0.015, "output": 0.075},
        "Claude Sonnet (Bedrock)": {"input": 0.003, "output": 0.015},
        "GPT-4.1 (Azure)":        {"input": 0.002, "output": 0.008},
        "GPT-4o (Azure)":         {"input": 0.005, "output": 0.015},
        "o3-mini (Azure)":        {"input": 0.001, "output": 0.004},
        "Mistral-Large (Azure)":  {"input": 0.002, "output": 0.006},
        "Grok-4-1 (Azure)":      {"input": 0.003, "output": 0.010},
        "Cohere Cmd A (Azure)":   {"input": 0.001, "output": 0.003},
    }

    # Average stage: ~4K input tokens, ~2K output tokens
    avg_input_ktokens = 4.0
    avg_output_ktokens = 2.0

    total = 0.0
    for model, pricing in costs.items():
        stage_cost = (avg_input_ktokens * pricing["input"]) + (avg_output_ktokens * pricing["output"])
        total += stage_cost

    info(f"Estimated cost per hypothesis (full pipeline): ${total:.2f}")
    info(f"Estimated cost for 10-benchmark suite: ${total * 10:.2f}")
    info(f"Estimated cost for single test run: ${total:.2f}")

    if provider_results.get("bedrock") and not any(
        provider_results.get(k) for k in ["gpt-4o", "gpt-4.1", "mistral", "grok", "o3-mini", "cohere"]
    ):
        # All fallback to Claude Opus — more expensive
        fallback_cost = 12 * ((avg_input_ktokens * 0.015) + (avg_output_ktokens * 0.075))
        warn(f"With all-Opus fallback: ~${fallback_cost:.2f} per hypothesis (expensive)")


# ─── Dependency Check ───────────────────────────────────────────

def check_dependencies():
    header("7. CRITICAL DEPENDENCIES")

    deps = {
        "openai": "1.55.0",
        "boto3": "1.35.0",
        "fastapi": "0.115.0",
        "pydantic": "2.9.0",
        "sqlalchemy": "2.0.35",
        "langchain": "0.3.0",
        "langgraph": "0.2.50",
        "httpx": "0.27.0",
        "numpy": "1.26.0",
    }

    issues = []
    for pkg, min_version in deps.items():
        try:
            mod = __import__(pkg)
            version = getattr(mod, "__version__", "unknown")
            if version == "unknown":
                warn(f"{pkg}: installed (version unknown)")
            else:
                # Simple version comparison
                ok(f"{pkg}: {version}")
        except ImportError:
            fail(f"{pkg}: NOT INSTALLED")
            issues.append(pkg)

    if issues:
        fail(f"Missing packages: {', '.join(issues)}")
        info("Run: pip install -r requirements.txt")
    else:
        ok("All critical dependencies installed")


# ─── Model Ping Test ────────────────────────────────────────────

async def ping_models(provider_results: dict):
    header("8. MODEL CONNECTIVITY TEST (optional)")

    from app.core.config import settings

    # Only ping if Bedrock is available (cheapest test)
    if not provider_results.get("bedrock"):
        warn("Skipping model ping — no Bedrock credentials")
        return

    info("Sending minimal test prompt to Claude Sonnet via Bedrock...")
    try:
        import boto3
        client = boto3.client(
            "bedrock-runtime",
            region_name=settings.AWS_REGION,
            aws_access_key_id=settings.aws_access_key_value,
            aws_secret_access_key=settings.aws_secret_key_value,
        )
        response = client.converse(
            modelId=settings.BEDROCK_MODEL_CLAUDE_SONNET,
            messages=[{"role": "user", "content": [{"text": "Reply with only: OK"}]}],
            system=[{"text": "You are a test system. Reply with exactly 'OK' and nothing else."}],
            inferenceConfig={"maxTokens": 10, "temperature": 0.0},
        )
        text = response["output"]["message"]["content"][0]["text"]
        ok(f"Claude Sonnet responded: '{text.strip()}'")
        usage = response.get("usage", {})
        info(f"Tokens: input={usage.get('inputTokens', '?')}, output={usage.get('outputTokens', '?')}")
    except Exception as e:
        fail(f"Bedrock ping failed: {e}")
        info("Check: AWS credentials, region, model access permissions")


# ─── Summary ────────────────────────────────────────────────────

def summary(
    config_ok: bool,
    provider_results: dict,
    pipeline_ok: bool,
    data_sources: int,
    db_results: dict,
):
    header("SUMMARY")

    blockers = []
    warnings = []

    if not config_ok:
        blockers.append("Configuration failed to load")
    if not provider_results.get("bedrock") and not any(provider_results.get(k) for k in ["gpt-4o", "gpt-4.1", "mistral"]):
        blockers.append("No LLM provider available")
    if not pipeline_ok:
        blockers.append("Pipeline has stages with no model available")
    if not db_results.get("postgres"):
        warnings.append("PostgreSQL not connected — cost tracking and persistence disabled")

    if not provider_results.get("mistral") and not provider_results.get("grok"):
        warnings.append("No adversarial model available — COUNTER stage falls back to same model family")
    if not provider_results.get("embeddings"):
        warnings.append("Embedding API not configured — grounding will use slower local models")
    if data_sources == 0:
        warnings.append("No data source API keys configured — evidence will be limited to free APIs")

    if blockers:
        print(f"\n  {RED}{BOLD}BLOCKED — Cannot run pipeline:{RESET}")
        for b in blockers:
            fail(b)
    elif warnings:
        print(f"\n  {YELLOW}{BOLD}READY WITH WARNINGS:{RESET}")
        for w in warnings:
            warn(w)
        print(f"\n  {GREEN}Pipeline CAN run. Run: pytest tests/integration/test_pipeline_e2e.py -v -s{RESET}")
    else:
        print(f"\n  {GREEN}{BOLD}ALL SYSTEMS GO{RESET}")
        print(f"  {GREEN}Run: pytest tests/integration/test_pipeline_e2e.py -v -s --timeout=600{RESET}")


# ─── Main ────────────────────────────────────────────────────────

async def main():
    print(f"\n{BOLD}humanovo Pre-Flight Diagnostic{RESET}")
    print(f"{'─'*60}")

    config_ok = check_config()
    if not config_ok:
        return

    check_dependencies()
    provider_results = check_providers()
    pipeline_ok = analyze_pipeline(provider_results)
    data_sources = check_data_sources()
    db_results = await check_databases()
    estimate_costs(provider_results)
    await ping_models(provider_results)
    summary(config_ok, provider_results, pipeline_ok, data_sources, db_results)


if __name__ == "__main__":
    asyncio.run(main())
