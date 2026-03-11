"""
Bulk ETL Loader

Downloads open biomedical datasets, parses them, and loads into:
  1. DynamoDB knowledge table  — for RAG grounding & search
  2. DynamoDB evidence table   — shows up in Evidence UI
  3. DynamoDB knowledge-metadata table — populates Knowledge Graph UI

Architecture:
  Download (HTTP) → S3 (raw) → Parse → DynamoDB (3 tables)
  → SQS → Embeddings Generator Lambda
"""

import hashlib
import json
import os
import time
from datetime import datetime
from typing import Any, Iterator
from urllib.request import urlopen, Request
from urllib.error import URLError
from uuid import uuid4

import boto3
from botocore.exceptions import ClientError

from app.etl.datasets import (
    DATASETS,
    DatasetConfig,
    DatasetCategory,
    DatasetFormat,
)
from app.etl.parsers import (
    OBOParser,
    OWLParser,
    TSVParser,
    MeSHParser,
    ParsedRecord,
    decompress_gz,
)

# Try Lambda Powertools, fall back to basic logging
try:
    from aws_lambda_powertools import Logger
    logger = Logger()
except ImportError:
    import logging
    logger = logging.getLogger(__name__)
    logging.basicConfig(level=logging.INFO)


# ============================================================
# Mapping from dataset categories to the labels the frontend
# expects. These MUST match the enums in the API endpoints and
# frontend TypeScript interfaces.
# ============================================================

# Evidence table: source_type values accepted by the Evidence UI
# (from backend/app/api/v1/endpoints/evidence.py)
CATEGORY_TO_EVIDENCE_SOURCE_TYPE: dict[DatasetCategory, str] = {
    DatasetCategory.ONTOLOGY: "pathway_database",
    DatasetCategory.GENE_DISEASE: "omics",
    DatasetCategory.DRUG: "drug_database",
    DatasetCategory.PROTEIN: "omics",
    DatasetCategory.VARIANT: "omics",
    DatasetCategory.PATHWAY: "pathway_database",
    DatasetCategory.INTERACTION: "omics",
}

# Knowledge table: source values accepted by KnowledgeSource enum
# (from backend/app/knowledge/engine.py)
DATASET_TO_KNOWLEDGE_SOURCE: dict[str, str] = {
    "gene_ontology": "gene_ontology",
    "human_phenotype_ontology": "gene_ontology",  # closest match
    "mesh_descriptors": "pubmed",  # MeSH is NLM/PubMed vocabulary
    "disease_ontology": "gene_ontology",
    "chebi": "drugbank",  # chemical entities → drug source
    "disgenet_curated": "uniprot",  # gene-disease → closest match
    "clinvar_summary": "uniprot",
    "drugbank_vocabulary": "drugbank",
    "string_interactions": "uniprot",
    "reactome_pathways": "gene_ontology",
    "reactome_pathway_names": "gene_ontology",
    "hgnc_gene_names": "uniprot",
}

# Knowledge Graph: entity_type values the KG UI renders
# (from backend/app/api/v1/endpoints/knowledge.py)
CATEGORY_TO_ENTITY_TYPE: dict[DatasetCategory, str] = {
    DatasetCategory.ONTOLOGY: "pathway",     # ontology terms → pathway nodes
    DatasetCategory.GENE_DISEASE: "gene",
    DatasetCategory.DRUG: "drug",
    DatasetCategory.PROTEIN: "protein",
    DatasetCategory.VARIANT: "gene",         # variants are gene-level
    DatasetCategory.PATHWAY: "pathway",
    DatasetCategory.INTERACTION: "protein",
}

# More specific entity type overrides per dataset
DATASET_TO_ENTITY_TYPE: dict[str, str] = {
    "gene_ontology": "pathway",
    "human_phenotype_ontology": "phenotype",
    "mesh_descriptors": "disease",           # MeSH descriptors → disease concepts
    "disease_ontology": "disease",
    "chebi": "drug",                         # chemical entities
    "disgenet_curated": "gene",
    "clinvar_summary": "gene",
    "drugbank_vocabulary": "drug",
    "string_interactions": "protein",
    "reactome_pathways": "pathway",
    "reactome_pathway_names": "pathway",
    "hgnc_gene_names": "gene",
}

