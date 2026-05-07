# Tenant Isolation Gap — Platform-Shared Models

**Status:** open · **Severity:** medium-high · **First flagged:** Round 8, May 2026

## What

Six clinical/research-domain ORM models lack an `owner_id` (or `lab_id` /
`tenant_id`) column. Mutating endpoints on these models authenticate the
caller via `dependencies=AUTH_REQUIRED` but do not check that the row
the caller is mutating actually belongs to them.

Affected models (in `app/models/platform_entities.py`):

| Model            | Endpoint paths affected                                                |
| ---------------- | ---------------------------------------------------------------------- |
| `BiobankSample`  | `/biobank/samples/{sample_id}` PATCH/DELETE/POST/checkout              |
| `ClinicalTrial`  | `/clinical-trials/{trial_id}` PATCH/DELETE + nested subjects + budgets |
| `IRBSubmission`  | `/regulatory/irb/{irb_id}` DELETE + companion forms/agreements         |
| `MLModel`        | `/ml-models/{model_id}` PATCH/DELETE                                   |
| `ImagingStudy`   | `/imaging/studies/{study_id}` DELETE + annotations                     |
| `Manuscript`     | `/manuscripts/{manuscript_id}` PATCH/DELETE + author management        |

Total: **~39 mutating endpoints** found by the static audit run in
Round 8 phase 2.

## Why it matters

A logged-in user on the Trial / Researcher tier can mutate or delete
any other user's clinical trial, biobank sample, manuscript, ML model,
imaging study, or IRB submission by guessing the UUID. UUIDs are not a
security boundary; they're just hard to enumerate.

For Lab / Institution tiers the design intent is shared lab-level
ownership, so the fix needs to be lab-aware rather than user-aware in
those tiers. The shared-model-with-no-owner pattern conflates "lab-
shared" and "globally readable."

## Fix shape

This is a multi-day migration with three pieces:

1. **Schema:** add `owner_id UUID NOT NULL REFERENCES users(id)` to each
   of the 6 tables. For Lab/Institution tier, add a `lab_id UUID
   REFERENCES labs(id)` column and a row-level filter helper that
   widens to "owner OR same-lab" when the caller is on Lab+ tier.
2. **Backfill:** infer the original creator from existing FK columns
   (e.g. `BiobankSample.project.owner_id` if `project_id` exists) and
   write that as `owner_id`. Document any rows that can't be backfilled
   (admin / seed data) with a `system` placeholder user.
3. **Code:** swap each `db.get(Model, id)` for the existing
   `fetch_owned_or_404(db, Model, id, current_user)` helper used by
   the endpoints already on this pattern (citation_folders, projects,
   notebook_pages, evidence). The helper already handles 404-not-403
   for cross-tenant access.

## Why deferred

The fix is not technically complex — `fetch_owned_or_404` is already
the codebase pattern — but the migration needs the schema change to
land first, and the backfill needs to be tested against real data
shapes, which means it's gated on the backend bootstrap workflow that
hasn't run yet.

In the meantime, the endpoints sit behind `AUTH_REQUIRED` so an
unauthenticated attacker cannot exploit them. The exposure is
authenticated cross-tenant access only.

## Adjacent issues already fixed (Round 8 phase 2)

* `/v1/user/{user_id}/budget` — fixed in `user_budget.py`. Caller now
  must equal `path.user_id` or be admin; returns 404 otherwise.
* `/v1/kg/documents/{document_id}/permission`,
  `/v1/kg/user/{user_id}/royalties`,
  `/v1/kg/user/{user_id}/kg/overview` — fixed in `kg_permissions.py`.
  Same `_ensure_self_or_admin` guard, same 404-not-403 pattern.

## Tracking

Reopen this doc when the backend is bootstrapped and the schema-
migration window opens. Touch the `Status` line and add a section per
model as it's migrated. Close when all six models carry `owner_id`
and `fetch_owned_or_404` is the only path through their mutating
endpoints.
