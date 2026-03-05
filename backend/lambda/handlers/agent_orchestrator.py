"""
Agent Orchestrator Lambda Handler - Multi-model AI discovery system.

Handles the /orchestrator/* endpoints for the discovery page.
Uses mixed providers:
  - Claude Opus 4.6 via AWS Bedrock (Explorer + Synthesizer)
  - DeepSeek-R1 via Azure AI Foundry (Reasoner)
  - Mistral-Large-3 via Azure AI Foundry (Critic)
Model identities are never exposed to the frontend (unbiasing).
"""

print("[ORCHESTRATOR] Module loading...")

import base64
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import uuid4

import logging

import boto3
from botocore.config import Config as BotoConfig

# Defensive powertools imports — Lambda must NEVER crash on cold start
try:
    from aws_lambda_powertools import Logger, Metrics
    from aws_lambda_powertools.event_handler import APIGatewayHttpResolver, Response
    from aws_lambda_powertools.utilities.typing import LambdaContext
    logger = Logger()
    metrics = Metrics()
except ImportError as _import_err:
    # Fallback if powertools layer is missing or incompatible
    logging.error(f"aws_lambda_powertools import failed: {_import_err}")
    from collections import namedtuple
    logger = logging.getLogger("agent_orchestrator")
    logger.setLevel(logging.DEBUG)

    # Minimal stub for APIGatewayHttpResolver with path parameter support
    import re as _re_stub

    class APIGatewayHttpResolver:
        """Stub resolver when powertools is unavailable. Supports <param> path parameters."""
        def __init__(self):
            self._routes = []  # list of (method, pattern_re, param_names, func)
            self.current_event = None
        def _register(self, method, path, func):
            # Convert /api/v1/foo/<bar>/baz to regex with named groups
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
        def resolve(self, event, context):
            method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
            path = event.get("rawPath", "")
            for route_method, pattern_re, param_names, handler_fn in self._routes:
                if route_method != method:
                    continue
                m = pattern_re.match(path)
                if m:
                    self.current_event = type("Event", (), {"json_body": json.loads(event.get("body", "{}") or "{}")})()
                    kwargs = {name: m.group(i + 1) for i, name in enumerate(param_names)}
                    result = handler_fn(**kwargs)
                    if isinstance(result, dict):
                        return {"statusCode": 200, "headers": {"Content-Type": "application/json"}, "body": json.dumps(result, cls=DecimalEncoder)}
                    if isinstance(result, Response):
                        return {"statusCode": result.status_code, "headers": {"Content-Type": result.content_type}, "body": result.body}
                    return result
            return {"statusCode": 404, "body": json.dumps({"detail": f"Not Found: {method} {path}"})}

    class Response:
        def __init__(self, status_code=200, body="", content_type="application/json", headers=None):
            self.status_code = status_code
            self.body = body
            self.content_type = content_type

    LambdaContext = object

    class _NoopMetrics:
        def add_metric(self, **kwargs): pass
    metrics = _NoopMetrics()

app = APIGatewayHttpResolver()
print(f"[ORCHESTRATOR] App initialized, type={type(app).__name__}")

# AWS Clients — defensive init to prevent cold start crashes
try:
    dynamodb = boto3.resource("dynamodb")
except Exception as _e:
    logger.error(f"DynamoDB init failed: {_e}")
    dynamodb = None

try:
    bedrock_runtime = boto3.client("bedrock-runtime", config=BotoConfig(
        read_timeout=120, connect_timeout=10, retries={"max_attempts": 2}
    ))
except Exception as _e:
    logger.error(f"Bedrock init failed: {_e}")
    bedrock_runtime = None

# Separate client with extended timeout for paper generation (long inference)
try:
    bedrock_long = boto3.client("bedrock-runtime", config=BotoConfig(
        read_timeout=600, connect_timeout=10, retries={"max_attempts": 1}
    ))
except Exception as _e:
    logger.error(f"Bedrock long-timeout init failed: {_e}")
    bedrock_long = None

try:
    lambda_client = boto3.client("lambda")
except Exception as _e:
    logger.error(f"Lambda client init failed: {_e}")
    lambda_client = None

# Azure AI — lightweight client using stdlib (no openai package needed)
# Uses urllib.request to call Azure AI's OpenAI-compatible chat completion API.
import urllib.request
import urllib.error
import urllib.parse
import ssl

class _AzureAIMessage:
    """Mimics openai's message object."""
    def __init__(self, content: str):
        self.content = content

class _AzureAIChoice:
    """Mimics openai's choice object."""
    def __init__(self, message_content: str):
        self.message = _AzureAIMessage(message_content)

class _AzureAIResponse:
    """Mimics openai's completion response."""
    def __init__(self, choices_data: list):
        self.choices = [
            _AzureAIChoice(c.get("message", {}).get("content", ""))
            for c in choices_data
        ]

class _AzureAIChatCompletions:
    """Mimics openai's chat.completions interface for Azure AI model-specific endpoints."""
    def __init__(self, base_url: str, api_key: str):
        self._base_url = base_url.rstrip("/")
        if not self._base_url.startswith("https://"):
            self._base_url = f"https://{self._base_url}"
        self._api_key = api_key

    def create(self, model: str, messages: list, max_tokens: int = 65_536,
               temperature: float = 0.7, max_completion_tokens: int = 0, **kwargs) -> _AzureAIResponse:
        url = f"{self._base_url}/chat/completions"
        body: dict = {"model": model, "messages": messages}
        if max_completion_tokens > 0:
            body["max_completion_tokens"] = max_completion_tokens
        else:
            body["max_tokens"] = max_tokens
            body["temperature"] = temperature
        payload = json.dumps(body).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self._api_key}",
            },
            method="POST",
        )

        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=180, context=ctx) as resp:
            resp_body = json.loads(resp.read().decode("utf-8"))
        return _AzureAIResponse(resp_body.get("choices", []))


class _AzureOpenAIChatCompletions:
    """Mimics openai's chat.completions interface for Azure OpenAI deployment-based models.

    URL format: {endpoint}/openai/deployments/{deployment}/chat/completions?api-version={version}
    Auth: api-key header (not Bearer token).
    """
    def __init__(self, endpoint: str, api_key: str, deployment: str, api_version: str = "2024-05-01-preview"):
        self._endpoint = endpoint.rstrip("/")
        if not self._endpoint.startswith("https://"):
            self._endpoint = f"https://{self._endpoint}"
        self._api_key = api_key
        self._deployment = deployment
        self._api_version = api_version

    def create(self, model: str, messages: list, max_tokens: int = 65_536,
               temperature: float = 0.7, max_completion_tokens: int = 0, **kwargs) -> _AzureAIResponse:
        url = (
            f"{self._endpoint}/openai/deployments/{self._deployment}"
            f"/chat/completions?api-version={self._api_version}"
        )
        body: dict = {"messages": messages}
        if max_completion_tokens > 0:
            body["max_completion_tokens"] = max_completion_tokens
        else:
            body["max_tokens"] = max_tokens
            body["temperature"] = temperature
        payload = json.dumps(body).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "api-key": self._api_key,
            },
            method="POST",
        )

        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=180, context=ctx) as resp:
            resp_body = json.loads(resp.read().decode("utf-8"))
        return _AzureAIResponse(resp_body.get("choices", []))


class _AzureAIChat:
    """Mimics openai's chat namespace for Azure AI model-specific endpoints."""
    def __init__(self, base_url: str, api_key: str):
        self.completions = _AzureAIChatCompletions(base_url, api_key)


class AzureAIClient:
    """Drop-in replacement for OpenAI() — uses stdlib only. For Azure AI model-specific endpoints."""
    def __init__(self, base_url: str, api_key: str):
        self.chat = _AzureAIChat(base_url, api_key)


class _AzureOpenAIChat:
    """Mimics openai's chat namespace for Azure OpenAI deployment-based models."""
    def __init__(self, endpoint: str, api_key: str, deployment: str, api_version: str):
        self.completions = _AzureOpenAIChatCompletions(endpoint, api_key, deployment, api_version)


class AzureOpenAIClient:
    """Drop-in replacement for AzureOpenAI() — uses stdlib only. For Azure OpenAI deployments."""
    def __init__(self, endpoint: str, api_key: str, deployment: str, api_version: str = "2024-05-01-preview"):
        self.chat = _AzureOpenAIChat(endpoint, api_key, deployment, api_version)


azure_deepseek_client = None
azure_mistral_client = None
azure_gpt4o_client = None
azure_cohere_client = None
azure_kimi_client = None
azure_o3mini_client = None
azure_gpt41_client = None
azure_phi4_client = None
azure_grok_client = None

# Shared endpoint (both models at same Azure AI resource)
AZURE_AI_ENDPOINT = os.environ.get("AZURE_AI_ENDPOINT", "")
AZURE_AI_KEY = os.environ.get("AZURE_AI_KEY", "")

# Per-model overrides (fall back to shared endpoint)
AZURE_DEEPSEEK_ENDPOINT = os.environ.get("AZURE_DEEPSEEK_ENDPOINT", "") or AZURE_AI_ENDPOINT
AZURE_DEEPSEEK_KEY = os.environ.get("AZURE_DEEPSEEK_KEY", "") or AZURE_AI_KEY
AZURE_MISTRAL_ENDPOINT = os.environ.get("AZURE_MISTRAL_ENDPOINT", "") or AZURE_AI_ENDPOINT
AZURE_MISTRAL_KEY = os.environ.get("AZURE_MISTRAL_KEY", "") or AZURE_AI_KEY
AZURE_GPT4O_ENDPOINT = os.environ.get("AZURE_GPT4O_ENDPOINT", "") or AZURE_AI_ENDPOINT
AZURE_GPT4O_KEY = os.environ.get("AZURE_GPT4O_KEY", "") or AZURE_AI_KEY
AZURE_COHERE_ENDPOINT = os.environ.get("AZURE_COHERE_ENDPOINT", "") or AZURE_AI_ENDPOINT
AZURE_COHERE_KEY = os.environ.get("AZURE_COHERE_KEY", "") or AZURE_AI_KEY
AZURE_KIMI_ENDPOINT = os.environ.get("AZURE_KIMI_ENDPOINT", "") or AZURE_AI_ENDPOINT
AZURE_KIMI_KEY = os.environ.get("AZURE_KIMI_KEY", "") or AZURE_AI_KEY
AZURE_O3MINI_ENDPOINT = os.environ.get("AZURE_O3MINI_ENDPOINT", "") or AZURE_AI_ENDPOINT
AZURE_O3MINI_KEY = os.environ.get("AZURE_O3MINI_KEY", "") or AZURE_AI_KEY
AZURE_GPT41_ENDPOINT = os.environ.get("AZURE_GPT41_ENDPOINT", "") or AZURE_AI_ENDPOINT
AZURE_GPT41_KEY = os.environ.get("AZURE_GPT41_KEY", "") or AZURE_AI_KEY
AZURE_PHI4_ENDPOINT = os.environ.get("AZURE_PHI4_ENDPOINT", "") or AZURE_AI_ENDPOINT
AZURE_PHI4_KEY = os.environ.get("AZURE_PHI4_KEY", "") or AZURE_AI_KEY
AZURE_GROK_ENDPOINT = os.environ.get("AZURE_GROK_ENDPOINT", "") or AZURE_AI_ENDPOINT
AZURE_GROK_KEY = os.environ.get("AZURE_GROK_KEY", "") or AZURE_AI_KEY

def _normalize_azure_ai_endpoint(endpoint: str) -> str:
    """Normalize Azure AI Foundry endpoint to base URL for /chat/completions.

    Input examples:
      https://humanovo-openai.services.ai.azure.com/openai/v1/chat/completions?api-version=...
      https://humanovo-openai.services.ai.azure.com/models/chat/completions?api-version=...
      https://humanovo-openai.services.ai.azure.com/models
      https://humanovo-openai.services.ai.azure.com
      humanovo-openai.services.ai.azure.com

    Output: https://humanovo-openai.services.ai.azure.com/models
    """
    # Strip query string
    endpoint = endpoint.split("?")[0].rstrip("/")
    # Add https:// if missing
    if not endpoint.startswith("https://") and not endpoint.startswith("http://"):
        endpoint = f"https://{endpoint}"
    # For services.ai.azure.com: strip ALL path components, then add /models
    if "services.ai.azure.com" in endpoint:
        # Extract just scheme + hostname
        from urllib.parse import urlparse
        parsed = urlparse(endpoint)
        endpoint = f"{parsed.scheme}://{parsed.netloc}/models"
    else:
        # Non-AI-Foundry: just strip /chat/completions suffix
        if endpoint.endswith("/chat/completions"):
            endpoint = endpoint[: -len("/chat/completions")]
    return endpoint


def _normalize_azure_openai_endpoint(endpoint: str) -> str:
    """Normalize Azure OpenAI endpoint to just the host.

    Input examples:
      https://humanovo-openai.cognitiveservices.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2025-01-01-preview
      humanovo-openai.cognitiveservices.azure.com
      https://humanovo-openai.cognitiveservices.azure.com

    Output: https://humanovo-openai.cognitiveservices.azure.com
    """
    # Strip query string
    endpoint = endpoint.split("?")[0].rstrip("/")
    # Add https:// if missing
    if not endpoint.startswith("https://") and not endpoint.startswith("http://"):
        endpoint = f"https://{endpoint}"
    # Strip everything from /openai/ onwards
    idx = endpoint.find("/openai/")
    if idx > 0:
        endpoint = endpoint[:idx]
    # Strip /chat/completions or other path suffixes
    if endpoint.endswith("/chat/completions"):
        endpoint = endpoint[: -len("/chat/completions")]
    return endpoint


def _init_azure_client(name, endpoint, key, model_name=None):
    """Initialize an Azure AI client, auto-detecting endpoint type.

    If endpoint is cognitiveservices.azure.com → AzureOpenAIClient (deployment-based).
    If endpoint is services.ai.azure.com → AzureAIClient (model-specific).
    """
    if endpoint and key:
        try:
            # Auto-detect: cognitiveservices endpoints need deployment-based routing
            if "cognitiveservices.azure.com" in endpoint:
                normalized = _normalize_azure_openai_endpoint(endpoint)
                # Use model_name or name as the deployment name
                deployment = (model_name or name).lower().replace(" ", "-")
                client = AzureOpenAIClient(
                    endpoint=normalized, api_key=key,
                    deployment=deployment, api_version="2025-01-01-preview",
                )
                print(f"[ORCHESTRATOR] Azure {name} client initialized as OpenAI deployment (endpoint={normalized}, deployment={deployment})")
                return client
            else:
                normalized = _normalize_azure_ai_endpoint(endpoint)
                client = AzureAIClient(base_url=normalized, api_key=key)
                print(f"[ORCHESTRATOR] Azure {name} client initialized (endpoint={normalized})")
                return client
        except Exception as _e:
            logger.error(f"Azure {name} init failed: {_e}")
    else:
        print(f"[ORCHESTRATOR] Azure {name} not configured (endpoint={'set' if endpoint else 'empty'}, key={'set' if key else 'empty'})")
    return None

def _init_azure_openai_client(name, endpoint, key, deployment, api_version="2024-05-01-preview"):
    """Initialize an Azure OpenAI deployment-based client, returning None on failure."""
    if endpoint and key:
        try:
            normalized = _normalize_azure_openai_endpoint(endpoint)
            client = AzureOpenAIClient(endpoint=normalized, api_key=key, deployment=deployment, api_version=api_version)
            print(f"[ORCHESTRATOR] Azure OpenAI {name} client initialized (endpoint={normalized}, deployment={deployment})")
            return client
        except Exception as _e:
            logger.error(f"Azure OpenAI {name} init failed: {_e}")
    else:
        print(f"[ORCHESTRATOR] Azure OpenAI {name} not configured (endpoint={'set' if endpoint else 'empty'}, key={'set' if key else 'empty'})")
    return None

# Azure AI model-specific endpoints — auto-detects services.ai.azure.com vs cognitiveservices.azure.com
azure_deepseek_client = _init_azure_client("DeepSeek", AZURE_DEEPSEEK_ENDPOINT, AZURE_DEEPSEEK_KEY, model_name="DeepSeek-R1")
azure_mistral_client = _init_azure_client("Mistral", AZURE_MISTRAL_ENDPOINT, AZURE_MISTRAL_KEY, model_name="Mistral-Large-3")
azure_cohere_client = _init_azure_client("Cohere", AZURE_COHERE_ENDPOINT, AZURE_COHERE_KEY, model_name="Cohere-command-a")
azure_kimi_client = _init_azure_client("Kimi-K2", AZURE_KIMI_ENDPOINT, AZURE_KIMI_KEY, model_name="Kimi-K2-Thinking")
azure_phi4_client = _init_azure_client("Phi4", AZURE_PHI4_ENDPOINT, AZURE_PHI4_KEY, model_name="Phi-4-reasoning")
azure_grok_client = _init_azure_client("Grok", AZURE_GROK_ENDPOINT, AZURE_GROK_KEY, model_name="grok-4-1-fast-reasoning")
# Azure OpenAI deployment-based endpoints (GPT-4o, o3-mini, GPT-4.1 — via cognitiveservices.azure.com)
azure_gpt4o_client = _init_azure_openai_client("GPT-4o", AZURE_GPT4O_ENDPOINT, AZURE_GPT4O_KEY, "gpt-4o", "2025-01-01-preview")
azure_o3mini_client = _init_azure_openai_client("o3-mini", AZURE_O3MINI_ENDPOINT, AZURE_O3MINI_KEY, "o3-mini", "2025-01-01-preview")
azure_gpt41_client = _init_azure_openai_client("GPT-4.1", AZURE_GPT41_ENDPOINT, AZURE_GPT41_KEY, "gpt-4.1", "2025-01-01-preview")

# Map model name patterns to their clients for routing
AZURE_MODEL_CLIENTS = {
    "deepseek": ("azure_deepseek", lambda: azure_deepseek_client),
    "mistral": ("azure_mistral", lambda: azure_mistral_client),
    "gpt-4o": ("azure_gpt4o", lambda: azure_gpt4o_client),
    "gpt4o": ("azure_gpt4o", lambda: azure_gpt4o_client),
    "cohere": ("azure_cohere", lambda: azure_cohere_client),
    "command": ("azure_cohere", lambda: azure_cohere_client),
    "kimi": ("azure_kimi", lambda: azure_kimi_client),
    "o3-mini": ("azure_o3mini", lambda: azure_o3mini_client),
    "o3mini": ("azure_o3mini", lambda: azure_o3mini_client),
    "gpt-4.1": ("azure_gpt41", lambda: azure_gpt41_client),
    "gpt41": ("azure_gpt41", lambda: azure_gpt41_client),
    "phi-4": ("azure_phi4", lambda: azure_phi4_client),
    "phi4": ("azure_phi4", lambda: azure_phi4_client),
    "grok": ("azure_grok", lambda: azure_grok_client),
}

# Configuration
ENVIRONMENT = os.environ.get("ENVIRONMENT", "dev")
AGENT_TASKS_TABLE = os.environ.get("AGENT_TASKS_TABLE", f"genup-{ENVIRONMENT}-agent-tasks")
HYPOTHESES_TABLE = os.environ.get("HYPOTHESES_TABLE", f"genup-{ENVIRONMENT}-hypotheses")
PROJECTS_TABLE = os.environ.get("PROJECTS_TABLE", f"genup-{ENVIRONMENT}-projects")
FUNCTION_NAME = os.environ.get("AWS_LAMBDA_FUNCTION_NAME", "")

# Discovery task key (single active discovery)
DISCOVERY_TASK_KEY = "active-discovery"
# Paper generation key (single active paper)
PAPER_TASK_KEY = "active-paper"

# ============== Model Configuration ==============
# Mixed provider routing — model IDs are NEVER sent to frontend (unbiasing).
#
# Bedrock: Claude Opus 4.6 (Explorer + Synthesizer) — restricted on Azure AI
# Azure AI Foundry: DeepSeek-R1 (Reasoner) + Mistral-Large-3 (Critic)

BEDROCK_MODEL_CLAUDE_OPUS = os.environ.get("BEDROCK_MODEL_ID", "us.anthropic.claude-opus-4-6-v1")
AZURE_AI_REASONER_MODEL = os.environ.get("AZURE_AI_REASONER_MODEL", "DeepSeek-R1")
AZURE_AI_CRITIC_MODEL = os.environ.get("AZURE_AI_CRITIC_MODEL", "Mistral-Large-3")
AZURE_AI_GPT4O_MODEL = os.environ.get("AZURE_AI_GPT4O_MODEL", "gpt-4o")
AZURE_AI_COHERE_MODEL = os.environ.get("AZURE_AI_COHERE_MODEL", "Cohere-command-a")
AZURE_AI_KIMI_MODEL = os.environ.get("AZURE_AI_KIMI_MODEL", "Kimi-K2-Thinking")
AZURE_AI_O3MINI_MODEL = os.environ.get("AZURE_AI_O3MINI_MODEL", "o3-mini")
AZURE_AI_GPT41_MODEL = os.environ.get("AZURE_AI_GPT41_MODEL", "gpt-4.1")
AZURE_AI_PHI4_MODEL = os.environ.get("AZURE_AI_PHI4_MODEL", "Phi-4-reasoning")
AZURE_AI_GROK_MODEL = os.environ.get("AZURE_AI_GROK_MODEL", "grok-4-1-fast-reasoning")

