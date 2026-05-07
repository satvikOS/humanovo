"""
Open Biomedical Dataset Registry

Defines all downloadable open-source datasets with their URLs, formats,
and parsing configurations. All datasets are freely available.
"""

from dataclasses import dataclass, field
from enum import StrEnum


class DatasetFormat(StrEnum):
    OWL_XML = "owl_xml"
    OBO = "obo"
    TSV = "tsv"
    CSV = "csv"
    XML = "xml"
    JSON = "json"


class DatasetCategory(StrEnum):
    ONTOLOGY = "ontology"
    GENE_DISEASE = "gene_disease"
    DRUG = "drug"
    PROTEIN = "protein"
    VARIANT = "variant"
    PATHWAY = "pathway"
    INTERACTION = "interaction"


@dataclass
class DatasetConfig:
    """Configuration for a downloadable dataset."""

    name: str
    description: str
    category: DatasetCategory
    url: str
    format: DatasetFormat
    compressed: bool = False  # .gz
    size_mb_approx: int = 0
    license: str = ""
    # Parsing config
    id_column: str = ""
    name_column: str = ""
    description_column: str = ""
    relation_columns: list[str] = field(default_factory=list)
    skip_header: bool = True
    delimiter: str = "\t"
    # S3 storage
    s3_prefix: str = ""
    # Chunking for embedding
    chunk_fields: list[str] = field(default_factory=list)
    # Priority for loading order (1=highest)
    priority: int = 5


