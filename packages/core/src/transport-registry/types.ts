/**
 * Transport Capability Registry & Adapter Sandbox MVP — core primitives.
 *
 * Sprint 10 introduces a deterministic, in-memory registry that declares what a
 * transport adapter is *allowed* to do and audits its permission surface. It
 * decides whether an adapter may run a capability under a sandbox policy — but
 * it performs NO real network, DNS, socket, browser, filesystem, process, or
 * persistence work. Nothing here loads plugins or reads manifests from disk.
 *
 * The types are deliberately self-contained and agnostic — no coupling to any
 * specific business product, persistence, browser, or real transport.
 */

import { CapabilityTool } from '../index.js';
import { TransportKind } from '../execution/types.js';

/**
 * A discrete permission an adapter may declare in its {@link TransportManifest}
 * and that an {@link AdapterSandboxPolicy} may grant.
 *
 * In Sprint 10 these are purely declarative labels used to audit and gate an
 * adapter's surface. They never enable any real capability:
 *
 * - `execute_mock`             — the adapter may run the in-process mock transport
 * - `network_disabled`         — the adapter asserts it performs no network I/O
 * - `network_explicit_allowed` — the adapter is explicitly permitted to access
 *   the network (requires the sandbox policy's `allowNetwork: true`)
 * - `no_filesystem`            — the adapter asserts it touches no filesystem
 * - `no_process_spawn`         — the adapter asserts it spawns no child process
 * - `no_env_access`            — the adapter asserts it reads no environment variables
 */
export type AdapterSandboxPermission =
  | 'execute_mock'
  | 'network_disabled'
  | 'network_explicit_allowed'
  | 'no_filesystem'
  | 'no_process_spawn'
  | 'no_env_access';

/** Terminal action of a {@link SandboxDecision}. */
export type SandboxDecisionAction = 'allow' | 'block';

/**
 * The declared capability surface of a single transport adapter.
 *
 * A manifest is pure metadata: it carries NO secrets, credentials, endpoints,
 * or real transport configuration. It only describes what the adapter claims it
 * supports and what access it (does not) require.
 */
export interface TransportManifest {
  /** Transport kind this manifest describes (e.g. `mock`). */
  kind: TransportKind;
  /** Human-readable adapter name. */
  name: string;
  /** Adapter version string (informational only). */
  version: string;
  /** Tools the adapter declares it can execute. */
  supportedTools: CapabilityTool[];
  /** Sandbox permissions the adapter declares it needs/asserts. */
  declaredPermissions: AdapterSandboxPermission[];
  /** Whether the adapter requires real network access. */
  networkAccess: boolean;
  /** Whether the adapter requires browser access. */
  browserAccess: boolean;
  /** Whether the adapter requires filesystem access. */
  filesystemAccess: boolean;
  /** Whether the adapter requires the ability to spawn processes. */
  processSpawnAccess: boolean;
  /** Whether the adapter requires environment variable access. */
  envAccess: boolean;
}

/**
 * The sandbox a manifest must comply with before an adapter may execute.
 *
 * It enumerates the permissions the host grants and which forms of real access
 * are tolerated. A strict default policy grants only `execute_mock`-style
 * declarations and forbids every real-access flag.
 */
export interface AdapterSandboxPolicy {
  /** Permissions the host grants; any declared permission outside this set blocks. */
  allowedPermissions: AdapterSandboxPermission[];
  /** Whether the host tolerates an adapter that requires network access. */
  allowNetwork: boolean;
  /** Whether the host tolerates an adapter that requires browser access. */
  allowBrowser: boolean;
  /** Whether the host tolerates an adapter that requires filesystem access. */
  allowFilesystem: boolean;
  /** Whether the host tolerates an adapter that requires process spawning. */
  allowProcessSpawn: boolean;
  /** Whether the host tolerates an adapter that requires environment access. */
  allowEnvAccess: boolean;
}

/**
 * A single reason a sandbox evaluation refused an adapter.
 *
 * - `transport_not_registered`  — no manifest registered for the kind
 * - `tool_not_supported`        — the manifest does not declare the tool
 * - `permission_not_allowed`    — a declared permission is outside the policy
 * - `network_not_allowed`       — manifest needs network the policy forbids
 * - `browser_not_allowed`       — manifest needs browser the policy forbids
 * - `filesystem_not_allowed`    — manifest needs filesystem the policy forbids
 * - `process_spawn_not_allowed` — manifest needs process spawn the policy forbids
 * - `env_access_not_allowed`    — manifest needs env access the policy forbids
 */
export interface SandboxViolation {
  code:
    | 'transport_not_registered'
    | 'tool_not_supported'
    | 'permission_not_allowed'
    | 'network_not_allowed'
    | 'browser_not_allowed'
    | 'filesystem_not_allowed'
    | 'process_spawn_not_allowed'
    | 'env_access_not_allowed';
  /** Deterministic, human-readable explanation of the violation. */
  reason: string;
}

/**
 * The deterministic outcome of evaluating a manifest against a sandbox policy.
 *
 * `action` is `block` when `violations` is non-empty, otherwise `allow`.
 */
export interface SandboxDecision {
  action: SandboxDecisionAction;
  violations: SandboxViolation[];
}

/**
 * A read-only projection of a manifest's capability surface, used for auditing.
 *
 * It omits the cosmetic `name`/`version` and exposes only what is relevant to a
 * permission/capability audit. Carries no secrets.
 */
export interface TransportCapabilityAudit {
  kind: TransportKind;
  supportedTools: CapabilityTool[];
  declaredPermissions: AdapterSandboxPermission[];
  networkAccess: boolean;
  browserAccess: boolean;
  filesystemAccess: boolean;
  processSpawnAccess: boolean;
  envAccess: boolean;
}

/**
 * Reason a {@link TransportCapabilityRegistry} operation could not complete.
 *
 * - `duplicate_manifest` — a manifest for the same {@link TransportKind} is
 *   already registered; there is no silent overwrite.
 */
export type TransportRegistryErrorKind = 'duplicate_manifest';
