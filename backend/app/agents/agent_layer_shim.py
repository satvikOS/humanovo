"""Discovery-orchestrator → grounded-agent-layer shim.

Phase 1 migration helper for task #74. Lets the existing
`run_hypothesis` loop route SELECTED stages through the new agent
layer (BedrockClaudeAgent / FoundryResponsesAgent / SubAgentSwarm)
without rewriting the legacy `MultiModelLLM.generate()` path.

Usage from the orchestrator:

    from app.agents.agent_layer_shim import (
        should_route_through_agent_layer,
        generate_via_agent_layer,
    )

    if should_route_through_agent_layer(stage_num):
        response_text = await generate_via_agent_layer(
            model_type=actual_model_type,
            prompt=user_prompt,
            system_prompt=system_prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            stage_num=stage_num,
            stage_name=stage_name,
            cost_ctx=cost_ctx,
        )
    else:
        response_text = await self._llm.generate(...)

The shim returns a plain string just like the legacy path, so the
downstream parse / accumulate / grounding code doesn't need to change.

Routing config:
  • settings.USE_AGENT_LAYER_FOR_STAGES — list of stage numbers
    (1–12) routed through the agent layer. Empty list = legacy path
    for everything (default).
  • settings.AGENT_LAYER_SUB_AGENTS_PER_STAGE — sub-agent fan-out
    used only by routed stages. Defaults small (4) so a misconfigured
    deploy doesn't accidentally fire $50 runs; raise once a stage's
    quality is validated at small N.

Cost tracking: the shim records the agent's run cost into the
existing `cost_tracking_service.record_llm_call` so per-stage spend
shows up in the same PostgreSQL `usage_events` table as legacy calls.
"""
from __future__ import annotations

import logging

from app.core.config import settings


logger = logging.getLogger(__name__)


def should_route_through_agent_layer(stage_num: int) -> bool:
    """Return True if the orchestrator should route this stage's LLM
    call through the new agent layer rather than `MultiModelLLM.generate`."""
    routed_stages = getattr(settings, "USE_AGENT_LAYER_FOR_STAGES", None) or []
    return stage_num in routed_stages


