"""
Data Ingestion Engine — Universal file parser for compute engine.

Parses CSV, Excel, JSON, XML, Parquet, HDF5, MAT, NetCDF, NPY/NPZ,
EDF/BDF, WAV, DICOM, NIfTI, TIFF, PNG/JPEG, FASTA, FASTQ, VCF, C3D, TRC
into compute-ready dicts.
"""

from __future__ import annotations

import csv
import io
import json
import math
import struct
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import numpy as np

# ── Extension → format mapping ───────────────────────────────────

_EXT_MAP: dict[str, str] = {
    ".csv": "csv", ".tsv": "csv",
    ".xlsx": "excel", ".xls": "excel",
    ".json": "json",
    ".xml": "xml",
    ".parquet": "parquet",
    ".h5": "hdf5", ".hdf5": "hdf5", ".hdf": "hdf5",
    ".mat": "mat",
    ".nc": "netcdf", ".nc4": "netcdf",
    ".npy": "npy", ".npz": "npz",
    ".edf": "edf", ".bdf": "bdf",
    ".wav": "wav",
    ".dcm": "dicom", ".dicom": "dicom",
    ".nii": "nifti",
    ".tif": "tiff", ".tiff": "tiff",
    ".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".bmp": "bmp",
    ".fa": "fasta", ".fasta": "fasta", ".fna": "fasta",
    ".fq": "fastq", ".fastq": "fastq",
    ".vcf": "vcf",
    ".c3d": "c3d",
    ".trc": "trc",
    ".gff": "gff", ".gff3": "gff",
}


def _safe_float(v: Any) -> float:
    f = float(v)
    return 0.0 if (math.isnan(f) or math.isinf(f)) else f


def _to_serializable(obj: Any) -> Any:
    """Recursively convert numpy types to Python native for JSON."""
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, bytes):
        try:
            return obj.decode("utf-8", errors="replace")
        except Exception:
            return str(obj)
    if isinstance(obj, dict):
        return {str(k): _to_serializable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_serializable(v) for v in obj]
    return obj


def _infer_column_type(values: list) -> str:
    """Infer column type from a sample of values."""
    non_null = [v for v in values if v is not None and v != ""]
    if not non_null:
        return "string"
    # Check bool
    if all(isinstance(v, bool) for v in non_null):
        return "boolean"
    # Check int
    try:
        if all(float(v) == int(float(v)) for v in non_null):
            return "integer"
    except (ValueError, TypeError):
        pass
    # Check float
    try:
        [float(v) for v in non_null]
        return "float"
    except (ValueError, TypeError):
        pass
    return "string"


