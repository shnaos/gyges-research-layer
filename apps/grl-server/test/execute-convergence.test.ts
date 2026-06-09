/**
 * Sprint 32 — Real runtime convergence tests.
 *
 * These verify REAL runtime effects on the `execute` path (not just runtimePolicy
 * metadata): the behavioral/persona/temporal gates run, the temporal delay is
 * actually awaited (bounded, opt-in), and persona/route changes really rotate the
 * session and fingerprint.
 */

import { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TemporalObfuscationEngine,
  NetworkIsolationEngine,
  BehavioralPrivacyEngine
} from '../../../packages/core/src/index.js';
import {
  buildBootstrapFirewall,
  buildMockExecutionEngine,
  createLocalApiApp,
  DEFAULT_HOST
} from '../src/local-api.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

async function startApp(opts: Record<string, unknown> = {}): Promise<{ base: string }> {
  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    executionEngine: buildMockExecutionEngine(),
    ...opts
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
function get(base: string, p: string) {
  return fetch(`${base}${p}`).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));
}

const BODY = {
  agentId: 'local-agent', // the bootstrap firewall only allows local-agent/research
  compartmentId: 'research',
  tool: 'search',
  riskLevel: 'low',
  input: 'convergence probe'
};

/** A temporal engine that recommends a delay as soon as two requests are close. */
function delayingTemporalEngine(): TemporalObfuscationEngine {
  return new TemporalObfuscationEngine({
    now: Date.now,
    cadencePolicy: { enabled: true, minSpacingMs: 500, burstPenaltyMs: 100, maxDelayMs: 1000 }
  });
}

// ---------------------------------------------------------------------------
// Gate convergence: behavioral/persona/temporal really run on execute
// ---------------------------------------------------------------------------

describe('privacy gates run on the real execute path', () => {
  it('emits behavioral/persona/temporal signals on execute', async () => {
    const { base } = await startApp();
    const { json } = await post(base, '/v1/capabilities/execute', BODY);
    const sources = new Set((json.runtimePolicy?.signals ?? []).map((s: any) => s.source));
    expect(sources.has('behavioral_privacy')).toBe(true);
    expect(sources.has('persona_isolation')).toBe(true);
    expect(sources.has('temporal_obfuscation')).toBe(true);
  });

  it('really mutates persona/behavioral state on execute (audit-observable)', async () => {
    const { base } = await startApp();
    await post(base, '/v1/capabilities/execute', BODY);
    // persona_created and a fragment event are emitted only by the engines
    // actually running — not by metadata.
    const personaEvents = await get(base, '/v1/audit/events?type=persona_created');
    expect(personaEvents.json.events.length).toBeGreaterThan(0);
    const fragmentEvents = await get(base, '/v1/audit/events?type=behavior_fragment_created');
    expect(fragmentEvents.json.events.length).toBeGreaterThan(0);
  });
});

  it('behavioral critical correlation now DENIES on the real execute path', async () => {
    // Seed a behavioral engine to critical correlation risk (mirrors the
    // behavioral-privacy-api oracle, but asserts the NEW deny branch on execute).
    let current = 1000;
    const engine = new BehavioralPrivacyEngine({ now: () => current });
    for (let i = 0; i < 16; i++) {
      engine.evaluateRequest({ agentId: 'local-agent' });
      engine.recordBehavior({ agentId: 'local-agent' });
      current += 1000;
    }
    const { base } = await startApp({ behavioralPrivacyEngine: engine });
    const { json } = await post(base, '/v1/capabilities/execute', BODY);
    expect(json.decision).toBe('denied');
    expect(json.reason).toBe('critical_correlation_risk');
    // The composite decision reflects the real deny (not just metadata).
    expect(json.runtimePolicy.allowed).toBe(false);
  });

// ---------------------------------------------------------------------------
// Real (not advisory) delay
// ---------------------------------------------------------------------------

describe('temporal delay is a real, bounded, opt-in effect', () => {
  it('is OFF by default — no sleep, appliedDelayMs 0 even when a delay is computed', async () => {
    const slept: number[] = [];
    const { base } = await startApp({
      mockFallbackEnabled: true,
      temporalObfuscationEngine: delayingTemporalEngine(),
      sleep: async (ms: number) => { slept.push(ms); }
    });
    await post(base, '/v1/capabilities/execute', BODY); // primes cadence
    const second = await post(base, '/v1/capabilities/execute', BODY); // would-be delayed
    expect(slept).toEqual([]); // sleep never invoked when disabled
    expect(second.json.appliedDelayMs).toBe(0);
  });

  it('when enabled, the computed delay is actually awaited (spy), deterministic and capped', async () => {
    const slept: number[] = [];
    const { base } = await startApp({
      mockFallbackEnabled: true,
      temporalObfuscationEngine: delayingTemporalEngine(),
      executionDelayEnabled: true,
      maxExecutionDelayMs: 250,
      sleep: async (ms: number) => { slept.push(ms); }
    });
    await post(base, '/v1/capabilities/execute', BODY); // request 1: primes cadence
    const second = await post(base, '/v1/capabilities/execute', BODY); // request 2: within minSpacing → delay
    // Sleep was really invoked with a positive, capped duration.
    const positive = slept.filter((ms) => ms > 0);
    expect(positive.length).toBeGreaterThan(0);
    for (const ms of slept) expect(ms).toBeLessThanOrEqual(250);
    // The response reports the REAL awaited duration (not a metadata recommendation).
    expect(second.json.appliedDelayMs).toBeGreaterThan(0);
    expect(second.json.appliedDelayMs).toBeLessThanOrEqual(250);
  });

  it('the computed delay is deterministic (no uncontrolled randomness)', () => {
    // Same fixed clock + same primed sequence → identical delay, twice.
    const run = (): number => {
      const e = new TemporalObfuscationEngine({
        now: () => 10_000,
        cadencePolicy: { enabled: true, minSpacingMs: 500, burstPenaltyMs: 100, maxDelayMs: 1000 }
      });
      e.evaluateTemporalRisk('a');
      e.recordExecution({ agentId: 'a' });
      return e.evaluateTemporalRisk('a').delayMs;
    };
    const first = run();
    expect(run()).toBe(first); // deterministic
  });

  it('really waits on the wall clock (one real-timing test, small cap)', async () => {
    const { base } = await startApp({
      mockFallbackEnabled: true,
      temporalObfuscationEngine: delayingTemporalEngine(),
      executionDelayEnabled: true,
      maxExecutionDelayMs: 40
      // real sleep (default)
    });
    await post(base, '/v1/capabilities/execute', BODY);
    const start = Date.now();
    const second = await post(base, '/v1/capabilities/execute', BODY);
    const elapsed = Date.now() - start;
    expect(second.json.appliedDelayMs).toBeGreaterThan(0);
    // Allow scheduler slack but require an observable real wait.
    expect(elapsed).toBeGreaterThanOrEqual(second.json.appliedDelayMs - 5);
  });
});