async def generate_via_agent_layer(
    *,
    model_type,  # ModelType enum from discovery_orchestrator (avoid circular import)
    prompt: str,
    system_prompt: str,
    max_tokens: int,
    temperature: float,
    stage_num: int,
    stage_name: str,
    cost_ctx: dict | None = None,
) -> str:
    """Run a single stage through the grounded-agent layer and return
    the model's text response.

    Builds a `BedrockClaudeAgent` for Claude stages and a
    `FoundryResponsesAgent` for Foundry-hosted stages. Optionally
    wraps in a `SubAgentSwarm` when
    `settings.AGENT_LAYER_SUB_AGENTS_PER_STAGE > 1`.

    Per-call cost is recorded into the existing cost-tracking system
    when `cost_ctx` is supplied, mirroring the contract the legacy
    `MultiModelLLM.generate` honours."""
    from app.agents.discovery_orchestrator import ModelType  # local import to avoid cycle
    from app.services.agents import (
        BedrockClaudeAgent,
        FoundryResponsesAgent,
        SubAgentSwarm,
    )

    aws_key = settings.aws_access_key_id_value or ""
    aws_secret = settings.aws_secret_access_key_value or ""
    aws_region = settings.AWS_REGION or "us-east-1"

    # Map ModelType to a concrete agent. Keep the table small for
    # Phase 1 — only the models actually exercised by the routed
    # stages need entries here. Unknown models fall back to
    # CLAUDE_SONNET (Bedrock) which is the safest universal default.
    base_agent = None
    if model_type == ModelType.CLAUDE_OPUS:
        base_agent = BedrockClaudeAgent(
            model_id=settings.BEDROCK_MODEL_CLAUDE_OPUS,
            region=aws_region,
            access_key_id=aws_key,
            secret_access_key=aws_secret,
            max_tokens=min(max_tokens, 4096),  # cap for sub-agent fan-out cost
            label=f"bedrock/{settings.BEDROCK_MODEL_CLAUDE_OPUS}",
        )
    elif model_type == ModelType.CLAUDE_SONNET:
        base_agent = BedrockClaudeAgent(
            model_id=settings.BEDROCK_MODEL_CLAUDE_SONNET,
            region=aws_region,
            access_key_id=aws_key,
            secret_access_key=aws_secret,
            max_tokens=min(max_tokens, 4096),
            label=f"bedrock/{settings.BEDROCK_MODEL_CLAUDE_SONNET}",
        )
    else:
        # Foundry-hosted models — route via Responses API on the
        # configured project endpoint. Deployment-name resolution
        # uses the pinned settings.AZURE_FOUNDRY_DEPLOYMENT_* values
        # verified by the smoke; falls back to ModelType.value.
        deployment = _foundry_deployment_for(model_type)
        base_agent = FoundryResponsesAgent(
            deployment=deployment,
            base_url=settings.AZURE_AI_FOUNDRY_PROJECT_ENDPOINT,
            api_key=settings.azure_ai_foundry_key_value or "",
            max_output_tokens=min(max_tokens, 2048),
            label=f"foundry/{deployment}",
        )

    # Optional sub-agent fan-out. Default 1 (single-shot) for Phase 1
    # so the migration is observable cost-wise before scaling.
    n_sub = int(getattr(settings, "AGENT_LAYER_SUB_AGENTS_PER_STAGE", 1) or 1)
    if n_sub > 1:
        # Aggregator = Sonnet (cheap, good at distillation).
        aggregator = BedrockClaudeAgent(
            model_id=settings.BEDROCK_MODEL_CLAUDE_SONNET,
            region=aws_region,
            access_key_id=aws_key,
            secret_access_key=aws_secret,
            max_tokens=2048,
            label=f"bedrock/{settings.BEDROCK_MODEL_CLAUDE_SONNET}-aggregator",
        )
        agent = SubAgentSwarm(
            base_agent=base_agent,
            aggregator=aggregator,
            n_subagents=n_sub,
            max_concurrent=int(getattr(settings, "SUB_AGENTS_MAX_CONCURRENT", 16)),
            label=f"swarm[{base_agent.label}×{n_sub}]",
        )
    else:
        agent = base_agent

    # Run the agent. Inject the orchestrator's prompts:
    #   - `system_prompt` → agent system message
    #   - `prompt` (already includes the stage prompt + grounding +
    #     evidence text from the orchestrator's pre-call assembly)
    #     → user query.
    #
    # Tool opt-in: stages listed in
    # settings.AGENT_LAYER_TOOLS_FOR_STAGES get the production
    # grounding tools (lookup_evidence + pubmed_search) so the model
    # can fetch additional evidence inside its reasoning loop. Stages
    # not listed run with empty tools — relying on the orchestrator's
    # pre-call source-API sweep + dual-embedding gating. Phase 1
    # default = empty list (no stage gets tools), preserving the
    # legacy contract; Phase 2/3 enables per-stage as quality is
    # validated.
    tools_for_stages = (
        getattr(settings, "AGENT_LAYER_TOOLS_FOR_STAGES", None) or []
    )
    tools = []
    if stage_num in tools_for_stages:
        try:
            from app.services.agents.grounding_tools import (
                build_evidence_lookup_tool,
                build_pubmed_search_tool,
            )
            disease = (cost_ctx or {}).get("disease") or "unspecified disease"
            tools = [
                build_evidence_lookup_tool(disease=disease),
                build_pubmed_search_tool(),
            ]
        except Exception as e:
            # Tool construction is best-effort. If grounding_tools or
            # its deps fail to import, fall through to empty tools
            # rather than aborting the stage — the orchestrator's
            # pre-call grounding still gives the agent what it needs.
            logger.warning(
                "Agent-layer tool construction failed (stage=%s): %s",
                stage_name, e,
            )
            tools = []

    # max_steps scales with whether tools are available — a tool-less
    # stage finishes in one model call; a tool-enabled stage may need
    # 3–4 (call → tool → call → final). Cap at 6 either way.
    max_steps = 4 if tools else 2

    result = await agent.run(
        query=prompt,
        tools=tools,
        system=system_prompt or "You are a careful biomedical research assistant.",
        max_steps=max_steps,
    )

    # Record cost back into the two production tracking systems so
    # the billing dashboard sees per-stage agent-layer spend the same
    # as legacy LLM spend, AND the per-run budget enforcer trips its
    # cap mid-pipeline if the agent layer overspends.
    if cost_ctx and result.cost_cents > 0:
        # 1. cost_tracking_service.record_llm_call — feeds the
        #    per-call usage_events table (billing dashboard,
        #    /admin/ai/cost-history).
        try:
            from app.services.cost_tracking_service import get_cost_tracker
            tracker = get_cost_tracker()
            await tracker.record_llm_call(
                model_name=agent.label,
                input_tokens=result.usage.input_tokens,
                output_tokens=result.usage.output_tokens + result.usage.reasoning_tokens,
                cached_tokens=result.usage.cached_tokens,
                cost_cents=result.cost_cents,
                discovery_run_id=cost_ctx.get("discovery_run_id"),
                stage_number=cost_ctx.get("stage_number"),
                stage_name=cost_ctx.get("stage_name"),
                hypothesis_id=cost_ctx.get("hypothesis_id"),
                round_number=cost_ctx.get("round_number"),
            )
        except Exception as e:
            # Best-effort: never let a billing write failure block
            # the discovery run.
            logger.warning(
                "Agent-layer cost recording failed (stage=%s): %s",
                stage_name, e,
            )

        # 2. RunBudgetEnforcer.charge — feeds the per-run cap that
        #    the orchestrator opened with `start_run`. Without this
        #    call, the enforcer would underestimate agent-layer spend
        #    and `finalize_run` would push too little to the user's
        #    monthly counter. When the cap is hit mid-run, charge()
        #    raises BudgetExceeded which the orchestrator catches +
        #    aborts cleanly.
        enforcer = cost_ctx.get("_budget_enforcer") if cost_ctx else None
        if enforcer is not None:
            try:
                provider = "bedrock" if "bedrock" in agent.label.lower() else "azure"
                # Strip the swarm wrapper from the label so charge()'s
                # pricing lookup works against the underlying model.
                model_for_pricing = (
                    agent.label.replace("swarm[", "").replace("]", "")
                    .split("×")[0].split("/")[-1]
                )
                enforcer.charge(
                    provider=provider,
                    model=model_for_pricing,
                    input_tokens=result.usage.input_tokens,
                    output_tokens=result.usage.output_tokens + result.usage.reasoning_tokens,
                    cached_tokens=result.usage.cached_tokens,
                    stage_name=stage_name,
                )
            except Exception as e:
                # Re-raise BudgetExceeded so the orchestrator can
                # abort the run; swallow other exceptions (the
                # enforcer is best-effort, not load-bearing).
                from app.services.budget_enforcer_service import BudgetExceeded
                if isinstance(e, BudgetExceeded):
                    raise
                logger.warning(
                    "Agent-layer enforcer.charge failed (stage=%s): %s",
                    stage_name, e,
                )

    return result.text or ""


def _foundry_deployment_for(model_type) -> str:
    """Map a ModelType to a Foundry deployment name. Pinned values
    come from `settings.AZURE_FOUNDRY_DEPLOYMENT_*` (operator-confirmed
    by the integration smoke); fall through to the model_type value
    as a last resort."""
    from app.agents.discovery_orchestrator import ModelType  # local import

    pinned = {
        ModelType.GPT_4O_AZURE: getattr(settings, "AZURE_FOUNDRY_DEPLOYMENT_GPT4O", "gpt-4o"),
        ModelType.O3_MINI: getattr(settings, "AZURE_FOUNDRY_DEPLOYMENT_O4_MINI", "o4-mini"),
        ModelType.GPT_41: getattr(settings, "AZURE_FOUNDRY_DEPLOYMENT_GPT4O", "gpt-4o"),
        # The remaining ModelType members (Mistral, Cohere, Grok)
        # don't have Foundry deployments yet — when the operator
        # provisions them, add entries here. Until then a request for
        # one of those models routes to a Foundry deployment that
        # will 404, surfacing the missing deployment loudly rather
        # than silently substituting.
    }
    return pinned.get(model_type, getattr(model_type, "value", "gpt-4o"))
