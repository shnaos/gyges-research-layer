import { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { ApprovalQueue } from '../../../packages/core/src/index.js';
import {
  buildApprovalQueue,
  buildBootstrapFirewall,
  createLocalApiApp,
  DEFAULT_HOST,
  resolveServerConfig
} from '../src/local-api.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

interface StartedServer {
  base: string;
  address: AddressInfo;
}

async function startApp(approvalQueue?: ApprovalQueue): Promise<StartedServer> {
  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    approvalQueue: approvalQueue ?? buildApprovalQueue()
  });
  const server = app.listen(0, DEFAULT_HOST);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  cleanups.push(() => server.close());
  return { base: `http://${DEFAULT_HOST}:${address.port}`, address };
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

function postJson(
  base: string,
  path: string,
  body: unknown
): Promise<{ status: number; json: any }> {
  return rawRequest(base, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

/** Body that the bootstrap policy resolves to a pending (confirmation) decision. */
const PENDING_BODY = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'fetch_html',
  riskLevel: 'medium',
  input: 'sensitive lookup'
};

/** Body that the bootstrap policy allows immediately. */
const ALLOW_BODY = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'search',
  riskLevel: 'low',
  input: 'public lookup'
};

/** Body that the bootstrap policy denies. */
const DENY_BODY = {
  agentId: 'rogue-agent',
  compartmentId: 'research',
  tool: 'search',
  riskLevel: 'low',
  input: 'x'
};

describe('GRL Local API — POST /v1/capabilities/request', () => {
  it('returns pending with an approvalRequestId and approvalToken', async () => {
    const { base } = await startApp();
    const res = await postJson(base, '/v1/capabilities/request', PENDING_BODY);
    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('pending');
    expect(typeof res.json.approvalRequestId).toBe('string');
    expect(typeof res.json.approvalToken).toBe('string');
    expect(res.json.approvalRequestId.length).toBeGreaterThan(0);
    expect(res.json.approvalToken.length).toBeGreaterThan(0);
  });

  it('returns allowed for an immediately permitted capability', async () => {
    const { base } = await startApp();
    const res = await postJson(base, '/v1/capabilities/request', ALLOW_BODY);
    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('allowed');
    expect(res.json.sanitizedInput).toBe('public lookup');
    expect('approvalToken' in res.json).toBe(false);
  });

  it('returns denied for a refused capability', async () => {
    const { base } = await startApp();
    const res = await postJson(base, '/v1/capabilities/request', DENY_BODY);
    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('denied');
    expect('approvalToken' in res.json).toBe(false);
    expect('sanitizedInput' in res.json).toBe(false);
  });

  it('rejects a malformed body with 400', async () => {
    const { base } = await startApp();
    const res = await postJson(base, '/v1/capabilities/request', { agentId: 'x' });
    expect(res.status).toBe(400);
  });

  it('wrong method => 405', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/capabilities/request', { method: 'GET' });
    expect(res.status).toBe(405);
  });
});

describe('GRL Local API — GET /v1/approvals/pending', () => {
  it('lists pending requests without exposing the token', async () => {
    const { base } = await startApp();
    const created = await postJson(base, '/v1/capabilities/request', PENDING_BODY);
    const res = await rawRequest(base, '/v1/approvals/pending', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.pending)).toBe(true);
    expect(res.json.pending).toHaveLength(1);
    const [item] = res.json.pending;
    expect(item.id).toBe(created.json.approvalRequestId);
    expect(item.status).toBe('pending');
    // No secret material of any kind in the listing.
    expect('token' in item).toBe(false);
    expect('approvalToken' in item).toBe(false);
    expect('tokenValue' in item).toBe(false);
    expect(JSON.stringify(res.json)).not.toContain(created.json.approvalToken);
  });

  it('wrong method => 405', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/approvals/pending', { method: 'POST' });
    expect(res.status).toBe(405);
  });
});

