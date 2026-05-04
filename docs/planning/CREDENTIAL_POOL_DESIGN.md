# CredentialPool Design

**Status**: design · **Sprint**: 2 / Day 9-12 · **Owner**: TBA · **Lands**: post-AWS-bootstrap

## Problem statement

Today every upstream provider call (Bedrock, Azure OpenAI, Azure AI, NCBI) uses a single static credential pulled from `settings.*_KEY`. Three failure modes:

1. **Single point of rate-limit failure** — when one user's discovery run saturates the per-key quota, every other user's pipeline stalls until the window resets.
2. **No graceful failover** — a 401 (revoked key), 429 (rate-limited), or 503 (provider outage) propagates as a hard error to the discovery orchestrator, crashes the run, and forces the user to manually retry.
3. **Manual rotation** — when SOC 2 / HIPAA prep wants quarterly rotation, an engineer has to walk every provider's portal, generate a new key, update Secrets Manager, and pray nothing in flight breaks. There's no grace overlap, so any in-flight call holding the old key fails.

`CredentialPool` solves all three with the multi-key broker pattern that's standard for production SaaS handling LLM/API quotas.

## Requirements

From the Day-2 audit + user clarification (2026-05-04):

- **Per-provider pool** of N keys, each with independent rate-limit accounting.
- **Healthy-key picker** that prefers keys with available rate budget; falls over on 429/401/503.
- **Quarterly auto-rotation** by default, configurable per pool (some customer BAAs ask for weekly).
- **7-day grace overlap** — when a new key is issued, the old key remains valid for 7 days so in-flight calls never die mid-request.
- **Emergency revoke** — admin endpoint that hard-revokes a key in <60s regardless of schedule.
- **Scale with users** — pool size is config; ops adds keys without code changes; broker auto-discovers.
- **Per-tenant accounting** — each call records `(tenant_id, provider, key_id, tokens_in, tokens_out)` for billing/cost-attribution.
- **No code knowledge of which key is in use** — the broker's choice is opaque to callers.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Backend service (e.g. discovery_orchestrator)                   │
│                                                                 │
│   pool = get_pool("bedrock_claude_opus")                        │
│   async with pool.acquire(tenant_id) as cred:                   │
│       resp = await call_bedrock(cred.api_key, ...)              │
│       cred.record_usage(tokens_in=N, tokens_out=M)              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ CredentialPool (in-process, per worker)                         │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Pool state (Redis-backed for cross-worker view)            │ │
│  │   keys[]: [{id, status, rpm_used, tpm_used, last_failure}] │ │
│  │   rotation_schedule, grace_overlap_seconds                 │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  acquire() picks the highest-budget healthy key                 │
│  on 429/401/503 → mark degraded, retry next key                 │
│  on emergency_revoke(key_id) → mark revoked, drain in-flight    │
└────────────────────────────┬────────────────────────────────────┘
                             │ reads/writes
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ AWS Secrets Manager                                             │
│                                                                 │
│   humanovo/keys/bedrock_claude_opus/                            │
│     ├─ key-1 (status: active, expires: 2026-08-04)              │
│     ├─ key-2 (status: active, expires: 2026-08-04)              │
│     ├─ key-3 (status: draining, expires: 2026-05-11) ← in grace │
│     └─ ... (N keys total per pool)                              │
└────────────────────────────┬────────────────────────────────────┘
                             │ scheduled
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Rotation Lambda (EventBridge daily cron)                        │
│                                                                 │
│  for each pool:                                                 │
│    if any key.expires_at < now + 7d:                            │
│      generate new key (provider-specific portal API)            │
│      mark old key status=draining, expires=now+7d               │
│      add new key status=active, expires=now+90d                 │
│  for each key with status=draining and expires_at < now:        │
│    mark status=revoked                                          │
│    remove from active rotation                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Module layout

```
backend/app/core/credential_pool.py          # interface + cache + lifecycle
backend/app/core/credential_backends/
    __init__.py
    base.py                                  # CredentialBackend ABC
    mock.py                                  # in-memory; for tests
    secrets_manager.py                       # AWS Secrets Manager backend (lands when AWS access does)
backend/tests/test_credential_pool.py        # unit tests against the mock backend
infrastructure/terraform/credential_pool/    # rotation Lambda + EventBridge + Secrets Manager schema
```

