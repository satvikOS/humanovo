"""
Unit tests for app.compute.ingestion.parsers.DataIngestionEngine.

Covers the extension/magic-byte format detection and every text-based
parser (CSV, JSON, XML, FASTA, FASTQ, VCF) plus NumPy NPY. Binary
biomedical formats (DICOM, NIfTI, EDF, C3D, MAT) need real fixture
files to test meaningfully and are covered by integration tests.
"""
from __future__ import annotations

import io
import json

import numpy as np
import pytest

from app.compute.ingestion.parsers import DataIngestionEngine


# ── Format detection ───────────────────────────────────────────────────


def test_detect_format_by_extension() -> None:
    assert DataIngestionEngine.detect_format("data.csv") == "csv"
    assert DataIngestionEngine.detect_format("data.tsv") == "csv"
    assert DataIngestionEngine.detect_format("sheet.xlsx") == "excel"
    assert DataIngestionEngine.detect_format("payload.json") == "json"
    assert DataIngestionEngine.detect_format("gene.fasta") == "fasta"
    assert DataIngestionEngine.detect_format("gene.fa") == "fasta"
    assert DataIngestionEngine.detect_format("reads.fq") == "fastq"
    assert DataIngestionEngine.detect_format("scan.dcm") == "dicom"


def test_detect_format_case_insensitive() -> None:
    # Extensions arrive from the client with any casing.
    assert DataIngestionEngine.detect_format("DATA.CSV") == "csv"
    assert DataIngestionEngine.detect_format("Sheet.XLSX") == "excel"


def test_detect_format_handles_nii_gz() -> None:
    # Compound extension needs the full-name check.
    assert DataIngestionEngine.detect_format("brain.nii.gz") == "nifti"
    assert DataIngestionEngine.detect_format("brain.nii") == "nifti"


def test_detect_format_from_magic_bytes() -> None:
    # Unknown extension → fall back to magic bytes.
    assert DataIngestionEngine.detect_format("mystery.bin", b"\x89PNG\r\n\x1a\n") == "png"
    assert DataIngestionEngine.detect_format("mystery.bin", b"\xff\xd8\xff\xe0") == "jpeg"
    assert DataIngestionEngine.detect_format("mystery.bin", b"\x89HDF\r\n\x1a\n") == "hdf5"
    assert DataIngestionEngine.detect_format("mystery.bin", b"II*\x00extra") == "tiff"
    assert DataIngestionEngine.detect_format("mystery.bin", b"RIFF....WAVE") == "wav"


def test_detect_format_unknown_raises() -> None:
    with pytest.raises(ValueError, match="Cannot detect format"):
        DataIngestionEngine.detect_format("mystery.xyz", b"random bytes")


# ── CSV parsing ────────────────────────────────────────────────────────


@pytest.fixture
def engine() -> type[DataIngestionEngine]:
    return DataIngestionEngine


async def test_parse_csv_with_header(engine: type[DataIngestionEngine]) -> None:
    csv_bytes = b"name,age,score\nalice,30,91.5\nbob,42,87.0\ncarol,25,95.2\n"
    result = await engine.parse(csv_bytes, "people.csv")
    assert result["format"] == "csv"
    assert result["shape"] == [3, 3]
    assert result["metadata"]["has_header"] is True
    # Numeric columns should be type-inferred.
    col_types = {c["name"]: c["type"] for c in result["columns"]}
    assert col_types["name"] == "string"
    assert col_types["age"] in ("integer", "float")
    # And numeric data should arrive as floats, not strings.
    assert result["data"]["age"] == [30.0, 42.0, 25.0]


async def test_parse_csv_no_header_synthesizes_columns(
    engine: type[DataIngestionEngine],
) -> None:
    # All-numeric first row → parser treats the file as header-less.
    csv_bytes = b"1,2,3\n4,5,6\n7,8,9\n"
    result = await engine.parse(csv_bytes, "matrix.csv")
    assert result["metadata"]["has_header"] is False
    names = [c["name"] for c in result["columns"]]
    assert names == ["col_0", "col_1", "col_2"]
    assert result["shape"] == [3, 3]


async def test_parse_csv_handles_tsv(engine: type[DataIngestionEngine]) -> None:
    tsv_bytes = b"gene\texpression\nBRCA1\t12.3\nTP53\t45.6\n"
    result = await engine.parse(tsv_bytes, "expr.tsv")
    assert result["shape"] == [2, 2]
    assert result["metadata"]["delimiter"] == "\t"


# ── JSON parsing ───────────────────────────────────────────────────────


