#!/usr/bin/env bash
# Install actionlint locally so `make lint-actions` can run it.
#
# Pins to the same version the verify-actions workflow uses, so a
# clean local run sees the same findings as the CI job. Installs
# into ~/.local/bin so no sudo is required.
set -euo pipefail

VERSION="${ACTIONLINT_VERSION:-1.7.9}"
BIN_DIR="${HOME}/.local/bin"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

mkdir -p "${BIN_DIR}"

echo "Installing actionlint v${VERSION} -> ${BIN_DIR}"

curl -fsSL --retry 3 --retry-delay 2 \
  "https://raw.githubusercontent.com/rhysd/actionlint/v${VERSION}/scripts/download-actionlint.bash" \
  -o "${TMP_DIR}/download-actionlint.bash"

bash "${TMP_DIR}/download-actionlint.bash" "${VERSION}" "${BIN_DIR}"

if ! command -v actionlint >/dev/null 2>&1; then
  echo
  echo "actionlint installed at ${BIN_DIR}/actionlint, but the dir is not on PATH."
  echo "Add it with:"
  echo "  echo 'export PATH=\"\${HOME}/.local/bin:\${PATH}\"' >> ~/.bashrc"
  echo "  source ~/.bashrc"
  exit 0
fi

echo "✓ actionlint $(actionlint -version | head -1) on PATH"
