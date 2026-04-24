"""
Humanovo external biomedical data integrations — no-auth edition.

Every integration in this package queries a public biomedical API that
requires zero authentication (the polite-pool emails and User-Agent
strings are configured centrally from settings.PUBMED_EMAIL).

Integrations:
    alphafold         — Protein structure + pLDDT confidence via EBI
                        (https://alphafold.ebi.ac.uk/api)
    chembl            — Drug, target, bioactivity, mechanism
                        (https://www.ebi.ac.uk/chembl/api/data)
    ensembl           — Variant effect predictor + gene lookup
                        (https://rest.ensembl.org)
    europepmc         — Full-text + abstract search
                        (https://www.ebi.ac.uk/europepmc/webservices/rest)
    human_protein_atlas — Tissue expression, cell type, subcellular
                        (https://www.proteinatlas.org)
    openalex          — Works + concepts + institutions
                        (https://api.openalex.org, polite pool)
    opentargets       — Drug-target-disease GraphQL
                        (https://api.platform.opentargets.org/api/v4/graphql)
    reactome          — Pathway enrichment, participants
                        (https://reactome.org/ContentService)
    uniprot           — Protein annotation + cross-references
                        (https://rest.uniprot.org)

All integrations share the same contract:
    class XyzClient:
        async def fetch(...) -> dict | list[dict]
        async def search(...) -> list[dict]   (when applicable)
        async def close(self) -> None

Results are cached in `integration_cache` (Postgres) with a 30-day TTL
to cap both latency and polite-pool hits. On cache miss, the client
makes the request and stores the response JSON + metadata. On cache
hit, the response is returned without network I/O.

Module-level `get_*()` singletons are provided for app code; tests
instantiate clients directly so they can inject a mock transport.
"""

from app.integrations.base import (
    IntegrationClient,
    IntegrationError,
    get_integration_cache,
)

__all__ = [
    "IntegrationClient",
    "IntegrationError",
    "get_integration_cache",
]
