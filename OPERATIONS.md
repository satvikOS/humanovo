# Operations runbook

What to do when something breaks, when something needs deploying, or
when a secret needs rotating. Companion to `DEVELOPMENT.md` (cold-start
setup) and `docs/planning/PATH_TO_100_PERCENT.md` (roadmap).

If you're following one of these procedures and find a gap, **fix
this doc in the same change**. A runbook that drifts from reality is
worse than no runbook.

## On-call quick reference

| Symptom | First check |
|---|---|
| Frontend serves blank page | CloudFront 5xx? `gh run list --workflow="Deploy Frontend to NEW account"` for the last successful deploy |
| Backend 503 | Is RDS up? Is the ECS task healthy? `gh run list --workflow="E2E Live Smoke (api.humanovo.net)"` — if smoke is red the API is down |
| Auth flow fails | `JWT_SECRET_KEY` rotated mid-deploy? Existing tokens become invalid; users re-login. Not an outage. |
| Stripe webhooks 401 | `STRIPE_WEBHOOK_SECRET` rotated without updating AWS Secrets Manager |
| Discovery pipeline hangs | Check `[API] 5xx` in browser console + `BEDROCK_*` / `AZURE_*` quotas. Each provider has independent rate limits. |
| KG queries return empty / stale | `KG_BACKEND` flipped without backfill? Check `/api/v1/admin/kg-parity` — `in_parity: false` means the new backend is empty |

## Deploy procedures

### Frontend (Vercel + Tauri auto-update)

Pushes to `humanovo` branch trigger:

1. **`Deploy Frontend to NEW account`** — Vercel deploys
   `frontend/dist/` to CloudFront. Takes ~2 minutes. Subsequent
   page loads serve the new bundle; the open tab cache invalidates
   on next reload.
2. **`Build Native Apps (Win/Mac/Linux)`** — Tauri builds 3-OS
   installers. Takes ~10 minutes. Posts a GitHub Release tagged
   `auto-{shortSHA}` with the binaries + a `latest.json` manifest
   the Tauri updater plugin reads.

Rollback: every deploy is content-addressed; the previous bundle is
still served by hash. To revert behaviourally, push a commit with the
revert and let CI fan out.

To skip a deploy (docs-only push, etc.): the path filter on
`build-native-apps.yml` excludes backend / docs paths automatically.
For a manual force-skip, prepend `[skip ci]` to the commit message.

### Backend (AWS ECS)

Pushes to `humanovo` that touch `backend/**` trigger:

1. **`Deploy Backend to NEW account`** — builds the Docker image,
   pushes to ECR, updates the ECS service. Takes ~30 seconds for the
   image step + however long ECS takes to drain old tasks (default ~2
   minutes).
2. **`E2E Live Smoke (api.humanovo.net)`** — fires after the deploy
   workflow succeeds. Hits `/api/v1/health/full` + critical
   read endpoints. Red here = roll back.

Rollback: re-trigger an older successful workflow run from the GitHub
Actions UI (`Re-run all jobs` on the green run before the regression).
The ECS task definition revision is rolled forward; a re-run picks the
older image and rolls back.

### Migrations

Alembic migrations run inside the ECS task on startup (entrypoint).
Once a migration runs in prod, it's permanent — there's no down-migration
review process. Treat migrations as forward-only.

If a migration breaks in production:
1. **Don't** push another deploy. The new ECS task will retry the broken
   migration on every cold-start.
2. Connect to RDS via the bastion or AWS Session Manager.
3. Inspect `alembic_version` and the broken table.
4. Either fix the schema by hand and update `alembic_version` to mark
   the migration applied, OR write a follow-up migration that handles
   the partial state (every reconcile-class migration uses
   `IF NOT EXISTS` / `IF EXISTS` precisely so this works).
5. Re-deploy.

## Secret rotation

Live secrets are stored in AWS Secrets Manager bundle `humanovo/prod/app`.
The ECS task has IAM read access; nothing else does.

### `JWT_SECRET_KEY`

```bash
# 1. Generate
NEW_KEY=$(openssl rand -hex 32)

# 2. Update AWS Secrets Manager
aws secretsmanager update-secret \
  --secret-id humanovo/prod/app \
  --secret-string "$(aws secretsmanager get-secret-value --secret-id humanovo/prod/app \
    --query SecretString --output text \
    | jq --arg key "$NEW_KEY" '.JWT_SECRET_KEY = $key')"

# 3. Force a new ECS task revision so the rotation takes effect
aws ecs update-service \
  --cluster humanovo-prod \
  --service humanovo-backend \
  --force-new-deployment
```

**Side effect**: every existing access token becomes invalid. Users
re-login on next request. Schedule for off-hours.

### `STRIPE_WEBHOOK_SECRET`

```bash
# 1. Rotate in Stripe Dashboard → Developers → Webhooks → endpoint → Roll
# 2. Mirror to AWS Secrets Manager (same as JWT_SECRET_KEY above, key=STRIPE_WEBHOOK_SECRET)
# 3. Force a new ECS deploy
```

There's a 24h grace period in Stripe — old + new secrets both validate.
Use the window to deploy without webhook interruption.

### `STRIPE_SECRET_KEY`

Same flow as the webhook secret. **Verify the key prefix** — `sk_live_*`
for prod, `sk_test_*` for staging. A copy-paste between envs has caused
real outages elsewhere.

### `PUBMED_API_KEY`

Low-impact rotation; no user-visible effect. Just refresh in NCBI
account → Secrets Manager → ECS redeploy.