class DataIngestionEngine:
    """Universal data ingestion — parses any supported file format."""

    SUPPORTED_FORMATS = dict(_EXT_MAP)

    @classmethod
    def detect_format(cls, filename: str, content_bytes: bytes | None = None) -> str:
        ext = Path(filename).suffix.lower()
        # Handle .nii.gz
        if filename.lower().endswith(".nii.gz"):
            return "nifti"
        if ext in _EXT_MAP:
            return _EXT_MAP[ext]
        # Magic byte detection
        if content_bytes and len(content_bytes) >= 4:
            magic = content_bytes[:4]
            if magic[:2] == b"\x89P":
                return "png"
            if magic[:2] == b"\xff\xd8":
                return "jpeg"
            if magic == b"\x89HDF":
                return "hdf5"
            if magic[:2] == b"II" or magic[:2] == b"MM":
                return "tiff"
            if magic == b"RIFF":
                return "wav"
        raise ValueError(f"Cannot detect format for: {filename}")

    @classmethod
    async def parse(cls, file_bytes: bytes, filename: str, format_hint: str | None = None) -> dict:
        if len(file_bytes) > 500 * 1024 * 1024:
            raise ValueError("File exceeds 500MB limit")

        fmt = format_hint or cls.detect_format(filename, file_bytes)

        parsers = {
            "csv": cls._parse_csv, "excel": cls._parse_excel,
            "json": cls._parse_json, "xml": cls._parse_xml,
            "parquet": cls._parse_parquet,
            "hdf5": cls._parse_hdf5, "mat": cls._parse_mat,
            "netcdf": cls._parse_netcdf,
            "npy": cls._parse_npy, "npz": cls._parse_npz,
            "edf": cls._parse_edf, "bdf": cls._parse_edf,
            "wav": cls._parse_wav,
            "dicom": cls._parse_dicom, "nifti": cls._parse_nifti,
            "tiff": cls._parse_image, "png": cls._parse_image,
            "jpeg": cls._parse_image, "bmp": cls._parse_image,
            "fasta": cls._parse_fasta, "fastq": cls._parse_fastq,
            "vcf": cls._parse_vcf,
            "c3d": cls._parse_c3d, "trc": cls._parse_trc,
        }
        parser = parsers.get(fmt)
        if not parser:
            raise ValueError(f"Unsupported format: {fmt}")

        result = parser(file_bytes, filename)
        result["format"] = fmt
        result["filename"] = filename
        result["file_size_bytes"] = len(file_bytes)
        return _to_serializable(result)

    # ── Tabular ──────────────────────────────────────────────────

    @staticmethod
    def _parse_csv(data: bytes, filename: str) -> dict:
        text = data.decode("utf-8", errors="replace")
        # Detect delimiter
        sniffer = csv.Sniffer()
        try:
            dialect = sniffer.sniff(text[:4096])
            delimiter = dialect.delimiter
        except csv.Error:
            delimiter = "," if "," in text[:1000] else "\t"

        reader = csv.reader(io.StringIO(text), delimiter=delimiter)
        rows_raw = list(reader)
        if not rows_raw:
            return {"data": {}, "metadata": {}, "preview": {}, "columns": [], "shape": [0, 0]}

        # Detect header
        has_header = True
        try:
            [float(v) for v in rows_raw[0] if v.strip()]
            has_header = False
        except (ValueError, TypeError):
            pass

        if has_header:
            headers = rows_raw[0]
            data_rows = rows_raw[1:]
        else:
            headers = [f"col_{i}" for i in range(len(rows_raw[0]))]
            data_rows = rows_raw

        # Type inference and conversion
        columns = []
        col_data = {}
        for i, h in enumerate(headers):
            h = h.strip() or f"col_{i}"
            vals = [row[i] if i < len(row) else None for row in data_rows]
            col_type = _infer_column_type(vals[:100])
            columns.append({"name": h, "type": col_type, "nullable": any(v is None or v == "" for v in vals)})

            if col_type in ("integer", "float"):
                converted = []
                for v in vals:
                    try:
                        converted.append(float(v) if v not in (None, "") else None)
                    except (ValueError, TypeError):
                        converted.append(None)
                col_data[h] = converted
            else:
                col_data[h] = [v if v not in (None, "") else None for v in vals]

        # Preview (first 10 rows)
        preview_rows = []
        for row in data_rows[:10]:
            preview_rows.append({headers[i].strip(): row[i] if i < len(row) else "" for i in range(len(headers))})

        return {
            "data": col_data,
            "metadata": {"delimiter": delimiter, "has_header": has_header, "encoding": "utf-8"},
            "preview": {"rows": preview_rows, "total_rows": len(data_rows)},
            "columns": columns,
            "shape": [len(data_rows), len(headers)],
        }

    @staticmethod
    def _parse_excel(data: bytes, filename: str) -> dict:
        try:
            import openpyxl
        except ImportError:
            raise ValueError("Excel support requires openpyxl: pip install openpyxl")

        wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
        sheets = {}
        all_columns = []

        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            rows = []
            for row in ws.iter_rows(values_only=True):
                rows.append(list(row))
            if not rows:
                continue

            headers = [str(v) if v is not None else f"col_{i}" for i, v in enumerate(rows[0])]
            data_rows = rows[1:]
            col_data = {}
            for i, h in enumerate(headers):
                vals = [row[i] if i < len(row) else None for row in data_rows]
                col_data[h] = vals
                if sheet_name == wb.sheetnames[0]:
                    all_columns.append({"name": h, "type": _infer_column_type(vals[:100]), "nullable": True})

            sheets[sheet_name] = {"data": col_data, "shape": [len(data_rows), len(headers)]}

        wb.close()
        primary = sheets.get(wb.sheetnames[0], {}) if wb.sheetnames else {}
        return {
            "data": primary.get("data", {}),
            "metadata": {"sheets": list(sheets.keys()), "n_sheets": len(sheets)},
            "preview": {"sheets": {k: {"rows": len(v.get("data", {}).get(list(v["data"].keys())[0], [])) if v.get("data") else 0} for k, v in sheets.items()}},
            "columns": all_columns,
            "shape": primary.get("shape", [0, 0]),
            "all_sheets": sheets,
        }

    @staticmethod
    def _parse_json(data: bytes, filename: str) -> dict:
        text = data.decode("utf-8", errors="replace")
        parsed = json.loads(text)

        if isinstance(parsed, list):
            if parsed and isinstance(parsed[0], dict):
                # Array of objects → tabular
                all_keys = list(dict.fromkeys(k for row in parsed for k in row.keys()))
                col_data = {k: [row.get(k) for row in parsed] for k in all_keys}
                columns = [{"name": k, "type": _infer_column_type([row.get(k) for row in parsed[:100]]), "nullable": True} for k in all_keys]
                return {
                    "data": col_data,
                    "metadata": {"structure": "array_of_objects"},
                    "preview": {"rows": parsed[:10], "total_rows": len(parsed)},
                    "columns": columns,
                    "shape": [len(parsed), len(all_keys)],
                }
            else:
                # Array of values
                return {
                    "data": {"values": parsed},
                    "metadata": {"structure": "array"},
                    "preview": {"values": parsed[:20]},
                    "columns": [{"name": "values", "type": _infer_column_type(parsed[:100]), "nullable": False}],
                    "shape": [len(parsed)],
                }
        elif isinstance(parsed, dict):
            return {
                "data": parsed,
                "metadata": {"structure": "object", "keys": list(parsed.keys())},
                "preview": {k: str(v)[:200] for k, v in list(parsed.items())[:10]},
                "columns": [{"name": k, "type": type(v).__name__} for k, v in parsed.items()],
                "shape": [len(parsed)],
            }
        return {"data": {"value": parsed}, "metadata": {}, "preview": {}, "columns": [], "shape": []}

    @staticmethod
    def _parse_xml(data: bytes, filename: str) -> dict:
        root = ET.fromstring(data)
        # Find repeated child elements (tabular data)
        child_tags = [c.tag for c in root]
        from collections import Counter
        tag_counts = Counter(child_tags)
        if tag_counts:
            most_common_tag = tag_counts.most_common(1)[0][0]
            elements = root.findall(most_common_tag)
            if elements:
                all_keys = list(dict.fromkeys(k for el in elements for k in (list(el.attrib.keys()) + [c.tag for c in el])))
                rows = []
                for el in elements:
                    row = dict(el.attrib)
                    for c in el:
                        row[c.tag] = c.text
                    rows.append(row)
                col_data = {k: [r.get(k) for r in rows] for k in all_keys}
                columns = [{"name": k, "type": _infer_column_type([r.get(k) for r in rows[:100]]), "nullable": True} for k in all_keys]
                return {
                    "data": col_data,
                    "metadata": {"root_tag": root.tag, "row_tag": most_common_tag, "n_elements": len(elements)},
                    "preview": {"rows": rows[:10]},
                    "columns": columns,
                    "shape": [len(rows), len(all_keys)],
                }
        # Fallback: return tree as dict
        def _el_to_dict(el):
            d = dict(el.attrib)
            for c in el:
                d[c.tag] = _el_to_dict(c) if len(c) else c.text
            if el.text and el.text.strip():
                d["_text"] = el.text.strip()
            return d
        return {
            "data": _el_to_dict(root),
            "metadata": {"root_tag": root.tag},
            "preview": {},
            "columns": [],
            "shape": [],
        }

    @staticmethod
    def _parse_parquet(data: bytes, filename: str) -> dict:
        try:
            import pyarrow.parquet as pq
            table = pq.read_table(io.BytesIO(data))
            col_data = {col: table.column(col).to_pylist() for col in table.column_names}
            columns = [{"name": col, "type": str(table.schema.field(col).type), "nullable": table.schema.field(col).nullable} for col in table.column_names]
            return {
                "data": col_data,
                "metadata": {"n_row_groups": table.num_rows},
                "preview": {"rows": [{col: col_data[col][i] for col in table.column_names} for i in range(min(10, len(col_data[table.column_names[0]])))]},
                "columns": columns,
                "shape": [table.num_rows, len(table.column_names)],
            }
        except ImportError:
            raise ValueError("Parquet support requires pyarrow: pip install pyarrow")

    # ── Scientific Containers ────────────────────────────────────

    @staticmethod
    def _parse_hdf5(data: bytes, filename: str) -> dict:
        try:
            import h5py
        except ImportError:
            raise ValueError("HDF5 support requires h5py: pip install h5py")

        datasets = {}
        def _visit(name, obj):
            if isinstance(obj, h5py.Dataset):
                arr = obj[()]
                attrs = dict(obj.attrs)
                datasets[name] = {
                    "data": arr.tolist() if arr.size < 100000 else arr[:100].tolist(),
                    "shape": list(arr.shape),
                    "dtype": str(arr.dtype),
                    "attrs": {k: _to_serializable(v) for k, v in attrs.items()},
                    "truncated": arr.size >= 100000,
                }

        f = h5py.File(io.BytesIO(data), "r")
        f.visititems(_visit)
        root_attrs = {k: _to_serializable(v) for k, v in f.attrs.items()}
        groups = [name for name in f if isinstance(f[name], h5py.Group)]
        f.close()

        return {
            "data": datasets,
            "metadata": {"n_datasets": len(datasets), "groups": groups, "root_attrs": root_attrs},
            "preview": {k: {"shape": v["shape"], "dtype": v["dtype"]} for k, v in list(datasets.items())[:10]},
            "columns": [{"name": k, "type": v["dtype"], "shape": v["shape"]} for k, v in datasets.items()],
            "shape": [len(datasets)],
        }

    @staticmethod
    def _parse_mat(data: bytes, filename: str) -> dict:
        from scipy import io as sio
        try:
            mat = sio.loadmat(io.BytesIO(data), squeeze_me=True)
        except NotImplementedError:
            # v7.3 MAT files are HDF5
            try:
                import h5py
                f = h5py.File(io.BytesIO(data), "r")
                datasets = {}
                def _visit(name, obj):
                    import h5py as h5
                    if isinstance(obj, h5.Dataset):
                        arr = obj[()]
                        datasets[name] = {"data": arr.tolist() if arr.size < 100000 else arr[:100].tolist(),
                                           "shape": list(arr.shape), "dtype": str(arr.dtype)}
                f.visititems(_visit)
                f.close()
                return {"data": datasets, "metadata": {"mat_version": "7.3 (HDF5)"},
                        "preview": {k: {"shape": v["shape"]} for k, v in list(datasets.items())[:10]},
                        "columns": [{"name": k, "type": v["dtype"]} for k, v in datasets.items()],
                        "shape": [len(datasets)]}
            except ImportError:
                raise ValueError("v7.3 MAT files require h5py: pip install h5py")

        # Filter out MATLAB internal keys
        variables = {}
        for k, v in mat.items():
            if k.startswith("__"):
                continue
            if isinstance(v, np.ndarray):
                variables[k] = {"data": v.tolist() if v.size < 100000 else v.flat[:100].tolist(),
                                "shape": list(v.shape), "dtype": str(v.dtype),
                                "truncated": v.size >= 100000}
            else:
                variables[k] = {"data": v, "shape": [], "dtype": type(v).__name__}

        return {
            "data": variables,
            "metadata": {"mat_version": "5", "n_variables": len(variables)},
            "preview": {k: {"shape": v["shape"], "dtype": v["dtype"]} for k, v in list(variables.items())[:10]},
            "columns": [{"name": k, "type": v["dtype"]} for k, v in variables.items()],
            "shape": [len(variables)],
        }

    @staticmethod
    def _parse_netcdf(data: bytes, filename: str) -> dict:
        try:
            from scipy.io import netcdf_file
            f = netcdf_file(io.BytesIO(data), "r", mmap=False)
            variables = {}
            for name, var in f.variables.items():
                arr = var.data.copy()
                variables[name] = {
                    "data": arr.tolist() if arr.size < 100000 else arr.flat[:100].tolist(),
                    "shape": list(arr.shape),
                    "dtype": str(arr.dtype),
                    "dimensions": list(var.dimensions),
                }
            dims = {name: int(dim) for name, dim in f.dimensions.items()}
            f.close()
            return {
                "data": variables,
                "metadata": {"dimensions": dims, "n_variables": len(variables)},
                "preview": {k: {"shape": v["shape"], "dims": v["dimensions"]} for k, v in list(variables.items())[:10]},
                "columns": [{"name": k, "type": v["dtype"], "dimensions": v["dimensions"]} for k, v in variables.items()],
                "shape": [len(variables)],
            }
        except ImportError:
            raise ValueError("NetCDF support requires scipy")

    @staticmethod
    def _parse_npy(data: bytes, filename: str) -> dict:
        arr = np.load(io.BytesIO(data), allow_pickle=False)
        return {
            "data": {"array": arr.tolist() if arr.size < 100000 else arr.flat[:1000].tolist()},
            "metadata": {"dtype": str(arr.dtype), "truncated": arr.size >= 100000},
            "preview": {"shape": list(arr.shape), "first_values": arr.flat[:20].tolist()},
            "columns": [],
            "shape": list(arr.shape),
        }

    @staticmethod
    def _parse_npz(data: bytes, filename: str) -> dict:
        npz = np.load(io.BytesIO(data), allow_pickle=False)
        arrays = {}
        for name in npz.files:
            arr = npz[name]
            arrays[name] = {
                "data": arr.tolist() if arr.size < 100000 else arr.flat[:1000].tolist(),
                "shape": list(arr.shape), "dtype": str(arr.dtype),
            }
        return {
            "data": arrays,
            "metadata": {"n_arrays": len(arrays)},
            "preview": {k: {"shape": v["shape"], "dtype": v["dtype"]} for k, v in arrays.items()},
            "columns": [{"name": k, "type": v["dtype"]} for k, v in arrays.items()],
            "shape": [len(arrays)],
        }

    # ── Biomedical Signals ───────────────────────────────────────

    @staticmethod
    def _parse_edf(data: bytes, filename: str) -> dict:
        """Parse EDF/BDF format (European Data Format for biosignals)."""
        if len(data) < 256:
            raise ValueError("File too small for EDF format")

        # Main header (256 bytes)
        version = data[0:8].decode("ascii", errors="replace").strip()
        patient = data[8:88].decode("ascii", errors="replace").strip()
        recording = data[88:168].decode("ascii", errors="replace").strip()
        start_date = data[168:176].decode("ascii", errors="replace").strip()
        start_time = data[176:184].decode("ascii", errors="replace").strip()
        header_bytes = int(data[184:192].decode("ascii", errors="replace").strip())
        n_records = int(data[236:244].decode("ascii", errors="replace").strip())
        duration = float(data[244:252].decode("ascii", errors="replace").strip())
        n_signals = int(data[252:256].decode("ascii", errors="replace").strip())

        if n_signals <= 0 or n_signals > 512:
            raise ValueError(f"Invalid number of signals: {n_signals}")

        # Per-signal headers (256 bytes each in blocks of n_signals)
        offset = 256
        labels = [data[offset + i * 16:offset + (i + 1) * 16].decode("ascii", errors="replace").strip() for i in range(n_signals)]
        offset += n_signals * 16
        transducers = [data[offset + i * 80:offset + (i + 1) * 80].decode("ascii", errors="replace").strip() for i in range(n_signals)]
        offset += n_signals * 80
        phys_dims = [data[offset + i * 8:offset + (i + 1) * 8].decode("ascii", errors="replace").strip() for i in range(n_signals)]
        offset += n_signals * 8
        phys_mins = [float(data[offset + i * 8:offset + (i + 1) * 8].decode("ascii", errors="replace").strip()) for i in range(n_signals)]
        offset += n_signals * 8
        phys_maxs = [float(data[offset + i * 8:offset + (i + 1) * 8].decode("ascii", errors="replace").strip()) for i in range(n_signals)]
        offset += n_signals * 8
        dig_mins = [int(data[offset + i * 8:offset + (i + 1) * 8].decode("ascii", errors="replace").strip()) for i in range(n_signals)]
        offset += n_signals * 8
        dig_maxs = [int(data[offset + i * 8:offset + (i + 1) * 8].decode("ascii", errors="replace").strip()) for i in range(n_signals)]
        offset += n_signals * 8
        # Skip prefiltering
        offset += n_signals * 80
        n_samples_per_record = [int(data[offset + i * 8:offset + (i + 1) * 8].decode("ascii", errors="replace").strip()) for i in range(n_signals)]

        # Parse data records
        is_bdf = filename.lower().endswith(".bdf") or version.startswith("\xff")
        data_offset = header_bytes
        channels = []

        for ch in range(n_signals):
            fs = n_samples_per_record[ch] / duration if duration > 0 else 256
            total_samples = n_samples_per_record[ch] * n_records

            # Read samples (limit to prevent memory issues)
            max_samples = min(total_samples, 500000)
            samples = np.zeros(max_samples, dtype=np.float64)

            bytes_per_sample = 3 if is_bdf else 2
            record_size = sum(ns * bytes_per_sample for ns in n_samples_per_record)

            samples_read = 0
            for rec in range(min(n_records, max_samples // max(n_samples_per_record[ch], 1))):
                rec_offset = data_offset + rec * record_size
                # Skip to this channel in the record
                ch_offset = rec_offset + sum(n_samples_per_record[c] * bytes_per_sample for c in range(ch))
                ns = n_samples_per_record[ch]

                for s in range(ns):
                    if samples_read >= max_samples:
                        break
                    pos = ch_offset + s * bytes_per_sample
                    if pos + bytes_per_sample > len(data):
                        break
                    if is_bdf:
                        raw = int.from_bytes(data[pos:pos + 3], "little", signed=True)
                    else:
                        raw = struct.unpack_from("<h", data, pos)[0]

                    # Digital to physical conversion
                    dig_range = dig_maxs[ch] - dig_mins[ch]
                    phys_range = phys_maxs[ch] - phys_mins[ch]
                    if dig_range != 0:
                        physical = (raw - dig_mins[ch]) / dig_range * phys_range + phys_mins[ch]
                    else:
                        physical = float(raw)
                    samples[samples_read] = physical
                    samples_read += 1

            samples = samples[:samples_read]
            channels.append({
                "label": labels[ch],
                "unit": phys_dims[ch],
                "sampling_rate": fs,
                "n_samples": samples_read,
                "data": samples[:5000].tolist(),  # Preview first 5000 samples
                "transducer": transducers[ch],
            })

        return {
            "data": {"channels": {ch["label"]: ch["data"] for ch in channels}},
            "metadata": {
                "patient": patient, "recording": recording,
                "start_date": start_date, "start_time": start_time,
                "duration_s": duration * n_records,
                "n_signals": n_signals, "n_records": n_records,
                "format": "BDF" if is_bdf else "EDF",
            },
            "preview": {"channels": [{"label": ch["label"], "unit": ch["unit"],
                                       "sampling_rate": ch["sampling_rate"],
                                       "n_samples": ch["n_samples"]} for ch in channels]},
            "columns": [{"name": ch["label"], "type": "float", "unit": ch["unit"],
                          "sampling_rate": ch["sampling_rate"]} for ch in channels],
            "shape": [n_signals, max(c["n_samples"] for c in channels) if channels else 0],
        }

    @staticmethod
    def _parse_wav(data: bytes, filename: str) -> dict:
        from scipy.io import wavfile
        sr, audio = wavfile.read(io.BytesIO(data))
        if audio.ndim == 1:
            n_channels = 1
            audio_list = audio[:50000].tolist()
        else:
            n_channels = audio.shape[1]
            audio_list = audio[:50000].tolist()

        return {
            "data": {"audio": audio_list, "sample_rate": int(sr)},
            "metadata": {"sample_rate": int(sr), "n_channels": n_channels,
                          "n_samples": len(audio), "duration_s": len(audio) / sr,
                          "dtype": str(audio.dtype), "bit_depth": audio.dtype.itemsize * 8},
            "preview": {"sample_rate": int(sr), "n_channels": n_channels,
                         "duration_s": round(len(audio) / sr, 2)},
            "columns": [{"name": f"channel_{i}", "type": "float"} for i in range(n_channels)],
            "shape": list(audio.shape),
        }

    # ── Medical Imaging ──────────────────────────────────────────

    @staticmethod
    def _parse_dicom(data: bytes, filename: str) -> dict:
        try:
            import pydicom
        except ImportError:
            raise ValueError("DICOM support requires pydicom: pip install pydicom")

        ds = pydicom.dcmread(io.BytesIO(data))
        metadata = {}
        for attr in ["PatientName", "PatientID", "Modality", "StudyDate", "StudyDescription",
                      "SeriesDescription", "Manufacturer", "InstitutionName",
                      "Rows", "Columns", "BitsAllocated", "PixelSpacing",
                      "SliceThickness", "WindowCenter", "WindowWidth"]:
            if hasattr(ds, attr):
                val = getattr(ds, attr)
                metadata[attr] = str(val)

        pixel_data = None
        shape = []
        if hasattr(ds, "pixel_array"):
            arr = ds.pixel_array
            shape = list(arr.shape)
            # Limit preview size
            if arr.size < 500000:
                pixel_data = arr.tolist()
            else:
                pixel_data = arr[:100, :100].tolist() if arr.ndim >= 2 else arr[:1000].tolist()

        return {
            "data": {"pixel_array": pixel_data} if pixel_data else {},
            "metadata": metadata,
            "preview": {"shape": shape, "modality": metadata.get("Modality", "Unknown")},
            "columns": [],
            "shape": shape,
        }

    @staticmethod
    def _parse_nifti(data: bytes, filename: str) -> dict:
        try:
            import nibabel as nib
        except ImportError:
            raise ValueError("NIfTI support requires nibabel: pip install nibabel")

        if filename.lower().endswith(".nii.gz"):
            import gzip
            data = gzip.decompress(data)

        img = nib.Nifti1Image.from_bytes(data)
        header = img.header
        arr = np.asanyarray(img.dataobj)
        shape = list(arr.shape)
        affine = img.affine.tolist()
        voxel_sizes = header.get_zooms()

        # Small preview
        if arr.ndim >= 3:
            mid = arr.shape[2] // 2
            preview_slice = arr[:, :, mid].tolist() if arr.size > 0 else []
        else:
            preview_slice = arr[:100].tolist() if arr.ndim == 1 else arr[:50, :50].tolist()

        return {
            "data": {"volume": preview_slice},
            "metadata": {
                "shape": shape, "dtype": str(arr.dtype),
                "affine": affine, "voxel_sizes": [float(v) for v in voxel_sizes],
                "description": str(header["descrip"]).strip(),
            },
            "preview": {"shape": shape, "dtype": str(arr.dtype), "voxel_sizes": [float(v) for v in voxel_sizes]},
            "columns": [],
            "shape": shape,
        }

    @staticmethod
    def _parse_image(data: bytes, filename: str) -> dict:
        try:
            from PIL import Image
        except ImportError:
            raise ValueError("Image support requires Pillow: pip install Pillow")

        img = Image.open(io.BytesIO(data))
        arr = np.array(img)
        shape = list(arr.shape)

        metadata = {
            "mode": img.mode, "size": list(img.size),
            "format": img.format or Path(filename).suffix.lstrip(".").upper(),
        }
        if hasattr(img, "info"):
            for k, v in img.info.items():
                if isinstance(v, (str, int, float)):
                    metadata[k] = v

        # Preview: downsample if large
        if arr.size < 500000:
            preview_data = arr.tolist()
        else:
            step = max(arr.shape[0] // 100, 1)
            preview_data = arr[::step, ::step].tolist() if arr.ndim >= 2 else arr[:1000].tolist()

        return {
            "data": {"pixel_array": preview_data},
            "metadata": metadata,
            "preview": {"shape": shape, "mode": img.mode},
            "columns": [],
            "shape": shape,
        }

    # ── Genomics ─────────────────────────────────────────────────

    @staticmethod
    def _parse_fasta(data: bytes, filename: str) -> dict:
        text = data.decode("utf-8", errors="replace")
        sequences = []
        current_id = ""
        current_desc = ""
        current_seq = []

        for line in text.splitlines():
            line = line.strip()
            if line.startswith(">"):
                if current_id:
                    sequences.append({"id": current_id, "description": current_desc, "sequence": "".join(current_seq), "length": len("".join(current_seq))})
                parts = line[1:].split(None, 1)
                current_id = parts[0] if parts else ""
                current_desc = parts[1] if len(parts) > 1 else ""
                current_seq = []
            elif line:
                current_seq.append(line)

        if current_id:
            sequences.append({"id": current_id, "description": current_desc, "sequence": "".join(current_seq), "length": len("".join(current_seq))})

        total_length = sum(s["length"] for s in sequences)

        return {
            "data": {"sequences": sequences[:1000]},  # Limit
            "metadata": {"n_sequences": len(sequences), "total_length": total_length,
                          "mean_length": total_length / len(sequences) if sequences else 0},
            "preview": {"sequences": [{"id": s["id"], "length": s["length"], "first_50": s["sequence"][:50]} for s in sequences[:10]]},
            "columns": [{"name": "id", "type": "string"}, {"name": "sequence", "type": "string"}, {"name": "length", "type": "integer"}],
            "shape": [len(sequences)],
        }

    @staticmethod
    def _parse_fastq(data: bytes, filename: str) -> dict:
        text = data.decode("utf-8", errors="replace")
        lines = text.splitlines()
        records = []
        i = 0
        while i + 3 < len(lines) and len(records) < 10000:
            header = lines[i].strip()
            seq = lines[i + 1].strip()
            # Skip +
            qual = lines[i + 3].strip()
            if header.startswith("@"):
                qual_scores = [ord(c) - 33 for c in qual]
                records.append({"id": header[1:].split()[0], "sequence": seq, "length": len(seq),
                                "mean_quality": sum(qual_scores) / len(qual_scores) if qual_scores else 0})
            i += 4

        return {
            "data": {"reads": records[:1000]},
            "metadata": {"n_reads": len(records), "mean_length": sum(r["length"] for r in records) / len(records) if records else 0},
            "preview": {"reads": [{"id": r["id"], "length": r["length"], "mean_quality": round(r["mean_quality"], 1)} for r in records[:10]]},
            "columns": [{"name": "id", "type": "string"}, {"name": "sequence", "type": "string"},
                          {"name": "length", "type": "integer"}, {"name": "mean_quality", "type": "float"}],
            "shape": [len(records)],
        }

    @staticmethod
    def _parse_vcf(data: bytes, filename: str) -> dict:
        text = data.decode("utf-8", errors="replace")
        meta_lines = []
        header_cols = []
        variants = []

        for line in text.splitlines():
            if line.startswith("##"):
                meta_lines.append(line)
            elif line.startswith("#CHROM"):
                header_cols = line[1:].split("\t")
            elif line.strip() and header_cols:
                fields = line.split("\t")
                variant = {}
                for i, col in enumerate(header_cols):
                    variant[col] = fields[i] if i < len(fields) else ""
                # Parse INFO field
                if "INFO" in variant:
                    info_dict = {}
                    for item in variant["INFO"].split(";"):
                        if "=" in item:
                            k, v = item.split("=", 1)
                            info_dict[k] = v
                        else:
                            info_dict[item] = True
                    variant["INFO_parsed"] = info_dict
                variants.append(variant)
                if len(variants) >= 10000:
                    break

        return {
            "data": {"variants": variants[:5000]},
            "metadata": {"n_variants": len(variants), "n_meta_lines": len(meta_lines),
                          "samples": header_cols[9:] if len(header_cols) > 9 else []},
            "preview": {"variants": [{k: v for k, v in var.items() if k != "INFO_parsed"} for var in variants[:10]]},
            "columns": [{"name": col, "type": "string"} for col in header_cols],
            "shape": [len(variants), len(header_cols)],
        }

    # ── Biomechanics ─────────────────────────────────────────────

    @staticmethod
    def _parse_c3d(data: bytes, filename: str) -> dict:
        """Parse C3D binary motion capture format."""
        if len(data) < 512:
            raise ValueError("File too small for C3D")

        param_block = data[0]
        magic = data[1]
        if magic != 0x50:
            raise ValueError(f"Invalid C3D magic byte: 0x{magic:02X}")

        # Simplified C3D parsing
        # Read data header info
        n_points = struct.unpack_from("<H", data, 2)[0]
        n_analog_per_frame = struct.unpack_from("<H", data, 4)[0]
        first_frame = struct.unpack_from("<H", data, 6)[0]
        last_frame = struct.unpack_from("<H", data, 8)[0]
        n_frames = last_frame - first_frame + 1
        scale = struct.unpack_from("<f", data, 12)[0]
        data_start = (struct.unpack_from("<H", data, 16)[0] - 1) * 512

        return {
            "data": {"n_markers": n_points, "n_frames": n_frames,
                     "n_analog_channels": n_analog_per_frame},
            "metadata": {"n_markers": n_points, "n_frames": n_frames,
                          "first_frame": first_frame, "last_frame": last_frame,
                          "scale_factor": float(scale), "data_start_byte": data_start},
            "preview": {"n_markers": n_points, "n_frames": n_frames,
                         "format": "integer" if scale > 0 else "float"},
            "columns": [],
            "shape": [n_frames, n_points, 3],
        }

    @staticmethod
    def _parse_trc(data: bytes, filename: str) -> dict:
        """Parse TRC (Track Row Column) motion capture format."""
        text = data.decode("utf-8", errors="replace")
        lines = text.splitlines()

        if len(lines) < 5:
            raise ValueError("TRC file too short")

        # Header lines
        # Line 1: PathFileType
        # Line 2: DataRate, CameraRate, NumFrames, NumMarkers, ...
        # Line 3: marker names (tab-separated)
        # Line 4: axis labels (X1, Y1, Z1, X2, ...)
        # Line 5+: data

        header_info = lines[1].split("\t") if len(lines) > 1 else []
        marker_line = lines[2].split("\t") if len(lines) > 2 else []
        # Remove empty entries and Frame#/Time columns
        marker_names = [m.strip() for m in marker_line[2:] if m.strip()]
        # Remove duplicates (each marker has 3 columns)
        unique_markers = list(dict.fromkeys(marker_names))

        # Parse data rows
        data_rows = []
        for line in lines[4:]:
            parts = line.split("\t")
            if len(parts) > 2:
                try:
                    values = [float(v) if v.strip() else float("nan") for v in parts]
                    data_rows.append(values)
                except ValueError:
                    continue

        frame_rate = float(header_info[0]) if header_info else 0
        n_frames = len(data_rows)

        # Extract marker trajectories
        markers = {}
        for i, name in enumerate(unique_markers):
            col_start = 2 + i * 3
            if col_start + 2 < len(data_rows[0]) if data_rows else 0:
                xyz = [[row[col_start + j] if col_start + j < len(row) else float("nan") for j in range(3)] for row in data_rows[:5000]]
                markers[name] = xyz

        return {
            "data": {"markers": markers},
            "metadata": {"frame_rate": frame_rate, "n_frames": n_frames,
                          "n_markers": len(unique_markers), "marker_names": unique_markers},
            "preview": {"markers": unique_markers[:20], "n_frames": n_frames, "frame_rate": frame_rate},
            "columns": [{"name": m, "type": "float[3]"} for m in unique_markers],
            "shape": [n_frames, len(unique_markers), 3],
        }
