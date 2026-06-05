import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_RUNTIME_CONFIG,
  RuntimeConfig,
  RuntimeConfigLoader,
  RuntimeConfigEvent,
  RuntimeConfigValidationError,
  computeChecksum,
  createSnapshot,
  validateRuntimeConfig
} from '../src/index.js';

/** A deep, mutable clone of the fallback config for per-test mutation. */
function validConfig(): RuntimeConfig {
  return JSON.parse(JSON.stringify(DEFAULT_RUNTIME_CONFIG)) as RuntimeConfig;
}

const tmpDirs: string[] = [];

/** Write `content` to a fresh temp file and return its path. */
function writeTempConfig(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'grl-config-'));
  tmpDirs.push(dir);
  const path = join(dir, 'grl.config.json');
  writeFileSync(path, content, 'utf8');
  return path;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('validateRuntimeConfig', () => {
  it('accepts the fallback config', () => {
    const config = validateRuntimeConfig(validConfig());
    expect(config.version).toBe(1);
    expect(config.compartments).toHaveLength(1);
  });

  it('rejects a non-object', () => {
    expect(() => validateRuntimeConfig(42)).toThrowError(
      RuntimeConfigValidationError
    );
  });

  it('rejects an invalid version with reason invalid_version', () => {
    const config = validConfig();
    config.version = 0;
    try {
      validateRuntimeConfig(config);
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeConfigValidationError);
      expect((error as RuntimeConfigValidationError).reason).toBe(
        'invalid_version'
      );
    }
  });

  it('rejects duplicate compartments', () => {
    const config = validConfig();
    config.compartments.push({ id: 'research', enabled: true });
    try {
      validateRuntimeConfig(config);
      throw new Error('expected throw');
    } catch (error) {
      expect((error as RuntimeConfigValidationError).reason).toBe(
        'duplicate_compartment'
      );
    }
  });

  it('rejects an empty compartment id', () => {
    const config = validConfig();
    config.compartments[0].id = '';
    expect(() => validateRuntimeConfig(config)).toThrowError(
      RuntimeConfigValidationError
    );
  });

  it('rejects a duplicate rate limit policy id with reason duplicate_policy', () => {
    const config = validConfig();
    config.rateLimitPolicies.push({
      ...config.rateLimitPolicies[0]
    });
    try {
      validateRuntimeConfig(config);
      throw new Error('expected throw');
    } catch (error) {
      expect((error as RuntimeConfigValidationError).reason).toBe(
        'duplicate_policy'
      );
    }
  });

  it('rejects an invalid enum value with reason invalid_enum', () => {
    const config = validConfig();
    (config.transportPolicies[0] as { tool: string }).tool = 'not_a_tool';
    try {
      validateRuntimeConfig(config);
      throw new Error('expected throw');
    } catch (error) {
      expect((error as RuntimeConfigValidationError).reason).toBe(
        'invalid_enum'
      );
    }
  });

  it('rejects incoherent trust thresholds with reason invalid_threshold', () => {
    const config = validConfig();
    config.trustPolicies.quarantinedThreshold = 60;
    config.trustPolicies.restrictedThreshold = 50;
    try {
      validateRuntimeConfig(config);
      throw new Error('expected throw');
    } catch (error) {
      expect((error as RuntimeConfigValidationError).reason).toBe(
        'invalid_threshold'
      );
    }
  });

  it('rejects a missing required array with reason invalid_schema', () => {
    const config = validConfig() as Partial<RuntimeConfig>;
    delete config.firewallPolicies;
    try {
      validateRuntimeConfig(config);
      throw new Error('expected throw');
    } catch (error) {
      expect((error as RuntimeConfigValidationError).reason).toBe(
        'invalid_schema'
      );
    }
  });
});