async def test_parse_json_array_of_objects(engine: type[DataIngestionEngine]) -> None:
    payload = json.dumps([
        {"id": 1, "name": "a"},
        {"id": 2, "name": "b"},
        {"id": 3, "name": "c", "extra": "only-on-row-3"},
    ]).encode()
    result = await engine.parse(payload, "items.json")
    assert result["metadata"]["structure"] == "array_of_objects"
    assert result["data"]["id"] == [1, 2, 3]
    assert result["data"]["name"] == ["a", "b", "c"]
    # Union of keys across rows → sparse column for "extra".
    assert result["data"]["extra"] == [None, None, "only-on-row-3"]
    assert result["shape"] == [3, 3]


async def test_parse_json_array_of_values(engine: type[DataIngestionEngine]) -> None:
    payload = json.dumps([1, 2, 3, 4, 5]).encode()
    result = await engine.parse(payload, "nums.json")
    assert result["metadata"]["structure"] == "array"
    assert result["data"]["values"] == [1, 2, 3, 4, 5]
    assert result["shape"] == [5]


async def test_parse_json_object(engine: type[DataIngestionEngine]) -> None:
    payload = json.dumps({"alpha": 0.05, "method": "welch", "nested": {"k": 1}}).encode()
    result = await engine.parse(payload, "config.json")
    assert result["metadata"]["structure"] == "object"
    assert set(result["metadata"]["keys"]) == {"alpha", "method", "nested"}


# ── FASTA / FASTQ / VCF ────────────────────────────────────────────────


async def test_parse_fasta_captures_sequences(
    engine: type[DataIngestionEngine],
) -> None:
    fa = b">gene1 first\nACGT\nACGT\n>gene2 second\nGGGGCCCC\n"
    result = await engine.parse(fa, "seqs.fasta")
    assert result["metadata"]["n_sequences"] == 2
    assert result["metadata"]["total_length"] == 16
    seqs = result["data"]["sequences"]
    assert seqs[0]["id"] == "gene1"
    assert seqs[0]["sequence"] == "ACGTACGT"
    assert seqs[1]["length"] == 8


async def test_parse_fastq_computes_mean_quality(
    engine: type[DataIngestionEngine],
) -> None:
    # One read: all 'I' in the quality line = Phred 40.
    fq = b"@r1\nACGT\n+\nIIII\n"
    result = await engine.parse(fq, "reads.fq")
    assert result["metadata"]["n_reads"] == 1
    reads = result["data"]["reads"]
    assert reads[0]["id"] == "r1"
    assert reads[0]["sequence"] == "ACGT"
    # ord('I') - 33 = 40 for every base → mean = 40.
    assert reads[0]["mean_quality"] == pytest.approx(40.0)


async def test_parse_vcf_extracts_variants(
    engine: type[DataIngestionEngine],
) -> None:
    vcf = (
        b"##fileformat=VCFv4.2\n"
        b"##source=test\n"
        b"#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n"
        b"1\t100\trs1\tA\tG\t99\tPASS\tAF=0.12;DP=20\n"
        b"2\t200\trs2\tC\tT\t80\tPASS\tAF=0.05\n"
    )
    result = await engine.parse(vcf, "variants.vcf")
    assert result["metadata"]["n_variants"] == 2
    assert result["metadata"]["n_meta_lines"] == 2
    variants = result["data"]["variants"]
    assert variants[0]["ID"] == "rs1"
    # INFO field was parsed into a nested dict.
    assert variants[0]["INFO_parsed"]["AF"] == "0.12"
    assert variants[0]["INFO_parsed"]["DP"] == "20"


# ── NumPy ──────────────────────────────────────────────────────────────


async def test_parse_npy_roundtrip(engine: type[DataIngestionEngine]) -> None:
    arr = np.arange(12, dtype=np.float64).reshape(3, 4)
    buf = io.BytesIO()
    np.save(buf, arr)
    result = await engine.parse(buf.getvalue(), "grid.npy")
    assert result["format"] == "npy"
    assert result["shape"] == [3, 4]
    assert result["metadata"]["dtype"] == "float64"
    assert result["metadata"]["truncated"] is False
    # Data should come back as nested Python lists.
    assert result["data"]["array"] == arr.tolist()


# ── Error paths ────────────────────────────────────────────────────────


async def test_parse_unsupported_format_raises(
    engine: type[DataIngestionEngine],
) -> None:
    # A .gff hint is in the map but no parser is wired up — that's a real
    # user-visible error we want to raise loudly.
    with pytest.raises(ValueError, match="Unsupported format"):
        await engine.parse(b"", "genes.gff", format_hint="gff")


async def test_parse_rejects_oversized_file(
    engine: type[DataIngestionEngine],
) -> None:
    # 500 MB hard cap — simulate it without actually allocating 500MB.
    class _FakeBytes:
        def __init__(self, n: int) -> None:
            self._n = n

        def __len__(self) -> int:
            return self._n

    with pytest.raises(ValueError, match="500MB"):
        await engine.parse(_FakeBytes(600 * 1024 * 1024), "huge.csv")  # type: ignore[arg-type]
