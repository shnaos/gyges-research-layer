#!/usr/bin/env tsx
/**
 * GRL Mock Boundary Audit — Sprint 31
 *
 * Read-only, local, deterministic. NO network, NO upload, NO telemetry.
 *
 * Enforces the mock / metadata-only / real-transport boundary by scanning core
 * source at runtime and exiting non-zero on violation (CI-usable). It is NOT a
 * hardcoded findings table — the allowlist below is the single source of truth
 * for "where real network egress is permitted in @gyges/core".
 *
 * Invariants:
 *  1. The ONLY file in `packages/core/src` permitted to call `fetch(` is the
 *     SearXNG transport adapter. Any other core `fetch(` is a hidden transport.
 *  2. The network-isolation engine is metadata-only: it contains no network
 *     primitive (fetch/http/net/tls/dns/WebSocket). Relays/routes are logical.
 *  3. No `axios`/`node-fetch`/`undici` anywhere in core or server src.
 *
 * Run: npm run audit:mocks
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname: string = path.dirname(fileURLToPath(import.meta.url));
const ROOT: string = path.resolve(__dirname, '..');

type Check = { ok: boolean; message: string };
const checks: Check[] = [];
const pass = (m: string) => checks.push({ ok: true, message: `✓ ${m}` });
const fail = (m: string) => checks.push({ ok: false, message: `✗ ${m}` });

/** Recursively list .ts files under a dir, skipping dist/node_modules/test. */
function listTs(dir: string): string[] {
  const out: string[] = [];
  const abs: string = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel: string = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'node_modules' || entry.name === 'test') continue;
      out.push(...listTs(rel));
    } else if (entry.name.endsWith('.ts')) {
      out.push(rel);
    }
  }
  return out;
}

// ─── 1: real fetch in core only inside the SearXNG adapter ───

const FETCH_ALLOWLIST: Set<string> = new Set([
  'packages/core/src/transports/searxng/adapter.ts'
]);

const coreFiles: string[] = listTs('packages/core/src');
for (const f of coreFiles) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (/\bfetch\s*\(/.test(src) && !FETCH_ALLOWLIST.has(f)) {
    fail(`unexpected fetch() in core: ${f} (hidden transport — add to allowlist only if intentional)`);
  }
}
const searxngAdapter: string = 'packages/core/src/transports/searxng/adapter.ts';
if (fs.existsSync(path.join(ROOT, searxngAdapter)) && /\bfetch\s*\(/.test(fs.readFileSync(path.join(ROOT, searxngAdapter), 'utf8'))) {
  pass('the only real fetch() in @gyges/core is the SearXNG adapter (the single real transport)');
} else {
  fail('expected the SearXNG adapter to be the one real transport in core');
}

// ─── 2: network-isolation engine is metadata-only ───

const NI_FILES: string[] = listTs('packages/core/src/network-isolation');
const NET_RE: RegExp = /\bfetch\s*\(|\bhttps?\.request\s*\(|\bnet\.connect\s*\(|\btls\.connect\s*\(|\bnew\s+WebSocket\b|from\s+['"]node:dns['"]/;
let niClean: boolean = true;
for (const f of NI_FILES) {
  if (NET_RE.test(fs.readFileSync(path.join(ROOT, f), 'utf8'))) {
    fail(`network-isolation must be metadata-only but ${f} contains a network primitive`);
    niClean = false;
  }
}
if (niClean) pass('network-isolation layer is metadata-only (no network primitive in any file)');

// ─── 3: no axios/node-fetch/undici in core or server ───

const allSrc: string[] = [...listTs('packages/core/src'), ...listTs('apps/grl-server/src')];
let depClean: boolean = true;
for (const f of allSrc) {
  if (/\b(axios|node-fetch|undici)\b/.test(fs.readFileSync(path.join(ROOT, f), 'utf8'))) {
    fail(`forbidden HTTP client referenced in ${f}`);
    depClean = false;
  }
}
if (depClean) pass('no axios/node-fetch/undici in core or server src (only the platform fetch is used)');

// ─── Report ───

process.stdout.write('\nGRL Mock Boundary Audit (Sprint 31)\n');
process.stdout.write('─'.repeat(60) + '\n');
for (const c of checks) process.stdout.write(`  ${c.message}\n`);
const failed: Check[] = checks.filter((c) => !c.ok);
process.stdout.write('─'.repeat(60) + '\n');
if (failed.length > 0) {
  process.stdout.write(`✗ ${failed.length} mock-boundary invariant(s) violated.\n`);
  process.exit(1);
}
process.stdout.write('✓ All mock-boundary invariants hold.\n');
process.exit(0);
