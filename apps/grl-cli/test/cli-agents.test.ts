/**
 * CLI command tests — agents commands.
 *
 * Covers:
 *  - grl agents (list)
 *  - grl agents get <agentId>
 *  - grl agents leases [agentId]
 *  - grl agents evict <agentId>
 *  - grl agents restrict <agentId>
 *  - JSON output
 *  - 404 / not-found handling
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { GrlApiClient } from '../src/client/api-client.js';
import { CliError } from '../src/errors.js';
import {
  runAgentsList,
  runAgentGet,
  runAgentLeases,
  runAgentEvict,
  runAgentRestrict
} from '../src/commands/agents.js';
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

type RouteMap = Record<string, { status: number; body: unknown }>;

function routeServer(
  routes: RouteMap
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
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

function tableConfig(base: string): GrlCliConfig {
  return { baseUrl: base, timeoutMs: 5000, output: 'table' };
}

function jsonConfig(base: string): GrlCliConfig {
  return { baseUrl: base, timeoutMs: 5000, output: 'json' };
}

function captureStdout(): { get: () => string; restore: () => void } {
  const chunks: string[] = [];
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

const AGENT_A = {
  agentId: 'agent-a',
  status: 'idle',
  trustScore: 70,
  activeSessions: 0,
  activeExecutions: 0,
  compartments: [],
  createdAt: 1000,
  updatedAt: 1000,
  quota: {
    maxConcurrentExecutions: 5,
    maxSessions: 10,
    maxApprovalsPending: 20,
    maxAuditEvents: 1000,
    maxIncidents: 50
  }
};

const AGENT_B = {
  ...AGENT_A,
  agentId: 'agent-b',
  status: 'restricted'
};

const AGENTS_FIXTURE = { agents: [AGENT_A, AGENT_B] };
const AGENT_FIXTURE = { agent: AGENT_A };

const LEASES_FIXTURE = {
  agentId: 'agent-a',
  leases: [
    {
      id: 'lease-1',
      acquiredAt: 1000,
      expiresAt: 301000,
      renewable: true,
      holderAgentId: 'agent-a'
    }
  ]
};

const RESTRICT_FIXTURE = {
  agentId: 'agent-a',
  status: 'restricted',
  updatedAt: 2000
};

const EVICT_FIXTURE = {
  agentId: 'agent-a',
  status: 'evicted',
  updatedAt: 3000
};

// ---------------------------------------------------------------------------
// grl agents (list)
// ---------------------------------------------------------------------------

describe('runAgentsList', () => {
  it('displays agent table in table mode', async () => {
    const { base } = await startServer(
      routeServer({ 'GET /v1/agents': { status: 200, body: AGENTS_FIXTURE } })
    );
    const cfg = tableConfig(base);
    const out = captureStdout();
    await runAgentsList(new GrlApiClient(cfg), cfg);
    out.restore();
    const text = out.get();
    expect(text).toContain('agent-a');
    expect(text).toContain('agent-b');
    expect(text).toContain('AGENT_ID');
  });

  it('outputs JSON in json mode', async () => {
    const { base } = await startServer(
      routeServer({ 'GET /v1/agents': { status: 200, body: AGENTS_FIXTURE } })
    );
    const cfg = jsonConfig(base);
    const out = captureStdout();
    await runAgentsList(new GrlApiClient(cfg), cfg);
    out.restore();
    const parsed = JSON.parse(out.get());
    expect(Array.isArray(parsed.agents)).toBe(true);
    expect(parsed.agents[0].agentId).toBe('agent-a');
  });

  it('shows all status values in table output', async () => {
    const { base } = await startServer(
      routeServer({ 'GET /v1/agents': { status: 200, body: AGENTS_FIXTURE } })
    );
    const cfg = tableConfig(base);
    const out = captureStdout();
    await runAgentsList(new GrlApiClient(cfg), cfg);
    out.restore();
    const text = out.get();
    expect(text).toContain('idle');
    expect(text).toContain('restricted');
  });
});

// ---------------------------------------------------------------------------
// grl agents get <agentId>
// ---------------------------------------------------------------------------

describe('runAgentGet', () => {
  it('displays agent details in table mode', async () => {
    const { base } = await startServer(
      routeServer({ 'GET /v1/agents/agent-a': { status: 200, body: AGENT_FIXTURE } })
    );
    const cfg = tableConfig(base);
    const out = captureStdout();
    await runAgentGet('agent-a', new GrlApiClient(cfg), cfg);
    out.restore();
    const text = out.get();
    expect(text).toContain('agent-a');
    expect(text).toContain('idle');
    expect(text).toContain('trustScore');
  });

  it('outputs JSON in json mode', async () => {
    const { base } = await startServer(
      routeServer({ 'GET /v1/agents/agent-a': { status: 200, body: AGENT_FIXTURE } })
    );
    const cfg = jsonConfig(base);
    const out = captureStdout();
    await runAgentGet('agent-a', new GrlApiClient(cfg), cfg);
    out.restore();
    const parsed = JSON.parse(out.get());
    expect(parsed.agent.agentId).toBe('agent-a');
  });

  it('throws CliError for 404 agent', async () => {
    const { base } = await startServer(
      routeServer({ 'GET /v1/agents/nobody': { status: 404, body: { error: 'Not found' } } })
    );
    const cfg = tableConfig(base);
    await expect(runAgentGet('nobody', new GrlApiClient(cfg), cfg)).rejects.toBeInstanceOf(CliError);
  });
});

// ---------------------------------------------------------------------------
// grl agents leases [agentId]
// ---------------------------------------------------------------------------

describe('runAgentLeases', () => {
  it('displays lease table for a specific agent', async () => {
    const { base } = await startServer(
      routeServer({ 'GET /v1/agents/agent-a/leases': { status: 200, body: LEASES_FIXTURE } })
    );
    const cfg = tableConfig(base);
    const out = captureStdout();
    await runAgentLeases('agent-a', new GrlApiClient(cfg), cfg);
    out.restore();
    const text = out.get();
    expect(text).toContain('lease-1');
    expect(text).toContain('agent-a');
  });

  it('outputs JSON for leases in json mode', async () => {
    const { base } = await startServer(
      routeServer({ 'GET /v1/agents/agent-a/leases': { status: 200, body: LEASES_FIXTURE } })
    );
    const cfg = jsonConfig(base);
    const out = captureStdout();
    await runAgentLeases('agent-a', new GrlApiClient(cfg), cfg);
    out.restore();
    const parsed = JSON.parse(out.get());
    expect(parsed.agentId).toBe('agent-a');
    expect(Array.isArray(parsed.leases)).toBe(true);
  });

  it('prints "No active leases" message when list is empty', async () => {
    const { base } = await startServer(
      routeServer({
        'GET /v1/agents/agent-a/leases': {
          status: 200,
          body: { agentId: 'agent-a', leases: [] }
        }
      })
    );
    const cfg = tableConfig(base);
    const out = captureStdout();
    await runAgentLeases('agent-a', new GrlApiClient(cfg), cfg);
    out.restore();
    expect(out.get()).toContain('No active leases');
  });

  it('shows "No active leases" for all agents when no agentId given and none have leases', async () => {
    const fixture = {
      agents: [AGENT_A] // no lease property
    };
    const { base } = await startServer(
      routeServer({ 'GET /v1/agents': { status: 200, body: fixture } })
    );
    const cfg = tableConfig(base);
    const out = captureStdout();
    await runAgentLeases(undefined, new GrlApiClient(cfg), cfg);
    out.restore();
    expect(out.get()).toContain('No active leases');
  });
});

// ---------------------------------------------------------------------------
// grl agents restrict <agentId>
// ---------------------------------------------------------------------------

describe('runAgentRestrict', () => {
  it('displays restriction result in table mode', async () => {
    const { base } = await startServer(
      routeServer({
        'POST /v1/agents/agent-a/restrict': { status: 200, body: RESTRICT_FIXTURE }
      })
    );
    const cfg = tableConfig(base);
    const out = captureStdout();
    await runAgentRestrict('agent-a', new GrlApiClient(cfg), cfg);
    out.restore();
    const text = out.get();
    expect(text).toContain('agent-a');
    expect(text).toContain('restricted');
  });

  it('outputs JSON in json mode', async () => {
    const { base } = await startServer(
      routeServer({
        'POST /v1/agents/agent-a/restrict': { status: 200, body: RESTRICT_FIXTURE }
      })
    );
    const cfg = jsonConfig(base);
    const out = captureStdout();
    await runAgentRestrict('agent-a', new GrlApiClient(cfg), cfg);
    out.restore();
    const parsed = JSON.parse(out.get());
    expect(parsed.agentId).toBe('agent-a');
    expect(parsed.status).toBe('restricted');
  });

  it('throws CliError for unknown agent', async () => {
    const { base } = await startServer(
      routeServer({
        'POST /v1/agents/nobody/restrict': { status: 404, body: { error: 'Not found' } }
      })
    );
    const cfg = tableConfig(base);
    await expect(
      runAgentRestrict('nobody', new GrlApiClient(cfg), cfg)
    ).rejects.toBeInstanceOf(CliError);
  });
});

// ---------------------------------------------------------------------------
// grl agents evict <agentId>
// ---------------------------------------------------------------------------

describe('runAgentEvict', () => {
  it('displays eviction result in table mode', async () => {
    const { base } = await startServer(
      routeServer({
        'POST /v1/agents/agent-a/evict': { status: 200, body: EVICT_FIXTURE }
      })
    );
    const cfg = tableConfig(base);
    const out = captureStdout();
    await runAgentEvict('agent-a', new GrlApiClient(cfg), cfg);
    out.restore();
    const text = out.get();
    expect(text).toContain('agent-a');
    expect(text).toContain('evicted');
  });

  it('outputs JSON in json mode', async () => {
    const { base } = await startServer(
      routeServer({
        'POST /v1/agents/agent-a/evict': { status: 200, body: EVICT_FIXTURE }
      })
    );
    const cfg = jsonConfig(base);
    const out = captureStdout();
    await runAgentEvict('agent-a', new GrlApiClient(cfg), cfg);
    out.restore();
    const parsed = JSON.parse(out.get());
    expect(parsed.agentId).toBe('agent-a');
    expect(parsed.status).toBe('evicted');
  });

  it('throws CliError for unknown agent', async () => {
    const { base } = await startServer(
      routeServer({
        'POST /v1/agents/nobody/evict': { status: 404, body: { error: 'Not found' } }
      })
    );
    const cfg = tableConfig(base);
    await expect(
      runAgentEvict('nobody', new GrlApiClient(cfg), cfg)
    ).rejects.toBeInstanceOf(CliError);
  });
});
