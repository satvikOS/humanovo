"""
Citation Accuracy Benchmark

PURPOSE: Quantify citation accuracy of the humanovo pipeline
by verifying every citation in every hypothesis output.

This is the proof behind the "94% citation accuracy" claim.
Without this script producing a number, that claim is marketing copy.

Verification steps per citation:
  1. DOI/PMID resolution — does the paper exist?
  2. Author verification — do the authors match?
  3. Year verification — is the year correct?
  4. Semantic relevance — does the paper's abstract support the claim?
  5. Fabrication check — is the citation hallucinated?

Usage:
  python -m benchmark.citation_accuracy \
    --input tests/integration/reports/ \
    --output benchmark/results/citation_report.json

Dependencies:
  pip install httpx biopython sentence-transformers
"""

import argparse
import asyncio
import json
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import httpx


# ─── Data Types ──────────────────────────────────────────────────

@dataclass
class Citation:
    """A single citation extracted from pipeline output."""
    raw_text: str
    doi: Optional[str] = None
    pmid: Optional[str] = None
    title: Optional[str] = None
    authors: list[str] = field(default_factory=list)
    year: Optional[str] = None
    claim_text: str = ""  # The claim this citation supports


@dataclass
class CitationVerification:
    """Verification result for a single citation."""
    citation: Citation
    exists: bool = False
    doi_resolved: bool = False
    pmid_resolved: bool = False
    authors_match: bool = False
    year_match: bool = False
    semantic_relevance: float = 0.0
    is_fabricated: bool = True  # Guilty until proven innocent
    error: Optional[str] = None

    @property
    def is_valid(self) -> bool:
        """A citation is valid if it exists AND is semantically relevant."""
        return self.exists and self.semantic_relevance >= 0.4 and not self.is_fabricated


@dataclass
class BenchmarkReport:
    """Complete benchmark report."""
    total_citations: int = 0
    valid_citations: int = 0
    invalid_citations: int = 0
    fabricated_citations: int = 0
    accuracy: float = 0.0
    mean_semantic_relevance: float = 0.0
    verifications: list[CitationVerification] = field(default_factory=list)
    elapsed_seconds: float = 0.0


# ─── Citation Extraction ────────────────────────────────────────

DOI_PATTERN = re.compile(r"10\.\d{4,}/[^\s\]\)\"',;]+")
PMID_PATTERN = re.compile(r"PMID[:\s]*(\d{7,9})")
YEAR_PATTERN = re.compile(r"\b(19\d{2}|20[0-2]\d)\b")


def extract_citations_from_text(text: str) -> list[Citation]:
    """Extract citation-like references from pipeline output text."""
    citations = []

    # Strategy 1: DOI-based extraction
    for doi_match in DOI_PATTERN.finditer(text):
        doi = doi_match.group().rstrip(".,;)")
        # Find surrounding context (the claim)
        start = max(0, doi_match.start() - 300)
        claim = text[start:doi_match.start()].strip()
        citations.append(Citation(raw_text=doi, doi=doi, claim_text=claim))

    # Strategy 2: PMID-based extraction
    for pmid_match in PMID_PATTERN.finditer(text):
        pmid = pmid_match.group(1)
        start = max(0, pmid_match.start() - 300)
        claim = text[start:pmid_match.start()].strip()
        # Skip if we already have this as a DOI citation
        if not any(c.pmid == pmid for c in citations):
            citations.append(Citation(raw_text=f"PMID:{pmid}", pmid=pmid, claim_text=claim))

    # Strategy 3: Bracket reference patterns [Author et al., Year]
    bracket_pattern = re.compile(
        r"\[([A-Z][a-z]+(?:\s+et\s+al\.?)?,?\s*\d{4}[a-z]?)\]"
    )
    for match in bracket_pattern.finditer(text):
        ref_text = match.group(1)
        year_match = YEAR_PATTERN.search(ref_text)
        year = year_match.group() if year_match else None
        author = ref_text.split(",")[0].strip().replace(" et al.", "").replace(" et al", "")

        start = max(0, match.start() - 300)
        claim = text[start:match.start()].strip()

        citations.append(Citation(
            raw_text=match.group(),
            year=year,
            authors=[author] if author else [],
            claim_text=claim,
        ))

    return citations


# ─── Verification Engines ───────────────────────────────────────