# All freely available datasets
DATASETS: dict[str, DatasetConfig] = {
    # === ONTOLOGIES (small, extremely high value) ===
    "gene_ontology": DatasetConfig(
        name="Gene Ontology",
        description="Complete gene function ontology with 45K+ terms and relationships",
        category=DatasetCategory.ONTOLOGY,
        url="http://purl.obolibrary.org/obo/go.obo",
        format=DatasetFormat.OBO,
        size_mb_approx=35,
        license="CC BY 4.0",
        s3_prefix="data/grounding/ontologies/gene_ontology/",
        chunk_fields=["name", "definition", "synonyms"],
        priority=1,
    ),
    "human_phenotype_ontology": DatasetConfig(
        name="Human Phenotype Ontology",
        description="Standardized vocabulary of phenotypic abnormalities (18K+ terms)",
        category=DatasetCategory.ONTOLOGY,
        url="http://purl.obolibrary.org/obo/hp.obo",
        format=DatasetFormat.OBO,
        size_mb_approx=15,
        license="Custom (free for research)",
        s3_prefix="data/grounding/ontologies/hpo/",
        chunk_fields=["name", "definition", "synonyms"],
        priority=1,
    ),
    "mesh_descriptors": DatasetConfig(
        name="MeSH Descriptors",
        description="Medical Subject Headings vocabulary (30K+ descriptors)",
        category=DatasetCategory.ONTOLOGY,
        url="https://nlmpubs.nlm.nih.gov/projects/mesh/MESH_FILES/asciimesh/d2025.bin",
        format=DatasetFormat.OBO,  # MeSH ASCII is OBO-like, parsed similarly
        size_mb_approx=300,
        license="Public Domain (NLM)",
        s3_prefix="data/grounding/ontologies/mesh/",
        chunk_fields=["name", "definition", "synonyms"],
        priority=1,
    ),
    "disease_ontology": DatasetConfig(
        name="Disease Ontology",
        description="Standardized disease classification (12K+ terms)",
        category=DatasetCategory.ONTOLOGY,
        url="http://purl.obolibrary.org/obo/doid.obo",
        format=DatasetFormat.OBO,
        size_mb_approx=10,
        license="CC0 1.0",
        s3_prefix="data/grounding/ontologies/disease_ontology/",
        chunk_fields=["name", "definition", "synonyms"],
        priority=1,
    ),
    "chebi": DatasetConfig(
        name="ChEBI Ontology",
        description="Chemical Entities of Biological Interest (60K+ entities)",
        category=DatasetCategory.ONTOLOGY,
        url="http://purl.obolibrary.org/obo/chebi.obo",
        format=DatasetFormat.OBO,
        compressed=False,
        size_mb_approx=500,
        license="CC BY 4.0",
        s3_prefix="data/grounding/ontologies/chebi/",
        chunk_fields=["name", "definition", "synonyms"],
        priority=2,
    ),

    # === GENE-DISEASE ASSOCIATIONS (high value, moderate size) ===
    "disgenet_curated": DatasetConfig(
        name="DisGeNET Curated Gene-Disease Associations",
        description="Expert-curated gene-disease associations (30K+ associations)",
        category=DatasetCategory.GENE_DISEASE,
        url="https://www.disgenet.org/static/disgenet_ap1/files/downloads/curated_gene_disease_associations.tsv.gz",
        format=DatasetFormat.TSV,
        compressed=True,
        size_mb_approx=5,
        license="CC BY-NC-SA 4.0",
        s3_prefix="data/grounding/gene_disease/disgenet/",
        id_column="geneId",
        name_column="geneSymbol",
        description_column="diseaseName",
        relation_columns=["geneSymbol", "diseaseName", "score", "source"],
        chunk_fields=["geneSymbol", "diseaseName", "source"],
        priority=2,
    ),
    "clinvar_summary": DatasetConfig(
        name="ClinVar Variant Summary",
        description="Clinical significance of genetic variants (2M+ entries)",
        category=DatasetCategory.VARIANT,
        url="https://ftp.ncbi.nlm.nih.gov/pub/clinvar/tab_delimited/variant_summary.txt.gz",
        format=DatasetFormat.TSV,
        compressed=True,
        size_mb_approx=100,
        license="Public Domain (NCBI)",
        s3_prefix="data/grounding/variants/clinvar/",
        id_column="VariationID",
        name_column="Name",
        description_column="ClinicalSignificance",
        relation_columns=["GeneSymbol", "ClinicalSignificance", "PhenotypeList"],
        chunk_fields=["Name", "GeneSymbol", "ClinicalSignificance", "PhenotypeList"],
        priority=3,
    ),

    # === DRUG DATA ===
    "drugbank_vocabulary": DatasetConfig(
        name="DrugBank Vocabulary",
        description="Drug names, synonyms, and identifiers (free subset)",
        category=DatasetCategory.DRUG,
        url="https://go.drugbank.com/releases/latest/downloads/all-drugbank-vocabulary",
        format=DatasetFormat.CSV,
        size_mb_approx=5,
        license="CC BY-NC 4.0",
        s3_prefix="data/grounding/drugs/drugbank_vocab/",
        id_column="DrugBank ID",
        name_column="Common name",
        delimiter=",",
        chunk_fields=["Common name", "Synonyms", "CAS", "UNII"],
        priority=2,
    ),

    # === PROTEIN INTERACTIONS ===
    "string_interactions": DatasetConfig(
        name="STRING Protein Interactions (Human)",
        description="Human protein-protein interactions with confidence scores",
        category=DatasetCategory.INTERACTION,
        url="https://stringdb-downloads.org/download/protein.links.v12.0/9606.protein.links.v12.0.txt.gz",
        format=DatasetFormat.TSV,
        compressed=True,
        size_mb_approx=200,
        license="CC BY 4.0",
        s3_prefix="data/grounding/interactions/string/",
        id_column="protein1",
        delimiter=" ",
        relation_columns=["protein1", "protein2", "combined_score"],
        chunk_fields=["protein1", "protein2", "combined_score"],
        priority=4,
    ),

    # === PATHWAYS ===
    "reactome_pathways": DatasetConfig(
        name="Reactome Pathway Hierarchy",
        description="Human biological pathway hierarchy and relationships",
        category=DatasetCategory.PATHWAY,
        url="https://reactome.org/download/current/ReactomePathwaysRelation.txt",
        format=DatasetFormat.TSV,
        size_mb_approx=1,
        license="CC BY 4.0",
        s3_prefix="data/grounding/pathways/reactome/",
        skip_header=False,
        relation_columns=["parent", "child"],
        priority=2,
    ),
    "reactome_pathway_names": DatasetConfig(
        name="Reactome Pathway Names",
        description="Human pathway names and identifiers",
        category=DatasetCategory.PATHWAY,
        url="https://reactome.org/download/current/ReactomePathways.txt",
        format=DatasetFormat.TSV,
        size_mb_approx=1,
        license="CC BY 4.0",
        s3_prefix="data/grounding/pathways/reactome_names/",
        skip_header=False,
        id_column="0",  # positional
        name_column="1",
        priority=2,
    ),

    # === GENE ANNOTATIONS ===
    "hgnc_gene_names": DatasetConfig(
        name="HGNC Gene Names",
        description="HUGO Gene Nomenclature Committee - official human gene names (43K+ genes)",
        category=DatasetCategory.GENE_DISEASE,
        url="https://ftp.ebi.ac.uk/pub/databases/genenames/hgnc/tsv/hgnc_complete_set.txt",
        format=DatasetFormat.TSV,
        size_mb_approx=20,
        license="Custom (free for research)",
        s3_prefix="data/grounding/genes/hgnc/",
        id_column="hgnc_id",
        name_column="symbol",
        description_column="name",
        chunk_fields=["symbol", "name", "alias_symbol", "prev_symbol", "gene_group"],
        priority=2,
    ),
}


def get_datasets_by_priority() -> list[tuple[str, DatasetConfig]]:
    """Return datasets sorted by priority (1=first)."""
    return sorted(DATASETS.items(), key=lambda x: x[1].priority)


def get_datasets_by_category(category: DatasetCategory) -> dict[str, DatasetConfig]:
    """Return datasets filtered by category."""
    return {k: v for k, v in DATASETS.items() if v.category == category}


def estimate_total_size_mb() -> int:
    """Estimate total download size in MB."""
    return sum(d.size_mb_approx for d in DATASETS.values())
