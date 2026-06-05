/**
 * TransportCapabilityRegistry — deterministic, in-memory transport manifest
 * registry and adapter sandbox evaluator.
 *
 * Responsibilities (Sprint 10 MVP):
 *   - hold {@link TransportManifest}s keyed by {@link TransportKind}
 *   - refuse to silently overwrite an existing manifest (fail-closed)
 *   - audit the declared capability surface of every registered manifest
 *   - decide whether an adapter may execute a tool under an
 *     {@link AdapterSandboxPolicy}, returning a {@link SandboxDecision}
 *
 * Strict non-goals: it is purely in-memory and side-effect free. It NEVER
 * loads a plugin, NEVER executes code dynamically, NEVER touches a database,
 * NEVER reads a manifest from the filesystem, and NEVER performs auto-discovery
 * or any real network / DNS / socket / browser work.
 *
 * Determinism & immutability:
 *   - identical inputs always produce identical decisions
 *   - the incoming manifest/policy are never mutated
 *   - `getManifest`/`listManifests`/`audit` return deep copies, never internal
 *     state, so callers can never mutate the registry through a returned object
 */

import { CapabilityTool } from '../index.js';
import { TransportKind } from '../execution/types.js';
import {
  AdapterSandboxPermission,
  AdapterSandboxPolicy,
  SandboxDecision,
  SandboxViolation,
  TransportCapabilityAudit,
  TransportManifest,
  TransportRegistryErrorKind
} from './types.js';

/** Typed error raised by {@link TransportCapabilityRegistry} on a misuse. */
export class TransportRegistryError extends Error {
  constructor(
    readonly kind: TransportRegistryErrorKind,
    message: string
  ) {
    super(message);
    this.name = 'TransportRegistryError';
  }
}

export class TransportCapabilityRegistry {
  /** Registered manifests keyed by transport kind, in insertion order. */
  private readonly manifests = new Map<TransportKind, TransportManifest>();

  /**
   * Register a transport manifest.
   *
   * Throws {@link TransportRegistryError} (`duplicate_manifest`) when a manifest
   * for the same {@link TransportKind} already exists — a manifest can never be
   * silently replaced. The stored manifest is a deep copy, so later mutation of
   * the caller's object can never affect the registry.
   */
  registerManifest(manifest: TransportManifest): void {
    if (this.manifests.has(manifest.kind)) {
      throw new TransportRegistryError(
        'duplicate_manifest',
        `A transport manifest for kind "${manifest.kind}" is already registered.`
      );
    }
    this.manifests.set(manifest.kind, this.cloneManifest(manifest));
  }

  /**
   * Return a deep copy of the manifest for the given kind, or `undefined` when
   * none is registered. Never returns internal state.
   */
  getManifest(kind: TransportKind): TransportManifest | undefined {
    const manifest = this.manifests.get(kind);
    return manifest ? this.cloneManifest(manifest) : undefined;
  }

  /** List every registered manifest. Returns deep copies — never internal state. */
  listManifests(): TransportManifest[] {
    return [...this.manifests.values()].map((manifest) =>
      this.cloneManifest(manifest)
    );
  }

  /** Remove every registered manifest. */
  clear(): void {
    this.manifests.clear();
  }

  /** Number of registered manifests. */
  size(): number {
    return this.manifests.size;
  }

  /**
   * Project every registered manifest into its capability-audit surface.
   *
   * Returns deep copies, in registration order. No secrets are exposed — only
   * the declared tools/permissions and access flags.
   */
  audit(): TransportCapabilityAudit[] {
    return [...this.manifests.values()].map((manifest) => ({
      kind: manifest.kind,
      supportedTools: [...manifest.supportedTools],
      declaredPermissions: [...manifest.declaredPermissions],
      networkAccess: manifest.networkAccess,
      browserAccess: manifest.browserAccess,
      filesystemAccess: manifest.filesystemAccess,
      processSpawnAccess: manifest.processSpawnAccess,
      envAccess: manifest.envAccess
    }));
  }

