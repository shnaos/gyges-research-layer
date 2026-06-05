/**
 * Local Configuration Loader & Policy Runtime MVP — core primitives and
 * contracts.
 *
 * Sprint 16 introduces the first DYNAMIC, local configuration layer of GRL.
 * Until now GRL started from hard-coded bootstrap constants: static firewall
 * rules, frozen compartments, and manually injected policies. This module lets
 * the entire policy surface be described by a single local JSON file, loaded
 * into an immutable {@link RuntimeConfigSnapshot}, validated fail-closed, and
 * handed to the engines — with no code changes required to retune GRL.
 *
 * Hard constraints (Sprint 16 MVP): everything here is deterministic, purely
 * local, and side-effect free apart from reading a local JSON file. There is NO
 * database, NO Redis, NO cloud sync, NO auth, NO telemetry, NO fetch / DNS /
 * socket, NO URL loading, NO remote YAML, NO websocket, NO browser, and NO
 * AI / ML / semantic classification. The only persistence is the user's own
 * local JSON file; nothing durable is written back.
 *
 * Privacy: a {@link RuntimeConfig} carries only minimal policy metadata (ids,
 * enums, numeric thresholds, booleans). It must NEVER contain — and the loader
 * must NEVER store or surface — an approval token, secret, credential, raw HTTP
 * header, raw environment, raw stack trace, or raw request input.
 */

import { CapabilityPolicy } from '../capability-firewall/types.js';
import { TransportPolicyRule } from '../transport-policy/types.js';
import { PrivacyBoundaryRule } from '../privacy-boundary/types.js';
import {
  AdaptiveDefensePolicy,
  RateLimitPolicy
} from '../adaptive-defense/types.js';
import {
  CapabilityTransitionRule,
  DependencyIsolationPolicy
} from '../capability-graph/types.js';
import { TransportKind } from '../execution/types.js';

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
export type { TransportKind } from '../execution/types.js';

/**
 * One identity compartment described by configuration.
 *
 * A compartment is a logical isolation boundary; `enabled: false` declares it
 * but keeps it inert. It carries only secret-free metadata.
 */
export interface RuntimeCompartment {
  id: string;
  description?: string;
  enabled: boolean;
}

/**
 * The trust-scoring policy the runtime applies, as plain metadata.
 *
 * - `baselineScore`          — neutral starting score (0..100)
 * - `quarantinedThreshold`   — at or below this score a compartment is quarantined
 * - `restrictedThreshold`    — at or below this score a compartment is restricted
 *
 * Coherence: `0 <= quarantinedThreshold < restrictedThreshold < baselineScore
 * <= 100`.
 */
export interface RuntimeTrustPolicy {
  enabled: boolean;
  baselineScore: number;
  quarantinedThreshold: number;
  restrictedThreshold: number;
}

/**
 * The sandbox surface declared for a single transport.
 *
 * It is pure metadata describing what a transport is permitted to touch. For the
 * MVP the only transport is the fully sandboxed `mock` (every flag `false`).
 */
export interface RuntimeSandboxPolicy {
  transportKind: TransportKind;
  allowNetwork: boolean;
  allowFilesystem: boolean;
  allowProcessSpawn: boolean;
  allowBrowser: boolean;
}

/**
 * The complete, immutable runtime configuration of a GRL instance.
 *
 * Every field is a deterministic policy surface consumed by an engine. The
 * config is data only — it holds no live objects, no secrets, and no I/O
 * handles.
 */
export interface RuntimeConfig {
  /** Monotonic config version. Must be a positive integer. */
  version: number;

  compartments: RuntimeCompartment[];

  firewallPolicies: CapabilityPolicy[];

  transportPolicies: TransportPolicyRule[];

  privacyBoundaryRules: PrivacyBoundaryRule[];

  adaptiveDefensePolicies: AdaptiveDefensePolicy[];

  rateLimitPolicies: RateLimitPolicy[];

  trustPolicies: RuntimeTrustPolicy;

  graphTransitionRules: CapabilityTransitionRule[];

  isolationPolicies: DependencyIsolationPolicy[];

  sandboxPolicies: RuntimeSandboxPolicy[];
}

/**
 * An immutable, defensively-cloned point-in-time view of a {@link RuntimeConfig}.
 *
 * The snapshot is the unit handed to the engines: it bundles the config with
 * its `version`, the wall-clock `loadedAt`, and a deterministic `checksum` over
 * the canonical serialisation of the config. Two snapshots of structurally
 * equal configs always share the same checksum.
 */
export interface RuntimeConfigSnapshot {
  version: number;
  loadedAt: number;
  checksum: string;
  config: RuntimeConfig;
}
