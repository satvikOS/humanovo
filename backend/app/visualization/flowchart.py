"""
Causal Mechanism Flowchart

Takes a structured causal chain (as emitted by the MECHANISM stage) and
produces a Mermaid flowchart. Handles branching, feedback loops, and
pharmacological intervention annotations.

Input format (the `causal_chain` field on a hypothesis):

    [
      {
        "event": "Target protein X binds receptor Y",
        "level": "molecular",          # molecular | cellular | tissue | systemic
        "kind": "activation",          # activation | inhibition | binding | ...
        "downstream": ["event_id_2", "event_id_3"],
        "intervention": {              # optional
          "modality": "small_molecule",
          "agent": "drug A",
          "effect": "inhibits"
        }
      },
      ...
    ]

The renderer:
  - Uses diamond shape for decision points (branches).
  - Uses rectangles for events.
  - Uses rounded nodes for intervention points.
  - Uses dashed edges for feedback loops.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.visualization.mermaid import (
    MermaidDiagram,
    build_flowchart,
    render_mermaid,
)


@dataclass
class CausalFlowchart:
    diagram: MermaidDiagram
    node_count: int = 0
    edge_count: int = 0
    feedback_loops: int = 0
    intervention_points: int = 0


def render_causal_flowchart(
    *,
    title: str,
    chain: list[dict[str, Any]],
    entrypoint_label: str = "Upstream Trigger",
    endpoint_label: str = "Therapeutic Outcome",
    orientation: str = "TD",
) -> CausalFlowchart:
    """Convert a causal-chain list into a Mermaid flowchart.

    Accepts both:
      - Simple linear chain: each element is a string or dict with 'event';
        we connect them in order and add entrypoint/endpoint.
      - Rich graph: each element has 'id' and 'downstream' ids.
    """
    if not chain:
        empty_src = (
            f"flowchart {orientation}\n"
            f"  entry[({entrypoint_label})]\n"
            f"  end1[({endpoint_label})]\n"
            f"  entry -.-> end1"
        )
        return CausalFlowchart(
            diagram=render_mermaid(empty_src, title=title),
            node_count=2, edge_count=1,
        )

    # Normalize
    normalized: list[dict[str, Any]] = []
    for i, step in enumerate(chain):
        if isinstance(step, str):
            normalized.append({"id": f"n{i}", "event": step, "downstream": []})
        elif isinstance(step, dict):
            d = dict(step)
            d["id"] = d.get("id", f"n{i}")
            d["event"] = d.get("event", d.get("description", f"Step {i+1}"))
            d["downstream"] = d.get("downstream", [])
            normalized.append(d)

    # Build node list
    nodes: list[dict[str, Any]] = []
    nodes.append({"id": "entry", "label": entrypoint_label, "shape": "cylinder"})

    intervention_count = 0
    for step in normalized:
        shape = "rect"
        label = step["event"]
        if step.get("branch") is True or "decision" in (step.get("kind") or "").lower():
            shape = "diamond"
        if step.get("intervention"):
            shape = "round"
            iv = step["intervention"]
            label = f"{label}\n[INTERVENTION: {iv.get('agent','?')} {iv.get('effect','')}]"
            intervention_count += 1
        nodes.append({"id": step["id"], "label": label, "shape": shape})

    nodes.append({"id": "endpoint", "label": endpoint_label, "shape": "cylinder"})

    # Build edges
    edges: list[dict[str, Any]] = []
    edges.append({"from": "entry", "to": normalized[0]["id"], "label": "", "style": "solid"})

    feedback_count = 0
    for i, step in enumerate(normalized):
        downstream = step.get("downstream") or []
        if downstream:
            for ds_id in downstream:
                # Detect feedback: target id appears earlier in the chain
                target_idx = next(
                    (j for j, s in enumerate(normalized) if s["id"] == ds_id), None,
                )
                is_feedback = target_idx is not None and target_idx < i
                edges.append({
                    "from": step["id"],
                    "to": ds_id,
                    "label": "feedback" if is_feedback else "",
                    "style": "dashed" if is_feedback else "solid",
                })
                if is_feedback:
                    feedback_count += 1
        else:
            # Linear fallback: connect to next
            if i < len(normalized) - 1:
                edges.append({
                    "from": step["id"], "to": normalized[i + 1]["id"],
                    "label": step.get("kind", ""), "style": "solid",
                })
            else:
                edges.append({
                    "from": step["id"], "to": "endpoint",
                    "label": "", "style": "solid",
                })

    src = build_flowchart(
        title=title, nodes=nodes, edges=edges, direction=orientation,
    )
    diagram = render_mermaid(src, title=title, kind=None)

    return CausalFlowchart(
        diagram=diagram,
        node_count=len(nodes),
        edge_count=len(edges),
        feedback_loops=feedback_count,
        intervention_points=intervention_count,
    )
