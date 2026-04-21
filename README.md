# humanovo — Adversarial Biomedical Hypothesis Engine

An AI-native platform for biomedical hypothesis generation using a 12-stage adversarial multi-model pipeline with dual-embedding grounding. Every hypothesis is generated, attacked, revised, mechanistically validated, and scored before delivery — with full citation provenance and audit trails.

## Architecture

```
humanovo/
├── backend/                  # Python FastAPI backend
│   ├── app/
│   │   ├── agents/           # 12-stage discovery orchestrator + supporting agents
│   │   ├── api/v1/           # REST API + WebSocket endpoints
│   │   ├── compute/          # Domain compute (genomics, pharma, imaging, signals)
│   │   ├── entity_resolution/# Canonical ID resolution + synonym management
│   │   ├── etl/              # Bulk data loading + dataset parsers
│   │   ├── ingestion/        # Data ingestion pipeline (PubMed, trials, omics)
│   │   ├── integration/      # Neo4j graph + pgvector + provenance connectors
│   │   ├── knowledge/        # Knowledge engine (graph + vector hybrid)
│   │   ├── literature/       # Literature pipeline (criteria, snapshots, updates)
│   │   ├── models/           # SQLAlchemy data models
│   │   ├── nlp/              # NLP pipeline (NER, relation extraction, assertion)
│   │   ├── rag/              # RAG pipeline (chunker, embeddings, retriever, reranker)
│   │   ├── scoring/          # Citation analysis + claim classification + confidence
│   │   ├── services/         # Business logic services
│   │   └── simulation/       # Monte Carlo simulation engine
│   └── tests/
├── frontend/                 # React TypeScript frontend (Vite + Tailwind)
├── infrastructure/           # Terraform (AWS)
├── docker/                   # Docker configurations
└── scripts/                  # Deployment + data loading utilities
```

## 12-Stage Discovery Pipeline

Each hypothesis passes through 12 specialized LLM stages sequentially. Between EVERY stage, dual-embedding grounding verifies claims against evidence.

| Stage | Role | Model | Provider |
|-------|------|-------|----------|
| 1. SEED | Generate initial hypothesis | Claude Opus 4.6 | AWS Bedrock |
| 2. EXPAND | Broaden hypothesis scope | Claude Sonnet 4.6 | AWS Bedrock |
| 3. EVIDENCE | Literature evidence review | Cohere Command A | Azure OpenAI |
| 4. COUNTER | Adversarial counter-arguments | Mistral-Large-3 | Azure AI |
| 5. REVISE | Revise based on counter-arguments | o3-mini | Azure OpenAI |
| 6. MECHANISM | Mechanistic deep dive | GPT-4.1 | Azure OpenAI |
| 7. VALIDATE | Cross-validation | Claude Sonnet 4.6 | AWS Bedrock |
| 8. GROUND | 3-layer scientific grounding | Grok-4-1-fast | Azure AI |
| 9. SCORE | Multi-dimensional confidence | GPT-4.1 | Azure OpenAI |
| 10. REFINE | Fast refinement | GPT-4o | Azure OpenAI |
| 11. TRANSLATE | Translational roadmap T0-T5 | Claude Sonnet 4.6 | AWS Bedrock |
| 12. FINALIZE | Final synthesis | Claude Sonnet 4.6 | AWS Bedrock |

### Dual-Embedding Grounding (between every stage)

Two embedding models run in parallel on every stage output:
1. **Bedrock Cohere Embed English v3** (1024d) — biomedical-optimized
2. **Azure text-embedding-3-large** (1536d) — general-purpose

Grounding mechanisms:
- **RAG Retrieval:** Embed output → retrieve matching evidence → inject into next stage
- **Semantic Gating:** Compare each claim against evidence pool → flag ungrounded claims

## Data Sources (60+ APIs)

Core: PubMed, ClinicalTrials.gov, openFDA, UniProt, Reactome, KEGG, Ensembl, HMDB
Extended: Elsevier/Scopus, Springer Nature, ChEBI, HCA, NCBI Gene, ClinVar, Semantic Scholar, OpenAlex, ChEMBL, DrugBank, DisGeNET, STRING, PDB, AlphaFold, WikiPathways, and more.

## Tech Stack

**Backend:** Python 3.11+ · FastAPI · SQLAlchemy + asyncpg · Neo4j · pgvector · Celery + Redis
**Frontend:** React 18 + TypeScript · Vite · TanStack Query · Zustand · Cytoscape.js
**Infrastructure:** AWS (Terraform) · Docker · PostgreSQL · Redis
**LLM Providers:** AWS Bedrock · Azure OpenAI · Azure AI Foundry

## Quick Start

### Prerequisites
- Docker and Docker Compose
- Node.js 22+
- Python 3.11+
- API keys for at least one LLM provider (AWS Bedrock or Azure OpenAI)

### Setup

```bash
# Clone
git clone <repository-url>
cd humanovo

# Copy and configure environment
cp backend/.env.example backend/.env
# Edit .env with your API keys

# Start infrastructure
docker-compose up -d postgres redis neo4j

# Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

### Run Pipeline Integration Test

```bash
cd backend
pytest tests/integration/test_pipeline_e2e.py -v --timeout=600
```

## License

Proprietary — All rights reserved. © 2025-2026 Adyanthaya Ventures.
