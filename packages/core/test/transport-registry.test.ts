import { describe, expect, it } from 'vitest';
import {
  AdapterSandboxPolicy,
  TransportCapabilityRegistry,
  TransportManifest,
  TransportRegistryError,
  BOOTSTRAP_MOCK_MANIFEST,
  STRICT_SANDBOX_POLICY
} from '../src/index.js';

/** Build a mock manifest with sensible defaults that tests override. */
function manifest(overrides: Partial<TransportManifest> = {}): TransportManifest {
  return {
    kind: 'mock',
    name: 'Mock Transport Adapter',
    version: '0.1.0',
    supportedTools: ['search', 'fetch_html', 'fetch_json'],
    declaredPermissions: [
      'execute_mock',
      'network_disabled',
      'no_filesystem',
      'no_process_spawn',
      'no_env_access'
    ],
    networkAccess: false,
    browserAccess: false,
    filesystemAccess: false,
    processSpawnAccess: false,
    envAccess: false,
    ...overrides
  };
}

/** Build a sandbox policy with sensible (strict) defaults that tests override. */
function policy(overrides: Partial<AdapterSandboxPolicy> = {}): AdapterSandboxPolicy {
  return {
    allowedPermissions: [
      'execute_mock',
      'network_disabled',
      'no_filesystem',
      'no_process_spawn',
      'no_env_access'
    ],
    allowNetwork: false,
    allowBrowser: false,
    allowFilesystem: false,
    allowProcessSpawn: false,
    allowEnvAccess: false,
    ...overrides
  };
}

describe('TransportCapabilityRegistry — registration', () => {
  it('registers a manifest and exposes it via getManifest', () => {
    const registry = new TransportCapabilityRegistry();
    registry.registerManifest(manifest());
    expect(registry.size()).toBe(1);
    expect(registry.getManifest('mock')?.name).toBe('Mock Transport Adapter');
  });

  it('rejects a duplicate manifest for the same kind (no silent overwrite)', () => {
    const registry = new TransportCapabilityRegistry();
    registry.registerManifest(manifest());
    expect(() => registry.registerManifest(manifest({ name: 'other' }))).toThrow(
      TransportRegistryError
    );
    // The original manifest is preserved.
    expect(registry.getManifest('mock')?.name).toBe('Mock Transport Adapter');
  });

  it('returns undefined for an unregistered kind', () => {
    const registry = new TransportCapabilityRegistry();
    expect(registry.getManifest('tor')).toBeUndefined();
  });

  it('lists manifests as defensive copies', () => {
    const registry = new TransportCapabilityRegistry();
    registry.registerManifest(manifest());
    const listed = registry.listManifests();
    expect(listed).toHaveLength(1);
    listed[0].supportedTools.push('fetch_pdf' as never);
    listed[0].name = 'mutated';
    // Mutating the returned copy never affects the registry.
    expect(registry.getManifest('mock')?.name).toBe('Mock Transport Adapter');
    expect(registry.getManifest('mock')?.supportedTools).toEqual([
      'search',
      'fetch_html',
      'fetch_json'
    ]);
  });

  it('does not store a reference to the caller manifest (no mutation leak)', () => {
    const registry = new TransportCapabilityRegistry();
    const input = manifest();
    registry.registerManifest(input);
    input.supportedTools.push('fetch_pdf' as never);
    input.networkAccess = true;
    expect(registry.getManifest('mock')?.supportedTools).toEqual([
      'search',
      'fetch_html',
      'fetch_json'
    ]);
    expect(registry.getManifest('mock')?.networkAccess).toBe(false);
  });

  it('clears all registered manifests', () => {
    const registry = new TransportCapabilityRegistry();
    registry.registerManifest(manifest());
    registry.clear();
    expect(registry.size()).toBe(0);
    expect(registry.getManifest('mock')).toBeUndefined();
  });
});

describe('TransportCapabilityRegistry — audit', () => {
  it('returns the capability surface of every registered manifest', () => {
    const registry = new TransportCapabilityRegistry();
    registry.registerManifest(manifest());
    const audit = registry.audit();
    expect(audit).toEqual([
      {
        kind: 'mock',
        supportedTools: ['search', 'fetch_html', 'fetch_json'],
        declaredPermissions: [
          'execute_mock',
          'network_disabled',
          'no_filesystem',
          'no_process_spawn',
          'no_env_access'
        ],
        networkAccess: false,
        browserAccess: false,
        filesystemAccess: false,
        processSpawnAccess: false,
        envAccess: false
      }
    ]);
  });

  it('returns audit entries as defensive copies', () => {
    const registry = new TransportCapabilityRegistry();
    registry.registerManifest(manifest());
    const audit = registry.audit();
    audit[0].supportedTools.push('mutated' as never);
    expect(registry.getManifest('mock')?.supportedTools).toEqual([
      'search',
      'fetch_html',
      'fetch_json'
    ]);
  });
});

