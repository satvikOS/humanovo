"""Unit tests for the discovery_orchestrator → agent_layer shim.

Phase 1 of task #74. Verifies:
  • should_route_through_agent_layer respects settings.USE_AGENT_LAYER_FOR_STAGES
  • generate_via_agent_layer returns a plain string (legacy contract)
  • Cost recording is best-effort (a tracker failure doesn't propagate)

No live API calls — the agent classes are mocked so the test suite
runs without AWS / Azure secrets."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.agents.agent_layer_shim import (
    generate_via_agent_layer,
    should_route_through_agent_layer,
)


def test_routing_disabled_by_default():
    """Default settings.USE_AGENT_LAYER_FOR_STAGES = [] → legacy path
    for every stage."""
    with patch("app.agents.agent_layer_shim.settings") as mock_settings:
        mock_settings.USE_AGENT_LAYER_FOR_STAGES = []
        for stage_num in range(1, 13):
            assert should_route_through_agent_layer(stage_num) is False


def test_routing_phase_1_finalize_only():
    """Phase 1 config: only stage 12 (FINALIZE) routes through agents;
    stages 1–11 stay on legacy."""
    with patch("app.agents.agent_layer_shim.settings") as mock_settings:
        mock_settings.USE_AGENT_LAYER_FOR_STAGES = [12]
        for stage_num in range(1, 12):
            assert should_route_through_agent_layer(stage_num) is False
        assert should_route_through_agent_layer(12) is True


def test_routing_phase_3_full_migration():
    """Phase 3: every stage routes through the agent layer."""
    with patch("app.agents.agent_layer_shim.settings") as mock_settings:
        mock_settings.USE_AGENT_LAYER_FOR_STAGES = list(range(1, 13))
        for stage_num in range(1, 13):
            assert should_route_through_agent_layer(stage_num) is True


@pytest.mark.asyncio
async def test_generate_returns_plain_string():
    """The shim's return type must be `str` (not AgentResult) so the
    orchestrator's existing parser (`_parse_stage_output(response,
    stage_num)`) keeps working unchanged."""
    from app.agents.discovery_orchestrator import ModelType
    from app.services.agents._types import AgentResult, AgentStep
    from app.services.agents.pricing import TokenUsage

    fake_result = AgentResult(
        text="Synthesised final hypothesis.",
        steps=[AgentStep(text="Synthesised final hypothesis.")],
        stopped_reason="final_answer",
        model_label="bedrock/test",
        latency_ms=100,
        usage=TokenUsage(input_tokens=500, output_tokens=80),
        cost_cents=0.42,
    )

    with patch("app.agents.agent_layer_shim.settings") as mock_settings, \
         patch("app.services.agents.bedrock.BedrockClaudeAgent.run",
               new=AsyncMock(return_value=fake_result)):
        mock_settings.aws_access_key_id_value = "test-key"
        mock_settings.aws_secret_access_key_value = "test-secret"
        mock_settings.AWS_REGION = "us-east-1"
        mock_settings.BEDROCK_MODEL_CLAUDE_OPUS = "test-opus"
        mock_settings.BEDROCK_MODEL_CLAUDE_SONNET = "test-sonnet"
        mock_settings.AGENT_LAYER_SUB_AGENTS_PER_STAGE = 1

        out = await generate_via_agent_layer(
            model_type=ModelType.CLAUDE_OPUS,
            prompt="What's the hypothesis?",
            system_prompt="You are a research assistant.",
            max_tokens=2048,
            temperature=0.3,
            stage_num=12,
            stage_name="finalize",
            cost_ctx=None,  # cost recording opt-in
        )

    assert isinstance(out, str)
    assert out == "Synthesised final hypothesis."


@pytest.mark.asyncio
async def test_tools_passed_when_stage_opts_in():
    """When stage_num is in AGENT_LAYER_TOOLS_FOR_STAGES, the shim
    must build evidence_lookup + pubmed_search tools and pass them
    to agent.run()."""
    from app.agents.discovery_orchestrator import ModelType
    from app.services.agents._types import AgentResult, AgentStep
    from app.services.agents.pricing import TokenUsage

    fake_result = AgentResult(
        text="answer", steps=[AgentStep(text="answer")],
        stopped_reason="final_answer", model_label="bedrock/test",
        latency_ms=10, usage=TokenUsage(input_tokens=100, output_tokens=20),
        cost_cents=0.5,
    )
    captured_tools = []
    captured_max_steps = []

    async def fake_run(self, query, tools, system, max_steps):
        captured_tools.append([t.name for t in tools])
        captured_max_steps.append(max_steps)
        return fake_result

    with patch("app.agents.agent_layer_shim.settings") as mock_settings, \
         patch("app.services.agents.bedrock.BedrockClaudeAgent.run", new=fake_run):
        mock_settings.aws_access_key_id_value = "test"
        mock_settings.aws_secret_access_key_value = "test"
        mock_settings.AWS_REGION = "us-east-1"
        mock_settings.BEDROCK_MODEL_CLAUDE_OPUS = "test-opus"
        mock_settings.BEDROCK_MODEL_CLAUDE_SONNET = "test-sonnet"
        mock_settings.AGENT_LAYER_SUB_AGENTS_PER_STAGE = 1
        # Opt stage 9 (SCORE) into runtime tools.
        mock_settings.AGENT_LAYER_TOOLS_FOR_STAGES = [9]

        # Stage 9 → tools fire.
        await generate_via_agent_layer(
            model_type=ModelType.CLAUDE_OPUS,
            prompt="q", system_prompt="s",
            max_tokens=100, temperature=0.3,
            stage_num=9, stage_name="score",
            cost_ctx={"disease": "ovarian cancer"},
        )
        assert "lookup_evidence" in captured_tools[0]
        assert "pubmed_search" in captured_tools[0]
        assert captured_max_steps[0] == 4  # tool-enabled stage

        # Stage 12 → not in opt-in list, no tools, lower max_steps.
        await generate_via_agent_layer(
            model_type=ModelType.CLAUDE_OPUS,
            prompt="q", system_prompt="s",
            max_tokens=100, temperature=0.3,
            stage_num=12, stage_name="finalize",
            cost_ctx={"disease": "ovarian cancer"},
        )
        assert captured_tools[1] == []
        assert captured_max_steps[1] == 2  # no-tool stage


@pytest.mark.asyncio
async def test_enforcer_charge_called_with_agent_layer_usage():
    """When cost_ctx carries a _budget_enforcer, the shim must call
    enforcer.charge() so the per-run cap tracks agent-layer spend.
    Without this, finalize_run would underestimate the run's cost."""
    from app.agents.discovery_orchestrator import ModelType
    from app.services.agents._types import AgentResult, AgentStep
    from app.services.agents.pricing import TokenUsage

    fake_result = AgentResult(
        text="answer",
        steps=[AgentStep(text="answer")],
        stopped_reason="final_answer",
        model_label="bedrock/claude-opus-4-1",
        latency_ms=100,
        usage=TokenUsage(input_tokens=1000, output_tokens=200, reasoning_tokens=50),
        cost_cents=2.5,
    )

    enforcer = MagicMock()
    enforcer.charge = MagicMock(return_value=250)
    fake_tracker = MagicMock()
    fake_tracker.record_llm_call = AsyncMock()

    with patch("app.agents.agent_layer_shim.settings") as mock_settings, \
         patch("app.services.agents.bedrock.BedrockClaudeAgent.run",
               new=AsyncMock(return_value=fake_result)), \
         patch("app.services.cost_tracking_service.get_cost_tracker",
               return_value=fake_tracker):
        mock_settings.aws_access_key_id_value = "test"
        mock_settings.aws_secret_access_key_value = "test"
        mock_settings.AWS_REGION = "us-east-1"
        mock_settings.BEDROCK_MODEL_CLAUDE_OPUS = "test-opus"
        mock_settings.BEDROCK_MODEL_CLAUDE_SONNET = "test-sonnet"
        mock_settings.AGENT_LAYER_SUB_AGENTS_PER_STAGE = 1

        await generate_via_agent_layer(
            model_type=ModelType.CLAUDE_OPUS,
            prompt="q", system_prompt="s",
            max_tokens=2048, temperature=0.3,
            stage_num=12, stage_name="finalize",
            cost_ctx={
                "discovery_run_id": "run-1",
                "stage_number": 12,
                "stage_name": "finalize",
                "hypothesis_id": "hyp-1",
                "round_number": 1,
                "_budget_enforcer": enforcer,
            },
        )

    enforcer.charge.assert_called_once()
    call_kwargs = enforcer.charge.call_args.kwargs
    # Output tokens should include reasoning tokens (charged as output).
    assert call_kwargs["output_tokens"] == 250  # 200 + 50
    assert call_kwargs["input_tokens"] == 1000
    assert call_kwargs["provider"] == "bedrock"
    assert call_kwargs["stage_name"] == "finalize"


@pytest.mark.asyncio
async def test_enforcer_budget_exceeded_propagates():
    """If enforcer.charge raises BudgetExceeded, the shim must
    re-raise it so the orchestrator can abort the run."""
    from app.agents.discovery_orchestrator import ModelType
    from app.services.agents._types import AgentResult, AgentStep
    from app.services.agents.pricing import TokenUsage
    from app.services.budget_enforcer_service import BudgetExceeded

    fake_result = AgentResult(
        text="ok", steps=[AgentStep(text="ok")],
        stopped_reason="final_answer", model_label="bedrock/test",
        latency_ms=10, usage=TokenUsage(input_tokens=100, output_tokens=20),
        cost_cents=999.0,  # huge cost triggers cap
    )

    enforcer = MagicMock()
    enforcer.charge = MagicMock(side_effect=BudgetExceeded("cap exceeded"))
    fake_tracker = MagicMock()
    fake_tracker.record_llm_call = AsyncMock()

    with patch("app.agents.agent_layer_shim.settings") as mock_settings, \
         patch("app.services.agents.bedrock.BedrockClaudeAgent.run",
               new=AsyncMock(return_value=fake_result)), \
         patch("app.services.cost_tracking_service.get_cost_tracker",
               return_value=fake_tracker):
        mock_settings.aws_access_key_id_value = "test"
        mock_settings.aws_secret_access_key_value = "test"
        mock_settings.AWS_REGION = "us-east-1"
        mock_settings.BEDROCK_MODEL_CLAUDE_OPUS = "test-opus"
        mock_settings.BEDROCK_MODEL_CLAUDE_SONNET = "test-sonnet"
        mock_settings.AGENT_LAYER_SUB_AGENTS_PER_STAGE = 1

        with pytest.raises(BudgetExceeded):
            await generate_via_agent_layer(
                model_type=ModelType.CLAUDE_OPUS,
                prompt="q", system_prompt="s",
                max_tokens=100, temperature=0.3,
                stage_num=12, stage_name="finalize",
                cost_ctx={
                    "discovery_run_id": "run-1",
                    "_budget_enforcer": enforcer,
                },
            )


@pytest.mark.asyncio
async def test_cost_recording_failure_is_swallowed():
    """If the cost tracker raises (DB outage, etc.), the discovery
    run continues — billing writes are best-effort."""
    from app.agents.discovery_orchestrator import ModelType
    from app.services.agents._types import AgentResult, AgentStep
    from app.services.agents.pricing import TokenUsage

    fake_result = AgentResult(
        text="ok",
        steps=[AgentStep(text="ok")],
        stopped_reason="final_answer",
        model_label="bedrock/test",
        latency_ms=10,
        usage=TokenUsage(input_tokens=10, output_tokens=2),
        cost_cents=0.01,
    )

    failing_tracker = MagicMock()
    failing_tracker.record_llm_call = AsyncMock(side_effect=RuntimeError("DB down"))

    with patch("app.agents.agent_layer_shim.settings") as mock_settings, \
         patch("app.services.agents.bedrock.BedrockClaudeAgent.run",
               new=AsyncMock(return_value=fake_result)), \
         patch("app.services.cost_tracking_service.get_cost_tracker",
               return_value=failing_tracker):
        mock_settings.aws_access_key_id_value = "test"
        mock_settings.aws_secret_access_key_value = "test"
        mock_settings.AWS_REGION = "us-east-1"
        mock_settings.BEDROCK_MODEL_CLAUDE_OPUS = "test"
        mock_settings.BEDROCK_MODEL_CLAUDE_SONNET = "test"
        mock_settings.AGENT_LAYER_SUB_AGENTS_PER_STAGE = 1

        # Should not raise even though cost recording fails.
        out = await generate_via_agent_layer(
            model_type=ModelType.CLAUDE_OPUS,
            prompt="q", system_prompt="s",
            max_tokens=100, temperature=0.3,
            stage_num=12, stage_name="finalize",
            cost_ctx={
                "discovery_run_id": "run-1",
                "stage_number": 12,
                "stage_name": "finalize",
                "hypothesis_id": "hyp-1",
                "round_number": 1,
            },
        )

    assert out == "ok"
    failing_tracker.record_llm_call.assert_called_once()
