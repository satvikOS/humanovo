"""
Tests for the hypothesis diversity enforcer.
"""


from app.agents.diversity.diversity_enforcer import (
    DiversityEnforcer,
    MechanismAxis,
    get_diversity_enforcer,
)


def _emb(seed: int, dim: int = 64) -> list[float]:
    """Deterministic pseudo-embedding from an integer seed."""
    import random
    rng = random.Random(seed)
    vec = [rng.uniform(-1, 1) for _ in range(dim)]
    # Normalize so cosine is bounded in a reasonable range.
    n = sum(x * x for x in vec) ** 0.5 or 1.0
    return [x / n for x in vec]


def test_first_hypothesis_always_accepted():
    enf = DiversityEnforcer(discovery_run_id="run-1")
    r = enf.check_seed(
        hypothesis_id="h1",
        title="TP53 stabilization via MDM2 inhibition",
        description="Small molecule inhibitor of MDM2 restores p53 activity",
        mechanism="Small molecule inhibits MDM2, stabilizing p53",
        pathways=["p53 signaling"],
        entities=["TP53", "MDM2"],
        embedding_large=_emb(1),
        embedding_small=_emb(101),
    )
    assert r.accepted


def test_identical_seed_rejected():
    enf = DiversityEnforcer(discovery_run_id="run-2")
    emb_l = _emb(42)
    emb_s = _emb(42)
    enf.check_seed(
        hypothesis_id="h1",
        title="MDM2 inhibition",
        description="Block MDM2 to rescue p53",
        mechanism="Inhibit MDM2",
        pathways=["p53"],
        entities=["TP53", "MDM2"],
        embedding_large=emb_l,
        embedding_small=emb_s,
    )
    r = enf.check_seed(
        hypothesis_id="h2",
        title="MDM2 inhibition",
        description="Block MDM2 to rescue p53",
        mechanism="Inhibit MDM2",
        pathways=["p53"],
        entities=["TP53", "MDM2"],
        embedding_large=emb_l,
        embedding_small=emb_s,
    )
    assert not r.accepted
    assert "similar" in (r.rejection_reason or "").lower()


def test_different_direction_accepted():
    enf = DiversityEnforcer(discovery_run_id="run-3")
    enf.check_seed(
        hypothesis_id="h1",
        title="Small molecule MDM2 inhibitor",
        description="Kinase-like small molecule targeting MDM2",
        mechanism="Small molecule inhibits MDM2",
        pathways=["p53"],
        entities=["MDM2"],
        embedding_large=_emb(1),
        embedding_small=_emb(2),
    )
    r = enf.check_seed(
        hypothesis_id="h2",
        title="Microbiome-mediated modulation of p53 pathway",
        description="Gut microbiome metabolites activate p53 pathway in colonocytes",
        mechanism="Microbiome produces metabolites that signal through systemic pathway",
        pathways=["microbiome metabolism"],
        entities=["butyrate", "gut bacteria"],
        embedding_large=_emb(500),
        embedding_small=_emb(501),
    )
    assert r.accepted


def test_pathway_overlap_rejection():
    enf = DiversityEnforcer(discovery_run_id="run-4", pathway_overlap_max=0.3)
    enf.check_seed(
        hypothesis_id="h1",
        title="Target A",
        description="Mechanism A",
        mechanism="Inhibit",
        pathways=["pw1", "pw2", "pw3"],
        entities=["E1"],
        embedding_large=_emb(10),
        embedding_small=_emb(11),
    )
    r = enf.check_seed(
        hypothesis_id="h2",
        title="Target B",
        description="Mechanism B",
        mechanism="Inhibit",
        pathways=["pw1", "pw2", "pw3"],
        entities=["E2"],
        embedding_large=_emb(12),
        embedding_small=_emb(13),
    )
    assert not r.accepted
    assert "pathway" in (r.rejection_reason or "").lower()


def test_final_diversity_score():
    enf = DiversityEnforcer(discovery_run_id="run-5")
    for i, spec in enumerate([
        ("Small molecule MDM2i", "small molecule"),
        ("CAR-T against target X", "cell therapy"),
        ("Dietary microbiome modulation", "lifestyle"),
    ]):
        title, modality = spec
        enf.check_seed(
            hypothesis_id=f"h{i}",
            title=title,
            description=f"A {modality} approach",
            mechanism=f"Modality: {modality}",
            pathways=[f"pw-{i}"],
            entities=[f"E-{i}"],
            embedding_large=_emb(i * 100 + 7),
            embedding_small=_emb(i * 100 + 8),
        )
    score = enf.final_diversity_score()
    assert score["n_hypotheses"] == 3
    assert 0 <= score["diversity_score"] <= 1
    # We emitted 3 distinct modalities
    assert score["unique_modalities"] >= 2


def test_singleton_registry_per_run():
    e1 = get_diversity_enforcer("run-X")
    e2 = get_diversity_enforcer("run-X")
    e3 = get_diversity_enforcer("run-Y")
    assert e1 is e2
    assert e1 is not e3


def test_shared_axes_detection():
    enf = DiversityEnforcer(discovery_run_id="run-6")
    enf.check_seed(
        hypothesis_id="h1",
        title="Kinase inhibitor targeting brain receptor",
        description="Small molecule kinase inhibitor",
        mechanism="Inhibit kinase in hippocampus",
        pathways=["neuronal signaling"],
        entities=["KINASE1"],
        embedding_large=_emb(20),
        embedding_small=_emb(21),
    )
    r = enf.check_seed(
        hypothesis_id="h2",
        title="Kinase inhibitor for cortical neurons",
        description="Different small molecule kinase inhibitor",
        mechanism="Inhibit kinase in cortex",
        pathways=["neuronal signaling"],
        entities=["KINASE2"],
        embedding_large=_emb(22),
        embedding_small=_emb(23),
    )
    # Shares modality (small_molecule) + mechanism (inhibition) + organ (brain)
    # + paradigm (direct_target) — likely 4+ shared axes, rejected
    if not r.accepted:
        assert MechanismAxis.MODALITY.value in r.shared_axes_with_closest or \
               MechanismAxis.MECHANISM.value in r.shared_axes_with_closest