async def verify_doi(client: httpx.AsyncClient, doi: str) -> dict:
    """Resolve a DOI via CrossRef API."""
    try:
        resp = await client.get(
            f"https://api.crossref.org/works/{doi}",
            headers={"User-Agent": "humanovo-benchmark/1.0 (mailto:benchmark@humanovo.com)"},
            timeout=15.0,
        )
        if resp.status_code == 200:
            data = resp.json()["message"]
            title = data.get("title", [""])[0]
            authors = []
            for a in data.get("author", []):
                name = f"{a.get('given', '')} {a.get('family', '')}".strip()
                if name:
                    authors.append(name)
            year = str(data.get("published-print", data.get("published-online", {}))
                       .get("date-parts", [[None]])[0][0] or "")
            return {"exists": True, "title": title, "authors": authors, "year": year}
    except Exception:
        pass
    return {"exists": False}


async def verify_pmid(client: httpx.AsyncClient, pmid: str) -> dict:
    """Resolve a PMID via NCBI E-utilities."""
    try:
        resp = await client.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
            params={"db": "pubmed", "id": pmid, "retmode": "json"},
            timeout=15.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            result = data.get("result", {}).get(pmid, {})
            if "error" not in result:
                title = result.get("title", "")
                authors = [a.get("name", "") for a in result.get("authors", [])]
                year = result.get("pubdate", "")[:4]
                doi = ""
                for aid in result.get("articleids", []):
                    if aid.get("idtype") == "doi":
                        doi = aid.get("value", "")
                return {"exists": True, "title": title, "authors": authors, "year": year, "doi": doi}
    except Exception:
        pass
    return {"exists": False}


async def verify_citation(
    client: httpx.AsyncClient,
    citation: Citation,
) -> CitationVerification:
    """Run all verification steps on a single citation."""
    v = CitationVerification(citation=citation)

    # Step 1: Resolve the paper
    paper_data = None
    if citation.doi:
        paper_data = await verify_doi(client, citation.doi)
        v.doi_resolved = paper_data.get("exists", False)

    if not paper_data or not paper_data.get("exists"):
        if citation.pmid:
            paper_data = await verify_pmid(client, citation.pmid)
            v.pmid_resolved = paper_data.get("exists", False)

    if paper_data and paper_data.get("exists"):
        v.exists = True
        v.is_fabricated = False

        # Step 2: Author verification
        if citation.authors and paper_data.get("authors"):
            cite_authors = {a.lower().split()[-1] for a in citation.authors if a}
            paper_authors = {a.lower().split()[-1] for a in paper_data["authors"] if a}
            if cite_authors and paper_authors:
                overlap = cite_authors & paper_authors
                v.authors_match = len(overlap) > 0

        # Step 3: Year verification
        if citation.year and paper_data.get("year"):
            v.year_match = citation.year == paper_data["year"]

        # Step 4: Semantic relevance (simple keyword overlap for now)
        # TODO: Replace with embedding similarity when sentence-transformers
        # is available in the benchmark environment
        if citation.claim_text and paper_data.get("title"):
            claim_words = set(citation.claim_text.lower().split())
            title_words = set(paper_data["title"].lower().split())
            # Remove stopwords
            stopwords = {"the", "a", "an", "in", "of", "and", "or", "to", "is", "was",
                         "for", "on", "with", "that", "this", "by", "from", "as", "at",
                         "be", "are", "were", "been", "have", "has", "had", "it", "not"}
            claim_words -= stopwords
            title_words -= stopwords
            if claim_words and title_words:
                overlap = claim_words & title_words
                v.semantic_relevance = len(overlap) / max(len(title_words), 1)
            else:
                v.semantic_relevance = 0.0
        else:
            v.semantic_relevance = 0.0
    else:
        v.is_fabricated = True
        v.error = "Paper not found via DOI or PMID"

    return v


# ─── Main Benchmark Runner ──────────────────────────────────────

