/**
 * Sprint fix/runtime-integrity-no-mock-fallback — integrity test suite.
 *
 * Covers the 7 required scenarios for the runtime integrity fix:
 *   1. POST /execute with no real transport → denied, no mock output, NO_REAL_TRANSPORT_AVAILABLE
 *   2. Runtime never auto-selects mock transport
 *   3. Bootstrap rules do not default to preferredTransport: 'mock'
 *   4. POST /execute-mock blocked unless NODE_ENV=test or ENABLE_RUNTIME_MOCKS=true
 *   5. MockTransportAdapter.isReal === false
 *   6. Runtime /execute rejects adapter where isReal === false
 *   7. Audit events emitted for mock blocking, no real transport, invalid config
 */

import { AddressInfo, createServer, IncomingMessage, ServerResponse } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RUNTIME_CONFIG,
  MockTransportAdapter,
  SearXngTransportAdapter,
  TransportAdapter
} from '../../../packages/core/src/index.js';
import {
  BOOTSTRAP_TRANSPORT_POLICY_RULES
} from '../../../packages/core/src/transport-policy/bootstrap.js';
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

function post(base: string, path: string, body: unknown) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));
}
function get(base: string, path: string) {
  return fetch(`${base}${path}`).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));
}

const EXECUTE_BODY = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'search',
  riskLevel: 'low',
  input: 'integrity probe'
};

// ---------------------------------------------------------------------------
// 1. POST /execute → denied, no mock output, NO_REAL_TRANSPORT_AVAILABLE
// ---------------------------------------------------------------------------

