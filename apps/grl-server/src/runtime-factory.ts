/**
 * Runtime dependency composition for the GRL local API.
 *
 * This module owns two concerns:
 *  1. The config-derived policy engines that are **rebuilt on every config
 *     reload** ({@link ReloadableDependencies}, {@link buildReloadableDependencies}).
 *  2. The low-level builder functions for those engines (previously inlined in
 *     `local-api.ts`), extracted here so the `createLocalApiApp` initialization
 *     block and the reload path share a single, testable composition function.
 *
 * Nothing here opens network connections, reads files, writes audit events, or
 * has side effects. All composition is synchronous and deterministic.
 *
 * Imports: `packages/core` and `packages/policy-engine` only — no circular dep
 * with `local-api.ts`.  `local-api.ts` re-exports the moved builder functions
 * from this module for backwards compatibility with existing test imports.
 */

import {
  AdaptiveDefenseEngine,
  AdaptiveDefensePolicy,
  CapabilityFirewall,
  CapabilityGraphEngine,
  CapabilityPolicy,
  CapabilityRateLimiter,
  ExecutionEngine,
  PrivacyBoundaryEngine,
  PrivacyBoundaryRule,
  RateLimitPolicy,
  RuntimeConfig,
  RuntimeConfigSnapshot,
  SEARXNG_SANDBOX_POLICY,
  SEARXNG_TRANSPORT_MANIFEST,
  TransportCapabilityRegistry,
  TransportPolicyEngine,
  TransportPolicyRule,
  buildSearXngAdapter,
} from '../../../packages/core/src/index.js';
import {
  PolicyDocument,
  PolicyRule,
  YamlPolicyEngine,
} from '../../../packages/policy-engine/src/index.js';

// ---------------------------------------------------------------------------
// Config-derived builder functions (previously in local-api.ts)
// ---------------------------------------------------------------------------

/** Build a Capability Firewall from declarative policy entries. */
export function buildFirewallFromConfig(
  policies: readonly CapabilityPolicy[]
): CapabilityFirewall {
  const rules: PolicyRule[] = [];
  for (const policy of policies) {
    const requiresConfirmation = policy.requiresConfirmationAbove !== undefined;
    for (const tool of policy.allowedTools) {
      rules.push({
        effect: 'allow',
        agentId: policy.agentId,
        compartment: policy.compartmentId,
        tool,
        maxRiskLevel: policy.maxRiskLevel,
        transport: 'direct',
        requiresConfirmation,
      });
    }
  }
  const document: PolicyDocument = { defaultDeny: true, rules };
  return new CapabilityFirewall(new YamlPolicyEngine(document));
}

/** Build a Transport Policy Engine from config transport-policy rules. */
export function buildTransportPolicyEngineFromConfig(
  rules: readonly TransportPolicyRule[]
): TransportPolicyEngine {
  const engine = new TransportPolicyEngine();
  for (const rule of rules) engine.registerRule(rule);
  return engine;
}

/** Build a Privacy Boundary Engine from config privacy-boundary rules. */
export function buildPrivacyBoundaryEngineFromConfig(
  rules: readonly PrivacyBoundaryRule[]
): PrivacyBoundaryEngine {
  const engine = new PrivacyBoundaryEngine();
  for (const rule of rules) engine.registerRule(rule);
  return engine;
}

/** Build a Capability Rate Limiter from config rate-limit policies. */
export function buildRateLimiterFromConfig(
  policies: readonly RateLimitPolicy[]
): CapabilityRateLimiter {
  const limiter = new CapabilityRateLimiter();
  for (const policy of policies) limiter.registerPolicy(policy);
  return limiter;
}

/** Build an Adaptive Defense Engine from config adaptive-defense policies. */
export function buildAdaptiveDefenseEngineFromConfig(
  policies: readonly AdaptiveDefensePolicy[]
): AdaptiveDefenseEngine {
  const engine = new AdaptiveDefenseEngine();
  for (const policy of policies) engine.registerPolicy(policy);
  return engine;
}

/** Build a Capability Graph Engine from config graph rules and isolation policies. */
export function buildCapabilityGraphEngineFromConfig(
  config: RuntimeConfig
): CapabilityGraphEngine {
  const engine = new CapabilityGraphEngine();
  for (const rule of config.graphTransitionRules) engine.registerTransitionRule(rule);
  for (const policy of config.isolationPolicies) engine.registerIsolationPolicy(policy);
  return engine;
}

