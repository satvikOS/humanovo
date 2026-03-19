"""
Imaging Ingestion Service — Metadata extraction for biomedical imaging files.

Supports DICOM, NIfTI, PNG, JPG, TIFF formats.
For Jamison's neuroimaging data (MRI, EEG).
"""

import hashlib
import os
from datetime import datetime
from typing import Any
from uuid import uuid4, uuid5, NAMESPACE_DNS

from pydantic import BaseModel

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

UPLOAD_DIR = os.environ.get("IMAGING_UPLOAD_DIR", "/tmp/humanovo/imaging")


class ImagingRecord(BaseModel):
    id: str
    project_id: str
    file_path: str
    file_name: str
    file_size_bytes: int | None = None
    format: str  # dicom, nifti, png, jpg, tiff
    modality: str  # MRI, EEG, CT, PET, microscopy, histology
    sub_modality: str | None = None
    body_region: str | None = None
    description: str | None = None
    resolution: dict | None = None
    dimensions: dict | None = None
    acquisition_params: dict | None = None
    patient_id_hash: str | None = None
    study_date: str | None = None
    series_description: str | None = None
    linked_hypothesis_ids: list[str] = []
    created_at: str | None = None
    updated_at: str | None = None


class ImagingService:
    """Handles ingestion and metadata extraction for biomedical imaging files."""

    def __init__(self, db_session=None):
        self._db = db_session
        os.makedirs(UPLOAD_DIR, exist_ok=True)

    def _detect_format(self, filename: str) -> str:
        ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
        format_map = {
            "dcm": "dicom", "dicom": "dicom",
            "nii": "nifti", "gz": "nifti",  # .nii.gz
            "png": "png", "jpg": "jpg", "jpeg": "jpg", "tiff": "tiff", "tif": "tiff",
        }
        return format_map.get(ext, "unknown")

    def _anonymize_patient_id(self, patient_id: str) -> str:
        return str(uuid5(NAMESPACE_DNS, patient_id))

    async def ingest(self, project_id: str, file_content: bytes, filename: str) -> ImagingRecord:
        """Ingest an imaging file: detect format, extract metadata, store."""
        file_format = self._detect_format(filename)
        record_id = str(uuid4())

        # Store file
        project_dir = os.path.join(UPLOAD_DIR, project_id)
        os.makedirs(project_dir, exist_ok=True)
        file_path = os.path.join(project_dir, f"{record_id}_{filename}")
        with open(file_path, "wb") as f:
            f.write(file_content)

        # Extract metadata
        metadata = await self.extract_metadata(file_path, file_format)

        # Anonymize patient ID if present
        patient_hash = None
        if metadata.get("patient_id"):
            patient_hash = self._anonymize_patient_id(metadata["patient_id"])

        record = ImagingRecord(
            id=record_id,
            project_id=project_id,
            file_path=file_path,
            file_name=filename,
            file_size_bytes=len(file_content),
            format=file_format,
            modality=metadata.get("modality", "unknown"),
            sub_modality=metadata.get("sub_modality"),
            body_region=metadata.get("body_region"),
            resolution=metadata.get("resolution"),
            dimensions=metadata.get("dimensions"),
            acquisition_params=metadata.get("acquisition_params"),
            patient_id_hash=patient_hash,
            study_date=metadata.get("study_date"),
            series_description=metadata.get("series_description"),
            created_at=datetime.utcnow().isoformat(),
            updated_at=datetime.utcnow().isoformat(),
        )

        # Store in database
        if self._db:
            await self._store_record(record)

        return record

    async def extract_metadata(self, file_path: str, file_format: str) -> dict:
        """Format-specific metadata extraction."""
        if file_format == "dicom":
            return await self._extract_dicom(file_path)
        elif file_format == "nifti":
            return await self._extract_nifti(file_path)
        else:
            return await self._extract_basic_image(file_path)

    async def _extract_dicom(self, file_path: str) -> dict:
        try:
            import pydicom
            ds = pydicom.dcmread(file_path, stop_before_pixels=True)
            return {
                "modality": str(getattr(ds, "Modality", "unknown")),
                "body_region": str(getattr(ds, "BodyPartExamined", None)),
                "patient_id": str(getattr(ds, "PatientID", None)),
                "study_date": str(getattr(ds, "StudyDate", None)),
                "series_description": str(getattr(ds, "SeriesDescription", None)),
                "sub_modality": str(getattr(ds, "SeriesDescription", None)),
                "resolution": {
                    "x": float(ds.PixelSpacing[0]) if hasattr(ds, "PixelSpacing") else None,
                    "y": float(ds.PixelSpacing[1]) if hasattr(ds, "PixelSpacing") else None,
                    "z": float(ds.SliceThickness) if hasattr(ds, "SliceThickness") else None,
                    "unit": "mm",
                },
                "dimensions": {
                    "width": int(getattr(ds, "Columns", 0)),
                    "height": int(getattr(ds, "Rows", 0)),
                },
                "acquisition_params": {
                    "TR": float(getattr(ds, "RepetitionTime", 0)),
                    "TE": float(getattr(ds, "EchoTime", 0)),
                    "flip_angle": float(getattr(ds, "FlipAngle", 0)),
                },
            }
        except ImportError:
            logger.warning("pydicom not installed. Install with: pip install pydicom")
            return {"modality": "DICOM", "error": "pydicom required"}
        except Exception as e:
            logger.error(f"DICOM extraction failed: {e}")
            return {"modality": "DICOM", "error": str(e)}

    async def _extract_nifti(self, file_path: str) -> dict:
        try:
            import nibabel as nib
            img = nib.load(file_path)
            header = img.header
            shape = img.shape
            voxel_sizes = header.get_zooms()
            is_fmri = len(shape) == 4 and shape[3] > 1
            return {
                "modality": "fMRI" if is_fmri else "MRI",
                "sub_modality": "resting-state fMRI" if is_fmri else None,
                "dimensions": {
                    "width": int(shape[0]) if len(shape) > 0 else None,
                    "height": int(shape[1]) if len(shape) > 1 else None,
                    "depth": int(shape[2]) if len(shape) > 2 else None,
                    "timepoints": int(shape[3]) if len(shape) > 3 else 1,
                },
                "resolution": {
                    "x": float(voxel_sizes[0]) if len(voxel_sizes) > 0 else None,
                    "y": float(voxel_sizes[1]) if len(voxel_sizes) > 1 else None,
                    "z": float(voxel_sizes[2]) if len(voxel_sizes) > 2 else None,
                    "unit": "mm",
                },
            }
        except ImportError:
            logger.warning("nibabel not installed. Install with: pip install nibabel")
            return {"modality": "MRI", "error": "nibabel required"}
        except Exception as e:
            logger.error(f"NIfTI extraction failed: {e}")
            return {"modality": "MRI", "error": str(e)}

    async def _extract_basic_image(self, file_path: str) -> dict:
        try:
            from PIL import Image
            img = Image.open(file_path)
            return {
                "modality": "microscopy",
                "dimensions": {
                    "width": img.width,
                    "height": img.height,
                },
                "resolution": {
                    "dpi": img.info.get("dpi", (72, 72)),
                },
            }
        except ImportError:
            return {"modality": "image", "error": "Pillow required"}
        except Exception as e:
            return {"modality": "image", "error": str(e)}

    async def _store_record(self, record: ImagingRecord):
        """Store imaging record in the database."""
        if not self._db:
            return
        try:
            import json
            await self._db.execute(
                """INSERT INTO imaging_records
                   (id, project_id, file_path, file_name, file_size_bytes, format,
                    modality, sub_modality, body_region, description, resolution,
                    dimensions, acquisition_params, patient_id_hash, study_date,
                    series_description, linked_hypothesis_ids)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)""",
                record.id, record.project_id, record.file_path, record.file_name,
                record.file_size_bytes, record.format, record.modality,
                record.sub_modality, record.body_region, record.description,
                json.dumps(record.resolution), json.dumps(record.dimensions),
                json.dumps(record.acquisition_params), record.patient_id_hash,
                record.study_date, record.series_description,
                json.dumps(record.linked_hypothesis_ids),
            )
        except Exception as e:
            logger.error(f"Failed to store imaging record: {e}")

    async def link_to_hypothesis(self, record_id: str, hypothesis_id: str):
        """Add hypothesis_id to linked_hypothesis_ids."""
        if not self._db:
            return
        await self._db.execute(
            """UPDATE imaging_records
               SET linked_hypothesis_ids = linked_hypothesis_ids || $1::jsonb,
                   updated_at = NOW()
               WHERE id = $2""",
            f'["{hypothesis_id}"]', record_id,
        )

    async def list_by_project(self, project_id: str) -> list[dict]:
        """List all imaging records for a project."""
        if not self._db:
            return []
        rows = await self._db.fetch_all(
            "SELECT * FROM imaging_records WHERE project_id = $1 ORDER BY created_at DESC",
            project_id,
        )
        return [dict(r) for r in rows]
