# Development guide

Cold-start setup for humanovo. New environment to first running pipeline
in ~15 minutes, assuming Docker + Node + Python are already installed.

If something here is wrong or out of date, fix it in this PR rather than
working around it — `Makefile` is the single source of truth for commands
and divergence here is a bug.

## Prerequisites

- **Docker + Docker Compose** for Postgres / Redis / Neo4j (Neo4j is on
  its way out per `docs/planning/A3_NEO4J_TO_PGVECTOR_PLAN.md` Phase 5;
  still required through Phase 4)
- **Node.js 22+** (the Tauri build matrix pins this; older Node trips
  Vite build optimisations)
- **Python 3.11+** for the backend
- **`make`** (the top-level Makefile is the canonical command surface)
- For desktop builds: **Rust toolchain** (`rustup`); the `tauri:build`
  command needs it. Skip if you only want web dev.

## First-time setup

From the repo root:

```bash
# 1. Infra services
docker compose up -d postgres redis neo4j

# 2. Backend env + deps + migrations
cp backend/.env.example backend/.env   # see "Environment variables" below
cd backend
python -m venv venv
source venv/bin/activate                # or `venv\Scripts\activate` on Windows
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload &

# 3. Frontend deps + dev server (in a fresh terminal)
cd frontend
npm ci
npm run dev                              # served on :3000 by default

# 4. (Optional) landing site
cd ../landing
npm ci
npm run dev                              # served on :3001
```

After step 3 the app is at `http://localhost:3000`. Backend health check:
`curl http://localhost:8000/api/v1/health`.

## Daily commands

Always run `make ci` before pushing — it runs the same checks the
GitHub Actions workflows run, so a green local CI ≈ a green PR check.

```bash
make help            # full list of targets
make lint            # ruff (backend) + tsc/eslint (frontend) + actionlint
make test            # backend pytest (offline-tolerant)
make format          # auto-fix backend + frontend
make ci              # everything CI runs, in order
make ci-full         # ci + landing build
make ci-actions      # workflow SHA-pin verifier + actionlint only
make build-landing   # production build for the landing page
```

Per-tree variants exist (`lint-backend`, `lint-frontend`, `test-backend`,
`format-backend`, `format-frontend`, `lint-actions`, `lint-landing`) when
you want to run one tree without the others.

## Environment variables

Backend reads from `backend/.env` (loaded via `pydantic-settings`). The
ones you actually need to set on a fresh box:

| Variable | Why | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection (asyncpg) | `postgresql+asyncpg://humanovo:humanovo@localhost:5432/humanovo` |
| `JWT_SECRET_KEY` | sign access tokens — generate with `openssl rand -hex 32` | empty (boot fails fast in prod, dev tolerates empty) |
| `PUBMED_EMAIL` | NCBI ToU; rejected at boot if a known placeholder | empty (boot fails in prod) |
| `PUBMED_API_KEY` | bumps NCBI throughput from 3 → 10 req/s; without it sources stay polite | empty |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | LLM providers used by the orchestrator | empty (pipeline runs only with one provider configured) |
| `BEDROCK_*` / `AZURE_*` | Bedrock + Azure deployments for the 12-stage pipeline | empty in dev; set in staging |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | billing webhook | empty (billing-related routes 503 without it) |
| `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` | KG store while A3 Phase 4 is pending | `bolt://localhost:7687` / `neo4j` / `neo4jpassword` |
| `KG_BACKEND` | `neo4j` or `postgres` — switches the KG read path (A3 Phase 3) | `neo4j` |
| `KG_DUAL_WRITE` | mirrors every Neo4j write to Postgres (A3 Phase 2) | `true` |
| `EUROPEPMC_RATE_LIMIT` | source-side ceiling, polite-pool default | `10` |

Production deploys read from AWS Secrets Manager; the `humanovo/prod/app`
bundle is populated by `bootstrap-backend-new-account.yml` plus a manual
top-up of credentials. See `OPERATIONS.md` for the rotation flow.

## Repo layout

```
humanovo/
├─ backend/                # FastAPI + SQLAlchemy + pgvector + Neo4j (→ pgvector)
│  ├─ app/
│  │  ├─ api/v1/endpoints/  # 54 endpoint modules
│  │  ├─ agents/            # 12-stage orchestrator + ingestion
│  │  ├─ core/              # auth, config, database, ownership helpers
│  │  ├─ knowledge/         # GraphStore (Neo4j) + PostgresGraphStore (A3)
│  │  ├─ models/            # SQLAlchemy ORM (22 migrations under migrations/)
│  │  ├─ services/          # cross-endpoint business logic
│  │  └─ ...
│  └─ tests/
├─ frontend/               # React + Vite + TypeScript + Tauri shell
│  ├─ src/
│  │  ├─ pages/             # 35 page components
│  │  ├─ components/        # shared UI (EmptyState, RouteGatePlaceholder, etc.)
│  │  ├─ contexts/          # AuthContext, ThemeContext, ToastContext, ...
│  │  ├─ services/          # API client + auth
│  │  └─ utils/
│  ├─ e2e/                  # Playwright specs (visual-screenshots + per-page hardening)
│  └─ src-tauri/            # native shell config
├─ landing/                # Next.js marketing site (humanovo.net)
├─ scripts/                # one-shot ops scripts (kg backfill, seeders, etc.)
├─ docs/planning/          # NEXT_SESSION.md + per-feature plan docs
├─ infrastructure/         # Terraform for AWS deploy
├─ .github/workflows/      # 19 SHA-pinned workflows
├─ docker-compose.yml      # Postgres + Redis + Neo4j for local dev
└─ Makefile                # canonical command surface
```

