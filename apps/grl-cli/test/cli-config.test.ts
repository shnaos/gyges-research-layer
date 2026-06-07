import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveCliConfig, DEFAULT_CLI_CONFIG } from '../src/config/cli-config.js';

const ENV_KEYS = ['GRL_CLI_BASE_URL', 'GRL_CLI_TIMEOUT_MS', 'GRL_CLI_OUTPUT'] as const;

describe('resolveCliConfig', () => {
  const saved: Partial<Record<string, string>> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      const v = saved[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('returns defaults when called with no arguments', () => {
    expect(resolveCliConfig()).toEqual(DEFAULT_CLI_CONFIG);
  });

  it('undefined override fields do not shadow lower-precedence defaults (regression)', () => {
    // Before the fix, resolveCliConfig({ baseUrl: undefined }) overwrote the default
    // because undefined spread values beat earlier keys in an object literal.
    const config = resolveCliConfig({ baseUrl: undefined, timeoutMs: undefined });
    expect(config.baseUrl).toBe(DEFAULT_CLI_CONFIG.baseUrl);
    expect(config.timeoutMs).toBe(DEFAULT_CLI_CONFIG.timeoutMs);
  });

  it('defined override values win over defaults', () => {
    const config = resolveCliConfig({ baseUrl: 'http://custom:9000', timeoutMs: 10_000 });
    expect(config.baseUrl).toBe('http://custom:9000');
    expect(config.timeoutMs).toBe(10_000);
    expect(config.output).toBe(DEFAULT_CLI_CONFIG.output);
  });

  it('env var overrides default, defined CLI flag overrides env var', () => {
    process.env['GRL_CLI_BASE_URL'] = 'http://env:7777';
    expect(resolveCliConfig().baseUrl).toBe('http://env:7777');
    expect(resolveCliConfig({ baseUrl: 'http://flag:9999' }).baseUrl).toBe('http://flag:9999');
  });

  it('undefined CLI flag does not shadow env var', () => {
    process.env['GRL_CLI_BASE_URL'] = 'http://env:7777';
    expect(resolveCliConfig({ baseUrl: undefined }).baseUrl).toBe('http://env:7777');
  });
});
