/**
 * Sprint 31 — Production-readiness / mock-boundary guard tests.
 *
 * These tests codify audit invariants so the active runtime cannot silently
 * drift. They do NOT add features. Two of them characterize a KNOWN GAP
 * (behavioral/persona/temporal privacy layers do not run on the real `execute`
 * path) — that is a documented gap (see docs/audits/production-readiness.md),
 * NOT an intended guarantee.
 *
 * Test transport note: the HTTP cases run against the in-process app with the
 * default (mock) transport — they are NOT a live end-to-end SearXNG run.
 */

import { AddressInfo } from 'node:net';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RUNTIME_CONFIG,
  type RuntimeConfig,
  type RuntimeConfigSnapshot,
  type RuntimeConfigEvent,
  type TransportPolicyRule
} from '../../../packages/core/src/index.js';
import { deepClone, createSnapshot } from '../../../packages/core/src/runtime-config/snapshot.js';
import type { RuntimeConfigLoader } from '../../../packages/core/src/runtime-config/loader.js';
import { TransportPolicyEngine } from '../../../packages/core/src/transport-policy/engine.js';
import {
  buildBootstrapFirewall,
  buildMockExecutionEngine,
  createLocalApiApp,
  DEFAULT_HOST
} from '../src/local-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

async function startApp(): Promise<{ base: string }> {
  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    executionEngine: buildMockExecutionEngine()
  }) as express.Express;
  const server = app.listen(0, DEFAULT_HOST);
  await new Promise<void>((r) => server.once('listening', r));
  const address = server.address() as AddressInfo;
  cleanups.push(() => server.close());
  return { base: `http://${DEFAULT_HOST}:${address.port}` };
}

async function startMockSearXng(): Promise<string> {
  const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ query: 'probe', results: [{ title: 'T', url: 'https://example.com', content: 'C' }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  cleanups.push(() => server.close());
  return `http://127.0.0.1:${port}`;
}

function makeStubLoader(snapshot: RuntimeConfigSnapshot): RuntimeConfigLoader {
  const listeners: Array<(e: RuntimeConfigEvent) => void> = [];
  return {
    getSnapshot: () => snapshot, loadFromFile: () => snapshot, reload: () => snapshot,
    getPath: () => undefined, validate: (c: unknown) => c as RuntimeConfig,
    clear: () => {}, watch: () => {}, stopWatching: () => {},
    addEventListener: (l: (e: RuntimeConfigEvent) => void) => { listeners.push(l); },
    removeEventListener: (l: (e: RuntimeConfigEvent) => void) => {
      const i = listeners.indexOf(l); if (i !== -1) listeners.splice(i, 1);
    }
  } as unknown as RuntimeConfigLoader;
}

async function startAppWithSearXng(): Promise<{ base: string }> {
  const searxngBaseUrl = await startMockSearXng();
  const cfg: RuntimeConfig = { ...deepClone(DEFAULT_RUNTIME_CONFIG), transports: { searxng: { baseUrl: searxngBaseUrl, timeoutMs: 2000, maxResults: 5, enabled: true } } };
  const snapshot = createSnapshot(cfg, Date.now());
  const transportPolicyEngine = new TransportPolicyEngine();
  for (const rule of cfg.transportPolicies as TransportPolicyRule[]) transportPolicyEngine.registerRule(rule);
  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    executionEngine: buildMockExecutionEngine(),
    transportPolicyEngine,
    runtimeConfigLoader: makeStubLoader(snapshot)
  }) as express.Express;
  const server = app.listen(0, DEFAULT_HOST);
  await new Promise<void>((r) => server.once('listening', r));
  const address = server.address() as AddressInfo;
  cleanups.push(() => server.close());
  return { base: `http://${DEFAULT_HOST}:${address.port}` };
}

