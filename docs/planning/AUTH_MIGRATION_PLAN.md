# Auth Migration Plan — Sprint 1 / Day 4

**Status**: planning · **Owner**: TBA · **Lands**: Sprint 1 / Day 4 (after Day 3 credential rotation)

The current state is `HTTPBearer(auto_error=False)` (`backend/app/core/auth.py:34`) with `Depends(get_current_active_user)` applied only to the `auth.py` module's own routes. Every other endpoint silently permits anonymous access. This document specifies the target state per module and the migration order.

## Strategy: router-level dependencies

The cleanest path is **router-level default auth** rather than per-endpoint decoration:

```python
# in backend/app/api/v1/endpoints/projects.py
from fastapi import APIRouter, Depends
from app.core.auth import get_current_active_user

router = APIRouter(
    prefix="/projects",
    tags=["projects"],
    dependencies=[Depends(get_current_active_user)],
)
```

This applies `get_current_active_user` to *every* endpoint in the router by default. Public endpoints (e.g., `/auth/login`) keep their own router with no default dependency. Endpoints needing admin-only access add `Depends(get_current_admin_user)` at the route level on top of the router default.

`HTTPBearer(auto_error=False)` stays — `get_current_active_user` already raises 401 when the user is missing, so the auto-error toggle is moot once dependencies are wired correctly. We can flip it to `True` later as belt-and-suspenders.

## Target auth state per endpoint module

| Module | File | Target auth | Notes / breaking-change risk |
|---|---|---|---|
| `auth` | `endpoints/auth.py` | mixed | `/register`, `/login` stay public. `/me`, `/me PATCH`, `/change-password`, `/logout` already use `get_current_active_user`. `/users` already uses `get_current_admin_user`. **No change needed.** |
| `_bulk` | `endpoints/_bulk.py` | admin | Bulk operations are dangerous; lock to admin. |
| `activities` | `endpoints/activities.py` | user | User activity feed scoped to current user. |
| `admin` | `endpoints/admin.py` | admin | All seed/migrate endpoints require `get_current_admin_user`. **Remove env-only gating.** |
| `agent_chat_stream` | `endpoints/agent_chat_stream.py` | user | SSE stream — also strip stage names + model names from emitted events (Sprint 1 / D6). |
| `agents` | `endpoints/agents.py` | user | |
| `biobank` | `endpoints/biobank.py` | user (or hide) | v1 cut list says hide; keep auth wired so it works in v1.1. |
| `citation_verify` | `endpoints/citation_verify.py` | user | |
| `citations` | `endpoints/citations.py` | user | |
| `clinical_trials` | `endpoints/clinical_trials.py` | user (or hide) | v1 cut list says hide. |
| `collaboration` | `endpoints/collaboration.py` | user (or hide) | v1 cut list says hide. |
| `compute` | `endpoints/compute.py` | user | |
| `compute_engine` | `endpoints/compute_engine.py` | user | |
| `config_endpoints` | `endpoints/config_endpoints.py` | mixed | Read-only client config: public. Mutations: admin. |
| `data_sources` | `endpoints/data_sources.py` | user | |
| `datasets` | `endpoints/datasets.py` | user | Tied to project ownership — also enforce `project.user_id == current_user.id` on every read/write. |
| `discovery` | `endpoints/discovery.py` | user | Plus rate-limit middleware (LLM cost protection). |
| `discovery_sessions` | `endpoints/discovery_sessions.py` | user | |
| `document_pipeline` | `endpoints/document_pipeline.py` | user | |
| `evidence` | `endpoints/evidence.py` | user | |
| `evoe` | `endpoints/evoe.py` | user | |
| `experiments` | `endpoints/experiments.py` | user (or hide) | Hidden in v1 (experiment-tracker route cut). Keep auth wired. |
| `genomics` | `endpoints/genomics.py` | user | |
| `hypotheses` | `endpoints/hypotheses.py` | user | Plus per-hypothesis ownership check (project membership). |
| `imaging` | `endpoints/imaging.py` | user (or hide) | v1 cut list says hide. |
| `ingestion` | `endpoints/ingestion.py` | admin | Bulk ingestion is admin-only. |
| `ingestion_ws` | `endpoints/ingestion_ws.py` | admin | WebSocket; auth via initial handshake token. |
| `jamison_api` | `endpoints/jamison_api.py` | **rename + admin** | P0: rename file to drop the codename. Likely admin/internal. |
| `kg_permissions` | `endpoints/kg_permissions.py` | user | User sets permissions on their own KG documents. |
| `knowledge` | `endpoints/knowledge.py` | user | |
| `knowledge_graph` | `endpoints/knowledge_graph.py` | user | |
| `knowledge_graph_entities` | `endpoints/knowledge_graph_entities.py` | user | |
| `manuscripts` | `endpoints/manuscripts.py` | user (or hide) | v1 cut list says hide. |
| `ml_models` | `endpoints/ml_models.py` | user (or hide) | v1 cut list says hide. |
| `monitoring` | `endpoints/monitoring.py` | admin | Internal observability. |
| `notebook` | `endpoints/notebook.py` | user | |
| `orchestrator` | `endpoints/orchestrator.py` | user/internal | Confirm whether this is user-facing or internal-only; if internal, gate to admin or remove from public router. |
| `paper_qa` | `endpoints/paper_qa.py` | user | |
| `pipeline_intelligence` | `endpoints/pipeline_intelligence.py` | user | **Rename URL path** to avoid leaking architecture (e.g., `/api/v1/insights` instead of `/api/v1/pipeline-intelligence`). |
| `project_kg` | `endpoints/project_kg.py` | user | Plus project ownership check. |
| `projects` | `endpoints/projects.py` | user | Plus enforce `project.user_id == current_user.id` for reads/writes. |
| `rag` | `endpoints/rag.py` | user | **Rename URL path** to avoid leaking architecture (e.g., `/api/v1/search` or merge into `knowledge`). |
| `regulatory` | `endpoints/regulatory.py` | user (or hide) | v1 cut list says hide. |
| `simulation` | `endpoints/simulation.py` | user | |
| `statistics` | `endpoints/statistics.py` | user | |
| `user_budget` | `endpoints/user_budget.py` | user | Self-service budget views. |
| `user_state` | `endpoints/user_state.py` | user | |
| `websocket` | `endpoints/websocket.py` | user | **Token-in-handshake auth required.** Plus per-connection rate limit + send-side backpressure (Sprint 1 / D5). |
| `ws_streaming` | `endpoints/ws_streaming.py` | user | Same WS auth pattern. |