### Database password

Use AWS RDS's "modify master password" flow. RDS rotates without restart
on PostgreSQL. Update `DATABASE_URL` in Secrets Manager + ECS redeploy.

### Tauri / Apple signing keypairs

These live in **GitHub Actions repository Secrets**, not AWS:

- `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PUBLIC_KEY` /
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — generated with
  `tauri signer generate -w ~/.tauri/myapp.key`
- `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` /
  `APPLE_SIGNING_IDENTITY` / `APPLE_TEAM_ID` / `APPLE_ID` /
  `APPLE_PASSWORD`

After rotation, the next push to `humanovo` rebuilds installers signed
with the new key. **Existing installed apps trust the public half**;
rotating the keypair invalidates auto-updates for users on the old
public key. Don't rotate without a coordinated re-release.

## A3 KG migration ops

The Neo4j → Postgres migration is mid-execution per
`docs/planning/A3_NEO4J_TO_PGVECTOR_PLAN.md`. Phase-aware procedures:

### Backfill (Phase 2)

```bash
# Dry run first
python -m scripts.backfill_kg_to_postgres --dry-run

# Real run (idempotent — safe to interrupt + resume)
python -m scripts.backfill_kg_to_postgres --page-size 2000
```

Run inside an ECS one-shot task or a long-lived bastion. Logs progress
every 1000 nodes / edges. The script uses deterministic UUID5 derivation
so re-runs hit the same Postgres rows (no duplication).

### Verify parity (Phase 3 gate)

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://api.humanovo.net/api/v1/admin/kg-parity
```

Returns `{ postgres: {...}, neo4j: {...}, delta_*: ..., in_parity: bool }`.
Flip `KG_BACKEND` only when `in_parity: true`.

### Flip read backend (Phase 3)

Set `KG_BACKEND=postgres` in AWS Secrets Manager + ECS redeploy. Reads
flip instantly. Writes still go to Neo4j with Postgres mirror via
Phase 2 dual-write.

### Escape hatch

```bash
# Set KG_BACKEND back to neo4j and force redeploy
aws ecs update-service --force-new-deployment ...
```

Reverts in seconds. Phase 2 dual-write means Postgres can lag during the
revert window but doesn't corrupt.

## Incident response

### Step 1 — confirm scope

- One user or all users? Check Sentry for the error fingerprint.
- One endpoint or system-wide? `curl /api/v1/health/full` returns
  per-component status — DB / Stripe / sources / version.
- Is this a deploy regression? `gh run list` correlates incident
  timestamp with the most recent deploy.

### Step 2 — freeze deploys

```bash
# In the repo
git tag freeze-<utc-iso-timestamp>
git push origin freeze-<utc-iso-timestamp>
```

Tell the team in Slack. No new merges to `humanovo` until cleared.

### Step 3 — diagnose

- **5xx surge**: ECS task logs (`aws logs tail`) — look for stack
  traces and rate-limit ceilings.
- **Slow read**: `/api/v1/admin/kg-parity` if KG-related;
  `pg_stat_statements` for general DB hot-spots.
- **Stripe 4xx storm**: webhook signature mismatch; recheck rotation
  state.

### Step 4 — fix or roll back

If the fix is < 30 minutes: write it, ship it, monitor.

If unclear: roll back via the older successful workflow run (see
"Backend deploy" above). Fix forward later in a calm context.

### Step 5 — post-incident

- File a fix-forward issue if rolled back.
- Write a one-pager: timeline, what surfaced it, what made it land in
  prod, what would prevent it next time.
- Land that pager + any code changes in a follow-up PR.

## Backup and restore

### PostgreSQL

RDS automated snapshots: daily, 7-day retention. Manual snapshot before
risky migration:

```bash
aws rds create-db-snapshot \
  --db-instance-identifier humanovo-prod \
  --db-snapshot-identifier pre-migration-$(date +%Y%m%d-%H%M)
```

Restore (test in staging first):

```bash
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier humanovo-restored \
  --db-snapshot-identifier <snapshot-id>
```

### pgvector indexes

HNSW indexes rebuild ~10 min per million vectors on the embedding column.
Plan for the rebuild window when restoring.

### Neo4j (during A3 transition only)

`docker compose exec neo4j neo4j-admin database dump` for local; AuraDB
backups handled by Neo4j. Once A3 Phase 5 lands, neither matters.

## Cost monitoring

- **AWS Cost Explorer**: tag resources with `Project=humanovo`. ECS +
  RDS + CloudFront + Lambda are the meaningful lines.
- **LLM costs**: `/api/v1/pipeline-intelligence/costs/summary` aggregates
  by model + day. Per-user cost-cap circuit breakers (Stage 4 of
  PATH_TO_100_PERCENT.md) refuse overage requests with 429 — check this
  endpoint when a user reports "discovery won't start".
- **Stripe revenue**: Stripe Dashboard MRR + churn; not exposed in app.

## See also

- `DEVELOPMENT.md` — cold-start setup, daily commands, env vars.
- `docs/planning/NEXT_SESSION.md` — agent / contributor handoff state.
- `docs/planning/PATH_TO_100_PERCENT.md` — full roadmap.
- `docs/planning/CI_GOTCHAS.md` — known CI failure modes + fixes.
- `docs/planning/SECURITY.md` — threat model.
- `docs/planning/A3_NEO4J_TO_PGVECTOR_PLAN.md` — KG migration plan.
- `CHANGELOG.md` — per-commit engineering log.