describe('snapshot', () => {
  it('produces a deterministic checksum independent of key order', () => {
    const a = validateRuntimeConfig(validConfig());
    const reordered = JSON.parse(
      JSON.stringify({ trustPolicies: a.trustPolicies, ...a })
    ) as RuntimeConfig;
    expect(computeChecksum(a)).toBe(computeChecksum(reordered));
  });

  it('creates an immutable, defensively cloned snapshot', () => {
    const config = validateRuntimeConfig(validConfig());
    const snapshot = createSnapshot(config, 1000);
    expect(snapshot.loadedAt).toBe(1000);
    expect(snapshot.version).toBe(1);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.config)).toBe(true);
    expect(Object.isFrozen(snapshot.config.compartments)).toBe(true);
    // Mutating the source config does not affect the snapshot (deep clone).
    config.version = 99;
    expect(snapshot.config.version).toBe(1);
  });

  it('does not leak mutations into the snapshot', () => {
    const config = validateRuntimeConfig(validConfig());
    const snapshot = createSnapshot(config, 1);
    expect(() => {
      'use strict';
      (snapshot.config as { version: number }).version = 5;
    }).toThrow();
    expect(snapshot.config.version).toBe(1);
  });
});

describe('RuntimeConfigLoader', () => {
  it('loads a valid config from a file and emits config_loaded', () => {
    const events: RuntimeConfigEvent[] = [];
    const loader = new RuntimeConfigLoader({
      now: () => 5000,
      onEvent: (e) => events.push(e)
    });
    const path = writeTempConfig(JSON.stringify(validConfig()));
    const snapshot = loader.loadFromFile(path);
    expect(snapshot.version).toBe(1);
    expect(snapshot.loadedAt).toBe(5000);
    expect(loader.getSnapshot()).toBe(snapshot);
    expect(events.map((e) => e.type)).toContain('config_loaded');
  });

  it('throws and emits config_validation_failed on invalid JSON', () => {
    const events: RuntimeConfigEvent[] = [];
    const loader = new RuntimeConfigLoader({ onEvent: (e) => events.push(e) });
    const path = writeTempConfig('{ not valid json');
    try {
      loader.loadFromFile(path);
      throw new Error('expected throw');
    } catch (error) {
      expect((error as RuntimeConfigValidationError).reason).toBe(
        'invalid_json'
      );
    }
    expect(events.map((e) => e.type)).toContain('config_validation_failed');
  });

  it('throws on invalid schema', () => {
    const loader = new RuntimeConfigLoader();
    const path = writeTempConfig(JSON.stringify({ version: 1 }));
    expect(() => loader.loadFromFile(path)).toThrowError(
      RuntimeConfigValidationError
    );
  });

  it('reload replaces the active snapshot', () => {
    const loader = new RuntimeConfigLoader({ now: () => 1 });
    const path = writeTempConfig(JSON.stringify(validConfig()));
    const first = loader.loadFromFile(path);
    const updated = validConfig();
    updated.version = 2;
    writeFileSync(path, JSON.stringify(updated), 'utf8');
    const second = loader.reload();
    expect(second.version).toBe(2);
    expect(second).not.toBe(first);
    expect(loader.getSnapshot()).toBe(second);
  });

  it('failed reload preserves the previous snapshot and emits config_reload_failed', () => {
    const events: RuntimeConfigEvent[] = [];
    const loader = new RuntimeConfigLoader({ onEvent: (e) => events.push(e) });
    const path = writeTempConfig(JSON.stringify(validConfig()));
    const first = loader.loadFromFile(path);
    writeFileSync(path, '{ broken', 'utf8');
    expect(() => loader.reload()).toThrowError(RuntimeConfigValidationError);
    expect(loader.getSnapshot()).toBe(first);
    expect(events.map((e) => e.type)).toContain('config_reload_failed');
  });

  it('watch reloads config on change', async () => {
    const events: RuntimeConfigEvent[] = [];
    const loader = new RuntimeConfigLoader({ onEvent: (e) => events.push(e) });
    const path = writeTempConfig(JSON.stringify(validConfig()));
    loader.loadFromFile(path);
    loader.watch();
    const updated = validConfig();
    updated.version = 7;
    writeFileSync(path, JSON.stringify(updated), 'utf8');
    await new Promise((r) => setTimeout(r, 300));
    loader.stopWatching();
    expect(loader.getSnapshot()?.version).toBe(7);
    expect(events.map((e) => e.type)).toContain('config_reloaded');
  });

  it('clear drops the snapshot and path', () => {
    const loader = new RuntimeConfigLoader();
    const path = writeTempConfig(JSON.stringify(validConfig()));
    loader.loadFromFile(path);
    expect(loader.getSnapshot()).toBeDefined();
    loader.clear();
    expect(loader.getSnapshot()).toBeUndefined();
    expect(loader.getPath()).toBeUndefined();
  });
});