function post(base: string, p: string, body: unknown) {
  return fetch(`${base}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));
}

const ALLOW_BODY = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'search',
  riskLevel: 'low',
  input: 'audit reality probe'
};
const sources = (json: any): string[] =>
  (json.runtimePolicy?.signals ?? []).map((s: any) => s.source);

// ---------------------------------------------------------------------------
// No hidden transport in the active runtime
// ---------------------------------------------------------------------------

describe('active runtime has no hidden transport', () => {
  const localApi = fs.readFileSync(
    path.join(ROOT, 'apps/grl-server/src/local-api.ts'),
    'utf8'
  );

  it('local-api.ts performs no direct network I/O', () => {
    expect(localApi).not.toMatch(/\bfetch\s*\(/);
    expect(localApi).not.toMatch(/\bhttps?\.request\s*\(/);
    expect(localApi).not.toMatch(/\bnet\.connect\s*\(/);
    expect(localApi).not.toMatch(/\btls\.connect\s*\(/);
    expect(localApi).not.toMatch(/\bnew\s+WebSocket\b/);
    expect(localApi).not.toMatch(/from\s+['"]node:dns['"]/);
    expect(localApi).not.toMatch(/\b(axios|node-fetch|undici)\b/);
  });

  it('local-api.ts does not wire the legacy SOCKS transport-router or legacy adapter', () => {
    expect(localApi).not.toContain('packages/transport-router');
    expect(localApi).not.toContain('packages/search-adapter-searxng');
  });
});

// ---------------------------------------------------------------------------
// execute / execute-mock pipeline reality
// ---------------------------------------------------------------------------

describe('execute pipeline reality', () => {
  // Sprint 29 guarantee: the SHARED gate sources appear on BOTH endpoints.
  it('shared gate sources are present on both execute and execute-mock', async () => {
    const { base } = await startAppWithSearXng();
    const mock = await post(base, '/v1/capabilities/execute-mock', ALLOW_BODY);
    const real = await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    const realSet = new Set(sources(real.json));
    const mockSet = new Set(sources(mock.json));
    // `sandbox` is intentionally excluded: it is emitted only when the execution
    // engine returns a sandbox verdict, which the mock transport does not on the
    // allowed path — so it is conditional, not a guaranteed shared source.
    for (const s of [
      'capability_graph', 'multi_agent', 'trust_reputation', 'capability_firewall',
      'transport_policy', 'privacy_boundary', 'transport_fingerprint',
      'network_isolation'
    ]) {
      expect(realSet.has(s)).toBe(true);
      expect(mockSet.has(s)).toBe(true);
    }
  });

  // Sprint 32 CONVERGENCE — the Sprint 31 KNOWN GAP is now CLOSED. The
  // behavioral-privacy, persona-isolation, and temporal-obfuscation gates run on
  // the real `execute` path via the shared runPrivacyPipeline helper, with real
  // engine mutations (not metadata-only). This test now asserts PRESENCE on both
  // endpoints — the inverse of the Sprint 31 gap assertion.
  it('CONVERGED: behavioral/persona/temporal run on execute (and execute-mock)', async () => {
    const { base } = await startApp();
    const mock = await post(base, '/v1/capabilities/execute-mock', ALLOW_BODY);
    const real = await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    const mockSet = new Set(sources(mock.json));
    const realSet = new Set(sources(real.json));
    for (const s of ['behavioral_privacy', 'persona_isolation', 'temporal_obfuscation']) {
      expect(mockSet.has(s)).toBe(true);
      expect(realSet.has(s)).toBe(true); // now PRESENT on the real path
    }
  });
});

// ---------------------------------------------------------------------------
// audit invariant scripts are green (executable invariants, not prose)
// ---------------------------------------------------------------------------

describe('audit invariant scripts pass', () => {
  for (const script of ['scripts/audit-runtime-coherence.ts', 'scripts/audit-mock-boundaries.ts']) {
    it(`${script} exits 0`, () => {
      // Read-only, local, no network. Throws (non-zero exit) on violation.
      // Use the locally-installed tsx binary (not `npx`, which could reach the
      // registry on a cold cache).
      const tsx = path.join(ROOT, 'node_modules/.bin/tsx');
      expect(() =>
        execFileSync(tsx, [script], { cwd: ROOT, stdio: 'pipe' })
      ).not.toThrow();
    });
  }
});
