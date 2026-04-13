"""
Unit tests for app.compute.genomics.processor.GenomicsProcessor.

Targets deterministic, pure-math operations: FASTA parsing, pairwise
alignment, GC/codon analysis, and pathway enrichment on the bundled
KEGG/Reactome gene sets. Expression analyses (DESeq2-style) are
delegated to ExpressionProcessor and stay out of scope here.
"""
from __future__ import annotations

from typing import Any

import pytest

from app.compute.genomics.processor import GenomicsProcessor
from app.compute.types import ComputeDomain, ComputeRequest, ComputeStatus


def _req(op: str, **params: Any) -> ComputeRequest:
    return ComputeRequest(
        domain=ComputeDomain.GENOMICS,
        operation=op,
        parameters=params,
    )


@pytest.fixture
def proc() -> GenomicsProcessor:
    return GenomicsProcessor()


# ── read_fasta ─────────────────────────────────────────────────────────


async def test_read_fasta_parses_multi_record(proc: GenomicsProcessor) -> None:
    fasta = ">s1 first\nACGT\nACGT\n>s2 second\nGGGGCCCC\n"
    result = await proc.execute(_req("read_fasta", content=fasta))
    assert result.status is ComputeStatus.COMPLETED
    seqs = result.results["sequences"]
    assert [s["id"] for s in seqs] == ["s1", "s2"]
    assert seqs[0]["sequence"] == "ACGTACGT"
    assert seqs[0]["length"] == 8
    # s2 is all G/C ⇒ gc_content = 1.0
    assert seqs[1]["gc_content"] == pytest.approx(1.0)
    assert result.results["n_sequences"] == 2
    assert result.results["total_length"] == 16


# ── pairwise_alignment ─────────────────────────────────────────────────


async def test_pairwise_alignment_identical_sequences(proc: GenomicsProcessor) -> None:
    result = await proc.execute(
        _req("pairwise_alignment", seq_a="ACGTACGT", seq_b="ACGTACGT", method="global")
    )
    assert result.status is ComputeStatus.COMPLETED
    # Perfect match: identity 100%, no gaps, score = 8 matches * match_score(2) = 16.
    assert result.results["identity_percent"] == pytest.approx(100.0)
    assert result.results["gaps"] == 0
    assert result.results["score"] == pytest.approx(16.0)


async def test_pairwise_alignment_detects_mismatches(proc: GenomicsProcessor) -> None:
    result = await proc.execute(
        _req("pairwise_alignment", seq_a="ACGT", seq_b="ACCT", method="global")
    )
    assert result.status is ComputeStatus.COMPLETED
    # 3 matches out of 4 aligned positions ⇒ 75% identity, no gaps.
    assert result.results["identity_percent"] == pytest.approx(75.0)
    assert result.results["gaps"] == 0
    assert result.results["alignment_length"] == 4


# ── gc_content_analysis ────────────────────────────────────────────────


async def test_gc_content_all_gc_is_one(proc: GenomicsProcessor) -> None:
    result = await proc.execute(
        _req("gc_content_analysis", sequence="GCGCGCGCGCGCGCGCGCGC", window=10, step=5)
    )
    assert result.status is ComputeStatus.COMPLETED
    assert result.results["overall_gc"] == pytest.approx(1.0)
    # Every window is pure GC ⇒ every profile entry = 1.0.
    for entry in result.results["gc_profile"]:
        assert entry["gc_content"] == pytest.approx(1.0)


async def test_gc_content_all_at_is_zero(proc: GenomicsProcessor) -> None:
    result = await proc.execute(
        _req("gc_content_analysis", sequence="ATATATATATATATATATAT", window=10, step=5)
    )
    assert result.status is ComputeStatus.COMPLETED
    assert result.results["overall_gc"] == pytest.approx(0.0)


# ── codon_usage ────────────────────────────────────────────────────────


async def test_codon_usage_single_codon_dominates(proc: GenomicsProcessor) -> None:
    # 5× Met codon → methionine should be 100% of amino acids, 0 stops.
    result = await proc.execute(_req("codon_usage", sequence="ATGATGATGATGATG"))
    assert result.status is ComputeStatus.COMPLETED
    assert result.results["total_codons"] == 5
    assert result.results["n_stop_codons"] == 0
    aa_freq = result.results["amino_acid_frequencies"]
    assert aa_freq["M"] == pytest.approx(1.0)
    # Non-Met codons all count 0.
    assert result.results["codon_table"]["ATG"]["count"] == 5
    assert result.results["codon_table"]["TTT"]["count"] == 0


async def test_codon_usage_counts_stop_codons(proc: GenomicsProcessor) -> None:
    # TAA, TAG, TGA are the three stops → expect n_stop_codons == 3.
    result = await proc.execute(_req("codon_usage", sequence="TAATAGTGA"))
    assert result.status is ComputeStatus.COMPLETED
    assert result.results["total_codons"] == 3
    assert result.results["n_stop_codons"] == 3


# ── pathway_enrichment ─────────────────────────────────────────────────


async def test_pathway_enrichment_flags_cell_cycle(proc: GenomicsProcessor) -> None:
    # Query is the full KEGG cell-cycle pathway gene list ⇒ that pathway
    # should top the ranking with a highly significant raw p-value.
    cell_cycle_genes = ["TP53", "RB1", "CDK2", "CDK4", "CCND1", "CCNE1", "E2F1", "CDC25A"]
    result = await proc.execute(
        _req("pathway_enrichment", genes=cell_cycle_genes, database="kegg", background_size=20000)
    )
    assert result.status is ComputeStatus.COMPLETED
    top = result.results["results"][0]
    assert top["pathway_id"] == "hsa04110"
    assert top["overlap_count"] == len(cell_cycle_genes)
    assert top["p_value"] < 1e-20  # full overlap against 8/20k ⇒ vanishingly small.


# ── dispatcher error paths ─────────────────────────────────────────────


async def test_unknown_genomics_op_fails(proc: GenomicsProcessor) -> None:
    result = await proc.execute(_req("definitely_not_an_op"))
    assert result.status is ComputeStatus.FAILED
    assert "Unknown operation" in (result.error or "")


async def test_handler_exception_is_captured(proc: GenomicsProcessor) -> None:
    # pairwise_alignment requires seq_a/seq_b — omitting them triggers KeyError,
    # which the dispatcher should translate into a FAILED result.
    result = await proc.execute(_req("pairwise_alignment"))
    assert result.status is ComputeStatus.FAILED
