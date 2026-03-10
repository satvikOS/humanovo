"""
Knowledge Graph API Endpoints

Interactive biomedical knowledge graph with nodes (genes, proteins,
pathways, diseases, drugs) and edges (relationships).
"""

import logging
from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

_nodes: dict[str, dict] = {}
_edges: dict[str, dict] = {}


def _seed():
    """Seed with sample biomedical data."""
    if _nodes:
        return

    seed_nodes = [
        ("TP53", "gene", "Tumor protein p53 — master regulator of cell cycle and apoptosis"),
        ("BRCA1", "gene", "Breast cancer type 1 susceptibility protein"),
        ("EGFR", "gene", "Epidermal growth factor receptor"),
        ("KRAS", "gene", "GTPase KRas — oncogene involved in cell signaling"),
        ("MYC", "gene", "MYC proto-oncogene — transcription factor"),
        ("p53 protein", "protein", "Tumor suppressor protein p53"),
        ("BRCA1 protein", "protein", "DNA repair protein BRCA1"),
        ("EGFR protein", "protein", "Receptor tyrosine kinase EGFR"),
        ("PI3K/AKT pathway", "pathway", "Cell survival and growth signaling pathway"),
        ("MAPK/ERK pathway", "pathway", "Mitogen-activated protein kinase cascade"),
        ("p53 signaling pathway", "pathway", "Apoptosis and cell cycle arrest pathway"),
        ("DNA Damage Response", "pathway", "DDR pathway for detecting and repairing DNA damage"),
        ("Breast Cancer", "disease", "Malignant neoplasm of the breast"),
        ("Lung Adenocarcinoma", "disease", "Non-small cell lung cancer subtype"),
        ("Colorectal Cancer", "disease", "Cancer of the colon or rectum"),
        ("Li-Fraumeni Syndrome", "disease", "Hereditary cancer predisposition syndrome"),
        ("Trastuzumab", "drug", "Monoclonal antibody targeting HER2"),
        ("Erlotinib", "drug", "EGFR tyrosine kinase inhibitor"),
        ("Olaparib", "drug", "PARP inhibitor for BRCA-mutated cancers"),
        ("Pembrolizumab", "drug", "Anti-PD-1 immune checkpoint inhibitor"),
    ]

    node_ids = {}
    for name, ntype, desc in seed_nodes:
        nid = str(uuid4())
        _nodes[nid] = {
            "id": nid, "name": name, "type": ntype, "description": desc,
            "properties": {}, "created_at": datetime.utcnow().isoformat(),
        }
        node_ids[name] = nid

    seed_edges = [
        ("TP53", "p53 protein", "encodes", 0.99, "TP53 gene encodes p53 protein"),
        ("BRCA1", "BRCA1 protein", "encodes", 0.99, "BRCA1 gene encodes BRCA1 protein"),
        ("EGFR", "EGFR protein", "encodes", 0.99, "EGFR gene encodes EGFR protein"),
        ("p53 protein", "p53 signaling pathway", "activates", 0.95, "p53 activates apoptosis pathway"),
        ("EGFR protein", "PI3K/AKT pathway", "activates", 0.90, "EGFR activates PI3K/AKT signaling"),
        ("EGFR protein", "MAPK/ERK pathway", "activates", 0.90, "EGFR activates MAPK/ERK cascade"),
        ("KRAS", "MAPK/ERK pathway", "regulates", 0.92, "KRAS is key regulator of MAPK pathway"),
        ("BRCA1 protein", "DNA Damage Response", "participates_in", 0.95, "BRCA1 is essential for homologous recombination repair"),
        ("TP53", "Breast Cancer", "associated_with", 0.85, "TP53 mutations found in ~30% of breast cancers"),
        ("BRCA1", "Breast Cancer", "associated_with", 0.92, "BRCA1 mutations increase breast cancer risk 60-80%"),
        ("TP53", "Li-Fraumeni Syndrome", "causes", 0.98, "Germline TP53 mutations cause Li-Fraumeni Syndrome"),
        ("EGFR", "Lung Adenocarcinoma", "associated_with", 0.88, "EGFR mutations in 15-30% of lung adenocarcinomas"),
        ("KRAS", "Colorectal Cancer", "associated_with", 0.85, "KRAS mutations in ~40% of colorectal cancers"),
        ("Trastuzumab", "Breast Cancer", "treats", 0.90, "Trastuzumab for HER2+ breast cancer"),
        ("Erlotinib", "Lung Adenocarcinoma", "treats", 0.85, "Erlotinib for EGFR-mutant NSCLC"),
        ("Erlotinib", "EGFR protein", "inhibits", 0.95, "Erlotinib is a reversible EGFR TKI"),
        ("Olaparib", "Breast Cancer", "treats", 0.88, "Olaparib for BRCA-mutated breast cancer"),
        ("Olaparib", "DNA Damage Response", "inhibits", 0.92, "Olaparib inhibits PARP in DDR pathway"),
        ("Pembrolizumab", "Lung Adenocarcinoma", "treats", 0.82, "Pembrolizumab for PD-L1+ NSCLC"),
        ("MYC", "PI3K/AKT pathway", "downstream_of", 0.80, "MYC is downstream target of PI3K/AKT"),
    ]

    for src, tgt, rel, strength, evidence in seed_edges:
        if src in node_ids and tgt in node_ids:
            eid = str(uuid4())
            _edges[eid] = {
                "id": eid, "source": node_ids[src], "target": node_ids[tgt],
                "source_name": src, "target_name": tgt,
                "relationship": rel, "strength": strength,
                "evidence": evidence, "created_at": datetime.utcnow().isoformat(),
            }