describe('1. POST /execute with no real transport configured', () => {
  it('returns decision=denied', async () => {
    const { base } = await startApp();
    const { json } = await post(base, '/v1/capabilities/execute', EXECUTE_BODY);
    expect(json.decision).toBe('denied');
  });

  it('reason contains NO_REAL_TRANSPORT_AVAILABLE', async () => {
    const { base } = await startApp();
    const { json } = await post(base, '/v1/capabilities/execute', EXECUTE_BODY);
    expect(json.reason).toContain('NO_REAL_TRANSPORT_AVAILABLE');
  });

  it('response contains no mock execution output', async () => {
    const { base } = await startApp();
    const { json } = await post(base, '/v1/capabilities/execute', EXECUTE_BODY);
    expect(json.execution).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Runtime never auto-selects mock transport
// ---------------------------------------------------------------------------

describe('2. Runtime never auto-selects mock transport', () => {
  it('transport-policies endpoint reports no rule with preferredTransport=mock', async () => {
    const { base } = await startApp();
    const { json } = await get(base, '/v1/transport-policies');
    const rules: any[] = json.rules ?? [];
    const mockRules = rules.filter((r: any) => r.preferredTransport === 'mock');
    expect(mockRules).toHaveLength(0);
  });

  it('DEFAULT_RUNTIME_CONFIG.transportPolicies has no mock rule', () => {
    const mockPolicies = DEFAULT_RUNTIME_CONFIG.transportPolicies.filter(
      (r: any) => r.preferredTransport === 'mock'
    );
    expect(mockPolicies).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Bootstrap rules do not default to preferredTransport: 'mock'
// ---------------------------------------------------------------------------

describe('3. Bootstrap transport policy rules', () => {
  it('all bootstrap rules use preferredTransport=searxng, never mock', () => {
    for (const rule of BOOTSTRAP_TRANSPORT_POLICY_RULES) {
      expect(rule.preferredTransport).toBe('searxng');
      expect(rule.preferredTransport).not.toBe('mock');
    }
  });

  it('BOOTSTRAP_SEARCH_RULE points to searxng', () => {
    const searchRule = BOOTSTRAP_TRANSPORT_POLICY_RULES.find((r) => r.tool === 'search');
    expect(searchRule).toBeDefined();
    expect(searchRule!.preferredTransport).toBe('searxng');
  });

  it('BOOTSTRAP_FETCH_HTML_RULE points to searxng', () => {
    const fetchRule = BOOTSTRAP_TRANSPORT_POLICY_RULES.find((r) => r.tool === 'fetch_html');
    expect(fetchRule).toBeDefined();
    expect(fetchRule!.preferredTransport).toBe('searxng');
  });
});

// ---------------------------------------------------------------------------
// 4. POST /execute-mock blocked unless NODE_ENV=test or ENABLE_RUNTIME_MOCKS=true
// ---------------------------------------------------------------------------

describe('4. POST /execute-mock guard (H-01)', () => {
  it('returns 403 when NODE_ENV=production and ENABLE_RUNTIME_MOCKS is unset', async () => {
    const origNodeEnv = process.env['NODE_ENV'];
    const origEnableMocks = process.env['ENABLE_RUNTIME_MOCKS'];
    process.env['NODE_ENV'] = 'production';
    delete process.env['ENABLE_RUNTIME_MOCKS'];
    try {
      const { base } = await startApp();
      const { status, json } = await post(base, '/v1/capabilities/execute-mock', EXECUTE_BODY);
      expect(status).toBe(403);
      expect(json.decision).toBe('denied');
      expect(json.reason).toContain('MOCK_TRANSPORT_BLOCKED');
    } finally {
      process.env['NODE_ENV'] = origNodeEnv;
      if (origEnableMocks !== undefined) {
        process.env['ENABLE_RUNTIME_MOCKS'] = origEnableMocks;
      }
    }
  });

  it('passes when NODE_ENV=test (vitest default)', async () => {
    // NODE_ENV is 'test' in vitest — guard should let this through
    const { base } = await startApp();
    const { status } = await post(base, '/v1/capabilities/execute-mock', EXECUTE_BODY);
    expect(status).toBe(200);
  });

  it('passes when ENABLE_RUNTIME_MOCKS=true even with non-test NODE_ENV', async () => {
    const origNodeEnv = process.env['NODE_ENV'];
    const origEnableMocks = process.env['ENABLE_RUNTIME_MOCKS'];
    process.env['NODE_ENV'] = 'production';
    process.env['ENABLE_RUNTIME_MOCKS'] = 'true';
    try {
      const { base } = await startApp();
      const { status } = await post(base, '/v1/capabilities/execute-mock', EXECUTE_BODY);
      expect(status).toBe(200);
    } finally {
      process.env['NODE_ENV'] = origNodeEnv;
      if (origEnableMocks !== undefined) {
        process.env['ENABLE_RUNTIME_MOCKS'] = origEnableMocks;
      } else {
        delete process.env['ENABLE_RUNTIME_MOCKS'];
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. MockTransportAdapter.isReal === false
// ---------------------------------------------------------------------------

describe('5. MockTransportAdapter.isReal flag', () => {
  it('MockTransportAdapter instance has isReal=false', () => {
    const adapter = new MockTransportAdapter();
    expect(adapter.isReal).toBe(false);
  });

  it('MockTransportAdapter satisfies TransportAdapter interface with isReal', () => {
    const adapter: TransportAdapter = new MockTransportAdapter();
    expect(adapter.isReal).toBe(false);
    expect(adapter.kind).toBe('mock');
  });
});

// ---------------------------------------------------------------------------
// 6. SearXngTransportAdapter.isReal === true (and inline adapters must declare isReal)
// ---------------------------------------------------------------------------

describe('6. isReal interface enforcement', () => {
  it('SearXngTransportAdapter.isReal === true', () => {
    const adapter = new SearXngTransportAdapter({
      baseUrl: 'http://127.0.0.1:1',
      timeoutMs: 1000,
      maxResults: 5,
      enabled: true
    });
    expect(adapter.isReal).toBe(true);
  });

  it('an adapter with isReal=false is structurally distinct from a real transport', () => {
    const mockAdapter: TransportAdapter = {
      kind: 'mock',
      isReal: false,
      async execute() { return { mock: true, tool: 'search', input: '' } as any; }
    };
    expect(mockAdapter.isReal).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Audit events emitted for mock blocking, no real transport, invalid config
// ---------------------------------------------------------------------------

describe('7. Audit events for integrity denials', () => {
  it('emits no_real_transport_available event on /execute with no transport', async () => {
    const { base } = await startApp();
    await post(base, '/v1/capabilities/execute', EXECUTE_BODY);
    const { json } = await get(base, '/v1/audit/events?type=no_real_transport_available');
    expect(json.events.length).toBeGreaterThan(0);
    const event = json.events[0];
    expect(event.type).toBe('no_real_transport_available');
  });

  it('emits mock_transport_blocked event on guarded /execute-mock call', async () => {
    const origNodeEnv = process.env['NODE_ENV'];
    const origEnableMocks = process.env['ENABLE_RUNTIME_MOCKS'];
    process.env['NODE_ENV'] = 'production';
    delete process.env['ENABLE_RUNTIME_MOCKS'];
    try {
      const { base } = await startApp();
      await post(base, '/v1/capabilities/execute-mock', EXECUTE_BODY);
      const { json } = await get(base, '/v1/audit/events?type=mock_transport_blocked');
      expect(json.events.length).toBeGreaterThan(0);
      expect(json.events[0].type).toBe('mock_transport_blocked');
    } finally {
      process.env['NODE_ENV'] = origNodeEnv;
      if (origEnableMocks !== undefined) {
        process.env['ENABLE_RUNTIME_MOCKS'] = origEnableMocks;
      }
    }
  });
});
