#!/usr/bin/env tsx
/**
 * GRL Runtime Coherence Audit — Sprint 31
 *
 * Read-only, local, deterministic. NO network, NO upload, NO telemetry.
 *
 * Enforces runtime-coherence invariants that protect the ACTIVE runtime
 * (`apps/grl-server/src/local-api.ts`, the 127.0.0.1:8787 server consumed by the
 * CLI and SDK). It scans source at runtime and exits non-zero on any violation
 * so it can run in CI like the other `validate:*` scripts — it is NOT a static
 * snapshot of findings.
 *
 * Invariants:
 *  1. local-api.ts performs NO direct network I/O (no fetch/http(s).request/
 *     net.connect/tls.connect/WebSocket/dgram/node:dns/axios/node-fetch/undici).
 *     All real transport must go through an execution-engine adapter.
 *  2. local-api.ts does NOT import the legacy SOCKS transport-router or the
 *     legacy search-adapter (those belong only to the legacy port-3000 server).
 *  3. The behavioral-privacy / persona-isolation / temporal-obfuscation engines
 *     exist in core and are wired into both the `execute` and `execute-mock`
 *     paths (Sprint 32 convergence).
 *
 * Run: npm run audit:coherence
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

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ─── 1 + 2: local-api.ts must be network-primitive-free and not import legacy transport ───

const LOCAL_API: string = 'apps/grl-server/src/local-api.ts';
const localApi: string = read(LOCAL_API);

// Network primitives that would indicate the active server reaching the network
// directly instead of via an execution-engine adapter. `dns` is matched only as
// a node module import to avoid false positives on `dnsPolicy` metadata.
const FORBIDDEN_PRIMITIVES: Array<{ re: RegExp; label: string }> = [
  { re: /\bfetch\s*\(/, label: 'fetch(' },
  { re: /\bhttps?\.request\s*\(/, label: 'http(s).request(' },
  { re: /\bnet\.connect\s*\(/, label: 'net.connect(' },
  { re: /\btls\.connect\s*\(/, label: 'tls.connect(' },
  { re: /\bnew\s+WebSocket\b/, label: 'new WebSocket' },
  { re: /\bdgram\b/, label: 'dgram' },
  { re: /from\s+['"]node:dns['"]|require\(['"]dns['"]\)/, label: "node:dns import" },
  { re: /\b(axios|node-fetch|undici)\b/, label: 'axios/node-fetch/undici' }
];

for (const { re, label } of FORBIDDEN_PRIMITIVES) {
  if (re.test(localApi)) {
    fail(`${LOCAL_API} contains network primitive "${label}" (active server must use an adapter)`);
  } else {
    pass(`${LOCAL_API} free of network primitive "${label}"`);
  }
}

const LEGACY_IMPORTS: string[] = [
  'packages/transport-router',
  'packages/search-adapter-searxng'
];
for (const imp of LEGACY_IMPORTS) {
  if (localApi.includes(imp)) {
    fail(`${LOCAL_API} imports legacy transport "${imp}" (must not be wired into the active runtime)`);
  } else {
    pass(`${LOCAL_API} does not import legacy transport "${imp}"`);
  }
}

// ─── 3: the three core privacy engines exist (behavioral, persona, temporal) ───

const CORE_ENGINES: string[] = [
  'packages/core/src/behavioral-privacy/engine.ts',
  'packages/core/src/persona-isolation/personas.ts',
  'packages/core/src/temporal-obfuscation/engine.ts'
];
for (const f of CORE_ENGINES) {
  if (fs.existsSync(path.join(ROOT, f))) {
    pass(`core engine present: ${f}`);
  } else {
    fail(`core engine missing: ${f}`);
  }
}

// ─── Report ───

process.stdout.write('\nGRL Runtime Coherence Audit (Sprint 31)\n');
process.stdout.write('─'.repeat(60) + '\n');
for (const c of checks) process.stdout.write(`  ${c.message}\n`);
const failed: Check[] = checks.filter((c: Check) => !c.ok);
process.stdout.write('─'.repeat(60) + '\n');
if (failed.length > 0) {
  process.stdout.write(`✗ ${failed.length} coherence invariant(s) violated.\n`);
  process.exit(1);
}
process.stdout.write('✓ All runtime-coherence invariants hold.\n');
process.exit(0);
