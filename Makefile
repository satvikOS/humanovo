# humanovo top-level Makefile
#
# One place that knows the canonical local checks. Wraps the per-tree
# tooling (ruff for backend, tsc + eslint for frontend, actionlint +
# verify-action-shas for workflows) so a single command surfaces what
# CI will see. Adding a new check here means the dev only has to learn
# it once, not three trees.
#
# Conventions:
#   - Targets are .PHONY unless they produce a build artifact.
#   - Each target prints its name as a banner so multi-target output
#     is parseable.
#   - Targets exit non-zero on any failure (CI semantics, not "fail
#     soft").
#   - No silent side-effects: anything that mutates files lives under
#     `format`, never under `lint` / `test` / `ci`.

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

BACKEND_DIR := backend
FRONTEND_DIR := frontend
LANDING_DIR := landing

# ─── Default ─────────────────────────────────────────────────────────

.PHONY: help
help:
	@echo "humanovo — common dev commands"
	@echo ""
	@echo "  make lint        # backend ruff + frontend tsc/eslint + actionlint"
	@echo "  make test        # backend pytest (offline-tolerant)"
	@echo "  make format      # auto-fix backend + frontend formatting"
	@echo "  make ci          # everything CI runs, in order"
	@echo "  make ci-full     # ci + landing build"
	@echo "  make ci-actions  # SHA-pin verifier + actionlint only"
	@echo "  make build-landing # next build for the landing page"
	@echo ""
	@echo "Per-tree targets: lint-backend, lint-frontend, lint-actions,"
	@echo "test-backend, format-backend, format-frontend, lint-landing"

# ─── Composite targets ──────────────────────────────────────────────

.PHONY: lint
lint: lint-backend lint-frontend lint-actions
	@echo "✓ All lint checks passed."

.PHONY: test
test: test-backend
	@echo "✓ All tests passed."

.PHONY: format
format: format-backend format-frontend
	@echo "✓ Formatting applied."

.PHONY: ci
ci: lint test
	@echo "✓ CI suite passed."

.PHONY: ci-full
ci-full: lint test build-landing
	@echo "✓ Full CI suite (incl. landing build) passed."

.PHONY: ci-actions
ci-actions: lint-actions
	@echo "✓ Workflow checks passed."

# ─── Backend ────────────────────────────────────────────────────────

.PHONY: lint-backend
lint-backend:
	@echo "── lint-backend (ruff) ──"
	cd $(BACKEND_DIR) && ruff check app/

.PHONY: format-backend
format-backend:
	@echo "── format-backend (ruff --fix) ──"
	cd $(BACKEND_DIR) && ruff check --fix app/ && ruff format app/

.PHONY: test-backend
test-backend:
	@echo "── test-backend (pytest, offline-tolerant) ──"
	cd $(BACKEND_DIR) && python -m pytest tests/ -q --no-header

# ─── Frontend ───────────────────────────────────────────────────────

.PHONY: lint-frontend
lint-frontend:
	@echo "── lint-frontend (tsc + eslint) ──"
	cd $(FRONTEND_DIR) && npx tsc --noEmit
	cd $(FRONTEND_DIR) && npx eslint --ext .tsx,.ts src/

.PHONY: format-frontend
format-frontend:
	@echo "── format-frontend (eslint --fix) ──"
	cd $(FRONTEND_DIR) && npx eslint --fix --ext .tsx,.ts src/

# ─── Landing ────────────────────────────────────────────────────────

.PHONY: lint-landing
lint-landing:
	@echo "── lint-landing (tsc) ──"
	cd $(LANDING_DIR) && npx tsc --noEmit

.PHONY: build-landing
build-landing:
	@echo "── build-landing (next build) ──"
	cd $(LANDING_DIR) && npx next build

# ─── Workflows ──────────────────────────────────────────────────────

.PHONY: lint-actions
lint-actions: verify-action-shas actionlint
	@echo "✓ All workflow checks passed."

.PHONY: verify-action-shas
verify-action-shas:
	@echo "── verify-action-shas (SHA-pin reality check) ──"
	python3 scripts/verify-action-shas.py --quiet

.PHONY: actionlint
actionlint:
	@echo "── actionlint (workflow contract check) ──"
	@if ! command -v actionlint >/dev/null 2>&1; then \
		echo "actionlint not found on PATH — install via:"; \
		echo "  bash scripts/install-actionlint.sh"; \
		exit 1; \
	fi
	actionlint
