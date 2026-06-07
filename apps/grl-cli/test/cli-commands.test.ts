/**
 * CLI command tests.
 *
 * Each command test starts a minimal HTTP server, creates a GrlApiClient
 * pointing at it, and exercises the command function directly.
 *
 * Covers:
 *  - health command
 *  - search command success / denied
 *  - trust list / single profile
 *  - incidents list
 *  - runtime version / reload
 *  - transports list
 *  - json output
 *  - table output
 *  - invalid arguments
 *  - timeout handling
 *  - unreachable runtime
 *  - invalid JSON response
 *  - no token leak / no raw input leak
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { GrlApiClient } from '../src/client/api-client.js';
import { CliError } from '../src/errors.js';
import { runHealth } from '../src/commands/health.js';
import { runSearch } from '../src/commands/search.js';
import { runAudit } from '../src/commands/audit.js';
import { runTrust } from '../src/commands/trust.js';
import { runIncidents } from '../src/commands/incidents.js';
import { runRuntimeVersion, runRuntimeReload, runRuntimePolicySignals } from '../src/commands/runtime.js';
import { runTransports } from '../src/commands/transports.js';
import type { GrlCliConfig } from '../src/config/cli-config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
  vi.restoreAllMocks();
});

function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ base: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      const base = `http://127.0.0.1:${addr.port}`;
      cleanups.push(
        () => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())))
      );
      resolve({ base });
    });
    server.on('error', reject);
  });
}

/** Route-based handler: map method+path to a JSON fixture. */
type RouteMap = Record<string, { status: number; body: unknown }>;

function routeServer(routes: RouteMap): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req, res) => {
    const key = `${req.method} ${(req.url ?? '/').split('?')[0]}`;
    const match = routes[key];
    if (match) {
      res.writeHead(match.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(match.body));
    } else {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `No route for ${key}` }));
    }
  };
}

function tableConfig(): GrlCliConfig {
  return { baseUrl: 'http://127.0.0.1', timeoutMs: 5000, output: 'table' };
}

function jsonConfig(): GrlCliConfig {
  return { baseUrl: 'http://127.0.0.1', timeoutMs: 5000, output: 'json' };
}

