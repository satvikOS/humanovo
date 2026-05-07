"""
Mermaid Diagram Generator

Emits Mermaid.js source for:
  - flowchart       (mechanism, decision trees, pipeline diagrams)
  - sequence        (signaling cascade, pathway sequence)
  - class           (protein / complex composition)
  - state           (disease progression, regulatory states)
  - journey         (patient journey, clinical workflow)
  - gantt           (translational roadmap, trial phases)

The PaperFormatter embeds the raw mermaid source as a fenced code block
(` ```mermaid `) which front-end renderers can display live, AND attempts
to pre-render a PNG via `mermaid-cli` (mmdc) when available for PDF
embedding. If mmdc is not installed, the raw source is included and the
PDF renderer falls back to a text-based representation.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class MermaidKind(str, Enum):
    FLOWCHART = "flowchart"
    SEQUENCE = "sequenceDiagram"
    CLASS = "classDiagram"
    STATE = "stateDiagram-v2"
    JOURNEY = "journey"
    GANTT = "gantt"
    MINDMAP = "mindmap"


@dataclass
class MermaidDiagram:
    kind: MermaidKind
    title: str
    source: str            # full mermaid source, including the kind header
    png_b64: str = ""      # base64 PNG if mmdc available
    caption: str = ""
    notes: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Builders — produce mermaid source from structured inputs
# ---------------------------------------------------------------------------


def build_flowchart(
    *,
    title: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    direction: str = "TD",
) -> str:
    """nodes = [{'id': str, 'label': str, 'shape': 'rect|round|diamond|circle'}]
       edges = [{'from': str, 'to': str, 'label': str, 'style': 'solid|dashed'}]"""
    lines = [f"flowchart {direction}"]
    for n in nodes:
        nid = _safe_id(n["id"])
        label = _escape(n.get("label", nid))
        shape = n.get("shape", "rect")
        if shape == "round":
            lines.append(f'  {nid}({label})')
        elif shape == "diamond":
            lines.append(f'  {nid}{{{label}}}')
        elif shape == "circle":
            lines.append(f'  {nid}(({label}))')
        elif shape == "subroutine":
            lines.append(f'  {nid}[[{label}]]')
        elif shape == "cylinder":
            lines.append(f'  {nid}[({label})]')
        else:
            lines.append(f'  {nid}[{label}]')
    for e in edges:
        f = _safe_id(e["from"])
        t = _safe_id(e["to"])
        label = e.get("label", "")
        arrow = "-->" if e.get("style", "solid") == "solid" else "-.->"
        if label:
            lines.append(f'  {f} {arrow}|{_escape(label)}| {t}')
        else:
            lines.append(f'  {f} {arrow} {t}')
    return "\n".join(lines)


def build_sequence(
    *,
    title: str,
    participants: list[str],
    messages: list[dict[str, Any]],
) -> str:
    """messages = [{'from': str, 'to': str, 'text': str, 'style': 'sync|async|return'}]"""
    lines = ["sequenceDiagram", f"  title {title}"]
    for p in participants:
        lines.append(f'  participant {_safe_id(p)} as {_escape(p)}')
    for m in messages:
        arrow = {"sync": "->>", "async": "->>+", "return": "-->>"}.get(m.get("style", "sync"), "->>")
        f, t = _safe_id(m["from"]), _safe_id(m["to"])
        text = _escape(m.get("text", ""))
        lines.append(f'  {f}{arrow}{t}: {text}')
    return "\n".join(lines)


def build_state(
    *,
    title: str,
    states: list[str],
    transitions: list[dict[str, Any]],
    initial: str | None = None,
    final: str | None = None,
) -> str:
    lines = ["stateDiagram-v2", "  direction LR"]
    if title:
        lines.insert(0, f"---\ntitle: {title}\n---")
    if initial:
        lines.append(f"  [*] --> {_safe_id(initial)}")
    for s in states:
        lines.append(f'  {_safe_id(s)} : {_escape(s)}')
    for t in transitions:
        f = _safe_id(t["from"])
        to = _safe_id(t["to"])
        label = _escape(t.get("label", ""))
        if label:
            lines.append(f"  {f} --> {to}: {label}")
        else:
            lines.append(f"  {f} --> {to}")
    if final:
        lines.append(f"  {_safe_id(final)} --> [*]")
    return "\n".join(lines)


def build_journey(
    *,
    title: str,
    sections: list[dict[str, Any]],
) -> str:
    """sections = [{'name': str, 'steps': [{'text': str, 'score': 1-5, 'actor': str}]}]"""
    lines = ["journey", f"  title {title}"]
    for s in sections:
        lines.append(f'  section {s.get("name", "")}')
        for step in s.get("steps", []):
            actor = step.get("actor", "")
            lines.append(f'    {step.get("text","")}: {step.get("score",3)}: {actor}')
    return "\n".join(lines)


def build_gantt(
    *,
    title: str,
    sections: list[dict[str, Any]],
    date_format: str = "YYYY-MM-DD",
) -> str:
    """sections = [{'name': str, 'tasks': [{'name': str, 'id': str, 'start': str, 'duration': str, 'status': 'done|active|crit'}]}]"""
    lines = ["gantt", f"  dateFormat  {date_format}", f"  title       {title}"]
    for s in sections:
        lines.append(f'  section {s.get("name","")}')
        for t in s.get("tasks", []):
            status_tag = ""
            st = t.get("status")
            if st in ("done", "active", "crit"):
                status_tag = f"{st}, "
            lines.append(
                f'    {t.get("name","")} :{status_tag}{t.get("id","")}, '
                f'{t.get("start","")}, {t.get("duration","")}'
            )
    return "\n".join(lines)


def build_mindmap(
    *,
    title: str,
    root: dict[str, Any],
) -> str:
    """root = {'label': str, 'children': [{'label': str, 'children': [...]}, ...]}"""
    lines = ["mindmap", f"  root(({_escape(title)}))"]

    def walk(node: dict, depth: int) -> None:
        for child in node.get("children", []):
            lines.append(f"{'  ' * (depth + 1)}{_escape(child['label'])}")
            if child.get("children"):
                walk(child, depth + 1)

    walk(root, 1)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Public renderer
# ---------------------------------------------------------------------------


def render_mermaid(
    source: str,
    *,
    title: str = "",
    caption: str = "",
    kind: MermaidKind | None = None,
) -> MermaidDiagram:
    """Take a mermaid source string and attempt PNG rendering via mmdc.

    Returns a MermaidDiagram with both the source and (when possible) a
    base64 PNG for PDF embedding.
    """
    if kind is None:
        kind = _infer_kind(source)

    png_b64 = _try_render_png(source) or ""
    return MermaidDiagram(
        kind=kind,
        title=title,
        source=source,
        png_b64=png_b64,
        caption=caption,
        notes=[] if png_b64 else [
            "mermaid-cli (mmdc) not installed or rendering failed; "
            "PNG fallback omitted. Source will render in live web viewer."
        ],
    )


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _escape(s: str) -> str:
    return str(s).replace('"', "'").replace("\n", " ")


def _safe_id(s: str) -> str:
    import re
    return re.sub(r"[^A-Za-z0-9_]", "_", str(s))[:48] or "n"


def _infer_kind(source: str) -> MermaidKind:
    first = source.strip().splitlines()[0].lower() if source.strip() else ""
    if first.startswith("flowchart") or first.startswith("graph"):
        return MermaidKind.FLOWCHART
    if first.startswith("sequencediagram"):
        return MermaidKind.SEQUENCE
    if first.startswith("classdiagram"):
        return MermaidKind.CLASS
    if first.startswith("statediagram"):
        return MermaidKind.STATE
    if first.startswith("journey"):
        return MermaidKind.JOURNEY
    if first.startswith("gantt"):
        return MermaidKind.GANTT
    if first.startswith("mindmap"):
        return MermaidKind.MINDMAP
    return MermaidKind.FLOWCHART


def _try_render_png(source: str) -> str | None:
    """Try `mmdc -i src.mmd -o out.png`. Returns base64 PNG on success."""
    mmdc = shutil.which("mmdc")
    if mmdc is None:
        return None
    try:
        with tempfile.TemporaryDirectory() as tmp:
            src_path = Path(tmp) / "diagram.mmd"
            out_path = Path(tmp) / "diagram.png"
            src_path.write_text(source, encoding="utf-8")
            res = subprocess.run(
                [mmdc, "-i", str(src_path), "-o", str(out_path),
                 "-b", "transparent", "-s", "2"],
                capture_output=True, timeout=30,
            )
            if res.returncode != 0 or not out_path.exists():
                logger.debug(f"mmdc rc={res.returncode} stderr={res.stderr[:200]!r}")
                return None
            import base64
            return base64.b64encode(out_path.read_bytes()).decode("ascii")
    except (subprocess.TimeoutExpired, OSError) as e:
        logger.debug(f"mmdc rendering failed: {e}")
        return None
