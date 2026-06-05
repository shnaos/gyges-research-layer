/**
 * Policy Packs & Runtime Profiles MVP — core primitives and contracts.
 *
 * Sprint 20 introduces the first high-level configuration abstraction for GRL.
 * Until now GRL consumed raw policy arrays directly via RuntimeConfig. This
 * module lets operators select a named {@link RuntimeProfile} instead — a
 * coherent, auditable bundle of {@link PolicyPack}s plus optional field-level
 * overrides, resolved into a concrete {@link RuntimeConfig} by the
 * {@link RuntimeProfileResolver}.
 *
 * Hard constraints (Sprint 20 MVP): everything here is deterministic, purely
 * local, and side-effect free. There is NO cloud sync, NO auth, NO browser, NO
 * Tor/proxy addition, NO database, NO Redis, NO telemetry, NO analytics, NO
 * ML/AI, NO remote profile registry. Values are metadata only — NEVER tokens,
 * secrets, credentials, raw HTTP headers, raw environment, raw stack traces,
 * or raw request input.
 */

import type { CapabilityPolicy } from '../capability-firewall/types.js';
import type { TransportPolicyRule } from '../transport-policy/types.js';
import type { PrivacyBoundaryRule } from '../privacy-boundary/types.js';
import type {
  AdaptiveDefensePolicy,
  RateLimitPolicy
} from '../adaptive-defense/types.js';
import type {
  CapabilityTransitionRule,
  DependencyIsolationPolicy
} from '../capability-graph/types.js';
import type {
  RuntimeConfig,
  RuntimeTrustPolicy,
  RuntimeSandboxPolicy
} from '../runtime-config/types.js';

// Re-export the types that compose a PolicyPack so consumers only need to
// import from this module.
export type { CapabilityPolicy } from '../capability-firewall/types.js';
export type { TransportPolicyRule } from '../transport-policy/types.js';
export type { PrivacyBoundaryRule } from '../privacy-boundary/types.js';
export type {
  AdaptiveDefensePolicy,
  RateLimitPolicy
} from '../adaptive-defense/types.js';
export type {
  CapabilityTransitionRule,
  DependencyIsolationPolicy
} from '../capability-graph/types.js';
export type {
  RuntimeConfig,
  RuntimeTrustPolicy,
  RuntimeSandboxPolicy
} from '../runtime-config/types.js';

/**
 * The closed vocabulary of built-in runtime profiles.
 *
 * - `strict`      — aggressive deny-by-default, frequent approvals, severe trust
 * - `balanced`    — default recommended profile, reasonable protections + usable UX
 * - `research`    — permissive exploration, faster trust recovery, relaxed graph
 * - `development` — minimal friction, short cooldowns, permissive trust
 */
export type RuntimeProfileName =
  | 'strict'
  | 'balanced'
  | 'research'
  | 'development';

/** All built-in profile names in stable order. */
export const RUNTIME_PROFILE_NAMES: readonly RuntimeProfileName[] = [
  'strict',
  'balanced',
  'research',
  'development'
];

/**
 * A named, self-contained bundle of policy overrides.
 *
 * A pack declares only the policy slices it owns. For each defined field the
 * {@link RuntimeProfileResolver} replaces the corresponding field in the
 * working config; undefined fields are left untouched. Packs carry only
 * minimal, secret-free policy metadata — NEVER tokens, secrets, or raw input.
 */
export interface PolicyPack {
  /** Globally unique pack identifier. */
  id: string;

  /** Human-readable description of what this pack enforces. */
  description?: string;

  /** Replaces the working config's `firewallPolicies` when defined. */
  firewallPolicies?: CapabilityPolicy[];

  /** Replaces the working config's `transportPolicies` when defined. */
  transportPolicies?: TransportPolicyRule[];

  /** Replaces the working config's `adaptiveDefensePolicies` when defined. */
  adaptiveDefensePolicies?: AdaptiveDefensePolicy[];