/** Capture process.stdout.write output. */
function captureStdout(): { get: () => string; restore: () => void } {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  });
  return {
    get: () => chunks.join(''),
    restore: () => spy.mockRestore()
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HEALTH_FIXTURE = { status: 'ok', service: 'grl-server' };
const RUNTIME_CONFIG_FIXTURE = { version: 1, loadedAt: 0, checksum: 'abc123' };
const EXECUTE_ALLOWED_FIXTURE = {
  decision: 'allowed',
  reason: 'capability_allowed',
  trust: { compartmentId: 'research', score: 70, level: 'neutral' },
  routing: { transportKind: 'mock' },
  execution: { status: 'success', transportKind: 'mock', output: [] }
};
const EXECUTE_DENIED_FIXTURE = {
  decision: 'denied',
  reason: 'policy_denied'
};
const AUDIT_FIXTURE = {
  events: [
    {
      id: 'evt-1',
      timestamp: 1000000,
      type: 'execution_succeeded',
      severity: 'info',
      message: 'Search executed'
    }
  ]
};
const TRUST_PROFILES_FIXTURE = {
  profiles: [
    { compartmentId: 'research', score: 68, level: 'neutral', createdAt: 0, updatedAt: 1000 }
  ]
};
const TRUST_PROFILE_FIXTURE = {
  profile: { compartmentId: 'research', score: 68, level: 'neutral', createdAt: 0, updatedAt: 1000 }
};
const INCIDENTS_FIXTURE = {
  incidents: [
    { id: 'inc-1', createdAt: 2000000, updatedAt: 2000000, severity: 'warning', status: 'open', summary: 'Test incident' }
  ]
};
const RUNTIME_VERSION_FIXTURE = { version: 2 };
const RUNTIME_RELOAD_FIXTURE = { version: 3, loadedAt: 9999, checksum: 'xyz' };
const TRANSPORTS_FIXTURE = {
  transports: [
    {
      kind: 'mock',
      name: 'Mock Adapter',
      version: '1.0.0',
      supportedTools: ['web_search'],
      declaredPermissions: ['execute_mock'],
      networkAccess: false,
      browserAccess: false,
      filesystemAccess: false,
      processSpawnAccess: false,
      envAccess: false
    }
  ]
};

// ---------------------------------------------------------------------------
// health
// ---------------------------------------------------------------------------

describe('health command', () => {
  it('displays status and service in table mode', async () => {
    const { base } = await startServer(
      routeServer({
        'GET /v1/health': { status: 200, body: HEALTH_FIXTURE },
        'GET /v1/runtime/config': { status: 200, body: RUNTIME_CONFIG_FIXTURE }
      })
    );
    const cfg = { ...tableConfig(), baseUrl: base };
    const out = captureStdout();
    await runHealth(new GrlApiClient(cfg), cfg);
    out.restore();
    const text = out.get();
    expect(text).toContain('ok');
    expect(text).toContain('grl-server');
  });

  it('outputs JSON in json mode', async () => {
    const { base } = await startServer(
      routeServer({
        'GET /v1/health': { status: 200, body: HEALTH_FIXTURE },
        'GET /v1/runtime/config': { status: 200, body: RUNTIME_CONFIG_FIXTURE }
      })
    );
    const cfg = { ...jsonConfig(), baseUrl: base };
    const out = captureStdout();
    await runHealth(new GrlApiClient(cfg), cfg);
    out.restore();
    const parsed = JSON.parse(out.get());
    expect(parsed.health.status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe('search command', () => {
  it('displays allowed result in table mode', async () => {
    const { base } = await startServer(
      routeServer({ 'POST /v1/capabilities/execute': { status: 200, body: EXECUTE_ALLOWED_FIXTURE } })
    );
    const cfg = { ...tableConfig(), baseUrl: base };
    const out = captureStdout();
    await runSearch('bitcoin privacy', new GrlApiClient(cfg), cfg);
    out.restore();
    const text = out.get();
    expect(text).toContain('allowed');
    expect(text).toContain('neutral');
  });

  it('displays denied result in table mode', async () => {
    const { base } = await startServer(
      routeServer({ 'POST /v1/capabilities/execute': { status: 200, body: EXECUTE_DENIED_FIXTURE } })
    );
    const cfg = { ...tableConfig(), baseUrl: base };
    const out = captureStdout();
    await runSearch('query', new GrlApiClient(cfg), cfg);
    out.restore();
    expect(out.get()).toContain('denied');
  });

  it('outputs JSON in json mode', async () => {
    const { base } = await startServer(
      routeServer({ 'POST /v1/capabilities/execute': { status: 200, body: EXECUTE_ALLOWED_FIXTURE } })
    );
    const cfg = { ...jsonConfig(), baseUrl: base };
    const out = captureStdout();
    await runSearch('query', new GrlApiClient(cfg), cfg);
    out.restore();
    const parsed = JSON.parse(out.get());
    expect(parsed.decision).toBe('allowed');
  });

  it('throws invalid_arguments for empty query', async () => {
    const cfg = tableConfig();
    await expect(runSearch('  ', new GrlApiClient(cfg), cfg)).rejects.toSatisfy(
      (e: unknown) => e instanceof CliError && e.code === 'invalid_arguments'
    );
  });

  it('does not log raw query in output', async () => {
    const sensitiveQuery = 'my-secret-query-token-abc123';
    const { base } = await startServer(
      routeServer({ 'POST /v1/capabilities/execute': { status: 200, body: EXECUTE_ALLOWED_FIXTURE } })
    );
    const cfg = { ...tableConfig(), baseUrl: base };
    const out = captureStdout();
    await runSearch(sensitiveQuery, new GrlApiClient(cfg), cfg);
    out.restore();
    // The raw query must NOT appear verbatim in the table output
    expect(out.get()).not.toContain(sensitiveQuery);
  });
});

// ---------------------------------------------------------------------------
// audit
// ---------------------------------------------------------------------------

describe('audit command', () => {
  it('displays events in table mode', async () => {
    const { base } = await startServer(
      routeServer({ 'GET /v1/audit/events': { status: 200, body: AUDIT_FIXTURE } })
    );
    const cfg = { ...tableConfig(), baseUrl: base };
    const out = captureStdout();
    await runAudit({}, new GrlApiClient(cfg), cfg);
    out.restore();
    expect(out.get()).toContain('execution_succeeded');
  });

  it('displays events in json mode', async () => {
    const { base } = await startServer(
      routeServer({ 'GET /v1/audit/events': { status: 200, body: AUDIT_FIXTURE } })
    );
    const cfg = { ...jsonConfig(), baseUrl: base };
    const out = captureStdout();
    await runAudit({}, new GrlApiClient(cfg), cfg);
    out.restore();
    const parsed = JSON.parse(out.get());
    expect(parsed.events).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// runtime policy signals (Sprint 29)
// ---------------------------------------------------------------------------

const POLICY_SIGNALS_FIXTURE = {
  signals: [
    {
      id: 'sig-1',
      source: 'multi_agent',
      action: 'temporary_block',
      severity: 'high',
      reason: 'Agent concurrent execution quota exceeded.',
      createdAt: 0
    }
  ]
};

describe('runtime policy signals command', () => {
  it('forwards --source/--severity/--limit filters as query params', async () => {
    let capturedUrl = '';
    const { base } = await startServer((req, res) => {
      capturedUrl = req.url ?? '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(POLICY_SIGNALS_FIXTURE));
    });
    const cfg = { ...tableConfig(), baseUrl: base };
    const out = captureStdout();
    await runRuntimePolicySignals(new GrlApiClient(cfg), cfg, {
      source: 'multi_agent',
      severity: 'high',
      limit: 10
    });
    out.restore();
    expect(capturedUrl).toContain('source=multi_agent');
    expect(capturedUrl).toContain('severity=high');
    expect(capturedUrl).toContain('limit=10');
    expect(out.get()).toContain('multi_agent');
    expect(out.get()).toContain('temporary_block');
  });

  it('emits JSON output in json mode', async () => {
    const { base } = await startServer(
      routeServer({ 'GET /v1/runtime/policy-orchestrator/signals': { status: 200, body: POLICY_SIGNALS_FIXTURE } })
    );
    const cfg = { ...jsonConfig(), baseUrl: base };
    const out = captureStdout();
    await runRuntimePolicySignals(new GrlApiClient(cfg), cfg, {});
    out.restore();
    const parsed = JSON.parse(out.get());
    expect(parsed.signals).toHaveLength(1);
    expect(parsed.signals[0].source).toBe('multi_agent');
  });

  it('surfaces a server 400 (invalid filter) as a CliError', async () => {
    const { base } = await startServer(
      routeServer({
        'GET /v1/runtime/policy-orchestrator/signals': {
          status: 400,
          body: { error: 'Invalid source: "nope".' }
        }
      })
    );
    const cfg = { ...tableConfig(), baseUrl: base };
    await expect(
      runRuntimePolicySignals(new GrlApiClient(cfg), cfg, { source: 'multi_agent' })
    ).rejects.toBeInstanceOf(CliError);
  });
});

// ---------------------------------------------------------------------------
// trust
// ---------------------------------------------------------------------------

describe('trust command', () => {
  it('lists all profiles in table mode', async () => {
    const { base } = await startServer(
      routeServer({ 'GET /v1/trust/profiles': { status: 200, body: TRUST_PROFILES_FIXTURE } })
    );
    const cfg = { ...tableConfig(), baseUrl: base };
    const out = captureStdout();
    await runTrust(undefined, new GrlApiClient(cfg), cfg);
    out.restore();
    expect(out.get()).toContain('research');
    expect(out.get()).toContain('neutral');
  });

  it('shows single profile in table mode', async () => {
    const { base } = await startServer(
      routeServer({
        'GET /v1/trust/profiles/research': { status: 200, body: TRUST_PROFILE_FIXTURE }
      })
    );
    const cfg = { ...tableConfig(), baseUrl: base };
    const out = captureStdout();
    await runTrust('research', new GrlApiClient(cfg), cfg);
    out.restore();
    expect(out.get()).toContain('research');
    expect(out.get()).toContain('68');
  });

  it('lists profiles in json mode', async () => {
    const { base } = await startServer(
      routeServer({ 'GET /v1/trust/profiles': { status: 200, body: TRUST_PROFILES_FIXTURE } })
    );
    const cfg = { ...jsonConfig(), baseUrl: base };
    const out = captureStdout();
    await runTrust(undefined, new GrlApiClient(cfg), cfg);
    out.restore();
    const parsed = JSON.parse(out.get());
    expect(parsed.profiles[0].compartmentId).toBe('research');
  });
});

// ---------------------------------------------------------------------------
// incidents
// ---------------------------------------------------------------------------

describe('incidents command', () => {
  it('lists incidents in table mode', async () => {
    const { base } = await startServer(
      routeServer({ 'GET /v1/security/incidents': { status: 200, body: INCIDENTS_FIXTURE } })
    );
    const cfg = { ...tableConfig(), baseUrl: base };
    const out = captureStdout();
    await runIncidents(new GrlApiClient(cfg), cfg);
    out.restore();
    expect(out.get()).toContain('inc-1');
    expect(out.get()).toContain('warning');
  });

  it('lists incidents in json mode', async () => {
    const { base } = await startServer(
      routeServer({ 'GET /v1/security/incidents': { status: 200, body: INCIDENTS_FIXTURE } })
    );
    const cfg = { ...jsonConfig(), baseUrl: base };
    const out = captureStdout();
    await runIncidents(new GrlApiClient(cfg), cfg);
    out.restore();
    const parsed = JSON.parse(out.get());
    expect(parsed.incidents[0].id).toBe('inc-1');
  });
});

// ---------------------------------------------------------------------------
// runtime
// ---------------------------------------------------------------------------

describe('runtime version command', () => {
  it('displays version in table mode', async () => {
    const { base } = await startServer(
      routeServer({
        'GET /v1/runtime/config/version': { status: 200, body: RUNTIME_VERSION_FIXTURE }
      })
    );
    const cfg = { ...tableConfig(), baseUrl: base };
    const out = captureStdout();
    await runRuntimeVersion(new GrlApiClient(cfg), cfg);
    out.restore();
    expect(out.get()).toContain('2');
  });

  it('displays version in json mode', async () => {
    const { base } = await startServer(
      routeServer({
        'GET /v1/runtime/config/version': { status: 200, body: RUNTIME_VERSION_FIXTURE }
      })
    );
    const cfg = { ...jsonConfig(), baseUrl: base };
    const out = captureStdout();
    await runRuntimeVersion(new GrlApiClient(cfg), cfg);
    out.restore();
    expect(JSON.parse(out.get()).version).toBe(2);
  });
});

describe('runtime reload command', () => {
  it('displays reload result in table mode', async () => {
    const { base } = await startServer(
      routeServer({
        'POST /v1/runtime/reload': { status: 200, body: RUNTIME_RELOAD_FIXTURE }
      })
    );
    const cfg = { ...tableConfig(), baseUrl: base };
    const out = captureStdout();
    await runRuntimeReload(new GrlApiClient(cfg), cfg);
    out.restore();
    expect(out.get()).toContain('3');
    expect(out.get()).toContain('xyz');
  });

  it('displays reload result in json mode', async () => {
    const { base } = await startServer(
      routeServer({
        'POST /v1/runtime/reload': { status: 200, body: RUNTIME_RELOAD_FIXTURE }
      })
    );
    const cfg = { ...jsonConfig(), baseUrl: base };
    const out = captureStdout();
    await runRuntimeReload(new GrlApiClient(cfg), cfg);
    out.restore();
    const parsed = JSON.parse(out.get());
    expect(parsed.checksum).toBe('xyz');
  });
});

// ---------------------------------------------------------------------------
// transports
// ---------------------------------------------------------------------------

describe('transports command', () => {
  it('displays transports in table mode', async () => {
    const { base } = await startServer(
      routeServer({ 'GET /v1/transports': { status: 200, body: TRANSPORTS_FIXTURE } })
    );
    const cfg = { ...tableConfig(), baseUrl: base };
    const out = captureStdout();
    await runTransports(new GrlApiClient(cfg), cfg);
    out.restore();
    expect(out.get()).toContain('mock');
  });

  it('displays transports in json mode', async () => {
    const { base } = await startServer(
      routeServer({ 'GET /v1/transports': { status: 200, body: TRANSPORTS_FIXTURE } })
    );
    const cfg = { ...jsonConfig(), baseUrl: base };
    const out = captureStdout();
    await runTransports(new GrlApiClient(cfg), cfg);
    out.restore();
    expect(JSON.parse(out.get()).transports[0].kind).toBe('mock');
  });
});

// ---------------------------------------------------------------------------
// Error scenarios
// ---------------------------------------------------------------------------

describe('error handling', () => {
  it('propagates timeout as CliError request_timeout', async () => {
    const { base } = await startServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      }, 500);
    });
    const cfg = { ...tableConfig(), baseUrl: base, timeoutMs: 30 };
    await expect(runHealth(new GrlApiClient(cfg), cfg)).rejects.toSatisfy(
      (e: unknown) => e instanceof CliError && e.code === 'request_timeout'
    );
  });

  it('propagates unreachable as CliError runtime_unreachable', async () => {
    const cfg = { ...tableConfig(), baseUrl: 'http://127.0.0.1:1', timeoutMs: 2000 };
    await expect(runHealth(new GrlApiClient(cfg), cfg)).rejects.toSatisfy(
      (e: unknown) => e instanceof CliError && e.code === 'runtime_unreachable'
    );
  });

  it('propagates invalid JSON as CliError invalid_response', async () => {
    const { base } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('not-valid-json!!');
    });
    const cfg = { ...tableConfig(), baseUrl: base };
    await expect(runHealth(new GrlApiClient(cfg), cfg)).rejects.toSatisfy(
      (e: unknown) => e instanceof CliError && e.code === 'invalid_response'
    );
  });
});

// ---------------------------------------------------------------------------
// Privacy / no token leak
// ---------------------------------------------------------------------------

describe('privacy guarantees', () => {
  it('does not include raw query body in any output field', async () => {
    const token = 'super-secret-token-xyz';
    const { base } = await startServer(
      routeServer({ 'POST /v1/capabilities/execute': { status: 200, body: EXECUTE_ALLOWED_FIXTURE } })
    );
    const cfg = { ...jsonConfig(), baseUrl: base };
    const out = captureStdout();
    await runSearch(token, new GrlApiClient(cfg), cfg);
    out.restore();
    // The "query" itself should not be echoed in the response (server doesn't return it)
    expect(out.get()).not.toContain(token);
  });
});
