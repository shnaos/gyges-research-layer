/**
 * RuntimeProfileResolver — deterministic, immutable profile resolution.
 *
 * Resolves a {@link RuntimeProfileName} plus a base {@link RuntimeConfig} into
 * a concrete {@link ResolvedRuntimeProfile} by:
 *   1. Walking the inheritance chain (parent first) — cycle detection fail-closed
 *   2. Applying each referenced {@link PolicyPack} in order (later wins)
 *   3. Applying the profile's field-level `overrides` last
 *
 * Hard constraints:
 *   - Deterministic: identical inputs always produce structurally identical outputs
 *   - Immutable: inputs are never mutated; the resolved config is deep-frozen
 *   - Defensive copies: all returned values are fresh copies
 *   - Fail-closed: any error (unknown profile/pack, cycle, invalid override)
 *     throws {@link RuntimeProfileResolutionError} and leaves no partial state
 *   - No network, no persistence, no AI/ML, no side effects
 */

import { deepClone, deepFreeze } from '../runtime-config/snapshot.js';
import type { RuntimeConfig } from '../runtime-config/types.js';
import { BUILT_IN_PACKS, BUILT_IN_PROFILES } from './packs.js';
import {
  RuntimeProfileResolutionError,
  type PolicyPack,
  type ResolvedRuntimeProfile,
  type RuntimeProfile,
  type RuntimeProfileName
} from './types.js';

/**
 * Resolves runtime profiles against a base configuration.
 *
 * Construct with the default built-in packs/profiles or inject custom ones for
 * testing. The resolver is stateless after construction — every
 * `resolveProfile()` call starts from the supplied `baseConfig` with no
 * accumulated side effects.
 */
export class RuntimeProfileResolver {
  private readonly packsById: ReadonlyMap<string, PolicyPack>;
  private readonly profilesByName: ReadonlyMap<RuntimeProfileName, RuntimeProfile>;

  constructor(
    profiles: readonly RuntimeProfile[] = BUILT_IN_PROFILES,
    packs: readonly PolicyPack[] = BUILT_IN_PACKS
  ) {
    const packsById = new Map<string, PolicyPack>();
    for (const pack of packs) {
      packsById.set(pack.id, deepClone(pack));
    }
    this.packsById = packsById;

    const profilesByName = new Map<RuntimeProfileName, RuntimeProfile>();
    for (const profile of profiles) {
      profilesByName.set(profile.name, deepClone(profile));
    }
    this.profilesByName = profilesByName;
  }

  /**
   * List all registered profiles (defensive copies, stable order).
   */
  listProfiles(): RuntimeProfile[] {
    return [...this.profilesByName.values()].map((p) => deepClone(p));
  }

  /**
   * List all registered packs (defensive copies, stable order).
   */
  listPacks(): PolicyPack[] {
    return [...this.packsById.values()].map((p) => deepClone(p));
  }

  /**
   * Resolve a profile against a base config.
   *
   * Steps:
   *   1. Validate the profile exists
   *   2. Walk the inheritance chain (parent-first, cycle-detected)
   *   3. For each profile in the chain, apply its packs left-to-right
   *      (each pack replaces only the fields it defines)
   *   4. Apply `overrides` from the **leaf** profile last
   *
   * Throws {@link RuntimeProfileResolutionError} on any error.
   *
   * @param profileName  The name of the profile to resolve
   * @param baseConfig   The starting point config (never mutated)
   * @returns A fully-resolved, deep-frozen {@link ResolvedRuntimeProfile}
   */
  resolveProfile(
    profileName: RuntimeProfileName,
    baseConfig: RuntimeConfig
  ): ResolvedRuntimeProfile {
    const profile = this.profilesByName.get(profileName);
    if (!profile) {
      throw new RuntimeProfileResolutionError(
        'unknown_profile',
        `Unknown runtime profile: "${profileName}".`
      );
    }

    // Collect the inheritance chain, parent first.
    const chain = this.resolveInheritanceChain(profileName, new Set());

    // Apply all packs from every profile in the chain, tracking which packs
    // were applied so the caller can audit the full resolution.
    const appliedPacks: PolicyPack[] = [];
    let config: RuntimeConfig = deepClone(baseConfig);

    for (const nameInChain of chain) {
      const profileInChain = this.profilesByName.get(nameInChain)!;
      for (const packId of profileInChain.packs) {
        const pack = this.packsById.get(packId);
        if (!pack) {
          throw new RuntimeProfileResolutionError(
            'unknown_pack',
            `Pack "${packId}" referenced by profile "${nameInChain}" is not registered.`
          );
        }
        appliedPacks.push(pack);
        config = this.applyPack(config, pack);
      }
    }

    // Apply overrides from the leaf profile only (parent overrides are NOT
    // re-applied — only their packs are).
    if (profile.overrides !== undefined && Object.keys(profile.overrides).length > 0) {
      try {
        config = this.applyOverrides(config, profile.overrides);
      } catch {
        throw new RuntimeProfileResolutionError(
          'invalid_override',
          `Profile "${profileName}" has structurally invalid overrides.`
        );
      }
    }

    return {
      profile: deepClone(profile),
      packs: appliedPacks.map((p) => deepClone(p)),
      resolvedConfig: deepFreeze(deepClone(config))
    };
  }