describe('TransportCapabilityRegistry — evaluateSandbox', () => {
  it('blocks an unregistered transport', () => {
    const registry = new TransportCapabilityRegistry();
    const decision = registry.evaluateSandbox('mock', 'search', policy());
    expect(decision.action).toBe('block');
    expect(decision.violations.map((v) => v.code)).toEqual([
      'transport_not_registered'
    ]);
  });

  it('blocks a tool the manifest does not support', () => {
    const registry = new TransportCapabilityRegistry();
    registry.registerManifest(manifest({ supportedTools: ['search'] }));
    const decision = registry.evaluateSandbox('mock', 'fetch_html', policy());
    expect(decision.action).toBe('block');
    expect(decision.violations.map((v) => v.code)).toEqual(['tool_not_supported']);
  });

  it('blocks a declared permission the policy does not allow', () => {
    const registry = new TransportCapabilityRegistry();
    registry.registerManifest(manifest());
    const decision = registry.evaluateSandbox(
      'mock',
      'search',
      policy({ allowedPermissions: ['execute_mock'] })
    );
    expect(decision.action).toBe('block');
    expect(decision.violations.map((v) => v.code)).toContain('permission_not_allowed');
  });

  it('blocks when the manifest needs network but the policy forbids it', () => {
    const registry = new TransportCapabilityRegistry();
    registry.registerManifest(manifest({ networkAccess: true }));
    const decision = registry.evaluateSandbox('mock', 'search', policy());
    expect(decision.action).toBe('block');
    expect(decision.violations.map((v) => v.code)).toContain('network_not_allowed');
  });

  it('blocks when the manifest needs browser but the policy forbids it', () => {
    const registry = new TransportCapabilityRegistry();
    registry.registerManifest(manifest({ browserAccess: true }));
    const decision = registry.evaluateSandbox('mock', 'search', policy());
    expect(decision.action).toBe('block');
    expect(decision.violations.map((v) => v.code)).toContain('browser_not_allowed');
  });

  it('blocks when the manifest needs filesystem but the policy forbids it', () => {
    const registry = new TransportCapabilityRegistry();
    registry.registerManifest(manifest({ filesystemAccess: true }));
    const decision = registry.evaluateSandbox('mock', 'search', policy());
    expect(decision.action).toBe('block');
    expect(decision.violations.map((v) => v.code)).toContain('filesystem_not_allowed');
  });

  it('blocks when the manifest needs process spawn but the policy forbids it', () => {
    const registry = new TransportCapabilityRegistry();
    registry.registerManifest(manifest({ processSpawnAccess: true }));
    const decision = registry.evaluateSandbox('mock', 'search', policy());
    expect(decision.action).toBe('block');
    expect(decision.violations.map((v) => v.code)).toContain(
      'process_spawn_not_allowed'
    );
  });

  it('blocks when the manifest needs env access but the policy forbids it', () => {
    const registry = new TransportCapabilityRegistry();
    registry.registerManifest(manifest({ envAccess: true }));
    const decision = registry.evaluateSandbox('mock', 'search', policy());
    expect(decision.action).toBe('block');
    expect(decision.violations.map((v) => v.code)).toContain('env_access_not_allowed');
  });

  it('allows a fully-compliant manifest under a compliant policy', () => {
    const registry = new TransportCapabilityRegistry();
    registry.registerManifest(manifest());
    const decision = registry.evaluateSandbox('mock', 'fetch_json', policy());
    expect(decision.action).toBe('allow');
    expect(decision.violations).toEqual([]);
  });

  it('is deterministic for identical inputs', () => {
    const registry = new TransportCapabilityRegistry();
    registry.registerManifest(manifest({ networkAccess: true, envAccess: true }));
    const a = registry.evaluateSandbox('mock', 'search', policy());
    const b = registry.evaluateSandbox('mock', 'search', policy());
    expect(a).toEqual(b);
  });

  it('does not mutate the manifest or the policy', () => {
    const registry = new TransportCapabilityRegistry();
    const input = manifest();
    registry.registerManifest(input);
    const pol = policy();
    const polSnapshot = JSON.parse(JSON.stringify(pol));
    registry.evaluateSandbox('mock', 'search', pol);
    expect(pol).toEqual(polSnapshot);
    expect(registry.getManifest('mock')).toEqual(input);
  });
});

describe('Transport registry bootstrap', () => {
  it('bootstrap mock manifest is allowed by the strict sandbox policy', () => {
    const registry = new TransportCapabilityRegistry();
    registry.registerManifest(BOOTSTRAP_MOCK_MANIFEST);
    for (const tool of BOOTSTRAP_MOCK_MANIFEST.supportedTools) {
      const decision = registry.evaluateSandbox('mock', tool, STRICT_SANDBOX_POLICY);
      expect(decision.action).toBe('allow');
    }
  });
});