  /** Replaces the working config's `rateLimitPolicies` when defined. */
  rateLimitPolicies?: RateLimitPolicy[];

  /** Replaces the working config's `privacyBoundaryRules` when defined. */
  privacyBoundaryRules?: PrivacyBoundaryRule[];

  /** Replaces the working config's `graphTransitionRules` when defined. */
  graphTransitionRules?: CapabilityTransitionRule[];

  /** Replaces the working config's `isolationPolicies` when defined. */
  isolationPolicies?: DependencyIsolationPolicy[];

  /** Replaces the working config's `trustPolicies` when defined. */
  trustPolicies?: RuntimeTrustPolicy;

  /** Replaces the working config's `sandboxPolicies` when defined. */
  sandboxPolicies?: RuntimeSandboxPolicy[];
}

/**
 * A named runtime profile.
 *
 * A profile lists the ordered pack ids it applies, optionally inherits from a
 * parent profile (its packs are applied first), and may carry field-level
 * {@link overrides} applied after all packs.
 *
 * - Pack application is deterministic and immutable: packs are applied left to
 *   right; the last pack that defines a given field wins.
 * - Inheritance is recursive but cycle-free (a cycle throws
 *   {@link RuntimeProfileResolutionError} with reason `'inheritance_cycle'`).
 * - `overrides` are applied after all packs and never before.
 * - An `enabled: false` profile is never selectable at the API boundary.
 */
export interface RuntimeProfile {
  /** Stable name identifying this profile. */
  name: RuntimeProfileName;

  /** Human-readable description of the profile's security/UX posture. */
  description?: string;

  /**
   * Optional parent profile whose packs are applied before this profile's packs.
   * The parent's own overrides are NOT re-applied — only its packs.
   */
  extends?: RuntimeProfileName;

  /** Ordered list of pack ids applied by this profile (after any parent packs). */
  packs: string[];

  /**
   * Optional field-level overrides applied AFTER all packs have been merged.
   * Only top-level `RuntimeConfig` fields may be overridden; a missing or
   * semantically invalid override is rejected with reason `'invalid_override'`.
   */
  overrides?: Partial<RuntimeConfig>;

  /** When `false` the profile is declared but not selectable at the API. */
  enabled: boolean;
}

/**
 * The fully-resolved output of a profile resolution pass.
 *
 * Consumers should treat `resolvedConfig` as the single source of truth for
 * the active policy surface. It is deep-frozen so no downstream code can leak
 * a mutation back into the snapshot.
 */
export interface ResolvedRuntimeProfile {
  /** The profile that was resolved (defensive copy). */
  profile: RuntimeProfile;

  /** The ordered list of packs that were applied (defensive copies). */
  packs: PolicyPack[];

  /**
   * The final, immutable {@link RuntimeConfig} produced by applying all packs
   * and overrides onto the base config.
   */
  resolvedConfig: RuntimeConfig;
}

/**
 * Reason codes for {@link RuntimeProfileResolutionError}.
 *
 * - `inheritance_cycle` — the profile's `extends` chain contains a cycle
 * - `unknown_profile`   — the requested profile name is not registered
 * - `unknown_pack`      — a pack id referenced by a profile is not registered
 * - `invalid_override`  — the profile's `overrides` is structurally invalid
 */
export type RuntimeProfileResolutionErrorReason =
  | 'inheritance_cycle'
  | 'unknown_profile'
  | 'unknown_pack'
  | 'invalid_override';

/**
 * Thrown by {@link RuntimeProfileResolver} when a resolution cannot succeed.
 *
 * The `reason` field carries a stable machine-readable code so callers can
 * branch without parsing the human-readable `message`.
 */
export class RuntimeProfileResolutionError extends Error {
  public readonly reason: RuntimeProfileResolutionErrorReason;

  constructor(reason: RuntimeProfileResolutionErrorReason, message: string) {
    super(message);
    this.name = 'RuntimeProfileResolutionError';
    this.reason = reason;
  }
}
