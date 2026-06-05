#!/usr/bin/env bash
# GRL Quickstart — Local Runtime
#
# Starts the GRL local API server with the default profile.
# No Internet access required. No secrets. No SearXNG needed for health check.
#
# Usage:
#   chmod +x examples/quickstart/local-runtime.sh
#   ./examples/quickstart/local-runtime.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "────────────────────────────────────────────"
echo "GRL Local Runtime — Quickstart"
echo "────────────────────────────────────────────"
echo ""

# 1. Check Node.js version
NODE_VERSION="$(node --version 2>/dev/null || echo 'not found')"
echo "Node.js: ${NODE_VERSION}"
if [[ "${NODE_VERSION}" == "not found" ]]; then
  echo "ERROR: Node.js is not installed. Please install Node.js 20 or later."
  exit 1
fi

# 2. Install dependencies if needed
if [[ ! -d "${REPO_ROOT}/node_modules" ]]; then
  echo ""
  echo "Installing root dependencies..."
  cd "${REPO_ROOT}" && npm install
fi

if [[ ! -d "${REPO_ROOT}/apps/grl-cli/node_modules" ]]; then
  echo ""
  echo "Installing grl-cli dependencies..."
  cd "${REPO_ROOT}" && npm --prefix apps/grl-cli install
fi

# 3. Build if dist doesn't exist
if [[ ! -f "${REPO_ROOT}/apps/grl-server/dist/index.js" ]]; then
  echo ""
  echo "Building packages..."
  cd "${REPO_ROOT}" && npm run build
fi

# 4. Launch the local API server
echo ""
echo "Starting GRL local API server on 127.0.0.1:8787..."
echo "(Press Ctrl+C to stop)"
echo ""

cd "${REPO_ROOT}"
exec npm run dev:server
