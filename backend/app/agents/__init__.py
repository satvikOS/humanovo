"""
GenUp AI Agents Module

Multi-agent orchestration framework for biomedical discovery.
Includes controller, search, extraction, reasoning, verification,
simulation, reporting, and ingestion agents.
"""

from app.agents.base import BaseAgent, AgentContext, AgentResult, AgentType
from app.agents.controller import ControllerAgent
from app.agents.search_agent import SearchAgent
from app.agents.verification_agent import VerificationAgent
from app.agents.hypothesis_agent import HypothesisGenerationAgent

# Ingestion agents
from app.agents.ingestion import (
    IngestionAgent,
    IngestionConfig,
    IngestionState,
    IngestionMetrics,
    IngestionStatus,
    PubMedIngestionAgent,
    ClinicalTrialsIngestionAgent,
    PatentsIngestionAgent,
    PreprintIngestionAgent,
    CustomDocumentIngestionAgent,
    IngestionOrchestrator,
)

__all__ = [
    # Base
    "BaseAgent",
    "AgentContext",
    "AgentResult",
    "AgentType",
    # Core agents
    "ControllerAgent",
    "SearchAgent",
    "VerificationAgent",
    "HypothesisGenerationAgent",
    # Ingestion agents
    "IngestionAgent",
    "IngestionConfig",
    "IngestionState",
    "IngestionMetrics",
    "IngestionStatus",
    "PubMedIngestionAgent",
    "ClinicalTrialsIngestionAgent",
    "PatentsIngestionAgent",
    "PreprintIngestionAgent",
    "CustomDocumentIngestionAgent",
    "IngestionOrchestrator",
]
