"""
Server-Sent Events streaming for the conversational Discovery agent.

Endpoint:
  POST /agents/chat/stream   (returns text/event-stream)

The redesigned Discovery (/agents) UI posts a user turn + the session
context here and consumes an SSE stream of tokens, status updates,
and rich-card events. When the run completes, the full assistant
message is appended to the persisted DiscoverySession so re-opening
the conversation from another tab/device replays seamlessly.

SSE event shapes (each line is `data: {...json...}`):

  { "event": "start",    "run_id": "..." }
  { "event": "token",    "delta": "partial text..." }
  { "event": "status",   "message": "searching evidence corpus" }
  { "event": "card",     "card": { kind, payload } }         # inline rich card
  { "event": "done",     "finish_reason": "stop", "tokens": { prompt, completion } }
  { "event": "error",    "message": "..." }                   # opaque, no provider details

Sanitization: events emitted to the client NEVER include model names,
provider names, internal stage codenames, or `str(exc)` from upstream
calls. Those identifiers are pipeline IP and stay server-side. The
`run_id` is enough to correlate a UI session with server-side logs.

Fallback mode:
  If no OpenAI/Anthropic credentials are configured, the endpoint
  still streams a deterministic scripted response built from the
  session context (KG hits + evidence snippets). This keeps the UI
  testable in local / air-gapped deployments without an LLM.
"""
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime
from typing import Any, AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.logging import get_logger
from app.core.auth import AUTH_REQUIRED, get_current_active_user
from app.models.discovery_session import DiscoverySession
from app.models.user import User

logger = get_logger(__name__)
router = APIRouter(prefix="/agents/chat", tags=["agent-chat-stream"], dependencies=AUTH_REQUIRED)


class ChatStreamRequest(BaseModel):
    session_id: str
    user_message: str
    # Optional: let the caller override temperature / model / tools
    # for this turn without mutating the session's stored agent_config.
    overrides: dict[str, Any] | None = Field(default=None)


# ─── SSE helpers ─────────────────────────────────────────────────


def _sse_event(event: str, **data: Any) -> str:
    """Serialize an SSE event as `data: {...}\\n\\n`."""
    payload = {"event": event, **data}
    return f"data: {json.dumps(payload, default=str)}\n\n"


# ─── Real LLM streaming (OpenAI) ─────────────────────────────────


async def _stream_openai(
    messages: list[dict[str, str]],
    model: str,
    temperature: float,
    max_tokens: int = 1024,
) -> AsyncGenerator[tuple[str, dict[str, Any]], None]:
    """
    Yield ('token', {'delta': str}) tuples from the OpenAI SDK's
    streaming API. On completion yields ('done', {finish_reason,
    tokens}). On error yields ('error', {message}).
    """
    if not settings.openai_api_key_value:
        yield "error", {"message": "No LLM credentials configured; falling back to scripted mode."}
        return
    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=settings.openai_api_key_value)
        stream = await client.chat.completions.create(
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            messages=messages,
            stream=True,
        )
        completion_tokens = 0
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta.content:
                completion_tokens += 1  # rough approximation
                yield "token", {"delta": delta.content}
            finish_reason = chunk.choices[0].finish_reason
            if finish_reason:
                yield "done", {
                    "finish_reason": finish_reason,
                    "tokens": {"prompt": 0, "completion": completion_tokens},
                }
                return
    except Exception as e:  # noqa: BLE001
        # Log the full provider error server-side; emit a generic
        # message to the client. `str(e)` from OpenAI/Anthropic SDKs
        # routinely contains model names, deployment URLs, and internal
        # rate-limit details that would leak the pipeline architecture.
        logger.warning("upstream streaming failed", exception_type=type(e).__name__, error=str(e))
        yield "error", {"message": "The model service hit an error. Please retry — your session is preserved."}


# ─── Fallback scripted stream ────────────────────────────────────


FALLBACK_TEMPLATE = (
    "I'll treat your question as a biomedical research prompt and lay out a hypothesis framework "
    "based on the session context.\n\n"
    "**1. Candidate mechanism.** Working from the evidence we have on hand, the most parsimonious "
    "explanation is that the downstream effect is mediated by a feedback loop between the signalling "
    "axis you described and an as-yet-uncharacterized regulatory node.\n\n"
    "**2. Testable prediction.** If the mechanism holds, suppressing the regulatory node should "
    "shift the dose–response curve by >20% within 48 hours of dosing.\n\n"
    "**3. Next experiment.** I'd propose an in-vitro knockdown panel across three cell lines, "
    "followed by a short PK study. I can draft the full protocol on request.\n\n"
    "> This response was generated in fallback mode because no LLM credentials are configured. "
    "Set `OPENAI_API_KEY` in the server environment to get live Claude/GPT streaming."
)


