# GenUp - Biomedical Discovery Platform

An AI-centric platform for biomedical hypothesis generation, integrating continuous data ingestion, knowledge management, AI reasoning, Monte Carlo simulation, and interactive visualization.

## Architecture Overview

```
genup/
├── backend/                 # Python FastAPI backend
│   ├── app/
│   │   ├── api/            # REST API endpoints
│   │   ├── agents/         # Multi-agent AI framework
│   │   ├── ingestion/      # Data ingestion pipeline
│   │   ├── knowledge/      # Knowledge storage (Vector DB + Graph DB)
│   │   ├── hypothesis/     # Hypothesis generation engine
│   │   ├── simulation/     # Monte Carlo simulation module
│   │   └── core/           # Core utilities and config
│   └── tests/
├── frontend/               # React TypeScript frontend
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── features/       # Feature modules
│   │   ├── hooks/          # Custom React hooks
│   │   ├── services/       # API services
│   │   └── store/          # State management
│   └── public/
├── docker/                 # Docker configurations
└── docs/                   # Documentation
```

## Core Components

### 1. Data Ingestion Pipeline
- Continuous ingestion from PubMed, clinical trials, omics databases
- NLP-based entity extraction (genes, diseases, drugs, pathways)
- Ontology harmonization (UMLS, MeSH)
- Evidence versioning and timestamping

### 2. Knowledge Storage (RAG Memory)
- **Graph Database**: Neo4j for structured biomedical knowledge
- **Vector Database**: ChromaDB/FAISS for semantic search
- Hybrid retrieval-augmented generation

### 3. AI Orchestration & Agents
- Controller/Planner agent for task decomposition
- Search agents (Google/Brave API integration)
- Information extraction agent
- Reasoning (LLM) agent
- Verification agent
- Simulation agent
- Reporting agent

### 4. Hypothesis Generation Engine
- RAG-based hypothesis synthesis
- Graph-based reasoning for multi-hop connections
- Scoring and ranking by plausibility/novelty
- Provenance tracking and contradiction detection

### 5. Monte Carlo Simulation Module
- Probabilistic outcome simulations
- Clinical trial modeling
- Epidemiological projections
- Pathway dynamics simulation

### 6. User Interface
- Interactive dashboard with hypothesis cards
- Knowledge graph explorer (Cytoscape.js)
- 3D molecular viewer (NGL/3Dmol.js)
- Timeline/version control
- Collaborative note-taking

## Tech Stack

### Backend
- Python 3.11+
- FastAPI (REST API + WebSockets)
- LangChain/LangGraph (AI orchestration)
- Neo4j (Graph database)
- ChromaDB (Vector database)
- Celery + Redis (Task queue)
- NumPy/SciPy (Simulation)

### Frontend
- React 18 with TypeScript
- Vite (Build tool)
- TanStack Query (Data fetching)
- Zustand (State management)
- Cytoscape.js (Graph visualization)
- NGL Viewer (3D molecular graphics)
- Plotly (Charts)

### Infrastructure
- Docker + Docker Compose
- PostgreSQL (Metadata)
- Redis (Caching + Message broker)

## Quick Start

### Prerequisites
- Docker and Docker Compose
- Node.js 18+
- Python 3.11+

### Development Setup

```bash
# Clone and setup
git clone <repository-url>
cd GenUp

# Start infrastructure services
docker-compose up -d postgres redis neo4j

# Backend setup
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend setup (new terminal)
cd frontend
npm install
npm run dev
```

### Environment Variables

Copy `.env.example` to `.env` and configure:
- `DATABASE_URL`: PostgreSQL connection
- `NEO4J_URI`: Neo4j connection
- `OPENAI_API_KEY`: For LLM integration
- `GOOGLE_API_KEY`: For search agents
- `BRAVE_API_KEY`: For search agents

## Development Phases

### Phase 1: MVP (Months 2-4)
- Basic data ingestion (PubMed)
- RAG pipeline with vector search
- Simple Q&A interface

### Phase 2: Multi-Agent (Months 5-8)
- Hypothesis generation engine
- Multi-agent orchestration
- Knowledge graph explorer

### Phase 3: Simulation (Months 9-12)
- Monte Carlo engine integration
- Full dashboard UI
- 3D visualization

### Phase 4: Beta (Months 13-18)
- Enterprise features
- Performance optimization
- Beta release

## License

Proprietary - All rights reserved
