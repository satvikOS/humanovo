"""Pricing helpers for the grounded-agent layer.

A lightweight loader for `backend/config/model_pricing.json` that the
agent layer can use without pulling in SQLAlchemy or the full
`cost_tracking_service` module — keeps the swarm smoke runnable in CI
with just `boto3 + openai + httpx`. Production code can keep using
`cost_tracking_service.compute_cost_cents` for DB-persisted billing;
this module is the in-memory companion that travels with each
AgentResult."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class ModelPricing:
    """Per-model pricing in *cents* per 1M tokens (matches the JSON
    schema in `backend/config/model_pricing.json`)."""
    name: str
    input_cents_per_million: float
    output_cents_per_million: float
    provider: str = ""

    def cost_cents(
        self,
        input_tokens: int,
        output_tokens: int,
        cached_tokens: int = 0,
    ) -> float:
        """Compute cost in cents. Cached tokens are subtracted from
        input_tokens (most providers either don't bill cached input
        or bill at a deep discount; we treat as free for now to
        match cost_tracking_service.compute_cost_cents)."""
        billable_input = max(0, input_tokens - cached_tokens)
        return (
            (billable_input * self.input_cents_per_million / 1_000_000.0)
            + (output_tokens * self.output_cents_per_million / 1_000_000.0)
        )


@dataclass
class TokenUsage:
    """Token-usage record captured from a single LLM round-trip."""
    input_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    """o-series + Claude reasoning models report reasoning tokens
    separately. They're counted as output tokens for billing (what
    the provider charges for) but tracked here for diagnostics —
    a stage spending all its tokens reasoning vs answering is a
    visible signal."""
    cached_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    def add(self, other: "TokenUsage") -> "TokenUsage":
        return TokenUsage(
            input_tokens=self.input_tokens + other.input_tokens,
            output_tokens=self.output_tokens + other.output_tokens,
            reasoning_tokens=self.reasoning_tokens + other.reasoning_tokens,
            cached_tokens=self.cached_tokens + other.cached_tokens,
        )


# In-memory cache so we don't re-parse the JSON on every call.
_pricing_cache: dict[str, ModelPricing] | None = None


def _pricing_path() -> Path:
    # backend/app/services/agents/pricing.py → backend/config/model_pricing.json
    return Path(__file__).resolve().parents[3] / "config" / "model_pricing.json"


def _load_pricing() -> dict[str, ModelPricing]:
    global _pricing_cache
    if _pricing_cache is not None:
        return _pricing_cache
    path = _pricing_path()
    out: dict[str, ModelPricing] = {}
    try:
        with open(path) as f:
            raw = json.load(f)
        for name, entry in raw.items():
            out[name] = ModelPricing(
                name=name,
                input_cents_per_million=float(entry.get("input_cost_per_1m_tokens_cents", 0)),
                output_cents_per_million=float(entry.get("output_cost_per_1m_tokens_cents", 0)),
                provider=str(entry.get("provider", "")),
            )
    except FileNotFoundError:
        # No pricing file means cost is reported as 0 — production code
        # logs a warning via cost_tracking_service when this happens.
        pass
    _pricing_cache = out
    return out


def lookup_pricing(model_label_or_id: str) -> ModelPricing | None:
    """Resolve pricing for a model. Tries exact match first, then a
    case-insensitive substring match (so `bedrock/claude-opus-4-1`
    matches the pricing entry `claude-opus-4-1`, etc.). Returns None
    if no pricing entry exists."""
    table = _load_pricing()
    if not model_label_or_id:
        return None
    if model_label_or_id in table:
        return table[model_label_or_id]
    lc = model_label_or_id.lower()
    # Prefer the LONGEST matching key — claude-sonnet-4-5 should win
    # over claude-sonnet-4 when the label contains both.
    matches = [k for k in table if k.lower() in lc or lc in k.lower()]
    if not matches:
        return None
    matches.sort(key=len, reverse=True)
    return table[matches[0]]


def cost_cents(
    model_label_or_id: str,
    usage: TokenUsage,
) -> float:
    """Convenience: look up pricing + compute. Returns 0 if no
    pricing entry is found (logged in production but silent in the
    smoke; the smoke surfaces "no pricing" via a separate diagnostic)."""
    p = lookup_pricing(model_label_or_id)
    if p is None:
        return 0.0
    return p.cost_cents(
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens + usage.reasoning_tokens,
        cached_tokens=usage.cached_tokens,
    )
