"""
ChEMBL — drug, bioactivity, mechanism of action.

No auth. https://www.ebi.ac.uk/chembl/api/data

Methods:
  - resolve_molecule(query) → list[{chembl_id, pref_name, max_phase, molecule_type}]
  - molecule(chembl_id) → full molecule metadata + indications
  - target_for_protein(uniprot) → ChEMBL target record for a UniProt accession
  - mechanism_of_action(chembl_id) → list[{action_type, target_name, tid, description}]
  - bioactivities(chembl_id, target_chembl_id, limit) → IC50 / Ki / Kd rows
"""

from __future__ import annotations

from typing import Any

from app.integrations.base import IntegrationClient


class ChEMBLClient(IntegrationClient):
    SERVICE = "chembl"
    BASE_URL = "https://www.ebi.ac.uk/chembl/api/data"
    RATE_PER_SECOND = 3.0
    MAX_CONCURRENT = 3

    # ---- resolve molecule (drug name / INN / synonym) -------------------

    async def resolve_molecule(
        self, query: str, max_results: int = 5,
    ) -> list[dict[str, Any]]:
        if not query:
            return []
        data = await self.fetch_json(
            "/molecule/search.json",
            params={"q": query, "limit": max_results},
        )
        if not data:
            return []
        out: list[dict[str, Any]] = []
        for m in (data.get("molecules") or [])[:max_results]:
            out.append({
                "chembl_id": m.get("molecule_chembl_id"),
                "pref_name": m.get("pref_name"),
                "max_phase": m.get("max_phase"),
                "first_approval": m.get("first_approval"),
                "molecule_type": m.get("molecule_type"),
                "withdrawn_flag": m.get("withdrawn_flag"),
            })
        return out

    # ---- single molecule -------------------------------------------------

    async def molecule(self, chembl_id: str) -> dict[str, Any] | None:
        if not chembl_id:
            return None
        data = await self.fetch_json(f"/molecule/{chembl_id}.json")
        if not data:
            return None
        props = data.get("molecule_properties") or {}
        structures = data.get("molecule_structures") or {}
        return {
            "chembl_id": data.get("molecule_chembl_id"),
            "pref_name": data.get("pref_name"),
            "max_phase": data.get("max_phase"),
            "first_approval": data.get("first_approval"),
            "molecule_type": data.get("molecule_type"),
            "mw": props.get("mw_freebase"),
            "alogp": props.get("alogp"),
            "rtb": props.get("rtb"),
            "hba": props.get("hba"),
            "hbd": props.get("hbd"),
            "psa": props.get("psa"),
            "smiles": structures.get("canonical_smiles"),
            "standard_inchi": structures.get("standard_inchi"),
            "atc_classifications": data.get("atc_classifications") or [],
            "withdrawn_flag": data.get("withdrawn_flag"),
            "withdrawn_reason": data.get("withdrawn_reason"),
            "withdrawn_year": data.get("withdrawn_year"),
        }

    # ---- target by UniProt ---------------------------------------------

    async def target_for_protein(
        self, uniprot_accession: str,
    ) -> dict[str, Any] | None:
        if not uniprot_accession:
            return None
        data = await self.fetch_json(
            "/target.json",
            params={
                "target_components__accession": uniprot_accession,
                "limit": 1,
            },
        )
        if not data:
            return None
        targets = data.get("targets") or []
        if not targets:
            return None
        t = targets[0]
        return {
            "chembl_id": t.get("target_chembl_id"),
            "pref_name": t.get("pref_name"),
            "target_type": t.get("target_type"),
            "organism": t.get("organism"),
            "component_count": len(t.get("target_components") or []),
        }

    # ---- mechanism of action -------------------------------------------

    async def mechanism_of_action(
        self, chembl_id: str, limit: int = 10,
    ) -> list[dict[str, Any]]:
        if not chembl_id:
            return []
        data = await self.fetch_json(
            "/mechanism.json",
            params={"molecule_chembl_id": chembl_id, "limit": limit},
        )
        if not data:
            return []
        return [
            {
                "action_type": m.get("action_type"),
                "target_chembl_id": m.get("target_chembl_id"),
                "mechanism_of_action": m.get("mechanism_of_action"),
                "parent_molecule_chembl_id":
                    m.get("parent_molecule_chembl_id"),
                "disease_efficacy": m.get("disease_efficacy"),
                "max_phase": m.get("max_phase"),
            }
            for m in (data.get("mechanisms") or [])[:limit]
        ]

    # ---- bioactivities --------------------------------------------------

    async def bioactivities(
        self,
        molecule_chembl_id: str | None = None,
        target_chembl_id: str | None = None,
        assay_type: str = "B",
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """Potency measurements. Filter by molecule or target; both
        strongly preferred to bound the result set."""
        params: dict[str, Any] = {"limit": limit, "assay_type": assay_type}
        if molecule_chembl_id:
            params["molecule_chembl_id"] = molecule_chembl_id
        if target_chembl_id:
            params["target_chembl_id"] = target_chembl_id
        if not (molecule_chembl_id or target_chembl_id):
            return []
        data = await self.fetch_json("/activity.json", params=params)
        if not data:
            return []
        out = []
        for a in (data.get("activities") or [])[:limit]:
            out.append({
                "molecule_chembl_id": a.get("molecule_chembl_id"),
                "target_chembl_id": a.get("target_chembl_id"),
                "target_pref_name": a.get("target_pref_name"),
                "standard_type": a.get("standard_type"),     # IC50, Ki, Kd
                "standard_value": a.get("standard_value"),
                "standard_units": a.get("standard_units"),
                "pchembl_value": a.get("pchembl_value"),
                "assay_description": a.get("assay_description"),
                "document_chembl_id": a.get("document_chembl_id"),
            })
        return out


_singleton: ChEMBLClient | None = None


def get_chembl_client() -> ChEMBLClient:
    global _singleton
    if _singleton is None:
        _singleton = ChEMBLClient()
    return _singleton