describe('GRL Local API — approve / reject endpoints', () => {
  it('approves a pending request with a valid token (200)', async () => {
    const { base } = await startApp();
    const created = await postJson(base, '/v1/capabilities/request', PENDING_BODY);
    const { approvalRequestId, approvalToken } = created.json;
    const res = await postJson(base, `/v1/approvals/${approvalRequestId}/approve`, {
      token: approvalToken
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ id: approvalRequestId, status: 'approved' });
    // It is no longer pending.
    const pending = await rawRequest(base, '/v1/approvals/pending', { method: 'GET' });
    expect(pending.json.pending).toHaveLength(0);
  });

  it('rejects a pending request with a valid token (200)', async () => {
    const { base } = await startApp();
    const created = await postJson(base, '/v1/capabilities/request', PENDING_BODY);
    const { approvalRequestId, approvalToken } = created.json;
    const res = await postJson(base, `/v1/approvals/${approvalRequestId}/reject`, {
      token: approvalToken
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ id: approvalRequestId, status: 'rejected' });
  });

  it('returns 400 for an invalid token', async () => {
    const { base } = await startApp();
    const created = await postJson(base, '/v1/capabilities/request', PENDING_BODY);
    const res = await postJson(
      base,
      `/v1/approvals/${created.json.approvalRequestId}/approve`,
      { token: 'wrong-token' }
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when the token field is missing', async () => {
    const { base } = await startApp();
    const created = await postJson(base, '/v1/capabilities/request', PENDING_BODY);
    const res = await postJson(
      base,
      `/v1/approvals/${created.json.approvalRequestId}/approve`,
      {}
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown request id', async () => {
    const { base } = await startApp();
    const res = await postJson(base, '/v1/approvals/does-not-exist/approve', {
      token: 'whatever'
    });
    expect(res.status).toBe(404);
  });

  it('returns 409 when the request is already finalized (double approve)', async () => {
    const { base } = await startApp();
    const created = await postJson(base, '/v1/capabilities/request', PENDING_BODY);
    const { approvalRequestId, approvalToken } = created.json;
    const first = await postJson(base, `/v1/approvals/${approvalRequestId}/approve`, {
      token: approvalToken
    });
    expect(first.status).toBe(200);
    const second = await postJson(base, `/v1/approvals/${approvalRequestId}/approve`, {
      token: approvalToken
    });
    expect(second.status).toBe(409);
  });

  it('returns 410 once the request has expired', async () => {
    let clock = 0;
    const queue = new ApprovalQueue({ ttlMs: 1_000, now: () => clock });
    const { base } = await startApp(queue);
    const created = await postJson(base, '/v1/capabilities/request', PENDING_BODY);
    const { approvalRequestId, approvalToken } = created.json;
    // Advance the injected clock beyond the TTL.
    clock = 2_000;
    const res = await postJson(base, `/v1/approvals/${approvalRequestId}/approve`, {
      token: approvalToken
    });
    expect(res.status).toBe(410);
    // An expired request is no longer listed as pending either.
    const pending = await rawRequest(base, '/v1/approvals/pending', { method: 'GET' });
    expect(pending.json.pending).toHaveLength(0);
  });
});

describe('GRL Local API — approval TTL config', () => {
  it('defaults the approval TTL when env is empty', () => {
    const config = resolveServerConfig({});
    expect(config.approvalTtlMs).toBe(10 * 60 * 1000);
  });

  it('reads GRL_APPROVAL_TTL_MS from an injected env', () => {
    const config = resolveServerConfig({
      GRL_APPROVAL_TTL_MS: '1234'
    } as NodeJS.ProcessEnv);
    expect(config.approvalTtlMs).toBe(1234);
  });

  it('falls back to the default for a non-positive TTL', () => {
    const config = resolveServerConfig({
      GRL_APPROVAL_TTL_MS: '0'
    } as NodeJS.ProcessEnv);
    expect(config.approvalTtlMs).toBe(10 * 60 * 1000);
  });
});