_seed()


class NodeCreate(BaseModel):
    name: str
    type: str  # gene, protein, pathway, disease, drug
    description: str = ""
    properties: dict = {}


class EdgeCreate(BaseModel):
    source: str  # node_id
    target: str  # node_id
    relationship: str
    strength: float = 0.5
    evidence: str = ""


@router.get("/nodes")
async def list_nodes(type: Optional[str] = None, search: Optional[str] = None):
    items = list(_nodes.values())
    if type:
        items = [n for n in items if n["type"] == type]
    if search:
        q = search.lower()
        items = [n for n in items if q in n["name"].lower() or q in n.get("description", "").lower()]
    return {"items": items, "total": len(items)}


@router.post("/nodes")
async def create_node(data: NodeCreate):
    nid = str(uuid4())
    node = {
        "id": nid, "name": data.name, "type": data.type,
        "description": data.description, "properties": data.properties,
        "created_at": datetime.utcnow().isoformat(),
    }
    _nodes[nid] = node
    return node


@router.get("/nodes/{node_id}")
async def get_node(node_id: str):
    if node_id not in _nodes:
        raise HTTPException(status_code=404, detail="Node not found")
    return _nodes[node_id]


@router.delete("/nodes/{node_id}")
async def delete_node(node_id: str):
    if node_id not in _nodes:
        raise HTTPException(status_code=404, detail="Node not found")
    del _nodes[node_id]
    # Remove connected edges
    to_remove = [eid for eid, e in _edges.items() if e["source"] == node_id or e["target"] == node_id]
    for eid in to_remove:
        del _edges[eid]
    return {"status": "deleted", "edges_removed": len(to_remove)}


@router.get("/edges")
async def list_edges():
    return {"items": list(_edges.values()), "total": len(_edges)}


@router.post("/edges")
async def create_edge(data: EdgeCreate):
    if data.source not in _nodes:
        raise HTTPException(status_code=404, detail="Source node not found")
    if data.target not in _nodes:
        raise HTTPException(status_code=404, detail="Target node not found")
    eid = str(uuid4())
    edge = {
        "id": eid, "source": data.source, "target": data.target,
        "source_name": _nodes[data.source]["name"],
        "target_name": _nodes[data.target]["name"],
        "relationship": data.relationship, "strength": data.strength,
        "evidence": data.evidence, "created_at": datetime.utcnow().isoformat(),
    }
    _edges[eid] = edge
    return edge


@router.delete("/edges/{edge_id}")
async def delete_edge(edge_id: str):
    if edge_id not in _edges:
        raise HTTPException(status_code=404, detail="Edge not found")
    del _edges[edge_id]
    return {"status": "deleted"}


@router.get("/subgraph/{node_id}")
async def get_subgraph(node_id: str, depth: int = Query(1, ge=1, le=3)):
    if node_id not in _nodes:
        raise HTTPException(status_code=404, detail="Node not found")

    visited = set()
    node_ids = {node_id}
    edge_ids = set()

    for _ in range(depth):
        new_nodes = set()
        for nid in node_ids:
            if nid in visited:
                continue
            visited.add(nid)
            for eid, edge in _edges.items():
                if edge["source"] == nid:
                    new_nodes.add(edge["target"])
                    edge_ids.add(eid)
                elif edge["target"] == nid:
                    new_nodes.add(edge["source"])
                    edge_ids.add(eid)
        node_ids |= new_nodes

    return {
        "center_node": _nodes[node_id],
        "nodes": [_nodes[nid] for nid in node_ids if nid in _nodes],
        "edges": [_edges[eid] for eid in edge_ids if eid in _edges],
    }


@router.get("/stats")
async def graph_stats():
    type_counts = {}
    for n in _nodes.values():
        type_counts[n["type"]] = type_counts.get(n["type"], 0) + 1
    rel_counts = {}
    for e in _edges.values():
        rel_counts[e["relationship"]] = rel_counts.get(e["relationship"], 0) + 1
    return {
        "total_nodes": len(_nodes),
        "total_edges": len(_edges),
        "node_types": type_counts,
        "relationship_types": rel_counts,
    }
