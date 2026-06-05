import { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildApprovalQueue,
  buildBootstrapFirewall,
  buildSecurityEventEngine,
  createLocalApiApp,
  DEFAULT_HOST,
  LocalApiOptions
} from '../src/local-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

async function startApp(
  extra: Partial<LocalApiOptions> = {}
): Promise<{ base: string }> {
  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    approvalQueue: buildApprovalQueue(),
    securityEventEngine: buildSecurityEventEngine(),
    ...extra
  });
  const server = app.listen(0, DEFAULT_HOST);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  cleanups.push(() => server.close());
  return { base: `http://${DEFAULT_HOST}:${address.port}` };
}

async function request(
  base: string,
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

// ---------------------------------------------------------------------------
// GET /v1/runtime/profiles
// ---------------------------------------------------------------------------

describe('GET /v1/runtime/profiles', () => {
  it('returns 200 with all 4 built-in profiles', async () => {
    const { base } = await startApp();
    const res = await request(base, '/v1/runtime/profiles');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.profiles)).toBe(true);
    const names = res.json.profiles.map((p: any) => p.name);
    expect(names).toContain('strict');
    expect(names).toContain('balanced');
    expect(names).toContain('research');
    expect(names).toContain('development');
  });

  it('returns profile metadata — name, enabled, packIds', async () => {
    const { base } = await startApp();
    const res = await request(base, '/v1/runtime/profiles');
    const strict = res.json.profiles.find((p: any) => p.name === 'strict');
    expect(strict).toBeDefined();
    expect(strict.enabled).toBe(true);
    expect(Array.isArray(strict.packIds)).toBe(true);
    expect(strict.packIds.length).toBeGreaterThan(0);
  });

  it('never leaks tokens or raw input', async () => {
    const { base } = await startApp();
    const res = await request(base, '/v1/runtime/profiles');
    const text = JSON.stringify(res.json);
    expect(text).not.toMatch(/token/i);
    expect(text).not.toMatch(/secret/i);
    expect(text).not.toMatch(/password/i);
  });

  it('405 for wrong method', async () => {
    const { base } = await startApp();
    const res = await request(base, '/v1/runtime/profiles', { method: 'POST' });
    expect(res.status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/runtime/packs
// ---------------------------------------------------------------------------

describe('GET /v1/runtime/packs', () => {
  it('returns 200 with all 7 built-in packs', async () => {
    const { base } = await startApp();
    const res = await request(base, '/v1/runtime/packs');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.packs)).toBe(true);
    expect(res.json.packs.length).toBe(7);
  });

  it('returns pack metadata — id, definedFields', async () => {
    const { base } = await startApp();
    const res = await request(base, '/v1/runtime/packs');
    for (const pack of res.json.packs) {
      expect(typeof pack.id).toBe('string');
      expect(Array.isArray(pack.definedFields)).toBe(true);
    }
  });

  it('never leaks tokens or raw input', async () => {
    const { base } = await startApp();
    const res = await request(base, '/v1/runtime/packs');
    const text = JSON.stringify(res.json);
    expect(text).not.toMatch(/token/i);
    expect(text).not.toMatch(/secret/i);
  });

  it('405 for wrong method', async () => {
    const { base } = await startApp();
    const res = await request(base, '/v1/runtime/packs', { method: 'POST' });
    expect(res.status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/runtime/profile
// ---------------------------------------------------------------------------

describe('GET /v1/runtime/profile', () => {
  it('returns 200 with the active profile', async () => {
    const { base } = await startApp();
    const res = await request(base, '/v1/runtime/profile');
    expect(res.status).toBe(200);
    expect(res.json.profile).toBeDefined();
    expect(typeof res.json.profile.name).toBe('string');
  });

  it('defaults to balanced profile', async () => {
    const { base } = await startApp();
    const res = await request(base, '/v1/runtime/profile');
    expect(res.json.profile.name).toBe('balanced');
  });

  it('respects activeProfileName option (strict)', async () => {
    const { base } = await startApp({ activeProfileName: 'strict' });
    const res = await request(base, '/v1/runtime/profile');
    expect(res.json.profile.name).toBe('strict');
  });

  it('405 for wrong method (PUT)', async () => {
    const { base } = await startApp();
    const res = await request(base, '/v1/runtime/profile', { method: 'PUT' });
    expect(res.status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// POST /v1/runtime/profile/:name
// ---------------------------------------------------------------------------

describe('POST /v1/runtime/profile/:name', () => {
  it('switches to a valid profile and returns 200', async () => {
    const { base } = await startApp();
    const res = await request(base, '/v1/runtime/profile/strict', {
      method: 'POST'
    });
    expect(res.status).toBe(200);
    expect(res.json.profile.name).toBe('strict');
    expect(typeof res.json.switchedAt).toBe('number');
  });

  it('reflects the new active profile after switch', async () => {
    const { base } = await startApp();
    await request(base, '/v1/runtime/profile/research', { method: 'POST' });
    const active = await request(base, '/v1/runtime/profile');
    expect(active.json.profile.name).toBe('research');
  });

  it('returns 404 for an unknown profile name', async () => {
    const { base } = await startApp();
    const res = await request(base, '/v1/runtime/profile/nonexistent', {
      method: 'POST'
    });
    expect(res.status).toBe(404);
    expect(typeof res.json.error).toBe('string');
  });

  it('preserves old profile when switch fails (unknown name)', async () => {
    const { base } = await startApp({ activeProfileName: 'balanced' });
    await request(base, '/v1/runtime/profile/nonexistent', { method: 'POST' });
    const active = await request(base, '/v1/runtime/profile');
    expect(active.json.profile.name).toBe('balanced');
  });

  it('never leaks tokens or raw input in error response', async () => {
    const { base } = await startApp();
    const res = await request(base, '/v1/runtime/profile/nonexistent', {
      method: 'POST'
    });
    const text = JSON.stringify(res.json);
    expect(text).not.toMatch(/token/i);
    expect(text).not.toMatch(/secret/i);
  });

  it('405 for GET on /v1/runtime/profile/:name', async () => {
    const { base } = await startApp();
    const res = await request(base, '/v1/runtime/profile/strict', {
      method: 'GET'
    });
    expect(res.status).toBe(405);
  });

  it('can switch between all 4 profiles', async () => {
    const { base } = await startApp();
    for (const name of ['strict', 'balanced', 'research', 'development'] as const) {
      const res = await request(base, `/v1/runtime/profile/${name}`, {
        method: 'POST'
      });
      expect(res.status).toBe(200);
      expect(res.json.profile.name).toBe(name);
    }
  });
});

// ---------------------------------------------------------------------------
// Audit events emitted on profile operations
// ---------------------------------------------------------------------------

describe('audit events for profile operations', () => {
  it('emits runtime_profile_loaded at boot', async () => {
    const { base } = await startApp({ activeProfileName: 'strict' });
    const events = await request(base, '/v1/audit/events');
    const types = events.json.events.map((e: any) => e.type);
    expect(types).toContain('runtime_profile_loaded');
  });

  it('emits runtime_profile_switched on successful switch', async () => {
    const { base } = await startApp();
    await request(base, '/v1/runtime/profile/strict', { method: 'POST' });
    const events = await request(base, '/v1/audit/events');
    const types = events.json.events.map((e: any) => e.type);
    expect(types).toContain('runtime_profile_switched');
  });

  it('emits runtime_profile_switch_failed on unknown profile switch', async () => {
    const { base } = await startApp();
    await request(base, '/v1/runtime/profile/nonexistent', { method: 'POST' });
    const events = await request(base, '/v1/audit/events');
    const types = events.json.events.map((e: any) => e.type);
    expect(types).toContain('runtime_profile_switch_failed');
  });

  it('emits policy_pack_applied at boot', async () => {
    const { base } = await startApp({ activeProfileName: 'balanced' });
    const events = await request(base, '/v1/audit/events');
    const types = events.json.events.map((e: any) => e.type);
    expect(types).toContain('policy_pack_applied');
  });
});
