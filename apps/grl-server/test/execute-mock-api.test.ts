import { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { ApprovalQueue } from '../../../packages/core/src/index.js';
import {
  buildApprovalQueue,
  buildBootstrapFirewall,
  buildMockExecutionEngine,
  createLocalApiApp,
  DEFAULT_HOST
} from '../src/local-api.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

interface StartedServer {
  base: string;
  approvalQueue: ApprovalQueue;
}

async function startApp(): Promise<StartedServer> {
  const approvalQueue = buildApprovalQueue();
  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    approvalQueue,
    executionEngine: buildMockExecutionEngine()
  });
  const server = app.listen(0, DEFAULT_HOST);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  cleanups.push(() => server.close());
  return { base: `http://${DEFAULT_HOST}:${address.port}`, approvalQueue };
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
  body: unknown,
  init: RequestInit = {}
): Promise<{ status: number; json: any }> {
  return rawRequest(base, '/v1/capabilities/execute-mock', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...init
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

/** Body the bootstrap policy allows but flags for confirmation. */
const PENDING_BODY = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'fetch_html',
  riskLevel: 'medium',
  input: 'sensitive lookup'
};

/** Body the bootstrap policy denies. */
const DENY_BODY = {
  agentId: 'rogue-agent',
  compartmentId: 'research',
  tool: 'search',
  riskLevel: 'low',
  input: 'x'
};

describe('GRL Local API — execute-mock (allowed)', () => {
  it('executes via the mock transport and returns a success result', async () => {
    const { base } = await startApp();
    const res = await executeMock(base, ALLOW_BODY);

    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('allowed');
    expect(res.json.execution.status).toBe('success');
    expect(res.json.execution.transportKind).toBe('mock');
    expect(res.json.execution.output.mock).toBe(true);
    expect(res.json.execution.output.tool).toBe('search');
    expect(res.json.execution.output.input).toBe('bitcoin privacy research');
    expect(typeof res.json.execution.output.sessionId).toBe('string');
  });

  it('never exposes an approval token on an allowed execution', async () => {
    const { base } = await startApp();
    const res = await executeMock(base, ALLOW_BODY);
    expect(res.json.approvalToken).toBeUndefined();
    expect(res.json.approvalRequestId).toBeUndefined();
  });
});

describe('GRL Local API — execute-mock (denied)', () => {
  it('denies without executing and without an execution payload', async () => {
    const { base } = await startApp();
    const res = await executeMock(base, DENY_BODY);

    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('denied');
    expect(res.json.execution).toBeUndefined();
    expect(res.json.approvalToken).toBeUndefined();
  });
});

describe('GRL Local API — execute-mock (pending)', () => {
  it('enqueues an approval request and never executes', async () => {
    const { base, approvalQueue } = await startApp();
    const res = await executeMock(base, PENDING_BODY);

    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('pending');
    expect(res.json.execution).toBeUndefined();
    expect(typeof res.json.approvalRequestId).toBe('string');
    expect(typeof res.json.approvalToken).toBe('string');
    expect(approvalQueue.size()).toBe(1);
  });
});

describe('GRL Local API — execute-mock (validation & routing)', () => {
  it('rejects a non-JSON content type with 400', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/capabilities/execute-mock', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'not json'
    });
    expect(res.status).toBe(400);
  });

  it('rejects a missing field with 400', async () => {
    const { base } = await startApp();
    const res = await executeMock(base, {
      agentId: 'local-agent',
      compartmentId: 'research',
      tool: 'search',
      input: 'x'
    });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid riskLevel with 400', async () => {
    const { base } = await startApp();
    const res = await executeMock(base, {
      ...ALLOW_BODY,
      riskLevel: 'nuclear'
    });
    expect(res.status).toBe(400);
  });

  it('returns 405 for a wrong method', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/capabilities/execute-mock', {
      method: 'GET'
    });
    expect(res.status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// H-01: execute-mock guard — blocked outside test/mock-enabled environments
// ---------------------------------------------------------------------------

describe('H-01: execute-mock endpoint guard', () => {
  it('returns 403 MOCK_TRANSPORT_BLOCKED when NODE_ENV is not test and ENABLE_RUNTIME_MOCKS is unset', async () => {
    const origNodeEnv = process.env['NODE_ENV'];
    const origEnableMocks = process.env['ENABLE_RUNTIME_MOCKS'];
    process.env['NODE_ENV'] = 'production';
    delete process.env['ENABLE_RUNTIME_MOCKS'];
    try {
      const { base } = await startApp();
      const res = await executeMock(base, ALLOW_BODY);
      expect(res.status).toBe(403);
      expect(res.json.decision).toBe('denied');
      expect(res.json.reason).toContain('MOCK_TRANSPORT_BLOCKED');
    } finally {
      process.env['NODE_ENV'] = origNodeEnv;
      if (origEnableMocks !== undefined) {
        process.env['ENABLE_RUNTIME_MOCKS'] = origEnableMocks;
      }
    }
  });

  it('allows execute-mock when ENABLE_RUNTIME_MOCKS=true even when NODE_ENV is not test', async () => {
    const origNodeEnv = process.env['NODE_ENV'];
    const origEnableMocks = process.env['ENABLE_RUNTIME_MOCKS'];
    process.env['NODE_ENV'] = 'production';
    process.env['ENABLE_RUNTIME_MOCKS'] = 'true';
    try {
      const { base } = await startApp();
      const res = await executeMock(base, ALLOW_BODY);
      expect(res.status).toBe(200);
      expect(['allowed', 'pending_approval']).toContain(res.json.decision);
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