## Per-pool config schema

Stored as a single JSON document at `humanovo/keys/_config` in Secrets Manager. Lambda reads at start; pool re-reads every 60s.

```json
{
  "pools": {
    "bedrock_claude_opus": {
      "rotation_cadence_days": 90,
      "grace_overlap_days": 7,
      "min_pool_size": 2,
      "rpm_per_key": 200,
      "tpm_per_key": 2000000,
      "provider_metadata": {"region": "us-east-1", "model_id": "<set-server-side>"}
    },
    "azure_gpt4_1": {
      "rotation_cadence_days": 90,
      "grace_overlap_days": 7,
      "min_pool_size": 2,
      "rpm_per_key": 60,
      "tpm_per_key": 800000
    },
    "ncbi_pubmed": {
      "rotation_cadence_days": 365,
      "grace_overlap_days": 30,
      "min_pool_size": 1,
      "rpm_per_key": 600,
      "tpm_per_key": null
    }
  }
}
```

## Failure modes and recovery

| Failure | Detection | Action | User impact |
|---|---|---|---|
| Key returns 401 (revoked at provider) | broker.acquire() → upstream call → 401 | Mark `status=revoked`, remove from rotation, log alarm; retry on next healthy key | None (transparent retry) |
| Key returns 429 (rate-limited) | upstream call → 429 | Mark `cooldown_until=now+retry_after`, skip this key for that window; retry on next healthy key | None (transparent failover) |
| Provider returns 503 (outage) | upstream call → 503 | Mark `cooldown_until=now+30s`, retry next key; if all keys 503 → degraded → upstream_unavailable error to user | User sees "service temporarily unavailable" via `safe_error` |
| Lambda fails to rotate | EventBridge invocation logs | CloudWatch alarm; admin notified; pool continues with existing keys (which are still valid until their `expires_at`) | None until grace expires |
| All keys expired (rotation broken for >grace_overlap) | broker.acquire() → no healthy key | Pool returns `PoolExhausted` exception → maps to `ErrorCode.UPSTREAM_UNAVAILABLE` | User sees retry-shortly message; pages on-call |
| Emergency revoke | admin endpoint `POST /admin/keys/{key_id}/revoke` | Mark `status=revoked` in Secrets Manager; broker re-reads config within 60s | None (transparent) |

## Acquire flow (pseudocode)

```python
async def acquire(self, tenant_id: str) -> Credential:
    """Pick a healthy key with available budget. Raises PoolExhausted if none."""
    candidates = [
        k for k in self._keys
        if k.status == "active"
        and (k.cooldown_until is None or k.cooldown_until < now())
        and k.rpm_used < k.rpm_limit * 0.95
    ]
    if not candidates:
        # Try draining keys as a last resort (still valid; just being phased out).
        candidates = [k for k in self._keys if k.status == "draining"]
    if not candidates:
        raise PoolExhausted(self.pool_name)

    # Prefer the key with the most remaining budget.
    chosen = max(candidates, key=lambda k: (k.rpm_limit - k.rpm_used))
    chosen.rpm_used += 1
    self._record_acquisition(tenant_id, chosen.id)
    return Credential(api_key=chosen.api_key, key_id=chosen.id, pool=self)
```

## Rotation flow (pseudocode)

