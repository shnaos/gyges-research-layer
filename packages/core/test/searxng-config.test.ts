/**
 * SearXNG transport runtime config — unit tests.
 *
 * Tests cover:
 *   - transports.searxng valid config accepted
 *   - disabled by default (no transports key → undefined)
 *   - invalid baseUrl rejected
 *   - invalid timeout rejected
 *   - invalid maxResults rejected
 *   - optional field: absence is valid
 */

import { describe, expect, it } from 'vitest';
import { validateRuntimeConfig } from '../src/runtime-config/validator.js';
import { DEFAULT_RUNTIME_CONFIG } from '../src/runtime-config/bootstrap.js';
import { deepClone } from '../src/runtime-config/snapshot.js';

/** Build a minimal valid base config from the defaults. */
function makeBaseConfig(): ReturnType<typeof deepClone<typeof DEFAULT_RUNTIME_CONFIG>> {
  return deepClone(DEFAULT_RUNTIME_CONFIG);
}

describe('RuntimeConfig — transports.searxng validation', () => {
  it('is valid without a transports field (disabled by default)', () => {
    const cfg = makeBaseConfig();
    // DEFAULT_RUNTIME_CONFIG has no transports field
    const result = validateRuntimeConfig(cfg);
    expect(result.transports).toBeUndefined();
  });

  it('accepts an explicitly disabled searxng config', () => {
    const cfg = {
      ...makeBaseConfig(),
      transports: {
        searxng: {
          baseUrl: 'http://127.0.0.1:8080',
          timeoutMs: 5000,
          maxResults: 10,
          enabled: false
        }
      }
    };
    const result = validateRuntimeConfig(cfg);
    expect(result.transports?.searxng?.enabled).toBe(false);
  });

  it('accepts an enabled searxng config with valid loopback baseUrl', () => {
    const cfg = {
      ...makeBaseConfig(),
      transports: {
        searxng: {
          baseUrl: 'http://127.0.0.1:9090',
          timeoutMs: 3000,
          maxResults: 5,
          enabled: true
        }
      }
    };
    const result = validateRuntimeConfig(cfg);
    expect(result.transports?.searxng?.enabled).toBe(true);
    expect(result.transports?.searxng?.baseUrl).toBe('http://127.0.0.1:9090');
    expect(result.transports?.searxng?.timeoutMs).toBe(3000);
    expect(result.transports?.searxng?.maxResults).toBe(5);
  });

  it('accepts localhost as baseUrl', () => {
    const cfg = {
      ...makeBaseConfig(),
      transports: { searxng: { baseUrl: 'http://localhost:8080', timeoutMs: 5000, maxResults: 10, enabled: false } }
    };
    const result = validateRuntimeConfig(cfg);
    expect(result.transports?.searxng?.baseUrl).toBe('http://localhost:8080');
  });

  it('rejects non-string baseUrl', () => {
    const cfg = {
      ...makeBaseConfig(),
      transports: { searxng: { baseUrl: 42, timeoutMs: 5000, maxResults: 10, enabled: false } }
    };
    expect(() => validateRuntimeConfig(cfg)).toThrow();
  });

  it('rejects empty string baseUrl', () => {
    const cfg = {
      ...makeBaseConfig(),
      transports: { searxng: { baseUrl: '', timeoutMs: 5000, maxResults: 10, enabled: false } }
    };
    expect(() => validateRuntimeConfig(cfg)).toThrow();
  });

  it('rejects negative timeoutMs', () => {
    const cfg = {
      ...makeBaseConfig(),
      transports: { searxng: { baseUrl: 'http://127.0.0.1:8080', timeoutMs: -1, maxResults: 10, enabled: false } }
    };
    expect(() => validateRuntimeConfig(cfg)).toThrow();
  });

  it('rejects zero timeoutMs', () => {
    const cfg = {
      ...makeBaseConfig(),
      transports: { searxng: { baseUrl: 'http://127.0.0.1:8080', timeoutMs: 0, maxResults: 10, enabled: false } }
    };
    expect(() => validateRuntimeConfig(cfg)).toThrow();
  });

  it('rejects non-integer maxResults', () => {
    const cfg = {
      ...makeBaseConfig(),
      transports: { searxng: { baseUrl: 'http://127.0.0.1:8080', timeoutMs: 5000, maxResults: 1.5, enabled: false } }
    };
    expect(() => validateRuntimeConfig(cfg)).toThrow();
  });

  it('rejects zero maxResults', () => {
    const cfg = {
      ...makeBaseConfig(),
      transports: { searxng: { baseUrl: 'http://127.0.0.1:8080', timeoutMs: 5000, maxResults: 0, enabled: false } }
    };
    expect(() => validateRuntimeConfig(cfg)).toThrow();
  });

  it('rejects non-boolean enabled', () => {
    const cfg = {
      ...makeBaseConfig(),
      transports: { searxng: { baseUrl: 'http://127.0.0.1:8080', timeoutMs: 5000, maxResults: 10, enabled: 'yes' } }
    };
    expect(() => validateRuntimeConfig(cfg)).toThrow();
  });

  it('accepts an empty transports object (no searxng key)', () => {
    const cfg = { ...makeBaseConfig(), transports: {} };
    const result = validateRuntimeConfig(cfg);
    expect(result.transports).toBeDefined();
    expect(result.transports?.searxng).toBeUndefined();
  });
});
