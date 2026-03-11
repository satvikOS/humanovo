#!/usr/bin/env python3
"""
Local CLI for bulk-loading open biomedical datasets into your AWS infra.

Usage:
  # Load priority datasets (ontologies — small, fast, high value)
  python scripts/bulk-load.py

  # Load specific datasets
  python scripts/bulk-load.py --datasets gene_ontology human_phenotype_ontology chebi

  # Load all datasets
  python scripts/bulk-load.py --all

  # Load with custom record limit
  python scripts/bulk-load.py --max-records 10000

  # List available datasets
  python scripts/bulk-load.py --list

  # Dry run (download only, don't load into DynamoDB)
  python scripts/bulk-load.py --download-only --datasets gene_ontology

  # Re-process from already downloaded S3 data
  python scripts/bulk-load.py --skip-download --datasets gene_ontology

Prerequisites:
  - AWS credentials configured (aws configure or env vars)
  - pip install boto3
"""

import argparse
import json
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.etl.datasets import DATASETS, get_datasets_by_priority, estimate_total_size_mb
from app.etl.bulk_loader import BulkLoader


def list_datasets():
    """Print available datasets."""
    print("\nAvailable Datasets:")
    print("=" * 90)
    print(f"{'Key':<30} {'Name':<35} {'Size':<10} {'Priority':<10} {'Format'}")
    print("-" * 90)

    for key, config in get_datasets_by_priority():
        print(
            f"{key:<30} {config.name:<35} {config.size_mb_approx:>5}MB"
            f"    P{config.priority:<6} {config.format.value}"
        )

    total = estimate_total_size_mb()
    print("-" * 90)
    print(f"Total download size (approx): {total}MB ({total/1024:.1f}GB)")
    print()

    # Priority groups
    print("Priority Groups:")
    print("  P1 (load first):  Ontologies — GO, HPO, MeSH, Disease Ontology")
    print("  P2 (high value):  ChEBI, DisGeNET, DrugBank, HGNC, Reactome")
    print("  P3 (medium):      ClinVar variants")
    print("  P4 (large):       STRING protein interactions")
    print()


def main():
    parser = argparse.ArgumentParser(
        description="Bulk-load open biomedical datasets into AWS (DynamoDB + S3)",
    )
    parser.add_argument(
        "--datasets",
        nargs="+",
        help="Specific dataset keys to load",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Load all registered datasets",
    )
    parser.add_argument(
        "--max-records",
        type=int,
        default=50_000,
        help="Max records per dataset (default: 50000)",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List available datasets and exit",
    )
    parser.add_argument(
        "--skip-download",
        action="store_true",
        help="Skip download, use existing S3 data",
    )
    parser.add_argument(
        "--download-only",
        action="store_true",
        help="Download to S3 only, don't load into DynamoDB",
    )
    parser.add_argument(
        "--bucket",
        help="S3 bucket name (auto-discovered if not set)",
    )
    parser.add_argument(
        "--table",
        help="DynamoDB knowledge table name",
    )

    args = parser.parse_args()

    if args.list:
        list_datasets()
        return

    # Determine which datasets
    if args.datasets:
        # Validate
        invalid = [d for d in args.datasets if d not in DATASETS]
        if invalid:
            print(f"Unknown datasets: {', '.join(invalid)}")
            print("Use --list to see available datasets")
            sys.exit(1)
        target_datasets = args.datasets
    elif args.all:
        target_datasets = list(DATASETS.keys())
    else:
        # Default: priority 1-2 datasets
        target_datasets = [
            k for k, v in DATASETS.items() if v.priority <= 2
        ]

    # Show plan
    total_size = sum(DATASETS[d].size_mb_approx for d in target_datasets)
    print(f"\nWill load {len(target_datasets)} datasets (~{total_size}MB download):")
    for d in target_datasets:
        config = DATASETS[d]
        print(f"  - {config.name} ({config.size_mb_approx}MB)")
    print()

    if args.download_only:
        print("Mode: Download to S3 only (no DynamoDB load)")
    else:
        print(f"Mode: Full ETL (max {args.max_records:,} records per dataset)")

    # Confirm
    response = input("\nProceed? [y/N] ")
    if response.lower() != "y":
        print("Aborted.")
        return

    # Run
    loader = BulkLoader(
        bucket_name=args.bucket,
        knowledge_table=args.table,
    )

    if args.download_only:
        for dataset_key in target_datasets:
            config = DATASETS[dataset_key]
            s3_key = f"{config.s3_prefix}raw/{dataset_key}.dat"
            if config.compressed:
                s3_key += ".gz"
            print(f"Downloading {config.name}...")
            try:
                loader._download_to_s3(config.url, s3_key, config)
                print(f"  → s3://{loader.bucket_name}/{s3_key}")
            except Exception as e:
                print(f"  ERROR: {e}")
    else:
        result = loader.load_all(
            datasets=target_datasets,
            max_records_per_dataset=args.max_records,
            skip_download=args.skip_download,
        )

        print("\n" + "=" * 50)
        print("RESULTS")
        print("=" * 50)
        print(f"Datasets processed: {result['datasets_processed']}")
        print(f"Records loaded:     {result['records_loaded']:,}")
        print(f"Records skipped:    {result['records_skipped']}")
        if result["errors"]:
            print(f"\nErrors ({len(result['errors'])}):")
            for err in result["errors"]:
                print(f"  - {err}")
        print()


if __name__ == "__main__":
    main()