  /**
   * Evaluate whether an adapter may execute `tool` under `policy`.
   *
   * Evaluation order (fail-closed throughout):
   *   1. unknown transport kind            → block `transport_not_registered`
   *   2. tool not in `supportedTools`      → block `tool_not_supported`
   *   3. declared permission outside policy → block `permission_not_allowed`
   *      (one violation per offending permission, in declaration order)
   *   4. networkAccess && !allowNetwork    → block `network_not_allowed`
   *   5. browserAccess && !allowBrowser    → block `browser_not_allowed`
   *   6. filesystemAccess && !allowFilesystem → block `filesystem_not_allowed`
   *   7. processSpawnAccess && !allowProcessSpawn → block `process_spawn_not_allowed`
   *   8. envAccess && !allowEnvAccess      → block `env_access_not_allowed`
   *   9. otherwise                         → allow
   *
   * Steps 1 and 2 short-circuit (no manifest / no supported tool means the rest
   * cannot be assessed). Steps 3–8 are all collected so a single decision can
   * surface every applicable violation. Neither `policy` nor the stored manifest
   * is mutated; a fresh decision is always returned.
   */
  evaluateSandbox(
    kind: TransportKind,
    tool: CapabilityTool,
    policy: AdapterSandboxPolicy
  ): SandboxDecision {
    const manifest = this.manifests.get(kind);

    // 1. Unknown transport kind → fail-closed block.
    if (!manifest) {
      return this.block({
        code: 'transport_not_registered',
        reason: `No transport manifest registered for kind "${kind}".`
      });
    }

    // 2. Tool not declared by the manifest → fail-closed block.
    if (!manifest.supportedTools.includes(tool)) {
      return this.block({
        code: 'tool_not_supported',
        reason: `Transport "${kind}" does not support tool "${tool}".`
      });
    }

    const violations: SandboxViolation[] = [];
    const allowed = new Set<AdapterSandboxPermission>(policy.allowedPermissions);

    // 3. Every declared permission must be granted by the policy.
    for (const permission of manifest.declaredPermissions) {
      if (!allowed.has(permission)) {
        violations.push({
          code: 'permission_not_allowed',
          reason: `Permission "${permission}" declared by "${kind}" is not allowed by the sandbox policy.`
        });
      }
    }

    // 4–8. Each real-access flag the manifest needs must be tolerated.
    if (manifest.networkAccess && !policy.allowNetwork) {
      violations.push({
        code: 'network_not_allowed',
        reason: `Transport "${kind}" requires network access, which the sandbox policy forbids.`
      });
    }
    if (manifest.browserAccess && !policy.allowBrowser) {
      violations.push({
        code: 'browser_not_allowed',
        reason: `Transport "${kind}" requires browser access, which the sandbox policy forbids.`
      });
    }
    if (manifest.filesystemAccess && !policy.allowFilesystem) {
      violations.push({
        code: 'filesystem_not_allowed',
        reason: `Transport "${kind}" requires filesystem access, which the sandbox policy forbids.`
      });
    }
    if (manifest.processSpawnAccess && !policy.allowProcessSpawn) {
      violations.push({
        code: 'process_spawn_not_allowed',
        reason: `Transport "${kind}" requires process-spawn access, which the sandbox policy forbids.`
      });
    }
    if (manifest.envAccess && !policy.allowEnvAccess) {
      violations.push({
        code: 'env_access_not_allowed',
        reason: `Transport "${kind}" requires environment access, which the sandbox policy forbids.`
      });
    }

    // 9. No violation → allow.
    if (violations.length === 0) {
      return { action: 'allow', violations: [] };
    }
    return { action: 'block', violations };
  }

  /** Build a single-violation `block` decision. */
  private block(violation: SandboxViolation): SandboxDecision {
    return { action: 'block', violations: [violation] };
  }

  /** Deep copy a manifest so internal state and caller objects never alias. */
  private cloneManifest(manifest: TransportManifest): TransportManifest {
    return {
      kind: manifest.kind,
      name: manifest.name,
      version: manifest.version,
      supportedTools: [...manifest.supportedTools],
      declaredPermissions: [...manifest.declaredPermissions],
      networkAccess: manifest.networkAccess,
      browserAccess: manifest.browserAccess,
      filesystemAccess: manifest.filesystemAccess,
      processSpawnAccess: manifest.processSpawnAccess,
      envAccess: manifest.envAccess
    };
  }
}