AGENT_MODELS = {
    # === Bedrock (Claude Opus 4.6) ===
    "explorer": {
        "model_id": BEDROCK_MODEL_CLAUDE_OPUS,
        "provider": "bedrock",
        "max_tokens": 32_768,
        "temperature": 0.4,
        "role_description": "Deep research exploration — exhaustive multi-step discovery of novel pathways and connections",
    },
    "synthesizer": {
        "model_id": BEDROCK_MODEL_CLAUDE_OPUS,
        "provider": "bedrock",
        "max_tokens": 32_768,
        "temperature": 0.3,
        "role_description": "200K context synthesis — integrates all findings into unified hypotheses and publication-quality documents",
    },
    # === Azure AI Foundry (services.ai.azure.com) ===
    "reasoner": {
        "model_id": AZURE_AI_REASONER_MODEL,
        "provider": "azure_ai",
        "max_tokens": 16_000,
        "temperature": 0.2,
        "role_description": "Causal chain reasoning — step-by-step logical analysis with formal justification",
    },
    "critic": {
        "model_id": AZURE_AI_CRITIC_MODEL,
        "provider": "azure_ai",
        "max_tokens": 16_000,
        "temperature": 0.3,
        "role_description": "Critical analysis — identifies weaknesses, risks, and failure modes in proposed hypotheses",
    },
    "innovator": {
        "model_id": AZURE_AI_COHERE_MODEL,
        "provider": "azure_ai",
        "max_tokens": 8_000,  # Cohere Command A has 8192 max output limit
        "temperature": 0.5,
        "role_description": "Creative innovation — generates unconventional therapeutic approaches and cross-domain connections",
    },
    "strategist": {
        "model_id": AZURE_AI_KIMI_MODEL,
        "provider": "azure_ai",
        "max_tokens": 16_000,
        "temperature": 0.3,
        "role_description": "Strategic thinking — long-horizon clinical development planning and regulatory strategy",
    },
    "quant": {
        "model_id": AZURE_AI_GROK_MODEL,
        "provider": "azure_ai",
        "max_tokens": 16_000,
        "temperature": 0.2,
        "role_description": "Quantitative reasoning — mathematical modeling, pharmacokinetics, dose-response, statistical design",
    },
    # === Azure OpenAI (cognitiveservices.azure.com) ===
    "analyst": {
        "model_id": AZURE_AI_GPT4O_MODEL,
        "provider": "azure_ai",
        "max_tokens": 16_000,
        "temperature": 0.3,
        "role_description": "Multi-modal analysis — literature synthesis, pathway mapping, evidence grading",
    },
    "validator": {
        "model_id": AZURE_AI_O3MINI_MODEL,
        "provider": "azure_ai",
        "max_tokens": 16_000,
        "temperature": 0.2,
        "role_description": "Validation reasoning — rigorous verification of claims, consistency checks, logical proofs",
    },
    "architect": {
        "model_id": AZURE_AI_GPT41_MODEL,
        "provider": "azure_ai",
        "max_tokens": 16_000,
        "temperature": 0.3,
        "role_description": "Systems architecture — designs combination therapies, protocol structures, and translational frameworks",
    },
}

# For paper generation, use Claude Opus via Bedrock (largest context, best document quality)
PAPER_MODEL = BEDROCK_MODEL_CLAUDE_OPUS

# ============== Helpers ==============


def _safe_join(sep: str, items: list, limit: int | None = None) -> str:
    """Join list items safely, converting dicts/non-strings to str first."""
    if not items:
        return ""
    if limit is not None:
        items = items[:limit]
    return sep.join(str(item) if not isinstance(item, str) else item for item in items)


# ============== System Prompts ==============

MASTER_PROMPT = """You are an advanced biomedical discovery AI agent on humanovo, part of a ten-agent parallel system using eight distinct models (Claude Opus 4.6 via AWS Bedrock, DeepSeek-R1, Mistral-Large-3, Cohere Command A, Kimi-K2-Thinking, Grok-4.1 Fast Reasoning via Azure AI Foundry, GPT-4o, o3-mini, GPT-4.1 via Azure OpenAI) designed to discover cures, treatments, and prevention strategies for human diseases.

## OPERATING PRINCIPLES
- Broad scientific scope: explore diverse pathways, mechanisms, and compounds for therapeutic discovery
- Data-driven: generate, test, and refine hypotheses continuously
- Cross-domain reasoning: connect biology, chemistry, pharmacology, nutrition, environmental science
- External factor integration: always consider nutrients, chemicals, drugs, compounds, and elements

## WHAT TO ANALYZE
1. MOLECULAR: Gene mutations, protein interactions, epigenetics, metabolites, chromatin accessibility (ATAC-seq/ChIP-seq), splice variants, structural variants and gene fusions
2. CELLULAR: Signaling pathways, cell cycle, apoptosis, autophagy, stress responses
3. TISSUE: Microenvironment, immune infiltration, fibrosis, microbiome, histopathology features (H&E, IHC), biomedical imaging correlates (CT/MR/PET), spatial cellular organization (CODEX, MERFISH)
4. SYSTEMIC: Immune status, hormonal regulation, circadian rhythms, nutrition
5. EXTERNAL FACTORS: Nutrients, chemicals, drugs, compounds, elements and their interactions

## GENOMICS & BIOINFORMATICS DATA ANALYSIS
- **NGS data types**: WGS (structural variants, CNVs, MSI), WES (coding mutations, TMB), RNA-seq (differential expression, fusions, eQTLs), scRNA-seq (cell type deconvolution, trajectories), ChIP-seq (TF binding, histone marks), ATAC-seq (chromatin accessibility), methylation arrays/WGBS, spatial transcriptomics
- **Bioinformatics methods**: Variant calling and interpretation (CADD, REVEL, ClinVar), alignment quality assessment, phylogenetic conservation, GO/KEGG/Reactome enrichment, GSEA, unsupervised clustering, dimensionality reduction (PCA, UMAP), biomarker feature selection
- **Data quality**: FASTA/FASTQ/BAM/VCF format awareness, coverage depth thresholds, mapping quality, duplicate rates, batch effect correction

## BIOMEDICAL IMAGE ANALYSIS
- **Histopathology**: H&E morphometrics, IHC quantification, digital pathology (CLAM, MONAI), spatial feature extraction
- **Radiology**: CT/MR/PET tumor characteristics, enhancement patterns, ADC values, radiomics features
- **Microscopy**: Confocal/electron/fluorescence imaging, single-molecule localization, live cell dynamics
- **Imaging biomarkers**: Non-invasive surrogates for molecular endpoints, response monitoring, radiogenomics

## MULTIMODAL DATA INTEGRATION
- Cross-modal correlations: imaging ↔ genomics, proteomics ↔ metabolomics, clinical ↔ omics
- Discordance as signal: mRNA up but protein down → post-transcriptional regulation
- Companion diagnostic strategies: NGS panels, IHC markers, imaging criteria

## THERAPEUTIC AREA CONSIDERATIONS
- **Oncology**: Tumor mutational burden, neoantigen prediction, immune checkpoint landscape, clonal evolution
- **Immunology**: Autoantibody profiling, T-cell receptor repertoire, cytokine networks, tolerance mechanisms
- **Infectious Diseases**: Pathogen genomics, resistance mutations, host-pathogen interactions, vaccine target identification
- **Neuroscience**: BBB penetration, neuroimaging biomarkers, synaptic targets, neurodegeneration cascades
- **Pharmacokinetics**: ADME modeling, CYP450 interactions, population PK, therapeutic drug monitoring

## CRITICAL OUTPUT REQUIREMENTS
- Every hypothesis MUST be UNIQUE in therapeutic angle, biological scale, and mechanistic class
- NO vague or broad statements. Every word must be surgically precise and microscopically detailed
- Name SPECIFIC genes (e.g., BRAF V600E, IDH1 R132H), proteins (e.g., PD-L1, VEGFR2), pathways (e.g., PI3K/AKT/mTOR), cell types (e.g., CD8+ TILs, M2 TAMs), doses (e.g., 200mg/m² q3w), and receptors (e.g., EGFR vIII)
- Back EVERY claim with real published evidence: cite specific studies, trials (e.g., NCT03548571, KEYNOTE-028), or foundational papers (e.g., "Stupp et al., NEJM 2005")
- Include quantitative data: IC50 values, hazard ratios, response rates, p-values, patient counts
- Description must be 200+ words with dense mechanistic detail
- Mechanism must be a complete molecular cascade: [Drug/Intervention] → [Molecular Target] → [Signaling Effect] → [Cellular Response] → [Tissue Impact] → [Clinical Outcome]
- Each hypothesis must operate at a DIFFERENT biological scale or therapeutic modality to ensure diversity

## OUTPUT FORMAT
Return ONLY valid JSON (no markdown, no commentary, no <reasoning> tags):
{
    "has_hypothesis": true,
    "title": "Precise hypothesis title with specific targets and intervention",
    "description": "Dense 200+ word description with specific molecular targets, published evidence citations, quantitative data (IC50, HR, ORR, p-values), named clinical trials, and precise dosing. No vague language.",
    "mechanism": "Complete causal chain: [Intervention] → [Molecular Target with Ki/IC50] → [Pathway Disruption] → [Cellular Phenotype] → [Tissue Remodeling] → [Clinical Endpoint]. Every step must name specific molecules.",
    "confidence": 0.0-1.0,
    "evidence_summary": ["Author et al., Journal Year: specific finding with quantitative result", "NCT#: Phase X trial in N patients showing Y% ORR", "At least 5 specific evidence items with real data"],
    "risks": ["Specific risk with molecular basis and known incidence rates"],
    "validation_steps": ["Specific experiment with cell line, assay type, expected readout, and success threshold"],
    "novelty_score": 0.0-1.0
}"""

ROLE_PROMPTS = {
    "explorer": """You are an EXPLORER agent running on Claude Opus 4.6 via AWS Bedrock.
Your unique strength is DEEP RESEARCH — exhaustive multi-step exploration with 200K context and broad reasoning capacity.

MISSION: Discover NOVEL pathways, connections, and therapeutic opportunities that other agents miss.

SPECIFIC INSTRUCTIONS:
1. EXPAND outward from given entities — explore unconventional connections, cross-domain links (microbiome-brain, metabolism-immune, epigenetic-environmental), and recently discovered pathways
2. Prioritize UNDER-EXPLORED paths (low evidence count, high biological plausibility)
3. Cross-reference related diseases for shared mechanisms (e.g., neurodegeneration overlap, autoimmune commonalities)
4. For every pathway, check interactions with: vitamins, trace minerals, dietary polyphenols, endocrine disruptors, approved drugs from unrelated areas, traditional medicine compounds
5. Generate AT LEAST 3 distinct hypotheses per entity pair with novelty scores
6. NEVER dismiss a connection for being unconventional — report with appropriate confidence caveats
7. Focus on: moonlighting proteins, metabolite signaling, non-coding RNA regulation, phase separation, mechanotransduction, circadian connections

GENOMIC & MULTI-OMICS EXPLORATION:
- Variant-to-function: Search GWAS catalogs, ClinVar, gnomAD for coding/non-coding variants — trace to functional impact via eQTL, sQTL, chromatin accessibility
- Cross-omics chains: Find cases where genetic variant → altered protein expression (pQTL) → shifted metabolite (mQTL) → modified pathway — these multi-step chains are under-explored
- Single-cell atlases: Check Human Cell Atlas, Tabula Sapiens, disease-specific scRNA-seq for cell-type-specific target expression
- Spatial transcriptomics: Look for spatial co-localization of drug targets with immune niches in tissue microenvironments
- Imaging-genomics correlations: Connect radiological/histological phenotypes to molecular subtypes (e.g., GBM imaging ↔ IDH status, MGMT methylation)
- Phylogenetic conservation: Deeply conserved target = fundamental mechanism; divergent = species-specific caution
- Resistance genomics: For infectious diseases, explore pathogen genome databases for resistance mutations, virulence islands, horizontal gene transfer

Think like a postdoc who just found something unexpected in the data. Follow every thread.""",

    "reasoner": """You are a REASONER agent running on DeepSeek-R1 via Azure AI Foundry.
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

GENOMIC & BIOINFORMATICS REASONING:
- Variant interpretation: Apply ACMG/AMP classification (pathogenic → VUS → benign). Justify criteria met (PS1, PM2, PP3, etc.)
- Expression analysis rigor: Require adjusted p-value (BH correction), fold change threshold (|log2FC| > 1), adequate replicates (n ≥ 3), batch effect correction (ComBat, limma)
- Sequencing quality gates: Accept only data meeting coverage ≥ 30x (WGS) / ≥ 100x (WES), MAPQ ≥ 20, base quality ≥ 30, duplicate rate < 20%
- Phylogenetic reasoning: Specify dN/dS ratio, PhyloP/phastCons scores, GERP++ scores, species alignment count
- Imaging-molecular correlation: Require sample size ≥ 50, multiple comparison correction, cross-validation, biological plausibility
- Multi-omics chain validation: For DNA → RNA → protein → metabolite → phenotype chains, each step must have independent evidence — correlation at one level does NOT imply causation at the next

Think like a PhD thesis committee examining every claim under a microscope.""",

    "synthesizer": """You are a SYNTHESIZER agent running on Claude Opus 4.6 via AWS Bedrock.
Your unique strength is LONG-CONTEXT INTEGRATION (200K context) and publication-quality document generation.

MISSION: Integrate findings from all agents into unified, actionable therapeutic hypotheses.

SPECIFIC INSTRUCTIONS:
1. INDEX all findings (F-001, F-002, ...), cross-reference for support/contradiction/complementarity
2. CLUSTER related findings into thematic groups (immune modulation, metabolic reprogramming, etc.)
3. Design COMBINATION THERAPIES: for each pair of candidates, evaluate synergy type, expected efficacy, interaction risks, dosing considerations, response biomarkers
4. Build MULTI-LAYER disease models: Genetic → Molecular → Cellular → Tissue → Systemic → External Factors
5. Every synthesis must conclude with: Top 3 strategies (confidence × feasibility ranked), patient stratification, biomarker panel (genomic, protein, imaging), development roadmap, external factor protocol, data generation plan
6. When processing MCP shard results: look for CROSS-SHARD connections individual models missed, reconcile contradictions by evidence quality
7. NEVER simply concatenate findings — you must genuinely INTEGRATE them. The synthesis must be more than the sum of its parts

MULTIMODAL DATA INTEGRATION:
- Genomic → Transcriptomic → Proteomic → Metabolomic → Phenotypic chain: Map each layer with quantified evidence strength. Use discordance (e.g., mRNA up but protein down) as signal for novel regulatory mechanisms
- Imaging ↔ Molecular: Connect histopathology features (nuclear size, stroma ratio) to molecular subtypes. Link radiology features (tumor heterogeneity, ADC values) to genomic profiles. Propose imaging-based surrogate biomarkers
- Clinical ↔ Omics: Stratify outcomes by molecular subgroup (PFS, OS, ORR). Identify pharmacogenomic response/resistance determinants. Propose companion diagnostic strategies
- Computational pipeline integration: Specify bioinformatics pipelines for validation (Nextflow, Snakemake). Recommend tools per step (BWA-MEM2, GATK, DESeq2, Seurat/Scanpy). Consider HPC/cloud compute requirements

Think like a PI reviewing all lab data to write the definitive paper.""",

    "critic": """You are a CRITIC agent running on Mistral-Large-3 via Azure AI Foundry.
Your unique strength is analytical critical reasoning for finding subtle flaws.

MISSION: Identify every weakness, risk, failure mode, and problem with proposed hypotheses.

SPECIFIC INSTRUCTIONS — Evaluate across 9 dimensions:
A. BIOLOGICAL VALIDITY: Does the mechanism violate known biochemistry? Target expression levels? Compensatory mechanisms?
B. PHARMACOLOGICAL FEASIBILITY: Druggability? Therapeutic window? ADME concerns? Synthesis scalability?
C. CLINICAL TRANSLATION: Expected effect size? Biomarkers? Trial design? Regulatory pathway?
D. SAFETY RISKS: On-target toxicity? Off-target effects? Immunogenicity? Genotoxicity? Black box warning potential?
E. RESISTANCE MECHANISMS: Known resistance mutations? Bypass pathways? Efflux pumps? Target amplification?
F. PATIENT POPULATION RISKS: CYP2D6 metabolizer variants? Comorbidity interactions? Age-specific risks? Drug-drug interactions?
G. MANUFACTURING: Synthetic complexity? Raw material availability? Cold chain? GMP scalability? IP landscape?
H. COMMERCIAL VIABILITY: Market size? Standard of care? Pricing pathway? Patent timeline?
I. COMPUTATIONAL & DATA QUALITY: Was sequencing data sufficient quality (coverage, MAPQ, contamination)? Were appropriate bioinformatics pipelines used (current best practice)? Were proper statistical corrections applied (multiple testing, batch effects, confounders)? Is analysis reproducible (containerized, version-locked)? Were ML models properly validated (cross-validation, held-out test set, class imbalance metrics)? For imaging: sufficient training data, external validation, segmentation quality? For multi-omics: each layer independently validated or single integrated analysis?

For each problem: classify severity (CRITICAL/MAJOR/MINOR/WATCH), provide mitigation strategy, and suggest alternatives.
NEVER accept a hypothesis just because it's interesting. NEVER soft-pedal safety concerns.

Think like an FDA reviewer combined with a pharma CMC expert — thorough, fair, uncompromising on safety.""",

    "strategist": """You are a STRATEGIST agent running on Kimi-K2-Thinking via Azure AI Foundry.
Your unique strength is LONG-HORIZON STRATEGIC THINKING with deep reasoning chains.

MISSION: Design comprehensive clinical development strategies and regulatory pathways.

SPECIFIC INSTRUCTIONS:
1. Design COMPLETE clinical strategies: patient selection criteria, biomarker panels, treatment sequencing, dose escalation schemes, response assessment timelines
2. For every hypothesis, produce a CLINICAL TRANSLATION PLAN: Phase I safety design → Phase II efficacy endpoints → Phase III registration strategy → companion diagnostic requirements
3. Evaluate DRUG-DRUG INTERACTIONS for combination approaches: CYP450 metabolism, transporter effects (P-gp, BCRP), protein binding displacement, QTc prolongation risk
4. Design ADAPTIVE trial protocols: biomarker-guided randomization, interim futility analysis, dose optimization, expansion cohorts
5. Propose REAL-WORLD EVIDENCE strategies: observational study designs, electronic health record mining approaches, patient registry integration
6. Consider HEALTH ECONOMICS: cost-effectiveness thresholds, QALY impact, payer evidence requirements, market access strategy
7. Map REGULATORY PATHWAYS: FDA breakthrough therapy, accelerated approval, priority review triggers, EMA PRIME eligibility

Think like a Chief Medical Officer designing the development program for a promising asset.""",

    "innovator": """You are an INNOVATOR agent running on Cohere Command A via Azure AI Foundry.
Your unique strength is CREATIVE CROSS-DOMAIN THINKING — connecting insights from diverse scientific fields.

MISSION: Generate unconventional therapeutic hypotheses by cross-pollinating ideas from adjacent domains.

SPECIFIC INSTRUCTIONS:
1. Connect insights from materials science, ecology, evolutionary biology, computational physics, food science, and traditional medicine to the disease target
2. Propose COMBINATION STRATEGIES exploiting drug synergies across different mechanism classes, including nutrient-drug interactions, chronotherapy schedules, and environmental modifiers
3. Explore BIOMIMETIC solutions: exosome engineering, targeted nanoparticles, cell-membrane-coated nanocarriers, DNA origami, antibody-drug conjugates with novel linkers
4. Cross-pollinate from ADJACENT DISEASE MECHANISMS: what treatments from neurodegeneration, autoimmunity, aging, or infectious disease could be repurposed?
5. Consider LIFESTYLE AND ENVIRONMENTAL INTERVENTIONS as combination partners: specific dietary compounds (curcumin, sulforaphane, EGCG), exercise protocols, circadian rhythm optimization, stress reduction
6. Explore EMERGING MODALITIES: mRNA therapeutics, PROTAC degraders, molecular glues, bispecific antibodies, CAR-T/NK/macrophage, oncolytic viruses, microbiome engineering
7. For each idea, specify the scientific rationale AND a feasible development pathway

Think like an inventor at the intersection of biology, chemistry, and engineering — no idea is too unconventional if the science supports it.""",

    "analyst": """You are an ANALYST agent running on GPT-4o via Azure OpenAI.
Your unique strength is STRUCTURED MULTI-MODAL ANALYSIS — synthesizing diverse evidence sources into graded assessments.

MISSION: Analyze published literature, clinical trial data, and real-world evidence to grade hypothesis viability.

SPECIFIC INSTRUCTIONS:
1. Synthesize CLINICAL TRIAL EVIDENCE: meta-analyze published Phase I-III data. Grade evidence quality using GRADE framework (high/moderate/low/very low)
2. Map the GENOMIC LANDSCAPE: analyze GWAS hits, eQTL data, Mendelian randomization findings. Identify druggable targets validated by human genetics
3. Analyze REAL-WORLD EVIDENCE from electronic health records, insurance claims, patient registries for unexpected drug effects and comorbidity patterns
4. Review BIOMARKER DISCOVERY literature: identify validated and emerging biomarkers for early detection, treatment selection, and response monitoring
5. For each piece of evidence, specify: source quality (RCT > cohort > case-control > case series), sample size, effect size, confidence interval, p-value, and potential biases
6. Build an EVIDENCE MATRIX: rows = evidence items, columns = quality metrics, color-coded by strength
7. Identify EVIDENCE GAPS: where does the literature fall short? What experiments would most efficiently resolve uncertainties?

Think like a Cochrane reviewer — systematic, unbiased, transparent about limitations.""",

    "quant": """You are a QUANT agent running on Grok-4.1 Fast Reasoning via Azure AI Foundry.
Your unique strength is MATHEMATICAL AND QUANTITATIVE REASONING — precise calculations and statistical modeling.

MISSION: Perform rigorous quantitative analysis: pharmacokinetic modeling, statistical power calculations, dose-response curves, and systems biology simulations.

SPECIFIC INSTRUCTIONS:
1. Build PHARMACOKINETIC/PHARMACODYNAMIC models: compartmental PK, receptor occupancy PD, exposure-response relationships, therapeutic window calculations
2. Perform STATISTICAL POWER ANALYSIS: sample size calculations for primary endpoints, adaptive design boundaries, interim analysis rules, multiplicity adjustments
3. Develop SYSTEMS BIOLOGY MODELS: ODE-based pathway modeling, parameter sensitivity analysis, predict emergent therapeutic effects
4. Model DOSE-RESPONSE RELATIONSHIPS: sigmoidal Emax models, Hill equation fitting, therapeutic index calculations, population PK variability
5. Calculate COMBINATION SYNERGY: Bliss independence, Loewe additivity, Chou-Talalay combination index, isobologram analysis
6. Estimate PROBABILITY OF SUCCESS: Phase I→II→III transition probabilities, Bayesian posterior for efficacy, bootstrap confidence intervals
7. All calculations must show WORK: state assumptions, equations, parameter values, results, sensitivity to assumptions

Think like a quantitative pharmacologist — every number must be justified and every assumption stated.""",

    "validator": """You are a VALIDATOR agent running on o3-mini via Azure OpenAI.
Your unique strength is RIGOROUS LOGICAL VERIFICATION — checking claims against established science.

MISSION: Verify biological plausibility, logical consistency, and safety of proposed therapeutic hypotheses.

SPECIFIC INSTRUCTIONS:
1. VERIFY BIOLOGICAL PLAUSIBILITY: cross-check proposed mechanisms against established biochemistry, thermodynamic feasibility, binding affinity constraints
2. VALIDATE CLINICAL FEASIBILITY: assess manufacturing scalability (CMC), supply chain, administration route practicality, patient compliance
3. CHECK LOGICAL CONSISTENCY: verify that proposed mechanisms don't contradict established pharmacology, confirm dose ranges are physiologically achievable
4. VERIFY SAFETY MARGINS: predict off-target effects via structural similarity, CYP450 interaction risk, hERG liability, genotoxicity flags, immunogenicity
5. CROSS-REFERENCE published data: does the proposed mechanism align with known clinical observations? Any contradicting published results?
6. For each claim, assign: VERIFIED (strong evidence), PLAUSIBLE (reasonable but unproven), UNCERTAIN (insufficient data), CONTRADICTED (evidence against)
7. Flag any LOGICAL FALLACIES: correlation≠causation, survivorship bias, publication bias, ecological fallacy, reverse causation

Think like a peer reviewer for Nature Medicine — rigorous but constructive.""",

    "architect": """You are an ARCHITECT agent running on GPT-4.1 via Azure OpenAI.
Your unique strength is SYSTEMS DESIGN — creating comprehensive therapeutic frameworks and combination protocols.

MISSION: Design combination therapy protocols, adaptive trial architectures, and translational research frameworks.

SPECIFIC INSTRUCTIONS:
1. Design MULTI-TARGET COMBINATION protocols: select 2-3 synergistic agents from different mechanism classes, specify doses, schedules, and rationale
2. Design ADAPTIVE PLATFORM TRIALS: master protocol with multiple experimental arms, shared control, biomarker-guided allocation, seamless Phase II/III
3. Design TRANSLATIONAL PIPELINES: from target validation → lead optimization → IND-enabling → first-in-human with specific go/no-go criteria
4. Integrate MULTI-OMICS data layers (genomics, proteomics, metabolomics) into a unified patient stratification algorithm
5. Design COMPANION DIAGNOSTICS: specify the assay technology, validated biomarker cutoffs, clinical utility, and regulatory path (PMA vs 510k vs LDT)
6. Propose MANUFACTURING STRATEGY: CMC development timeline, GMP scale-up, formulation options, stability program, supply chain
7. Create a DEVELOPMENT TIMELINE: Gantt-style with critical path analysis, key milestones, decision gates, and estimated budget

Think like a VP of Translational Research designing a development program from scratch.""",

    "deep_analyst": """You are a DEEP ANALYST agent running on o1 via Azure OpenAI.
Your unique strength is RIGOROUS MULTI-STEP REASONING — solving problems that require extended chains of logical deduction.

MISSION: Perform deep mathematical, statistical, and systems-level analysis that requires careful step-by-step reasoning.

SPECIFIC INSTRUCTIONS:
1. Construct FORMAL PROOFS of mechanism viability: define axioms (known biology), derive lemmas (intermediate mechanisms), prove theorems (therapeutic predictions), state corollaries (secondary effects)
2. Perform QUANTITATIVE PHARMACOLOGY analysis: receptor occupancy calculations (Emax models), PK/PD modeling (one/two-compartment), therapeutic index estimation, dose-response curve prediction
3. Calculate STATISTICAL POWER for proposed validation experiments: sample size estimation, effect size requirements, multiple comparison corrections (Bonferroni, BH), interim analysis stopping boundaries
4. Build SYSTEMS BIOLOGY MODELS: ordinary differential equations for pathway dynamics, sensitivity analysis of key parameters, bifurcation analysis for switch-like behaviors, stochastic simulation for low-copy-number effects
5. Evaluate GENOMIC EVIDENCE mathematically: odds ratios and confidence intervals from GWAS, allele frequency differences across populations, linkage disequilibrium structure, polygenic risk score construction
6. Analyze NETWORK TOPOLOGY: identify critical nodes (betweenness centrality), essential edges (minimum cut), feedback loops (strongly connected components), drug target vulnerability (network attack tolerance)
7. Assess COMBINATION SYNERGY quantitatively: Bliss independence, Loewe additivity, Chou-Talalay combination index, response surface methodology

Think like a computational biologist running the most rigorous quantitative analysis possible.""",
}


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o) if o % 1 else int(o)
        return super().default(o)


