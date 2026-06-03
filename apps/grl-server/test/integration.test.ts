import http from 'node:http';
import { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { CapabilityFirewall } from '../../../packages/core/src/index.js';
import { SessionManager } from '../../../packages/identity-compartment/src/index.js';
import { PolicyDocument, YamlPolicyEngine } from '../../../packages/policy-engine/src/index.js';
import { SearxngAdapter } from '../../../packages/search-adapter-searxng/src/index.js';
import { TransportRouter } from '../../../packages/transport-router/src/index.js';
import { createApp, ServerDeps } from '../src/index.js';

const policy: PolicyDocument = {
  defaultDeny: true,
  rules: [
    {
      effect: 'allow',
      agentId: 'research-agent',
      compartment: 'open-research',
      tool: 'search',
      transport: 'direct',
      maxRiskLevel: 'low'
    },
    {
      effect: 'allow',
      agentId: 'research-agent',
      compartment: 'open-research-2',
      tool: 'search',
      transport: 'direct',
      maxRiskLevel: 'low'
    },
    {
      effect: 'allow',
      agentId: 'research-agent',
      compartment: 'darknet-research',
      tool: 'search',
      transport: 'tor',
      maxRiskLevel: 'medium'
    }
  ]
};

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

async function startSearxng(): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ results: [{ title: 't', url: 'http://r', content: 'snippet' }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

async function startApp(extra: Partial<ServerDeps>): Promise<{
  base: string;
  sessionManager: SessionManager;
  close: () => void;
}> {
  const searxng = await startSearxng();
  cleanups.push(searxng.close);
  const sessionManager = new SessionManager();
  const app: express.Express = createApp({
    firewall: new CapabilityFirewall(new YamlPolicyEngine(policy)),
    sessionManager,
    searchAdapter: new SearxngAdapter(searxng.url),
    transportRouter: new TransportRouter(),
    timeoutMs: 1_000,
    ...extra
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  cleanups.push(() => server.close());
  return { base: `http://127.0.0.1:${port}`, sessionManager, close: () => server.close() };
}

function execute(base: string, body: unknown): Promise<{ status: number; json: any }> {
  return fetch(`${base}/capabilities/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }).then(async (res) => ({ status: res.status, json: await res.json() }));
}

describe('execute endpoint + transport router', () => {
  it('executes a direct-transport search', async () => {
    const { base } = await startApp({});
    const res = await execute(base, {
      agentId: 'research-agent',
      compartment: 'open-research',
      tool: 'search',
      riskLevel: 'low',
      input: { query: 'hello' }
    });

    expect(res.status).toBe(200);
    expect(res.json.decision.transport).toBe('direct');
    expect(res.json.results).toHaveLength(1);
  });

  it('isolates compartments under concurrent requests', async () => {
    const { base, sessionManager } = await startApp({});
    const [a, b] = await Promise.all([
      execute(base, {
        agentId: 'research-agent',
        compartment: 'open-research',
        tool: 'search',
        riskLevel: 'low',
        input: { query: 'a' }
      }),
      execute(base, {
        agentId: 'research-agent',
        compartment: 'open-research-2',
        tool: 'search',
        riskLevel: 'low',
        input: { query: 'b' }
      })
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const idA = sessionManager.get('open-research');
    const idB = sessionManager.get('open-research-2');
    expect(idA?.sessionId).not.toBe(idB?.sessionId);
    expect(idA?.userAgent).not.toBe(idB?.userAgent);
    expect(idA?.cookieJar).not.toBe(idB?.cookieJar);
  });

  it('denies a request that asserts the wrong transport', async () => {
    const { base } = await startApp({});
    const res = await execute(base, {
      agentId: 'research-agent',
      compartment: 'darknet-research',
      tool: 'search',
      riskLevel: 'low',
      transport: 'direct',
      input: { query: 'x' }
    });

    expect(res.status).toBe(403);
    expect(res.json.decision.allowed).toBe(false);
    expect(res.json.decision.reason).toContain('Transport not permitted');
  });

  it('fails closed (no direct fallback) when Tor is unavailable', async () => {
    const { base, sessionManager } = await startApp({
      // SOCKS endpoint pointing at an almost-certainly-closed port.
      torSocks: { host: '127.0.0.1', port: 1 }
    });
    const res = await execute(base, {
      agentId: 'research-agent',
      compartment: 'darknet-research',
      tool: 'search',
      riskLevel: 'low',
      input: { query: 'x' }
    });

    expect(res.status).toBe(502);
    expect(res.json.decision.transport).toBe('tor');
    // The compartment is bound to tor, never silently downgraded to direct.
    expect(sessionManager.get('darknet-research')?.transport).toBe('tor');
  });

  it('denies unknown compartments by default', async () => {
    const { base } = await startApp({});
    const res = await execute(base, {
      agentId: 'research-agent',
      compartment: 'unknown',
      tool: 'search',
      riskLevel: 'low',
      input: { query: 'x' }
    });

    expect(res.status).toBe(403);
  });
});