/**
 * Build the real execution engine for `/v1/capabilities/execute`.
 *
 * Returns an {@link ExecutionEngine} wired with the {@link SearXngTransportAdapter}
 * and {@link SEARXNG_SANDBOX_POLICY} when SearXNG is enabled in the config.
 * Returns `null` when SearXNG is absent or disabled — the caller must treat null
 * as `NO_REAL_TRANSPORT_AVAILABLE` and deny the request. Never falls back to mock.
 *
 * Throws {@link SearXngConfigError} for structurally invalid configs (non-loopback
 * baseUrl, invalid timeout, etc.).
 */
export function buildSearXngExecutionEngine(
  config: RuntimeConfig
): ExecutionEngine | null {
  const adapter = buildSearXngAdapter(config.transports?.searxng);
  if (!adapter) return null;
  const registry = new TransportCapabilityRegistry();
  registry.registerManifest(SEARXNG_TRANSPORT_MANIFEST);
  return new ExecutionEngine({
    adapters: [adapter],
    registry,
    sandboxPolicy: SEARXNG_SANDBOX_POLICY,
  });
}

// ---------------------------------------------------------------------------
// ReloadableDependencies — rebuilt on every successful config reload
// ---------------------------------------------------------------------------

/**
 * The set of policy engines derived from the active {@link RuntimeConfigSnapshot}.
 * Rebuilt on every successful config reload. Stateful components (sessions,
 * approvals, trust, audit) survive reloads and are NOT included here.
 */
export interface ReloadableDependencies {
  firewall: CapabilityFirewall;
  transportPolicyEngine: TransportPolicyEngine;
  privacyBoundaryEngine: PrivacyBoundaryEngine;
  rateLimiter: CapabilityRateLimiter;
  adaptiveDefenseEngine: AdaptiveDefenseEngine;
  capabilityGraphEngine: CapabilityGraphEngine;
  /**
   * Real SearXNG execution engine for `/execute`. `null` when SearXNG is absent
   * or disabled — the endpoint returns `NO_REAL_TRANSPORT_AVAILABLE`. Never mock.
   */
  realSearXngEngine: ExecutionEngine | null;
}

/**
 * Build (or rebuild) the config-derived dependency tier from a snapshot.
 *
 * Injected overrides (`opts`) win — intended for test injection on initial
 * construction only. Reloads must pass no overrides (default `{}`).
 */
export function buildReloadableDependencies(
  snapshot: RuntimeConfigSnapshot,
  opts: {
    firewall?: CapabilityFirewall;
    transportPolicyEngine?: TransportPolicyEngine;
    privacyBoundaryEngine?: PrivacyBoundaryEngine;
    rateLimiter?: CapabilityRateLimiter;
    adaptiveDefenseEngine?: AdaptiveDefenseEngine;
    capabilityGraphEngine?: CapabilityGraphEngine;
  } = {}
): ReloadableDependencies {
  const cfg = snapshot.config;
  let realSearXngEngine: ExecutionEngine | null = null;
  try {
    realSearXngEngine = buildSearXngExecutionEngine(cfg);
  } catch {
    // fail-closed: bad SearXNG config → null, /execute will return denied
  }
  return {
    firewall: opts.firewall ?? buildFirewallFromConfig(cfg.firewallPolicies),
    transportPolicyEngine:
      opts.transportPolicyEngine ??
      buildTransportPolicyEngineFromConfig(cfg.transportPolicies),
    privacyBoundaryEngine:
      opts.privacyBoundaryEngine ??
      buildPrivacyBoundaryEngineFromConfig(cfg.privacyBoundaryRules),
    rateLimiter:
      opts.rateLimiter ?? buildRateLimiterFromConfig(cfg.rateLimitPolicies),
    adaptiveDefenseEngine:
      opts.adaptiveDefenseEngine ??
      buildAdaptiveDefenseEngineFromConfig(cfg.adaptiveDefensePolicies),
    capabilityGraphEngine:
      opts.capabilityGraphEngine ?? buildCapabilityGraphEngineFromConfig(cfg),
    realSearXngEngine,
  };
}