# Valid relation_type values for the KG UI
# (from backend/app/api/v1/endpoints/knowledge.py)
OBO_RELATION_TO_KG_RELATION: dict[str, str] = {
    "is_a": "part_of",
    "part_of": "part_of",
    "has_part": "part_of",
    "regulates": "regulates",
    "positively_regulates": "activates",
    "negatively_regulates": "inhibits",
    "occurs_in": "expressed_in",
    "has_participant": "interacts_with",
    "participates_in": "part_of",
    "derives_from": "associated_with",
    "produces": "associated_with",
    "interacts_with": "interacts_with",
    "binds_to": "binds_to",
    "treats": "treats",
    "causes": "causes",
    "targets": "targets",
    "associated_with": "associated_with",
    "metabolizes": "metabolizes",
}


class BulkLoader:
    """
    Downloads and loads open biomedical datasets into DynamoDB.

    Writes to THREE tables so data shows up in both the Evidence UI
    and the Knowledge Graph UI:
      1. knowledge table     — RAG search, grounding
      2. evidence table      — Evidence page
      3. knowledge-metadata  — Knowledge Graph entities/relations
    """

    def __init__(
        self,
        bucket_name: str | None = None,
        knowledge_table: str | None = None,
        evidence_table: str | None = None,
        metadata_table: str | None = None,
        embeddings_queue_url: str | None = None,
        region: str = "us-east-1",
    ):
        self.region = region
        self.s3 = boto3.client("s3", region_name=region)
        self.dynamodb = boto3.resource("dynamodb", region_name=region)

        # Auto-discover bucket name
        self.bucket_name = bucket_name or os.environ.get("GENUP_BUCKET", "")
        if not self.bucket_name:
            self.bucket_name = self._find_bucket()

        # Knowledge table (RAG grounding)
        self.knowledge_table = self.dynamodb.Table(
            knowledge_table or os.environ.get("KNOWLEDGE_TABLE", "genup-dev-knowledge")
        )
        # Evidence table (Evidence UI)
        self.evidence_table = self.dynamodb.Table(
            evidence_table or os.environ.get("EVIDENCE_TABLE", "genup-dev-evidence")
        )
        # Knowledge-metadata table (Knowledge Graph UI entities)
        self.metadata_table = self.dynamodb.Table(
            metadata_table or os.environ.get("KNOWLEDGE_METADATA_TABLE", "genup-dev-knowledge-metadata")
        )

        self.embeddings_queue_url = embeddings_queue_url or os.environ.get(
            "EMBEDDINGS_QUEUE_URL", ""
        )
        self.sqs = boto3.client("sqs", region_name=region) if self.embeddings_queue_url else None

        # State tracking
        self.ingestion_state_table = self.dynamodb.Table(
            os.environ.get("INGESTION_STATE_TABLE", "genup-dev-ingestion-state")
        )

        # Stats
        self.stats: dict[str, Any] = {
            "datasets_processed": 0,
            "records_loaded": 0,
            "evidence_created": 0,
            "kg_entities_created": 0,
            "kg_relations_created": 0,
            "records_skipped": 0,
            "errors": [],
        }

    def _find_bucket(self) -> str:
        """Auto-discover the genup S3 bucket."""
        try:
            s3_resource = boto3.resource("s3", region_name=self.region)
            for bucket in s3_resource.buckets.all():
                if bucket.name.startswith("genup-dev"):
                    return bucket.name
        except Exception:
            pass
        return ""

    # ================================================================
    # Main entry points
    # ================================================================

    def load_all(
        self,
        datasets: list[str] | None = None,
        max_records_per_dataset: int = 100_000,
        skip_download: bool = False,
    ) -> dict[str, Any]:
        """Load all (or specified) datasets into knowledge, evidence, and KG tables."""
        target_datasets = datasets or list(DATASETS.keys())

        sorted_datasets = sorted(
            [(k, DATASETS[k]) for k in target_datasets if k in DATASETS],
            key=lambda x: x[1].priority,
        )

        logger.info(f"Starting bulk load: {len(sorted_datasets)} datasets")

        for dataset_key, config in sorted_datasets:
            try:
                self._load_dataset(
                    dataset_key, config,
                    max_records=max_records_per_dataset,
                    skip_download=skip_download,
                )
                self.stats["datasets_processed"] += 1
            except Exception as e:
                error_msg = f"{dataset_key}: {str(e)}"
                logger.error(f"Dataset load failed: {error_msg}")
                self.stats["errors"].append(error_msg)

        logger.info(f"Bulk load complete: {json.dumps(self.stats)}")
        return self.stats

    # ================================================================
    # Dataset loading
    # ================================================================

    def _load_dataset(
        self,
        dataset_key: str,
        config: DatasetConfig,
        max_records: int = 100_000,
        skip_download: bool = False,
    ) -> None:
        """Download, parse, and load a single dataset into all 3 tables."""
        logger.info(f"Loading dataset: {config.name} ({dataset_key})")

        if self._is_recently_loaded(dataset_key):
            logger.info(f"Skipping {dataset_key}: loaded recently")
            return

        # Step 1: Download to S3
        s3_key = f"{config.s3_prefix}raw/{dataset_key}.dat"
        if config.compressed:
            s3_key += ".gz"

        if not skip_download:
            self._download_to_s3(config.url, s3_key, config)

        # Step 2: Read and decompress
        raw_data = self._read_from_s3(s3_key)
        if not raw_data:
            raise ValueError(f"No data for {dataset_key}")

        if config.compressed:
            raw_data = decompress_gz(raw_data)

        # Step 3: Parse
        parser = self._get_parser(dataset_key, config)
        if not config.skip_header and config.format in (DatasetFormat.TSV, DatasetFormat.CSV):
            records = parser.parse_no_header(raw_data)
        else:
            records = parser.parse(raw_data)

        # Step 4: Load into all tables
        loaded = self._load_records(records, max_records, dataset_key, config)

        # Step 5: Update state
        self._update_load_state(dataset_key, loaded)

        logger.info(f"Loaded {loaded} records from {config.name}")

    def _load_records(
        self,
        records: Iterator[ParsedRecord],
        max_records: int,
        dataset_key: str,
        config: DatasetConfig,
    ) -> int:
        """Write parsed records to knowledge, evidence, and KG tables."""
        knowledge_batch: list[dict] = []
        evidence_batch: list[dict] = []
        kg_entity_batch: list[dict] = []
        kg_relation_batch: list[dict] = []
        total_loaded = 0

        evidence_source_type = CATEGORY_TO_EVIDENCE_SOURCE_TYPE.get(
            config.category, "pathway_database"
        )
        knowledge_source = DATASET_TO_KNOWLEDGE_SOURCE.get(
            dataset_key, "gene_ontology"
        )
        entity_type = DATASET_TO_ENTITY_TYPE.get(
            dataset_key,
            CATEGORY_TO_ENTITY_TYPE.get(config.category, "pathway"),
        )

        for record in records:
            if total_loaded >= max_records:
                break

            now = datetime.utcnow().isoformat()
            content_text = record.to_text()
            content_hash = hashlib.sha256(
                f"{record.id}|{content_text[:200]}".encode()
            ).hexdigest()[:16]

            # --- 1. Knowledge table item (RAG grounding) ---
            knowledge_item = {
                "id": record.id,
                "content_hash": content_hash,
                "title": record.name,
                "content": content_text[:4000],  # DynamoDB 400KB limit
                "source": knowledge_source,
                "source_id": record.id,
                "source_url": "",
                "status": "indexed",
                "embedding_status": "pending",
                "record_type": record.record_type,
                "created_at": now,
                "updated_at": now,
            }
            if record.definition:
                knowledge_item["abstract"] = record.definition[:2000]
            if record.synonyms:
                knowledge_item["keywords"] = record.synonyms[:30]
            if record.external_ids:
                knowledge_item["external_ids"] = record.external_ids

            knowledge_batch.append(knowledge_item)

            # --- 2. Evidence table item (Evidence UI) ---
            evidence_item = {
                "id": f"ev:{record.id}",
                "title": record.name,
                "source_type": evidence_source_type,
                "source_id": record.id,
                "source_url": "",
                "abstract": record.definition[:2000] if record.definition else content_text[:500],
                "content": content_text[:4000],
                "authors": [],
                "publication_date": now,
                "entities": record.synonyms[:10] if record.synonyms else [],
                "tags": [
                    config.category.value,
                    dataset_key,
                    entity_type,
                ],
                "status": "verified",
                "relevance_score": 0.8 if config.priority <= 2 else 0.6,
                "quality_score": 0.9,  # curated reference data
                "created_at": now,
                "updated_at": now,
            }
            if record.namespace:
                evidence_item["tags"].append(record.namespace)

            evidence_batch.append(evidence_item)

            # --- 3. Knowledge Graph entity (KG UI) ---
            kg_entity = {
                "entity_id": record.id,
                "entity_type": entity_type,
                "name": record.name,
                "description": record.definition[:1000] if record.definition else "",
                "aliases": record.synonyms[:20] if record.synonyms else [],
                "source_dataset": dataset_key,
                "source_count": 1,
                "created_at": now,
            }
            if record.external_ids:
                kg_entity["external_ids"] = record.external_ids
            if record.namespace:
                kg_entity["namespace"] = record.namespace

            kg_entity_batch.append(kg_entity)

            # --- 4. Knowledge Graph relations (KG UI) ---
            # Parent relations (is_a / part_of)
            for parent_id in record.parents[:10]:
                relation_type = "part_of"  # is_a maps to part_of in our KG
                kg_relation = {
                    "entity_id": f"rel:{record.id}→{parent_id}",
                    "relation_type": relation_type,
                    "source_id": record.id,
                    "source_name": record.name,
                    "source_type": entity_type,
                    "target_id": f"{record.source_dataset}:{parent_id}" if ":" not in parent_id else parent_id,
                    "target_type": entity_type,
                    "confidence": 1.0,  # ontology hierarchy = certain
                    "evidence_count": 1,
                    "source_references": [dataset_key],
                    "created_at": now,
                }
                kg_relation_batch.append(kg_relation)

            # Explicit relations from the parsed record
            for rel in record.relations[:10]:
                rel_type_raw = rel.get("type", "associated_with")
                relation_type = OBO_RELATION_TO_KG_RELATION.get(
                    rel_type_raw, "associated_with"
                )
                target = rel.get("target", "")
                if not target:
                    continue

                kg_relation = {
                    "entity_id": f"rel:{record.id}→{target}",
                    "relation_type": relation_type,
                    "source_id": record.id,
                    "source_name": record.name,
                    "source_type": entity_type,
                    "target_id": f"{record.source_dataset}:{target}" if ":" not in target else target,
                    "target_type": entity_type,
                    "confidence": float(rel.get("confidence", 0.8)),
                    "evidence_count": 1,
                    "source_references": [dataset_key],
                    "created_at": now,
                }
                kg_relation_batch.append(kg_relation)

            # Flush batches at 25 items (DynamoDB max)
            if len(knowledge_batch) >= 25:
                self._write_batch(self.knowledge_table, knowledge_batch)
                self._write_batch(self.evidence_table, evidence_batch)
                self._write_batch(self.metadata_table, kg_entity_batch)
                if kg_relation_batch:
                    self._write_batch(self.metadata_table, kg_relation_batch)
                    self.stats["kg_relations_created"] += len(kg_relation_batch)

                total_loaded += len(knowledge_batch)
                self.stats["records_loaded"] += len(knowledge_batch)
                self.stats["evidence_created"] += len(evidence_batch)
                self.stats["kg_entities_created"] += len(kg_entity_batch)

                knowledge_batch = []
                evidence_batch = []
                kg_entity_batch = []
                kg_relation_batch = []

                # Throttle to stay within DynamoDB free tier
                if total_loaded % 500 == 0:
                    time.sleep(1)
                    logger.info(f"  {dataset_key}: {total_loaded} records loaded...")

        # Flush remaining
        if knowledge_batch:
            self._write_batch(self.knowledge_table, knowledge_batch)
            self._write_batch(self.evidence_table, evidence_batch)
            self._write_batch(self.metadata_table, kg_entity_batch)
            if kg_relation_batch:
                self._write_batch(self.metadata_table, kg_relation_batch)
                self.stats["kg_relations_created"] += len(kg_relation_batch)

            total_loaded += len(knowledge_batch)
            self.stats["records_loaded"] += len(knowledge_batch)
            self.stats["evidence_created"] += len(evidence_batch)
            self.stats["kg_entities_created"] += len(kg_entity_batch)

        # Queue for embedding generation
        if self.sqs and self.embeddings_queue_url:
            self._queue_for_embedding(dataset_key)

        return total_loaded

    # ================================================================
    # DynamoDB operations
    # ================================================================

    def _write_batch(self, table, items: list[dict]) -> None:
        """Write a batch of items to a DynamoDB table with retry."""
        if not items:
            return
        max_retries = 3
        for attempt in range(max_retries):
            try:
                with table.batch_writer() as writer:
                    for item in items:
                        writer.put_item(Item=item)
                return
            except ClientError as e:
                if (
                    e.response["Error"]["Code"] == "ProvisionedThroughputExceededException"
                    and attempt < max_retries - 1
                ):
                    time.sleep(2 ** attempt)
                else:
                    raise

    # ================================================================
    # S3 operations
    # ================================================================

    def _download_to_s3(self, url: str, s3_key: str, config: DatasetConfig) -> None:
        """Download a file from URL directly to S3."""
        logger.info(f"Downloading {url} → s3://{self.bucket_name}/{s3_key}")

        headers = {"User-Agent": "humanovo-etl/1.0 (biomedical research platform)"}
        req = Request(url, headers=headers)

        max_retries = 3
        for attempt in range(max_retries):
            try:
                with urlopen(req, timeout=300) as response:
                    chunk_size = 10 * 1024 * 1024  # 10MB
                    parts = []
                    upload_id = None

                    content_length = response.headers.get("Content-Length")
                    if content_length and int(content_length) > chunk_size:
                        mp = self.s3.create_multipart_upload(
                            Bucket=self.bucket_name,
                            Key=s3_key,
                            ServerSideEncryption="AES256",
                        )
                        upload_id = mp["UploadId"]

                        part_number = 1
                        while True:
                            chunk = response.read(chunk_size)
                            if not chunk:
                                break
                            part = self.s3.upload_part(
                                Bucket=self.bucket_name,
                                Key=s3_key,
                                PartNumber=part_number,
                                UploadId=upload_id,
                                Body=chunk,
                            )
                            parts.append({
                                "PartNumber": part_number,
                                "ETag": part["ETag"],
                            })
                            part_number += 1

                        self.s3.complete_multipart_upload(
                            Bucket=self.bucket_name,
                            Key=s3_key,
                            UploadId=upload_id,
                            MultipartUpload={"Parts": parts},
                        )
                    else:
                        data = response.read()
                        self.s3.put_object(
                            Bucket=self.bucket_name,
                            Key=s3_key,
                            Body=data,
                            ServerSideEncryption="AES256",
                        )

                logger.info(f"Download complete: {s3_key}")
                return

            except (URLError, OSError) as e:
                if attempt < max_retries - 1:
                    wait = 2 ** (attempt + 1)
                    logger.warning(f"Download retry {attempt + 1}: {e}")
                    time.sleep(wait)
                else:
                    if upload_id:
                        try:
                            self.s3.abort_multipart_upload(
                                Bucket=self.bucket_name,
                                Key=s3_key,
                                UploadId=upload_id,
                            )
                        except Exception:
                            pass
                    raise

    def _read_from_s3(self, s3_key: str) -> bytes | None:
        """Read a file from S3."""
        try:
            response = self.s3.get_object(Bucket=self.bucket_name, Key=s3_key)
            return response["Body"].read()
        except ClientError as e:
            if e.response["Error"]["Code"] == "NoSuchKey":
                return None
            raise

    # ================================================================
    # Parser selection
    # ================================================================

    def _get_parser(self, dataset_key: str, config: DatasetConfig):
        """Get the appropriate parser for a dataset."""
        if dataset_key == "mesh_descriptors":
            return MeSHParser()

        if config.format == DatasetFormat.OBO:
            return OBOParser(
                source_dataset=dataset_key,
                record_type=config.category.value,
            )
        elif config.format == DatasetFormat.OWL_XML:
            return OWLParser(
                source_dataset=dataset_key,
                record_type=config.category.value,
            )
        elif config.format in (DatasetFormat.TSV, DatasetFormat.CSV):
            return TSVParser(
                source_dataset=dataset_key,
                record_type=config.category.value,
                id_column=config.id_column,
                name_column=config.name_column,
                description_column=config.description_column,
                relation_columns=config.relation_columns,
                chunk_fields=config.chunk_fields,
                delimiter=config.delimiter,
                skip_header=config.skip_header,
            )
        else:
            raise ValueError(f"No parser for format: {config.format}")

    # ================================================================
    # State management
    # ================================================================

    def _queue_for_embedding(self, dataset_key: str) -> None:
        """Send a message to trigger embedding generation."""
        if not self.sqs or not self.embeddings_queue_url:
            return
        try:
            self.sqs.send_message(
                QueueUrl=self.embeddings_queue_url,
                MessageBody=json.dumps({
                    "action": "embed_dataset",
                    "dataset": dataset_key,
                    "timestamp": datetime.utcnow().isoformat(),
                }),
            )
        except Exception as e:
            logger.warning(f"Failed to queue embedding job: {e}")

    def _is_recently_loaded(self, dataset_key: str) -> bool:
        """Check if dataset was loaded in the last 30 days."""
        try:
            response = self.ingestion_state_table.get_item(
                Key={"source": f"bulk_etl:{dataset_key}"}
            )
            item = response.get("Item")
            if not item:
                return False

            last_run = item.get("last_run", "")
            if not last_run:
                return False

            last_dt = datetime.fromisoformat(last_run)
            return (datetime.utcnow() - last_dt).days < 30
        except Exception:
            return False

    def _update_load_state(self, dataset_key: str, records_loaded: int) -> None:
        """Update ingestion state for this dataset."""
        try:
            self.ingestion_state_table.put_item(
                Item={
                    "source": f"bulk_etl:{dataset_key}",
                    "status": "completed",
                    "last_run": datetime.utcnow().isoformat(),
                    "records_fetched": records_loaded,
                    "error": "",
                }
            )
        except Exception as e:
            logger.warning(f"Failed to update state: {e}")


# ================================================================
# Convenience functions
# ================================================================

def load_priority_datasets(max_records: int = 50_000) -> dict:
    """Load high-priority datasets (ontologies — small, free, high value)."""
    loader = BulkLoader()
    return loader.load_all(
        datasets=[
            "gene_ontology",
            "human_phenotype_ontology",
            "disease_ontology",
            "hgnc_gene_names",
            "reactome_pathway_names",
            "reactome_pathways",
        ],
        max_records_per_dataset=max_records,
    )


def load_all_datasets(max_records: int = 100_000) -> dict:
    """Load all registered datasets."""
    loader = BulkLoader()
    return loader.load_all(max_records_per_dataset=max_records)
