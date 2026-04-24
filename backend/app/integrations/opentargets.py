"""
OpenTargets — drug-target-disease associations via GraphQL.

No auth. https://api.platform.opentargets.org/api/v4/graphql

This is the single most high-leverage biomedical integration we have:
one GraphQL endpoint replaces ~20 siloed REST endpoints across genetic
associations, literature mining, drug mechanisms, clinical evidence,
pathway overlaps, and differential expression.

Methods we expose (tight, LLM-friendly contracts):
  - target_by_symbol(symbol) → basic target + tractability
  - disease_search(term) → list[{id, name, therapeuticAreas}]
  - associations(target_efo_disease) → ranked target-disease scores
  - known_drugs(target_symbol, size=10) → drugs targeting that protein
  - mechanisms_for_drug(chembl_id) → KnownDrugs for the drug

GraphQL schema is large; we send hand-tuned concrete queries rather
than generating them, so token cost stays bounded.
"""

from __future__ import annotations

from typing import Any

from app.integrations.base import IntegrationClient


class OpenTargetsClient(IntegrationClient):
    SERVICE = "opentargets"
    BASE_URL = "https://api.platform.opentargets.org"
    RATE_PER_SECOND = 3.0
    MAX_CONCURRENT = 3

    # ----- helper ---------------------------------------------------------

    async def _graphql(self, query: str, variables: dict[str, Any]) -> Any:
        data = await self.fetch_json(
            "/api/v4/graphql",
            method="POST",
            json_body={"query": query, "variables": variables},
        )
        if not data:
            return None
        return data.get("data")

    # ----- target resolution ---------------------------------------------

    async def target_by_symbol(self, symbol: str) -> dict[str, Any] | None:
        q = """
        query TargetBySymbol($symbol: String!) {
          search(queryString: $symbol, entityNames: ["target"]) {
            hits { id name object { ... on Target {
              id approvedSymbol approvedName biotype
              pathways { pathwayId pathway }
              tractability { modality value label }
            } } }
          }
        }
        """
        data = await self._graphql(q, {"symbol": symbol})
        if not data:
            return None
        hits = (data.get("search") or {}).get("hits") or []
        if not hits:
            return None
        obj = hits[0].get("object") or {}
        return {
            "id": obj.get("id"),
            "approved_symbol": obj.get("approvedSymbol"),
            "approved_name": obj.get("approvedName"),
            "biotype": obj.get("biotype"),
            "pathways": [
                {"id": p.get("pathwayId"), "name": p.get("pathway")}
                for p in (obj.get("pathways") or [])[:10]
            ],
            "tractability": obj.get("tractability"),
        }

    # ----- disease resolution --------------------------------------------

    async def disease_search(
        self, term: str, size: int = 5,
    ) -> list[dict[str, Any]]:
        q = """
        query DiseaseSearch($term: String!) {
          search(queryString: $term, entityNames: ["disease"]) {
            hits {
              id name
              object {
                ... on Disease {
                  id name description therapeuticAreas { id name }
                }
              }
            }
          }
        }
        """
        data = await self._graphql(q, {"term": term})
        if not data:
            return []
        hits = (data.get("search") or {}).get("hits") or []
        out = []
        for h in hits[:size]:
            obj = h.get("object") or {}
            out.append({
                "id": obj.get("id") or h.get("id"),
                "name": obj.get("name") or h.get("name"),
                "description": (obj.get("description") or "")[:500],
                "therapeutic_areas": [
                    {"id": a.get("id"), "name": a.get("name")}
                    for a in (obj.get("therapeuticAreas") or [])
                ],
            })
        return out

    # ----- target-disease associations -----------------------------------

    async def associations(
        self,
        target_id: str | None = None,
        disease_id: str | None = None,
        size: int = 10,
    ) -> list[dict[str, Any]]:
        """Ranked target-disease associations with datatype evidence scores."""
        if target_id:
            q = """
            query TargetAssocs($id: String!, $size: Int!) {
              target(ensemblId: $id) {
                associatedDiseases(page: {index: 0, size: $size}) {
                  rows {
                    score
                    disease { id name }
                    datatypeScores { id score }
                  }
                }
              }
            }
            """
            data = await self._graphql(q, {"id": target_id, "size": size})
            rows = (((data or {}).get("target") or {})
                    .get("associatedDiseases") or {}).get("rows") or []
        elif disease_id:
            q = """
            query DiseaseAssocs($id: String!, $size: Int!) {
              disease(efoId: $id) {
                associatedTargets(page: {index: 0, size: $size}) {
                  rows {
                    score
                    target { id approvedSymbol approvedName }
                    datatypeScores { id score }
                  }
                }
              }
            }
            """
            data = await self._graphql(q, {"id": disease_id, "size": size})
            rows = (((data or {}).get("disease") or {})
                    .get("associatedTargets") or {}).get("rows") or []
        else:
            return []

        return [
            {
                "score": r.get("score"),
                "disease": r.get("disease"),
                "target": r.get("target"),
                "datatypes": [
                    {"id": d.get("id"), "score": d.get("score")}
                    for d in (r.get("datatypeScores") or [])
                ],
            }
            for r in rows
        ]

    # ----- known drugs for target ---------------------------------------

    async def known_drugs_for_target(
        self, target_id: str, size: int = 10,
    ) -> list[dict[str, Any]]:
        q = """
        query KnownDrugs($id: String!, $size: Int!) {
          target(ensemblId: $id) {
            knownDrugs(size: $size) {
              rows {
                drug { id name drugType maximumClinicalTrialPhase }
                mechanismOfAction
                phase
                status
                disease { id name }
              }
            }
          }
        }
        """
        data = await self._graphql(q, {"id": target_id, "size": size})
        rows = (((data or {}).get("target") or {})
                .get("knownDrugs") or {}).get("rows") or []
        return [
            {
                "drug": r.get("drug"),
                "mechanism_of_action": r.get("mechanismOfAction"),
                "phase": r.get("phase"),
                "status": r.get("status"),
                "disease": r.get("disease"),
            }
            for r in rows
        ]


_singleton: OpenTargetsClient | None = None


def get_opentargets_client() -> OpenTargetsClient:
    global _singleton
    if _singleton is None:
        _singleton = OpenTargetsClient()
    return _singleton