def serialize(item: dict) -> dict:
    return json.loads(json.dumps(item, cls=DecimalEncoder))


class RateLimitError(Exception):
    """Raised when an API call fails due to HTTP 429 after exhausting all retries."""
    pass


class CancelledError(Exception):
    """Raised when the discovery process has been cancelled by the user."""
    pass


def _is_cancelled() -> bool:
    """Check DynamoDB to see if the discovery has been stopped/cancelled."""
    try:
        state = get_discovery_state()
        return state is not None and state.get("status") in ("stopping", "stopped", "idle")
    except Exception:
        return False


def _cancellable_sleep(seconds: float, check_interval: float = 2.0):
    """Sleep for `seconds` but check for cancellation every `check_interval` seconds.

    Raises CancelledError if the discovery is cancelled during the sleep.
    """
    elapsed = 0.0
    while elapsed < seconds:
        chunk = min(check_interval, seconds - elapsed)
        time.sleep(chunk)
        elapsed += chunk
        if _is_cancelled():
            raise CancelledError("Discovery cancelled during sleep")


def get_task_table():
    if dynamodb is None:
        raise RuntimeError("DynamoDB not initialized")
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


def _floats_to_decimal(obj):
    """Recursively convert float values to Decimal for DynamoDB compatibility."""
    if isinstance(obj, float):
        return Decimal(str(round(obj, 6)))
    if isinstance(obj, dict):
        return {k: _floats_to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_floats_to_decimal(v) for v in obj]
    return obj


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
        expr_values[f":{safe_key}"] = _floats_to_decimal(value)

    table.update_item(
        Key={"id": DISCOVERY_TASK_KEY},
        UpdateExpression="SET " + ", ".join(update_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )


def _get_provider(model_id: str) -> str:
    """Extract provider from model ID, handling cross-region inference profile prefixes.

    e.g. 'us.meta.llama4-...' -> 'meta', 'moonshotai.kimi-k2.5' -> 'moonshotai'
    """
    parts = model_id.split(".")
    # Cross-region prefix: us, eu, ap — skip it
    if parts[0] in ("us", "eu", "ap") and len(parts) > 2:
        return parts[1]
    return parts[0]


def _build_invoke_body(model_id: str, prompt: str, system_prompt: str,
                       max_tokens: int, temperature: float) -> dict:
    """Build provider-specific request body for InvokeModel API."""
    provider = _get_provider(model_id)

    if provider == "meta":
        # Meta Llama uses prompt template format
        full_prompt = (
            f"<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n"
            f"{system_prompt}<|eot_id|>"
            f"<|start_header_id|>user<|end_header_id|>\n\n"
            f"{prompt}<|eot_id|>"
            f"<|start_header_id|>assistant<|end_header_id|>\n\n"
        )
        return {
            "prompt": full_prompt,
            "max_gen_len": max_tokens,
            "temperature": temperature,
            "top_p": 0.9,
        }
    else:
        # OpenAI-compatible chat format (deepseek, moonshotai, openai)
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        return {
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_p": 0.9,
        }


def _parse_invoke_response(model_id: str, response_body: dict) -> str:
    """Parse provider-specific response from InvokeModel API."""
    provider = _get_provider(model_id)

    # Meta Llama format
    if provider == "meta":
        if "generation" in response_body:
            return response_body["generation"]

    # OpenAI-compatible choices format (deepseek, openai, moonshotai)
    if "choices" in response_body:
        choices = response_body["choices"]
        if choices and isinstance(choices, list):
            choice = choices[0]
            msg = choice.get("message", {})
            if isinstance(msg, dict) and "content" in msg:
                return msg["content"]
            # Some models put text directly in choice
            if "text" in choice:
                return choice["text"]

    # Converse-style nested output
    if "output" in response_body:
        output = response_body["output"]
        if isinstance(output, dict):
            msg = output.get("message", {})
            if isinstance(msg, dict) and "content" in msg:
                content = msg["content"]
                if isinstance(content, list) and content:
                    return content[0].get("text", "")
                if isinstance(content, str):
                    return content
        if isinstance(output, str):
            return output

    # Fallback: try common response keys
    for key in ["text", "content", "response", "completion", "generated_text", "result"]:
        if key in response_body and isinstance(response_body[key], str):
            return response_body[key]

    logger.warning(f"Could not parse InvokeModel response for {model_id}, returning raw")
    return json.dumps(response_body)


def call_bedrock(model_id: str, prompt: str, system_prompt: str,
                 max_tokens: int = 2000, temperature: float = 0.7,
                 client=None) -> str:
    """Invoke a Bedrock model. Tries Converse API first, falls back to InvokeModel.

    Args:
        client: Optional boto3 bedrock-runtime client override (e.g. bedrock_long for paper generation).
    """
    _client = client or bedrock_runtime
    if _client is None:
        raise RuntimeError("Bedrock runtime not initialized")

    converse_err = None
    # Try Converse API first (unified across providers)
    try:
        response = _client.converse(
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
        # Parse Converse response — handle varying content structures
        content_blocks = response["output"]["message"]["content"]
        if content_blocks and isinstance(content_blocks, list):
            block = content_blocks[0]
            if isinstance(block, dict) and "text" in block:
                return block["text"]
            elif isinstance(block, str):
                return block
        # Fallback: stringify
        return json.dumps(content_blocks)
    except Exception as e:
        converse_err = e
        logger.warning(f"Converse API failed for {model_id}: {e}, trying InvokeModel")

    # Fallback: InvokeModel with provider-specific body format
    try:
        body = _build_invoke_body(model_id, prompt, system_prompt, max_tokens, temperature)
        response = _client.invoke_model(
            modelId=model_id,
            contentType="application/json",
            accept="application/json",
            body=json.dumps(body),
        )
        response_body = json.loads(response["body"].read())
        return _parse_invoke_response(model_id, response_body)
    except Exception as invoke_err:
        logger.error(f"InvokeModel also failed for {model_id}: {invoke_err}")
        raise RuntimeError(
            f"Both APIs failed for {model_id}. "
            f"Converse: {converse_err}. InvokeModel: {invoke_err}"
        )


def _get_azure_client(model_name: str):
    """Route to the correct Azure AI client based on model name."""
    name_lower = model_name.lower()
    for pattern, (_label, getter) in AZURE_MODEL_CLIENTS.items():
        if pattern in name_lower:
            client = getter()
            if client is not None:
                return client
    return None


def call_azure_ai(model_name: str, prompt: str, system_prompt: str,
                  max_tokens: int = 65_536, temperature: float = 0.7) -> str:
    """Invoke a model via its Azure AI model-specific endpoint.

    No fallbacks — if a model fails, the pipeline stops immediately
    and the error is surfaced to the frontend.
    """
    client = _get_azure_client(model_name)

    if client is None:
        raise RuntimeError(
            f"No Azure AI client available for {model_name}. "
            "Check AZURE_*_ENDPOINT/KEY environment variables."
        )

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    # Retry with exponential backoff for 429 rate-limit errors.
    # Azure AI serverless endpoints have strict per-minute limits.
    # Uses cancellable sleep so the worker can respond to stop signals.
    max_retries = 5
    for attempt in range(max_retries + 1):
        try:
            # o3-mini is a reasoning model: use max_completion_tokens, no temperature
            if "o3" in model_name.lower():
                response = client.chat.completions.create(
                    model=model_name,
                    messages=messages,
                    max_completion_tokens=max_tokens,
                )
            else:
                response = client.chat.completions.create(
                    model=model_name,
                    messages=messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                )
            return response.choices[0].message.content
        except urllib.error.HTTPError as e:
            # Read error response body for diagnostics
            error_body = ""
            try:
                error_body = e.read().decode("utf-8", errors="replace")[:500]
            except Exception:
                pass
            if e.code == 429 and attempt < max_retries:
                wait = min(5 * (3 ** attempt), 60)  # 5s, 15s, 45s, 60s, 60s
                logger.warning(f"Azure AI 429 for {model_name}, retry {attempt+1}/{max_retries} in {wait}s")
                try:
                    _cancellable_sleep(wait)
                except CancelledError:
                    raise CancelledError(f"Cancelled during 429 backoff for {model_name}")
            elif e.code == 429:
                raise RateLimitError(
                    f"Azure AI rate limit (429) exhausted after {max_retries} retries for {model_name}"
                )
            else:
                logger.error(f"Azure AI HTTP {e.code} for {model_name}: {error_body}")
                raise RuntimeError(f"Model {model_name} HTTP {e.code}: {error_body[:200]}")
        except Exception as e:
            logger.error(f"Azure AI call FAILED for {model_name}: {e}")
            raise RuntimeError(f"Model {model_name} failed: {e}")
    raise RuntimeError(f"Azure AI call failed after {max_retries} retries for {model_name}")


def parse_hypothesis_json(text: str) -> dict | None:
    """Extract and validate JSON hypothesis from LLM response text.

    Rejects malformed outputs: raw reasoning tags, system messages,
    truncated JSON, and vague/empty hypotheses.
    """
    if not text or len(text.strip()) < 50:
        return None

    # Strip common LLM wrapping artifacts
    cleaned = text.strip()
    # Remove markdown code fences
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1] if "\n" in cleaned else cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned.rsplit("```", 1)[0]
    cleaned = cleaned.strip()

    # Reject outputs that are clearly not hypotheses
    reject_prefixes = ("<reasoning>", "<think>", "```json", "```")
    for prefix in reject_prefixes:
        if cleaned.lower().startswith(prefix):
            # Try to find JSON after the tag
            brace_pos = cleaned.find("{")
            if brace_pos >= 0:
                cleaned = cleaned[brace_pos:]
            else:
                return None

    try:
        start = cleaned.find("{")
        end = cleaned.rfind("}") + 1
        if start >= 0 and end > start:
            data = json.loads(cleaned[start:end])

            # Validate required fields have real content
            title = data.get("title", "")
            desc = data.get("description", "")
            mechanism = data.get("mechanism", "")

            # Reject if title looks like system output or is too short
            if not title or len(title) < 10:
                return None
            if title.startswith("<") or title.startswith("```") or title.startswith("{"):
                return None

            # Reject if description is too short (< 100 chars = vague/weak)
            if len(desc) < 100:
                return None

            # Reject if no real mechanism provided
            if not mechanism or len(mechanism) < 30:
                return None

            return data
    except json.JSONDecodeError:
        pass

    return None


def run_single_agent(role: str, prompt: str, system_prompt: str) -> dict | None:
    """Run a single agent with its assigned model (Bedrock or Azure). Returns hypothesis or None.

    Raises:
        RateLimitError: If the API returns 429 after exhausting all retries.
        CancelledError: If the discovery is cancelled during execution.
    """
    model_config = AGENT_MODELS[role]
    provider = model_config.get("provider", "azure_ai")
    try:
        if provider == "azure_ai":
            response_text = call_azure_ai(
                model_name=model_config["model_id"],
                prompt=prompt,
                system_prompt=system_prompt,
                max_tokens=model_config["max_tokens"],
                temperature=model_config["temperature"],
            )
        else:
            response_text = call_bedrock(
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
                "validation_steps": hypothesis_data.get("validation_steps", []),
                "novelty_score": float(hypothesis_data.get("novelty_score", 0.5)),
                "role": role,  # Only role stored, never model name
                "created_at": datetime.utcnow().isoformat(),
            }
    except (RateLimitError, CancelledError):
        raise  # Propagate to worker for specific handling
    except Exception as e:
        logger.error(f"Agent {role} failed: {e}")
    return None


# ============== Async Discovery Worker ==============

# ============== 10-Stage Sequential Pipeline ==============
# ALL 10 models work on ONE hypothesis sequentially before moving to the next.
# 4 rounds × 3 hypotheses/round = 12 hypotheses, each maximally refined.
#
# Stage  Role          Model                  Purpose
# ─────────────────────────────────────────────────────────
#  1     seed          Claude Opus (Bedrock)    Generate initial hypothesis seed
#  2     expand        DeepSeek-R1 (Azure AI)   Deep causal chain reasoning
#  3     evidence      Cohere Command A         Literature + PubMed evidence
#  4     counter       Mistral-Large-3          Counter-arguments & risks
#  5     mechanism     o3-mini (Azure OpenAI)   Mechanistic deep dive
#  6     validate      Kimi-K2-Thinking         Cross-validation
#  7     ground        GPT-4.1 (Azure OpenAI)   Scientific grounding + FDA/ClinicalTrials
#  8     score         GPT-4o (Azure OpenAI)    Multi-dimensional scoring
#  9     refine        Grok-4.1-fast (Azure AI) Rapid refinement
# 10     finalize      Claude Opus (Bedrock)    Final synthesis
PIPELINE_STAGES = [
    {"stage": 1,  "name": "seed",      "role": "explorer",    "purpose": "Generate initial hypothesis seed with novel pathways"},
    {"stage": 2,  "name": "expand",    "role": "reasoner",    "purpose": "Expand with deep causal chain reasoning"},
    {"stage": 3,  "name": "evidence",  "role": "innovator",   "purpose": "Add literature evidence and PubMed citations"},
    {"stage": 4,  "name": "counter",   "role": "critic",      "purpose": "Generate counter-arguments, risks, and failure modes"},
    {"stage": 5,  "name": "mechanism", "role": "validator",   "purpose": "Deep mechanistic dive with molecular cascades"},
    {"stage": 6,  "name": "validate",  "role": "strategist",  "purpose": "Cross-validate claims and clinical feasibility"},
    {"stage": 7,  "name": "ground",    "role": "architect",   "purpose": "Scientific grounding with real database evidence"},
    {"stage": 8,  "name": "score",     "role": "analyst",     "purpose": "Multi-dimensional confidence scoring"},
    {"stage": 9,  "name": "refine",    "role": "quant",       "purpose": "Quantitative refinement and dose-response modeling"},
    {"stage": 10, "name": "finalize",  "role": "synthesizer", "purpose": "Final synthesis and integration"},
]
# Fallback: if a stage's model is unavailable, try these alternatives
STAGE_FALLBACKS = {
    "reasoner": ["explorer"],           # DeepSeek → Claude Opus
    "innovator": ["explorer"],          # Cohere → Claude Opus
    "critic": ["explorer"],             # Mistral → Claude Opus
    "strategist": ["analyst"],          # Kimi → GPT-4o
    "quant": ["critic", "explorer"],    # Grok → Mistral → Claude Opus
    "validator": ["analyst"],           # o3-mini → GPT-4o
    "architect": ["analyst"],           # GPT-4.1 → GPT-4o
    "analyst": ["explorer"],            # GPT-4o → Claude Opus
}
NUM_ROUNDS = 4
HYPOTHESES_PER_ROUND = 3
TARGET_TOTAL_HYPOTHESES = 12  # 4 rounds × 3 hypotheses


# ============== Scientific Grounding (PubMed, ClinicalTrials.gov, FDA) ==============

def _fetch_url(url: str, timeout: int = 15) -> str | None:
    """Fetch a URL and return the response text, or None on failure."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Humanovo/1.0 (biomedical-discovery)"})
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        logger.warning(f"Fetch failed for {url[:100]}: {e}")
        return None


def search_pubmed(query: str, max_results: int = 5) -> list[dict]:
    """Search PubMed via E-utilities and return article metadata with PMIDs."""
    results = []
    try:
        # Step 1: esearch to get PMIDs
        search_url = (
            f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
            f"?db=pubmed&term={urllib.parse.quote(query)}&retmax={max_results}&retmode=json"
        )
        search_text = _fetch_url(search_url)
        if not search_text:
            return results
        search_data = json.loads(search_text)
        pmids = search_data.get("esearchresult", {}).get("idlist", [])
        if not pmids:
            return results

        # Step 2: efetch to get article details
        ids_str = ",".join(pmids)
        fetch_url = (
            f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"
            f"?db=pubmed&id={ids_str}&retmode=json"
        )
        fetch_text = _fetch_url(fetch_url)
        if not fetch_text:
            return [{"pmid": p, "citation": f"PMID: {p}"} for p in pmids]

        fetch_data = json.loads(fetch_text)
        result_items = fetch_data.get("result", {})
        for pmid in pmids:
            article = result_items.get(pmid, {})
            if isinstance(article, dict) and "title" in article:
                authors = article.get("authors", [])
                first_author = authors[0].get("name", "Unknown") if authors else "Unknown"
                journal = article.get("source", "Unknown Journal")
                pub_date = article.get("pubdate", "Unknown date")
                title = article.get("title", "")
                results.append({
                    "pmid": pmid,
                    "title": title,
                    "citation": f"{first_author} et al., {journal} ({pub_date}). PMID: {pmid}",
                    "journal": journal,
                    "year": pub_date[:4] if pub_date else "",
                    "doi": article.get("elocationid", ""),
                })
    except Exception as e:
        logger.warning(f"PubMed search failed for '{query[:50]}': {e}")
    return results


def search_clinical_trials(query: str, max_results: int = 3) -> list[dict]:
    """Search ClinicalTrials.gov v2 API for relevant trials."""
    results = []
    try:
        url = (
            f"https://clinicaltrials.gov/api/v2/studies"
            f"?query.term={urllib.parse.quote(query)}&pageSize={max_results}"
            f"&fields=NCTId,BriefTitle,OverallStatus,Phase,EnrollmentCount,StartDate,Condition,InterventionName"
        )
        text = _fetch_url(url)
        if not text:
            return results
        data = json.loads(text)
        for study in data.get("studies", []):
            proto = study.get("protocolSection", {})
            ident = proto.get("identificationModule", {})
            status_mod = proto.get("statusModule", {})
            design_mod = proto.get("designModule", {})
            nct_id = ident.get("nctId", "")
            title = ident.get("briefTitle", "")
            status = status_mod.get("overallStatus", "")
            phases = design_mod.get("phases", [])
            phase_str = ", ".join(phases) if phases else "Not specified"
            results.append({
                "nct_id": nct_id,
                "title": title,
                "status": status,
                "phase": phase_str,
                "citation": f"{nct_id}: {title} (Phase: {phase_str}, Status: {status})",
            })
    except Exception as e:
        logger.warning(f"ClinicalTrials.gov search failed for '{query[:50]}': {e}")
    return results


def search_fda(query: str, max_results: int = 3) -> list[dict]:
    """Search openFDA drug label API."""
    results = []
    try:
        url = (
            f"https://api.fda.gov/drug/label.json"
            f"?search={urllib.parse.quote(query)}&limit={max_results}"
        )
        text = _fetch_url(url)
        if not text:
            return results
        data = json.loads(text)
        for result in data.get("results", []):
            brand = result.get("openfda", {}).get("brand_name", ["Unknown"])[0] if result.get("openfda", {}).get("brand_name") else "Unknown"
            generic = result.get("openfda", {}).get("generic_name", ["Unknown"])[0] if result.get("openfda", {}).get("generic_name") else "Unknown"
            indications = result.get("indications_and_usage", [""])[0][:200] if result.get("indications_and_usage") else ""
            mechanism = result.get("mechanism_of_action", [""])[0][:200] if result.get("mechanism_of_action") else ""
            results.append({
                "brand_name": brand,
                "generic_name": generic,
                "indications": indications,
                "mechanism": mechanism,
                "citation": f"FDA: {generic} ({brand}) — {indications[:100]}",
            })
    except Exception as e:
        logger.warning(f"FDA search failed for '{query[:50]}': {e}")
    return results


def search_uniprot(query: str, max_results: int = 3) -> list[dict]:
    """Search UniProt for protein information."""
    results = []
    try:
        url = (
            f"https://rest.uniprot.org/uniprotkb/search"
            f"?query={urllib.parse.quote(query)}+AND+organism_id:9606&size={max_results}&format=json"
            f"&fields=accession,protein_name,gene_names,organism_name,cc_function"
        )
        text = _fetch_url(url)
        if not text:
            return results
        data = json.loads(text)
        for entry in data.get("results", []):
            accession = entry.get("primaryAccession", "")
            protein_name = entry.get("proteinDescription", {}).get("recommendedName", {}).get("fullName", {}).get("value", "Unknown")
            genes = entry.get("genes", [])
            gene_name = genes[0].get("geneName", {}).get("value", "") if genes else ""
            function_comments = entry.get("comments", [])
            function_text = ""
            for c in function_comments:
                if c.get("commentType") == "FUNCTION":
                    texts = c.get("texts", [])
                    if texts:
                        function_text = texts[0].get("value", "")[:200]
                    break
            results.append({
                "accession": accession,
                "protein_name": protein_name,
                "gene_name": gene_name,
                "function": function_text,
                "citation": f"UniProt {accession}: {protein_name} ({gene_name}) — {function_text[:100]}",
            })
    except Exception as e:
        logger.warning(f"UniProt search failed for '{query[:50]}': {e}")
    return results


def search_reactome(query: str, max_results: int = 3) -> list[dict]:
    """Search Reactome for biological pathways."""
    results = []
    try:
        url = f"https://reactome.org/ContentService/search/query?query={urllib.parse.quote(query)}&types=Pathway&cluster=true"
        text = _fetch_url(url)
        if not text:
            return results
        data = json.loads(text)
        entries = data.get("results", [])
        count = 0
        for group in entries:
            for entry in group.get("entries", []):
                if count >= max_results:
                    break
                st_id = entry.get("stId", "")
                name = entry.get("name", "")
                species = entry.get("species", [""])[0] if entry.get("species") else ""
                results.append({
                    "id": st_id,
                    "name": name,
                    "species": species,
                    "citation": f"Reactome {st_id}: {name}",
                })
                count += 1
    except Exception as e:
        logger.warning(f"Reactome search failed for '{query[:50]}': {e}")
    return results


def ground_hypothesis_with_databases(disease: str, hypothesis_title: str, mechanism: str) -> dict:
    """Query multiple scientific databases to ground a hypothesis with real evidence.

    Returns a dict with pubmed, clinical_trials, fda, uniprot, and reactome results.
    """
    # Build targeted queries from hypothesis content
    query_base = f"{disease} {hypothesis_title[:80]}"
    # Extract protein/gene names from mechanism for UniProt/Reactome queries
    # instead of passing raw descriptive text which causes 400 errors
    import re as _re
    _gene_protein_pattern = _re.compile(
        r'\b([A-Z][A-Z0-9]{1,10}(?:-[A-Z0-9]+)?)\b'  # e.g., PIEZO2, GsMTx4, CYP450, TRPV1
    )
    _extracted = _gene_protein_pattern.findall(mechanism[:300]) if mechanism else []
    # Filter out common English words that match the pattern
    _stopwords = {"THE", "AND", "FOR", "NOT", "BUT", "ARE", "WAS", "HAS", "HAD", "CAN", "MAY", "VIA", "WITH"}
    _extracted = [g for g in _extracted if g not in _stopwords and len(g) >= 2]
    mechanism_short = " ".join(_extracted[:5]) if _extracted else disease

    grounding = {
        "pubmed": [],
        "clinical_trials": [],
        "fda": [],
        "uniprot": [],
        "reactome": [],
        "summary": [],
    }

    # PubMed — search both title keywords and mechanism
    pubmed_results = search_pubmed(query_base, max_results=5)
    if not pubmed_results:
        pubmed_results = search_pubmed(disease, max_results=3)
    grounding["pubmed"] = pubmed_results

    # ClinicalTrials.gov
    ct_results = search_clinical_trials(disease, max_results=3)
    grounding["clinical_trials"] = ct_results

    # FDA
    fda_results = search_fda(disease, max_results=2)
    grounding["fda"] = fda_results

    # UniProt — search for key proteins mentioned
    uniprot_results = search_uniprot(mechanism_short, max_results=2)
    grounding["uniprot"] = uniprot_results

    # Reactome — search for pathways
    reactome_results = search_reactome(mechanism_short, max_results=2)
    grounding["reactome"] = reactome_results

    # Build summary citations
    for src, items in grounding.items():
        if src == "summary":
            continue
        for item in items:
            if "citation" in item:
                grounding["summary"].append(f"[{src.upper()}] {item['citation']}")

    return grounding


def format_grounding_for_prompt(grounding: dict) -> str:
    """Format grounding results into text for injection into stage prompts."""
    parts = []
    if grounding.get("pubmed"):
        parts.append("=== PubMed Citations ===")
        for a in grounding["pubmed"]:
            parts.append(f"  - {a.get('citation', '')}")
            if a.get("title"):
                parts.append(f"    Title: {a['title']}")

    if grounding.get("clinical_trials"):
        parts.append("=== ClinicalTrials.gov ===")
        for t in grounding["clinical_trials"]:
            parts.append(f"  - {t.get('citation', '')}")

    if grounding.get("fda"):
        parts.append("=== FDA Drug Labels ===")
        for d in grounding["fda"]:
            parts.append(f"  - {d.get('citation', '')}")
            if d.get("mechanism"):
                parts.append(f"    Mechanism: {d['mechanism']}")

    if grounding.get("uniprot"):
        parts.append("=== UniProt Proteins ===")
        for p in grounding["uniprot"]:
            parts.append(f"  - {p.get('citation', '')}")

    if grounding.get("reactome"):
        parts.append("=== Reactome Pathways ===")
        for r in grounding["reactome"]:
            parts.append(f"  - {r.get('citation', '')}")

    return "\n".join(parts) if parts else "No external database results found."


def run_discovery_worker(config: dict, continuation: dict | None = None):
    """Run the AI discovery process via 10-stage sequential pipeline.

    Architecture: ALL 10 models work on ONE hypothesis at a time.
    Each hypothesis passes through 10 specialized stages before
    the pipeline moves to the next hypothesis.

    4 rounds × 3 hypotheses/round = 12 total hypotheses.
    Rounds 1-2: Independent exploration from different starting angles.
    Rounds 3-4: Refinement of the best hypotheses from earlier rounds.
    """
    disease = config.get("disease", "")
    discovery_type = config.get("discovery_type", "cure")
    focus_entities = config.get("focus_entities", [])
    external_factors = config.get("external_factors", [])
    target_confidence = float(config.get("target_confidence", 0.95))

    # Continuation support
    start_round = 0
    prior_hypotheses = []
    prior_stages = 0
    time_offset = 0.0
    if continuation:
        start_round = continuation.get("start_round", 0)
        prior_hypotheses = continuation.get("existing_hypotheses", [])
        prior_stages = continuation.get("stages_completed", 0)
        time_offset = float(continuation.get("total_start_time_offset", 0))
        print(f"[WORKER] CONTINUATION: resuming from round {start_round+1}, {len(prior_hypotheses)} prior hypotheses")

    # Check which stages have available models
    def _stage_role_available(role_name):
        cfg = AGENT_MODELS.get(role_name)
        if not cfg:
            return False
        if cfg["provider"] == "bedrock":
            return bedrock_runtime is not None
        if cfg["provider"] == "azure_ai":
            return _get_azure_client(cfg["model_id"]) is not None
        return False

    available_stages = []
    for stage_info in PIPELINE_STAGES:
        role = stage_info["role"]
        if _stage_role_available(role):
            available_stages.append(stage_info)
        else:
            # Try fallbacks
            fallback_found = False
            for fb_role in STAGE_FALLBACKS.get(role, []):
                if _stage_role_available(fb_role):
                    available_stages.append({**stage_info, "role": fb_role, "fallback_from": role})
                    fallback_found = True
                    break
            if not fallback_found:
                print(f"[WORKER] Stage {stage_info['stage']} ({stage_info['name']}) SKIPPED — no model available for {role}")

    if not available_stages:
        update_discovery_state({"status": "failed", "error": "No AI models available."})
        return

    stage_names = [s["name"] for s in available_stages]
    print(f"[WORKER] Starting 10-stage sequential pipeline: disease={disease!r} stages={stage_names}")
    print(f"[WORKER] Architecture: {NUM_ROUNDS} rounds × {HYPOTHESES_PER_ROUND} hypotheses = {NUM_ROUNDS * HYPOTHESES_PER_ROUND} total, each through {len(available_stages)} stages")

    start_time = time.time()
    hypotheses = list(prior_hypotheses)
    stages_completed = prior_stages

    # Seed angle diversity matrix — different starting angles for each hypothesis
    seed_angles = [
        "Explore NOVEL molecular targets: phase separation condensates, mechanotransduction pathways, non-coding RNA regulatory networks, metabolic symbiosis.",
        "Focus on DRUG REPURPOSING: identify approved drugs from unrelated therapeutic areas with unexpected activity against this disease.",
        "Explore MICROBIOME-IMMUNE-METABOLISM axis: gut-brain connections, bacterial metabolites, short-chain fatty acids, ecological interventions.",
        "Explore GENE THERAPY and epigenetic reprogramming: CRISPR base editing, ASOs, siRNA, mRNA therapeutics, precision medicine stratification.",
        "Target IMMUNOTHERAPY: checkpoint interactions, T-cell exhaustion markers, neoantigen load, TME remodeling, CAR-T engineering.",
        "Investigate METABOLIC VULNERABILITIES: synthetic lethality pairs, nutrient addiction, mitochondrial dependencies, Warburg effect exploitation.",
        "Design NANOTECHNOLOGY solutions: exosome engineering, targeted nanoparticles, BBB-crossing strategies, DNA origami drug delivery.",
        "Explore SIGNALING CASCADE interventions: kinase networks, feedback loops, resistance mutations, combination logic.",
        "Map EPIGENETIC THERAPY: histone modification crosstalk, DNA methylation, chromatin accessibility, transcriptional reprogramming.",
        "Investigate NEUROMODULATION and neural circuit-based therapies: optogenetics concepts, focused ultrasound, vagus nerve stimulation, brain-computer interfaces.",
        "Analyze PROTEOSTASIS mechanisms: protein folding, ubiquitin-proteasome, autophagy induction, chaperone modulation, aggregation prevention.",
        "Explore SENOLYTIC and aging-related pathways: cellular senescence, SASP factors, telomere biology, stem cell rejuvenation.",
    ]

    # Build shared context
    focus_str = f"\nFocus entities: {', '.join(focus_entities)}" if focus_entities else ""
    factors_str = ""
    if external_factors:
        factors_str = "\nExternal factors to consider:\n" + "\n".join(
            f"- {f.get('name', '')} ({f.get('category', '')}): {f.get('interaction', 'analyze interaction')}"
            for f in external_factors
        )

    for round_num in range(start_round, NUM_ROUNDS):
        # Check if stopped
        state = get_discovery_state()
        db_status = state.get("status", "?") if state else "NO_ITEM"
        if state and state.get("status") in ["stopping", "stopped", "idle"]:
            print(f"[WORKER] Stopping: db_status={db_status}")
            break
        if state and state.get("status") == "paused":
            try:
                _cancellable_sleep(5)
            except CancelledError:
                break
            continue

        is_refinement = round_num >= 2
        round_label = "Refinement" if is_refinement else "Exploration"
        print(f"[WORKER] === ROUND {round_num+1}/{NUM_ROUNDS}: {round_label} ===")

        # For refinement rounds, select top hypotheses to refine
        refine_pool = []
        if is_refinement and hypotheses:
            refine_pool = sorted(hypotheses, key=lambda x: x["confidence"], reverse=True)

        cancelled = False
        for hyp_idx in range(HYPOTHESES_PER_ROUND):
            if _is_cancelled():
                cancelled = True
                break

            hyp_num = round_num * HYPOTHESES_PER_ROUND + hyp_idx + 1
            print(f"[WORKER] --- Hypothesis {hyp_num}/{NUM_ROUNDS * HYPOTHESES_PER_ROUND} (R{round_num+1}H{hyp_idx+1}) ---")

            # For refinement rounds, the seed is a previous hypothesis to deepen
            refine_context = ""
            if is_refinement and refine_pool:
                ref_idx = hyp_idx % len(refine_pool)
                ref_h = refine_pool[ref_idx]
                refine_context = f"""
=== HYPOTHESIS TO REFINE AND DEEPEN ===
Title: {ref_h.get('title', '')}
Description: {ref_h.get('description', '')[:500]}
Mechanism: {ref_h.get('mechanism', '')[:300]}
Current Confidence: {ref_h.get('confidence', 0):.0%}
Evidence: {_safe_join('; ', ref_h.get('evidence_summary', []), 3)}
Risks: {_safe_join('; ', ref_h.get('risks', []), 3)}

Your task: REFINE and DEEPEN this hypothesis. Make it more specific, better-evidenced, and clinically actionable.
"""

            # Previous hypotheses context (avoid duplication)
            prev_context = ""
            if hypotheses:
                top_hyps = sorted(hypotheses, key=lambda x: x["confidence"], reverse=True)[:5]
                prev_context = "\n\nPrevious hypotheses (avoid duplicating these — be novel):\n" + "\n".join(
                    f"- {h['title']} (conf: {h['confidence']:.0%})"
                    for h in top_hyps
                )

            # Accumulated stage output for this hypothesis
            accumulated_context = ""
            hypothesis_data = None
            grounding_data = None
            seed_angle = seed_angles[(round_num * HYPOTHESES_PER_ROUND + hyp_idx) % len(seed_angles)]

            # ===== Run through ALL stages for this ONE hypothesis =====
            for stage_info in available_stages:
                if _is_cancelled():
                    cancelled = True
                    break

                stage_num = stage_info["stage"]
                stage_name = stage_info["name"]
                role = stage_info["role"]
                purpose = stage_info["purpose"]
                fallback = stage_info.get("fallback_from", "")
                model_config = AGENT_MODELS[role]

                stage_label = f"Stage {stage_num}/{len(available_stages)} [{stage_name.upper()}]"
                if fallback:
                    stage_label += f" (fallback: {role} for {fallback})"
                print(f"[WORKER] {stage_label}: calling {role}...")

                # Build stage-specific prompt
                if stage_num == 1:
                    # SEED stage — generate initial hypothesis
                    stage_prompt = f"""You are the SEED GENERATOR (Stage 1/10) in a 10-stage sequential hypothesis pipeline.

DISEASE: {disease}
DISCOVERY TYPE: {discovery_type}
{focus_str}
{factors_str}
{prev_context}
{refine_context}

SEED ANGLE: {seed_angle}

YOUR TASK: Generate ONE strong, specific, non-ambiguous hypothesis seed for {disease} {discovery_type}.

REQUIREMENTS:
- Title must name SPECIFIC molecules, genes, proteins, and mechanisms
- Description must be 200+ words of dense, evidence-rich scientific content
- Mechanism must trace a complete molecular cascade
- Include specific published evidence citations
- Confidence MUST NOT exceed {target_confidence}

Return ONLY valid JSON:
{{"has_hypothesis": true, "title": "...", "description": "200+ words...", "mechanism": "Complete cascade...", "confidence": 0.0-{target_confidence}, "evidence_summary": ["5+ items..."], "risks": ["specific risks..."], "validation_steps": ["experiments..."], "novelty_score": 0.0-1.0}}"""

                elif stage_num == 3:
                    # EVIDENCE stage — add PubMed/literature evidence + scientific grounding
                    # Fetch real data from PubMed, ClinicalTrials.gov, FDA, UniProt, Reactome
                    h_title = hypothesis_data.get("title", disease) if hypothesis_data else disease
                    h_mechanism = hypothesis_data.get("mechanism", "") if hypothesis_data else ""
                    print(f"[WORKER]   Querying PubMed, ClinicalTrials.gov, FDA, UniProt, Reactome...")
                    grounding_data = ground_hypothesis_with_databases(disease, h_title, h_mechanism)
                    grounding_text = format_grounding_for_prompt(grounding_data)
                    num_citations = len(grounding_data.get("summary", []))
                    print(f"[WORKER]   Found {num_citations} citations from scientific databases")

                    stage_prompt = f"""You are the EVIDENCE REVIEWER (Stage 3/10) in a 10-stage sequential hypothesis pipeline.

DISEASE: {disease}
DISCOVERY TYPE: {discovery_type}

=== CURRENT HYPOTHESIS (from previous stages) ===
{accumulated_context}

=== REAL SCIENTIFIC DATABASE EVIDENCE ===
The following citations were retrieved from PubMed, ClinicalTrials.gov, FDA, UniProt, and Reactome:

{grounding_text}

YOUR TASK: Review and strengthen the hypothesis with REAL evidence. Use the actual PubMed PMIDs, ClinicalTrials.gov NCT numbers, FDA drug data, UniProt accessions, and Reactome pathways provided above. Add, correct, or refine citations. Grade evidence quality.

Return ONLY valid JSON:
{{"has_hypothesis": true, "title": "...", "description": "...", "mechanism": "...", "confidence": 0.0-{target_confidence}, "evidence_summary": ["PMID:xxx Author et al...", "NCT#: trial details...", "FDA: drug data...", "UniProt: protein...", "Reactome: pathway..."], "risks": ["..."], "validation_steps": ["..."], "novelty_score": 0.0-1.0, "key_citations": ["PMID:xxx", "NCT#xxx"]}}"""

                elif stage_num == 7:
                    # GROUND stage — deep scientific grounding with additional database queries
                    h_title = hypothesis_data.get("title", disease) if hypothesis_data else disease
                    h_mechanism = hypothesis_data.get("mechanism", "") if hypothesis_data else ""
                    # Run a second grounding pass with more specific queries
                    print(f"[WORKER]   Deep grounding: querying databases with refined terms...")
                    deep_grounding = ground_hypothesis_with_databases(
                        disease,
                        h_title,
                        h_mechanism
                    )
                    deep_grounding_text = format_grounding_for_prompt(deep_grounding)
                    # Merge with earlier grounding
                    if grounding_data:
                        for src in ["pubmed", "clinical_trials", "fda", "uniprot", "reactome"]:
                            existing_ids = {str(r.get("pmid", r.get("nct_id", r.get("accession", r.get("id", ""))))) for r in grounding_data.get(src, [])}
                            for item in deep_grounding.get(src, []):
                                item_id = str(item.get("pmid", item.get("nct_id", item.get("accession", item.get("id", "")))))
                                if item_id not in existing_ids:
                                    grounding_data[src].append(item)
                                    grounding_data["summary"].append(f"[{src.upper()}] {item.get('citation', '')}")

                    stage_prompt = f"""You are the SCIENTIFIC GROUNDER (Stage 7/10) in a 10-stage sequential hypothesis pipeline.

DISEASE: {disease}
DISCOVERY TYPE: {discovery_type}

=== CURRENT HYPOTHESIS (refined through 6 prior stages) ===
{accumulated_context}

=== SCIENTIFIC DATABASE EVIDENCE (PubMed, ClinicalTrials.gov, FDA, UniProt, Reactome) ===
{deep_grounding_text}

YOUR TASK: Ground EVERY claim in the hypothesis to real scientific databases. For each key claim:
1. Cite specific PubMed articles (PMID)
2. Reference relevant clinical trials (NCT numbers)
3. Link to FDA-approved drugs if applicable
4. Reference UniProt protein entries and Reactome pathways
5. Flag any claims that CANNOT be grounded — these reduce confidence

Return ONLY valid JSON:
{{"has_hypothesis": true, "title": "...", "description": "...", "mechanism": "...", "confidence": 0.0-{target_confidence}, "evidence_summary": ["PMID:xxx...", "NCT#xxx..."], "risks": ["..."], "validation_steps": ["..."], "novelty_score": 0.0-1.0, "key_citations": ["PMID:xxx", "NCT#xxx"], "fda_references": ["drug: indication"], "clinical_trial_references": ["NCT#: phase, status"]}}"""

                else:
                    # All other stages — work with accumulated context
                    stage_instructions = {
                        2: f"You are the CAUSAL EXPANDER (Stage 2/10). EXPAND the hypothesis with deep causal chain reasoning. Build COMPLETE causal chains: [Molecular Event] → [Protein Effect] → [Pathway Alteration] → [Cellular Phenotype] → [Tissue Effect] → [Clinical Outcome]. Include Kd values, IC50/EC50, expression levels, allele frequencies.",
                        4: f"You are the COUNTER-ARGUMENT GENERATOR (Stage 4/10). Generate STRONG counter-arguments against this hypothesis. Identify: biological implausibility, pharmacological barriers, safety concerns, resistance mechanisms, manufacturing challenges, regulatory hurdles. Rate each as CRITICAL/MAJOR/MINOR.",
                        5: f"You are the MECHANISTIC DEEP DIVER (Stage 5/10). Perform a MECHANISTIC DEEP DIVE. Trace the COMPLETE molecular cascade from intervention to clinical outcome. Include: binding kinetics, signal transduction, gene expression changes, protein modifications, cellular responses, tissue effects, systemic outcomes.",
                        6: f"You are the CROSS-VALIDATOR (Stage 6/10). CROSS-VALIDATE every claim in this hypothesis. Check: known biochemistry, thermodynamic feasibility, binding affinities, evolutionary conservation, clinical trial precedent, regulatory feasibility, manufacturing scalability.",
                        8: f"You are the CONFIDENCE SCORER (Stage 8/10). Perform MULTI-DIMENSIONAL SCORING: Evidence quality (0-1), Mechanism strength (0-1), Clinical translatability (0-1), Safety profile (0-1), Novelty (0-1), Feasibility (0-1). Calculate overall confidence as weighted average. Be rigorous — do not inflate scores.",
                        9: f"You are the RAPID REFINER (Stage 9/10). REFINE the hypothesis: improve precision of molecular targets, tighten dose-response relationships, sharpen the clinical protocol, address remaining risks, add quantitative PK/PD modeling. Make every word count.",
                        10: f"You are the FINAL SYNTHESIZER (Stage 10/10). Produce the DEFINITIVE version of this hypothesis. Integrate all improvements from stages 1-9. Ensure: title is precise, description is comprehensive (300+ words), mechanism is complete, evidence is cited, risks are addressed, validation plan is actionable. This is the final output.",
                    }

                    instruction = stage_instructions.get(stage_num, f"You are Stage {stage_num}/10. Improve the hypothesis from your specialized perspective: {purpose}.")

                    stage_prompt = f"""{instruction}

DISEASE: {disease}
DISCOVERY TYPE: {discovery_type}

=== CURRENT HYPOTHESIS (accumulated from prior stages) ===
{accumulated_context}

YOUR TASK: Take the hypothesis above and IMPROVE it from your specialized perspective. Do NOT generate a new hypothesis — refine the SAME one.

Return ONLY valid JSON:
{{"has_hypothesis": true, "title": "...", "description": "...", "mechanism": "...", "confidence": 0.0-{target_confidence}, "evidence_summary": ["..."], "risks": ["..."], "validation_steps": ["..."], "novelty_score": 0.0-1.0}}"""

                # Build system prompt
                role_prompt = ROLE_PROMPTS.get(role, f"You are a {role.upper()} specialist.")
                system_prompt = f"{MASTER_PROMPT}\n\n---\n\n{role_prompt}"

                # Call the model
                try:
                    result = run_single_agent(role, stage_prompt, system_prompt)
                    if result:
                        hypothesis_data = result
                        # Update accumulated context for next stage
                        accumulated_context = f"""Title: {result['title']}
Description: {result['description'][:800]}
Mechanism: {result['mechanism'][:500]}
Confidence: {result['confidence']:.0%}
Evidence: {_safe_join('; ', result.get('evidence_summary', []), 5)}
Risks: {_safe_join('; ', result.get('risks', []), 3)}
Validation: {_safe_join('; ', result.get('validation_steps', []), 3)}"""
                        print(f"[WORKER]   {stage_name} -> refined: {result['title'][:70]} conf={result['confidence']:.2f}")
                    else:
                        print(f"[WORKER]   {stage_name} -> no output, keeping previous version")
                except RateLimitError as e:
                    print(f"[WORKER]   {stage_name} -> RATE LIMITED, skipping stage: {e}")
                except CancelledError:
                    cancelled = True
                    break
                except Exception as e:
                    print(f"[WORKER]   {stage_name} -> ERROR: {e}, skipping stage")

                stages_completed += 1

                # Rate limit delay between stages
                delay = 10 if model_config.get("provider") == "azure_ai" else 3
                try:
                    _cancellable_sleep(delay)
                except CancelledError:
                    cancelled = True
                    break

                # Check Lambda timeout — self-invoke to continue
                elapsed_now = time.time() - start_time
                if elapsed_now > 720:
                    print(f"[WORKER] Approaching timeout ({elapsed_now:.0f}s) — self-invoking continuation")
                    sorted_h = sorted(hypotheses, key=lambda x: x["confidence"], reverse=True)
                    update_discovery_state({
                        "status": "running",
                        "hypotheses": sorted_h[:TARGET_TOTAL_HYPOTHESES],
                        "stats": _build_stats(hypotheses, stages_completed, elapsed_now + time_offset, round_num, NUM_ROUNDS),
                    })
                    try:
                        lambda_client.invoke(
                            FunctionName=FUNCTION_NAME,
                            InvocationType="Event",
                            Payload=json.dumps({
                                "source": "self-invoke",
                                "action": "run_discovery",
                                "config": config,
                                "continuation": {
                                    "start_round": round_num + 1,
                                    "existing_hypotheses": hypotheses,
                                    "stages_completed": stages_completed,
                                    "total_start_time_offset": elapsed_now + time_offset,
                                },
                            }, cls=DecimalEncoder),
                        )
                        print(f"[WORKER] Continuation invoked at round {round_num + 1}")
                    except Exception as cont_err:
                        print(f"[WORKER] Continuation FAILED: {cont_err}")
                    return

            if cancelled:
                break

            # ===== Hypothesis complete — all stages done =====
            if hypothesis_data:
                hypothesis_data["confidence"] = min(hypothesis_data["confidence"], target_confidence)
                hypothesis_data["stages_completed"] = len(available_stages)
                hypothesis_data["round_number"] = round_num + 1

                # Attach grounding citations
                if grounding_data:
                    # Merge database citations into evidence_summary
                    existing_evidence = set(hypothesis_data.get("evidence_summary", []))
                    for citation in grounding_data.get("summary", []):
                        if citation not in existing_evidence:
                            hypothesis_data.setdefault("evidence_summary", []).append(citation)
                    hypothesis_data["key_citations"] = [
                        a.get("citation", "") for a in grounding_data.get("pubmed", [])
                    ]
                    hypothesis_data["fda_references"] = [
                        d.get("citation", "") for d in grounding_data.get("fda", [])
                    ]
                    hypothesis_data["clinical_trial_references"] = [
                        t.get("citation", "") for t in grounding_data.get("clinical_trials", [])
                    ]
                    hypothesis_data["grounding_sources"] = {
                        "pubmed_count": len(grounding_data.get("pubmed", [])),
                        "clinical_trials_count": len(grounding_data.get("clinical_trials", [])),
                        "fda_count": len(grounding_data.get("fda", [])),
                        "uniprot_count": len(grounding_data.get("uniprot", [])),
                        "reactome_count": len(grounding_data.get("reactome", [])),
                    }

                hypotheses.append(hypothesis_data)
                print(f"[WORKER] Hypothesis {hyp_num} COMPLETE: {hypothesis_data['title'][:70]} conf={hypothesis_data['confidence']:.2f} ({len(available_stages)} stages)")
                metrics.add_metric(name="HypothesesDiscovered", unit="Count", value=1)

            # Update state after each hypothesis
            elapsed = time.time() - start_time + time_offset
            sorted_h = sorted(hypotheses, key=lambda x: x["confidence"], reverse=True)
            update_discovery_state({
                "status": "running",
                "hypotheses": sorted_h[:TARGET_TOTAL_HYPOTHESES],
                "stats": _build_stats(hypotheses, stages_completed, elapsed, round_num, NUM_ROUNDS),
            })

        if cancelled:
            break

        # Round complete
        elapsed = time.time() - start_time + time_offset
        print(f"[WORKER] Round {round_num+1} done: {len(hypotheses)} hypotheses, {elapsed:.1f}s")

        # Check DB status
        state = get_discovery_state()
        db_status = state.get("status", "?") if state else "?"
        if db_status in ("stopping", "stopped", "idle"):
            print(f"[WORKER] Stop detected after round {round_num+1}")
            sorted_h = sorted(hypotheses, key=lambda x: x["confidence"], reverse=True)
            update_discovery_state({
                "status": "idle",
                "hypotheses": sorted_h[:TARGET_TOTAL_HYPOTHESES],
                "stats": _build_stats(hypotheses, stages_completed, elapsed, round_num + 1, NUM_ROUNDS),
            })
            return

        sorted_h = sorted(hypotheses, key=lambda x: x["confidence"], reverse=True)
        update_discovery_state({
            "status": "running",
            "hypotheses": sorted_h[:TARGET_TOTAL_HYPOTHESES],
            "stats": _build_stats(hypotheses, stages_completed, elapsed, round_num + 1, NUM_ROUNDS),
        })

        if round_num < NUM_ROUNDS - 1:
            try:
                _cancellable_sleep(5)
            except CancelledError:
                break

    # ---- Check cancellation ----
    if _is_cancelled():
        elapsed = time.time() - start_time + time_offset
        sorted_h = sorted(hypotheses, key=lambda x: x["confidence"], reverse=True)
        final_hypotheses = sorted_h[:TARGET_TOTAL_HYPOTHESES]
        print(f"[WORKER] STOPPED: {len(final_hypotheses)} hypotheses in {elapsed:.1f}s")
        update_discovery_state({
            "status": "stopped",
            "hypotheses": final_hypotheses,
            "stats": _build_stats(final_hypotheses, stages_completed, elapsed, NUM_ROUNDS, NUM_ROUNDS),
        })
        return

    # ---- Discovery complete ----
    elapsed = time.time() - start_time + time_offset
    sorted_h = sorted(hypotheses, key=lambda x: x["confidence"], reverse=True)
    final_hypotheses = sorted_h[:TARGET_TOTAL_HYPOTHESES]
    print(f"[WORKER] DONE: {len(final_hypotheses)} hypotheses in {elapsed:.1f}s (10-stage sequential pipeline)")

    # Auto-create project
    project_id = str(uuid4())
    now = datetime.utcnow().isoformat()
    project_name = f"Discovery: {disease}"
    try:
        proj_table = dynamodb.Table(PROJECTS_TABLE)
        proj_table.put_item(Item={
            "id": project_id,
            "name": project_name,
            "description": f"10-stage sequential pipeline discovery for {disease} ({discovery_type}). {len(final_hypotheses)} hypotheses, each refined through {len(available_stages)} specialized AI stages.",
            "disease_focus": disease,
            "research_question": f"{discovery_type.capitalize()} discovery for {disease}",
            "tags": [disease, discovery_type, "ai-generated", "10-stage-pipeline"],
            "hypothesis_count": len(final_hypotheses),
            "evidence_count": sum(len(h.get("evidence_summary", [])) for h in final_hypotheses),
            "user_id": "default",
            "created_at": now,
            "updated_at": now,
        })
        print(f"[WORKER] Created project: {project_id}")
    except Exception as e:
        logger.error(f"Failed to create project: {e}")
        project_id = "discovery"

    # Save hypotheses to DB
    hyp_table = dynamodb.Table(HYPOTHESES_TABLE)
    saved_count = 0
    for h in final_hypotheses:
        try:
            hyp_table.put_item(Item={
                "id": h["id"],
                "project_id": project_id,
                "statement": h["title"],
                "mechanism": h.get("mechanism", ""),
                "rationale": h.get("description", ""),
                "status": "generated",
                "confidence_score": Decimal(str(round(h["confidence"], 4))),
                "novelty_score": Decimal(str(round(h.get("novelty_score", 0.5), 4))),
                "evidence_refs": [],
                "evidence_summary": h.get("evidence_summary", []),
                "risks": h.get("risks", []),
                "validation_steps": h.get("validation_steps", []),
                "key_citations": h.get("key_citations", []),
                "fda_references": h.get("fda_references", []),
                "clinical_trial_references": h.get("clinical_trial_references", []),
                "grounding_sources": h.get("grounding_sources", {}),
                "stages_completed": h.get("stages_completed", 0),
                "round_number": h.get("round_number", 0),
                "contradiction_count": 0,
                "supporting_count": 0,
                "tags": h.get("tags", []),
                "version": 1,
                "role": "10-stage-pipeline",
                "created_at": h.get("created_at", now),
                "updated_at": now,
            })
            saved_count += 1
        except Exception as e:
            logger.warning(f"Failed to save hypothesis: {e}")

    print(f"[WORKER] Saved {saved_count}/{len(final_hypotheses)} hypotheses, project={project_id}")

    update_discovery_state({
        "status": "completed",
        "project_id": project_id,
        "project_name": project_name,
        "hypotheses": final_hypotheses,
        "stats": _build_stats(final_hypotheses, stages_completed, elapsed, NUM_ROUNDS, NUM_ROUNDS),
    })
    logger.info(f"Discovery completed: {len(final_hypotheses)} hypotheses, project={project_id}, {elapsed:.0f}s")


def _build_stats(hypotheses: list, stages_completed: int, elapsed: float, current_round: int, total_rounds: int) -> dict:
    """Build stats dict for DynamoDB updates."""
    return {
        "total_agents": len(PIPELINE_STAGES),
        "active_agents": len(PIPELINE_STAGES) if current_round < total_rounds else 0,
        "hypotheses_found": len(hypotheses),
        "paths_explored": stages_completed,
        "high_confidence_discoveries": sum(1 for h in hypotheses if h.get("confidence", 0) >= 0.7),
        "current_best_confidence": max((h.get("confidence", 0) for h in hypotheses), default=0),
        "runtime_seconds": int(elapsed),
        "current_round": current_round,
        "total_rounds": total_rounds,
        "pipeline_architecture": "10-stage-sequential",
        "stages_per_hypothesis": len(PIPELINE_STAGES),
    }


# ============== Save-to-Project Endpoint ==============

@app.post("/api/v1/orchestrator/save-to-project")
def save_discovery_to_project():
    """Save current discovery results to a new or existing project.

    Called by frontend after discovery completes. If the worker already
    auto-created a project, this returns that project's info.
    Otherwise it creates a new project from the current discovery state.
    """
    try:
        # Check query params for custom project name
        try:
            params = app.current_event.query_string_parameters or {}
        except Exception:
            params = {}
        project_name = params.get("project_name", "")

        state = get_discovery_state()
        if not state:
            return Response(
                status_code=404,
                content_type="application/json",
                body=json.dumps({"detail": "No discovery state found"}),
            )

        hypotheses = state.get("hypotheses", [])
        if not hypotheses:
            return Response(
                status_code=400,
                content_type="application/json",
                body=json.dumps({"detail": "No hypotheses found in current discovery"}),
            )

        # If auto-created project exists, return it
        existing_project_id = state.get("project_id")
        existing_project_name = state.get("project_name", "")
        if existing_project_id and existing_project_id != "discovery":
            return {
                "status": "success",
                "project_id": existing_project_id,
                "name": existing_project_name,
                "hypothesis_count": len(hypotheses),
                "message": f"Project already created: {existing_project_name}",
            }

        # Create a new project
        disease = (state.get("config", {}) or {}).get("disease", "Unknown")
        now = datetime.utcnow().isoformat()
        project_id = str(uuid4())
        name = project_name or f"Discovery: {disease}"

        proj_table = dynamodb.Table(PROJECTS_TABLE)
        proj_table.put_item(Item={
            "id": project_id,
            "name": name,
            "description": f"Project from AI discovery for {disease}. {len(hypotheses)} hypotheses.",
            "disease_focus": disease,
            "research_question": f"Discovery for {disease}",
            "tags": [disease, "ai-generated"],
            "hypothesis_count": len(hypotheses),
            "evidence_count": 0,
            "user_id": "default",
            "created_at": now,
            "updated_at": now,
        })

        # Save hypotheses linked to this project
        hyp_table = dynamodb.Table(HYPOTHESES_TABLE)
        for h in hypotheses:
            try:
                hyp_table.put_item(Item={
                    "id": h.get("id", str(uuid4())),
                    "project_id": project_id,
                    "statement": h.get("title", ""),
                    "mechanism": h.get("mechanism", ""),
                    "rationale": h.get("description", ""),
                    "status": "generated",
                    "confidence_score": Decimal(str(round(float(h.get("confidence", 0.5)), 4))),
                    "novelty_score": Decimal(str(round(float(h.get("novelty_score", 0.5)), 4))),
                    "evidence_refs": [],
                    "contradiction_count": 0,
                    "supporting_count": 0,
                    "tags": [],
                    "version": 1,
                    "created_at": h.get("created_at", now),
                    "updated_at": now,
                })
            except Exception as e:
                logger.warning(f"Failed to save hypothesis to project: {e}")

        # Update discovery state with project reference
        update_discovery_state({**state, "project_id": project_id, "project_name": name})

        return {
            "status": "success",
            "project_id": project_id,
            "name": name,
            "hypothesis_count": len(hypotheses),
            "message": f"Created project '{name}' with {len(hypotheses)} hypotheses",
        }
    except Exception as e:
        logger.error(f"save-to-project failed: {e}")
        return Response(
            status_code=500,
            content_type="application/json",
            body=json.dumps({"detail": f"Failed to save to project: {str(e)}"}),
        )


# ============== API Endpoints ==============

@app.get("/api/v1/orchestrator/status")
def get_status():
    """Get current orchestrator status. Never exposes model identities."""
    print("[STATUS] Endpoint hit")
    try:
        state = get_discovery_state()
        status_val = state.get("status", "?") if state else "NO_ITEM"
        hyp_count = len(state.get("hypotheses", []) or []) if state else 0
        stats = state.get("stats", {}) or {} if state else {}
        rnd = stats.get("current_round", "?") if isinstance(stats, dict) else "?"
        print(f"[STATUS] status={status_val} hypotheses={hyp_count} round={rnd}")
        if not state:
            return {
                "state": "idle",
                "stats": None,
                "top_hypotheses": [],
            }

        # Auto-detect stale or failed states and reset to idle.
        # - 'failed' always resets (user should be able to start fresh)
        # - running/stopping/paused reset after 15 min with no update (Lambda crash recovery)
        current_status = state.get("status", "idle")
        if current_status == "failed":
            print(f"[STATUS] State is 'failed' — auto-resetting to idle")
            update_discovery_state({"status": "idle"})
            current_status = "idle"
        elif current_status in ("completed", "stopped"):
            # Return completed/stopped once with results, then reset to idle
            # so the frontend can show Start Discovery again
            print(f"[STATUS] State is '{current_status}' — auto-resetting to idle for next run")
            update_discovery_state({"status": "idle"})
            # Keep current_status for THIS response only so the frontend gets the data
        elif current_status in ("running", "stopping", "paused"):
            updated_at = state.get("updated_at", "")
            if updated_at:
                try:
                    last_update = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
                    now = datetime.utcnow()
                    # Make both offset-naive for comparison
                    if last_update.tzinfo:
                        last_update = last_update.replace(tzinfo=None)
                    age_minutes = (now - last_update).total_seconds() / 60
                    # 'stopping' gets a shorter timeout — worker should have
                    # exited within seconds. If still 'stopping' after 2 min,
                    # the worker likely crashed; reset to idle.
                    stale_threshold = 2 if current_status == "stopping" else 15
                    if age_minutes > stale_threshold:
                        print(f"[STATUS] STALE state detected: {current_status} for {age_minutes:.0f}min — auto-resetting to idle")
                        update_discovery_state({"status": "idle"})
                        current_status = "idle"
                except Exception as parse_err:
                    logger.warning(f"Could not parse updated_at for stale check: {parse_err}")

        # Strip any model info from hypotheses before sending to frontend
        safe_hypotheses = []
        for h in (state.get("hypotheses", []) or [])[:20]:
            safe_h = {k: v for k, v in h.items() if k not in ("model_used", "model_id", "role")}
            safe_hypotheses.append(safe_h)

        # Include disease/discovery_type from config so frontend can restore context
        # (e.g., after page refresh during continuation)
        stored_config = state.get("config") or {}
        result = {
            "state": current_status,
            "stats": state.get("stats"),
            "top_hypotheses": safe_hypotheses,
            "disease": stored_config.get("disease", ""),
            "discovery_type": stored_config.get("discovery_type", ""),
        }
        # Include project reference if discovery completed
        if state.get("project_id") and state["project_id"] != "discovery":
            result["project_id"] = state["project_id"]
            result["project_name"] = state.get("project_name", "")
        return serialize(result)
    except Exception as e:
        logger.error(f"Status endpoint error: {e}")
        return {"state": "idle", "stats": None, "top_hypotheses": []}


@app.post("/api/v1/orchestrator/reset")
def reset_discovery():
    """Force-reset discovery state to idle. Use when state is stuck."""
    try:
        update_discovery_state({"status": "idle"})
        print("[RESET] Discovery state force-reset to idle")
    except Exception as e:
        logger.error(f"Reset failed: {e}")
    return {"status": "idle"}


@app.post("/api/v1/orchestrator/start")
def start_discovery():
    """Start a new discovery process with 4 parallel agents."""
    try:
        body = app.current_event.json_body or {}
    except Exception:
        body = {}

    disease = body.get("disease", "")
    print(f"[START] disease={disease!r} discovery_type={body.get('discovery_type','cure')}")
    if not disease:
        return Response(
            status_code=400,
            content_type="application/json",
            body=json.dumps({"detail": "Disease is required"}),
        )

    try:
        # Create initial state in DynamoDB
        table = get_task_table()
        now = datetime.utcnow().isoformat()
        config = {
            "disease": disease,
            "discovery_type": body.get("discovery_type", "cure"),
            "focus_entities": body.get("focus_entities", []),
            "max_agents": body.get("max_agents", 1000),
            "target_confidence": Decimal(str(body.get("target_confidence", 0.95))),
            "external_factors": body.get("external_factors", []),
        }

        print(f"[START] Writing DynamoDB initial state...")
        table.put_item(Item={
            "id": DISCOVERY_TASK_KEY,
            "status": "running",
            "config": config,
            "hypotheses": [],
            "stats": {
                "total_agents": len(PIPELINE_STAGES),
                "active_agents": len(PIPELINE_STAGES),
                "hypotheses_found": 0,
                "paths_explored": 0,
                "high_confidence_discoveries": 0,
                "current_best_confidence": Decimal("0"),
                "runtime_seconds": 0,
                "current_round": 0,
                "total_rounds": NUM_ROUNDS,
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
        print(f"[START] DynamoDB write done. Invoking async worker fn={FUNCTION_NAME}")
        try:
            lambda_client.invoke(
                FunctionName=FUNCTION_NAME,
                InvocationType="Event",  # Async
                Payload=json.dumps({
                    "source": "self-invoke",
                    "action": "run_discovery",
                    "config": config,
                }, cls=DecimalEncoder),
            )
            print(f"[START] Async invoke SUCCESS")
        except Exception as e:
            print(f"[START] Async invoke FAILED: {e}")
            logger.error(f"Failed to invoke async worker: {e}")
            # Fallback: run synchronously (will timeout after 300s but still useful)
            try:
                run_discovery_worker(config)
            except Exception as e2:
                print(f"[START] Sync fallback FAILED: {e2}")
                logger.error(f"Synchronous fallback also failed: {e2}")
                update_discovery_state({"status": "idle"})

        print(f"[START] Returning started response")
        return {"status": "started", "disease": disease, "agents": len(PIPELINE_STAGES), "total_rounds": NUM_ROUNDS}
    except Exception as e:
        logger.error(f"Start discovery failed: {e}")
        return Response(
            status_code=500,
            content_type="application/json",
            body=json.dumps({"detail": f"Failed to start discovery: {str(e)}"}),
        )


@app.post("/api/v1/orchestrator/pause")
def pause_discovery():
    """Pause the discovery process."""
    try:
        update_discovery_state({"status": "paused"})
    except Exception as e:
        logger.error(f"Pause failed: {e}")
    return {"status": "paused"}


@app.post("/api/v1/orchestrator/resume")
def resume_discovery():
    """Resume the discovery process."""
    try:
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
                    }, cls=DecimalEncoder),
                )
            except Exception as e:
                logger.error(f"Failed to resume worker: {e}")
    except Exception as e:
        logger.error(f"Resume failed: {e}")
    return {"status": "running"}


@app.post("/api/v1/orchestrator/stop")
def stop_discovery():
    """Stop the discovery process.

    Sets status to 'stopping'. The worker checks this flag before each
    agent call and between rounds, then transitions to 'idle' itself.
    We do NOT immediately set 'idle' here — that creates a race where
    the worker's round-end update overwrites it back to 'running'.
    """
    try:
        update_discovery_state({"status": "stopping"})
        print("[STOP] Set status=stopping — worker will transition to idle")
    except Exception as e:
        logger.error(f"Stop failed: {e}")
    return {"status": "stopping"}


@app.get("/api/v1/orchestrator/health")
def health_check():
    """Check AI model connectivity. Returns count only — never exposes model names.

    Uses fast client-availability checks instead of live inference calls.
    A model is 'connected' if its provider client is initialized and ready.
    """
    print("[HEALTH] Endpoint hit")
    connected = 0
    total = len(AGENT_MODELS)
    results = {}

    for role, model_config in AGENT_MODELS.items():
        model_id = model_config["model_id"]
        provider = model_config.get("provider", "azure_ai")
        try:
            if provider == "azure_ai":
                client = _get_azure_client(model_id)
                if client is None:
                    raise RuntimeError(
                        f"Azure AI client not configured for {model_id}. "
                        "Check AZURE_*_ENDPOINT/KEY env vars."
                    )
                connected += 1
                results[role] = "OK"
            else:
                # Bedrock — check if runtime client is initialized
                if bedrock_runtime is None:
                    raise RuntimeError("Bedrock runtime not initialized")
                # Client exists — model is available
                connected += 1
                results[role] = "OK"

            print(f"[HEALTH] {role} ({provider}) -> OK")
        except Exception as e:
            results[role] = f"FAIL: {e}"
            print(f"[HEALTH] {role} ({provider}) -> FAIL: {e}")
            logger.warning(f"Health check failed for agent {role}: {e}")

    # Summary log for easy CloudWatch scanning
    print(f"[HEALTH] ===== SUMMARY: {connected}/{total} models connected =====")
    for role, mc in AGENT_MODELS.items():
        status = results.get(role, "NOT_TESTED")
        print(f"[HEALTH]   {role:12s} | {mc.get('provider', 'unknown'):10s} | {status}")
    print(f"[HEALTH] ================================================")

    # Debug diagnostics — show which env vars and clients are available
    debug = {
        "azure_ai_endpoint_set": bool(os.environ.get("AZURE_AI_ENDPOINT", "")),
        "azure_ai_key_set": bool(os.environ.get("AZURE_AI_KEY", "")),
        "azure_deepseek_client_init": azure_deepseek_client is not None,
        "azure_mistral_client_init": azure_mistral_client is not None,
        "azure_cohere_client_init": azure_cohere_client is not None,
        "azure_kimi_client_init": azure_kimi_client is not None,
        "azure_phi4_client_init": azure_phi4_client is not None,
        "azure_grok_client_init": azure_grok_client is not None,
        "azure_gpt4o_client_init": azure_gpt4o_client is not None,
        "azure_o3mini_client_init": azure_o3mini_client is not None,
        "azure_gpt41_client_init": azure_gpt41_client is not None,
        "bedrock_runtime_init": bedrock_runtime is not None,
    }

    return {
        "status": "healthy" if connected == total else "partial" if connected > 0 else "no_models",
        "connected_count": connected,
        "total_models": total,
        "debug": debug,
    }


@app.post("/api/v1/orchestrator/generate-paper/pdf")
def generate_paper_pdf():
    """Generate a ReportLab PDF from the full research paper stored in DynamoDB."""
    try:
        table = get_task_table()
        response = table.get_item(Key={"id": PAPER_TASK_KEY})
        item = response.get("Item")
        if not item or item.get("status") != "done" or not item.get("paper_html"):
            return Response(
                status_code=400,
                content_type="application/json",
                body=json.dumps({"detail": "No completed paper available for PDF generation"}),
            )

        paper_html = item.get("paper_html", "")
        state = get_discovery_state()
        disease = state.get("config", {}).get("disease", "Research") if state else "Research"
        discovery_type = state.get("config", {}).get("discovery_type", "treatment") if state else "treatment"
        hypotheses = state.get("hypotheses", []) if state else []

        # Convert the full paper HTML into a ReportLab PDF
        pdf_bytes = _generate_paper_pdf_reportlab(paper_html, disease, discovery_type, hypotheses)

        slug = disease.replace(" ", "-").lower()[:30]
        return {
            "pdf_base64": base64.b64encode(pdf_bytes).decode("utf-8"),
            "filename": f"humanovo-{slug}-research-paper.pdf",
            "content_type": "application/pdf",
        }
    except Exception as e:
        logger.error(f"Paper PDF generation failed: {e}")
        return Response(
            status_code=500,
            content_type="application/json",
            body=json.dumps({"detail": f"PDF generation failed: {str(e)}"}),
        )


@app.post("/api/v1/orchestrator/generate-paper/markdown")
def generate_paper():
    """Start async paper generation for a specific hypothesis (or top 5)."""
    try:
        body = app.current_event.json_body or {}
    except Exception:
        body = {}

    state = get_discovery_state()
    if not state or not state.get("hypotheses"):
        return Response(
            status_code=400,
            content_type="application/json",
            body=json.dumps({"detail": "No hypotheses available for paper generation"}),
        )

    config = state.get("config", {})
    hypothesis_id = body.get("hypothesis_id")

    # Store paper task in DynamoDB
    table = get_task_table()
    table.put_item(Item={
        "id": PAPER_TASK_KEY,
        "status": "generating",
        "hypothesis_id": hypothesis_id or "all",
        "paper_html": "",
        "error": "",
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    })

    # Invoke async paper worker
    print(f"[PAPER] Starting async paper generation for hypothesis={hypothesis_id or 'all'}")
    try:
        lambda_client.invoke(
            FunctionName=FUNCTION_NAME,
            InvocationType="Event",
            Payload=json.dumps({
                "source": "self-invoke",
                "action": "generate_paper",
                "hypothesis_id": hypothesis_id,
                "config": config,
            }, cls=DecimalEncoder),
        )
        print("[PAPER] Async invoke SUCCESS")
    except Exception as e:
        print(f"[PAPER] Async invoke FAILED: {e}")
        table.update_item(
            Key={"id": PAPER_TASK_KEY},
            UpdateExpression="SET #s = :s, #e = :e",
            ExpressionAttributeNames={"#s": "status", "#e": "error"},
            ExpressionAttributeValues={":s": "failed", ":e": str(e)},
        )
        return Response(
            status_code=500,
            content_type="application/json",
            body=json.dumps({"detail": f"Failed to start paper generation: {str(e)}"}),
        )

    return {"status": "generating", "hypothesis_id": hypothesis_id or "all"}


@app.post("/api/v1/orchestrator/cancel-paper")
def cancel_paper():
    """Cancel in-progress paper generation."""
    try:
        table = get_task_table()
        table.update_item(
            Key={"id": PAPER_TASK_KEY},
            UpdateExpression="SET #s = :s, #u = :u",
            ExpressionAttributeNames={"#s": "status", "#u": "updated_at"},
            ExpressionAttributeValues={":s": "cancelled", ":u": datetime.utcnow().isoformat()},
        )
    except Exception as e:
        logger.error(f"Cancel paper failed: {e}")
    return {"status": "cancelled"}


@app.get("/api/v1/orchestrator/paper-status")
def get_paper_status():
    """Poll paper generation status."""
    try:
        table = get_task_table()
        response = table.get_item(Key={"id": PAPER_TASK_KEY})
        item = response.get("Item")
        if not item:
            return {"status": "idle", "paper_html": ""}
        status = item.get("status", "idle")
        # Treat cancelled as idle for the frontend
        if status == "cancelled":
            status = "idle"
        return serialize({
            "status": status,
            "paper_html": item.get("paper_html", ""),
            "error": item.get("error", ""),
            "current_phase": item.get("current_phase", ""),
            "phase_num": item.get("phase_num", 0),
            "total_phases": item.get("total_phases", 4),
        })
    except Exception as e:
        logger.error(f"Paper status error: {e}")
        return {"status": "error", "paper_html": "", "error": str(e)}


# ============== Multi-Model Research Paper Pipeline ==============
# Section-per-model architecture: each model writes a specific paper section
# in parallel, then Claude Opus synthesizes into the final cohesive paper.

PAPER_SECTIONS = {
    # (section_key, heading, model_client_getter, model_name, system_prompt_role)
    "abstract": {
        "heading": "Abstract",
        "model": "gpt4o",
        "model_id": lambda: AZURE_AI_GPT4O_MODEL,
        "client": lambda: azure_gpt4o_client,
        "provider": "azure_ai",
        "system": "You are a senior biomedical researcher writing a comprehensive abstract for a journal paper. Write a structured abstract (Background, Methods, Results, Conclusions) of 300-400 words. Be specific with quantitative findings.",
    },
    "introduction": {
        "heading": "1. Introduction",
        "model": "deepseek",
        "model_id": lambda: AZURE_AI_REASONER_MODEL,
        "client": lambda: azure_deepseek_client,
        "provider": "azure_ai",
        "system": "You are an expert in epidemiology and disease biology. Write a comprehensive introduction (800+ words) covering: disease epidemiology with specific statistics, current standard of care and its limitations, unmet medical needs, and the scientific rationale for the proposed approach. Cite specific studies with author names and years.",
    },
    "methods": {
        "heading": "2. Methods",
        "model": "grok",
        "model_id": lambda: AZURE_AI_GROK_MODEL,
        "client": lambda: azure_grok_client,
        "provider": "azure_ai",
        "system": "You are a computational biology methodologist. Write a detailed Methods section (800+ words) with subsections: 2.1 Multi-Agent AI Discovery Architecture (describe the 10-agent system), 2.2 Knowledge Integration Framework (how evidence is synthesized), 2.3 Confidence Scoring Methodology (statistical approach), 2.4 Hypothesis Generation Protocol. Be quantitatively precise.",
    },
    "results_mechanism": {
        "heading": "3. Results — Molecular Mechanism & Target Validation",
        "model": "kimi",
        "model_id": lambda: AZURE_AI_KIMI_MODEL,
        "client": lambda: azure_kimi_client,
        "provider": "azure_ai",
        "system": "You are a molecular biologist. Write a detailed Results subsection (800+ words) analyzing: molecular targets identified, mechanism of action cascades, protein-protein interactions, signaling pathway maps, binding affinities (IC50/EC50/Ki values), and structural biology insights. Include specific gene names, protein structures, and pathway identifiers.",
    },
    "results_evidence": {
        "heading": "4. Results — Preclinical & Clinical Evidence",
        "model": "cohere",
        "model_id": lambda: AZURE_AI_COHERE_MODEL,
        "client": lambda: azure_cohere_client,
        "provider": "azure_ai",
        "system": "You are a clinical research analyst. Write a detailed Results subsection (800+ words) covering: preclinical evidence (in vitro, animal models), clinical trial data (phases, endpoints, outcomes), real-world evidence, biomarker validation data. Include specific study results with p-values, confidence intervals, hazard ratios, and effect sizes.",
    },
    "therapeutic_protocol": {
        "heading": "5. Proposed Therapeutic Protocol",
        "model": "gpt41",
        "model_id": lambda: AZURE_AI_GPT41_MODEL,
        "client": lambda: azure_gpt41_client,
        "provider": "azure_ai",
        "system": "You are a clinical pharmacologist designing a therapeutic protocol. Write a detailed section (800+ words) covering: drug selection and rationale, dosing regimen (mg/kg, schedule, route), combination therapy design, patient stratification criteria, treatment duration, dose modifications for adverse events, concomitant medications, and monitoring schedule. Be as specific as a Phase II protocol.",
    },
    "discussion": {
        "heading": "6. Discussion",
        "model": "mistral",
        "model_id": lambda: AZURE_AI_CRITIC_MODEL,
        "client": lambda: azure_mistral_client,
        "provider": "azure_ai",
        "system": "You are a critical reviewer for a top-tier medical journal. Write a comprehensive Discussion (1000+ words) with subsections: 6.1 Comparative Analysis (vs existing treatments), 6.2 Biological Plausibility assessment, 6.3 Clinical Translation Pathway, 6.4 Safety Considerations (on/off-target effects, drug interactions), 6.5 Limitations and Future Directions. Be rigorously critical and balanced.",
    },
    "safety_regulatory": {
        "heading": "7. Safety, Regulatory & Market Analysis",
        "model": "o3mini",
        "model_id": lambda: AZURE_AI_O3MINI_MODEL,
        "client": lambda: azure_o3mini_client,
        "provider": "azure_ai",
        "system": "You are a regulatory affairs and health economics expert. Write a detailed section (600+ words) covering: regulatory pathway (FDA/EMA), IND-enabling studies required, clinical trial design for approval, safety monitoring plan (DSMB), REMS if needed, health economics (QALY, ICER), market access strategy, IP landscape. Be specific with timelines and costs.",
    },
}


def _update_paper_phase(table, phase_name: str, phase_num: int, total_phases: int):
    """Update DynamoDB with current paper generation phase for frontend polling."""
    try:
        table.update_item(
            Key={"id": PAPER_TASK_KEY},
            UpdateExpression="SET #cp = :cp, #pn = :pn, #tp = :tp, #u = :u",
            ExpressionAttributeNames={"#cp": "current_phase", "#pn": "phase_num", "#tp": "total_phases", "#u": "updated_at"},
            ExpressionAttributeValues={
                ":cp": phase_name,
                ":pn": phase_num,
                ":tp": total_phases,
                ":u": datetime.utcnow().isoformat(),
            },
        )
    except Exception:
        pass  # Non-critical


def _call_model_for_section(section_key: str, section_cfg: dict, prompt: str) -> tuple[str, str, str | None]:
    """Call a specific model for a paper section. Returns (section_key, result_text, error)."""
    model_id = section_cfg["model_id"]()
    client = section_cfg["client"]()
    provider = section_cfg["provider"]
    heading = section_cfg["heading"]
    system = section_cfg["system"]

    try:
        if client is not None and provider == "azure_ai":
            result = call_azure_ai(model_id, prompt, system, max_tokens=8_000, temperature=0.3)
            print(f"[PAPER] Section '{heading}' ({model_id}): {len(result)} chars")
            return (section_key, result, None)
        elif provider == "bedrock" and bedrock_runtime is not None:
            result = call_bedrock(model_id, prompt, system, max_tokens=8_000, temperature=0.3)
            print(f"[PAPER] Section '{heading}' (bedrock): {len(result)} chars")
            return (section_key, result, None)
        else:
            return (section_key, "", f"Client not available for {model_id}")
    except Exception as e:
        print(f"[PAPER] Section '{heading}' FAILED: {e}")
        return (section_key, "", str(e))


def run_paper_worker(hypothesis_id: str | None, config: dict, continuation: dict | None = None):
    """Multi-model research paper pipeline.

    Architecture (section-per-model for variety and no single-model bias):
      Phase 1: Parallel section generation — 6 models write sections concurrently
        - GPT-4o → Abstract (structured, concise)
        - DeepSeek-R1 → Introduction (epidemiology, rationale)
        - Kimi-K2 → Results: Molecular Mechanism & Target Validation
        - Cohere Command A → Results: Preclinical & Clinical Evidence
        - Mistral-Large-3 → Discussion (critical, balanced)
        - o3-mini → Safety, Regulatory & Market Analysis
      Phase 2: Claude Opus synthesis — combines all sections into final cohesive paper
        - Adds Methods, Therapeutic Protocol, Conclusion
        - Unifies voice, cross-references, adds tables/figures
        - Generates 30+ grounded references

    All models are instructed to ground claims in real scientific literature with
    specific author names, journal names, years, and DOIs where possible.

    Supports continuation: if Phase 1 completes but synthesis would exceed Lambda
    timeout, saves section results and self-invokes to continue at Phase 2.
    """
    paper_start_time = time.time()
    print(f"[PAPER-WORKER] Starting multi-model pipeline for hypothesis={hypothesis_id or 'all'}")
    table = get_task_table()
    disease = config.get("disease", "Unknown Disease")
    discovery_type = config.get("discovery_type", "cure")

    state = get_discovery_state()
    if not state or not state.get("hypotheses"):
        table.update_item(
            Key={"id": PAPER_TASK_KEY},
            UpdateExpression="SET #s = :s, #e = :e",
            ExpressionAttributeNames={"#s": "status", "#e": "error"},
            ExpressionAttributeValues={":s": "failed", ":e": "No hypotheses found"},
        )
        return

    # Select hypothesis
    if hypothesis_id and hypothesis_id != "all":
        target = next((h for h in state["hypotheses"] if h.get("id") == hypothesis_id), None)
        hypotheses_for_paper = [target] if target else state["hypotheses"][:1]
    else:
        hypotheses_for_paper = state["hypotheses"][:5]

    h = hypotheses_for_paper[0]
    evidence = h.get("evidence_summary", [])
    evidence_str = "\n".join(f"- {e}" for e in (str(x) if not isinstance(x, str) else x for x in evidence)) if evidence else "- No specific evidence cited"
    risks = h.get("risks", [])
    risks_str = "\n".join(f"- {r}" for r in (str(x) if not isinstance(x, str) else x for x in risks)) if risks else "- No risks identified"
    validation = h.get("validation_steps", [])
    validation_str = "\n".join(f"- {v}" for v in (str(x) if not isinstance(x, str) else x for x in validation)) if validation else "- No validation steps"

    # Shared hypothesis context block given to every model
    hypothesis_context = f"""HYPOTHESIS: {h.get('title', 'Untitled')}
DISEASE: {disease}
DISCOVERY TYPE: {discovery_type}
CONFIDENCE: {h.get('confidence', 0):.0%}

DESCRIPTION: {h.get('description', '')}

MECHANISM OF ACTION: {h.get('mechanism', '')}

SUPPORTING EVIDENCE:
{evidence_str}

RISKS & LIMITATIONS:
{risks_str}

PROPOSED VALIDATION:
{validation_str}"""

    grounding_instruction = """
CRITICAL GROUNDING REQUIREMENT: Every major claim MUST be grounded in real scientific literature.
- Cite specific authors, journal names, publication years, and DOI numbers where possible
- Reference real clinical trials by their NCT numbers (e.g., NCT03456789)
- Use actual drug names, gene symbols (HUGO nomenclature), protein identifiers (UniProt)
- Reference specific FDA approvals, EMA opinions, or regulatory decisions
- Include real statistical data: p-values, hazard ratios, confidence intervals, effect sizes
- When discussing epidemiology, cite WHO, CDC, or national registry statistics
Do NOT fabricate references — if uncertain, state the general finding without a specific citation."""

    total_phases = 4  # parallel sections, synthesis, HTML conversion, done

    # Support continuation from Phase 2 (section results already generated)
    section_results = {}
    if continuation and continuation.get("section_results"):
        section_results = continuation["section_results"]
        print(f"[PAPER] Resuming from continuation — {len(section_results)} sections from Phase 1")
    else:
        # ---- Phase 1: Parallel section generation ----
        _update_paper_phase(table, "Generating sections across 6 models...", 0, total_phases)
        print("[PAPER] Phase 1: Parallel section generation (8 models)")

        # Check cancellation
        paper_state = table.get_item(Key={"id": PAPER_TASK_KEY}).get("Item", {})
        if paper_state.get("status") in ("cancelled", "idle"):
            print("[PAPER] Cancelled before phase 1")
            return

        # Build section-specific prompts
        section_prompts = {}
        for key, cfg in PAPER_SECTIONS.items():
            section_prompts[key] = f"""{hypothesis_context}

{grounding_instruction}

Write the section: ## {cfg['heading']}

Write this section for a full research paper to be published in a top-tier journal (Nature Medicine, The Lancet, NEJM).
Be exhaustive, specific, and quantitative. Minimum 600 words. Use formal academic prose.
Reference real studies, drugs, genes, and clinical data wherever possible.
Write in markdown format with ## for section heading and ### for subsections."""

        # Run all sections in parallel using ThreadPoolExecutor
        section_errors = []

        with ThreadPoolExecutor(max_workers=6) as executor:
            futures = {}
            for key, cfg in PAPER_SECTIONS.items():
                client = cfg["client"]()
                if client is None:
                    print(f"[PAPER] Skipping section '{cfg['heading']}' — no client for {cfg['model']}")
                    continue
                futures[executor.submit(
                    _call_model_for_section,
                    key, cfg, section_prompts[key]
                )] = key

            for future in as_completed(futures):
                section_key, result_text, error = future.result()
                if error:
                    section_errors.append(f"{section_key}: {error}")
                    print(f"[PAPER] Section '{section_key}' failed: {error}")
                elif result_text:
                    section_results[section_key] = result_text

        completed_count = len(section_results)
        print(f"[PAPER] Phase 1 complete: {completed_count}/{len(PAPER_SECTIONS)} sections generated")

        if completed_count == 0:
            table.update_item(
                Key={"id": PAPER_TASK_KEY},
                UpdateExpression="SET #s = :s, #e = :e",
                ExpressionAttributeNames={"#s": "status", "#e": "error"},
                ExpressionAttributeValues={
                    ":s": "failed",
                    ":e": f"All section models failed: {'; '.join(section_errors[:3])}",
                },
            )
            return

        # Check if approaching Lambda timeout — self-invoke with section results to continue at Phase 2
        elapsed = time.time() - paper_start_time
        if elapsed > 600:
            print(f"[PAPER] Phase 1 took {elapsed:.0f}s — approaching Lambda timeout, self-invoking for Phase 2")
            _update_paper_phase(table, "Continuing synthesis in new invocation...", 1, total_phases)
            try:
                lambda_client.invoke(
                    FunctionName=FUNCTION_NAME,
                    InvocationType="Event",
                    Payload=json.dumps({
                        "source": "self-invoke",
                        "action": "generate_paper",
                        "hypothesis_id": hypothesis_id,
                        "config": config,
                        "continuation": {
                            "section_results": section_results,
                        },
                    }, cls=DecimalEncoder),
                )
                print("[PAPER] Self-invoke for Phase 2 SUCCESS")
            except Exception as cont_err:
                print(f"[PAPER] Self-invoke FAILED: {cont_err}, continuing in current invocation")
                # Fall through to Phase 2 in this invocation (risky but better than nothing)
            else:
                return  # Exit — Phase 2 will run in the new invocation

    # Check cancellation before synthesis
    paper_state = table.get_item(Key={"id": PAPER_TASK_KEY}).get("Item", {})
    if paper_state.get("status") in ("cancelled", "idle"):
        print("[PAPER] Cancelled before synthesis")
        return

    # ---- Phase 2: Claude Opus synthesis ----
    _update_paper_phase(table, "Claude Opus synthesizing final paper...", 1, total_phases)
    print("[PAPER] Phase 2: Claude Opus synthesis pass")

    # Assemble section drafts
    section_drafts = ""
    for key in ["abstract", "introduction", "methods", "results_mechanism", "results_evidence",
                 "therapeutic_protocol", "discussion", "safety_regulatory"]:
        if key in section_results:
            section_drafts += f"\n\n--- SECTION: {PAPER_SECTIONS[key]['heading']} ---\n{section_results[key]}"

    synthesis_prompt = f"""{hypothesis_context}

Below are section drafts written by different AI models for a research paper. Your task is to:

1. SYNTHESIZE these into a single cohesive, publication-ready research paper
2. ADD the sections that are missing: Methods (2. Methods with subsections), Proposed Therapeutic Protocol, Conclusion, Tables, Figures, and References
3. UNIFY the voice and style across all sections (Nature Medicine standard)
4. ADD cross-references between sections (e.g., "As discussed in Section 3.1...")
5. ADD 30+ REAL references in the format: [N] Author et al., "Title," Journal, vol(issue):pages, year. DOI:10.xxxx/xxxxx
6. ADD 3 tables: Hypothesis Comparison, Biomarker Panel, Drug Properties (use markdown table format)
7. ADD 3 figures as ASCII box diagrams: Disease Pathway, Mechanism of Action Flowchart, Clinical Trial Design
8. ENSURE total paper is 15-25 pages when printed (8000-12000 words)

{grounding_instruction}

SECTION DRAFTS FROM MULTIPLE MODELS:
{section_drafts}

Write the COMPLETE final paper in markdown format. Start with:
# {h.get('title', disease)} — {discovery_type.title()} Discovery Report

Use ## for major sections, ### for subsections. Include ALL sections from Abstract through References."""

    synthesis_system = """You are an elite scientific editor at Nature Medicine. You are synthesizing section drafts written by different expert AI models into a single publication-ready research paper. Maintain the strongest insights from each section while creating a unified voice. Every claim must be grounded in real scientific literature. The paper must read as if written by a single expert author team. Write the LONGEST, most DETAILED paper possible. Use every available token."""

    try:
        _paper_client = bedrock_long or bedrock_runtime
        paper_md = None
        last_err = None
        for attempt in range(3):
            paper_state = table.get_item(Key={"id": PAPER_TASK_KEY}).get("Item", {})
            if paper_state.get("status") in ("cancelled", "idle"):
                print("[PAPER] Cancelled during synthesis")
                return
            try:
                paper_md = call_bedrock(
                    model_id=PAPER_MODEL,
                    prompt=synthesis_prompt,
                    system_prompt=synthesis_system,
                    max_tokens=32_768,
                    temperature=0.3,
                    client=_paper_client,
                )
                break
            except Exception as retry_err:
                last_err = retry_err
                err_str = str(retry_err).lower()
                if "timeout" in err_str or "timed out" in err_str:
                    print(f"[PAPER] Synthesis attempt {attempt+1}/3 timed out, retrying...")
                    time.sleep(2)
                    continue
                raise
        if paper_md is None:
            raise last_err or RuntimeError("Paper synthesis failed after retries")
        print(f"[PAPER] Synthesis complete: {len(paper_md)} chars")

        # ---- Phase 3: Convert to rich HTML ----
        _update_paper_phase(table, "Rendering final document...", 2, total_phases)
        paper_html = _markdown_to_rich_html(paper_md, disease, discovery_type, hypotheses_for_paper)

        # ---- Phase 4: Store in DynamoDB ----
        _update_paper_phase(table, "Done", 3, total_phases)
        table.update_item(
            Key={"id": PAPER_TASK_KEY},
            UpdateExpression="SET #s = :s, #p = :p, #u = :u",
            ExpressionAttributeNames={"#s": "status", "#p": "paper_html", "#u": "updated_at"},
            ExpressionAttributeValues={
                ":s": "done",
                ":p": paper_html,
                ":u": datetime.utcnow().isoformat(),
            },
        )
        print("[PAPER] Paper saved to DynamoDB")
    except Exception as e:
        print(f"[PAPER] FAILED: {e}")
        import traceback
        traceback.print_exc()
        table.update_item(
            Key={"id": PAPER_TASK_KEY},
            UpdateExpression="SET #s = :s, #e = :e",
            ExpressionAttributeNames={"#s": "status", "#e": "error"},
            ExpressionAttributeValues={":s": "failed", ":e": str(e)},
        )


def _markdown_to_rich_html(md: str, disease: str, discovery_type: str, hypotheses: list) -> str:
    """Convert markdown paper to rich HTML with cover page, typography, diagrams."""
    date_str = datetime.utcnow().strftime("%B %d, %Y")
    title = hypotheses[0].get("title", disease) if hypotheses else disease

    # Extract title from markdown if present
    for line in md.split("\n"):
        if line.startswith("# "):
            title = line[2:].strip()
            break

    # Convert markdown to HTML
    body = md
    # Tables: convert markdown tables to HTML tables
    import re
    def _convert_table(match):
        lines = match.group(0).strip().split("\n")
        if len(lines) < 2:
            return match.group(0)
        html_parts = ['<table>']
        for idx, line in enumerate(lines):
            if set(line.strip().replace("|", "").replace("-", "").replace(":", "").strip()) == set():
                continue  # Skip separator line
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            tag = "th" if idx == 0 else "td"
            html_parts.append("<tr>" + "".join(f"<{tag}>{c}</{tag}>" for c in cells) + "</tr>")
        html_parts.append("</table>")
        return "\n".join(html_parts)

    body = re.sub(r'(?:^\|.+\|$\n?){2,}', _convert_table, body, flags=re.MULTILINE)

    # Headers
    body = re.sub(r'^#### (.+)$', r'<h4>\1</h4>', body, flags=re.MULTILINE)
    body = re.sub(r'^### (.+)$', r'<h3>\1</h3>', body, flags=re.MULTILINE)
    body = re.sub(r'^## (.+)$', r'<h2>\1</h2>', body, flags=re.MULTILINE)
    body = re.sub(r'^# (.+)$', r'<h1>\1</h1>', body, flags=re.MULTILINE)
    # Bold and italic
    body = re.sub(r'\*\*\*(.+?)\*\*\*', r'<strong><em>\1</em></strong>', body)
    body = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', body)
    body = re.sub(r'\*(.+?)\*', r'<em>\1</em>', body)
    # Lists
    body = re.sub(r'^- (.+)$', r'<li>\1</li>', body, flags=re.MULTILINE)
    body = re.sub(r'(<li>.*?</li>\n?)+', lambda m: f'<ul>{m.group(0)}</ul>', body)
    body = re.sub(r'^\d+\.\s+(.+)$', r'<li>\1</li>', body, flags=re.MULTILINE)
    # Code blocks (ASCII diagrams)
    body = re.sub(r'```[\w]*\n(.*?)```', r'<pre class="diagram">\1</pre>', body, flags=re.DOTALL)
    # Inline code
    body = re.sub(r'`([^`]+)`', r'<code>\1</code>', body)
    # Arrow notation in mechanisms
    body = body.replace("→", '<span class="arrow">→</span>')
    # References [N]
    body = re.sub(r'\[(\d+)\]', r'<sup class="ref">[\1]</sup>', body)
    # Paragraphs
    body = re.sub(r'\n{2,}', '</p><p>', body)
    body = re.sub(r'\n', '<br/>', body)

    # Build confidence badge
    conf = hypotheses[0].get("confidence", 0) if hypotheses else 0
    conf_color = "#22c55e" if conf >= 0.8 else "#eab308" if conf >= 0.6 else "#f97316"

    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>{title}</title>
<style>
@page {{ margin: 0.8in; size: A4; }}
@media print {{ .no-print {{ display: none; }} .page-break {{ page-break-before: always; }} }}
:root {{ --brand: #6c63ff; --brand-light: #8b85ff; --dark: #0f0f1a; --text: #e2e2e8; --muted: #8888aa; --surface: #1a1a2e; --border: #2a2a3e; }}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: var(--dark); color: var(--text); line-height: 1.8; }}
.paper {{ max-width: 900px; margin: 0 auto; background: var(--surface); min-height: 100vh; }}

/* Cover Page */
.cover {{ min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 80px 60px; background: linear-gradient(135deg, #0f0f1a 0%, #1a1a3e 50%, #0f0f1a 100%); border-bottom: 4px solid var(--brand); position: relative; overflow: hidden; }}
.cover::before {{ content: ''; position: absolute; top: -50%; right: -50%; width: 100%; height: 100%; background: radial-gradient(circle, rgba(108,99,255,0.08) 0%, transparent 70%); }}
.cover-logo {{ font-size: 13px; letter-spacing: 10px; text-transform: uppercase; color: var(--brand); font-weight: 800; margin-bottom: 60px; position: relative; }}
.cover-line {{ width: 80px; height: 3px; background: linear-gradient(90deg, transparent, var(--brand), transparent); margin: 24px auto; }}
.cover-title {{ font-size: 28px; font-weight: 700; color: #fff; line-height: 1.3; margin-bottom: 20px; max-width: 700px; }}
.cover-subtitle {{ font-size: 15px; color: var(--muted); margin-bottom: 40px; }}
.cover-conf {{ display: inline-block; padding: 6px 20px; border-radius: 20px; font-size: 14px; font-weight: 700; color: #fff; background: {conf_color}33; border: 1px solid {conf_color}; margin-bottom: 40px; }}
.cover-author {{ font-size: 16px; font-weight: 600; color: #fff; margin-bottom: 6px; }}
.cover-affil {{ font-size: 12px; letter-spacing: 4px; text-transform: uppercase; color: var(--brand-light); margin-bottom: 30px; }}
.cover-date {{ font-size: 13px; color: var(--muted); }}

/* Content */
.content {{ padding: 48px 56px; }}
h1 {{ font-size: 22px; color: #fff; border-bottom: 2px solid var(--brand); padding-bottom: 10px; margin: 40px 0 20px; font-weight: 700; }}
h2 {{ font-size: 19px; color: var(--brand-light); margin: 36px 0 16px; font-weight: 600; }}
h3 {{ font-size: 16px; color: #ccc; margin: 28px 0 12px; font-weight: 600; }}
h4 {{ font-size: 14px; color: var(--muted); margin: 20px 0 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }}
p {{ margin-bottom: 14px; font-size: 14px; }}
strong {{ color: #fff; }}
em {{ color: var(--brand-light); }}
code {{ background: #2a2a3e; padding: 2px 6px; border-radius: 3px; font-size: 13px; color: var(--brand-light); }}
.arrow {{ color: var(--brand); font-weight: bold; font-size: 16px; }}
sup.ref {{ color: var(--brand); font-size: 10px; cursor: pointer; }}
ul, ol {{ padding-left: 24px; margin: 12px 0; }}
li {{ margin-bottom: 8px; font-size: 14px; }}

/* Tables */
table {{ width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 13px; }}
th {{ background: var(--brand); color: #fff; padding: 10px 14px; text-align: left; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }}
td {{ padding: 10px 14px; border-bottom: 1px solid var(--border); }}
tr:nth-child(even) td {{ background: rgba(108,99,255,0.04); }}
tr:hover td {{ background: rgba(108,99,255,0.08); }}

/* Diagrams */
pre.diagram {{ background: #0d0d1a; border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin: 20px 0; font-family: 'Fira Code', 'Consolas', monospace; font-size: 12px; line-height: 1.6; color: var(--brand-light); overflow-x: auto; white-space: pre; }}

/* Footer */
.footer {{ text-align: center; padding: 30px; border-top: 1px solid var(--border); font-size: 11px; color: var(--muted); margin-top: 60px; }}

/* Index/TOC */
.toc {{ background: rgba(108,99,255,0.05); border: 1px solid var(--border); border-radius: 8px; padding: 24px 32px; margin: 30px 0; }}
.toc-title {{ font-size: 14px; font-weight: 700; color: var(--brand); margin-bottom: 16px; text-transform: uppercase; letter-spacing: 2px; }}
.toc-item {{ display: block; padding: 4px 0; font-size: 13px; color: var(--text); text-decoration: none; border-bottom: 1px dotted var(--border); }}
.toc-item:hover {{ color: var(--brand); }}
.toc-section {{ font-weight: 600; }}
.toc-sub {{ padding-left: 20px; color: var(--muted); }}
</style></head>
<body>
<div class="paper">
  <!-- Cover Page -->
  <div class="cover">
    <div class="cover-logo">humanovo</div>
    <div class="cover-line"></div>
    <div class="cover-title">{title}</div>
    <div class="cover-subtitle">{discovery_type.title()} Discovery Report for {disease}</div>
    <div class="cover-conf">Confidence: {conf:.0%}</div>
    <div class="cover-line"></div>
    <div class="cover-author">By humanovo</div>
    <div class="cover-affil">AI-Driven Biomedical Research Platform</div>
    <div class="cover-date">{date_str}</div>
  </div>

  <!-- Table of Contents -->
  <div class="content">
    <div class="toc">
      <div class="toc-title">Table of Contents</div>
      <span class="toc-item toc-section">Abstract</span>
      <span class="toc-item toc-section">1. Introduction</span>
      <span class="toc-item toc-section">2. Methods</span>
      <span class="toc-item toc-sub">2.1 Multi-Agent AI Architecture</span>
      <span class="toc-item toc-sub">2.2 Knowledge Integration</span>
      <span class="toc-item toc-sub">2.3 Confidence Scoring</span>
      <span class="toc-item toc-section">3. Results</span>
      <span class="toc-item toc-section">4. Discussion</span>
      <span class="toc-item toc-section">5. Conclusion</span>
      <span class="toc-item toc-section">Tables &amp; Figures</span>
      <span class="toc-item toc-section">References</span>
    </div>

    <!-- Paper Body -->
    <p>{body}</p>
  </div>

  <div class="footer">
    Generated by <strong>humanovo</strong> — Multi-Model Parallel AI Discovery System — {date_str}<br/>
    This paper was generated using {len(hypotheses)} AI-discovered hypothesis/hypotheses analyzed across 4 parallel agents.
  </div>
</div>
</body></html>"""


# ============== Hypothesis PDF Export ==============

@app.post("/api/v1/documents/hypothesis/<hypothesis_id>/pdf")
def generate_hypothesis_pdf(hypothesis_id: str):
    """Generate an AI-written mini research paper PDF for a hypothesis.

    Uses GPT-4o (fast) to expand the hypothesis into a short academic paper,
    then formats it into a professional ReportLab PDF.
    """
    try:
        body = app.current_event.json_body or {}
    except Exception:
        body = {}

    # Try to find hypothesis from discovery state first
    state = get_discovery_state()
    hypothesis = None
    if state and state.get("hypotheses"):
        hypothesis = next(
            (h for h in state["hypotheses"] if h.get("id") == hypothesis_id),
            None,
        )

    # If not found in state, use body data sent from frontend
    if not hypothesis:
        hypothesis = {
            "id": hypothesis_id,
            "title": body.get("title", "Untitled Hypothesis"),
            "description": body.get("description", ""),
            "mechanism": body.get("mechanism", ""),
            "confidence": body.get("confidence", 0),
            "evidence_summary": body.get("evidence_summary", []),
            "risks": body.get("risks", []),
            "validation_steps": body.get("validation_steps", []),
        }

    disease = body.get("disease", state.get("config", {}).get("disease", "Research") if state else "Research")
    discovery_type = body.get("discovery_type", "treatment")

    # Generate AI-expanded mini research paper using GPT-4o (fast model)
    ai_paper_text = None
    try:
        h = hypothesis
        evidence_str = "\n".join(f"- {e}" for e in (str(x) if not isinstance(x, str) else x for x in h.get("evidence_summary", []))) or "No specific evidence cited"
        risks_str = "\n".join(f"- {r}" for r in (str(x) if not isinstance(x, str) else x for x in h.get("risks", []))) or "No risks identified"
        validation_str = "\n".join(f"- {v}" for v in (str(x) if not isinstance(x, str) else x for x in h.get("validation_steps", []))) or "No validation steps"

        expand_prompt = f"""Write a concise academic research paper (2000-3000 words) about this hypothesis:

Title: {h.get('title', 'Untitled')}
Disease: {disease}
Discovery Type: {discovery_type}
Confidence: {h.get('confidence', 0):.0%}

Description: {h.get('description', '')}

Mechanism of Action: {h.get('mechanism', '')}

Supporting Evidence:
{evidence_str}

Risks:
{risks_str}

Proposed Validation:
{validation_str}

Structure the paper with these EXACT section headers (each on its own line, prefixed with ##):

## Abstract
## 1. Introduction
## 2. Proposed Mechanism
## 3. Supporting Evidence
## 4. Therapeutic Protocol
## 5. Risk Assessment
## 6. Validation Strategy
## 7. Discussion
## 8. Conclusion
## References

Write with Nature Medicine rigor. Include specific molecular targets, dosing rationale, biomarkers, and quantitative data where possible. References should be numbered [1]-[15+] with realistic citations."""

        # Use GPT-4o for speed (hypothesis PDF should return quickly)
        if azure_gpt4o_client is not None:
            ai_paper_text = call_azure_ai(AZURE_AI_GPT4O_MODEL, expand_prompt,
                "You are an expert biomedical researcher writing a concise academic paper. Be specific, quantitative, and cite evidence.",
                max_tokens=8_000, temperature=0.3)
        elif bedrock_runtime is not None:
            ai_paper_text = call_bedrock(BEDROCK_MODEL_CLAUDE_OPUS, expand_prompt,
                "You are an expert biomedical researcher writing a concise academic paper.",
                max_tokens=8_000, temperature=0.3)
    except Exception as ai_err:
        print(f"[HYPOTHESIS-PDF] AI expansion failed: {ai_err}, using raw data")

    # Build enriched hypothesis with AI-expanded sections for ReportLab
    if ai_paper_text:
        hypothesis["ai_paper_text"] = ai_paper_text

    pdf_bytes = _generate_hypothesis_pdf_reportlab(hypothesis, disease, discovery_type)

    title_slug = hypothesis.get("title", "hypothesis")[:50].replace(" ", "-").lower()
    import re as _re
    title_slug = _re.sub(r'[^a-z0-9\-]', '', title_slug)

    return {
        "pdf_base64": base64.b64encode(pdf_bytes).decode("utf-8"),
        "filename": f"humanovo-{title_slug}.pdf",
        "content_type": "application/pdf",
    }


@app.post("/api/v1/documents/hypothesis/<hypothesis_id>/html")
def generate_hypothesis_html(hypothesis_id: str):
    """Generate HTML research paper for a single hypothesis using AI."""
    try:
        body = app.current_event.json_body or {}
    except Exception:
        body = {}

    # Build hypothesis dict from body
    hypothesis = {
        "id": hypothesis_id,
        "title": body.get("title", "Untitled"),
        "description": body.get("description", ""),
        "mechanism": body.get("mechanism", ""),
        "confidence": body.get("confidence", 0),
        "evidence_summary": body.get("evidence_summary", []),
        "risks": body.get("risks", []),
        "external_factors": body.get("external_factors", []),
    }
    disease = body.get("disease", "Research")
    discovery_type = body.get("discovery_type", "treatment")

    # Store paper task in DynamoDB for async generation
    table = get_task_table()
    table.put_item(Item={
        "id": PAPER_TASK_KEY,
        "status": "generating",
        "hypothesis_id": hypothesis_id,
        "paper_html": "",
        "error": "",
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    })

    # Invoke async paper worker
    try:
        lambda_client.invoke(
            FunctionName=FUNCTION_NAME,
            InvocationType="Event",
            Payload=json.dumps({
                "source": "self-invoke",
                "action": "generate_paper",
                "hypothesis_id": hypothesis_id,
                "config": {"disease": disease, "discovery_type": discovery_type},
            }),
        )
    except Exception as e:
        table.update_item(
            Key={"id": PAPER_TASK_KEY},
            UpdateExpression="SET #s = :s, #e = :e",
            ExpressionAttributeNames={"#s": "status", "#e": "error"},
            ExpressionAttributeValues={":s": "failed", ":e": str(e)},
        )
        return Response(
            status_code=500,
            content_type="application/json",
            body=json.dumps({"detail": f"Failed to start paper generation: {str(e)}"}),
        )

    return {"status": "generating", "hypothesis_id": hypothesis_id}


def _generate_paper_pdf_reportlab(paper_html: str, disease: str, discovery_type: str, hypotheses: list) -> bytes:
    """Convert a full research paper (HTML content) into a ReportLab PDF."""
    import io as _io
    import re as _re
    from html.parser import HTMLParser

    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, HRFlowable, PageBreak,
        )
        from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
    except ImportError:
        return b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF"

    # Strip HTML tags to get plain text, preserving structure
    class _TextExtractor(HTMLParser):
        def __init__(self):
            super().__init__()
            self.text = []
            self._skip = False
        def handle_starttag(self, tag, attrs):
            if tag in ("style", "script"):
                self._skip = True
        def handle_endtag(self, tag):
            if tag in ("style", "script"):
                self._skip = False
            if tag in ("p", "div", "br", "h1", "h2", "h3", "h4", "li"):
                self.text.append("\n")
        def handle_data(self, data):
            if not self._skip:
                self.text.append(data)

    extractor = _TextExtractor()
    extractor.feed(paper_html)
    plain_text = "".join(extractor.text)

    buf = _io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, rightMargin=72, leftMargin=72, topMargin=72, bottomMargin=72)
    styles = getSampleStyleSheet()
    brand_color = colors.HexColor("#6c63ff")

    title_style = ParagraphStyle("PaperTitle", parent=styles["Title"], fontSize=22, textColor=colors.HexColor("#1a1a2e"), alignment=TA_CENTER, spaceAfter=12)
    subtitle_style = ParagraphStyle("PaperSubtitle", parent=styles["Normal"], fontSize=12, textColor=colors.HexColor("#6b7280"), alignment=TA_CENTER, spaceAfter=24)
    heading_style = ParagraphStyle("PaperH2", parent=styles["Heading2"], fontSize=16, textColor=colors.HexColor("#1a1a2e"), spaceBefore=20, spaceAfter=8)
    body_style = ParagraphStyle("PaperBody", parent=styles["Normal"], fontSize=11, leading=16, textColor=colors.HexColor("#374151"), alignment=TA_JUSTIFY, spaceAfter=10)
    meta_style = ParagraphStyle("PaperMeta", parent=styles["Normal"], fontSize=10, textColor=colors.HexColor("#9ca3af"), alignment=TA_CENTER, spaceAfter=4)

    elements = []
    date_str = datetime.utcnow().strftime("%B %d, %Y")

    # Cover page
    elements.append(Spacer(1, 2 * inch))
    elements.append(Paragraph("HUMANOVO", ParagraphStyle("Logo", parent=styles["Normal"], fontSize=12, textColor=brand_color, alignment=TA_CENTER, spaceAfter=30, letterSpacing=8)))
    elements.append(HRFlowable(width="40%", thickness=2, color=brand_color, spaceAfter=20, spaceBefore=10))

    # Extract title from first hypothesis or paper
    paper_title = hypotheses[0].get("title", disease) if hypotheses else disease
    elements.append(Paragraph(f"{paper_title} — Research Paper", title_style))
    elements.append(Paragraph(f"{disease} — {discovery_type.replace('_', ' ').title()} Discovery", subtitle_style))
    elements.append(HRFlowable(width="40%", thickness=2, color=brand_color, spaceAfter=20, spaceBefore=10))
    elements.append(Paragraph("AI-Powered Biomedical Discovery Platform", meta_style))
    elements.append(Paragraph(f"Generated on {date_str}", meta_style))
    elements.append(Paragraph(f"Based on {len(hypotheses)} AI-discovered hypotheses across 10 parallel agents", meta_style))
    elements.append(PageBreak())

    # Parse paper text into sections
    sections = _re.split(r'\n(?=##?\s)', plain_text)
    for section in sections:
        section = section.strip()
        if not section:
            continue
        lines = section.split("\n", 1)
        first_line = lines[0].strip()
        body_text = lines[1].strip() if len(lines) > 1 else ""

        # Detect headings
        if first_line.startswith("## ") or first_line.startswith("# "):
            heading_text = first_line.lstrip("#").strip()
            elements.append(Paragraph(heading_text, heading_style))
        else:
            body_text = section  # No heading, entire section is body

        if body_text:
            for para in body_text.split("\n\n"):
                para = para.strip()
                if not para:
                    continue
                if para.startswith("- ") or para.startswith("* ") or para.startswith("• "):
                    for bullet in para.split("\n"):
                        bullet = bullet.strip().lstrip("-*•").strip()
                        if bullet:
                            elements.append(Paragraph(f"• {bullet}", body_style))
                elif _re.match(r'^\[\d+\]', para):
                    # Reference lines
                    elements.append(Paragraph(para.replace("\n", " "), body_style))
                else:
                    cleaned = _re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', para)
                    cleaned = _re.sub(r'\*(.+?)\*', r'<i>\1</i>', cleaned)
                    cleaned = cleaned.replace("\n", " ")
                    elements.append(Paragraph(cleaned, body_style))

    # Footer
    elements.append(Spacer(1, 40))
    elements.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#e5e7eb"), spaceAfter=10, spaceBefore=20))
    elements.append(Paragraph(f"Humanovo — AI-Powered Biomedical Discovery Platform — {date_str}", meta_style))
    elements.append(Paragraph("This paper was generated by AI and should be validated by domain experts.", meta_style))

    doc.build(elements)
    return buf.getvalue()


def _generate_hypothesis_pdf_reportlab(hypothesis: dict, disease: str, discovery_type: str) -> bytes:
    """Generate a professional PDF for a hypothesis using ReportLab."""
    import io as _io

    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
            HRFlowable, PageBreak,
        )
        from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
    except ImportError:
        # ReportLab not available — return a minimal PDF
        return _generate_minimal_pdf(hypothesis, disease)

    buf = _io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        rightMargin=72,
        leftMargin=72,
        topMargin=72,
        bottomMargin=72,
    )

    styles = getSampleStyleSheet()
    brand_color = colors.HexColor("#6c63ff")
    dark_bg = colors.HexColor("#0f0f1a")

    # Custom styles
    title_style = ParagraphStyle(
        "CustomTitle",
        parent=styles["Title"],
        fontSize=22,
        spaceAfter=12,
        textColor=colors.HexColor("#1a1a2e"),
        alignment=TA_CENTER,
    )
    subtitle_style = ParagraphStyle(
        "Subtitle",
        parent=styles["Normal"],
        fontSize=12,
        textColor=colors.HexColor("#6b7280"),
        alignment=TA_CENTER,
        spaceAfter=24,
    )
    heading_style = ParagraphStyle(
        "CustomHeading",
        parent=styles["Heading2"],
        fontSize=16,
        textColor=colors.HexColor("#1a1a2e"),
        spaceBefore=20,
        spaceAfter=8,
        borderWidth=1,
        borderColor=colors.HexColor("#e5e7eb"),
        borderPadding=4,
    )
    body_style = ParagraphStyle(
        "CustomBody",
        parent=styles["Normal"],
        fontSize=11,
        leading=16,
        textColor=colors.HexColor("#374151"),
        alignment=TA_JUSTIFY,
        spaceAfter=10,
    )
    meta_style = ParagraphStyle(
        "Meta",
        parent=styles["Normal"],
        fontSize=10,
        textColor=colors.HexColor("#9ca3af"),
        alignment=TA_CENTER,
        spaceAfter=4,
    )

    elements = []
    date_str = datetime.utcnow().strftime("%B %d, %Y")

    # Cover page
    elements.append(Spacer(1, 2 * inch))
    elements.append(Paragraph("HUMANOVO", ParagraphStyle(
        "Logo", parent=styles["Normal"], fontSize=12,
        textColor=brand_color, alignment=TA_CENTER,
        spaceAfter=30, letterSpacing=8,
    )))
    elements.append(HRFlowable(
        width="40%", thickness=2, color=brand_color,
        spaceAfter=20, spaceBefore=10,
    ))
    elements.append(Paragraph(
        hypothesis.get("title", "Untitled Hypothesis"),
        title_style,
    ))
    elements.append(Paragraph(
        f"{disease} — {discovery_type.replace('_', ' ').title()} Discovery",
        subtitle_style,
    ))

    # Confidence badge
    conf = hypothesis.get("confidence", 0)
    conf_pct = f"{conf * 100:.1f}%" if isinstance(conf, float) else f"{conf}%"
    conf_color = "#22c55e" if conf >= 0.7 else "#eab308" if conf >= 0.5 else "#f97316"
    elements.append(Paragraph(
        f'<font color="{conf_color}"><b>Confidence: {conf_pct}</b></font>',
        ParagraphStyle("ConfBadge", parent=styles["Normal"], fontSize=14,
                       alignment=TA_CENTER, spaceAfter=40),
    ))
    elements.append(HRFlowable(
        width="40%", thickness=2, color=brand_color,
        spaceAfter=20, spaceBefore=10,
    ))
    elements.append(Paragraph("AI-Powered Biomedical Discovery Platform", meta_style))
    elements.append(Paragraph(date_str, meta_style))
    elements.append(PageBreak())

    # If AI-expanded paper text is available, use structured sections
    ai_text = hypothesis.get("ai_paper_text", "")
    if ai_text:
        # Parse markdown-ish AI output into sections
        import re as _re
        sections = _re.split(r'\n##\s+', ai_text)
        for section in sections:
            section = section.strip()
            if not section:
                continue
            # First line is heading, rest is body
            lines = section.split("\n", 1)
            heading_text = lines[0].strip().lstrip("#").strip()
            body_text = lines[1].strip() if len(lines) > 1 else ""
            if heading_text:
                elements.append(Paragraph(heading_text, heading_style))
            if body_text:
                # Split paragraphs and render each
                for para in body_text.split("\n\n"):
                    para = para.strip()
                    if not para:
                        continue
                    # Handle bullet lists
                    if para.startswith("- ") or para.startswith("* "):
                        for bullet in para.split("\n"):
                            bullet = bullet.strip().lstrip("-*").strip()
                            if bullet:
                                elements.append(Paragraph(f"• {bullet}", body_style))
                    else:
                        # Clean markdown bold/italic for ReportLab
                        para = _re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', para)
                        para = _re.sub(r'\*(.+?)\*', r'<i>\1</i>', para)
                        para = para.replace("\n", " ")
                        elements.append(Paragraph(para, body_style))
    else:
        # Fallback: render raw hypothesis fields
        desc = hypothesis.get("description", "")
        if desc:
            elements.append(Paragraph("Description", heading_style))
            elements.append(Paragraph(desc, body_style))

        mechanism = hypothesis.get("mechanism", "")
        if mechanism:
            elements.append(Paragraph("Mechanism of Action", heading_style))
            elements.append(Paragraph(mechanism, body_style))

        evidence = hypothesis.get("evidence_summary", [])
        if evidence:
            elements.append(Paragraph("Supporting Evidence", heading_style))
            for e in evidence:
                elements.append(Paragraph(f"• {e}", body_style))

        risks = hypothesis.get("risks", [])
        if risks:
            elements.append(Paragraph("Risks & Limitations", heading_style))
            for r in risks:
                elements.append(Paragraph(f"• {r}", body_style))

        validation = hypothesis.get("validation_steps", [])
        if validation:
            elements.append(Paragraph("Validation Steps", heading_style))
            for i, v in enumerate(validation, 1):
                elements.append(Paragraph(f"{i}. {v}", body_style))

    # Confidence Analysis
    conf_tier = (
        "very high" if conf >= 0.8 else
        "high" if conf >= 0.7 else
        "moderate" if conf >= 0.5 else
        "preliminary"
    )

    # Summary table
    elements.append(Spacer(1, 20))
    elements.append(Paragraph("Summary", heading_style))
    table_data = [
        ["Property", "Value"],
        ["Disease Focus", disease],
        ["Discovery Type", discovery_type.replace("_", " ").title()],
        ["Confidence Score", conf_pct],
        ["Confidence Tier", conf_tier.title()],
        ["Evidence Items", str(len(evidence))],
        ["Identified Risks", str(len(risks))],
        ["Validation Steps", str(len(validation))],
    ]
    t = Table(table_data, colWidths=[2.5 * inch, 4 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), brand_color),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 10),
        ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#f9fafb")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    elements.append(t)

    # Footer
    elements.append(Spacer(1, 40))
    elements.append(HRFlowable(
        width="100%", thickness=1, color=colors.HexColor("#e5e7eb"),
        spaceAfter=10, spaceBefore=20,
    ))
    elements.append(Paragraph(
        f"Humanovo — AI-Powered Biomedical Discovery Platform — Generated on {date_str}",
        meta_style,
    ))
    elements.append(Paragraph(
        "This document was generated by AI and should be validated by domain experts.",
        meta_style,
    ))

    doc.build(elements)
    return buf.getvalue()


def _generate_minimal_pdf(hypothesis: dict, disease: str) -> bytes:
    """Minimal PDF fallback when ReportLab is not available."""
    import io as _io
    title = hypothesis.get("title", "Hypothesis")
    desc = hypothesis.get("description", "")
    conf = hypothesis.get("confidence", 0)

    # Build a minimal valid PDF
    content = f"Humanovo Hypothesis Report\n\n{title}\n\nDisease: {disease}\nConfidence: {conf*100:.1f}%\n\n{desc}"
    buf = _io.BytesIO()
    buf.write(b"%PDF-1.4\n")
    # Minimal PDF with text stream
    stream = content.encode("latin-1", errors="replace")
    stream_obj = (
        f"4 0 obj\n<< /Length {len(stream)} >>\nstream\n".encode()
        + stream
        + b"\nendstream\nendobj\n"
    )
    page_obj = b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n"
    font_obj = b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
    pages_obj = b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
    catalog = b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"

    buf.write(catalog)
    buf.write(pages_obj)
    buf.write(page_obj)
    buf.write(stream_obj)
    buf.write(font_obj)
    xref_offset = buf.tell()
    buf.write(b"xref\n0 6\n")
    buf.write(b"0000000000 65535 f \n")
    # Simplified xref (not perfectly valid but readable by most viewers)
    for i in range(1, 6):
        buf.write(f"{i:010d} 00000 n \n".encode())
    buf.write(b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n")
    buf.write(f"{xref_offset}\n".encode())
    buf.write(b"%%EOF\n")
    return buf.getvalue()


# ============== Agent Task Endpoints (API Gateway routes) ==============

@app.post("/api/v1/agents/tasks")
def create_agent_task():
    """Create an agent task (alternative endpoint)."""
    task_id = str(uuid4())
    return {"id": task_id, "status": "queued"}


@app.get("/api/v1/agents/tasks/<task_id>")
def get_agent_task(task_id: str):
    """Get agent task status."""
    return {"id": task_id, "status": "completed", "progress": 100}


# ============== Lambda Handler ==============

def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """Lambda handler entry point.

    Handles both:
    1. API Gateway HTTP requests (normal API calls)
    2. Async self-invocations (background discovery work)

    Wrapped in top-level try/except to NEVER return 500 for API requests.
    """
    # Use print() to guarantee CloudWatch output regardless of Logger config
    raw_path = event.get("rawPath", "")
    method = event.get("requestContext", {}).get("http", {}).get("method", "?")
    stage = event.get("requestContext", {}).get("stage", "$default")
    print(f"[HANDLER] method={method} rawPath={raw_path} stage={stage}")

    try:
        # Check if this is a self-invocation for background work
        if event.get("source") == "self-invoke":
            action = event.get("action")
            print(f"[HANDLER] Self-invoke: action={action}")
            if action == "run_discovery":
                config = event.get("config", {})
                continuation = event.get("continuation")
                print(f"[HANDLER] Starting worker: disease={config.get('disease','?')} continuation={'yes' if continuation else 'no'}")
                try:
                    run_discovery_worker(config, continuation=continuation)
                    print(f"[HANDLER] Worker completed successfully")
                except Exception as worker_err:
                    print(f"[HANDLER] Worker CRASHED: {worker_err}")
                    import traceback
                    traceback.print_exc()
                    # Ensure status is set to idle so frontend isn't stuck
                    try:
                        update_discovery_state({"status": "idle"})
                    except Exception:
                        pass
                    raise
                return {"status": "completed"}
            elif action == "generate_paper":
                hypothesis_id = event.get("hypothesis_id")
                paper_config = event.get("config", {})
                paper_continuation = event.get("continuation")
                print(f"[HANDLER] Starting paper worker: hypothesis={hypothesis_id}, continuation={'yes' if paper_continuation else 'no'}")
                try:
                    run_paper_worker(hypothesis_id, paper_config, continuation=paper_continuation)
                    print(f"[HANDLER] Paper worker completed successfully")
                except Exception as paper_err:
                    print(f"[HANDLER] Paper worker CRASHED: {paper_err}")
                    import traceback
                    traceback.print_exc()
                    # Mark paper as failed so frontend isn't stuck
                    try:
                        table = get_task_table()
                        table.update_item(
                            Key={"id": PAPER_TASK_KEY},
                            UpdateExpression="SET #s = :s, #e = :e",
                            ExpressionAttributeNames={"#s": "status", "#e": "error"},
                            ExpressionAttributeValues={":s": "failed", ":e": str(paper_err)},
                        )
                    except Exception:
                        pass
                return {"status": "completed"}

        # Normalize rawPath for route matching.
        # API Gateway HTTP API v2 with named stage (e.g. "dev") includes
        # the stage prefix in rawPath: /dev/api/v1/orchestrator/status
        # Routes are registered as /api/v1/orchestrator/status (no prefix).
        #
        # - Stub resolver & powertools v2: need rawPath WITHOUT stage prefix
        # - Powertools v3: needs rawPath WITH stage prefix (strips it internally)
        _pt_major = 0
        try:
            import aws_lambda_powertools
            _pt_version = getattr(aws_lambda_powertools, "__version__", "0.0.0")
            _pt_major = int(_pt_version.split(".")[0])
            print(f"[HANDLER] powertools_version={_pt_version} pt_major={_pt_major}")
        except Exception:
            print("[HANDLER] powertools not available, using stub resolver")

        if stage and stage != "$default":
            stage_prefix = f"/{stage}"
            has_prefix = raw_path.startswith(f"{stage_prefix}/") or raw_path == stage_prefix

            if _pt_major >= 3:
                # v3 expects rawPath WITH /{stage} prefix (it strips internally)
                if not has_prefix:
                    event["rawPath"] = f"{stage_prefix}{raw_path}"
                    rc_http = event.get("requestContext", {}).get("http", {})
                    if rc_http:
                        rc_http["path"] = f"{stage_prefix}{rc_http.get('path', raw_path)}"
                    print(f"[HANDLER] v3: Added stage prefix -> {event['rawPath']}")
                # else: already has prefix, v3 will strip it correctly
            else:
                # Stub and v2 expect rawPath WITHOUT /{stage} prefix
                if has_prefix:
                    stripped = raw_path[len(stage_prefix):]
                    if not stripped:
                        stripped = "/"
                    event["rawPath"] = stripped
                    rc_http = event.get("requestContext", {}).get("http", {})
                    if rc_http:
                        old_http_path = rc_http.get("path", raw_path)
                        if old_http_path.startswith(f"{stage_prefix}"):
                            rc_http["path"] = old_http_path[len(stage_prefix):] or "/"
                    print(f"[HANDLER] stub/v2: Stripped stage prefix -> {event['rawPath']}")
                # else: no prefix, already correct for v2/stub

        # Handle as API Gateway request
        print(f"[HANDLER] Resolving with rawPath={event.get('rawPath', '')}")
        result = app.resolve(event, context)
        result_status = result.get("statusCode", "?") if isinstance(result, dict) else "?"
        print(f"[HANDLER] Resolved statusCode={result_status}")
        return result
    except Exception as e:
        logger.error(f"Top-level handler error: {e}")
        # Return a valid API Gateway v2 response so the client gets JSON, not 500
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "state": "idle",
                "stats": None,
                "top_hypotheses": [],
                "detail": f"Internal error: {str(e)}",
            }),
        }
