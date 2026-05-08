# Tenant Isolation Gap — Platform-Shared Models

**Status:** **closed (code-side)** · pending production migration apply
**First flagged:** Round 8, May 2026 · **Closed:** Round 10, May 2026

## Closure summary

* Migration `021_owner_id_on_platform_entities.py` adds `owner_id UUID`
  + FK + index on 12 platform-shared tables: `clinical_trials`,
  `biobank_samples`, `storage_locations`, `irb_submissions`,
  `data_use_agreements`, `consent_forms`, `compliance_checklists`,
  `ml_models`, `imaging_studies`, `manuscripts`, `research_datasets`,
  `saved_analyses`. ON DELETE SET NULL on the FK so user deletion
  doesn't cascade-drop the row.
* ORM (`app/models/platform_entities.py`) declares `owner_id` via
  the shared `_owner_id_column()` helper.
* New helpers in `app/core/ownership.py`:
  - `fetch_owned_directly_or_404(db, Model, row_id, user)` — for
    models with a direct `owner_id` (no transitive Project).
  - `filter_by_owner(query, Model, user)` — adds the WHERE clause.
* All ~50 read/write endpoints across `biobank.py`, `clinical_trials.py`,
  `regulatory.py`, `ml_models.py`, `imaging.py`, `manuscripts.py`,
  `datasets.py`, `statistics.py` rewired to use the new helpers.
  List endpoints filter by owner_id; create endpoints set
  `owner_id=current_user.id`; R/U/D paths route through
  `fetch_owned_directly_or_404` which 404s on cross-tenant access.

The doc stays in the repo as a closure record. Reopen only if a new
platform-shared model is introduced without `owner_id`.

## Original report (kept for context)


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
