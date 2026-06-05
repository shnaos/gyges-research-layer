/**
 * Local Configuration Loader & Policy Runtime MVP — public surface.
 *
 * Sprint 16 contracts ({@link RuntimeConfig}, {@link RuntimeConfigSnapshot}),
 * the strict {@link validateRuntimeConfig} validator, the local-only
 * {@link RuntimeConfigLoader}, and the {@link DEFAULT_RUNTIME_CONFIG} fallback.
 *
 * Everything exposed here is deterministic and local-only: no database, no
 * cloud, no auth, no sync, no fetch, no URL loading, no remote YAML, no
 * websocket, no browser, no AI/ML, and no durable persistence beyond the user's
 * own local JSON file.
 */

export type {
  RuntimeConfig,
  RuntimeConfigSnapshot,
  RuntimeCompartment,
  RuntimeTrustPolicy,
  RuntimeSandboxPolicy,
  CapabilityPolicy,
  TransportPolicyRule,
  PrivacyBoundaryRule,
  AdaptiveDefensePolicy,
  RateLimitPolicy,
  CapabilityTransitionRule,
  DependencyIsolationPolicy,
  TransportKind
} from './types.js';

export {
  deepClone,
  deepFreeze,
  canonicalize,
  computeChecksum,
  createSnapshot
} from './snapshot.js';

export {
  RuntimeConfigValidationError,
  validateRuntimeConfig,
  parseRuntimeConfig
} from './validator.js';
export type { RuntimeConfigValidationReason } from './validator.js';

export { RuntimeConfigLoader } from './loader.js';
export type {
  RuntimeConfigLoaderOptions,
  RuntimeConfigEvent,
  RuntimeConfigEventType
} from './loader.js';

export { DEFAULT_RUNTIME_CONFIG } from './bootstrap.js';