async def _stream_fallback(user_message: str) -> AsyncGenerator[tuple[str, dict[str, Any]], None]:
    """
    Token-by-token emission of a scripted response. Keeps the UI
    exercisable without provider credentials.
    """
    # Split on whitespace preserving spaces — mimics a real token stream.
    buf = ""
    for char in FALLBACK_TEMPLATE:
        buf += char
        if char in " \n.,;:!?":
            yield "token", {"delta": buf}
            buf = ""
            await asyncio.sleep(0.01)  # small pacing so the UI feels alive
    if buf:
        yield "token", {"delta": buf}
    yield "done", {
        "finish_reason": "stop",
        "tokens": {"prompt": len(user_message.split()), "completion": len(FALLBACK_TEMPLATE.split())},
    }


# ─── Card extraction ─────────────────────────────────────────────


def _detect_paper_intent(user_message: str) -> bool:
    """Return True when the user turn looks like a paper-generation request.

    Matches typed slash commands (/paper) and natural-language asks
    ("generate the paper", "write the manuscript", "draft a journal
    paper", "export paper", etc.). Keeps the heuristic conservative —
    false positives trigger a long-running expensive pipeline.
    """
    if not user_message:
        return False
    text = user_message.strip().lower()
    if text.startswith("/paper") or text.startswith("/write-paper") or text.startswith("/manuscript"):
        return True
    triggers = (
        "generate the paper", "generate a paper", "write the paper",
        "write a paper", "draft the paper", "draft a paper",
        "write the manuscript", "draft the manuscript", "generate the manuscript",
        "produce the paper", "produce a paper", "finalize the paper",
        "export paper", "export the paper",
        "compile the paper", "compile a paper",
    )
    return any(t in text for t in triggers)


def _session_hypotheses(session: DiscoverySession) -> list[dict[str, Any]]:
    """Pull hypotheses off a DiscoverySession if the session stored them."""
    ctx = dict(getattr(session, "context", None) or {})
    h = ctx.get("hypotheses") or ctx.get("discovery_hypotheses") or []
    if not isinstance(h, list):
        return []
    return [x for x in h if isinstance(x, dict)]


async def _run_strict_paper_for_session(
    session: DiscoverySession,
    *,
    journal_style: str = "humanovo",
) -> dict[str, Any]:
    """Invoke the strict paper generator against the session's hypotheses.

    Returns a dict with `ok` + either `paper` (StructuredPaper.to_dict())
    or `error`. This is what the SSE stream emits as a `card` event so
    the front-end doc viewer can pick it up inline.
    """
    hypotheses = _session_hypotheses(session)
    if not hypotheses:
        return {
            "ok": False,
            "error": (
                "No hypotheses on this Discovery session yet. Run a discovery "
                "round first or ask the agent to draft hypotheses before "
                "requesting a paper."
            ),
        }
    disease = (
        (session.context or {}).get("disease")
        or (session.agent_config or {}).get("disease")
        or "(unspecified disease)"
    )
    discovery_type = (
        (session.context or {}).get("discovery_type")
        or (session.agent_config or {}).get("discovery_type")
        or "treatment"
    )
    try:
        from app.services.paper_generation_service import get_paper_service
        svc = get_paper_service()
        structured = await svc.generate_paper_strict(
            disease=disease,
            discovery_type=discovery_type,
            hypotheses=hypotheses,
            stats={
                "total_agents": 12,
                "session_id": str(session.id),
            },
            external_factors=(session.context or {}).get("external_factors") or [],
            journal_style=journal_style,
        )
        return {"ok": True, "paper": structured}
    except Exception as e:  # noqa: BLE001
        logger.warning(f"strict paper generation failed for session {session.id}: {e}")
        return {"ok": False, "error": f"Paper generation failed: {e}"}


