import { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildBootstrapFirewall,
  createLocalApiApp,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_MAX_BODY_BYTES,
  resolveServerConfig
} from '../src/local-api.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

interface StartedServer {
  base: string;
  address: AddressInfo;
  close: () => void;
}

async function startApp(maxBodyBytes?: number): Promise<StartedServer> {
  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    maxBodyBytes
  });
  const server = app.listen(0, DEFAULT_HOST);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  cleanups.push(() => server.close());
  return {
    base: `http://${DEFAULT_HOST}:${address.port}`,
    address,
    close: () => server.close()
  };
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

function evaluate(base: string, body: unknown): Promise<{ status: number; json: any }> {
  return rawRequest(base, '/v1/capabilities/evaluate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

describe('GRL Local API — health', () => {
  it('GET /v1/health => 200', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/health', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ status: 'ok', service: 'grl-server' });
  });

  it('wrong method on /v1/health => 405', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/health', { method: 'POST' });
    expect(res.status).toBe(405);
  });
});

describe('GRL Local API — evaluate', () => {
  it('allows the exact bootstrap policy and returns sanitizedInput', async () => {
    const { base } = await startApp();
    const res = await evaluate(base, {
      agentId: 'local-agent',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low',
      input: 'bitcoin privacy research'
    });
    expect(res.status).toBe(200);
    expect(res.json.allowed).toBe(true);
    expect(res.json.requiresConfirmation).toBe(false);
    expect(res.json.sanitizedInput).toBe('bitcoin privacy research');
  });

  it('denies an unknown agent (200, allowed=false)', async () => {
    const { base } = await startApp();
    const res = await evaluate(base, {
      agentId: 'rogue-agent',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low',
      input: 'x'
    });
    expect(res.status).toBe(200);
    expect(res.json.allowed).toBe(false);
  });

  it('denies an unknown compartment (200, allowed=false)', async () => {
    const { base } = await startApp();
    const res = await evaluate(base, {
      agentId: 'local-agent',
      compartmentId: 'unknown',
      tool: 'search',
      riskLevel: 'low',
      input: 'x'
    });
    expect(res.status).toBe(200);
    expect(res.json.allowed).toBe(false);
  });

  it('denies a risk overflow (medium over maxRiskLevel=low)', async () => {
    const { base } = await startApp();
    const res = await evaluate(base, {
      agentId: 'local-agent',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'medium',
      input: 'x'
    });
    expect(res.status).toBe(200);
    expect(res.json.allowed).toBe(false);
  });

  it('denies an unauthorized tool (200, allowed=false)', async () => {
    const { base } = await startApp();
    const res = await evaluate(base, {
      agentId: 'local-agent',
      compartmentId: 'research',
      tool: 'delete_everything',
      riskLevel: 'low',
      input: 'x'
    });
    expect(res.status).toBe(200);
    expect(res.json.allowed).toBe(false);
  });

  it('a firewall deny returns 200, not 4xx', async () => {
    const { base } = await startApp();
    const res = await evaluate(base, {
      agentId: 'local-agent',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'high',
      input: 'x'
    });
    expect(res.status).toBe(200);
    expect(res.json.allowed).toBe(false);
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(403);
  });

  it('does not leak sanitizedInput on a deny', async () => {
    const { base } = await startApp();
    const res = await evaluate(base, {
      agentId: 'local-agent',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'medium',
      input: 'secret'
    });
    expect(res.status).toBe(200);
    expect(res.json.allowed).toBe(false);
    expect('sanitizedInput' in res.json).toBe(false);
  });
});

describe('GRL Local API — HTTP validation', () => {
  it('missing body fields => 400', async () => {
    const { base } = await startApp();
    const res = await evaluate(base, { agentId: 'local-agent' });
    expect(res.status).toBe(400);
  });

  it('absent body => 400', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/capabilities/evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    });
    expect(res.status).toBe(400);
  });

  it('invalid JSON => 400', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/capabilities/evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not valid json'
    });
    expect(res.status).toBe(400);
  });

  it('incorrect content-type => 400', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/capabilities/evaluate', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({
        agentId: 'local-agent',
        compartmentId: 'research',
        tool: 'search',
        riskLevel: 'low',
        input: 'x'
      })
    });
    expect(res.status).toBe(400);
  });

  it('payload too large => 413', async () => {
    const { base } = await startApp(64);
    const res = await evaluate(base, {
      agentId: 'local-agent',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low',
      input: 'x'.repeat(512)
    });
    expect(res.status).toBe(413);
  });

  it('unknown route => 404', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/does-not-exist', { method: 'GET' });
    expect(res.status).toBe(404);
  });

  it('wrong method on evaluate => 405', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/capabilities/evaluate', { method: 'GET' });
    expect(res.status).toBe(405);
  });
});

describe('GRL Local API — local-only binding & config', () => {
  it('listens on 127.0.0.1 by default', async () => {
    const { address } = await startApp();
    expect(address.address).toBe('127.0.0.1');
  });

  it('resolves default host/port/body when env is empty', () => {
    const config = resolveServerConfig({});
    expect(config.host).toBe(DEFAULT_HOST);
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.maxBodyBytes).toBe(DEFAULT_MAX_BODY_BYTES);
  });

  it('reads host/port/body from an injected env without global side effects', () => {
    const config = resolveServerConfig({
      GRL_HOST: '127.0.0.1',
      GRL_PORT: '9999',
      GRL_MAX_BODY_BYTES: '1024'
    } as NodeJS.ProcessEnv);
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(9999);
    expect(config.maxBodyBytes).toBe(1024);
    // The real process environment is untouched.
    expect(process.env.GRL_PORT).toBeUndefined();
  });

  it('never defaults to 0.0.0.0', () => {
    expect(resolveServerConfig({}).host).not.toBe('0.0.0.0');
  });
});
