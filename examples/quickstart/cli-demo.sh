#!/usr/bin/env bash
# GRL CLI Demo
#
# Demonstrates the GRL CLI operator interface.
# Requires the GRL local API server to be running on 127.0.0.1:8787.
#
# Start the server first:
#   npm run dev:server
#
# Then run this script:
#   chmod +x examples/quickstart/cli-demo.sh
#   ./examples/quickstart/cli-demo.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "────────────────────────────────────────────"
echo "GRL CLI Demo"
echo "────────────────────────────────────────────"
echo ""
echo "Requires: npm run dev:server (127.0.0.1:8787)"
echo ""

cd "${REPO_ROOT}"

# Build CLI if needed
if [[ ! -f "apps/grl-cli/dist/cli.js" ]]; then
  echo "Building CLI..."
  npm run build:cli
  echo ""
fi

# ── Health check ──────────────────────────────────────────────────────────────
echo "── 1. Health check ──"
npm run cli -- health
echo ""

# ── Search (mock transport) ───────────────────────────────────────────────────
echo "── 2. Search (mock transport, no real network) ──"
npm run cli -- search "privacy research"
echo ""

# ── Audit events ──────────────────────────────────────────────────────────────
echo "── 3. Recent audit events ──"
npm run cli -- audit
echo ""

# ── Trust profiles ────────────────────────────────────────────────────────────
echo "── 4. Trust profiles ──"
npm run cli -- trust
echo ""

# ── Runtime profile ───────────────────────────────────────────────────────────
echo "── 5. Active runtime profile ──"
npm run cli -- runtime profile
echo ""

# ── Transports ────────────────────────────────────────────────────────────────
echo "── 6. Available transports ──"
npm run cli -- transports
echo ""

echo "────────────────────────────────────────────"
echo "CLI demo complete."
echo "────────────────────────────────────────────"