Public endpoints (no auth) that stay:
- `GET /health` — but lock down to aggregate status (hide service-by-service detail per `main.py:113-138`).
- `POST /auth/register`, `POST /auth/login` — by definition.
- (consider: `GET /api/v1/config/public` for client bootstrap if needed.)

Endpoints to gate behind `DEBUG` (not exposed in production):
- `GET /api/docs`, `GET /api/redoc`, `GET /api/openapi.json` (`backend/app/main.py:79-81`).

## Migration order

**Wave 0 — preparation (no behavior change)**

1. Audit each endpoint module to confirm the per-module table above. Where ambiguous, file an inline TODO and tag the module owner.
2. Add a router-level helper in `backend/app/core/auth.py`:

   ```python
   AUTH_REQUIRED = [Depends(get_current_active_user)]
   ADMIN_REQUIRED = [Depends(get_current_admin_user)]
   ```
3. Add a CI guard test that fails if a router under `app/api/v1/endpoints/` has neither a router-level auth dependency nor an explicit `# auth: public` opt-out comment near its definition.

**Wave 1 — user-data modules (highest risk if wrong)**

4. Apply `dependencies=AUTH_REQUIRED` to: `projects`, `hypotheses`, `discovery`, `discovery_sessions`, `evidence`, `datasets`, `notebook`, `citations`, `citation_verify`, `knowledge`, `knowledge_graph`, `knowledge_graph_entities`, `project_kg`, `kg_permissions`, `compute`, `compute_engine`, `simulation`, `statistics`, `genomics`, `paper_qa`, `agents`, `agent_chat_stream`, `data_sources`, `evoe`, `pipeline_intelligence`, `rag`, `user_budget`, `user_state`, `activities`, `document_pipeline`.
5. Add per-resource ownership checks (`project.user_id == current_user.id`) inside the affected endpoints. Where missing, this is a separate audit.

**Wave 2 — admin modules**

6. Apply `dependencies=ADMIN_REQUIRED` to: `admin`, `_bulk`, `ingestion`, `ingestion_ws`, `monitoring`, `jamison_api` (post-rename).
7. Drop env-only gating from `admin.py` seed endpoints; replace with admin role check.

**Wave 3 — hidden v1 modules**

8. Apply `dependencies=AUTH_REQUIRED` to: `biobank`, `clinical_trials`, `collaboration`, `experiments`, `imaging`, `manuscripts`, `ml_models`, `regulatory`. (Even though their UI is hidden, the API stays callable for v1.1. Auth must be wired so we don't ship an unauthenticated zombie surface.)

**Wave 4 — WebSocket auth**

9. Implement token-in-handshake auth on `websocket.py`, `ws_streaming.py`, `ingestion_ws.py`. Pattern:

   ```python
   @router.websocket("/projects/{project_id}")
   async def project_ws(websocket: WebSocket, project_id: UUID, token: str = Query(...)):
       user = await authenticate_ws_token(token)
       if not user or not await user_can_access_project(user, project_id):
           await websocket.close(code=1008)  # policy violation
           return
       ...
   ```
10. Add per-connection rate limit (e.g., 10 messages / sec) and send-side backpressure with disconnect-stale-clients (Sprint 1 / D5).

**Wave 5 — production-only hardening**

11. Gate `/api/docs`, `/api/redoc`, `/api/openapi.json` behind `if settings.DEBUG`.
12. Lock `/health` to aggregate-only response in production.
13. Set `auto_error=True` on the security scheme as belt-and-suspenders.

## Tests

For each migrated module, add to `backend/tests/`:

- `test_<module>_auth.py` — three cases: unauthenticated returns 401; non-owner returns 403; owner succeeds.
- A repo-wide `test_no_unauthenticated_endpoints.py` — instantiates the FastAPI app, walks every route, asserts that every route under `/api/v1/` either (a) has a known-public allowlist entry or (b) requires `get_current_active_user`.

Once these pass, Sprint 1 / D4 is done.

## Breaking-change communication

- The migration produces a hard breaking change: every existing API client must send a Bearer token.
- We own the only frontend; no external API consumers per current state.
- Coordinate with frontend engineer: ensure the `axios` interceptor in `frontend/src/services/api.ts` attaches the JWT for every request before merging this wave.
- Add a deploy gate: frontend with auth-attaching interceptor must ship before backend with required auth, OR they ship together. Otherwise users hit 401s.
