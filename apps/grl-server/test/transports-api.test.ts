import { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ExecutionEngine,
  MockTransportAdapter,
  TransportCapabilityRegistry,
  STRICT_SANDBOX_POLICY
} from '../../../packages/core/src/index.js';
import {
  buildApprovalQueue,
  buildBootstrapFirewall,
  buildBootstrapTransportRegistry,
  buildMockExecutionEngine,
  createLocalApiApp,
  DEFAULT_HOST
} from '../src/local-api.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

interface StartOptions {
  transportRegistry?: TransportCapabilityRegistry;
  executionEngine?: ExecutionEngine;
}

async function startApp(options: StartOptions = {}): Promise<string> {
  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    approvalQueue: buildApprovalQueue(),
    transportRegistry: options.transportRegistry,
    executionEngine: options.executionEngine
  });
  const server = app.listen(0, DEFAULT_HOST);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  cleanups.push(() => server.close());
  return `http://${DEFAULT_HOST}:${address.port}`;
}

async function rawRequest(
  base: string,
  path: string,
  init: RequestInit
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, init);
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function executeMock(
  base: string,
  body: unknown
): Promise<{ status: number; json: any }> {
  return rawRequest(base, '/v1/capabilities/execute-mock', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

/** Body the bootstrap policy allows immediately (no confirmation). */
const ALLOW_BODY = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'search',
  riskLevel: 'low',
  input: 'bitcoin privacy research'
};

describe('GRL Local API — GET /v1/transports', () => {
  it('lists the bootstrap mock manifest without secrets', async () => {
    const base = await startApp();
    const res = await rawRequest(base, '/v1/transports', { method: 'GET' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.transports)).toBe(true);
    expect(res.json.transports).toHaveLength(1);
    const manifest = res.json.transports[0];
    expect(manifest.kind).toBe('mock');
    expect(manifest.name).toBe('Mock Transport Adapter');
    expect(manifest.supportedTools).toEqual(['search', 'fetch_html', 'fetch_json']);
    expect(manifest.networkAccess).toBe(false);
    // No secret / token / key fields are present anywhere in the response.
    const serialized = JSON.stringify(res.json);
    expect(serialized).not.toMatch(/token/i);
    expect(serialized).not.toMatch(/secret/i);
    expect(serialized).not.toMatch(/"key"/i);
  });

  it('returns 405 for a non-GET method', async () => {
    const base = await startApp();
    const res = await rawRequest(base, '/v1/transports', { method: 'POST' });
    expect(res.status).toBe(405);
  });
});

describe('GRL Local API — GET /v1/transports/audit', () => {
  it('returns the capability-audit surface of every transport', async () => {
    const base = await startApp();
    const res = await rawRequest(base, '/v1/transports/audit', { method: 'GET' });

    expect(res.status).toBe(200);
    expect(res.json.audit).toHaveLength(1);
    const entry = res.json.audit[0];
    expect(entry.kind).toBe('mock');
    expect(entry.declaredPermissions).toContain('execute_mock');
    expect(entry).not.toHaveProperty('name');
    expect(entry).not.toHaveProperty('version');
  });

  it('returns 405 for a non-GET method', async () => {
    const base = await startApp();
    const res = await rawRequest(base, '/v1/transports/audit', { method: 'DELETE' });
    expect(res.status).toBe(405);
  });
});

describe('GRL Local API — execute-mock sandbox decision', () => {
  it('includes a sandbox allow decision on a normal allowed execution', async () => {
    const base = await startApp();
    const res = await executeMock(base, ALLOW_BODY);

    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('allowed');
    expect(res.json.execution.status).toBe('success');
    expect(res.json.sandbox).toEqual({ action: 'allow', violations: [] });
  });

  it('blocks execution when the sandbox refuses (injectable test setup)', async () => {
    // A registry whose mock manifest illegally requires network access: under
    // the strict policy this blocks before the adapter runs.
    const registry = new TransportCapabilityRegistry();
    registry.registerManifest({
      kind: 'mock',
      name: 'Mock Transport Adapter',
      version: '0.1.0',
      supportedTools: ['search', 'fetch_html', 'fetch_json'],
      declaredPermissions: ['execute_mock'],
      networkAccess: true,
      browserAccess: false,
      filesystemAccess: false,
      processSpawnAccess: false,
      envAccess: false
    });
    const executionEngine = new ExecutionEngine({
      adapters: [new MockTransportAdapter()],
      registry,
      sandboxPolicy: STRICT_SANDBOX_POLICY
    });

    const base = await startApp({ transportRegistry: registry, executionEngine });
    const res = await executeMock(base, ALLOW_BODY);

    expect(res.status).toBe(200);
    // The firewall still allowed the capability; the sandbox blocked the run.
    expect(res.json.decision).toBe('allowed');
    expect(res.json.execution.status).toBe('blocked');
    expect(res.json.execution.error).toBe('Sandbox blocked transport execution.');
    expect(res.json.execution.output).toBeUndefined();
    expect(res.json.sandbox.action).toBe('block');
    expect(res.json.sandbox.violations.map((v: any) => v.code)).toContain(
      'network_not_allowed'
    );
  });

  it('never exposes a token on the sandbox/transport surface', async () => {
    const base = await startApp();
    const res = await executeMock(base, ALLOW_BODY);
    expect(res.json.approvalToken).toBeUndefined();
    expect(JSON.stringify(res.json.sandbox)).not.toMatch(/token/i);
  });
});

describe('GRL Local API — transport registry bootstrap helper', () => {
  it('builds a registry that contains exactly the mock manifest', () => {
    const registry = buildBootstrapTransportRegistry();
    expect(registry.size()).toBe(1);
    expect(registry.getManifest('mock')?.kind).toBe('mock');
  });
});