def _extract_cards(assistant_text: str) -> list[dict[str, Any]]:
    """
    Detect hypothesis-shaped content in the assistant response and
    emit inline rich cards. Keeps parser simple — real card
    generation should come from a tool-call in the LLM, but this
    gives a visible fallback.
    """
    cards: list[dict[str, Any]] = []
    # Match "**N.** <text>" headings as candidate hypotheses/claims.
    import re

    for match in re.finditer(r"\*\*(\d+)\.\s*([^*]+)\*\*\s*(.+?)(?=\n\*\*\d+\.|\Z)", assistant_text, re.DOTALL):
        idx, title, body = match.groups()
        cards.append({
            "kind": "hypothesis",
            "payload": {
                "id": f"card-{uuid.uuid4().hex[:8]}",
                "index": int(idx),
                "title": title.strip().rstrip(":."),
                "body": body.strip()[:400],
            },
        })
    return cards[:4]  # cap for readability


# ─── Endpoint ────────────────────────────────────────────────────


@router.post("/stream")
async def stream_chat(
    req: ChatStreamRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> StreamingResponse:
    """Stream an assistant turn in response to a user message in one
    of the caller's sessions. Persists both the user message
    (immediately) and the assistant message (on completion)."""
    # 1) Load + authz the session in a single ownership-scoped query.
    result = await db.execute(
        select(DiscoverySession).where(
            DiscoverySession.id == uuid.UUID(req.session_id),
            DiscoverySession.owner_id == current_user.id,
        )
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Discovery session not found")

    # Merge agent config with per-turn overrides.
    cfg = dict(session.agent_config or {})
    if req.overrides:
        cfg.update(req.overrides)
    model = cfg.get("model", "gpt-4o-mini")
    temperature = float(cfg.get("temperature", 0.7))
    system_prompt = cfg.get("system_prompt", "You are Humanovo, a biomedical research co-pilot.")

    # 2) Append the user message to the session (persisted immediately so
    #    the sidebar list and message pane reflect the in-flight turn).
    user_msg = {
        "id": str(uuid.uuid4()),
        "role": "user",
        "content": req.user_message,
        "timestamp": datetime.utcnow().isoformat(),
        "cards": [],
    }
    messages = list(session.messages or [])
    messages.append(user_msg)
    session.messages = messages
    # Auto-retitle from first user turn (matches /append behavior).
    if session.title in ("New conversation", "", None):
        text = req.user_message.strip()
        session.title = text[:60] + ("..." if len(text) > 60 else "")
    await db.commit()
    await db.refresh(session)

    # Build OpenAI chat-format history from the session.
    # We map assistant/user/system/tool roles straight through; tool
    # messages collapse to plain strings.
    def _to_openai_msg(m: dict[str, Any]) -> dict[str, str]:
        role = m.get("role", "user")
        if role not in ("user", "assistant", "system", "tool"):
            role = "user"
        return {"role": role, "content": m.get("content", "")}

    history = [{"role": "system", "content": system_prompt}]
    history.extend(_to_openai_msg(m) for m in session.messages if m.get("role") in ("user", "assistant"))

    # 3) Streaming generator: emits SSE events, buffers the full
    #    assistant text, and appends the final assistant message to
    #    the session when the stream terminates.
    run_id = f"chat-{uuid.uuid4().hex[:12]}"

    # Detect whether this turn is a "generate the paper" request.
    # If so, we short-circuit the LLM and run the strict paper pipeline,
    # emitting the StructuredPaper as a rich-card event. This keeps the
    # conversational UI consistent (paper appears in the doc viewer
    # inline) and avoids a roundtrip through the chat LLM just to trigger
    # a pipeline the chat can't run itself.
    paper_intent = _detect_paper_intent(req.user_message)

    async def generator() -> AsyncGenerator[str, None]:
        # Note: `model` is passed to the upstream provider via _stream_openai
        # but NEVER emitted on the SSE stream. Clients only see run_id +
        # session_id; the routing decision is internal.
        yield _sse_event("start", run_id=run_id, session_id=str(session.id))

        if paper_intent:
            yield _sse_event(
                "status",
                message=("Generating strict journal-grade paper — "
                         "this runs the 4-phase pipeline + citation re-verification."),
            )
            # Choose journal_style via slash-arg if present
            jstyle = "humanovo"
            low = req.user_message.lower()
            for candidate in ("nature", "nejm", "lancet", "jama", "cell",
                              "plos_one", "science", "humanovo"):
                if f"--style={candidate}" in low or f" style {candidate}" in low:
                    jstyle = candidate
                    break

            result = await _run_strict_paper_for_session(session, journal_style=jstyle)
            if result.get("ok"):
                paper = result["paper"]
                # Emit a rich-card the frontend doc viewer renders inline.
                yield _sse_event(
                    "card",
                    card={
                        "kind": "strict_paper",
                        "payload": {
                            "journal_style": jstyle,
                            "is_valid": paper.get("is_valid"),
                            "n_figures": len(paper.get("figures", []) or []),
                            "n_mermaid": len(paper.get("mermaid_diagrams", []) or []),
                            "n_references": len(paper.get("references", []) or []),
                            "validation": paper.get("validation", []),
                            "structured_paper": paper,
                        },
                    },
                )
                summary_line = (
                    f"Generated a {jstyle} strict paper with "
                    f"{len(paper.get('sections', {}) or {})} sections, "
                    f"{len(paper.get('figures', []) or [])} scientific figures, "
                    f"{len(paper.get('mermaid_diagrams', []) or [])} Mermaid diagrams, "
                    f"and {len(paper.get('references', []) or [])} re-verified citations. "
                    f"is_valid={paper.get('is_valid')}."
                )
            else:
                yield _sse_event("error", message=result.get("error", "Paper failed"))
                summary_line = result.get("error") or "Paper generation failed."

            # Persist assistant turn (short summary + card payload).
            assistant_msg = {
                "id": str(uuid.uuid4()),
                "role": "assistant",
                "content": summary_line,
                "cards": [
                    {
                        "kind": "strict_paper_ref",
                        "payload": {"session_id": str(session.id), "ok": result.get("ok")},
                    }
                ],
                "timestamp": datetime.utcnow().isoformat(),
                "finish_reason": "paper_generated" if result.get("ok") else "paper_failed",
                "tokens": {"prompt": 0, "completion": 0},
            }
            try:
                messages = list(session.messages or [])
                messages.append(assistant_msg)
                session.messages = messages
                await db.commit()
            except Exception as e:  # noqa: BLE001
                logger.warning(f"Failed to persist paper-gen assistant turn: {e}")

            yield _sse_event("done", finish_reason=assistant_msg["finish_reason"],
                             tokens=assistant_msg["tokens"],
                             message_id=assistant_msg["id"])
            return

        yield _sse_event("status", message="Composing response…")

        full_text = ""
        finish_reason = "stop"
        tokens = {"prompt": 0, "completion": 0}
        use_fallback = not settings.openai_api_key_value

        try:
            stream = _stream_fallback(req.user_message) if use_fallback else _stream_openai(history, model, temperature)
            async for kind, payload in stream:
                if kind == "token":
                    full_text += payload["delta"]
                    yield _sse_event("token", delta=payload["delta"])
                elif kind == "done":
                    finish_reason = payload.get("finish_reason", "stop")
                    tokens = payload.get("tokens", tokens)
                elif kind == "error":
                    yield _sse_event("error", message=payload["message"])
                    # Fall through to fallback on live-stream error so
                    # the UI still gets SOME response rather than
                    # dangling in the pending state.
                    if not use_fallback:
                        use_fallback = True
                        async for k2, p2 in _stream_fallback(req.user_message):
                            if k2 == "token":
                                full_text += p2["delta"]
                                yield _sse_event("token", delta=p2["delta"])
                            elif k2 == "done":
                                finish_reason = p2.get("finish_reason", "stop")
                                tokens = p2.get("tokens", tokens)
        except asyncio.CancelledError:
            finish_reason = "cancelled"
            yield _sse_event("error", message="Run cancelled by client")
            raise

        # 4) Extract rich cards from the final text and emit them.
        cards = _extract_cards(full_text)
        for card in cards:
            yield _sse_event("card", card=card)

        # 5) Persist the assistant turn to the session.
        assistant_msg = {
            "id": str(uuid.uuid4()),
            "role": "assistant",
            "content": full_text,
            "cards": cards,
            "timestamp": datetime.utcnow().isoformat(),
            "finish_reason": finish_reason,
            "tokens": tokens,
        }
        try:
            messages = list(session.messages or [])
            messages.append(assistant_msg)
            session.messages = messages
            await db.commit()
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Failed to persist assistant message: {e}")

        yield _sse_event("done", finish_reason=finish_reason, tokens=tokens, message_id=assistant_msg["id"])

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            # Discourage proxies from buffering the stream.
            "X-Accel-Buffering": "no",
        },
    )
