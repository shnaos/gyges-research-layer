import { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RUNTIME_CONFIG,
  RuntimeConfig,
  RuntimeConfigLoader
} from '../../../packages/core/src/index.js';
import {
  buildApprovalQueue,
  buildBootstrapFirewall,
  buildSecurityEventEngine,
  createLocalApiApp,
  DEFAULT_HOST,
  LocalApiOptions
} from '../src/local-api.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function writeConfig(config: RuntimeConfig): string {
  const dir = mkdtempSync(join(tmpdir(), 'grl-config-'));
  const path = join(dir, 'grl.config.json');
  writeFileSync(path, JSON.stringify(config), 'utf8');
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return path;
}

function writeRaw(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'grl-config-'));
  const path = join(dir, 'grl.config.json');
  writeFileSync(path, contents, 'utf8');
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return path;
}

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

describe('runtime config API', () => {
  it('GET /v1/runtime/config returns active snapshot metadata + config', async () => {
    const { base } = await startApp();
    const res = await request(base, '/v1/runtime/config');
    expect(res.status).toBe(200);
    expect(res.json.version).toBe(DEFAULT_RUNTIME_CONFIG.version);
    expect(typeof res.json.checksum).toBe('string');
    expect(typeof res.json.loadedAt).toBe('number');
    expect(res.json.config.compartments[0].id).toBe('research');
  });

  it('GET /v1/runtime/config/checksum returns a deterministic checksum', async () => {
    const { base } = await startApp();
    const a = await request(base, '/v1/runtime/config/checksum');
    const b = await request(base, '/v1/runtime/config/checksum');
    expect(a.status).toBe(200);
    expect(typeof a.json.checksum).toBe('string');
    expect(a.json.checksum).toBe(b.json.checksum);
  });

  it('GET /v1/runtime/config/version returns the config version', async () => {
    const { base } = await startApp();
    const res = await request(base, '/v1/runtime/config/version');
    expect(res.status).toBe(200);
    expect(res.json.version).toBe(DEFAULT_RUNTIME_CONFIG.version);
  });

  it('POST /v1/runtime/reload reloads the file-backed config', async () => {
    const config: RuntimeConfig = {
      ...DEFAULT_RUNTIME_CONFIG,
      version: 7
    };
    const path = writeConfig(config);
    const loader = new RuntimeConfigLoader();
    loader.loadFromFile(path);
    const { base } = await startApp({ runtimeConfigLoader: loader });

    const before = await request(base, '/v1/runtime/config/version');
    expect(before.json.version).toBe(7);

    // Mutate the file on disk, then reload.
    writeFileSync(path, JSON.stringify({ ...config, version: 9 }), 'utf8');
    const reload = await request(base, '/v1/runtime/reload', { method: 'POST' });
    expect(reload.status).toBe(200);
    expect(reload.json.version).toBe(9);

    const after = await request(base, '/v1/runtime/config/version');
    expect(after.json.version).toBe(9);
  });

  it('POST /v1/runtime/reload returns 400 for an invalid config and keeps the old snapshot', async () => {
    const path = writeConfig({ ...DEFAULT_RUNTIME_CONFIG, version: 3 });
    const loader = new RuntimeConfigLoader();
    loader.loadFromFile(path);
    const { base } = await startApp({ runtimeConfigLoader: loader });

    // Write a schema-invalid config (version <= 0).
    writeFileSync(
      path,
      JSON.stringify({ ...DEFAULT_RUNTIME_CONFIG, version: 0 }),
      'utf8'
    );
    const reload = await request(base, '/v1/runtime/reload', { method: 'POST' });
    expect(reload.status).toBe(400);

    // The previous snapshot is preserved.
    const after = await request(base, '/v1/runtime/config/version');
    expect(after.json.version).toBe(3);
  });

  it('POST /v1/runtime/reload returns 404 when no config file is loaded', async () => {
    const { base } = await startApp();
    const reload = await request(base, '/v1/runtime/reload', { method: 'POST' });
    expect(reload.status).toBe(404);
  });

  it('POST /v1/runtime/reload returns 404 when the file is missing', async () => {
    const path = writeConfig({ ...DEFAULT_RUNTIME_CONFIG, version: 2 });
    const loader = new RuntimeConfigLoader();
    loader.loadFromFile(path);
    const { base } = await startApp({ runtimeConfigLoader: loader });
    // Remove the file before reloading; the loader can no longer read it.
    rmSync(path, { force: true });
    const reload = await request(base, '/v1/runtime/reload', { method: 'POST' });
    expect(reload.status).toBe(404);
  });

  it('rejects an invalid JSON config file at load time (fail-closed)', () => {
    const path = writeRaw('{ this is not json');
    const loader = new RuntimeConfigLoader();
    expect(() => loader.loadFromFile(path)).toThrow();
  });

  it('emits a config_loaded audit event on startup', async () => {
    const engine = buildSecurityEventEngine();
    const { base } = await startApp({ securityEventEngine: engine });
    const res = await request(base, '/v1/audit/events?type=config_loaded');
    expect(res.status).toBe(200);
    expect(res.json.events.length).toBeGreaterThanOrEqual(1);
    expect(res.json.events[0].type).toBe('config_loaded');
  });

  it('emits a config_reloaded audit event on a successful reload', async () => {
    const path = writeConfig({ ...DEFAULT_RUNTIME_CONFIG, version: 4 });
    const loader = new RuntimeConfigLoader();
    loader.loadFromFile(path);
    const { base } = await startApp({ runtimeConfigLoader: loader });

    writeFileSync(
      path,
      JSON.stringify({ ...DEFAULT_RUNTIME_CONFIG, version: 5 }),
      'utf8'
    );
    await request(base, '/v1/runtime/reload', { method: 'POST' });

    const res = await request(base, '/v1/audit/events?type=config_reloaded');
    expect(res.status).toBe(200);
    expect(res.json.events.length).toBeGreaterThanOrEqual(1);
  });

  it('never leaks raw file contents, tokens, or secrets in config responses', async () => {
    const { base } = await startApp();
    const res = await request(base, '/v1/runtime/config');
    const serialized = JSON.stringify(res.json).toLowerCase();
    expect(serialized).not.toContain('token');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('password');
  });

  it('returns 405 for unsupported methods on runtime config routes', async () => {
    const { base } = await startApp();
    const post = await request(base, '/v1/runtime/config', { method: 'POST' });
    expect(post.status).toBe(405);
    const putChecksum = await request(base, '/v1/runtime/config/checksum', {
      method: 'PUT'
    });
    expect(putChecksum.status).toBe(405);
    const putVersion = await request(base, '/v1/runtime/config/version', {
      method: 'DELETE'
    });
    expect(putVersion.status).toBe(405);
    const getReload = await request(base, '/v1/runtime/reload');
    expect(getReload.status).toBe(405);
  });
});
