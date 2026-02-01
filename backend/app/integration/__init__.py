"""
RAG-Agent Integration Module

Provides seamless integration between ingestion agents and RAG infrastructure
including vector store indexing, knowledge graph updates, and provenance tracking.
"""

from app.integration.rag_connector import (
    RAGConnector,
    IndexingConfig,
    IndexingResult,
    get_rag_connector,
)
from app.integration.graph_connector import (
    GraphConnector,
    GraphUpdateConfig,
    GraphUpdateResult,
    get_graph_connector,
)
from app.integration.realtime_indexer import (
    RealtimeIndexer,
    IndexUpdate,
    IndexUpdateType,
    ConsistencyLevel,
    get_realtime_indexer,
)
from app.integration.provenance_tracker import (
    ProvenanceTracker,
    ProvenanceRecord,
    ProvenanceChain,
    get_provenance_tracker,
)

__all__ = [
    # RAG Connector
    "RAGConnector",
    "IndexingConfig",
    "IndexingResult",
    "get_rag_connector",
    # Graph Connector
    "GraphConnector",
    "GraphUpdateConfig",
    "GraphUpdateResult",
    "get_graph_connector",
    # Realtime Indexer
    "RealtimeIndexer",
    "IndexUpdate",
    "IndexUpdateType",
    "ConsistencyLevel",
    "get_realtime_indexer",
    # Provenance Tracker
    "ProvenanceTracker",
    "ProvenanceRecord",
    "ProvenanceChain",
    "get_provenance_tracker",
]