```python
def rotate_pool(pool_name: str, config: PoolConfig) -> None:
    """Run from the Lambda once per day per pool. Idempotent."""
    keys = secretsmanager.list("humanovo/keys/" + pool_name + "/")
    grace_threshold = now() + timedelta(days=config.grace_overlap_days)

    # Step 1: any key expiring within grace_overlap_days needs a successor NOW.
    expiring = [k for k in keys if k.status == "active" and k.expires_at < grace_threshold]
    for old in expiring:
        new_key_value = provision_new_key_at_provider(pool_name)  # provider-specific
        secretsmanager.put(
            f"humanovo/keys/{pool_name}/key-{uuid7()}",
            value=new_key_value,
            tags={"status": "active", "expires_at": (now() + timedelta(days=config.rotation_cadence_days)).isoformat()},
        )
        secretsmanager.update(old.path, tags={"status": "draining", "expires_at": grace_threshold.isoformat()})

    # Step 2: any draining key past its expires_at is revoked + removed from rotation.
    drained = [k for k in keys if k.status == "draining" and k.expires_at < now()]
    for d in drained:
        revoke_key_at_provider(pool_name, d.api_key)  # provider-specific
        secretsmanager.update(d.path, tags={"status": "revoked"})

    # Step 3: ensure pool size >= min_pool_size with active keys.
    active_count = sum(1 for k in keys if k.status == "active")
    while active_count < config.min_pool_size:
        new_key_value = provision_new_key_at_provider(pool_name)
        secretsmanager.put(...)
        active_count += 1
```

## Provider-specific key provisioning

Each provider has different rotation mechanics:

| Provider | API for issuing new key | Notes |
|---|---|---|
| AWS Bedrock | n/a — uses IAM creds, not API keys | Use STS-vended short-lived sessions per acquire instead of long-lived keys; rotation is automatic |
| Azure OpenAI | `regenerateKey` Cognitive Services API | Each Azure resource has 2 key slots; rotation is "regenerate slot N while keeping slot N+1 live" |
| Azure AI Foundry | Same as Azure OpenAI | Same |
| NCBI E-utilities | Manual via NCBI account dashboard | No API for issuance; rotation Lambda **alerts admin** to manually replace; pool continues with existing |
| Brave Search | Removed for v1 | n/a |

For v1 the Bedrock path is special-cased: instead of pooling long-lived keys, the broker hands out STS sessions vended via IAM role assume-role, and the `rpm_used`/`tpm_used` accounting still applies. Means rotation for Bedrock is effectively automatic (15-minute STS expiry).

## Cost-attribution data flow

Every `acquire` records `(timestamp, tenant_id, pool_name, key_id)` in a Postgres `credential_acquisitions` table. The orchestrator's stage emits `(token_in, token_out, completion_tokens)` to the same row on completion. Aggregations land in `tenant_cost_summary` for billing and per-tenant quota enforcement.

This is also the substrate for the per-user budget enforcer (`backend/app/agents/discovery_orchestrator.py:233 TokenPool`) — it stops being a single counter and becomes a per-tenant counter against per-pool budgets.

## Test plan

- Unit: mock backend, broker picks healthy key, fails over on 429, raises PoolExhausted on no healthy keys, records acquisition, drains correctly, emergency revoke completes <100ms in-process.
- Integration: rotation Lambda creates new keys, marks old as draining, removes after grace, idempotent across runs.
- Chaos: kill 50% of keys mid-pipeline-run; verify the run completes via failover with no client-visible failure.
- Load: 100 concurrent tenants × 10 discovery runs × 12 stages → verify no key is over-utilized while others sit idle.

## Dependencies

- AWS Secrets Manager (provisioned in Sprint 1 / D2-3)
- IAM role for the Lambda with `secretsmanager:CreateSecret`, `:UpdateSecret`, `:GetSecretValue`, `:DeleteSecret` scoped to `humanovo/keys/*`
- EventBridge schedule (`cron(0 2 * * ? *)` — daily at 02:00 UTC)
- CloudWatch Log group for the Lambda + alarms on rotation failures
- Provider-specific IAM/role for issuing new keys (Bedrock STS, Azure ARM read+write on Cognitive Services)

## Phases

1. **Sprint 2 / D9** — Land `credential_pool.py` interface + mock backend + 12 unit tests. (No AWS calls yet.)
2. **Sprint 2 / D10** — Land Secrets Manager backend, manually populate keys for one pool (Bedrock), wire one orchestrator stage to use it.
3. **Sprint 2 / D11** — Wire all stages, add per-tenant accounting, ship to dev.
4. **Sprint 2 / D12** — Rotation Lambda + EventBridge + admin emergency-revoke endpoint.
5. **Sprint 3** — Quality regression: validate that a single-key revocation mid-pipeline doesn't fail any user-visible call.
