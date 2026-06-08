/**
 * CLI config resolution tests.
 *
 * Regression coverage for `resolveCliConfig`: an unset CLI flag is passed to the
 * resolver as `undefined` (commander leaves unspecified options undefined). Those
 * `undefined` override values must NOT clobber the hardcoded / file / env values
 * back to `undefined` — otherwise every command crashes with
 * `Cannot read properties of undefined (reading 'replace')` when building the
 * API client baseUrl.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { resolveCliConfig, DEFAULT_CLI_CONFIG } from '../src/config/cli-config.js';

describe('resolveCliConfig', () => {
  const savedEnv = {
    url: process.env['GRL_CLI_BASE_URL'],
    timeout: process.env['GRL_CLI_TIMEOUT_MS'],
    output: process.env['GRL_CLI_OUTPUT']
  };

  afterEach(() => {
    if (savedEnv.url === undefined) delete process.env['GRL_CLI_BASE_URL'];
    else process.env['GRL_CLI_BASE_URL'] = savedEnv.url;
    if (savedEnv.timeout === undefined) delete process.env['GRL_CLI_TIMEOUT_MS'];
    else process.env['GRL_CLI_TIMEOUT_MS'] = savedEnv.timeout;
    if (savedEnv.output === undefined) delete process.env['GRL_CLI_OUTPUT'];
    else process.env['GRL_CLI_OUTPUT'] = savedEnv.output;
  });

  it('falls back to defaults when no overrides are given', () => {
    const cfg = resolveCliConfig();
    expect(cfg.baseUrl).toBe(DEFAULT_CLI_CONFIG.baseUrl);
    expect(cfg.timeoutMs).toBe(DEFAULT_CLI_CONFIG.timeoutMs);
    expect(cfg.output).toBe(DEFAULT_CLI_CONFIG.output);
  });

  it('does not clobber defaults when overrides are explicitly undefined', () => {
    // This is exactly what runCommand passes when no flags are set.
    const cfg = resolveCliConfig({
      baseUrl: undefined,
      timeoutMs: undefined,
      output: undefined
    });
    expect(cfg.baseUrl).toBe(DEFAULT_CLI_CONFIG.baseUrl);
    expect(cfg.baseUrl).toBeTypeOf('string');
    expect(cfg.timeoutMs).toBe(DEFAULT_CLI_CONFIG.timeoutMs);
    expect(cfg.output).toBe(DEFAULT_CLI_CONFIG.output);
  });

  it('applies defined overrides over defaults', () => {
    const cfg = resolveCliConfig({ baseUrl: 'http://127.0.0.1:9999', output: 'json' });
    expect(cfg.baseUrl).toBe('http://127.0.0.1:9999');
    expect(cfg.output).toBe('json');
    expect(cfg.timeoutMs).toBe(DEFAULT_CLI_CONFIG.timeoutMs);
  });

  it('reads baseUrl from the environment when no override is given', () => {
    process.env['GRL_CLI_BASE_URL'] = 'http://127.0.0.1:7000';
    const cfg = resolveCliConfig({ baseUrl: undefined });
    expect(cfg.baseUrl).toBe('http://127.0.0.1:7000');
  });
});