// ---------------------------------------------------------------------------
// Persona / route changes drive REAL session + fingerprint rotation
// ---------------------------------------------------------------------------

describe('persona / route changes produce real rotations on execute', () => {
  it('a relay-route rotation really rotates the session (audit-observable)', async () => {
    const networkIsolationEngine = new NetworkIsolationEngine({
      rotationPolicy: {
        enabled: true, rotateOnPersonaChange: false, rotateOnCategoryChange: false,
        rotateOnCriticalRisk: false, maxAssignmentsPerRoute: 1
      }
    });
    const { base } = await startApp({ mockFallbackEnabled: true, networkIsolationEngine });
    await post(base, '/v1/capabilities/execute', BODY); // assigns route + session
    const second = await post(base, '/v1/capabilities/execute', BODY); // route rotates → session rotates
    expect(second.json.networkIsolation.shouldRotate).toBe(true);
    const rotations = await get(
      base,
      '/v1/audit/events?type=session_rotated&compartmentId=research'
    );
    expect(rotations.json.events.length).toBeGreaterThan(0);
  });

  it('a category change rotates the route AND the fingerprint on execute', async () => {
    const { base } = await startApp({ mockFallbackEnabled: true });
    const a = await post(base, '/v1/capabilities/execute', {
      ...BODY,
      input: { query: 'q', categoryHint: 'crypto' }
    });
    const b = await post(base, '/v1/capabilities/execute', {
      ...BODY,
      input: { query: 'q2', categoryHint: 'health' }
    });
    expect(a.json.networkIsolation.shouldRotate).toBe(false);
    expect(b.json.networkIsolation.shouldRotate).toBe(true);
    // Route rotation is wired into the fingerprint (route → fingerprint linkage).
    expect(b.json.fingerprint.rotated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Transport selection: mock is a real fallback, not a parallel pipeline
// ---------------------------------------------------------------------------

describe('transport selection', () => {
  it('execute denies by default when transport policy resolves to mock (no real transport)', async () => {
    const { base } = await startApp();
    const { json } = await post(base, '/v1/capabilities/execute', BODY);
    expect(json.decision).toBe('denied');
    expect(json.reason).toMatch(/No real transport configured/);
  });

  it('execute allows mock transport when mockFallbackEnabled is explicitly set', async () => {
    const { base } = await startApp({ mockFallbackEnabled: true });
    const { json } = await post(base, '/v1/capabilities/execute', BODY);
    expect(json.decision).toBe('allowed');
    expect(json.execution.transportKind).toBe('mock');
  });
});

// ---------------------------------------------------------------------------
// Sprint 34 — mock markers: no fake result without explicit marker
// ---------------------------------------------------------------------------

describe('Sprint 34 mock markers', () => {
  it('execute-mock allowed response carries mocked:true, transport, warning', async () => {
    const { base } = await startApp({ mockFallbackEnabled: true });
    const { json } = await post(base, '/v1/capabilities/execute-mock', BODY);
    expect(json.decision).toBe('allowed');
    expect(json.mocked).toBe(true);
    expect(json.transport).toBe('mock');
    expect(json.warning).toBe('This is not a real execution');
  });

  it('execute-mock denied response carries mocked:false', async () => {
    // local-agent/search is allowed at low risk; high risk has no allow rule → firewall deny.
    const { base } = await startApp();
    const { json } = await post(base, '/v1/capabilities/execute-mock', {
      agentId: 'local-agent',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'high',
      input: 'probe'
    });
    expect(json.decision).toBe('denied');
    expect(json.mocked).toBe(false);
  });

  it('execute denied response (no real transport) carries mocked:false', async () => {
    const { base } = await startApp();
    const { json } = await post(base, '/v1/capabilities/execute', BODY);
    expect(json.decision).toBe('denied');
    expect(json.mocked).toBe(false);
  });

  it('execute allowed via mockFallbackEnabled carries mocked:true, warning', async () => {
    const { base } = await startApp({ mockFallbackEnabled: true });
    const { json } = await post(base, '/v1/capabilities/execute', BODY);
    expect(json.decision).toBe('allowed');
    expect(json.mocked).toBe(true);
    expect(json.transport).toBe('mock');
    expect(json.warning).toBe('This is not a real execution');
  });
});
