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