  /**
   * Walk the `extends` chain and return it parent-first.
   *
   * Throws `inheritance_cycle` if the same profile appears twice.
   * Throws `unknown_profile` if a parent is not registered.
   */
  private resolveInheritanceChain(
    name: RuntimeProfileName,
    visited: Set<string>
  ): RuntimeProfileName[] {
    if (visited.has(name)) {
      throw new RuntimeProfileResolutionError(
        'inheritance_cycle',
        `Inheritance cycle detected: profile "${name}" appears more than once in the extends chain.`
      );
    }
    visited.add(name);

    const profile = this.profilesByName.get(name);
    if (!profile) {
      throw new RuntimeProfileResolutionError(
        'unknown_profile',
        `Unknown runtime profile in inheritance chain: "${name}".`
      );
    }

    if (!profile.extends) {
      return [name];
    }

    const parentChain = this.resolveInheritanceChain(profile.extends, visited);
    return [...parentChain, name];
  }

  /**
   * Apply a single pack onto a config snapshot.
   *
   * Each defined field in the pack **replaces** the corresponding field in the
   * working config. Undefined pack fields are left untouched. The result is a
   * shallow spread of the config with deep-cloned pack values.
   */
  private applyPack(config: RuntimeConfig, pack: PolicyPack): RuntimeConfig {
    const result: RuntimeConfig = { ...config };

    if (pack.firewallPolicies !== undefined) {
      result.firewallPolicies = deepClone(pack.firewallPolicies);
    }
    if (pack.transportPolicies !== undefined) {
      result.transportPolicies = deepClone(pack.transportPolicies);
    }
    if (pack.adaptiveDefensePolicies !== undefined) {
      result.adaptiveDefensePolicies = deepClone(pack.adaptiveDefensePolicies);
    }
    if (pack.rateLimitPolicies !== undefined) {
      result.rateLimitPolicies = deepClone(pack.rateLimitPolicies);
    }
    if (pack.privacyBoundaryRules !== undefined) {
      result.privacyBoundaryRules = deepClone(pack.privacyBoundaryRules);
    }
    if (pack.graphTransitionRules !== undefined) {
      result.graphTransitionRules = deepClone(pack.graphTransitionRules);
    }
    if (pack.isolationPolicies !== undefined) {
      result.isolationPolicies = deepClone(pack.isolationPolicies);
    }
    if (pack.trustPolicies !== undefined) {
      result.trustPolicies = deepClone(pack.trustPolicies);
    }
    if (pack.sandboxPolicies !== undefined) {
      result.sandboxPolicies = deepClone(pack.sandboxPolicies);
    }

    return result;
  }

  /**
   * Apply top-level field overrides onto a config snapshot.
   *
   * Only top-level `RuntimeConfig` keys are overridden; nested merging is not
   * performed. Each override value is deep-cloned so the input is never shared.
   */
  private applyOverrides(
    config: RuntimeConfig,
    overrides: Partial<RuntimeConfig>
  ): RuntimeConfig {
    const result: RuntimeConfig = { ...config };
    for (const key of Object.keys(overrides) as (keyof RuntimeConfig)[]) {
      const value = overrides[key];
      if (value !== undefined) {
        (result as unknown as Record<string, unknown>)[key] = deepClone(value as unknown);
      }
    }
    return result;
  }
}