async def run_benchmark(
    hypothesis_texts: list[str],
) -> BenchmarkReport:
    """Run citation accuracy benchmark on a list of hypothesis texts."""
    report = BenchmarkReport()
    start = time.time()

    # Extract all citations
    all_citations = []
    for text in hypothesis_texts:
        citations = extract_citations_from_text(text)
        all_citations.extend(citations)

    report.total_citations = len(all_citations)
    print(f"Extracted {report.total_citations} citations from {len(hypothesis_texts)} hypotheses")

    if report.total_citations == 0:
        print("WARNING: No citations found. Pipeline output may not include DOIs/PMIDs.")
        report.elapsed_seconds = time.time() - start
        return report

    # Verify each citation
    async with httpx.AsyncClient() as client:
        tasks = [verify_citation(client, c) for c in all_citations]
        # Run in batches of 10 to respect rate limits
        batch_size = 10
        for i in range(0, len(tasks), batch_size):
            batch = tasks[i:i + batch_size]
            results = await asyncio.gather(*batch, return_exceptions=True)
            for r in results:
                if isinstance(r, Exception):
                    v = CitationVerification(
                        citation=all_citations[i],
                        error=str(r),
                    )
                    report.verifications.append(v)
                else:
                    report.verifications.append(r)
            # Rate limit pause
            if i + batch_size < len(tasks):
                await asyncio.sleep(1.0)

    # Calculate metrics
    report.valid_citations = sum(1 for v in report.verifications if v.is_valid)
    report.invalid_citations = report.total_citations - report.valid_citations
    report.fabricated_citations = sum(1 for v in report.verifications if v.is_fabricated)
    report.accuracy = (
        report.valid_citations / report.total_citations
        if report.total_citations > 0
        else 0.0
    )
    relevance_scores = [v.semantic_relevance for v in report.verifications if v.exists]
    report.mean_semantic_relevance = (
        sum(relevance_scores) / len(relevance_scores) if relevance_scores else 0.0
    )
    report.elapsed_seconds = time.time() - start

    return report


def report_to_dict(report: BenchmarkReport) -> dict:
    """Convert report to JSON-serializable dict."""
    return {
        "total_citations": report.total_citations,
        "valid_citations": report.valid_citations,
        "invalid_citations": report.invalid_citations,
        "fabricated_citations": report.fabricated_citations,
        "accuracy": round(report.accuracy, 4),
        "accuracy_percent": f"{report.accuracy * 100:.1f}%",
        "mean_semantic_relevance": round(report.mean_semantic_relevance, 4),
        "elapsed_seconds": round(report.elapsed_seconds, 1),
        "verifications": [
            {
                "raw": v.citation.raw_text,
                "doi": v.citation.doi,
                "pmid": v.citation.pmid,
                "exists": v.exists,
                "doi_resolved": v.doi_resolved,
                "pmid_resolved": v.pmid_resolved,
                "authors_match": v.authors_match,
                "year_match": v.year_match,
                "semantic_relevance": round(v.semantic_relevance, 3),
                "is_fabricated": v.is_fabricated,
                "is_valid": v.is_valid,
                "error": v.error,
            }
            for v in report.verifications
        ],
    }


# ─── CLI Entry Point ────────────────────────────────────────────

async def main():
    parser = argparse.ArgumentParser(description="Citation Accuracy Benchmark")
    parser.add_argument(
        "--input", "-i",
        required=True,
        help="Directory containing pipeline output JSON files, or a single JSON file",
    )
    parser.add_argument(
        "--output", "-o",
        default="benchmark/results/citation_report.json",
        help="Output report path",
    )
    parser.add_argument(
        "--text-field",
        default="final_hypothesis",
        help="JSON field name containing the hypothesis text",
    )
    args = parser.parse_args()

    # Load hypothesis texts
    input_path = Path(args.input)
    texts = []

    if input_path.is_file():
        with open(input_path) as f:
            data = json.load(f)
            if isinstance(data, list):
                texts = [d.get(args.text_field, "") for d in data if d.get(args.text_field)]
            elif isinstance(data, dict):
                text = data.get(args.text_field, "")
                if text:
                    texts.append(text)
    elif input_path.is_dir():
        for fp in sorted(input_path.glob("*.json")):
            with open(fp) as f:
                data = json.load(f)
                text = data.get(args.text_field, "")
                if text:
                    texts.append(text)

    if not texts:
        print(f"ERROR: No hypothesis texts found in {args.input}")
        print(f"  Looked for JSON field '{args.text_field}'")
        return

    print(f"Loaded {len(texts)} hypothesis texts from {args.input}")
    print("Running citation accuracy benchmark...\n")

    report = await run_benchmark(texts)
    result = report_to_dict(report)

    # Print summary
    print("\n" + "=" * 60)
    print("CITATION ACCURACY BENCHMARK RESULTS")
    print("=" * 60)
    print(f"  Total citations:     {result['total_citations']}")
    print(f"  Valid citations:     {result['valid_citations']}")
    print(f"  Invalid citations:   {result['invalid_citations']}")
    print(f"  Fabricated:          {result['fabricated_citations']}")
    print(f"  ACCURACY:            {result['accuracy_percent']}")
    print(f"  Mean relevance:      {result['mean_semantic_relevance']:.3f}")
    print(f"  Time:                {result['elapsed_seconds']:.1f}s")
    print("=" * 60)

    # Save report
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, "w") as f:
        json.dump(result, f, indent=2)
    print(f"\nFull report saved to {args.output}")


if __name__ == "__main__":
    asyncio.run(main())
