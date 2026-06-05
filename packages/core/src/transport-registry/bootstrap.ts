/**
 * Bootstrap transport manifest and sandbox policy for the MVP.
 *
 * These are the deterministic defaults the local server starts with. They are
 * pure metadata: no secrets, no real transport configuration. Only the `mock`
 * transport is described — Sprint 10 performs no real network, browser,
 * filesystem, or process work.
 */

import { AdapterSandboxPolicy, TransportManifest } from './types.js';

/**
 * Bootstrap manifest for the in-process mock transport.
 *
 * It declares the three MVP tools and asserts a fully sandboxed surface: no
 * network, browser, filesystem, process spawning, or environment access.
 */
export const BOOTSTRAP_MOCK_MANIFEST: TransportManifest = {
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
  envAccess: false
};

/**
 * Strict default sandbox policy.
 *
 * It grants only the mock-safe permissions and forbids every form of real
 * access. The {@link BOOTSTRAP_MOCK_MANIFEST} is fully compliant with it.
 */
export const STRICT_SANDBOX_POLICY: AdapterSandboxPolicy = {
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
  allowEnvAccess: false
};

/** The full set of bootstrap manifests, in registration order. */
export const BOOTSTRAP_TRANSPORT_MANIFESTS: readonly TransportManifest[] = [
  BOOTSTRAP_MOCK_MANIFEST
];
