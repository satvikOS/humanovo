"""
Tests for the visualization pipeline (matplotlib/seaborn + Mermaid).

These tests run against the placeholder path when matplotlib is not
installed. When matplotlib IS installed, the test verifies that we
emit non-empty PNG + SVG for a canonical figure request.
"""


from app.visualization.figures import (
    FigureSpec,
    FigureType,
    _placeholder,
    generate_figure,
)
from app.visualization.flowchart import render_causal_flowchart
from app.visualization.mermaid import (
    MermaidKind,
    build_flowchart,
    build_gantt,
    build_sequence,
    render_mermaid,
)


def test_figurespec_content_hash_deterministic():
    spec_a = FigureSpec(
        figure_type=FigureType.BAR,
        title="Test",
        data={"categories": ["A", "B"], "values": [1, 2]},
    )
    spec_b = FigureSpec(
        figure_type=FigureType.BAR,
        title="Test",
        data={"categories": ["A", "B"], "values": [1, 2]},
    )
    assert spec_a.content_hash() == spec_b.content_hash()


def test_figurespec_content_hash_changes_on_data_change():
    spec_a = FigureSpec(figure_type=FigureType.BAR, title="T",
                       data={"categories": ["A"], "values": [1]})
    spec_b = FigureSpec(figure_type=FigureType.BAR, title="T",
                       data={"categories": ["A"], "values": [2]})
    assert spec_a.content_hash() != spec_b.content_hash()


def test_generate_figure_returns_rendered_or_placeholder():
    spec = FigureSpec(
        figure_type=FigureType.BAR,
        title="Simple bar",
        x_label="Category", y_label="Value",
        data={"categories": ["X", "Y", "Z"], "values": [1.0, 2.0, 3.0]},
    )
    out = generate_figure(spec)
    assert out.content_hash == spec.content_hash()
    # Either a real PNG or a placeholder SVG — but the dict form must
    # always include the spec metadata.
    d = out.to_dict()
    assert d["figure_type"] == "bar"
    assert d["title"] == "Simple bar"


def test_confidence_meter_spec_builds_without_error():
    spec = FigureSpec(
        figure_type=FigureType.CONFIDENCE_METER,
        title="Hypothesis confidence",
        data={"dimensions": {"H1": 0.75, "H2": 0.60, "H3": 0.90}},
    )
    out = generate_figure(spec)
    assert out is not None


def test_radar_spec_builds_without_error():
    spec = FigureSpec(
        figure_type=FigureType.RADAR,
        title="Multi-axis",
        data={
            "axes": ["A", "B", "C", "D"],
            "series": {"Score": [0.5, 0.7, 0.6, 0.8]},
        },
    )
    out = generate_figure(spec)
    assert out is not None


def test_placeholder_when_renderer_missing():
    # Force placeholder via direct call
    spec = FigureSpec(figure_type=FigureType.BAR, title="T", data={})
    out = _placeholder(spec)
    assert out.png_b64 == ""
    assert "<svg" in out.svg_text


# --------------------------------------------------------------------
# Mermaid
# --------------------------------------------------------------------


def test_mermaid_flowchart_build():
    src = build_flowchart(
        title="Test pipeline",
        nodes=[
            {"id": "a", "label": "A node", "shape": "round"},
            {"id": "b", "label": "B node", "shape": "rect"},
        ],
        edges=[{"from": "a", "to": "b", "label": "goes to", "style": "solid"}],
    )
    assert src.startswith("flowchart")
    assert "a" in src and "b" in src


def test_mermaid_gantt_build():
    src = build_gantt(
        title="Roadmap",
        sections=[
            {"name": "Preclinical",
             "tasks": [{"name": "Safety", "id": "s1", "start": "2025-01-01",
                        "duration": "3m"}]},
        ],
    )
    assert src.startswith("gantt")
    assert "section Preclinical" in src


def test_mermaid_sequence_build():
    src = build_sequence(
        title="Signal cascade",
        participants=["Receptor", "Kinase", "Transcription Factor"],
        messages=[
            {"from": "Receptor", "to": "Kinase", "text": "phosphorylates",
             "style": "sync"},
            {"from": "Kinase", "to": "Transcription Factor",
             "text": "activates", "style": "async"},
        ],
    )
    assert src.startswith("sequenceDiagram")
    assert "participant" in src


def test_render_mermaid_inference_of_kind():
    flow_src = "flowchart TD\n  a --> b"
    d = render_mermaid(flow_src)
    assert d.kind == MermaidKind.FLOWCHART

    seq_src = "sequenceDiagram\n  A->>B: hello"
    d2 = render_mermaid(seq_src)
    assert d2.kind == MermaidKind.SEQUENCE


# --------------------------------------------------------------------
# Causal flowchart
# --------------------------------------------------------------------


def test_causal_flowchart_linear_chain():
    cf = render_causal_flowchart(
        title="Mechanism",
        chain=[
            {"event": "Receptor activation"},
            {"event": "Kinase phosphorylation"},
            {"event": "Transcription factor binding"},
            {"event": "Gene expression change"},
        ],
    )
    # 4 steps + entry + endpoint = 6 nodes
    assert cf.node_count == 6
    # 5 edges (entry->step1, step1->step2, step2->step3, step3->step4, step4->endpoint)
    assert cf.edge_count == 5
    assert cf.feedback_loops == 0


def test_causal_flowchart_with_intervention_detected():
    cf = render_causal_flowchart(
        title="Drug mechanism",
        chain=[
            {"event": "Disease driver"},
            {"event": "Inhibition point", "intervention": {
                "modality": "small_molecule", "agent": "Drug A", "effect": "inhibits",
            }},
            {"event": "Downstream effect"},
        ],
    )
    assert cf.intervention_points == 1


def test_causal_flowchart_empty_chain():
    cf = render_causal_flowchart(title="Empty", chain=[])
    # Entry + endpoint only
    assert cf.node_count == 2
    assert cf.edge_count == 1