## Frontend

- **Vite + React 18** with the App Router style routes in
  `src/App.tsx`. Pages users hit on cold-start are eagerly imported;
  deep-nav pages (ProjectDetail, Settings, Notebook, Timeline,
  DataManager) are `React.lazy`'d behind `LazyPageWrapper`.
- **Tailwind** for styling; design tokens via CSS custom properties
  (`var(--color-text)`, `var(--glass-bg)`, etc.) so the dark/light
  swap stays consistent.
- **Tanstack Query + Zustand-free contexts** for state. AuthContext
  wraps the app inside `<BrowserRouter>` (see `main.tsx`); the
  Onboarding wizard uses `useAuth()` to gate its first-render.
- **Playwright** at `frontend/e2e/`. Two flavours:
  - `visual-screenshots.spec.ts` — every page, screenshots, console-error
    gate. Smoke.
  - `<page>-hardening.spec.ts` — focused mount + primary-CTA + error-path
    coverage per surface.
- Run e2e: `cd frontend && npm run e2e` (Playwright auto-spawns Vite on
  port 3001 with `--strictPort`). Headed: `npm run e2e -- --headed
  --workers=1`. Single spec: `npx playwright test <file>.spec.ts`.

## Backend

- **FastAPI** with SQLAlchemy 2 async + asyncpg. Migrations via Alembic
  (`backend/migrations/versions/`).
- **Tenant isolation**: every owner-scoped endpoint goes through
  `fetch_owned_or_404` (transitive via Project) or
  `fetch_owned_directly_or_404` (direct `owner_id`). Cross-tenant
  access returns **404**, not 403. See `docs/planning/SECURITY.md` for
  the threat model.
- **Migrations are idempotent**: every reconcile-class migration uses
  `ALTER TABLE ... IF NOT EXISTS` and `DROP ... IF EXISTS`; index +
  FK creation is gated on `pg_constraint` / `pg_indexes` checks.
  Re-runnable after partial application.
- **Pydantic v2** everywhere. `class Config:` is gone; use
  `model_config = ConfigDict(...)`.
- **Conftest is offline-tolerant** — pure unit tests run without
  Postgres; DB-dependent tests fail with their own targeted error
  rather than swallowing.

## Knowledge graph

The KG is mid-migration (A3 plan in `docs/planning/A3_NEO4J_TO_PGVECTOR_PLAN.md`):

- Phase 1-3 done: `PostgresGraphStore` lives alongside the Neo4j-backed
  `GraphStore`, every write is dual-mirrored, reads flip behind
  `KG_BACKEND` (`neo4j` | `postgres`).
- `GET /api/v1/admin/kg-parity` reports both backends side-by-side; the
  parity dashboard reads it.
- `scripts/backfill_kg_to_postgres.py` walks Neo4j and bulk-inserts
  into Postgres. Idempotent (UUID5 derivation + `ON CONFLICT DO UPDATE`).

When A3 Phase 5 lands, the Neo4j section of this guide gets deleted
along with the `neo4j` service.

## Common gotchas

- **`make ci` is the only thing that matches CI**. Running `tsc`
  by itself misses ruff; running `ruff` misses workflows. The
  Makefile is the canonical wrapper.
- **Frontend port 3000 vs 3001**: dev server uses 3000 (per
  `vite.config.ts`); Playwright spawns its OWN dev server on 3001
  with `--strictPort`. If `make ci` complains about a port collision,
  one of those is leaking from a previous run — kill node processes
  and try again.
- **Auth in tests**: tests don't authenticate. The Layout's
  Onboarding wizard is gated on `user !== null`, so test environments
  see it not render. `RouteGatePlaceholder` is currently passthrough
  (Stage 5 of `PATH_TO_100_PERCENT.md`) so routes are reachable
  without a token.
- **NCBI rate-limit**: without `PUBMED_API_KEY`, every NCBI source
  caps at 3 req/s. With it, 10 req/s. The fallback is correct but
  slow — set the key in dev if you're benchmarking ingestion.
- **Backend 5xx during dev**: `[API]` console errors in the browser
  are filtered by the e2e helpers but leak to dev — they mean the
  backend isn't running. `docker compose up -d postgres redis neo4j`
  + `uvicorn app.main:app --reload` clears them.

## Where to look next

- Big-picture roadmap: `docs/planning/PATH_TO_100_PERCENT.md`.
- Where we left off (per-session handoff): `docs/planning/NEXT_SESSION.md`.
- Production runbook: `OPERATIONS.md`.
- CI gotchas catalogue: `docs/planning/CI_GOTCHAS.md`.
- KG migration plan: `docs/planning/A3_NEO4J_TO_PGVECTOR_PLAN.md`.
- Threat model: `docs/planning/SECURITY.md`.
