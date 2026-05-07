"""
Unit tests for app.compute.schemas — the OPERATION_SCHEMAS registry the
frontend uses to auto-generate expert-mode parameter forms. Guards
against accidentally breaking the shape that the React form renderer
depends on.
"""
from __future__ import annotations

from app.compute.schemas import OPERATION_SCHEMAS, P, ParamType, _sel

# ── P() builder ────────────────────────────────────────────────────────


def test_p_builder_required_keys() -> None:
    p = P("x", "X value", "number", required=True)
    assert p["name"] == "x"
    assert p["label"] == "X value"
    assert p["type"] == "number"
    assert p["required"] is True
    assert p["group"] == "General"  # default group
    # Optional fields omitted when falsy-None.
    assert "default" not in p
    assert "description" not in p


def test_p_builder_passes_through_extras() -> None:
    p = P(
        "alpha",
        "Alpha",
        "number",
        default=0.05,
        min=0.001,
        max=0.2,
        step=0.005,
        description="Significance threshold",
        group="Options",
    )
    assert p["default"] == 0.05
    assert p["min"] == 0.001
    assert p["max"] == 0.2
    assert p["step"] == 0.005
    assert p["description"] == "Significance threshold"
    assert p["group"] == "Options"


def test_p_builder_kwargs_land_on_dict() -> None:
    # Unknown kw should end up on the dict so the renderer stays extensible.
    p = P("n", "N", "integer", max_length=32)
    assert p["max_length"] == 32


def test_p_builder_default_zero_is_preserved() -> None:
    # `default=0` must not get silently dropped (the current implementation
    # uses `is not None`, which is what we want — this test pins that).
    p = P("offset", "Offset", "number", default=0)
    assert p["default"] == 0


# ── _sel() option builder ──────────────────────────────────────────────


def test_sel_builds_value_label_dicts() -> None:
    opts = _sel([("a", "A"), ("b", "B")])
    assert opts == [
        {"value": "a", "label": "A"},
        {"value": "b", "label": "B"},
    ]


# ── Registry shape ─────────────────────────────────────────────────────


def test_registry_is_non_empty() -> None:
    assert len(OPERATION_SCHEMAS) > 40  # we ship schemas across 7+ domains


def test_every_registry_key_uses_domain_slash_operation() -> None:
    for key in OPERATION_SCHEMAS:
        assert "/" in key, f"schema key '{key}' missing domain prefix"
        domain, op = key.split("/", 1)
        assert domain and op, f"malformed key '{key}'"


def test_every_schema_has_title_description_params() -> None:
    for key, schema in OPERATION_SCHEMAS.items():
        assert "title" in schema, f"{key}: missing title"
        assert "description" in schema, f"{key}: missing description"
        assert "params" in schema, f"{key}: missing params"
        assert isinstance(schema["params"], list)


def test_every_param_has_canonical_fields() -> None:
    required_keys = {"name", "label", "type", "required", "group"}
    for key, schema in OPERATION_SCHEMAS.items():
        seen_names: set[str] = set()
        for p in schema["params"]:
            missing = required_keys - p.keys()
            assert not missing, f"{key}/{p.get('name')}: missing {missing}"
            # No duplicate param names within one schema.
            assert p["name"] not in seen_names, f"{key}: duplicate param '{p['name']}'"
            seen_names.add(p["name"])


def test_select_params_expose_options() -> None:
    # Every select / multi_select param must ship a non-empty options list
    # shaped like {value, label}; the renderer blindly iterates over it.
    select_types = {ParamType.SELECT, ParamType.MULTI_SELECT}
    for key, schema in OPERATION_SCHEMAS.items():
        for p in schema["params"]:
            if p["type"] not in select_types:
                continue
            assert "options" in p, f"{key}/{p['name']}: select missing options"
            assert p["options"], f"{key}/{p['name']}: select has empty options"
            for opt in p["options"]:
                assert "value" in opt and "label" in opt, (
                    f"{key}/{p['name']}: option {opt} missing value/label"
                )


def test_select_defaults_are_valid_options() -> None:
    # If a select param carries a default, that default must appear in the
    # options list — otherwise the form boots with an invalid selection.
    for key, schema in OPERATION_SCHEMAS.items():
        for p in schema["params"]:
            if p["type"] != ParamType.SELECT or "default" not in p:
                continue
            values = {o["value"] for o in p.get("options", [])}
            assert p["default"] in values, (
                f"{key}/{p['name']}: default '{p['default']}' not in {values}"
            )


def test_param_types_are_known() -> None:
    # Keep the param-type vocabulary closed so the frontend form renderer
    # doesn't have to silently ignore unrecognized strings.
    allowed = {
        ParamType.NUMBER, ParamType.INTEGER, ParamType.STRING, ParamType.BOOLEAN,
        ParamType.SELECT, ParamType.MULTI_SELECT, ParamType.ARRAY, ParamType.MATRIX,
        ParamType.FILE, ParamType.DATASET, ParamType.JSON, ParamType.RANGE,
    }
    for key, schema in OPERATION_SCHEMAS.items():
        for p in schema["params"]:
            assert p["type"] in allowed, f"{key}/{p['name']}: unknown type '{p['type']}'"
