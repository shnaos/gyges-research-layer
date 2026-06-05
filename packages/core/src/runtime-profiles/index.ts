/**
 * Policy Packs & Runtime Profiles — public surface.
 *
 * Re-exports all types, built-in packs/profiles, the resolver, and the
 * validator helpers so consumers only need a single import.
 */

export type {
  RuntimeProfileName,
  PolicyPack,
  RuntimeProfile,
  ResolvedRuntimeProfile,
  RuntimeProfileResolutionErrorReason,
  CapabilityPolicy,
  TransportPolicyRule,
  PrivacyBoundaryRule,
  AdaptiveDefensePolicy,
  RateLimitPolicy,
  CapabilityTransitionRule,
  DependencyIsolationPolicy,
  RuntimeConfig,
  RuntimeTrustPolicy,
  RuntimeSandboxPolicy
} from './types.js';

export {
  RUNTIME_PROFILE_NAMES,
  RuntimeProfileResolutionError
} from './types.js';

export {
  BUILT_IN_PACKS,
  BUILT_IN_PROFILES,
  BALANCED_DEFAULT_PACK,
  STRICT_DEFENSE_PACK,
  STRICT_SANDBOX_PACK,
  RESEARCH_FLEX_PACK,
  DEVELOPMENT_LOW_FRICTION_PACK,
  PRIVACY_HARDENING_PACK,
  TRUST_HARDENING_PACK
} from './packs.js';

export { RuntimeProfileResolver } from './resolver.js';

export { assertValidProfileName, isValidProfileName } from './validator.js';
