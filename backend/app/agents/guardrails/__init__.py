"""
Humanovo Guardrails — The ONLY active content safety layer.

Per product directive: "no guardrails apart from HIPAA data".
Scientific freedom for biomedical reasoning is preserved; the ONLY blocks
are PHI/PII exfiltration into LLM prompts, embeddings, or shared outputs.

Every prompt that reaches AWS Bedrock / Azure OpenAI / any external provider
MUST pass through `scrub_for_external_provider()` first.
Every LLM response going into the shared Knowledge Graph MUST pass through
`scrub_for_kg_ingest()`.
"""

from app.agents.guardrails.phi_pii_detector import (
    PHIPIIDetector,
    PHIPIIFinding,
    RedactionResult,
    get_detector,
    scrub_for_external_provider,
    scrub_for_kg_ingest,
)

__all__ = [
    "PHIPIIDetector",
    "PHIPIIFinding",
    "RedactionResult",
    "get_detector",
    "scrub_for_external_provider",
    "scrub_for_kg_ingest",
]
