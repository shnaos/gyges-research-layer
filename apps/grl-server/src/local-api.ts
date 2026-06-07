import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Response as ExpressResponse } from 'express';
import {
  ApprovalQueue,
  ApprovalRequest,
  AuditQuery,
  AdaptiveDefenseEngine,
  AdaptiveDefensePolicy,
  CapabilityFirewall,
  CapabilityRequest,
  CapabilityTool,
  CapabilityGraphEngine,
  CapabilityEdge as CapabilityGraphEdge,
  CapabilityGraphFilter,
  CapabilityNode as CapabilityGraphNode,
  CapabilityPathDecision,
  CapabilityTransitionRule,
  DependencyIsolationPolicy,
  CapabilityRateLimiter,
  CompartmentTrustEngine,
  DefenseAction,
  DEFAULT_APPROVAL_TTL_MS,
  DynamicRiskEscalation,
  ExecutionEngine,
  ExecutionRequest,
  IdentityCompartment,
  INITIAL_TRUST_SCORE,
  MockTransportAdapter,
  PrivacyBoundaryDecision,
  PrivacyBoundaryEngine,
  PrivacyBoundaryRule,
  RateLimitDecision,
  RateLimitPolicy,
  ReputationEvent,
  ReputationEventType,
  ReputationProfile,
  RiskLevel,
  RoutingDecision,
  RuntimeAnomaly,
  RuntimeIncident,
  RuntimeSecurityHeuristicsEngine,
  IncidentDetector,
  IncidentStore,
  SandboxDecision,
  SecurityEvent,
  SecurityEventEngine,
  SecurityEventType,
  EventSeverity,
  SessionManager,
  SessionRecord,
  SessionReusePolicy,
  TemporaryCapabilityBlock,
  TransportCapabilityAudit,
  TransportCapabilityRegistry,
  TransportManifest,
  TransportPolicyEngine,
  TransportPolicyError,
  TransportPolicyRule,
  escalateRisk,
  CapabilityPolicy,
  RuntimeCompartment,
  RuntimeConfig,
  RuntimeConfigSnapshot,
  RuntimeConfigLoader,
  RuntimeConfigEvent,
  RuntimeConfigEventType,
  RuntimeConfigValidationError,
  createSnapshot,
  DEFAULT_RUNTIME_CONFIG,
  BOOTSTRAP_ADAPTIVE_DEFENSE_POLICIES,
  BOOTSTRAP_CAPABILITY_TRANSITION_RULES,
  BOOTSTRAP_DEPENDENCY_ISOLATION_POLICY,
  BOOTSTRAP_HEURISTIC_RULES,
  BOOTSTRAP_PRIVACY_BOUNDARY_RULES,
  BOOTSTRAP_RATE_LIMIT_POLICIES,
  BOOTSTRAP_TRANSPORT_MANIFESTS,
  BOOTSTRAP_TRANSPORT_POLICY_RULES,
  STRICT_SANDBOX_POLICY,
  SEARXNG_TRANSPORT_MANIFEST,
  SEARXNG_SANDBOX_POLICY,
  buildSearXngAdapter,
  SearXngConfigError,
  RuntimeProfileResolver,
  RuntimeProfileResolutionError,
  RUNTIME_PROFILE_NAMES,
  BUILT_IN_PACKS,
  BUILT_IN_PROFILES,
  isValidProfileName,
  type PolicyPack,
  type RuntimeProfile,
  type ResolvedRuntimeProfile,
  type RuntimeProfileName,
  AgentRegistry,
  AgentQuotaManager,
  RuntimeLeaseManager,
  RuntimeScheduler,
  IsolationEngine,
  BehavioralPrivacyEngine,
  PersonaIsolationEngine,
  TemporalObfuscationEngine,
  TransportFingerprintEngine,
  type AgentRuntime,
  type BehavioralPrivacyDecision,
  type BehavioralProfile,
  type IdentityFragment,
  type RuntimeLease,
  type SearchPersona,
  type PersonaFragmentBinding,
  type PersonaCategory,
  type TemporalProfile,
  type TemporalPrivacyBudget,
  type FingerprintProfile,
  type HeaderIsolationPolicy,
  RuntimePolicyOrchestrator,
  PolicySignalCollector,
  type CompositeRuntimeDecision
} from '../../../packages/core/src/index.js';
import {
  PolicyDocument,
  PolicyRule,
  YamlPolicyEngine
} from '../../../packages/policy-engine/src/index.js';
import {
  ApprovalDecisionHttpResponse,
  AdaptiveDefensePoliciesHttpResponse,
  AdaptiveDefensePolicyView,
  AuditEventHttpResponse,
  AuditEventsHttpResponse,
  CapabilityEdgeView,
  CapabilityGraphEdgesHttpResponse,
  CapabilityGraphIsolationPoliciesHttpResponse,
  CapabilityGraphNodesHttpResponse,
  CapabilityGraphTransitionRulesHttpResponse,
  CapabilityNodeView,
  CapabilityPathDecisionView,
  CapabilityTransitionRuleView,
  CompartmentsHttpResponse,
  CompartmentView,
  DefenseDecisionView,
  DependencyIsolationPolicyView,
  EvaluateCapabilityHttpRequest,
  EvaluateCapabilityHttpResponse,
  ExecuteMockCapabilityHttpResponse,
  ExecutionResultView,
  HealthHttpResponse,
  PendingApprovalsHttpResponse,
  PendingApprovalView,
  PrivacyBoundariesHttpResponse,
  PrivacyBoundaryDecisionView,
  PrivacyBoundaryRuleView,
  RateLimitPoliciesHttpResponse,
  RateLimitPolicyView,
  ReputationEventsHttpResponse,
  ReputationEventView,
  ReputationProfileHttpResponse,
  ReputationProfilesHttpResponse,
  ReputationProfileView,
  RequestCapabilityHttpResponse,
  RoutingDecisionView,
  RuntimeConfigHttpResponse,
  RuntimeConfigChecksumHttpResponse,
  RuntimeConfigVersionHttpResponse,
  RuntimeReloadHttpResponse,
  RuntimeAnomaliesHttpResponse,
  RuntimeAnomalyView,
  RuntimeIncidentHttpResponse,
  RuntimeIncidentsHttpResponse,
  RuntimeIncidentView,
  SandboxDecisionView,
  SecurityEventView,
  SessionsHttpResponse,
  SessionView,
  TemporaryBlocksHttpResponse,
  TemporaryCapabilityBlockView,
  TransportCapabilityAuditView,
  TransportManifestView,
  TransportPoliciesHttpResponse,
  TransportPolicyRuleView,
  TrustView,
  TransportsAuditHttpResponse,
  TransportsHttpResponse,
  ExecuteCapabilityHttpResponse,
  RuntimeProfilesHttpResponse,
  RuntimeProfileHttpResponse,
  RuntimePacksHttpResponse,
  RuntimeProfileSwitchHttpResponse,
  RuntimeProfileView,
  PolicyPackView,
  AgentRuntimeView,
  AgentQuotaView,
  AgentLeaseView,
  AgentTrustView,
  AgentsHttpResponse,
  AgentHttpResponse,
  AgentLeasesHttpResponse,
  AgentSessionsHttpResponse,
  AgentTrustHttpResponse,
  AgentRestrictHttpResponse,
  AgentEvictHttpResponse,
  BehavioralProfilesHttpResponse,
  BehavioralProfileHttpResponse,
  IdentityFragmentsHttpResponse,
  JitterPoliciesHttpResponse,
  PersonasHttpResponse,
  PersonasByAgentHttpResponse,
  PersonaBindingsHttpResponse,
  PersonaBindingsByAgentHttpResponse,
  SegmentationPoliciesHttpResponse,
  TemporalProfilesHttpResponse,
  TemporalProfileHttpResponse,
  TemporalBudgetsHttpResponse,
  TemporalBudgetHttpResponse,
  TemporalPoliciesHttpResponse,
  FingerprintProfilesHttpResponse,
  FingerprintProfileHttpResponse,
  HeaderProfilesHttpResponse,
  HeaderPoliciesHttpResponse,
  type TemporalObfuscationView,
  type BehavioralProfileView,
  type FingerprintProfileView,
  type HeaderProfileView,
  type IdentityFragmentView,
  type SearchPersonaView,
  type PersonaFragmentBindingView,
  type TemporalProfileView,
  type TemporalBudgetView,
  type PolicySignalView,
  type PolicyConflictView,
  type CompositeRuntimeDecisionView,
  type CompositePrivacyPolicyView,
  type PolicyOrchestratorPoliciesHttpResponse,
  type PolicyOrchestratorSignalsHttpResponse,
  type PolicyOrchestratorLastDecisionHttpResponse
} from './api-contract.js';

/** Default local-only bind address. The server must never listen on 0.0.0.0. */
export const DEFAULT_HOST = '127.0.0.1';
/** Default local API port. */
export const DEFAULT_PORT = 8787;
/** Default maximum request body size (256 KiB) — generous for evaluate payloads. */
export const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

const VALID_RISK_LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high'];

/**
 * In-memory bootstrap policy for the Local API MVP.
 *
 * No persistence: this is the only policy the local server starts with. It maps
 * directly to deny-by-default firewall rules.
 *
 * - `low` is allowed without confirmation
 * - `medium`/`high` overflow the ceiling and are denied
 * - unknown agent / compartment / tool fall through to default-deny
 */
export const BOOTSTRAP_POLICY = {
  agentId: 'local-agent',
  compartmentId: 'research',
  allowedTools: ['search', 'fetch_html', 'fetch_json'],
  maxRiskLevel: 'low' as RiskLevel,
  requiresConfirmationAbove: 'low' as RiskLevel
} as const;

/**
 * In-memory bootstrap confirmation rule for the Approval Queue MVP.
 *
 * It deliberately lives ABOVE the deny ceiling of {@link BOOTSTRAP_POLICY} so
 * the human-in-the-loop path is reachable without weakening the existing
 * allow/deny behaviour: `fetch_html` at `medium` risk is allowed but flagged as
 * requiring confirmation, routing it into the approval queue.
 */
export const BOOTSTRAP_CONFIRMATION_RULE = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'fetch_html' as CapabilityTool,
  maxRiskLevel: 'medium' as RiskLevel
} as const;

/** Build the deny-by-default policy engine from the in-memory bootstrap policy. */
export function buildBootstrapEngine(): YamlPolicyEngine {
  const rules: PolicyRule[] = BOOTSTRAP_POLICY.allowedTools.map((tool) => ({
    effect: 'allow',
    agentId: BOOTSTRAP_POLICY.agentId,
    compartment: BOOTSTRAP_POLICY.compartmentId,
    tool: tool as CapabilityTool,
    maxRiskLevel: BOOTSTRAP_POLICY.maxRiskLevel,
    transport: 'direct',
    requiresConfirmation: false
  }));
  // Appended after the low-risk rules so a low-risk request still matches the
  // no-confirmation rule first; only medium-risk fetch_html reaches this one.
  rules.push({
    effect: 'allow',
    agentId: BOOTSTRAP_CONFIRMATION_RULE.agentId,
    compartment: BOOTSTRAP_CONFIRMATION_RULE.compartmentId,
    tool: BOOTSTRAP_CONFIRMATION_RULE.tool,
    maxRiskLevel: BOOTSTRAP_CONFIRMATION_RULE.maxRiskLevel,
    transport: 'direct',
    requiresConfirmation: true
  });
  const policy: PolicyDocument = { defaultDeny: true, rules };
  return new YamlPolicyEngine(policy);
}

/** Build a Capability Firewall backed by the bootstrap policy. */
export function buildBootstrapFirewall(): CapabilityFirewall {
  return new CapabilityFirewall(buildBootstrapEngine());
}

/** Build an in-memory approval queue with the configured TTL. */
export function buildApprovalQueue(ttlMs?: number): ApprovalQueue {
  return new ApprovalQueue({ ttlMs: ttlMs ?? DEFAULT_APPROVAL_TTL_MS });
}

/**
 * Build the Sprint 6 execution engine wired with the mock transport ONLY.
 *
 * This engine performs no real network I/O: the single registered adapter is
 * the deterministic {@link MockTransportAdapter}. No `direct`/`tor`/`proxy`/
 * `searxng`/`browser` transport is registered.
 *
 * When a {@link TransportCapabilityRegistry} is supplied, the engine enforces
 * the Sprint 10 adapter sandbox ({@link STRICT_SANDBOX_POLICY}) BEFORE invoking
 * the adapter: an unregistered transport, an unsupported tool, or a sandbox
 * violation yields a `blocked` result and the adapter is never called.
 */
export function buildMockExecutionEngine(
  registry?: TransportCapabilityRegistry
): ExecutionEngine {
  return new ExecutionEngine({
    adapters: [new MockTransportAdapter()],
    ...(registry
      ? { registry, sandboxPolicy: STRICT_SANDBOX_POLICY }
      : {})
  });
}

/**
 * Sprint 17 — Build the real execution engine for the /v1/capabilities/execute
 * endpoint.
 *
 * When the active runtime config has a valid, enabled SearXNG config, the engine
 * is built with a SearXNG adapter and the SEARXNG_SANDBOX_POLICY (which permits
 * network access). When SearXNG is disabled or absent, returns `null` so the
 * caller can fall back to the mock engine.
 *
 * Returns `null` when:
 *   - `config.transports?.searxng` is absent
 *   - `enabled: false`
 *
 * Throws {@link SearXngConfigError} when the config is present but structurally
 * invalid (e.g. non-loopback baseUrl, invalid timeout).
 */
export function buildSearXngExecutionEngine(
  config: RuntimeConfig
): ExecutionEngine | null {
  const searxngConfig = config.transports?.searxng;
  const adapter = buildSearXngAdapter(searxngConfig);
  if (!adapter) return null;

  const registry = new TransportCapabilityRegistry();
  registry.registerManifest(SEARXNG_TRANSPORT_MANIFEST);

  return new ExecutionEngine({
    adapters: [adapter],
    registry,
    sandboxPolicy: SEARXNG_SANDBOX_POLICY
  });
}

/**
 * Build the Sprint 10 Transport Capability Registry seeded with the bootstrap
 * manifest(s).
 *
 * The registry is deterministic and purely in-memory: it declares the mock
 * transport's capability surface and evaluates the adapter sandbox. It NEVER
 * loads a plugin, reads a manifest from disk, touches a database, or performs
 * any real network / browser / filesystem / process work.
 */
export function buildBootstrapTransportRegistry(): TransportCapabilityRegistry {
  const registry = new TransportCapabilityRegistry();
  for (const manifest of BOOTSTRAP_TRANSPORT_MANIFESTS) {
    registry.registerManifest(manifest);
  }
  return registry;
}

/**
 * Build the Sprint 8 Transport Policy Engine seeded with the bootstrap rules.
 *
 * The engine is deterministic and fail-closed: it decides transport/rotation/
 * isolation only. It NEVER mints a session, opens a connection, or executes —
 * and it references only the `mock` transport. No real network I/O.
 */
export function buildBootstrapTransportPolicyEngine(): TransportPolicyEngine {
  const engine = new TransportPolicyEngine();
  for (const rule of BOOTSTRAP_TRANSPORT_POLICY_RULES) {
    engine.registerRule(rule);
  }
  return engine;
}

/**
 * Build the Sprint 9 Privacy Boundary Engine seeded with the bootstrap rules.
 *
 * The engine is deterministic and fail-closed: it decides anti-correlation /
 * privacy boundary actions only. It NEVER mints a session, rotates a session,
 * opens a connection, or executes — and it performs no real network, browser,
 * DNS, socket, persistence, or AI/semantic classification work.
 */
export function buildBootstrapPrivacyBoundaryEngine(): PrivacyBoundaryEngine {
  const engine = new PrivacyBoundaryEngine();
  for (const rule of BOOTSTRAP_PRIVACY_BOUNDARY_RULES) {
    engine.registerRule(rule);
  }
  return engine;
}

/**
 * Build the Sprint 11 Security Event Engine backing the audit trail.
 *
 * The engine is deterministic-by-default in tests (injectable clock + id
 * generator) and purely in-memory: it records normalised, secret-free
 * {@link SecurityEvent}s and serves them back over the read endpoints. It NEVER
 * writes a file, opens a socket / DNS / network connection, spawns a process,
 * persists durably, or performs cloud telemetry.
 */
export function buildSecurityEventEngine(): SecurityEventEngine {
  return new SecurityEventEngine();
}

/**
 * Build the Sprint 12 Runtime Security Heuristics Engine seeded with the
 * bootstrap heuristic rules.
 *
 * The engine is deterministic and purely in-memory: it observes the normalised
 * security-event stream and raises static, threshold-based anomalies. It uses
 * NO ML, NO AI, NO semantic classification, and performs no network, browser,
 * DNS, socket, filesystem, process, or durable-persistence work.
 */
export function buildRuntimeSecurityHeuristicsEngine(): RuntimeSecurityHeuristicsEngine {
  const engine = new RuntimeSecurityHeuristicsEngine();
  for (const rule of BOOTSTRAP_HEURISTIC_RULES) {
    engine.registerRule(rule);
  }
  return engine;
}

/**
 * Build the Sprint 12 Incident Detector backed by an in-memory
 * {@link IncidentStore}.
 *
 * It auto-opens runtime incidents from anomalies, aggregates their related
 * event ids, and suppresses exact immediate duplicates. It is purely in-memory:
 * no database, no persistence, no network.
 */
export function buildIncidentDetector(store?: IncidentStore): IncidentDetector {
  return new IncidentDetector(store ? { store } : {});
}

/**
 * Build the Sprint 13 Capability Rate Limiter seeded with the bootstrap
 * rate-limit policies.
 *
 * The limiter is deterministic and purely in-memory: it counts requests over
 * static sliding windows and holds temporary capability blocks. It performs NO
 * network, persistence, AI/ML, or semantic classification work.
 */
export function buildCapabilityRateLimiter(): CapabilityRateLimiter {
  const limiter = new CapabilityRateLimiter();
  for (const policy of BOOTSTRAP_RATE_LIMIT_POLICIES) {
    limiter.registerPolicy(policy);
  }
  return limiter;
}

/**
 * Build the Sprint 13 Adaptive Defense Engine seeded with the bootstrap adaptive
 * defense policies.
 *
 * The engine is deterministic and purely in-memory: it maps the runtime
 * anomaly/incident vocabulary onto active defense actions. It performs NO
 * network, persistence, AI/ML, or semantic classification work.
 */
export function buildAdaptiveDefenseEngine(): AdaptiveDefenseEngine {
  const engine = new AdaptiveDefenseEngine();
  for (const policy of BOOTSTRAP_ADAPTIVE_DEFENSE_POLICIES) {
    engine.registerPolicy(policy);
  }
  return engine;
}

/**
 * Build the Sprint 14 Compartment Trust Engine.
 *
 * The engine is deterministic and purely in-memory: it maintains a bounded
 * trust score (0..100) per identity compartment, scored from static reputation
 * events, and progressively restores degraded compartments toward neutral. It
 * performs NO network, persistence, AI/ML, or semantic classification work and
 * never stores tokens, secrets, or raw request input.
 */
export function buildCompartmentTrustEngine(): CompartmentTrustEngine {
  return new CompartmentTrustEngine();
}

/**
 * Build the Sprint 15 Capability Graph Engine.
 *
 * The engine is deterministic and purely in-memory: it models capabilities as a
 * graph of nodes and edges, tracks each compartment's execution path, and
 * evaluates a prospective capability against its transition rules and
 * dependency-isolation policy. It performs NO network, persistence, AI/ML, or
 * semantic classification work and never stores tokens, secrets, or raw request
 * input. It is seeded with the bootstrap transition rules and the single static
 * `research` dependency-isolation policy.
 */
export function buildCapabilityGraphEngine(): CapabilityGraphEngine {
  const engine = new CapabilityGraphEngine();
  for (const rule of BOOTSTRAP_CAPABILITY_TRANSITION_RULES) {
    engine.registerTransitionRule(rule);
  }
  engine.registerIsolationPolicy(BOOTSTRAP_DEPENDENCY_ISOLATION_POLICY);
  return engine;
}

// ---------------------------------------------------------------------------
// Sprint 16 — config-driven engine builders.
//
// These rebuild the deterministic policy engines from a {@link RuntimeConfig}
// slice instead of the hard-coded bootstrap constants. The server uses them so
// the firewall / routing / privacy / rate-limiting / adaptive-defense / graph
// engines are derived from the active {@link RuntimeConfigSnapshot}. They remain
// purely in-memory and perform no network, persistence, AI/ML, or browser work.
// ---------------------------------------------------------------------------

/**
 * Build a Capability Firewall from declarative {@link CapabilityPolicy} entries.
 *
 * Each policy expands to one deny-by-default `allow` rule per tool at its
 * `maxRiskLevel`. A policy that declares `requiresConfirmationAbove` flags its
 * rules as requiring human confirmation (routing matching requests into the
 * approval queue). The expansion is order-preserving and reproduces the legacy
 * bootstrap firewall exactly. No transport is opened — `transport` is metadata.
 */
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
        requiresConfirmation
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
  for (const rule of rules) {
    engine.registerRule(rule);
  }
  return engine;
}

/** Build a Privacy Boundary Engine from config privacy-boundary rules. */
export function buildPrivacyBoundaryEngineFromConfig(
  rules: readonly PrivacyBoundaryRule[]
): PrivacyBoundaryEngine {
  const engine = new PrivacyBoundaryEngine();
  for (const rule of rules) {
    engine.registerRule(rule);
  }
  return engine;
}

/** Build a Capability Rate Limiter from config rate-limit policies. */
export function buildRateLimiterFromConfig(
  policies: readonly RateLimitPolicy[]
): CapabilityRateLimiter {
  const limiter = new CapabilityRateLimiter();
  for (const policy of policies) {
    limiter.registerPolicy(policy);
  }
  return limiter;
}

/** Build an Adaptive Defense Engine from config adaptive-defense policies. */
export function buildAdaptiveDefenseEngineFromConfig(
  policies: readonly AdaptiveDefensePolicy[]
): AdaptiveDefenseEngine {
  const engine = new AdaptiveDefenseEngine();
  for (const policy of policies) {
    engine.registerPolicy(policy);
  }
  return engine;
}

/**
 * Build a Capability Graph Engine from config graph transition rules and
 * dependency-isolation policies.
 */
export function buildCapabilityGraphEngineFromConfig(
  config: RuntimeConfig
): CapabilityGraphEngine {
  const engine = new CapabilityGraphEngine();
  for (const rule of config.graphTransitionRules) {
    engine.registerTransitionRule(rule);
  }
  for (const policy of config.isolationPolicies) {
    engine.registerIsolationPolicy(policy);
  }
  return engine;
}


/**
 * The subset of {@link SecurityEventType}s emitted by the trust layer itself.
 * Kept as a single shared type so the severity table and the emit helper stay
 * in sync if new trust audit events are added.
 */
type TrustAuditEventType =
  | 'trust_score_changed'
  | 'compartment_restricted'
  | 'compartment_quarantined'
  | 'trust_recovered';

/** Every valid {@link SecurityEventType}, used to validate audit query params. */
export const VALID_SECURITY_EVENT_TYPES: readonly SecurityEventType[] = [
  'capability_allowed',
  'capability_denied',
  'approval_pending',
  'approval_approved',
  'approval_rejected',
  'privacy_boundary_blocked',
  'privacy_boundary_rotation',
  'routing_resolved',
  'session_created',
  'session_rotated',
  'session_revoked',
  'sandbox_allowed',
  'sandbox_blocked',
  'execution_started',
  'execution_succeeded',
  'execution_blocked',
  'execution_failed',
  'rate_limit_triggered',
  'cooldown_applied',
  'temporary_block_applied',
  'risk_escalated',
  'adaptive_defense_triggered',
  'trust_score_changed',
  'compartment_restricted',
  'compartment_quarantined',
  'trust_recovered',
  'capability_graph_allowed',
  'capability_graph_blocked',
  'capability_graph_approval_required',
  'capability_graph_rotation_required',
  'config_loaded',
  'config_reloaded',
  'config_reload_failed',
  'config_validation_failed',
  'runtime_profile_loaded',
  'runtime_profile_switched',
  'runtime_profile_switch_failed',
  'policy_pack_applied',
  'agent_registered',
  'agent_restricted',
  'agent_quarantined',
  'agent_evicted',
  'agent_quota_exceeded',
  'agent_lease_acquired',
  'agent_lease_expired',
  'behavior_fragment_created',
  'behavior_fragment_rotated',
  'behavior_correlation_detected',
  'behavioral_jitter_applied',
  'behavioral_privacy_escalated',
  'persona_created',
  'persona_rotated',
  'persona_isolation_escalated',
  'persona_fragment_bound',
  'interest_segmentation_triggered',
  'temporal_spacing_applied',
  'burst_detected',
  'temporal_budget_exhausted',
  'temporal_scheduling_escalated',
  'cadence_smoothing_applied',
  'fingerprint_assigned',
  'fingerprint_rotated',
  'header_isolation_applied',
  'language_isolation_applied',
  'user_agent_rotated',
  'runtime_policy_evaluated',
  'runtime_policy_conflict_detected',
  'runtime_policy_decision_applied',
  'runtime_policy_signal_evicted'
];

/** Every valid {@link EventSeverity}, used to validate audit query params. */
export const VALID_EVENT_SEVERITIES: readonly EventSeverity[] = [
  'debug',
  'info',
  'warning',
  'critical'
];

// Sprint 29 — closed vocabularies used to validate the policy-orchestrator
// signals endpoint filters. Mirrors the core PolicySignalSource /
// UnifiedPrivacyAction / PolicySignalSeverity unions; an unknown filter value
// is rejected fail-closed (HTTP 400) rather than silently ignored.
type PolicySignalSourceValue =
  | 'capability_graph' | 'multi_agent' | 'behavioral_privacy' | 'persona_isolation'
  | 'temporal_obfuscation' | 'transport_fingerprint' | 'trust_reputation'
  | 'adaptive_defense' | 'capability_firewall' | 'privacy_boundary'
  | 'transport_policy' | 'sandbox';
type UnifiedPrivacyActionValue =
  | 'allow' | 'delay' | 'rotate_session' | 'rotate_fragment' | 'rotate_fingerprint'
  | 'require_approval' | 'cooldown' | 'temporary_block' | 'deny';
type PolicySignalSeverityValue = 'info' | 'low' | 'medium' | 'high' | 'critical';

export const VALID_POLICY_SIGNAL_SOURCES: readonly PolicySignalSourceValue[] = [
  'capability_graph', 'multi_agent', 'behavioral_privacy', 'persona_isolation',
  'temporal_obfuscation', 'transport_fingerprint', 'trust_reputation',
  'adaptive_defense', 'capability_firewall', 'privacy_boundary',
  'transport_policy', 'sandbox'
];
export const VALID_UNIFIED_PRIVACY_ACTIONS: readonly UnifiedPrivacyActionValue[] = [
  'allow', 'delay', 'rotate_session', 'rotate_fragment', 'rotate_fingerprint',
  'require_approval', 'cooldown', 'temporary_block', 'deny'
];
export const VALID_POLICY_SIGNAL_SEVERITIES: readonly PolicySignalSeverityValue[] = [
  'info', 'low', 'medium', 'high', 'critical'
];

/** Default session TTL (10 minutes) when `GRL_SESSION_TTL_MS` is unset. */
export const DEFAULT_SESSION_TTL_MS = 600_000;
/** Default per-session request ceiling when `GRL_SESSION_MAX_REQUESTS` is unset. */
export const DEFAULT_SESSION_MAX_REQUESTS = 25;
/** Default reuse policy when `GRL_SESSION_REUSE_POLICY` is unset. */
export const DEFAULT_SESSION_REUSE_POLICY: SessionReusePolicy = 'reuse_active';

/** Identity of the single statically-bootstrapped compartment. */
export const BOOTSTRAP_COMPARTMENT_ID = 'research';

export interface SessionBootstrapConfig {
  ttlMs: number;
  maxRequests: number;
  reusePolicy: SessionReusePolicy;
}

/**
 * Build the in-memory Session Manager for the Local API MVP.
 *
 * It registers exactly one static compartment (`research`). There is NO dynamic
 * compartment creation surface in this sprint: the manager keeps all state
 * in-memory and performs no persistence, no network, and no browser work. Its
 * sole job is to mint/reuse/rotate session *identities* for the mock transport.
 */
export function buildBootstrapSessionManager(
  config: SessionBootstrapConfig,
  now: () => number = Date.now
): SessionManager {
  const manager = new SessionManager(
    {
      defaultTtlMs: config.ttlMs,
      defaultMaxRequests: config.maxRequests
    },
    { now }
  );
  const compartment: IdentityCompartment = {
    id: BOOTSTRAP_COMPARTMENT_ID,
    label: 'Default research compartment',
    transportKind: 'mock',
    reusePolicy: config.reusePolicy,
    ttlMs: config.ttlMs,
    maxRequests: config.maxRequests,
    createdAt: now()
  };
  manager.registerCompartment(compartment);
  return manager;
}

/** Project an Identity Compartment into its public, secret-free HTTP view. */
function toCompartmentView(compartment: IdentityCompartment): CompartmentView {
  const view: CompartmentView = {
    id: compartment.id,
    transportKind: compartment.transportKind,
    reusePolicy: compartment.reusePolicy,
    ttlMs: compartment.ttlMs,
    maxRequests: compartment.maxRequests,
    createdAt: compartment.createdAt
  };
  if (compartment.label !== undefined) {
    view.label = compartment.label;
  }
  return view;
}

/** Project a Session Record into its public, secret-free HTTP view. */
function toSessionView(session: SessionRecord): SessionView {
  const view: SessionView = {
    sessionId: session.sessionId,
    compartmentId: session.compartmentId,
    transportKind: session.transportKind,
    status: session.status,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    requestCount: session.requestCount
  };
  if (session.lastUsedAt !== undefined) {
    view.lastUsedAt = session.lastUsedAt;
  }
  return view;
}

/** Project a Transport Policy Rule into its public, secret-free HTTP view. */
function toTransportPolicyRuleView(
  rule: TransportPolicyRule
): TransportPolicyRuleView {
  return {
    tool: rule.tool,
    riskLevel: rule.riskLevel,
    preferredTransport: rule.preferredTransport,
    isolationPolicy: {
      level: rule.isolationPolicy.level,
      forceRotateOnHighRisk: rule.isolationPolicy.forceRotateOnHighRisk,
      forbidSessionReuse: rule.isolationPolicy.forbidSessionReuse,
      allowCrossToolReuse: rule.isolationPolicy.allowCrossToolReuse
    }
  };
}

/** Project a RoutingDecision into its public HTTP view. */
function toRoutingDecisionView(decision: RoutingDecision): RoutingDecisionView {
  return {
    transportKind: decision.transportKind,
    shouldRotateSession: decision.shouldRotateSession,
    isolationLevel: decision.isolationLevel,
    reason: decision.reason
  };
}

/** Project a Privacy Boundary Rule into its public, secret-free HTTP view. */
function toPrivacyBoundaryRuleView(
  rule: PrivacyBoundaryRule
): PrivacyBoundaryRuleView {
  return {
    id: rule.id,
    sourceCompartmentId: rule.sourceCompartmentId,
    targetCompartmentId: rule.targetCompartmentId,
    maxAllowedRisk: rule.maxAllowedRisk,
    actionOnViolation: rule.actionOnViolation
  };
}

/** Project a PrivacyBoundaryDecision into its public HTTP view. */
function toPrivacyBoundaryDecisionView(
  decision: PrivacyBoundaryDecision
): PrivacyBoundaryDecisionView {
  return {
    action: decision.action,
    riskLevel: decision.riskLevel,
    signals: [...decision.signals],
    reason: decision.reason
  };
}

/** Project a Transport Manifest into its public, secret-free HTTP view. */
function toTransportManifestView(
  manifest: TransportManifest
): TransportManifestView {
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

/** Project a Transport Capability Audit into its public HTTP view. */
function toTransportCapabilityAuditView(
  entry: TransportCapabilityAudit
): TransportCapabilityAuditView {
  return {
    kind: entry.kind,
    supportedTools: [...entry.supportedTools],
    declaredPermissions: [...entry.declaredPermissions],
    networkAccess: entry.networkAccess,
    browserAccess: entry.browserAccess,
    filesystemAccess: entry.filesystemAccess,
    processSpawnAccess: entry.processSpawnAccess,
    envAccess: entry.envAccess
  };
}

/** Project a SandboxDecision into its public HTTP view. */
function toSandboxDecisionView(decision: SandboxDecision): SandboxDecisionView {
  return {
    action: decision.action,
    violations: decision.violations.map((violation) => ({
      code: violation.code,
      reason: violation.reason
    }))
  };
}

/** Project a recorded {@link SecurityEvent} into its public HTTP view. */
function toSecurityEventView(event: SecurityEvent): SecurityEventView {
  const view: SecurityEventView = {
    id: event.id,
    timestamp: event.timestamp,
    type: event.type,
    severity: event.severity,
    message: event.message
  };
  if (event.agentId !== undefined) view.agentId = event.agentId;
  if (event.compartmentId !== undefined) view.compartmentId = event.compartmentId;
  if (event.sessionId !== undefined) view.sessionId = event.sessionId;
  if (event.requestId !== undefined) view.requestId = event.requestId;
  if (event.executionId !== undefined) view.executionId = event.executionId;
  if (event.approvalRequestId !== undefined) {
    view.approvalRequestId = event.approvalRequestId;
  }
  if (event.metadata !== undefined) view.metadata = event.metadata;
  return view;
}

/**
 * Project a detected {@link RuntimeAnomaly} into its public, secret-free HTTP
 * view. The mapping is a structural pass-through: the anomaly already carries
 * only minimal, secret-free metadata.
 */
function toRuntimeAnomalyView(anomaly: RuntimeAnomaly): RuntimeAnomalyView {
  const view: RuntimeAnomalyView = {
    id: anomaly.id,
    createdAt: anomaly.createdAt,
    type: anomaly.type,
    score: anomaly.score,
    relatedEventIds: [...anomaly.relatedEventIds],
    summary: anomaly.summary
  };
  if (anomaly.metadata !== undefined) view.metadata = anomaly.metadata;
  return view;
}

/** Project a {@link RuntimeIncident} into its public, secret-free HTTP view. */
function toRuntimeIncidentView(incident: RuntimeIncident): RuntimeIncidentView {
  return {
    id: incident.id,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
    severity: incident.severity,
    status: incident.status,
    anomalyIds: [...incident.anomalyIds],
    relatedEventIds: [...incident.relatedEventIds],
    summary: incident.summary
  };
}

/** Project a {@link RateLimitPolicy} into its public, secret-free HTTP view. */
function toRateLimitPolicyView(policy: RateLimitPolicy): RateLimitPolicyView {
  return {
    id: policy.id,
    scope: policy.scope,
    maxRequests: policy.maxRequests,
    windowMs: policy.windowMs,
    action: policy.action,
    enabled: policy.enabled
  };
}

/** Project a {@link TemporaryCapabilityBlock} into its public HTTP view. */
function toTemporaryBlockView(
  block: TemporaryCapabilityBlock
): TemporaryCapabilityBlockView {
  const view: TemporaryCapabilityBlockView = {
    id: block.id,
    createdAt: block.createdAt,
    expiresAt: block.expiresAt,
    reason: block.reason
  };
  if (block.agentId !== undefined) view.agentId = block.agentId;
  if (block.compartmentId !== undefined) view.compartmentId = block.compartmentId;
  if (block.tool !== undefined) view.tool = block.tool;
  return view;
}

/** Project an {@link AdaptiveDefensePolicy} into its public HTTP view. */
function toAdaptiveDefensePolicyView(
  policy: AdaptiveDefensePolicy
): AdaptiveDefensePolicyView {
  const view: AdaptiveDefensePolicyView = {
    id: policy.id,
    triggerAnomalyTypes: [...policy.triggerAnomalyTypes],
    triggerIncidentSeverities: [...policy.triggerIncidentSeverities],
    resultingAction: policy.resultingAction,
    enabled: policy.enabled
  };
  if (policy.cooldownMs !== undefined) view.cooldownMs = policy.cooldownMs;
  if (policy.escalationRiskLevel !== undefined) {
    view.escalationRiskLevel = policy.escalationRiskLevel;
  }
  return view;
}

/** Project a {@link ReputationProfile}'s score into the compact trust view. */
function toTrustView(profile: ReputationProfile): TrustView {
  return {
    compartmentId: profile.compartmentId,
    score: profile.score.value,
    level: profile.score.level
  };
}

function toBehavioralProfileView(profile: BehavioralProfile): BehavioralProfileView {
  return {
    agentId: profile.agentId,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    correlationRisk: profile.correlationRisk,
    activeIdentityFragments: profile.activeIdentityFragments,
    recentSearchTopics: [...profile.recentSearchTopics],
    temporalPatternsDetected: profile.temporalPatternsDetected,
    repeatedBehaviorScore: profile.repeatedBehaviorScore
  };
}

function toIdentityFragmentView(fragment: IdentityFragment): IdentityFragmentView {
  return {
    id: fragment.id,
    agentId: fragment.agentId,
    createdAt: fragment.createdAt,
    expiresAt: fragment.expiresAt,
    isolatedSessionIds: [...fragment.isolatedSessionIds],
    isolatedTransportKinds: [...fragment.isolatedTransportKinds],
    active: fragment.active,
    requestCount: fragment.requestCount
  };
}

/** Project a {@link RuntimeLease} into its public, secret-free HTTP view. */
function toLeaseView(lease: RuntimeLease): AgentLeaseView {
  return {
    id: lease.id,
    acquiredAt: lease.acquiredAt,
    expiresAt: lease.expiresAt,
    renewable: lease.renewable,
    holderAgentId: lease.holderAgentId
  };
}

/** Project a {@link SearchPersona} into its public, secret-free HTTP view. */
function toSearchPersonaView(persona: SearchPersona): SearchPersonaView {
  return {
    id: persona.id,
    agentId: persona.agentId,
    createdAt: persona.createdAt,
    updatedAt: persona.updatedAt,
    category: persona.category,
    active: persona.active,
    fragmentIds: [...persona.fragmentIds],
    isolatedSessionIds: [...persona.isolatedSessionIds],
    searchCount: persona.searchCount,
    correlationRisk: persona.correlationRisk
  };
}

/** Project a {@link PersonaFragmentBinding} into its public, secret-free HTTP view. */
function toPersonaFragmentBindingView(
  binding: PersonaFragmentBinding
): PersonaFragmentBindingView {
  return {
    personaId: binding.personaId,
    fragmentId: binding.fragmentId,
    createdAt: binding.createdAt,
    active: binding.active
  };
}

/** Project a TemporalProfile into its public, secret-free HTTP view. */
function toTemporalProfileView(profile: TemporalProfile): TemporalProfileView {
  return {
    agentId: profile.agentId,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    cadenceRisk: profile.cadenceRisk,
    recentExecutionTimestamps: [...profile.recentExecutionTimestamps],
    detectedBursts: profile.detectedBursts,
    smoothedRequests: profile.smoothedRequests,
    temporalBudget: toTemporalBudgetView(profile.temporalBudget),
    currentDelayMs: profile.currentDelayMs
  };
}

/** Project a TemporalPrivacyBudget into its public, secret-free HTTP view. */
function toTemporalBudgetView(budget: TemporalPrivacyBudget): TemporalBudgetView {
  return {
    maxRequestsPerWindow: budget.maxRequestsPerWindow,
    windowMs: budget.windowMs,
    consumed: budget.consumed,
    remaining: budget.remaining,
    resetsAt: budget.resetsAt
  };
}

function toFingerprintProfileView(p: FingerprintProfile): FingerprintProfileView {
  return {
    agentId: p.agentId,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    activeFingerprintId: p.activeFingerprintId,
    rotationCount: p.rotationCount,
    requestCount: p.requestCount,
    correlationRisk: p.correlationRisk,
    assignedUserAgent: p.assignedUserAgent,
    assignedLanguage: p.assignedLanguage
  };
}

/** Convert a CompositeRuntimeDecision to its public HTTP view (no raw input/tokens). */
function toRuntimePolicyDecisionView(d: CompositeRuntimeDecision): CompositeRuntimeDecisionView {
  const view: CompositeRuntimeDecisionView = {
    action: d.action,
    allowed: d.allowed,
    requiresDelay: d.requiresDelay,
    requiresApproval: d.requiresApproval,
    requiresSessionRotation: d.requiresSessionRotation,
    requiresFragmentRotation: d.requiresFragmentRotation,
    requiresFingerprintRotation: d.requiresFingerprintRotation,
    reason: d.reason,
    signals: d.signals.map((s): PolicySignalView => ({
      id: s.id,
      source: s.source,
      action: s.action,
      severity: s.severity,
      reason: s.reason,
      createdAt: s.createdAt,
      ...(s.metadata !== undefined ? { metadata: { ...s.metadata } } : {})
    })),
    conflicts: d.conflicts.map((c): PolicyConflictView => ({
      id: c.id,
      signalIds: [...c.signalIds],
      conflictType: c.conflictType,
      resolution: c.resolution,
      reason: c.reason
    }))
  };
  if (d.delayMs !== undefined) view.delayMs = d.delayMs;
  return view;
}

/**
 * Map a DefenseAction string to the corresponding UnifiedPrivacyAction for the
 * runtime policy orchestrator.  Any action not explicitly mapped (e.g.
 * `escalate_risk`) is treated as `allow` because it does not constitute a
 * blocking or restrictive decision in the orchestrator's action space.
 */
function defenseActionToOrchestratorAction(
  action: string
): 'temporary_block' | 'cooldown' | 'require_approval' | 'allow' {
  if (action === 'temporary_block') return 'temporary_block';
  if (action === 'cooldown') return 'cooldown';
  if (action === 'require_approval') return 'require_approval';
  return 'allow';
}

function extractPersonaCategory(input: unknown): PersonaCategory {
  const rawCategoryHint =
    typeof input === 'object' && input !== null && !Array.isArray(input) &&
    'categoryHint' in (input as Record<string, unknown>)
      ? (input as Record<string, unknown>)['categoryHint']
      : undefined;
  const validCategories: readonly PersonaCategory[] = [
    'general', 'finance', 'crypto', 'security', 'health', 'politics', 'development', 'research', 'unknown'
  ];
  return typeof rawCategoryHint === 'string' && validCategories.includes(rawCategoryHint as PersonaCategory)
    ? (rawCategoryHint as PersonaCategory)
    : 'unknown';
}

function isSensitivePersonaCategory(category: PersonaCategory): boolean {
  return ['finance', 'crypto', 'security', 'health', 'politics'].includes(category);
}

/** Project an {@link AgentRuntime} into its public, secret-free HTTP view. */
function toAgentRuntimeView(runtime: AgentRuntime): AgentRuntimeView {
  const quota: AgentQuotaView = { ...runtime.quota };
  const view: AgentRuntimeView = {
    agentId: runtime.agentId,
    createdAt: runtime.createdAt,
    updatedAt: runtime.updatedAt,
    status: runtime.status,
    compartments: [...runtime.compartments],
    trustScore: runtime.trustScore,
    activeSessions: runtime.activeSessions,
    activeExecutions: runtime.activeExecutions,
    quota
  };
  if (runtime.lease !== undefined) {
    view.lease = toLeaseView(runtime.lease);
  }
  return view;
}

/** Project a single {@link ReputationEvent} into its public, secret-free view. */
function toReputationEventView(event: ReputationEvent): ReputationEventView {
  const view: ReputationEventView = {
    id: event.id,
    createdAt: event.createdAt,
    compartmentId: event.compartmentId,
    type: event.type,
    delta: event.delta,
    reason: event.reason
  };
  if (event.relatedEventId !== undefined) {
    view.relatedEventId = event.relatedEventId;
  }
  if (event.relatedIncidentId !== undefined) {
    view.relatedIncidentId = event.relatedIncidentId;
  }
  return view;
}

/** Project a {@link ReputationProfile} into its public, secret-free HTTP view. */
function toReputationProfileView(
  profile: ReputationProfile
): ReputationProfileView {
  return {
    compartmentId: profile.compartmentId,
    score: profile.score.value,
    level: profile.score.level,
    events: profile.events.map(toReputationEventView),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  };
}

/** Project a {@link CapabilityGraphNode} into its public, secret-free HTTP view. */
function toCapabilityNodeView(node: CapabilityGraphNode): CapabilityNodeView {
  const view: CapabilityNodeView = {
    id: node.id,
    kind: node.kind,
    createdAt: node.createdAt
  };
  if (node.agentId !== undefined) view.agentId = node.agentId;
  if (node.compartmentId !== undefined) view.compartmentId = node.compartmentId;
  if (node.tool !== undefined) view.tool = node.tool;
  if (node.riskLevel !== undefined) view.riskLevel = node.riskLevel;
  return view;
}

/** Project a {@link CapabilityGraphEdge} into its public, secret-free HTTP view. */
function toCapabilityEdgeView(edge: CapabilityGraphEdge): CapabilityEdgeView {
  return {
    id: edge.id,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    relation: edge.relation,
    createdAt: edge.createdAt
  };
}

/** Project a {@link CapabilityTransitionRule} into its public HTTP view. */
function toCapabilityTransitionRuleView(
  rule: CapabilityTransitionRule
): CapabilityTransitionRuleView {
  return {
    id: rule.id,
    fromTool: rule.fromTool,
    toTool: rule.toTool,
    maxAllowedRisk: rule.maxAllowedRisk,
    actionOnViolation: rule.actionOnViolation,
    enabled: rule.enabled
  };
}

/** Project a {@link DependencyIsolationPolicy} into its public HTTP view. */
function toDependencyIsolationPolicyView(
  policy: DependencyIsolationPolicy
): DependencyIsolationPolicyView {
  return {
    id: policy.id,
    compartmentId: policy.compartmentId,
    maxPathLength: policy.maxPathLength,
    forbidCrossToolEscalation: policy.forbidCrossToolEscalation,
    requireApprovalOnToolChange: policy.requireApprovalOnToolChange,
    blockOnHighRiskPath: policy.blockOnHighRiskPath,
    enabled: policy.enabled
  };
}

/** Project a {@link CapabilityPathDecision} into its public, secret-free view. */
function toCapabilityPathDecisionView(
  decision: CapabilityPathDecision
): CapabilityPathDecisionView {
  return {
    action: decision.action,
    risk: decision.risk,
    reason: decision.reason,
    relatedNodeIds: [...decision.relatedNodeIds],
    relatedEdgeIds: [...decision.relatedEdgeIds]
  };
}

/**
 * Parse and validate the `GET /v1/audit/events` query string into an
 * {@link AuditQuery}. Returns `{ error }` on the first invalid parameter so the
 * endpoint can answer `400` — this is purely structural validation.
 */
function validateAuditQuery(
  raw: Record<string, unknown>
): { query: AuditQuery } | { error: string } {
  const query: AuditQuery = {};

  const readString = (key: string): string | undefined => {
    const value = raw[key];
    if (value === undefined) return undefined;
    return typeof value === 'string' ? value : '__invalid__';
  };

  const type = readString('type');
  if (type !== undefined) {
    if (!VALID_SECURITY_EVENT_TYPES.includes(type as SecurityEventType)) {
      return { error: `Invalid "type" query parameter: ${String(raw.type)}.` };
    }
    query.type = type as SecurityEventType;
  }

  const severity = readString('severity');
  if (severity !== undefined) {
    if (!VALID_EVENT_SEVERITIES.includes(severity as EventSeverity)) {
      return {
        error: `Invalid "severity" query parameter: ${String(raw.severity)}.`
      };
    }
    query.severity = severity as EventSeverity;
  }

  for (const key of [
    'agentId',
    'compartmentId',
    'sessionId',
    'requestId',
    'executionId'
  ] as const) {
    const value = readString(key);
    if (value !== undefined) {
      if (!isNonEmptyString(value)) {
        return { error: `Invalid "${key}" query parameter.` };
      }
      query[key] = value;
    }
  }

  for (const key of ['since', 'until'] as const) {
    const value = readString(key);
    if (value !== undefined) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        return { error: `Invalid "${key}" query parameter: must be an integer.` };
      }
      query[key] = parsed;
    }
  }

  const limit = readString('limit');
  if (limit !== undefined) {
    const parsed = Number(limit);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return {
        error: 'Invalid "limit" query parameter: must be a non-negative integer.'
      };
    }
    query.limit = parsed;
  }

  return { query };
}

export interface LocalApiOptions {
  firewall: CapabilityFirewall;
  /** Maximum accepted request body size in bytes. */
  maxBodyBytes?: number;
  /**
   * In-memory approval queue backing the human-in-the-loop endpoints. When
   * omitted, a fresh queue with the default TTL is created.
   */
  approvalQueue?: ApprovalQueue;
  /**
   * Execution engine backing the experimental `execute-mock` endpoint. When
   * omitted, a mock-only engine is created. It NEVER performs real network I/O.
   */
  executionEngine?: ExecutionEngine;
  /**
   * In-memory Session Manager backing `execute-mock` session identity and the
   * compartments/sessions read endpoints. When omitted, a bootstrap manager
   * with the single static `research` compartment is created. It performs no
   * persistence, no network, and no browser work.
   */
  sessionManager?: SessionManager;
  /**
   * Deterministic Transport Policy Engine backing `execute-mock` routing and the
   * `/v1/transport-policies` read endpoint. When omitted, a bootstrap engine
   * seeded with the static rules is created. It decides routing/rotation/
   * isolation only — it never mints a session, opens a connection, or executes.
   */
  transportPolicyEngine?: TransportPolicyEngine;
  /**
   * Deterministic Privacy Boundary Engine backing `execute-mock` anti-correlation
   * checks and the `/v1/privacy-boundaries` read endpoint. When omitted, a
   * bootstrap engine seeded with the static rules is created. It decides
   * correlation/boundary actions only — it never mints a session, rotates a
   * session, opens a connection, or executes.
   */
  privacyBoundaryEngine?: PrivacyBoundaryEngine;
  /**
   * Transport Capability Registry backing `execute-mock` sandbox enforcement and
   * the `/v1/transports` + `/v1/transports/audit` read endpoints. When omitted, a
   * bootstrap registry seeded with the static mock manifest is created. It is
   * purely in-memory: no plugin loading, no manifest file reads, no real
   * network / browser / filesystem / process work.
   */
  transportRegistry?: TransportCapabilityRegistry;
  /**
   * Security Event Engine backing the Sprint 11 audit trail. It records the
   * normalised security events emitted across the `execute-mock` lifecycle and
   * the approval endpoints, and serves them back over `GET /v1/audit/events`
   * and `GET /v1/audit/events/:id`. When omitted, a fresh in-memory engine is
   * created. It performs no persistence, no file write, and no network work.
   */
  securityEventEngine?: SecurityEventEngine;
  /**
   * Runtime Security Heuristics Engine (Sprint 12). It passively observes the
   * security events emitted across the `execute-mock` lifecycle and approval
   * endpoints, raising static, threshold-based anomalies. When omitted, a
   * bootstrap engine seeded with the static rules is created. It performs no
   * network, persistence, AI/ML, or semantic classification work.
   */
  heuristicsEngine?: RuntimeSecurityHeuristicsEngine;
  /**
   * Incident Detector (Sprint 12) backing `/v1/security/incidents`. It groups
   * anomalies into auto-opened runtime incidents (suppressing exact immediate
   * duplicates) in an in-memory {@link IncidentStore}. When omitted, a fresh
   * detector is created. It performs no persistence or network work.
   */
  incidentDetector?: IncidentDetector;
  /**
   * Capability Rate Limiter (Sprint 13). It runs FIRST in the execute-mock
   * defense pipeline (before the firewall), counting requests over static
   * sliding windows and enforcing temporary capability blocks. When omitted, a
   * bootstrap limiter seeded with the static rate-limit policies is created. It
   * performs no network, persistence, AI/ML, or semantic classification work.
   */
  rateLimiter?: CapabilityRateLimiter;
  /**
   * Adaptive Defense Engine (Sprint 13). It runs after the rate limiter (still
   * before the firewall), mapping the accumulated runtime anomalies/incidents
   * onto active defense actions (cooldown / temporary block / require approval /
   * risk escalation). When omitted, a bootstrap engine seeded with the static
   * adaptive policies is created. It performs no network, persistence, AI/ML, or
   * semantic classification work.
   */
  adaptiveDefenseEngine?: AdaptiveDefenseEngine;
  /**
   * Compartment Trust Engine (Sprint 14). It maintains a bounded trust score
   * (0..100) per identity compartment, gates execute-mock based on the
   * compartment's trust level (quarantined → denied, restricted → human
   * approval), and records reputation events from the security-event stream.
   * When omitted, a fresh in-memory engine is created. It performs no network,
   * persistence, AI/ML, or semantic classification work and never stores
   * tokens, secrets, or raw request input.
   */
  trustEngine?: CompartmentTrustEngine;
  /** Behavioral Privacy Engine (Sprint 24). In-memory, deterministic. */
  behavioralPrivacyEngine?: BehavioralPrivacyEngine;
  /** Persona Isolation Engine (Sprint 25). In-memory, deterministic. */
  personaIsolationEngine?: PersonaIsolationEngine;
  /**
   * Temporal Obfuscation Engine (Sprint 26). Reduces temporal correlation
   * fingerprints produced by AI agents (cadence, bursts, budget). In-memory,
   * deterministic. Never stores tokens, secrets, or raw request input.
   */
  temporalObfuscationEngine?: TemporalObfuscationEngine;
  /** Transport Fingerprint Engine (Sprint 27). */
  transportFingerprintEngine?: TransportFingerprintEngine;
  /**
   * Runtime Policy Orchestrator (Sprint 28). Collects policy signals from all
   * gates, resolves conflicts, and produces a composite privacy decision for
   * each execute request. In-memory, deterministic, fail-closed. Never stores
   * tokens, secrets, or raw request input.
   */
  runtimePolicyOrchestrator?: RuntimePolicyOrchestrator;
  /**
   * Capability Graph Engine (Sprint 15). It runs FIRST in the execute-mock
   * pipeline (before the trust gate), modelling capabilities as a graph and
   * evaluating each prospective capability against the compartment's execution
   * path, its transition rules, and its dependency-isolation policy. When
   * omitted, a bootstrap engine seeded with the static transition rules and the
   * `research` isolation policy is created. It performs no network, persistence,
   * AI/ML, or semantic classification work and never stores tokens, secrets, or
   * raw request input.
   */
  capabilityGraphEngine?: CapabilityGraphEngine;
  /**
   * Runtime Config Loader (Sprint 16). When provided AND it already holds a
   * snapshot, the firewall, routing, privacy, rate-limiting, adaptive-defense,
   * and capability-graph engines are derived from that snapshot's config instead
   * of the in-memory {@link DEFAULT_RUNTIME_CONFIG} fallback. It also backs the
   * `GET /v1/runtime/config*` read endpoints and `POST /v1/runtime/reload`. It
   * is local-only and never performs network, cloud, or durable-persistence
   * work beyond reading the user's own local JSON file.
   */
  runtimeConfigLoader?: RuntimeConfigLoader;
  /**
   * The active runtime profile name (Sprint 20). Determines which
   * {@link PolicyPack}s are applied on top of the resolved {@link RuntimeConfig}
   * at boot and after profile switches. Defaults to `'balanced'` when omitted.
   * Only local profile switching is supported — no cloud, no remote sync.
   */
  activeProfileName?: RuntimeProfileName;
  /**
   * The profile resolver (Sprint 20). Resolves profile names into concrete
   * {@link RuntimeConfig}s by applying the ordered sequence of
   * {@link PolicyPack}s. When omitted, the default
   * {@link RuntimeProfileResolver} seeded with the built-in packs and profiles
   * is created. Injected for testing.
   */
  profileResolver?: RuntimeProfileResolver;
  /**
   * Agent Registry (Sprint 23). Tracks per-agent runtime state (status,
   * quotas, trust, leases). When omitted, a fresh in-memory registry is
   * created. No persistence, no network.
   */
  agentRegistry?: AgentRegistry;
  /**
   * Runtime Lease Manager (Sprint 23). Issues timed leases per agent to
   * prevent starvation. When omitted, a fresh manager backed by the agent
   * registry is created. No persistence, no network.
   */
  leaseManager?: RuntimeLeaseManager;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Describe a request input WITHOUT ever storing it.
 *
 * Returns only a coarse `inputType` and a UTF-8 `inputSizeBytes` measurement —
 * never the raw value. This keeps the audit trail free of any sensitive request
 * payload while still recording a useful, privacy-safe shape signal.
 */
function describeInput(input: unknown): {
  inputType: string;
  inputSizeBytes: number;
} {
  const inputType =
    input === null
      ? 'null'
      : Array.isArray(input)
        ? 'array'
        : typeof input;
  let inputSizeBytes = 0;
  try {
    const serialized =
      typeof input === 'string' ? input : JSON.stringify(input ?? '');
    inputSizeBytes = Buffer.byteLength(serialized ?? '', 'utf8');
  } catch {
    inputSizeBytes = 0;
  }
  return { inputType, inputSizeBytes };
}

/**
 * Validate the raw HTTP body into a typed evaluate request.
 *
 * Returns a string describing the first validation error, or `null` when valid.
 * This is purely structural input validation — a *valid* request that the
 * firewall denies is NOT an error here.
 */
function validateEvaluateBody(
  body: unknown
): { request: EvaluateCapabilityHttpRequest } | { error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { error: 'Request body must be a JSON object.' };
  }
  const candidate = body as Record<string, unknown>;
  if (!isNonEmptyString(candidate.agentId)) {
    return { error: 'Field "agentId" is required and must be a non-empty string.' };
  }
  if (!isNonEmptyString(candidate.compartmentId)) {
    return { error: 'Field "compartmentId" is required and must be a non-empty string.' };
  }
  if (!isNonEmptyString(candidate.tool)) {
    return { error: 'Field "tool" is required and must be a non-empty string.' };
  }
  if (!isNonEmptyString(candidate.riskLevel)) {
    return { error: 'Field "riskLevel" is required and must be a non-empty string.' };
  }
  if (!VALID_RISK_LEVELS.includes(candidate.riskLevel as RiskLevel)) {
    return { error: `Field "riskLevel" must be one of: ${VALID_RISK_LEVELS.join(', ')}.` };
  }
  if (!('input' in candidate)) {
    return { error: 'Field "input" is required.' };
  }
  return {
    request: {
      agentId: candidate.agentId,
      compartmentId: candidate.compartmentId,
      tool: candidate.tool,
      riskLevel: candidate.riskLevel,
      input: candidate.input
    }
  };
}

/**
 * Project a queued {@link ApprovalRequest} into its public, token-free view.
 *
 * The approval token is never part of an {@link ApprovalRequest}; this mapping
 * also drops `input`/`sanitizedInput` so the pending listing exposes only the
 * metadata a human needs to make a decision.
 */
function toPendingApprovalView(request: ApprovalRequest): PendingApprovalView {
  return {
    id: request.id,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    agentId: request.agentId,
    compartmentId: request.compartmentId,
    tool: request.tool,
    riskLevel: request.riskLevel,
    reason: request.reason,
    status: 'pending'
  };
}

/**
 * Handle an approve/reject decision and map the queue result to HTTP codes:
 *   - 200 success
 *   - 400 invalid / missing token
 *   - 404 unknown request
 *   - 409 already finalized
 *   - 410 expired
 */
function handleApprovalDecision(
  approvalQueue: ApprovalQueue,
  observe: (input: Parameters<SecurityEventEngine['emit']>[0]) => SecurityEvent,
  action: 'approve' | 'reject',
  req: express.Request,
  res: express.Response
): express.Response {
  if (!req.is('application/json')) {
    return res
      .status(400)
      .json({ error: 'Content-Type must be application/json.' });
  }

  const body = req.body as unknown;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return res.status(400).json({ error: 'Request body must be a JSON object.' });
  }
  const token = (body as Record<string, unknown>).token;
  if (!isNonEmptyString(token)) {
    return res
      .status(400)
      .json({ error: 'Field "token" is required and must be a non-empty string.' });
  }

  const id = req.params.id;
  const result =
    action === 'approve'
      ? approvalQueue.approve(id, token)
      : approvalQueue.reject(id, token);

  if (result.ok) {
    // Audit the decision WITHOUT the token. Only secret-free metadata is stored.
    observe({
      type: action === 'approve' ? 'approval_approved' : 'approval_rejected',
      severity: 'info',
      agentId: result.request.agentId,
      compartmentId: result.request.compartmentId,
      approvalRequestId: result.request.id,
      message:
        action === 'approve'
          ? 'Approval request approved.'
          : 'Approval request rejected.',
      metadata: {
        tool: result.request.tool,
        riskLevel: result.request.riskLevel
      }
    });
    const response: ApprovalDecisionHttpResponse = {
      id: result.request.id,
      status: result.request.status as 'approved' | 'rejected'
    };
    return res.status(200).json(response);
  }

  switch (result.error) {
    case 'not_found':
      return res.status(404).json({ error: 'Approval request not found.' });
    case 'expired':
      return res.status(410).json({ error: 'Approval request has expired.' });
    case 'already_finalized':
      return res
        .status(409)
        .json({ error: 'Approval request has already been finalized.' });
    case 'invalid_token':
    default:
      return res.status(400).json({ error: 'Invalid approval token.' });
  }
}

/**
 * Build the GRL Local API boundary app.
 *
 * Exposes only the local usage frontier of GRL:
 *   - `GET  /v1/health`
 *   - `POST /v1/capabilities/evaluate`
 *   - `POST /v1/capabilities/request`
 *   - `GET  /v1/approvals/pending`
 *   - `POST /v1/approvals/:id/approve`
 *   - `POST /v1/approvals/:id/reject`
 *
 * The evaluate/request endpoints run the real Capability Firewall. They perform
 * NO web transport, fetch, browser, or network egress — they return the
 * firewall decision only. A firewall deny is a successful evaluation (HTTP 200,
 * `allowed: false` / `decision: "denied"`), never an HTTP error. The approval
 * endpoints drive a purely in-memory human-in-the-loop queue.
 */
export function createLocalApiApp(options: LocalApiOptions): express.Express {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const approvalQueue = options.approvalQueue ?? buildApprovalQueue();
  const transportRegistry =
    options.transportRegistry ?? buildBootstrapTransportRegistry();
  const executionEngine =
    options.executionEngine ?? buildMockExecutionEngine(transportRegistry);
  const sessionManager =
    options.sessionManager ??
    buildBootstrapSessionManager({
      ttlMs: DEFAULT_SESSION_TTL_MS,
      maxRequests: DEFAULT_SESSION_MAX_REQUESTS,
      reusePolicy: DEFAULT_SESSION_REUSE_POLICY
    });
  const securityEventEngine =
    options.securityEventEngine ?? buildSecurityEventEngine();
  const heuristicsEngine =
    options.heuristicsEngine ?? buildRuntimeSecurityHeuristicsEngine();
  const incidentDetector =
    options.incidentDetector ?? buildIncidentDetector();
  const trustEngine = options.trustEngine ?? buildCompartmentTrustEngine();
  const behavioralPrivacyEngine =
    options.behavioralPrivacyEngine ?? new BehavioralPrivacyEngine();
  const personaIsolationEngine =
    options.personaIsolationEngine ?? new PersonaIsolationEngine();
  const temporalObfuscationEngine =
    options.temporalObfuscationEngine ?? new TemporalObfuscationEngine();
  const transportFingerprintEngine =
    options.transportFingerprintEngine ?? new TransportFingerprintEngine();

  // Sprint 28 — Runtime Policy Orchestrator. Collects signals from all gates
  // and produces a composite privacy decision. In-memory, deterministic,
  // fail-closed. Never stores tokens, secrets, or raw request input.
  const runtimePolicyOrchestrator =
    options.runtimePolicyOrchestrator ?? new RuntimePolicyOrchestrator();

  // Sprint 23 — Agent Registry and supporting multi-agent components.
  // All are purely in-memory; no network, persistence, browser, or external
  // transport work is performed.
  const agentRegistry = options.agentRegistry ?? new AgentRegistry();
  const quotaManager = new AgentQuotaManager({ registry: agentRegistry });
  const leaseManager =
    options.leaseManager ?? new RuntimeLeaseManager({ registry: agentRegistry });
  const agentScheduler = new RuntimeScheduler({ registry: agentRegistry });
  const isolationEngine = new IsolationEngine({ registry: agentRegistry });

  // Sprint 16 — the active runtime config. When a loader holding a snapshot is
  // supplied, the policy engines are derived from that snapshot's config;
  // otherwise the in-memory DEFAULT_RUNTIME_CONFIG fallback is used. The
  // fallback mirrors the legacy bootstrap constants exactly.
  const runtimeConfigLoader = options.runtimeConfigLoader;
  let activeSnapshot: RuntimeConfigSnapshot =
    runtimeConfigLoader?.getSnapshot() ??
    createSnapshot(DEFAULT_RUNTIME_CONFIG, Date.now());

  // The config-derived policy engines are rebuildable on reload. An explicitly
  // injected engine always wins on initial construction (test injection); a
  // reload rebuilds them from the freshly loaded config.
  let firewall = options.firewall;
  let transportPolicyEngine =
    options.transportPolicyEngine ??
    buildTransportPolicyEngineFromConfig(activeSnapshot.config.transportPolicies);
  let privacyBoundaryEngine =
    options.privacyBoundaryEngine ??
    buildPrivacyBoundaryEngineFromConfig(
      activeSnapshot.config.privacyBoundaryRules
    );
  let rateLimiter =
    options.rateLimiter ??
    buildRateLimiterFromConfig(activeSnapshot.config.rateLimitPolicies);
  let adaptiveDefenseEngine =
    options.adaptiveDefenseEngine ??
    buildAdaptiveDefenseEngineFromConfig(
      activeSnapshot.config.adaptiveDefensePolicies
    );
  let capabilityGraphEngine =
    options.capabilityGraphEngine ??
    buildCapabilityGraphEngineFromConfig(activeSnapshot.config);

  /**
   * Sprint 17 — real execution engine for POST /v1/capabilities/execute.
   *
   * Built from the active runtime config's `transports.searxng` section. If
   * SearXNG is enabled, this is a SearXNG-only engine with SEARXNG_SANDBOX_POLICY.
   * If SearXNG is absent or disabled, `realSearXngEngine` is `null` and the
   * execute endpoint falls back to the mock engine.
   *
   * Rebuilt on every config reload. Invalid configs are logged and ignored
   * (the previous engine is preserved — fail-safe for the searxng engine, since
   * the mock fallback is always available).
   */
  let realSearXngEngine: ExecutionEngine | null = (() => {
    try {
      return buildSearXngExecutionEngine(activeSnapshot.config);
    } catch {
      return null;
    }
  })();

  /**
   * Rebuild the config-derived policy engines from a freshly reloaded snapshot.
   * Stateful components (sessions, approvals, audit, trust) are intentionally
   * preserved across a reload — only the deterministic policy surfaces change.
   */
  const applyReloadedSnapshot = (snapshot: RuntimeConfigSnapshot): void => {
    activeSnapshot = snapshot;
    firewall = buildFirewallFromConfig(snapshot.config.firewallPolicies);
    transportPolicyEngine = buildTransportPolicyEngineFromConfig(
      snapshot.config.transportPolicies
    );
    privacyBoundaryEngine = buildPrivacyBoundaryEngineFromConfig(
      snapshot.config.privacyBoundaryRules
    );
    rateLimiter = buildRateLimiterFromConfig(snapshot.config.rateLimitPolicies);
    adaptiveDefenseEngine = buildAdaptiveDefenseEngineFromConfig(
      snapshot.config.adaptiveDefensePolicies
    );
    capabilityGraphEngine = buildCapabilityGraphEngineFromConfig(snapshot.config);
    try {
      realSearXngEngine = buildSearXngExecutionEngine(snapshot.config);
    } catch {
      // Fail-safe: an invalid searxng config on reload doesn't crash the server.
      // The previous engine is preserved.
    }
  };

  /**
   * Severity of each runtime-config audit event. A failed (re)load is a warning;
   * a successful (re)load is informational.
   */
  const CONFIG_AUDIT_SEVERITY: Record<RuntimeConfigEventType, EventSeverity> = {
    config_loaded: 'info',
    config_reloaded: 'info',
    config_reload_failed: 'warning',
    config_validation_failed: 'warning'
  };

  /**
   * Emit a runtime-config audit event straight to the audit store (NOT through
   * {@link observeSecurity}). Config events must never feed the heuristics
   * engine, which would risk a config → audit → config loop. Metadata is minimal
   * and secret-free (version, checksum, failure reason) — NEVER the file's raw
   * contents.
   */
  const emitConfigAudit = (event: RuntimeConfigEvent): void => {
    const metadata: Record<string, unknown> = {};
    if (event.version !== undefined) metadata.version = event.version;
    if (event.checksum !== undefined) metadata.checksum = event.checksum;
    if (event.reason !== undefined) metadata.reason = event.reason;
    securityEventEngine.emit({
      type: event.type,
      severity: CONFIG_AUDIT_SEVERITY[event.type],
      message: event.message,
      metadata
    });
  };

  // Wire the loader's lifecycle events into the audit trail and rebuild the
  // config-derived engines on every successful (re)load — including watch-driven
  // hot reloads. A failed reload keeps the previous snapshot/engines active.
  if (runtimeConfigLoader) {
    runtimeConfigLoader.addEventListener((event) => {
      emitConfigAudit(event);
      if (event.type === 'config_reloaded') {
        const next = runtimeConfigLoader.getSnapshot();
        if (next) applyReloadedSnapshot(next);
      }
    });
  }

  // Audit the initial config load (file-backed or DEFAULT fallback). The loader
  // already emitted its own `config_loaded` before this app (and listener)
  // existed, so the initial audit is emitted here exactly once.
  emitConfigAudit({
    type: 'config_loaded',
    version: activeSnapshot.version,
    checksum: activeSnapshot.checksum,
    message: 'Runtime config loaded.'
  });

  // ---------------------------------------------------------------------------
  // Sprint 20 — Policy Packs & Runtime Profiles.
  //
  // A RuntimeProfileResolver is built from the built-in packs and profiles (or
  // injected for testing). The active profile is resolved at boot from
  // GRL_PROFILE (via options.activeProfileName) and defaults to 'balanced'.
  // Profile switching is purely local — no cloud, no remote sync.
  // ---------------------------------------------------------------------------
  const profileResolver =
    options.profileResolver ?? new RuntimeProfileResolver();

  let activeProfileName: RuntimeProfileName =
    options.activeProfileName ?? 'balanced';

  // Boot-time profile resolution. Fail-closed: if the configured profile is
  // invalid, fall back to 'balanced' and emit a switch_failed audit event.
  let activeResolvedProfile: ResolvedRuntimeProfile | null = null;
  try {
    activeResolvedProfile = profileResolver.resolveProfile(
      activeProfileName,
      activeSnapshot.config
    );
    // Emit profile-loaded audit event (metadata only, no raw values).
    securityEventEngine.emit({
      type: 'runtime_profile_loaded',
      severity: 'info',
      message: `Runtime profile loaded: "${activeProfileName}".`,
      metadata: {
        profileName: activeProfileName,
        packIds: activeResolvedProfile.packs.map((p) => p.id)
      }
    });
    // Emit a pack-applied event for each pack.
    for (const pack of activeResolvedProfile.packs) {
      securityEventEngine.emit({
        type: 'policy_pack_applied',
        severity: 'debug',
        message: `Policy pack applied: "${pack.id}".`,
        metadata: { packId: pack.id, profileName: activeProfileName }
      });
    }
  } catch (err) {
    // Fail-closed: fall back to 'balanced' rather than crashing.
    const reason =
      err instanceof RuntimeProfileResolutionError ? err.reason : 'unknown';
    securityEventEngine.emit({
      type: 'runtime_profile_switch_failed',
      severity: 'warning',
      message: `Failed to load profile "${activeProfileName}", falling back to "balanced".`,
      metadata: { attempted: activeProfileName, reason }
    });
    activeProfileName = 'balanced';
    try {
      activeResolvedProfile = profileResolver.resolveProfile(
        'balanced',
        activeSnapshot.config
      );
    } catch {
      activeResolvedProfile = null;
    }
  }

  /**
   * Build an HTTP-safe view of a {@link RuntimeProfile}.
   *
   * Only metadata is returned — no raw overrides or resolved config values.
   */
  const toProfileView = (profile: RuntimeProfile): RuntimeProfileView => {
    const view: RuntimeProfileView = {
      name: profile.name,
      packIds: [...profile.packs],
      enabled: profile.enabled
    };
    if (profile.description !== undefined) view.description = profile.description;
    if (profile.extends !== undefined) view.extends = profile.extends;
    return view;
  };

  /**
   * Build an HTTP-safe view of a {@link PolicyPack}.
   *
   * Only the pack id, description, and the names of defined fields are returned
   * (no raw policy values — they are internal, though not secret).
   */
  const toPackView = (pack: PolicyPack): PolicyPackView => {
    const PACK_POLICY_FIELDS: (keyof PolicyPack)[] = [
      'firewallPolicies',
      'transportPolicies',
      'adaptiveDefensePolicies',
      'rateLimitPolicies',
      'privacyBoundaryRules',
      'graphTransitionRules',
      'isolationPolicies',
      'trustPolicies',
      'sandboxPolicies'
    ];
    const definedFields = PACK_POLICY_FIELDS.filter(
      (f) => pack[f] !== undefined
    );
    const view: PolicyPackView = { id: pack.id, definedFields };
    if (pack.description !== undefined) view.description = pack.description;
    return view;
  };

  /**
   * Map a recorded {@link SecurityEventType} onto the reputation event it feeds
   * the {@link CompartmentTrustEngine}. Only lifecycle outcomes that carry a
   * trust signal are mapped; everything else (including the trust audit events
   * below) is intentionally absent so trust never re-adjusts itself.
   */
  const REPUTATION_EVENT_BY_SECURITY_TYPE: Partial<
    Record<SecurityEventType, ReputationEventType>
  > = {
    capability_allowed: 'capability_allowed',
    capability_denied: 'capability_denied',
    approval_rejected: 'approval_rejected',
    privacy_boundary_blocked: 'privacy_boundary_blocked',
    sandbox_blocked: 'sandbox_blocked',
    execution_failed: 'execution_failed',
    execution_succeeded: 'clean_execution'
  };

  /**
   * Severity of each trust audit event. A degradation into a restricted /
   * quarantined band is more urgent than an ordinary score change or recovery.
   */
  const TRUST_AUDIT_SEVERITY: Record<TrustAuditEventType, EventSeverity> = {
    trust_score_changed: 'info',
    compartment_restricted: 'warning',
    compartment_quarantined: 'critical',
    trust_recovered: 'info'
  };

  // Remembers which compartment an open incident belongs to, so a later close
  // can credit the right compartment's reputation. Incidents themselves carry
  // no compartment id; the attribution is the compartment of the event that
  // opened the incident.
  const incidentCompartments = new Map<string, string>();

  /**
   * Emit a trust audit event straight to the audit store (NOT through
   * {@link observeSecurity}). Trust audit events must never be fed back into the
   * heuristics engine or the trust mapping, which would risk an audit → trust →
   * audit loop. Metadata is minimal and secret-free.
   */
  const emitTrustAudit = (
    type: TrustAuditEventType,
    compartmentId: string,
    score: number,
    level: string,
    message: string
  ): void => {
    securityEventEngine.emit({
      type,
      severity: TRUST_AUDIT_SEVERITY[type],
      compartmentId,
      message,
      metadata: { score, level }
    });
  };

  /**
   * Record one reputation event and emit the matching trust audit events when
   * the score (or band) changes. Fail-safe: any error is swallowed so trust
   * scoring can never break the primary flow.
   */
  const applyTrustEvent = (input: {
    compartmentId: string;
    type: ReputationEventType;
    reason: string;
    relatedEventId?: string;
    relatedIncidentId?: string;
    incidentSeverity?: 'info' | 'warning' | 'critical';
  }): void => {
    try {
      const before = trustEngine.getProfile(input.compartmentId);
      const oldValue = before?.score.value ?? INITIAL_TRUST_SCORE;
      const oldLevel = before?.score.level ?? 'neutral';
      const profile = trustEngine.recordEvent(input);
      const { value, level } = profile.score;
      if (value === oldValue && level === oldLevel) return;

      if (value !== oldValue) {
        emitTrustAudit(
          'trust_score_changed',
          input.compartmentId,
          value,
          level,
          'Compartment trust score changed.'
        );
      }
      if (value > oldValue) {
        emitTrustAudit(
          'trust_recovered',
          input.compartmentId,
          value,
          level,
          'Compartment trust recovered.'
        );
      }
      if (level === 'restricted' && oldLevel !== 'restricted') {
        emitTrustAudit(
          'compartment_restricted',
          input.compartmentId,
          value,
          level,
          'Compartment degraded to restricted.'
        );
      }
      if (level === 'quarantined' && oldLevel !== 'quarantined') {
        emitTrustAudit(
          'compartment_quarantined',
          input.compartmentId,
          value,
          level,
          'Compartment degraded to quarantined.'
        );
      }
    } catch {
      // Fail-safe: trust scoring is observational and must never break the flow.
    }
  };

  /**
   * Emit a security event AND feed it to the runtime heuristics engine and the
   * compartment trust engine.
   *
   * This is the single integration point for Sprints 12–14: every audited event
   * is observed by the heuristics engine (anomalies → incidents) and, when it
   * carries a compartment and a trust signal, mapped into a reputation event.
   * Newly opened incidents are also scored against the compartment of the
   * triggering event. The observer is strictly fail-safe — any heuristic or
   * trust error is swallowed so it can NEVER break the main `execute-mock` flow
   * or any approval decision. It never blocks, never mutates the request, and
   * never performs network work.
   */
  const observeSecurity = (
    input: Parameters<SecurityEventEngine['emit']>[0]
  ): SecurityEvent => {
    const event = securityEventEngine.emit(input);
    let openedIncidents: RuntimeIncident[] = [];
    try {
      const anomalies = heuristicsEngine.ingest(event);
      if (anomalies.length > 0) {
        const before = new Set(
          incidentDetector.listIncidents('open').map((incident) => incident.id)
        );
        incidentDetector.process(anomalies);
        openedIncidents = incidentDetector
          .listIncidents('open')
          .filter((incident) => !before.has(incident.id));
      }
    } catch {
      // Fail-safe: runtime heuristics are observational only and must never
      // interfere with the primary request flow.
    }

    // Map the event onto a reputation event for its compartment, then score any
    // freshly-opened incidents against the same compartment.
    if (event.compartmentId !== undefined) {
      const reputationType = REPUTATION_EVENT_BY_SECURITY_TYPE[event.type];
      if (reputationType !== undefined) {
        applyTrustEvent({
          compartmentId: event.compartmentId,
          type: reputationType,
          reason: `Security event ${event.type}.`,
          relatedEventId: event.id
        });
      }
      for (const incident of openedIncidents) {
        incidentCompartments.set(incident.id, event.compartmentId);
        applyTrustEvent({
          compartmentId: event.compartmentId,
          type: 'incident_opened',
          reason: `Runtime incident opened (${incident.severity}).`,
          relatedIncidentId: incident.id,
          incidentSeverity: incident.severity
        });
      }
    }
    return event;
  };

  const applyTransportFingerprint = (input: {
    agentId: string;
    compartmentId: string;
    requestId: string;
    personaChanged?: boolean;
    temporalEscalation?: boolean;
    sensitiveCategoryDetected?: boolean;
  }): {
    decision: ReturnType<TransportFingerprintEngine['evaluateIsolation']>;
    profile: FingerprintProfile;
    rotated: boolean;
  } => {
    const decision = transportFingerprintEngine.evaluateIsolation({
      agentId: input.agentId,
      personaChanged: input.personaChanged,
      temporalEscalation: input.temporalEscalation,
      sensitiveCategoryDetected: input.sensitiveCategoryDetected
    });

    let rotated = false;
    if (decision.requiresRotation) {
      rotated = true;
      const rotatedProfile = transportFingerprintEngine.rotateFingerprint(input.agentId);
      securityEventEngine.emit({
        type: 'fingerprint_rotated',
        severity: 'info',
        agentId: input.agentId,
        compartmentId: input.compartmentId,
        requestId: input.requestId,
        message: 'Transport fingerprint rotated.',
        metadata: {
          activeFingerprintId: rotatedProfile.activeFingerprintId,
          rotationCount: rotatedProfile.rotationCount,
          correlationRisk: rotatedProfile.correlationRisk,
          reason: decision.reason
        }
      });
      securityEventEngine.emit({
        type: 'user_agent_rotated',
        severity: 'info',
        agentId: input.agentId,
        compartmentId: input.compartmentId,
        requestId: input.requestId,
        message: 'Transport User-Agent rotated.',
        metadata: {
          activeFingerprintId: rotatedProfile.activeFingerprintId,
          rotationCount: rotatedProfile.rotationCount,
          userAgent: rotatedProfile.assignedUserAgent,
          reason: decision.reason
        }
      });
      securityEventEngine.emit({
        type: 'language_isolation_applied',
        severity: 'info',
        agentId: input.agentId,
        compartmentId: input.compartmentId,
        requestId: input.requestId,
        message: 'Transport language isolation applied.',
        metadata: {
          activeFingerprintId: rotatedProfile.activeFingerprintId,
          rotationCount: rotatedProfile.rotationCount,
          acceptLanguage: rotatedProfile.assignedLanguage,
          reason: decision.reason
        }
      });
    }

    const profile = transportFingerprintEngine.assignFingerprint({ agentId: input.agentId });
    securityEventEngine.emit({
      type: 'fingerprint_assigned',
      severity: 'info',
      agentId: input.agentId,
      compartmentId: input.compartmentId,
      requestId: input.requestId,
      message: 'Transport fingerprint assigned.',
      metadata: {
        activeFingerprintId: profile.activeFingerprintId,
        rotationCount: profile.rotationCount,
        requestCount: profile.requestCount,
        correlationRisk: profile.correlationRisk,
        reason: decision.reason
      }
    });

    if (decision.requiresHeaderIsolation) {
      securityEventEngine.emit({
        type: 'header_isolation_applied',
        severity: 'info',
        agentId: input.agentId,
        compartmentId: input.compartmentId,
        requestId: input.requestId,
        message: 'Transport header isolation applied.',
        metadata: {
          activeFingerprintId: profile.activeFingerprintId,
          rotationCount: profile.rotationCount,
          correlationRisk: profile.correlationRisk,
          reason: decision.reason
        }
      });
    }

    return { decision, profile, rotated };
  };

  // ── Sprint 29 — Runtime Policy Orchestrator finalisation & signal parity ──
  //
  // Both POST /v1/capabilities/execute-mock and POST /v1/capabilities/execute
  // collect their gate signals into a per-request PolicySignalCollector, then
  // evaluate ONE composite decision. The collector isolates per-request signals
  // (no cross-request / concurrent contamination) while still feeding the
  // orchestrator's bounded rolling inspection buffer that the
  // /v1/runtime/policy-orchestrator/signals endpoint serves.
  //
  // `finalizeRuntimePolicy` evaluates the collected signals, emits the
  // orchestrator audit events (evaluated, conflict_detected when any,
  // signal_evicted when the rolling buffer overflowed, decision_applied), and
  // returns the secret-free decision view. Audit events are emitted DIRECTLY via
  // securityEventEngine (not observeSecurity) to avoid an
  // audit→heuristics→orchestrator feedback loop. No raw input, tokens, or
  // secrets ever reach signal or event metadata.
  const finalizeRuntimePolicy = (
    collector: PolicySignalCollector,
    ctx: { agentId?: string; compartmentId?: string; requestId?: string }
  ): CompositeRuntimeDecisionView => {
    const { decision, evicted } = collector.evaluate();
    securityEventEngine.emit({
      type: 'runtime_policy_evaluated',
      severity: 'info',
      agentId: ctx.agentId,
      compartmentId: ctx.compartmentId,
      requestId: ctx.requestId,
      message: `Runtime policy evaluated: action="${decision.action}".`,
      metadata: {
        action: decision.action,
        signalCount: decision.signals.length,
        conflictCount: decision.conflicts.length
      }
    });
    if (decision.conflicts.length > 0) {
      securityEventEngine.emit({
        type: 'runtime_policy_conflict_detected',
        severity: 'warning',
        agentId: ctx.agentId,
        compartmentId: ctx.compartmentId,
        requestId: ctx.requestId,
        message: `Policy conflicts detected: ${decision.conflicts.length} conflict(s).`,
        metadata: { conflictCount: decision.conflicts.length }
      });
    }
    if (evicted > 0) {
      securityEventEngine.emit({
        type: 'runtime_policy_signal_evicted',
        severity: 'info',
        agentId: ctx.agentId,
        compartmentId: ctx.compartmentId,
        requestId: ctx.requestId,
        message: `Runtime policy signal buffer evicted ${evicted} oldest signal(s) (FIFO).`,
        metadata: { evictedCount: evicted, maxSignals: runtimePolicyOrchestrator.maxSignals }
      });
    }
    securityEventEngine.emit({
      type: 'runtime_policy_decision_applied',
      severity: 'info',
      agentId: ctx.agentId,
      compartmentId: ctx.compartmentId,
      requestId: ctx.requestId,
      message: `Runtime policy decision applied: action="${decision.action}".`,
      metadata: { action: decision.action, allowed: decision.allowed }
    });
    return toRuntimePolicyDecisionView(decision);
  };

  // Install a per-request response interceptor that injects the composite
  // runtimePolicy block into every decision-bearing response (decision =
  // allowed | denied | pending), no matter WHICH gate short-circuited. This
  // guarantees parity: every 200 decision path on both endpoints carries a
  // runtimePolicy evaluated from exactly the signals collected up to that point.
  // Protocol-error responses (400 content-type/validation, which carry `error`
  // and no `decision`, and the 405 handlers on separate routes) are left raw.
  const installRuntimePolicyInjection = (
    res: ExpressResponse,
    collector: PolicySignalCollector,
    ctx: { agentId?: string; compartmentId?: string; requestId?: string }
  ): void => {
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown): ExpressResponse => {
      if (
        body !== null &&
        typeof body === 'object' &&
        'decision' in body &&
        (body as { runtimePolicy?: unknown }).runtimePolicy === undefined
      ) {
        (body as { runtimePolicy?: CompositeRuntimeDecisionView }).runtimePolicy =
          finalizeRuntimePolicy(collector, ctx);
      }
      return originalJson(body);
    }) as ExpressResponse['json'];
  };

  // ── Sprint 29 — Multi-agent runtime gate & signals ──
  //
  // Emits real `multi_agent` policy signals from the agent registry state.
  // Read-only with respect to quota accounting: it idempotently registers the
  // agent (a fresh agent starts `idle`, under quota) and inspects status/counts.
  // It NEVER wires execution-count lifecycle into the request path (that stays
  // out of scope for Sprint 29); the quota-exceeded signal is derived read-only
  // from registry counts and is reachable by pre-setting agent state.
  type MultiAgentOutcome =
    | { kind: 'continue' }
    | { kind: 'deny'; reason: string }
    | { kind: 'approval'; reason: string };
  const evaluateMultiAgentGate = (
    collector: PolicySignalCollector,
    ctx: { agentId: string; compartmentId: string; requestId: string }
  ): MultiAgentOutcome => {
    const known = agentRegistry.getAgent(ctx.agentId) !== undefined;
    const runtime = agentRegistry.registerAgent(ctx.agentId);
    if (!known) {
      securityEventEngine.emit({
        type: 'agent_registered',
        severity: 'info',
        agentId: ctx.agentId,
        compartmentId: ctx.compartmentId,
        requestId: ctx.requestId,
        message: 'Agent registered with the runtime.',
        metadata: { status: runtime.status }
      });
    }

    if (runtime.status === 'evicted' || runtime.status === 'quarantined') {
      const reason = `Agent ${runtime.status}; execution denied.`;
      collector.emit({
        source: 'multi_agent',
        action: 'deny',
        severity: 'critical',
        reason,
        metadata: { agentStatus: runtime.status }
      });
      securityEventEngine.emit({
        type: runtime.status === 'evicted' ? 'agent_evicted' : 'agent_quarantined',
        severity: 'warning',
        agentId: ctx.agentId,
        compartmentId: ctx.compartmentId,
        requestId: ctx.requestId,
        message: `Agent ${runtime.status}; execution denied.`,
        metadata: { agentStatus: runtime.status }
      });
      return { kind: 'deny', reason };
    }

    if (runtime.status === 'restricted') {
      const reason = 'Agent restricted; human approval required.';
      collector.emit({
        source: 'multi_agent',
        action: 'require_approval',
        severity: 'high',
        reason,
        metadata: { agentStatus: runtime.status }
      });
      securityEventEngine.emit({
        type: 'agent_restricted',
        severity: 'warning',
        agentId: ctx.agentId,
        compartmentId: ctx.compartmentId,
        requestId: ctx.requestId,
        message: reason,
        metadata: { agentStatus: runtime.status }
      });
      return { kind: 'approval', reason };
    }

    if (runtime.activeExecutions >= runtime.quota.maxConcurrentExecutions) {
      const reason = 'Agent concurrent execution quota exceeded.';
      collector.emit({
        source: 'multi_agent',
        action: 'temporary_block',
        severity: 'high',
        reason,
        metadata: {
          activeExecutions: runtime.activeExecutions,
          maxConcurrentExecutions: runtime.quota.maxConcurrentExecutions
        }
      });
      securityEventEngine.emit({
        type: 'agent_quota_exceeded',
        severity: 'warning',
        agentId: ctx.agentId,
        compartmentId: ctx.compartmentId,
        requestId: ctx.requestId,
        message: reason,
        metadata: {
          activeExecutions: runtime.activeExecutions,
          maxConcurrentExecutions: runtime.quota.maxConcurrentExecutions
        }
      });
      return { kind: 'deny', reason };
    }

    collector.emit({
      source: 'multi_agent',
      action: 'allow',
      severity: 'info',
      reason: `Agent ${runtime.status}; within quota.`,
      metadata: { agentStatus: runtime.status }
    });
    return { kind: 'continue' };
  };

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: maxBodyBytes, type: 'application/json' }));

  app.get('/v1/health', (_req, res) => {
    const body: HealthHttpResponse = { status: 'ok', service: 'grl-server' };
    res.status(200).json(body);
  });
  app.all('/v1/health', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed. Use GET /v1/health.' });
  });

  app.post('/v1/capabilities/evaluate', (req, res) => {
    if (!req.is('application/json')) {
      return res
        .status(400)
        .json({ error: 'Content-Type must be application/json.' });
    }

    const validated = validateEvaluateBody(req.body);
    if ('error' in validated) {
      return res.status(400).json({ error: validated.error });
    }

    const { request } = validated;
    const capabilityRequest: CapabilityRequest = {
      agentId: request.agentId,
      compartment: request.compartmentId,
      tool: request.tool as CapabilityTool,
      riskLevel: request.riskLevel as RiskLevel,
      input: request.input
    };

    const decision = firewall.evaluate(capabilityRequest);

    // A firewall deny is a successful evaluation: 200 with allowed=false.
    const response: EvaluateCapabilityHttpResponse = {
      allowed: decision.allowed,
      reason: decision.reason,
      requiresConfirmation: decision.requiresConfirmation
    };
    if (decision.allowed) {
      response.sanitizedInput = decision.sanitizedInput;
    }
    if (typeof decision.delayMs === 'number') {
      response.delayMs = decision.delayMs;
    }
    return res.status(200).json(response);
  });
  app.all('/v1/capabilities/evaluate', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use POST /v1/capabilities/evaluate.' });
  });

  app.post('/v1/capabilities/request', (req, res) => {
    if (!req.is('application/json')) {
      return res
        .status(400)
        .json({ error: 'Content-Type must be application/json.' });
    }

    const validated = validateEvaluateBody(req.body);
    if ('error' in validated) {
      return res.status(400).json({ error: validated.error });
    }

    const { request } = validated;
    const capabilityRequest: CapabilityRequest = {
      agentId: request.agentId,
      compartment: request.compartmentId,
      tool: request.tool as CapabilityTool,
      riskLevel: request.riskLevel as RiskLevel,
      input: request.input
    };

    const decision = firewall.evaluate(capabilityRequest);

    // Deny: a firewall refusal is still a successful evaluation (HTTP 200).
    if (!decision.allowed) {
      const response: RequestCapabilityHttpResponse = {
        decision: 'denied',
        reason: decision.reason
      };
      if (typeof decision.delayMs === 'number') {
        response.delayMs = decision.delayMs;
      }
      return res.status(200).json(response);
    }

    // Allowed without confirmation: return the decision directly.
    if (!decision.requiresConfirmation) {
      const response: RequestCapabilityHttpResponse = {
        decision: 'allowed',
        reason: decision.reason,
        sanitizedInput: decision.sanitizedInput
      };
      if (typeof decision.delayMs === 'number') {
        response.delayMs = decision.delayMs;
      }
      return res.status(200).json(response);
    }

    // Allowed but requires confirmation: enqueue a pending approval request.
    const created = approvalQueue.create({
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      tool: request.tool as CapabilityTool,
      riskLevel: request.riskLevel as RiskLevel,
      input: request.input,
      sanitizedInput: decision.sanitizedInput,
      reason: decision.reason
    });

    const response: RequestCapabilityHttpResponse = {
      decision: 'pending',
      reason: decision.reason,
      approvalRequestId: created.request.id,
      approvalToken: created.token.value
    };
    return res.status(200).json(response);
  });
  app.all('/v1/capabilities/request', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use POST /v1/capabilities/request.' });
  });

  // Experimental Sprint 6 endpoint: evaluate, then — only when allowed without
  // confirmation — execute through the MOCK transport. This endpoint is
  // mock-only: it performs no fetch, DNS, socket, browser, or any real network
  // egress. A deny never executes; a pending never executes.
  app.post('/v1/capabilities/execute-mock', async (req, res) => {
    if (!req.is('application/json')) {
      return res
        .status(400)
        .json({ error: 'Content-Type must be application/json.' });
    }

    const validated = validateEvaluateBody(req.body);
    if ('error' in validated) {
      return res.status(400).json({ error: validated.error });
    }

    const { request } = validated;
    // One correlation id ties every audit event of this request together. It is
    // a fresh local UUID — never a token, secret, or any caller-supplied value.
    const requestId = randomUUID();
    const inputDescriptor = describeInput(request.input);

    // Sprint 29 — per-request policy-signal collector. Every gate emits its
    // signal into this collector; the response interceptor evaluates them into a
    // single composite runtimePolicy decision on whichever path responds.
    const collector = new PolicySignalCollector(runtimePolicyOrchestrator);
    installRuntimePolicyInjection(res, collector, {
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      requestId
    });

    // Defense annotation attached to the final response when a risk escalation
    // lets the request continue. Terminal defense actions build and return their
    // own response below.
    let defenseView: DefenseDecisionView | undefined;

    // ── Capability Graph gate (Sprint 15) — runs FIRST, before the trust gate ──
    // The graph reasons about the WHOLE execution path (this compartment's prior
    // capabilities + this prospective one) rather than the isolated request. It
    // consults only metadata (tool, risk, compartment) and never the raw input.
    //   - block            → denied outright (no trust, defense, or execution)
    //   - require_approval → diverted to the human-in-the-loop approval queue
    //   - force_rotation   → continue, but force a session rotation downstream
    //   - allow            → continue normally
    // The executed path only GROWS on a successful execution (recorded below);
    // a block/approval records minimal nodes/edges without storing raw input.
    const graphDecision = capabilityGraphEngine.evaluatePath({
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      tool: request.tool as CapabilityTool,
      riskLevel: request.riskLevel as RiskLevel
    });
    // Whether the graph demands a forced session rotation further down.
    let graphForcesRotation = false;
    // The graph view surfaced on the response. For block/approval it is replaced
    // by the recorded decision (with its related node/edge ids); for allow it is
    // updated after a successful execution records the path node.
    let capabilityGraphView: CapabilityPathDecisionView =
      toCapabilityPathDecisionView(graphDecision);

    if (graphDecision.action === 'block') {
      const recorded = capabilityGraphEngine.recordTransition({
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        toTool: request.tool as CapabilityTool,
        riskLevel: request.riskLevel as RiskLevel
      });
      observeSecurity({
        type: 'capability_graph_blocked',
        severity: 'warning',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Capability graph blocked the execution path.',
        metadata: {
          tool: request.tool,
          riskLevel: request.riskLevel,
          pathRisk: recorded.risk,
          reason: recorded.reason
        }
      });
      collector.emit({
        source: 'capability_graph',
        action: 'deny',
        severity: 'critical',
        reason: recorded.reason
      });
      const response: ExecuteMockCapabilityHttpResponse = {
        decision: 'denied',
        reason: recorded.reason,
        capabilityGraph: toCapabilityPathDecisionView(recorded)
      };
      return res.status(200).json(response);
    }

    if (graphDecision.action === 'require_approval') {
      const recorded = capabilityGraphEngine.recordTransition({
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        toTool: request.tool as CapabilityTool,
        riskLevel: request.riskLevel as RiskLevel
      });
      const created = approvalQueue.create({
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        tool: request.tool as CapabilityTool,
        riskLevel: request.riskLevel as RiskLevel,
        input: request.input,
        reason: recorded.reason
      });
      observeSecurity({
        type: 'capability_graph_approval_required',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        approvalRequestId: created.request.id,
        message: 'Capability graph requires human approval for the path.',
        metadata: {
          tool: request.tool,
          riskLevel: request.riskLevel,
          pathRisk: recorded.risk,
          reason: recorded.reason
        }
      });
      collector.emit({
        source: 'capability_graph',
        action: 'require_approval',
        severity: 'high',
        reason: recorded.reason
      });
      const response: ExecuteMockCapabilityHttpResponse = {
        decision: 'pending',
        reason: recorded.reason,
        capabilityGraph: toCapabilityPathDecisionView(recorded),
        approvalRequestId: created.request.id,
        approvalToken: created.token.value
      };
      return res.status(200).json(response);
    }

    if (graphDecision.action === 'force_rotation') {
      graphForcesRotation = true;
      observeSecurity({
        type: 'capability_graph_rotation_required',
        severity: 'warning',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Capability graph forced a session rotation for the path.',
        metadata: {
          tool: request.tool,
          riskLevel: request.riskLevel,
          pathRisk: graphDecision.risk,
          reason: graphDecision.reason
        }
      });
      collector.emit({
        source: 'capability_graph',
        action: 'rotate_session',
        severity: 'medium',
        reason: graphDecision.reason
      });
    } else {
      observeSecurity({
        type: 'capability_graph_allowed',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Capability graph allowed the execution path.',
        metadata: {
          tool: request.tool,
          riskLevel: request.riskLevel,
          pathRisk: graphDecision.risk
        }
      });
      collector.emit({
        source: 'capability_graph',
        action: 'allow',
        severity: 'info',
        reason: graphDecision.reason
      });
    }

    // ── Multi-Agent runtime gate (Sprint 29) — emits multi_agent signals ──
    const multiAgent = evaluateMultiAgentGate(collector, {
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      requestId
    });
    if (multiAgent.kind === 'deny') {
      const response: ExecuteMockCapabilityHttpResponse = {
        decision: 'denied',
        reason: multiAgent.reason,
        capabilityGraph: capabilityGraphView
      };
      return res.status(200).json(response);
    }
    if (multiAgent.kind === 'approval') {
      const created = approvalQueue.create({
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        tool: request.tool as CapabilityTool,
        riskLevel: request.riskLevel as RiskLevel,
        input: request.input,
        reason: multiAgent.reason
      });
      observeSecurity({
        type: 'approval_pending',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        approvalRequestId: created.request.id,
        message: multiAgent.reason,
        metadata: { tool: request.tool, riskLevel: request.riskLevel }
      });
      const response: ExecuteMockCapabilityHttpResponse = {
        decision: 'pending',
        reason: multiAgent.reason,
        capabilityGraph: capabilityGraphView,
        approvalRequestId: created.request.id,
        approvalToken: created.token.value
      };
      return res.status(200).json(response);
    }

    // ── Compartment Trust gate (Sprint 14) — runs BEFORE the defense pipeline ──
    // The compartment's current trust standing decides whether the request may
    // proceed at all. This snapshot reflects trust as it was when the request
    // arrived; the events of this request are scored afterwards as the pipeline
    // emits security events.
    //   - quarantined → denied outright (no defense, firewall, or execution)
    //   - restricted  → diverted to the human-in-the-loop approval queue
    //   - neutral / trusted → continue normally
    const trustProfile = trustEngine.getOrCreateProfile(request.compartmentId);
    const trustView: TrustView = toTrustView(trustProfile);

    if (trustProfile.score.level === 'quarantined') {
      collector.emit({
        source: 'trust_reputation',
        action: 'deny',
        severity: 'critical',
        reason: 'Compartment quarantined.'
      });
      const response: ExecuteMockCapabilityHttpResponse = {
        decision: 'denied',
        reason: 'Compartment quarantined.',
        capabilityGraph: capabilityGraphView,
        trust: trustView
      };
      return res.status(200).json(response);
    }

    if (trustProfile.score.level === 'restricted') {
      // Documented decision: a restricted compartment is forced through human
      // approval (require_approval) rather than a silent risk escalation, so a
      // degraded compartment can never auto-execute.
      const created = approvalQueue.create({
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        tool: request.tool as CapabilityTool,
        riskLevel: request.riskLevel as RiskLevel,
        input: request.input,
        reason: 'Compartment restricted; human approval required.'
      });
      observeSecurity({
        type: 'approval_pending',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        approvalRequestId: created.request.id,
        message: 'Compartment restricted; human approval required.',
        metadata: {
          tool: request.tool,
          riskLevel: request.riskLevel,
          trustLevel: trustProfile.score.level
        }
      });
      const response: ExecuteMockCapabilityHttpResponse = {
        decision: 'pending',
        reason: 'Compartment restricted; human approval required.',
        capabilityGraph: capabilityGraphView,
        trust: trustView,
        approvalRequestId: created.request.id,
        approvalToken: created.token.value
      };
      collector.emit({
        source: 'trust_reputation',
        action: 'require_approval',
        severity: 'high',
        reason: 'Compartment restricted; human approval required.'
      });
      return res.status(200).json(response);
    }

    // Trust neutral/trusted — continue.
    collector.emit({
      source: 'trust_reputation',
      action: 'allow',
      severity: 'info',
      reason: `Trust level: ${trustProfile.score.level}.`
    });
    const bpDecision: BehavioralPrivacyDecision =
      behavioralPrivacyEngine.evaluateRequest({
        agentId: request.agentId,
        riskLevel: request.riskLevel as 'low' | 'medium' | 'high'
      });
    behavioralPrivacyEngine.recordBehavior({ agentId: request.agentId });

    if (!bpDecision.allowed) {
      securityEventEngine.emit({
        type: 'behavioral_privacy_escalated',
        severity: 'critical',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message:
          'Behavioral privacy engine blocked the request due to critical correlation risk.',
        metadata: { reason: bpDecision.reason }
      });
      collector.emit({
        source: 'behavioral_privacy',
        action: 'deny',
        severity: 'critical',
        reason: bpDecision.reason ?? 'behavioral_privacy_blocked'
      });
      const response: ExecuteMockCapabilityHttpResponse = {
        decision: 'denied',
        reason: bpDecision.reason ?? 'behavioral_privacy_blocked',
        capabilityGraph: capabilityGraphView,
        trust: trustView
      };
      return res.status(200).json(response);
    }

    // Emit behavioral privacy signal for the allowed path.
    if (bpDecision.requiresFragmentation) {
      collector.emit({
        source: 'behavioral_privacy',
        action: 'rotate_fragment',
        severity: 'medium',
        reason: bpDecision.reason ?? 'Behavioral fragmentation required.'
      });
    } else if (bpDecision.requiresDelay) {
      collector.emit({
        source: 'behavioral_privacy',
        action: 'delay',
        severity: 'low',
        reason: bpDecision.reason ?? 'Behavioral jitter required.'
      });
    } else {
      collector.emit({
        source: 'behavioral_privacy',
        action: 'allow',
        severity: 'info',
        reason: 'Behavioral privacy OK.'
      });
    }

    if (bpDecision.requiresDelay) {
      securityEventEngine.emit({
        type: 'behavioral_jitter_applied',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Behavioral jitter recommended.',
        metadata: {
          delayMs: bpDecision.recommendedDelayMs,
          reason: bpDecision.reason
        }
      });
    }

    if (bpDecision.requiresFragmentation) {
      const fragment = behavioralPrivacyEngine.fragmentManager.rotateFragment(
        request.agentId
      );
      securityEventEngine.emit({
        type: 'behavior_fragment_rotated',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Identity fragment rotated due to elevated correlation risk.',
        metadata: { fragmentId: fragment.id, reason: bpDecision.reason }
      });
    } else {
      const fragment = behavioralPrivacyEngine.fragmentManager.getActiveFragment(
        request.agentId
      );
      if (fragment.requestCount === 0) {
        securityEventEngine.emit({
          type: 'behavior_fragment_created',
          severity: 'info',
          agentId: request.agentId,
          compartmentId: request.compartmentId,
          requestId,
          message: 'New identity fragment created.',
          metadata: { fragmentId: fragment.id }
        });
      }
      behavioralPrivacyEngine.fragmentManager.recordRequest(request.agentId, fragment.id);
    }
    const refreshedBehavioralProfile = behavioralPrivacyEngine.refreshProfile(
      request.agentId
    );
    if (refreshedBehavioralProfile.correlationRisk !== 'low') {
      securityEventEngine.emit({
        type: 'behavior_correlation_detected',
        severity:
          refreshedBehavioralProfile.correlationRisk === 'critical'
            ? 'critical'
            : 'warning',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Behavioral correlation risk detected.',
        metadata: {
          correlationRisk: refreshedBehavioralProfile.correlationRisk,
          repeatedBehaviorScore: refreshedBehavioralProfile.repeatedBehaviorScore,
          temporalPatternsDetected:
            refreshedBehavioralProfile.temporalPatternsDetected
        }
      });
    }

    // ── Persona Isolation gate (Sprint 25) ──
    // Derive the category from the tool/input metadata. We accept an explicit
    // `categoryHint` string on the request body (optional, never mandatory) and
    // coerce it to a PersonaCategory; anything unknown falls back to 'unknown'.
    const rawCategoryHint =
      request.input !== null &&
      typeof request.input === 'object' &&
      !Array.isArray(request.input) &&
      'categoryHint' in (request.input as Record<string, unknown>)
        ? (request.input as Record<string, unknown>)['categoryHint']
        : undefined;
    const VALID_CATEGORIES: readonly PersonaCategory[] = [
      'general','finance','crypto','security','health','politics','development','research','unknown'
    ];
    const categoryHint: PersonaCategory =
      typeof rawCategoryHint === 'string' &&
      (VALID_CATEGORIES as readonly string[]).includes(rawCategoryHint)
        ? (rawCategoryHint as PersonaCategory)
        : 'unknown';

    // Evaluate isolation before mutating state.
    const isolationDecision = personaIsolationEngine.evaluatePersonaIsolation(
      request.agentId,
      categoryHint
    );

    // Ensure the persona exists / is rotated as needed, then record the search.
    const activePersona = personaIsolationEngine.getOrCreatePersona(
      request.agentId,
      categoryHint
    );

    // Emit persona_created when this is a freshly-created persona (no searches).
    if (activePersona.searchCount === 0) {
      securityEventEngine.emit({
        type: 'persona_created',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: `Persona created for category "${categoryHint}".`,
        metadata: { personaId: activePersona.id, category: categoryHint }
      });
    }

    // Bind fragment to persona.
    const bpFragment = behavioralPrivacyEngine.fragmentManager.getActiveFragment(
      request.agentId
    );
    if (bpFragment) {
      personaIsolationEngine.fragmentManager.bind(activePersona.id, bpFragment.id);
      personaIsolationEngine.personaStore.bindFragment(activePersona.id, bpFragment.id, Date.now());
      securityEventEngine.emit({
        type: 'persona_fragment_bound',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Persona bound to identity fragment.',
        metadata: { personaId: activePersona.id, fragmentId: bpFragment.id }
      });
    }

    // Emit interest_segmentation_triggered when the decision mandates action.
    if (isolationDecision.requiresNewFragment || isolationDecision.requiresSessionIsolation) {
      securityEventEngine.emit({
        type: 'interest_segmentation_triggered',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: `Interest segmentation triggered for category "${categoryHint}".`,
        metadata: {
          personaId: isolationDecision.personaId,
          requiresNewFragment: isolationDecision.requiresNewFragment,
          requiresSessionIsolation: isolationDecision.requiresSessionIsolation,
          requiresTransportIsolation: isolationDecision.requiresTransportIsolation,
          reason: isolationDecision.reason
        }
      });
    }

    // Emit persona_isolation_escalated on critical correlation or behavioral escalation.
    if (isolationDecision.requiresBehavioralEscalation) {
      securityEventEngine.emit({
        type: 'persona_isolation_escalated',
        severity: 'critical',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Persona isolation escalated due to critical correlation risk.',
        metadata: { personaId: isolationDecision.personaId, reason: isolationDecision.reason }
      });
    }

    // Record the search on the persona (increments searchCount, recomputes risk).
    personaIsolationEngine.recordPersonaSearch(request.agentId, categoryHint);

    // Emit persona isolation signal.
    if (isolationDecision.requiresBehavioralEscalation) {
      collector.emit({
        source: 'persona_isolation',
        action: 'rotate_fragment',
        severity: 'high',
        reason: isolationDecision.reason ?? 'Persona behavioral escalation.'
      });
    } else if (isolationDecision.requiresNewFragment) {
      collector.emit({
        source: 'persona_isolation',
        action: 'rotate_fragment',
        severity: 'medium',
        reason: isolationDecision.reason ?? 'Persona fragment rotation required.'
      });
    } else {
      collector.emit({
        source: 'persona_isolation',
        action: 'allow',
        severity: 'info',
        reason: 'Persona isolation OK.'
      });
    }

    // ── Temporal Obfuscation gate (Sprint 26) ──
    // Evaluates cadence, burst, and budget risk for the agent and emits audit
    // events. Does NOT block the request — produces delay metadata only.
    // Records the execution after evaluation so recordExecution reflects the
    // current request.
    const temporalDecision = temporalObfuscationEngine.evaluateTemporalRisk(request.agentId);
    temporalObfuscationEngine.recordExecution({ agentId: request.agentId });
    const temporalProfile = temporalObfuscationEngine.getProfile(request.agentId)!;

    if (temporalDecision.requiresSchedulingEscalation || temporalDecision.requiresBurstFragmentation) {
      securityEventEngine.emit({
        type: 'temporal_scheduling_escalated',
        severity: 'warning',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Temporal scheduling escalated due to elevated burst or budget risk.',
        metadata: {
          delayMs: temporalDecision.delayMs,
          cadenceRisk: temporalProfile.cadenceRisk,
          detectedBursts: temporalProfile.detectedBursts,
          reason: temporalDecision.reason
        }
      });
    }

    if (temporalDecision.requiresCadenceSmoothing) {
      securityEventEngine.emit({
        type: 'cadence_smoothing_applied',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Cadence smoothing applied to reduce temporal pattern risk.',
        metadata: { delayMs: temporalDecision.delayMs, reason: temporalDecision.reason }
      });
    }

    if (temporalDecision.requiresBurstFragmentation) {
      securityEventEngine.emit({
        type: 'burst_detected',
        severity: 'warning',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Burst pattern detected; fragmentation recommended.',
        metadata: {
          detectedBursts: temporalProfile.detectedBursts,
          reason: temporalDecision.reason
        }
      });
    }

    if (temporalDecision.requiresDelay && temporalDecision.delayMs > 0) {
      securityEventEngine.emit({
        type: 'temporal_spacing_applied',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Temporal spacing applied to reduce timing correlation.',
        metadata: { delayMs: temporalDecision.delayMs, reason: temporalDecision.reason }
      });
    }

    if (!temporalDecision.allowed) {
      securityEventEngine.emit({
        type: 'temporal_budget_exhausted',
        severity: 'warning',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Temporal privacy budget exhausted for this agent.',
        metadata: {
          consumed: temporalProfile.temporalBudget.consumed,
          maxRequestsPerWindow: temporalProfile.temporalBudget.maxRequestsPerWindow,
          resetsAt: temporalProfile.temporalBudget.resetsAt
        }
      });
    }

    const temporalObfuscationView: TemporalObfuscationView = {
      cadenceRisk: temporalProfile.cadenceRisk,
      delayMs: temporalDecision.delayMs,
      requiresCadenceSmoothing: temporalDecision.requiresCadenceSmoothing,
      requiresBurstFragmentation: temporalDecision.requiresBurstFragmentation,
      requiresSchedulingEscalation: temporalDecision.requiresSchedulingEscalation,
      detectedBursts: temporalProfile.detectedBursts,
      smoothedRequests: temporalProfile.smoothedRequests,
      budgetConsumed: temporalProfile.temporalBudget.consumed,
      budgetRemaining: temporalProfile.temporalBudget.remaining,
      reason: temporalDecision.reason
    };

    // Emit temporal obfuscation signal.
    if (!temporalDecision.allowed) {
      collector.emit({
        source: 'temporal_obfuscation',
        action: 'temporary_block',
        severity: 'high',
        reason: 'Temporal privacy budget exhausted.'
      });
    } else if (temporalDecision.requiresSchedulingEscalation) {
      collector.emit({
        source: 'temporal_obfuscation',
        action: 'cooldown',
        severity: 'medium',
        reason: temporalDecision.reason ?? 'Temporal scheduling escalation.'
      });
    } else if (temporalDecision.requiresDelay) {
      collector.emit({
        source: 'temporal_obfuscation',
        action: 'delay',
        severity: 'low',
        reason: temporalDecision.reason ?? 'Temporal spacing required.'
      });
    } else {
      collector.emit({
        source: 'temporal_obfuscation',
        action: 'allow',
        severity: 'info',
        reason: 'Temporal risk OK.'
      });
    }

    const fingerprintState = applyTransportFingerprint({
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      requestId,
      personaChanged: isolationDecision.requiresNewFragment,
      temporalEscalation: temporalDecision.requiresSchedulingEscalation,
      sensitiveCategoryDetected: isSensitivePersonaCategory(categoryHint)
    });

    // Emit transport fingerprint signal.
    if (fingerprintState.rotated) {
      collector.emit({
        source: 'transport_fingerprint',
        action: 'rotate_fingerprint',
        severity: 'low',
        reason: fingerprintState.decision.reason ?? 'Fingerprint rotation applied.'
      });
    } else {
      collector.emit({
        source: 'transport_fingerprint',
        action: 'allow',
        severity: 'info',
        reason: 'Transport fingerprint OK.'
      });
    }

    // Discriminated outcome of applying one non-`allow` defense action.
    type DefenseTerminal =
      | { kind: 'respond'; body: ExecuteMockCapabilityHttpResponse }
      | {
          kind: 'escalate';
          escalation: DynamicRiskEscalation;
          defense: DefenseDecisionView;
        }
      | { kind: 'continue' };

    // Apply one non-`allow` defense action. Emits the appropriate audit event
    // and either builds a terminal deny/pending response, signals an in-place
    // risk escalation, or asks the caller to continue. Never logs tokens, raw
    // input, or secrets — only normalised defense metadata.
    const resolveDefense = (
      source: 'rate_limit' | 'adaptive_defense',
      action: DefenseAction,
      reason: string,
      retryAfterMs: number | undefined,
      escalationTarget: RiskLevel | undefined
    ): DefenseTerminal => {
      if (action === 'cooldown' || action === 'temporary_block') {
        observeSecurity({
          type:
            action === 'cooldown' ? 'cooldown_applied' : 'temporary_block_applied',
          severity: 'warning',
          agentId: request.agentId,
          compartmentId: request.compartmentId,
          requestId,
          message:
            action === 'cooldown'
              ? 'Cooldown applied by defense.'
              : 'Temporary block applied by defense.',
          metadata: { tool: request.tool, source, reason }
        });
        const defense: DefenseDecisionView = { action, source, reason };
        if (retryAfterMs !== undefined) defense.retryAfterMs = retryAfterMs;
        return {
          kind: 'respond',
          body: { decision: 'denied', reason, capabilityGraph: capabilityGraphView, defense }
        };
      }
      if (action === 'require_approval') {
        const created = approvalQueue.create({
          agentId: request.agentId,
          compartmentId: request.compartmentId,
          tool: request.tool as CapabilityTool,
          riskLevel: request.riskLevel as RiskLevel,
          input: request.input,
          reason
        });
        observeSecurity({
          type: 'approval_pending',
          severity: 'info',
          agentId: request.agentId,
          compartmentId: request.compartmentId,
          requestId,
          approvalRequestId: created.request.id,
          message: 'Defense requires human approval.',
          metadata: {
            tool: request.tool,
            riskLevel: request.riskLevel,
            source,
            reason
          }
        });
        const defense: DefenseDecisionView = { action, source, reason };
        return {
          kind: 'respond',
          body: {
            decision: 'pending',
            reason,
            capabilityGraph: capabilityGraphView,
            defense,
            approvalRequestId: created.request.id,
            approvalToken: created.token.value
          }
        };
      }
      if (action === 'escalate_risk') {
        const target = escalationTarget ?? 'high';
        const escalation = escalateRisk(
          request.riskLevel as RiskLevel,
          target,
          reason
        );
        // A no-op escalation (target not strictly higher) lets the request run.
        if (!escalation) return { kind: 'continue' };
        observeSecurity({
          type: 'risk_escalated',
          severity: 'warning',
          agentId: request.agentId,
          compartmentId: request.compartmentId,
          requestId,
          message: 'Risk escalated by adaptive defense.',
          metadata: {
            tool: request.tool,
            source,
            originalRisk: escalation.originalRisk,
            escalatedRisk: escalation.escalatedRisk,
            reason
          }
        });
        const defense: DefenseDecisionView = {
          action,
          source,
          reason,
          escalation: {
            originalRisk: escalation.originalRisk,
            escalatedRisk: escalation.escalatedRisk,
            reason: escalation.reason
          }
        };
        return { kind: 'escalate', escalation, defense };
      }
      return { kind: 'continue' };
    };

    // ── Defense pipeline (Sprint 13) — runs BEFORE the Capability Firewall ──
    //   1. Capability Rate Limiter (sliding windows + temporary blocks)
    //   2. Adaptive Defense Engine (anomaly/incident-driven actions)
    // Both are fail-safe: an `allow` decision is invisible. A non-`allow`
    // decision either ends the request (cooldown/temporary_block → "denied";
    // require_approval → "pending") or escalates the effective risk level in
    // place before the firewall / routing / privacy boundary run.

    // 1. Capability Rate Limiter.
    const rateDecision: RateLimitDecision = rateLimiter.evaluate({
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      tool: request.tool as CapabilityTool,
      timestamp: Date.now()
    });
    if (rateDecision.action !== 'allow') {
      observeSecurity({
        type: 'rate_limit_triggered',
        severity: 'warning',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Rate limit triggered.',
        metadata: {
          tool: request.tool,
          action: rateDecision.action,
          reason: rateDecision.reason
        }
      });
      // Map rate limit action to a UnifiedPrivacyAction for the orchestrator.
      collector.emit({
        source: 'adaptive_defense',
        action: defenseActionToOrchestratorAction(rateDecision.action),
        severity: 'high',
        reason: rateDecision.reason
      });
      const terminal = resolveDefense(
        'rate_limit',
        rateDecision.action,
        rateDecision.reason,
        rateDecision.retryAfterMs,
        undefined
      );
      if (terminal.kind === 'respond') {
        return res.status(200).json(terminal.body);
      }
      if (terminal.kind === 'escalate') {
        request.riskLevel = terminal.escalation.escalatedRisk;
        defenseView = terminal.defense;
      }
    }

    // 2. Adaptive Defense Engine, driven by the accumulated runtime anomalies /
    // open incidents. Decisions are deterministic; the strongest one wins.
    const adaptiveDecisions = adaptiveDefenseEngine.evaluate({
      anomalies: heuristicsEngine.queryAnomalies(),
      incidents: incidentDetector.listIncidents('open')
    });
    if (adaptiveDecisions.length > 0) {
      observeSecurity({
        type: 'adaptive_defense_triggered',
        severity: 'warning',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Adaptive defense triggered.',
        metadata: {
          tool: request.tool,
          actions: adaptiveDecisions.map((decision) => decision.action)
        }
      });
      // Precedence: a hard block beats a cooldown beats an approval beats an
      // escalation (which still lets the request proceed at a higher risk).
      const precedence: DefenseAction[] = [
        'temporary_block',
        'cooldown',
        'require_approval',
        'escalate_risk'
      ];
      const chosen = precedence
        .map((action) => adaptiveDecisions.find((d) => d.action === action))
        .find((decision) => decision !== undefined);
      if (chosen) {
        collector.emit({
          source: 'adaptive_defense',
          action: defenseActionToOrchestratorAction(chosen.action),
          severity: 'high',
          reason: chosen.reason
        });
        const terminal = resolveDefense(
          'adaptive_defense',
          chosen.action,
          chosen.reason,
          chosen.cooldownMs,
          chosen.escalation?.escalatedRisk
        );
        if (terminal.kind === 'respond') {
          return res.status(200).json(terminal.body);
        }
        if (terminal.kind === 'escalate') {
          request.riskLevel = terminal.escalation.escalatedRisk;
          defenseView = terminal.defense;
        }
      }
    }

    const capabilityRequest: CapabilityRequest = {
      agentId: request.agentId,
      compartment: request.compartmentId,
      tool: request.tool as CapabilityTool,
      riskLevel: request.riskLevel as RiskLevel,
      input: request.input
    };

    const decision = firewall.evaluate(capabilityRequest);

    // Deny: a firewall refusal never triggers execution.
    if (!decision.allowed) {
      observeSecurity({
        type: 'capability_denied',
        severity: 'warning',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Capability denied by firewall.',
        metadata: {
          tool: request.tool,
          riskLevel: request.riskLevel,
          reason: decision.reason
        }
      });
      collector.emit({
        source: 'capability_firewall',
        action: 'deny',
        severity: 'critical',
        reason: decision.reason
      });
      const response: ExecuteMockCapabilityHttpResponse = {
        decision: 'denied',
        reason: decision.reason,
        capabilityGraph: capabilityGraphView
      };
      if (defenseView !== undefined) response.defense = defenseView;
      return res.status(200).json(response);
    }

    // Allowed but requires confirmation: enqueue and never execute.
    if (decision.requiresConfirmation) {
      const created = approvalQueue.create({
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        tool: request.tool as CapabilityTool,
        riskLevel: request.riskLevel as RiskLevel,
        input: request.input,
        sanitizedInput: decision.sanitizedInput,
        reason: decision.reason
      });
      // Audit the pending approval WITHOUT the one-time token.
      observeSecurity({
        type: 'approval_pending',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        approvalRequestId: created.request.id,
        message: 'Capability requires human approval.',
        metadata: {
          tool: request.tool,
          riskLevel: request.riskLevel,
          reason: decision.reason
        }
      });
      collector.emit({
        source: 'capability_firewall',
        action: 'require_approval',
        severity: 'high',
        reason: decision.reason
      });
      const response: ExecuteMockCapabilityHttpResponse = {
        decision: 'pending',
        reason: decision.reason,
        capabilityGraph: capabilityGraphView,
        approvalRequestId: created.request.id,
        approvalToken: created.token.value
      };
      if (defenseView !== undefined) response.defense = defenseView;
      return res.status(200).json(response);
    }

    // Allowed without confirmation.
    observeSecurity({
      type: 'capability_allowed',
      severity: 'info',
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      requestId,
      message: 'Capability allowed by firewall.',
      metadata: {
        tool: request.tool,
        riskLevel: request.riskLevel,
        reason: decision.reason
      }
    });
    collector.emit({
      source: 'capability_firewall',
      action: 'allow',
      severity: 'info',
      reason: decision.reason
    });

    // Allowed without confirmation: resolve the routing decision FIRST (the
    // Transport Policy Engine consults only tool + riskLevel and never touches
    // sessions), then select a session identity per that decision, then run it
    // through the mock execution engine.
    //
    // Strict separation of concerns:
    //   - the policy engine decides (routing/rotation/isolation), nothing more
    //   - the Session Manager mints/reuses/rotates the session identity
    //   - the Execution Engine runs the request through the mock transport
    //
    // A missing routing rule is fail-closed: no session is created and no
    // execution happens (HTTP 200, decision="denied").
    let routing: RoutingDecision;
    try {
      routing = transportPolicyEngine.resolve({
        id: randomUUID(),
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        tool: request.tool as CapabilityTool,
        riskLevel: request.riskLevel as RiskLevel,
        input: request.input,
        sanitizedInput: decision.sanitizedInput,
        // The session is decided AFTER routing; this context is not consulted
        // by the engine and is replaced below with the real session identity.
        session: {
          sessionId: '',
          compartmentId: request.compartmentId,
          transportKind: 'mock',
          createdAt: 0
        }
      });
    } catch (err) {
      if (err instanceof TransportPolicyError) {
        const response: ExecuteMockCapabilityHttpResponse = {
          decision: 'denied',
          reason: `No transport routing rule available: ${err.message}`,
          capabilityGraph: capabilityGraphView
        };
        if (defenseView !== undefined) response.defense = defenseView;
        return res.status(200).json(response);
      }
      throw err;
    }

    observeSecurity({
      type: 'routing_resolved',
      severity: 'info',
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      requestId,
      message: 'Transport routing resolved.',
      metadata: {
        tool: request.tool,
        riskLevel: request.riskLevel,
        transportKind: routing.transportKind,
        routingReason: routing.reason,
        isolationLevel: routing.isolationLevel
      }
    });
    collector.emit({
      source: 'transport_policy',
      action: 'allow',
      severity: 'info',
      reason: routing.reason ?? 'Transport routing resolved.'
    });

    // Privacy Boundary Engine (Sprint 9): evaluate anti-correlation AFTER routing
    // is resolved but BEFORE any session is minted/rotated. The engine consults
    // metadata only (compartments, risk, routing isolation) and never mints a
    // session, opens a connection, or executes.
    //
    //   - block            → no session, no execution (decision="denied")
    //   - require_approval → enqueue approval, no execution (decision="pending")
    //   - rotate_session   → force a fresh session before executing
    //   - allow            → proceed (rotation still governed by routing)
    const privacy: PrivacyBoundaryDecision = privacyBoundaryEngine.evaluate({
      agentId: request.agentId,
      sourceCompartmentId: request.compartmentId,
      targetCompartmentId: request.compartmentId,
      tool: request.tool as CapabilityTool,
      riskLevel: request.riskLevel as RiskLevel,
      routingIsolationLevel: routing.isolationLevel
    });
    const privacyView = toPrivacyBoundaryDecisionView(privacy);

    // Privacy block: fail-closed. No session is created and nothing executes.
    if (privacy.action === 'block') {
      observeSecurity({
        type: 'privacy_boundary_blocked',
        severity: 'warning',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Privacy boundary blocked execution.',
        metadata: {
          tool: request.tool,
          riskLevel: request.riskLevel,
          privacySignals: privacy.signals,
          reason: privacy.reason
        }
      });
      collector.emit({
        source: 'privacy_boundary',
        action: 'deny',
        severity: 'critical',
        reason: privacy.reason
      });
      const response: ExecuteMockCapabilityHttpResponse = {
        decision: 'denied',
        reason: 'Privacy boundary blocked execution.',
        capabilityGraph: capabilityGraphView,
        routing: toRoutingDecisionView(routing),
        privacyBoundary: privacyView
      };
      if (defenseView !== undefined) response.defense = defenseView;
      return res.status(200).json(response);
    }

    // Privacy require_approval: enqueue a pending approval and never execute.
    if (privacy.action === 'require_approval') {
      const created = approvalQueue.create({
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        tool: request.tool as CapabilityTool,
        riskLevel: request.riskLevel as RiskLevel,
        input: request.input,
        sanitizedInput: decision.sanitizedInput,
        reason: privacy.reason
      });
      observeSecurity({
        type: 'approval_pending',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        approvalRequestId: created.request.id,
        message: 'Privacy boundary requires human approval.',
        metadata: {
          tool: request.tool,
          riskLevel: request.riskLevel,
          privacySignals: privacy.signals,
          reason: privacy.reason
        }
      });
      const response: ExecuteMockCapabilityHttpResponse = {
        decision: 'pending',
        reason: privacy.reason,
        capabilityGraph: capabilityGraphView,
        routing: toRoutingDecisionView(routing),
        privacyBoundary: privacyView,
        approvalRequestId: created.request.id,
        approvalToken: created.token.value
      };
      collector.emit({
        source: 'privacy_boundary',
        action: 'require_approval',
        severity: 'high',
        reason: privacy.reason
      });
      if (defenseView !== undefined) response.defense = defenseView;
      return res.status(200).json(response);
    }

    // A privacy-driven rotation is its own audited signal.
    if (privacy.action === 'rotate_session') {
      observeSecurity({
        type: 'privacy_boundary_rotation',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Privacy boundary forced a session rotation.',
        metadata: {
          tool: request.tool,
          riskLevel: request.riskLevel,
          privacySignals: privacy.signals,
          reason: privacy.reason
        }
      });
      collector.emit({
        source: 'privacy_boundary',
        action: 'rotate_session',
        severity: 'medium',
        reason: privacy.reason
      });
    } else {
      collector.emit({
        source: 'privacy_boundary',
        action: 'allow',
        severity: 'info',
        reason: 'Privacy boundary OK.'
      });
    }

    // The session rotates when the routing decision, the privacy boundary, OR
    // the capability graph demands it. The engines themselves never mint a
    // session.
    const mustRotateSession =
      routing.shouldRotateSession ||
      privacy.action === 'rotate_session' ||
      graphForcesRotation;
    const sessionsBefore = sessionManager.size();
    const session = mustRotateSession
      ? sessionManager.rotateSession(request.compartmentId)
      : sessionManager.getOrCreateSession(request.compartmentId);

    // Audit the session lifecycle: a rotation, or a freshly-minted session.
    if (mustRotateSession) {
      observeSecurity({
        type: 'session_rotated',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        sessionId: session.sessionId,
        requestId,
        message: 'Session rotated.',
        metadata: { transportKind: session.transportKind }
      });
    } else if (sessionManager.size() > sessionsBefore) {
      observeSecurity({
        type: 'session_created',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        sessionId: session.sessionId,
        requestId,
        message: 'Session created.',
        metadata: { transportKind: session.transportKind }
      });
    }

    // Inject the transport from the RoutingDecision into the execution context
    // so the Execution Engine routes through exactly the resolved transport.
    const executionRequest: ExecutionRequest = {
      id: randomUUID(),
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      tool: request.tool as CapabilityTool,
      riskLevel: request.riskLevel as RiskLevel,
      input: request.input,
      sanitizedInput: decision.sanitizedInput,
      transportHeaders: { ...fingerprintState.profile.assignedHeaders },
      session: {
        ...sessionManager.toSessionContext(session),
        transportKind: routing.transportKind
      }
    };

    // Audit the start of execution before invoking the transport.
    observeSecurity({
      type: 'execution_started',
      severity: 'info',
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      sessionId: session.sessionId,
      requestId,
      executionId: executionRequest.id,
      message: 'Execution started.',
      metadata: {
        tool: request.tool,
        riskLevel: request.riskLevel,
        transportKind: routing.transportKind,
        inputType: inputDescriptor.inputType,
        inputSizeBytes: inputDescriptor.inputSizeBytes
      }
    });

    const result = await executionEngine.execute(executionRequest);

    // A `blocked` result means no adapter ran (fail-closed); it does not consume
    // the session's request budget. Any other outcome (success/failed) means the
    // transport was actually invoked, so the use is recorded.
    if (result.status !== 'blocked') {
      sessionManager.recordUse(session.sessionId);
    }

    // Audit the sandbox verdict (when the engine enforced it) and the terminal
    // execution status, using the shared correlation + execution ids.
    const sandboxViolationCodes = result.sandbox
      ? result.sandbox.violations.map((violation) => violation.code)
      : [];
    if (result.sandbox !== undefined) {
      if (result.sandbox.action === 'block') {
        observeSecurity({
          type: 'sandbox_blocked',
          severity: 'warning',
          agentId: request.agentId,
          compartmentId: request.compartmentId,
          sessionId: session.sessionId,
          requestId,
          executionId: executionRequest.id,
          message: 'Adapter sandbox blocked execution.',
          metadata: {
            tool: request.tool,
            transportKind: result.transportKind,
            sandboxViolations: sandboxViolationCodes
          }
        });
        collector.emit({
          source: 'sandbox',
          action: 'deny',
          severity: 'critical',
          reason: 'Sandbox blocked execution.'
        });
      } else {
        observeSecurity({
          type: 'sandbox_allowed',
          severity: 'info',
          agentId: request.agentId,
          compartmentId: request.compartmentId,
          sessionId: session.sessionId,
          requestId,
          executionId: executionRequest.id,
          message: 'Adapter sandbox allowed execution.',
          metadata: {
            tool: request.tool,
            transportKind: result.transportKind
          }
        });
        collector.emit({
          source: 'sandbox',
          action: 'allow',
          severity: 'info',
          reason: 'Sandbox allowed execution.'
        });
      }
    }

    const terminalType: SecurityEventType =
      result.status === 'success'
        ? 'execution_succeeded'
        : result.status === 'failed'
          ? 'execution_failed'
          : 'execution_blocked';
    const terminalSeverity: EventSeverity =
      result.status === 'success' ? 'info' : 'warning';
    observeSecurity({
      type: terminalType,
      severity: terminalSeverity,
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      sessionId: session.sessionId,
      requestId,
      executionId: executionRequest.id,
      message: `Execution ${result.status}.`,
      metadata: {
        tool: request.tool,
        transportKind: result.transportKind,
        executionStatus: result.status,
        ...(sandboxViolationCodes.length > 0
          ? { sandboxViolations: sandboxViolationCodes }
          : {})
      }
    });

    // ── Capability Graph path recording (Sprint 15) ──
    // The executed path only grows on a SUCCESSFUL execution. Record the admitted
    // capability node (advancing the compartment's path) plus an `executed`
    // execution node, and surface the resulting node/edge ids on the response.
    // A blocked/failed execution never extends the path.
    if (result.status === 'success') {
      try {
        const capabilityNode = capabilityGraphEngine.recordCapabilityRequest({
          agentId: request.agentId,
          compartmentId: request.compartmentId,
          tool: request.tool as CapabilityTool,
          riskLevel: request.riskLevel as RiskLevel
        });
        const executionNode = capabilityGraphEngine.addNode({
          id: randomUUID(),
          kind: 'execution',
          agentId: request.agentId,
          compartmentId: request.compartmentId,
          tool: request.tool as CapabilityTool,
          riskLevel: request.riskLevel as RiskLevel,
          createdAt: Date.now()
        });
        const executedEdge = capabilityGraphEngine.addEdge({
          id: randomUUID(),
          fromNodeId: capabilityNode.id,
          toNodeId: executionNode.id,
          relation: 'executed',
          createdAt: Date.now()
        });
        capabilityGraphView = {
          ...capabilityGraphView,
          relatedNodeIds: [capabilityNode.id, executionNode.id],
          relatedEdgeIds: [executedEdge.id]
        };
      } catch {
        // Fail-safe: graph bookkeeping is observational and must never break the
        // primary execute-mock flow.
      }
    }

    const execution: ExecutionResultView = {
      status: result.status,
      transportKind: result.transportKind
    };
    if (result.output !== undefined) {
      execution.output = result.output;
    }
    if (result.error !== undefined) {
      execution.error = result.error;
    }

    // Sprint 29 — the runtimePolicy block is evaluated and injected by the
    // per-request response interceptor (installRuntimePolicyInjection) from the
    // signals this request's gates collected, so the allowed path and every
    // short-circuit path carry a consistent composite decision.
    const response: ExecuteMockCapabilityHttpResponse = {
      decision: 'allowed',
      reason: decision.reason,
      capabilityGraph: capabilityGraphView,
      routing: toRoutingDecisionView(routing),
      privacyBoundary: privacyView,
      execution,
      temporalObfuscation: temporalObfuscationView,
      fingerprint: {
        activeFingerprintId: fingerprintState.profile.activeFingerprintId,
        rotationCount: fingerprintState.profile.rotationCount,
        correlationRisk: fingerprintState.profile.correlationRisk,
        rotated: fingerprintState.rotated
      }
    };
    // Surface the sandbox decision (allow or block) when the engine enforced it.
    if (result.sandbox !== undefined) {
      response.sandbox = toSandboxDecisionView(result.sandbox);
    }
    if (defenseView !== undefined) response.defense = defenseView;
    // Surface the compartment's trust standing AFTER this request's outcome was
    // scored (e.g. a clean execution nudges the score up).
    const updatedTrust = trustEngine.getProfile(request.compartmentId);
    response.trust = updatedTrust ? toTrustView(updatedTrust) : trustView;
    return res.status(200).json(response);
  });
  app.all('/v1/capabilities/execute-mock', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use POST /v1/capabilities/execute-mock.'
    });
  });

  // ---------------------------------------------------------------------------
  // Sprint 17 — POST /v1/capabilities/execute (real transport routing)
  //
  // Runs the same full pipeline as execute-mock (capability graph → trust →
  // defense → firewall → routing → privacy → session) but dispatches to the
  // transport resolved by the Transport Policy Engine:
  //   - mock → mock transport (same as execute-mock)
  //   - searxng → SearXNG transport adapter (requires enabled runtime config)
  //   - other → fail-closed (denied)
  //
  // Security constraints identical to execute-mock apply here. Additionally:
  //   - SearXNG must be explicitly enabled in runtime config (fail-closed)
  //   - No real network if SearXNG is disabled
  //   - Sandbox evaluated against SEARXNG_SANDBOX_POLICY for searxng transport
  // ---------------------------------------------------------------------------
  app.post('/v1/capabilities/execute', async (req, res) => {
    if (!req.is('application/json')) {
      return res
        .status(400)
        .json({ error: 'Content-Type must be application/json.' });
    }

    const validated = validateEvaluateBody(req.body);
    if ('error' in validated) {
      return res.status(400).json({ error: validated.error });
    }

    const { request } = validated;
    const requestId = randomUUID();
    const inputDescriptor = describeInput(request.input);
    const categoryHint = extractPersonaCategory(request.input);

    // Sprint 29 — per-request policy-signal collector (parity with execute-mock).
    // Gates emit signals here; the response interceptor evaluates them into the
    // composite runtimePolicy block injected on every decision path, including
    // when a gate short-circuits before SearXNG/mock execution.
    const collector = new PolicySignalCollector(runtimePolicyOrchestrator);
    installRuntimePolicyInjection(res, collector, {
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      requestId
    });

    let defenseView: DefenseDecisionView | undefined;

    // ── Capability Graph gate ────────────────────────────────────────────────
    const graphDecision = capabilityGraphEngine.evaluatePath({
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      tool: request.tool as CapabilityTool,
      riskLevel: request.riskLevel as RiskLevel
    });
    let graphForcesRotation = false;
    let capabilityGraphView: CapabilityPathDecisionView =
      toCapabilityPathDecisionView(graphDecision);

    if (graphDecision.action === 'block') {
      const recorded = capabilityGraphEngine.recordTransition({
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        toTool: request.tool as CapabilityTool,
        riskLevel: request.riskLevel as RiskLevel
      });
      observeSecurity({
        type: 'capability_graph_blocked',
        severity: 'warning',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Capability graph blocked the execution path.',
        metadata: { tool: request.tool, riskLevel: request.riskLevel, pathRisk: recorded.risk, reason: recorded.reason }
      });
      collector.emit({ source: 'capability_graph', action: 'deny', severity: 'critical', reason: recorded.reason });
      return res.status(200).json({
        decision: 'denied',
        reason: recorded.reason,
        capabilityGraph: toCapabilityPathDecisionView(recorded)
      } as ExecuteCapabilityHttpResponse);
    }

    if (graphDecision.action === 'require_approval') {
      const recorded = capabilityGraphEngine.recordTransition({
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        toTool: request.tool as CapabilityTool,
        riskLevel: request.riskLevel as RiskLevel
      });
      const created = approvalQueue.create({
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        tool: request.tool as CapabilityTool,
        riskLevel: request.riskLevel as RiskLevel,
        input: request.input,
        reason: recorded.reason
      });
      observeSecurity({
        type: 'capability_graph_approval_required',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        approvalRequestId: created.request.id,
        message: 'Capability graph requires human approval for the path.',
        metadata: { tool: request.tool, riskLevel: request.riskLevel, pathRisk: recorded.risk, reason: recorded.reason }
      });
      collector.emit({ source: 'capability_graph', action: 'require_approval', severity: 'high', reason: recorded.reason });
      return res.status(200).json({
        decision: 'pending',
        reason: recorded.reason,
        capabilityGraph: toCapabilityPathDecisionView(recorded),
        approvalRequestId: created.request.id,
        approvalToken: created.token.value
      } as ExecuteCapabilityHttpResponse);
    }

    if (graphDecision.action === 'force_rotation') {
      graphForcesRotation = true;
      observeSecurity({
        type: 'capability_graph_rotation_required',
        severity: 'warning',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Capability graph forced a session rotation for the path.',
        metadata: { tool: request.tool, riskLevel: request.riskLevel, pathRisk: graphDecision.risk, reason: graphDecision.reason }
      });
      collector.emit({ source: 'capability_graph', action: 'rotate_session', severity: 'medium', reason: graphDecision.reason });
    } else {
      observeSecurity({
        type: 'capability_graph_allowed',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Capability graph allowed the execution path.',
        metadata: { tool: request.tool, riskLevel: request.riskLevel, pathRisk: graphDecision.risk }
      });
      collector.emit({ source: 'capability_graph', action: 'allow', severity: 'info', reason: graphDecision.reason });
    }

    // ── Multi-Agent runtime gate (Sprint 29) — emits multi_agent signals ──
    const multiAgent = evaluateMultiAgentGate(collector, {
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      requestId
    });
    if (multiAgent.kind === 'deny') {
      return res.status(200).json({
        decision: 'denied',
        reason: multiAgent.reason,
        capabilityGraph: capabilityGraphView
      } as ExecuteCapabilityHttpResponse);
    }
    if (multiAgent.kind === 'approval') {
      const created = approvalQueue.create({
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        tool: request.tool as CapabilityTool,
        riskLevel: request.riskLevel as RiskLevel,
        input: request.input,
        reason: multiAgent.reason
      });
      observeSecurity({
        type: 'approval_pending',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        approvalRequestId: created.request.id,
        message: multiAgent.reason,
        metadata: { tool: request.tool, riskLevel: request.riskLevel }
      });
      return res.status(200).json({
        decision: 'pending',
        reason: multiAgent.reason,
        capabilityGraph: capabilityGraphView,
        approvalRequestId: created.request.id,
        approvalToken: created.token.value
      } as ExecuteCapabilityHttpResponse);
    }

    // ── Trust gate ───────────────────────────────────────────────────────────
    const trustProfile = trustEngine.getOrCreateProfile(request.compartmentId);
    const trustView: TrustView = toTrustView(trustProfile);

    if (trustProfile.score.level === 'quarantined') {
      collector.emit({ source: 'trust_reputation', action: 'deny', severity: 'critical', reason: 'Compartment quarantined.' });
      return res.status(200).json({
        decision: 'denied',
        reason: 'Compartment quarantined.',
        capabilityGraph: capabilityGraphView,
        trust: trustView
      } as ExecuteCapabilityHttpResponse);
    }

    if (trustProfile.score.level === 'restricted') {
      const created = approvalQueue.create({
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        tool: request.tool as CapabilityTool,
        riskLevel: request.riskLevel as RiskLevel,
        input: request.input,
        reason: 'Compartment restricted; human approval required.'
      });
      observeSecurity({
        type: 'approval_pending',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        approvalRequestId: created.request.id,
        message: 'Compartment restricted; human approval required.',
        metadata: { tool: request.tool, riskLevel: request.riskLevel, trustLevel: trustProfile.score.level }
      });
      collector.emit({ source: 'trust_reputation', action: 'require_approval', severity: 'high', reason: 'Compartment restricted; human approval required.' });
      return res.status(200).json({
        decision: 'pending',
        reason: 'Compartment restricted; human approval required.',
        capabilityGraph: capabilityGraphView,
        trust: trustView,
        approvalRequestId: created.request.id,
        approvalToken: created.token.value
      } as ExecuteCapabilityHttpResponse);
    }

    collector.emit({ source: 'trust_reputation', action: 'allow', severity: 'info', reason: `Trust level: ${trustProfile.score.level}.` });

    // ── Defense pipeline ─────────────────────────────────────────────────────
    type DefenseTerminal =
      | { kind: 'respond'; body: ExecuteCapabilityHttpResponse }
      | { kind: 'escalate'; escalation: DynamicRiskEscalation; defense: DefenseDecisionView }
      | { kind: 'continue' };

    const resolveDefenseForExecute = (
      source: 'rate_limit' | 'adaptive_defense',
      action: DefenseAction,
      reason: string,
      retryAfterMs: number | undefined,
      escalationTarget: RiskLevel | undefined
    ): DefenseTerminal => {
      if (action === 'cooldown' || action === 'temporary_block') {
        observeSecurity({
          type: action === 'cooldown' ? 'cooldown_applied' : 'temporary_block_applied',
          severity: 'warning',
          agentId: request.agentId,
          compartmentId: request.compartmentId,
          requestId,
          message: action === 'cooldown' ? 'Cooldown applied by defense.' : 'Temporary block applied by defense.',
          metadata: { tool: request.tool, source, reason }
        });
        const defense: DefenseDecisionView = { action, source, reason };
        if (retryAfterMs !== undefined) defense.retryAfterMs = retryAfterMs;
        return { kind: 'respond', body: { decision: 'denied', reason, capabilityGraph: capabilityGraphView, defense } };
      }
      if (action === 'require_approval') {
        const created = approvalQueue.create({
          agentId: request.agentId,
          compartmentId: request.compartmentId,
          tool: request.tool as CapabilityTool,
          riskLevel: request.riskLevel as RiskLevel,
          input: request.input,
          reason
        });
        observeSecurity({
          type: 'approval_pending',
          severity: 'info',
          agentId: request.agentId,
          compartmentId: request.compartmentId,
          requestId,
          approvalRequestId: created.request.id,
          message: 'Defense requires human approval.',
          metadata: { tool: request.tool, riskLevel: request.riskLevel, source, reason }
        });
        const defense: DefenseDecisionView = { action, source, reason };
        return {
          kind: 'respond',
          body: { decision: 'pending', reason, capabilityGraph: capabilityGraphView, defense, approvalRequestId: created.request.id, approvalToken: created.token.value }
        };
      }
      if (action === 'escalate_risk') {
        const target = escalationTarget ?? 'high';
        const escalation = escalateRisk(request.riskLevel as RiskLevel, target, reason);
        if (!escalation) return { kind: 'continue' };
        observeSecurity({
          type: 'risk_escalated',
          severity: 'warning',
          agentId: request.agentId,
          compartmentId: request.compartmentId,
          requestId,
          message: 'Risk escalated by adaptive defense.',
          metadata: { tool: request.tool, source, originalRisk: escalation.originalRisk, escalatedRisk: escalation.escalatedRisk, reason }
        });
        const defense: DefenseDecisionView = {
          action, source, reason,
          escalation: { originalRisk: escalation.originalRisk, escalatedRisk: escalation.escalatedRisk, reason: escalation.reason }
        };
        return { kind: 'escalate', escalation, defense };
      }
      return { kind: 'continue' };
    };

    // 1. Rate Limiter.
    const rateDecision: RateLimitDecision = rateLimiter.evaluate({
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      tool: request.tool as CapabilityTool,
      timestamp: Date.now()
    });
    if (rateDecision.action !== 'allow') {
      observeSecurity({
        type: 'rate_limit_triggered',
        severity: 'warning',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Rate limit triggered.',
        metadata: { tool: request.tool, action: rateDecision.action, reason: rateDecision.reason }
      });
      collector.emit({ source: 'adaptive_defense', action: defenseActionToOrchestratorAction(rateDecision.action), severity: 'high', reason: rateDecision.reason });
      const terminal = resolveDefenseForExecute('rate_limit', rateDecision.action, rateDecision.reason, rateDecision.retryAfterMs, undefined);
      if (terminal.kind === 'respond') return res.status(200).json(terminal.body);
      if (terminal.kind === 'escalate') { request.riskLevel = terminal.escalation.escalatedRisk; defenseView = terminal.defense; }
    }

    // 2. Adaptive Defense Engine.
    const adaptiveDecisionsExec = adaptiveDefenseEngine.evaluate({
      anomalies: heuristicsEngine.queryAnomalies(),
      incidents: incidentDetector.listIncidents('open')
    });
    if (adaptiveDecisionsExec.length > 0) {
      observeSecurity({
        type: 'adaptive_defense_triggered',
        severity: 'warning',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Adaptive defense triggered.',
        metadata: { tool: request.tool, actions: adaptiveDecisionsExec.map((d) => d.action) }
      });
      const precedenceExec: DefenseAction[] = ['temporary_block', 'cooldown', 'require_approval', 'escalate_risk'];
      const chosenExec = precedenceExec
        .map((action) => adaptiveDecisionsExec.find((d) => d.action === action))
        .find((d) => d !== undefined);
      if (chosenExec) {
        collector.emit({ source: 'adaptive_defense', action: defenseActionToOrchestratorAction(chosenExec.action), severity: 'high', reason: chosenExec.reason });
        const terminal = resolveDefenseForExecute('adaptive_defense', chosenExec.action, chosenExec.reason, chosenExec.cooldownMs, chosenExec.escalation?.escalatedRisk);
        if (terminal.kind === 'respond') return res.status(200).json(terminal.body);
        if (terminal.kind === 'escalate') { request.riskLevel = terminal.escalation.escalatedRisk; defenseView = terminal.defense; }
      }
    }

    // ── Capability Firewall ──────────────────────────────────────────────────
    const capabilityRequestExec: CapabilityRequest = {
      agentId: request.agentId,
      compartment: request.compartmentId,
      tool: request.tool as CapabilityTool,
      riskLevel: request.riskLevel as RiskLevel,
      input: request.input
    };

    const decisionExec = firewall.evaluate(capabilityRequestExec);

    if (!decisionExec.allowed) {
      observeSecurity({
        type: 'capability_denied',
        severity: 'warning',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Capability denied by firewall.',
        metadata: { tool: request.tool, riskLevel: request.riskLevel, reason: decisionExec.reason }
      });
      collector.emit({ source: 'capability_firewall', action: 'deny', severity: 'critical', reason: decisionExec.reason });
      const response: ExecuteCapabilityHttpResponse = { decision: 'denied', reason: decisionExec.reason, capabilityGraph: capabilityGraphView };
      if (defenseView !== undefined) response.defense = defenseView;
      return res.status(200).json(response);
    }

    if (decisionExec.requiresConfirmation) {
      const created = approvalQueue.create({
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        tool: request.tool as CapabilityTool,
        riskLevel: request.riskLevel as RiskLevel,
        input: request.input,
        sanitizedInput: decisionExec.sanitizedInput,
        reason: decisionExec.reason
      });
      observeSecurity({
        type: 'approval_pending',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        approvalRequestId: created.request.id,
        message: 'Capability requires human approval.',
        metadata: { tool: request.tool, riskLevel: request.riskLevel, reason: decisionExec.reason }
      });
      collector.emit({ source: 'capability_firewall', action: 'require_approval', severity: 'high', reason: decisionExec.reason });
      const response: ExecuteCapabilityHttpResponse = { decision: 'pending', reason: decisionExec.reason, capabilityGraph: capabilityGraphView, approvalRequestId: created.request.id, approvalToken: created.token.value };
      if (defenseView !== undefined) response.defense = defenseView;
      return res.status(200).json(response);
    }

    observeSecurity({
      type: 'capability_allowed',
      severity: 'info',
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      requestId,
      message: 'Capability allowed by firewall.',
      metadata: { tool: request.tool, riskLevel: request.riskLevel, reason: decisionExec.reason }
    });
    collector.emit({ source: 'capability_firewall', action: 'allow', severity: 'info', reason: decisionExec.reason });

    // ── Routing ──────────────────────────────────────────────────────────────
    let routingExec: RoutingDecision;
    try {
      routingExec = transportPolicyEngine.resolve({
        id: randomUUID(),
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        tool: request.tool as CapabilityTool,
        riskLevel: request.riskLevel as RiskLevel,
        input: request.input,
        sanitizedInput: decisionExec.sanitizedInput,
        session: { sessionId: '', compartmentId: request.compartmentId, transportKind: 'mock', createdAt: 0 }
      });
    } catch (err) {
      if (err instanceof TransportPolicyError) {
        collector.emit({ source: 'transport_policy', action: 'deny', severity: 'critical', reason: `No transport routing rule available: ${err.message}` });
        const response: ExecuteCapabilityHttpResponse = { decision: 'denied', reason: `No transport routing rule available: ${err.message}`, capabilityGraph: capabilityGraphView };
        if (defenseView !== undefined) response.defense = defenseView;
        return res.status(200).json(response);
      }
      throw err;
    }

    // Sprint 17 — determine the effective transport.
    //
    // The routing decision resolves the preferred transport from the policy
    // engine. For the real execute endpoint:
    //   - 'mock'    → execute with mock transport (always available)
    //   - 'searxng' → check runtime config; denied if disabled or absent
    //   - other     → fail-closed
    //
    // This is the ONLY place real network transport is activated. The check is
    // dual: the transport policy must have routed to searxng AND the runtime
    // config must explicitly enable it.
    const resolvedKind = routingExec.transportKind;

    if (resolvedKind === 'searxng') {
      const searxngCfg = activeSnapshot.config.transports?.searxng;
      if (!searxngCfg || !searxngCfg.enabled) {
        collector.emit({ source: 'transport_policy', action: 'deny', severity: 'critical', reason: 'SearXNG transport disabled.' });
        const response: ExecuteCapabilityHttpResponse = {
          decision: 'denied',
          reason: 'SearXNG transport disabled.',
          capabilityGraph: capabilityGraphView,
          routing: toRoutingDecisionView(routingExec)
        };
        if (defenseView !== undefined) response.defense = defenseView;
        return res.status(200).json(response);
      }
      // SearXNG is enabled: the realSearXngEngine handles this transport.
      if (!realSearXngEngine) {
        // Config may have changed since reload; fail-closed.
        collector.emit({ source: 'transport_policy', action: 'deny', severity: 'critical', reason: 'SearXNG transport unavailable (engine not initialised).' });
        const response: ExecuteCapabilityHttpResponse = {
          decision: 'denied',
          reason: 'SearXNG transport unavailable (engine not initialised).',
          capabilityGraph: capabilityGraphView,
          routing: toRoutingDecisionView(routingExec)
        };
        if (defenseView !== undefined) response.defense = defenseView;
        return res.status(200).json(response);
      }
    } else if (resolvedKind !== 'mock') {
      // Unknown transport kind — fail-closed.
      collector.emit({ source: 'transport_policy', action: 'deny', severity: 'critical', reason: `Transport kind "${resolvedKind}" is not supported by the execute endpoint.` });
      const response: ExecuteCapabilityHttpResponse = {
        decision: 'denied',
        reason: `Transport kind "${resolvedKind}" is not supported by the execute endpoint.`,
        capabilityGraph: capabilityGraphView,
        routing: toRoutingDecisionView(routingExec)
      };
      if (defenseView !== undefined) response.defense = defenseView;
      return res.status(200).json(response);
    }

    observeSecurity({
      type: 'routing_resolved',
      severity: 'info',
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      requestId,
      message: 'Transport routing resolved.',
      metadata: { tool: request.tool, riskLevel: request.riskLevel, transportKind: resolvedKind, routingReason: routingExec.reason, isolationLevel: routingExec.isolationLevel }
    });
    collector.emit({ source: 'transport_policy', action: 'allow', severity: 'info', reason: routingExec.reason ?? 'Transport routing resolved.' });

    // ── Privacy Boundary ─────────────────────────────────────────────────────
    const privacyExec: PrivacyBoundaryDecision = privacyBoundaryEngine.evaluate({
      agentId: request.agentId,
      sourceCompartmentId: request.compartmentId,
      targetCompartmentId: request.compartmentId,
      tool: request.tool as CapabilityTool,
      riskLevel: request.riskLevel as RiskLevel,
      routingIsolationLevel: routingExec.isolationLevel
    });
    const privacyViewExec = toPrivacyBoundaryDecisionView(privacyExec);

    if (privacyExec.action === 'block') {
      observeSecurity({
        type: 'privacy_boundary_blocked',
        severity: 'warning',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Privacy boundary blocked execution.',
        metadata: { tool: request.tool, riskLevel: request.riskLevel, privacySignals: privacyExec.signals, reason: privacyExec.reason }
      });
      collector.emit({ source: 'privacy_boundary', action: 'deny', severity: 'critical', reason: privacyExec.reason });
      const response: ExecuteCapabilityHttpResponse = { decision: 'denied', reason: 'Privacy boundary blocked execution.', capabilityGraph: capabilityGraphView, routing: toRoutingDecisionView(routingExec), privacyBoundary: privacyViewExec };
      if (defenseView !== undefined) response.defense = defenseView;
      return res.status(200).json(response);
    }

    if (privacyExec.action === 'require_approval') {
      const created = approvalQueue.create({
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        tool: request.tool as CapabilityTool,
        riskLevel: request.riskLevel as RiskLevel,
        input: request.input,
        sanitizedInput: decisionExec.sanitizedInput,
        reason: privacyExec.reason
      });
      observeSecurity({
        type: 'approval_pending',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        approvalRequestId: created.request.id,
        message: 'Privacy boundary requires human approval.',
        metadata: { tool: request.tool, riskLevel: request.riskLevel, privacySignals: privacyExec.signals, reason: privacyExec.reason }
      });
      collector.emit({ source: 'privacy_boundary', action: 'require_approval', severity: 'high', reason: privacyExec.reason });
      const response: ExecuteCapabilityHttpResponse = { decision: 'pending', reason: privacyExec.reason, capabilityGraph: capabilityGraphView, routing: toRoutingDecisionView(routingExec), privacyBoundary: privacyViewExec, approvalRequestId: created.request.id, approvalToken: created.token.value };
      if (defenseView !== undefined) response.defense = defenseView;
      return res.status(200).json(response);
    }

    if (privacyExec.action === 'rotate_session') {
      observeSecurity({
        type: 'privacy_boundary_rotation',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Privacy boundary forced a session rotation.',
        metadata: { tool: request.tool, riskLevel: request.riskLevel, privacySignals: privacyExec.signals, reason: privacyExec.reason }
      });
      collector.emit({ source: 'privacy_boundary', action: 'rotate_session', severity: 'medium', reason: privacyExec.reason });
    } else {
      collector.emit({ source: 'privacy_boundary', action: 'allow', severity: 'info', reason: 'Privacy boundary OK.' });
    }

    const fingerprintStateExec = applyTransportFingerprint({
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      requestId,
      sensitiveCategoryDetected: isSensitivePersonaCategory(categoryHint)
    });

    // Emit transport fingerprint signal (parity with execute-mock).
    if (fingerprintStateExec.rotated) {
      collector.emit({ source: 'transport_fingerprint', action: 'rotate_fingerprint', severity: 'low', reason: fingerprintStateExec.decision.reason ?? 'Fingerprint rotation applied.' });
    } else {
      collector.emit({ source: 'transport_fingerprint', action: 'allow', severity: 'info', reason: 'Transport fingerprint OK.' });
    }

    // ── Session ──────────────────────────────────────────────────────────────
    const mustRotateExec = routingExec.shouldRotateSession || privacyExec.action === 'rotate_session' || graphForcesRotation;
    const sessionsBefore2 = sessionManager.size();
    const sessionExec = mustRotateExec
      ? sessionManager.rotateSession(request.compartmentId)
      : sessionManager.getOrCreateSession(request.compartmentId);

    if (mustRotateExec) {
      observeSecurity({ type: 'session_rotated', severity: 'info', agentId: request.agentId, compartmentId: request.compartmentId, sessionId: sessionExec.sessionId, requestId, message: 'Session rotated.', metadata: { transportKind: sessionExec.transportKind } });
    } else if (sessionManager.size() > sessionsBefore2) {
      observeSecurity({ type: 'session_created', severity: 'info', agentId: request.agentId, compartmentId: request.compartmentId, sessionId: sessionExec.sessionId, requestId, message: 'Session created.', metadata: { transportKind: sessionExec.transportKind } });
    }

    // Build the execution request, injecting the resolved transport kind.
    const executionRequestExec: ExecutionRequest = {
      id: randomUUID(),
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      tool: request.tool as CapabilityTool,
      riskLevel: request.riskLevel as RiskLevel,
      input: request.input,
      sanitizedInput: decisionExec.sanitizedInput,
      transportHeaders: { ...fingerprintStateExec.profile.assignedHeaders },
      session: { ...sessionManager.toSessionContext(sessionExec), transportKind: resolvedKind }
    };

    observeSecurity({
      type: 'execution_started',
      severity: 'info',
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      sessionId: sessionExec.sessionId,
      requestId,
      executionId: executionRequestExec.id,
      message: 'Execution started.',
      metadata: { tool: request.tool, riskLevel: request.riskLevel, transportKind: resolvedKind, inputType: inputDescriptor.inputType, inputSizeBytes: inputDescriptor.inputSizeBytes }
    });

    // Select the appropriate execution engine: real (SearXNG) or mock.
    const activeEngine: ExecutionEngine =
      resolvedKind === 'searxng' && realSearXngEngine
        ? realSearXngEngine
        : executionEngine;

    const resultExec = await activeEngine.execute(executionRequestExec);

    if (resultExec.status !== 'blocked') {
      sessionManager.recordUse(sessionExec.sessionId);
    }

    // Sandbox audit.
    const sandboxViolationCodesExec = resultExec.sandbox
      ? resultExec.sandbox.violations.map((v) => v.code)
      : [];
    if (resultExec.sandbox !== undefined) {
      if (resultExec.sandbox.action === 'block') {
        observeSecurity({
          type: 'sandbox_blocked',
          severity: 'warning',
          agentId: request.agentId,
          compartmentId: request.compartmentId,
          sessionId: sessionExec.sessionId,
          requestId,
          executionId: executionRequestExec.id,
          message: 'Adapter sandbox blocked execution.',
          metadata: { tool: request.tool, transportKind: resultExec.transportKind, sandboxViolations: sandboxViolationCodesExec }
        });
        collector.emit({ source: 'sandbox', action: 'deny', severity: 'critical', reason: 'Sandbox blocked execution.' });
      } else {
        observeSecurity({
          type: 'sandbox_allowed',
          severity: 'info',
          agentId: request.agentId,
          compartmentId: request.compartmentId,
          sessionId: sessionExec.sessionId,
          requestId,
          executionId: executionRequestExec.id,
          message: 'Adapter sandbox allowed execution.',
          metadata: { tool: request.tool, transportKind: resultExec.transportKind }
        });
        collector.emit({ source: 'sandbox', action: 'allow', severity: 'info', reason: 'Sandbox allowed execution.' });
      }
    }

    const terminalTypeExec: SecurityEventType =
      resultExec.status === 'success' ? 'execution_succeeded' : resultExec.status === 'failed' ? 'execution_failed' : 'execution_blocked';
    const terminalSeverityExec: EventSeverity = resultExec.status === 'success' ? 'info' : 'warning';
    observeSecurity({
      type: terminalTypeExec,
      severity: terminalSeverityExec,
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      sessionId: sessionExec.sessionId,
      requestId,
      executionId: executionRequestExec.id,
      message: `Execution ${resultExec.status}.`,
      metadata: { tool: request.tool, transportKind: resultExec.transportKind, executionStatus: resultExec.status, ...(sandboxViolationCodesExec.length > 0 ? { sandboxViolations: sandboxViolationCodesExec } : {}) }
    });

    // Graph path recording on success.
    if (resultExec.status === 'success') {
      try {
        const capNodeExec = capabilityGraphEngine.recordCapabilityRequest({
          agentId: request.agentId,
          compartmentId: request.compartmentId,
          tool: request.tool as CapabilityTool,
          riskLevel: request.riskLevel as RiskLevel
        });
        const execNodeExec = capabilityGraphEngine.addNode({
          id: randomUUID(),
          kind: 'execution',
          agentId: request.agentId,
          compartmentId: request.compartmentId,
          tool: request.tool as CapabilityTool,
          riskLevel: request.riskLevel as RiskLevel,
          createdAt: Date.now()
        });
        const execEdgeExec = capabilityGraphEngine.addEdge({
          id: randomUUID(),
          fromNodeId: capNodeExec.id,
          toNodeId: execNodeExec.id,
          relation: 'executed',
          createdAt: Date.now()
        });
        capabilityGraphView = { ...capabilityGraphView, relatedNodeIds: [capNodeExec.id, execNodeExec.id], relatedEdgeIds: [execEdgeExec.id] };
      } catch { /* fail-safe */ }
    }

    const executionViewExec: ExecutionResultView = { status: resultExec.status, transportKind: resultExec.transportKind };
    if (resultExec.output !== undefined) executionViewExec.output = resultExec.output;
    if (resultExec.error !== undefined) executionViewExec.error = resultExec.error;

    const response: ExecuteCapabilityHttpResponse = {
      decision: 'allowed',
      reason: decisionExec.reason,
      capabilityGraph: capabilityGraphView,
      routing: toRoutingDecisionView(routingExec),
      privacyBoundary: privacyViewExec,
      execution: executionViewExec,
      fingerprint: {
        activeFingerprintId: fingerprintStateExec.profile.activeFingerprintId,
        rotationCount: fingerprintStateExec.profile.rotationCount,
        correlationRisk: fingerprintStateExec.profile.correlationRisk,
        rotated: fingerprintStateExec.rotated
      }
    };
    if (resultExec.sandbox !== undefined) response.sandbox = toSandboxDecisionView(resultExec.sandbox);
    if (defenseView !== undefined) response.defense = defenseView;
    const updatedTrustExec = trustEngine.getProfile(request.compartmentId);
    response.trust = updatedTrustExec ? toTrustView(updatedTrustExec) : trustView;
    return res.status(200).json(response);
  });
  app.all('/v1/capabilities/execute', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use POST /v1/capabilities/execute.'
    });
  });

  // Read-only debug surface: list the statically-bootstrapped compartments.
  // No secrets are exposed — only compartment lifecycle metadata.
  app.get('/v1/compartments', (_req, res) => {
    const compartments = sessionManager.listCompartments().map(toCompartmentView);
    const body: CompartmentsHttpResponse = { compartments };
    return res.status(200).json(body);
  });
  app.all('/v1/compartments', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/compartments.' });
  });

  // Read-only metadata surface: list the bootstrap transport policy rules.
  // No secrets are exposed — only routing/isolation metadata.
  app.get('/v1/transport-policies', (_req, res) => {
    const rules = transportPolicyEngine
      .listRules()
      .map(toTransportPolicyRuleView);
    const body: TransportPoliciesHttpResponse = { rules };
    return res.status(200).json(body);
  });
  app.all('/v1/transport-policies', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/transport-policies.' });
  });

  // Read-only metadata surface: list the bootstrap privacy boundary rules.
  // No secrets are exposed — only correlation/boundary metadata.
  app.get('/v1/privacy-boundaries', (_req, res) => {
    const rules = privacyBoundaryEngine
      .listRules()
      .map(toPrivacyBoundaryRuleView);
    const body: PrivacyBoundariesHttpResponse = { rules };
    return res.status(200).json(body);
  });
  app.all('/v1/privacy-boundaries', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/privacy-boundaries.' });
  });

  // Read-only metadata surface: list the registered transport manifests.
  // No secrets are exposed — only the declared capability surface of each
  // adapter (tools, permissions, access flags).
  app.get('/v1/transports', (_req, res) => {
    const transports = transportRegistry
      .listManifests()
      .map(toTransportManifestView);
    const body: TransportsHttpResponse = { transports };
    return res.status(200).json(body);
  });
  app.all('/v1/transports', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/transports.' });
  });

  // Read-only audit surface: the capability/permission surface of every
  // registered transport. No secrets are exposed.
  app.get('/v1/transports/audit', (_req, res) => {
    const audit = transportRegistry.audit().map(toTransportCapabilityAuditView);
    const body: TransportsAuditHttpResponse = { audit };
    return res.status(200).json(body);
  });
  app.all('/v1/transports/audit', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/transports/audit.' });
  });

  // Read-only debug surface: list sessions, optionally filtered by compartment.
  // No tokens or secrets are exposed — only session lifecycle metadata.
  app.get('/v1/sessions', (req, res) => {
    const rawCompartmentId = req.query.compartmentId;
    let compartmentId: string | undefined;
    if (typeof rawCompartmentId === 'string' && rawCompartmentId.length > 0) {
      compartmentId = rawCompartmentId;
    } else if (Array.isArray(rawCompartmentId)) {
      return res
        .status(400)
        .json({ error: 'Query "compartmentId" must be a single value.' });
    }
    const sessions = sessionManager.listSessions(compartmentId).map(toSessionView);
    const body: SessionsHttpResponse = { sessions };
    return res.status(200).json(body);
  });
  app.all('/v1/sessions', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed. Use GET /v1/sessions.' });
  });

  // Read-only audit surface (Sprint 11): list recorded security events with an
  // optional query, or fetch a single event by id. The response carries only
  // normalised, secret-free metadata — NEVER a token, secret, raw header, raw
  // env, raw stack trace, or raw request input.
  app.get('/v1/audit/events', (req, res) => {
    const validated = validateAuditQuery(req.query as Record<string, unknown>);
    if ('error' in validated) {
      return res.status(400).json({ error: validated.error });
    }
    const events = securityEventEngine
      .query(validated.query)
      .map(toSecurityEventView);
    const body: AuditEventsHttpResponse = { events };
    return res.status(200).json(body);
  });
  app.all('/v1/audit/events', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/audit/events.' });
  });

  app.get('/v1/audit/events/:id', (req, res) => {
    const event = securityEventEngine.getEvent(req.params.id);
    if (!event) {
      return res.status(404).json({ error: 'Security event not found.' });
    }
    const body: AuditEventHttpResponse = { event: toSecurityEventView(event) };
    return res.status(200).json(body);
  });
  app.all('/v1/audit/events/:id', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/audit/events/:id.' });
  });

  // Read-only runtime-security surface (Sprint 12): list detected anomalies and
  // the auto-opened incidents they produced, fetch a single incident, and close
  // one. Responses carry only normalised, secret-free metadata — NEVER a token,
  // secret, raw header, raw env, raw stack trace, or raw request input.
  app.get('/v1/security/anomalies', (_req, res) => {
    const anomalies: RuntimeAnomalyView[] = heuristicsEngine
      .queryAnomalies()
      .map(toRuntimeAnomalyView);
    const body: RuntimeAnomaliesHttpResponse = { anomalies };
    return res.status(200).json(body);
  });
  app.all('/v1/security/anomalies', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/security/anomalies.' });
  });

  app.get('/v1/security/incidents', (req, res) => {
    const rawStatus = req.query.status;
    let status: 'open' | 'closed' | undefined;
    if (rawStatus !== undefined) {
      if (rawStatus === 'open' || rawStatus === 'closed') {
        status = rawStatus;
      } else {
        return res
          .status(400)
          .json({ error: 'Query "status" must be "open" or "closed".' });
      }
    }
    const incidents: RuntimeIncidentView[] = incidentDetector
      .listIncidents(status)
      .map(toRuntimeIncidentView);
    const body: RuntimeIncidentsHttpResponse = { incidents };
    return res.status(200).json(body);
  });
  app.all('/v1/security/incidents', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/security/incidents.' });
  });

  app.get('/v1/security/incidents/:id', (req, res) => {
    const incident = incidentDetector.getIncident(req.params.id);
    if (!incident) {
      return res.status(404).json({ error: 'Runtime incident not found.' });
    }
    const body: RuntimeIncidentHttpResponse = {
      incident: toRuntimeIncidentView(incident)
    };
    return res.status(200).json(body);
  });

  app.post('/v1/security/incidents/:id/close', (req, res) => {
    const existing = incidentDetector.getIncident(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Runtime incident not found.' });
    }
    const incident = incidentDetector.closeIncident(req.params.id);
    // Sprint 14: credit the compartment that owned this incident with a trust
    // recovery, if the incident was attributed when it opened.
    const owningCompartment = incidentCompartments.get(req.params.id);
    if (owningCompartment !== undefined) {
      applyTrustEvent({
        compartmentId: owningCompartment,
        type: 'incident_closed',
        reason: `Runtime incident ${req.params.id} closed.`,
        relatedIncidentId: req.params.id
      });
      incidentCompartments.delete(req.params.id);
    }
    const body: RuntimeIncidentHttpResponse = {
      incident: toRuntimeIncidentView(incident)
    };
    return res.status(200).json(body);
  });
  app.all('/v1/security/incidents/:id/close', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use POST /v1/security/incidents/:id/close.'
    });
  });
  app.all('/v1/security/incidents/:id', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/security/incidents/:id.'
    });
  });

  // ── Adaptive Defense & Rate Limiting read endpoints (Sprint 13) ──
  // Metadata only: policy shapes, active temporary blocks, adaptive policies.
  // Never any token, secret, or raw caller input.
  app.get('/v1/defense/rate-limits', (_req, res) => {
    const policies: RateLimitPolicyView[] = rateLimiter
      .listPolicies()
      .map(toRateLimitPolicyView);
    const body: RateLimitPoliciesHttpResponse = { policies };
    return res.status(200).json(body);
  });
  app.all('/v1/defense/rate-limits', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/defense/rate-limits.' });
  });

  app.get('/v1/defense/temporary-blocks', (_req, res) => {
    const blocks: TemporaryCapabilityBlockView[] = rateLimiter
      .listTemporaryBlocks()
      .map(toTemporaryBlockView);
    const body: TemporaryBlocksHttpResponse = { blocks };
    return res.status(200).json(body);
  });
  app.all('/v1/defense/temporary-blocks', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/defense/temporary-blocks.'
    });
  });

  app.get('/v1/defense/adaptive-policies', (_req, res) => {
    const policies: AdaptiveDefensePolicyView[] = adaptiveDefenseEngine
      .listPolicies()
      .map(toAdaptiveDefensePolicyView);
    const body: AdaptiveDefensePoliciesHttpResponse = { policies };
    return res.status(200).json(body);
  });
  app.all('/v1/defense/adaptive-policies', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/defense/adaptive-policies.'
    });
  });

  // ── Compartment Trust & Reputation read endpoints (Sprint 14) ──
  // Metadata only: bounded trust scores, levels, and the reputation event
  // history. Never any token, secret, or raw caller input.
  app.get('/v1/trust/profiles', (_req, res) => {
    const profiles: ReputationProfileView[] = trustEngine
      .listProfiles()
      .map(toReputationProfileView);
    const body: ReputationProfilesHttpResponse = { profiles };
    return res.status(200).json(body);
  });
  app.all('/v1/trust/profiles', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/trust/profiles.' });
  });

  app.get('/v1/trust/events', (req, res) => {
    const rawCompartmentId = req.query.compartmentId;
    let compartmentId: string | undefined;
    if (typeof rawCompartmentId === 'string' && rawCompartmentId.length > 0) {
      compartmentId = rawCompartmentId;
    } else if (Array.isArray(rawCompartmentId)) {
      return res
        .status(400)
        .json({ error: 'Query "compartmentId" must be a single value.' });
    }
    const profiles = trustEngine.listProfiles();
    const events: ReputationEventView[] = profiles
      .filter(
        (profile) =>
          compartmentId === undefined || profile.compartmentId === compartmentId
      )
      .flatMap((profile) => profile.events)
      .map(toReputationEventView);
    const body: ReputationEventsHttpResponse = { events };
    return res.status(200).json(body);
  });
  app.all('/v1/trust/events', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/trust/events.' });
  });

  app.get('/v1/trust/profiles/:compartmentId', (req, res) => {
    const profile = trustEngine.getProfile(req.params.compartmentId);
    if (!profile) {
      return res.status(404).json({ error: 'Reputation profile not found.' });
    }
    const body: ReputationProfileHttpResponse = {
      profile: toReputationProfileView(profile)
    };
    return res.status(200).json(body);
  });
  app.all('/v1/trust/profiles/:compartmentId', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/trust/profiles/:compartmentId.'
    });
  });

  // ── Capability Graph read endpoints (Sprint 15) ──
  // Metadata only: nodes, edges, transition rules, and isolation policies.
  // Optional `agentId` / `compartmentId` / `tool` query params filter nodes and
  // edges. Never any token, secret, or raw caller input. A repeated (array)
  // query param is rejected with 400.
  const readGraphFilter = (
    req: express.Request,
    res: express.Response
  ): { filter: CapabilityGraphFilter } | undefined => {
    const filter: CapabilityGraphFilter = {};
    const readSingleQueryParam = (key: 'agentId' | 'compartmentId' | 'tool'):
      | string
      | undefined
      | null => {
      const raw = req.query[key];
      if (raw === undefined) return undefined;
      if (typeof raw === 'string') return raw.length > 0 ? raw : undefined;
      res.status(400).json({ error: `Query "${key}" must be a single value.` });
      return null;
    };
    const agentId = readSingleQueryParam('agentId');
    if (agentId === null) return undefined;
    if (agentId !== undefined) filter.agentId = agentId;
    const compartmentId = readSingleQueryParam('compartmentId');
    if (compartmentId === null) return undefined;
    if (compartmentId !== undefined) filter.compartmentId = compartmentId;
    const tool = readSingleQueryParam('tool');
    if (tool === null) return undefined;
    if (tool !== undefined) filter.tool = tool as CapabilityTool;
    return { filter };
  };

  app.get('/v1/capability-graph/nodes', (req, res) => {
    const parsed = readGraphFilter(req, res);
    if (!parsed) return undefined;
    const nodes: CapabilityNodeView[] = capabilityGraphEngine
      .listNodes(parsed.filter)
      .map(toCapabilityNodeView);
    const body: CapabilityGraphNodesHttpResponse = { nodes };
    return res.status(200).json(body);
  });
  app.all('/v1/capability-graph/nodes', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/capability-graph/nodes.'
    });
  });

  app.get('/v1/capability-graph/edges', (req, res) => {
    const parsed = readGraphFilter(req, res);
    if (!parsed) return undefined;
    const edges: CapabilityEdgeView[] = capabilityGraphEngine
      .listEdges(parsed.filter)
      .map(toCapabilityEdgeView);
    const body: CapabilityGraphEdgesHttpResponse = { edges };
    return res.status(200).json(body);
  });
  app.all('/v1/capability-graph/edges', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/capability-graph/edges.'
    });
  });

  app.get('/v1/capability-graph/transition-rules', (_req, res) => {
    const transitionRules: CapabilityTransitionRuleView[] = capabilityGraphEngine
      .listTransitionRules()
      .map(toCapabilityTransitionRuleView);
    const body: CapabilityGraphTransitionRulesHttpResponse = { transitionRules };
    return res.status(200).json(body);
  });
  app.all('/v1/capability-graph/transition-rules', (_req, res) => {
    res.status(405).json({
      error:
        'Method not allowed. Use GET /v1/capability-graph/transition-rules.'
    });
  });

  app.get('/v1/capability-graph/isolation-policies', (_req, res) => {
    const isolationPolicies: DependencyIsolationPolicyView[] =
      capabilityGraphEngine
        .listIsolationPolicies()
        .map(toDependencyIsolationPolicyView);
    const body: CapabilityGraphIsolationPoliciesHttpResponse = {
      isolationPolicies
    };
    return res.status(200).json(body);
  });
  app.all('/v1/capability-graph/isolation-policies', (_req, res) => {
    res.status(405).json({
      error:
        'Method not allowed. Use GET /v1/capability-graph/isolation-policies.'
    });
  });

  // ── Sprint 20 — Runtime Profiles & Policy Packs endpoints ──────────────────
  // Metadata only: profile names/descriptions/pack ids, pack ids/descriptions/
  // defined-field summaries, and the active profile. Never any token, secret,
  // raw policy values, or raw request input.

  // GET /v1/runtime/profiles — list all registered profiles
  app.get('/v1/runtime/profiles', (_req, res) => {
    const profiles = profileResolver.listProfiles().map(toProfileView);
    const body: RuntimeProfilesHttpResponse = { profiles };
    return res.status(200).json(body);
  });
  app.all('/v1/runtime/profiles', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/runtime/profiles.' });
  });

  // GET /v1/runtime/packs — list all registered packs
  app.get('/v1/runtime/packs', (_req, res) => {
    const packs = profileResolver.listPacks().map(toPackView);
    const body: RuntimePacksHttpResponse = { packs };
    return res.status(200).json(body);
  });
  app.all('/v1/runtime/packs', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/runtime/packs.' });
  });

  // GET /v1/runtime/profile — show the active profile
  app.get('/v1/runtime/profile', (_req, res) => {
    const profile = activeResolvedProfile?.profile;
    if (!profile) {
      return res.status(200).json({
        profile: toProfileView({
          name: activeProfileName,
          packs: [],
          enabled: true
        })
      });
    }
    const body: RuntimeProfileHttpResponse = {
      profile: toProfileView(profile)
    };
    return res.status(200).json(body);
  });
  app.all('/v1/runtime/profile', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/runtime/profile.' });
  });

  // POST /v1/runtime/profile/:name — local profile switch (no cloud, no remote sync).
  //   200 — switched successfully, returns new profile view + timestamp
  //   400 — profile is disabled or resolution failed
  //   404 — unknown profile name
  //   405 — wrong method on the parent path (already handled above)
  app.post('/v1/runtime/profile/:name', (req, res) => {
    const candidate = req.params.name;

    // Validate profile name.
    if (!isValidProfileName(candidate)) {
      securityEventEngine.emit({
        type: 'runtime_profile_switch_failed',
        severity: 'warning',
        message: `Profile switch to unknown profile "${candidate}" rejected. Current profile "${activeProfileName}" preserved.`,
        metadata: { attempted: candidate, current: activeProfileName, reason: 'unknown_profile' }
      });
      return res.status(404).json({
        error: `Unknown runtime profile: "${candidate}". Valid profiles: ${RUNTIME_PROFILE_NAMES.join(', ')}.`
      });
    }
    const candidateName = candidate as RuntimeProfileName;

    // Check the profile is enabled.
    const allProfiles = profileResolver.listProfiles();
    const targetProfile = allProfiles.find((p) => p.name === candidateName);
    if (!targetProfile || !targetProfile.enabled) {
      return res.status(400).json({
        error: `Runtime profile "${candidateName}" is not enabled.`
      });
    }

    // Attempt resolution — fail-safe: preserve existing profile on failure.
    let resolved: ResolvedRuntimeProfile;
    try {
      resolved = profileResolver.resolveProfile(
        candidateName,
        activeSnapshot.config
      );
    } catch (err) {
      const reason =
        err instanceof RuntimeProfileResolutionError ? err.reason : 'unknown';
      securityEventEngine.emit({
        type: 'runtime_profile_switch_failed',
        severity: 'warning',
        message: `Profile switch to "${candidateName}" failed. Previous profile "${activeProfileName}" preserved.`,
        metadata: { attempted: candidateName, current: activeProfileName, reason }
      });
      return res.status(400).json({
        error: `Failed to switch to profile "${candidateName}": ${err instanceof Error ? err.message : 'resolution error'}.`
      });
    }

    // Apply the resolved config to the policy engines (mirrors applyReloadedSnapshot
    // but without touching the snapshot — profiles layer on top of config).
    const previousProfile = activeProfileName;
    activeProfileName = candidateName;
    activeResolvedProfile = resolved;

    // Rebuild policy engines from the profile's resolved config. Stateful
    // components (sessions, approvals, audit, trust) are preserved.
    firewall = buildFirewallFromConfig(resolved.resolvedConfig.firewallPolicies);
    transportPolicyEngine = buildTransportPolicyEngineFromConfig(
      resolved.resolvedConfig.transportPolicies
    );
    privacyBoundaryEngine = buildPrivacyBoundaryEngineFromConfig(
      resolved.resolvedConfig.privacyBoundaryRules
    );
    rateLimiter = buildRateLimiterFromConfig(
      resolved.resolvedConfig.rateLimitPolicies
    );
    adaptiveDefenseEngine = buildAdaptiveDefenseEngineFromConfig(
      resolved.resolvedConfig.adaptiveDefensePolicies
    );
    capabilityGraphEngine = buildCapabilityGraphEngineFromConfig(
      resolved.resolvedConfig
    );

    // Emit profile-switched audit event.
    securityEventEngine.emit({
      type: 'runtime_profile_switched',
      severity: 'info',
      message: `Runtime profile switched from "${previousProfile}" to "${candidateName}".`,
      metadata: {
        previous: previousProfile,
        current: candidateName,
        packIds: resolved.packs.map((p) => p.id)
      }
    });
    // Emit pack-applied event for each pack.
    for (const pack of resolved.packs) {
      securityEventEngine.emit({
        type: 'policy_pack_applied',
        severity: 'debug',
        message: `Policy pack applied: "${pack.id}".`,
        metadata: { packId: pack.id, profileName: candidateName }
      });
    }

    const switchedAt = Date.now();
    const body: RuntimeProfileSwitchHttpResponse = {
      profile: toProfileView(resolved.profile),
      switchedAt
    };
    return res.status(200).json(body);
  });
  app.all('/v1/runtime/profile/:name', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use POST /v1/runtime/profile/:name.'
    });
  });

  // Read-only metadata surface (Sprint 16): expose the active runtime config and
  // its derived metadata. The body carries only deterministic policy data —
  // NEVER a token, secret, credential, or raw request input.
  app.get('/v1/runtime/config', (_req, res) => {
    const body: RuntimeConfigHttpResponse = {
      version: activeSnapshot.version,
      loadedAt: activeSnapshot.loadedAt,
      checksum: activeSnapshot.checksum,
      config: activeSnapshot.config
    };
    return res.status(200).json(body);
  });
  app.all('/v1/runtime/config', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/runtime/config.' });
  });

  app.get('/v1/runtime/config/checksum', (_req, res) => {
    const body: RuntimeConfigChecksumHttpResponse = {
      checksum: activeSnapshot.checksum
    };
    return res.status(200).json(body);
  });
  app.all('/v1/runtime/config/checksum', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/runtime/config/checksum.'
    });
  });

  app.get('/v1/runtime/config/version', (_req, res) => {
    const body: RuntimeConfigVersionHttpResponse = {
      version: activeSnapshot.version
    };
    return res.status(200).json(body);
  });
  app.all('/v1/runtime/config/version', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/runtime/config/version.'
    });
  });

  // Local-only reload: re-read the current config file, replace the active
  // snapshot, rebuild the derived policy engines, and return the new snapshot
  // metadata. Fail-safe: an invalid/missing file keeps the previous snapshot.
  //   - 200 OK            — reloaded
  //   - 400 invalid config
  //   - 404 missing config (no file loaded, or file no longer readable)
  app.post('/v1/runtime/reload', (_req, res) => {
    if (!runtimeConfigLoader || runtimeConfigLoader.getPath() === undefined) {
      return res
        .status(404)
        .json({ error: 'No runtime config file is loaded to reload.' });
    }
    try {
      const snapshot = runtimeConfigLoader.reload();
      const body: RuntimeReloadHttpResponse = {
        version: snapshot.version,
        loadedAt: snapshot.loadedAt,
        checksum: snapshot.checksum
      };
      return res.status(200).json(body);
    } catch (error) {
      if (error instanceof RuntimeConfigValidationError) {
        return res
          .status(400)
          .json({ error: `Invalid runtime config: ${error.reason}.` });
      }
      return res
        .status(404)
        .json({ error: 'Runtime config file could not be read.' });
    }
  });
  app.all('/v1/runtime/reload', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use POST /v1/runtime/reload.' });
  });

  app.get('/v1/approvals/pending', (_req, res) => {
    const pending: PendingApprovalView[] = approvalQueue
      .listPending()
      .map(toPendingApprovalView);
    const body: PendingApprovalsHttpResponse = { pending };
    return res.status(200).json(body);
  });
  app.all('/v1/approvals/pending', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/approvals/pending.' });
  });

  app.post('/v1/approvals/:id/approve', (req, res) =>
    handleApprovalDecision(approvalQueue, observeSecurity, 'approve', req, res)
  );
  app.all('/v1/approvals/:id/approve', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use POST /v1/approvals/:id/approve.' });
  });

  app.post('/v1/approvals/:id/reject', (req, res) =>
    handleApprovalDecision(approvalQueue, observeSecurity, 'reject', req, res)
  );
  app.all('/v1/approvals/:id/reject', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use POST /v1/approvals/:id/reject.' });
  });

  // ── Sprint 23 — Multi-Agent Runtime Isolation endpoints ────────────────────
  // Metadata only: agent runtime state, quotas, leases, sessions, trust.
  // Never any token, secret, raw input, or cross-agent data.

  // GET /v1/agents — list all registered agent runtimes
  app.get('/v1/agents', (_req, res) => {
    const agents = agentRegistry.listAgents().map(toAgentRuntimeView);
    const body: AgentsHttpResponse = { agents };
    return res.status(200).json(body);
  });
  app.all('/v1/agents', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed. Use GET /v1/agents.' });
  });

  // GET /v1/agents/:agentId — get a single agent runtime
  app.get('/v1/agents/:agentId', (req, res) => {
    const { agentId } = req.params;
    const runtime = agentRegistry.getAgent(agentId);
    if (runtime === undefined) {
      return res.status(404).json({ error: `Agent not found: ${agentId}.` });
    }
    const body: AgentHttpResponse = { agent: toAgentRuntimeView(runtime) };
    return res.status(200).json(body);
  });

  // POST /v1/agents/:agentId/restrict — restrict an agent
  app.post('/v1/agents/:agentId/restrict', (req, res) => {
    const { agentId } = req.params;
    const existing = agentRegistry.getAgent(agentId);
    if (existing === undefined) {
      return res.status(404).json({ error: `Agent not found: ${agentId}.` });
    }
    if (existing.status === 'evicted') {
      return res
        .status(400)
        .json({ error: 'Cannot restrict an evicted agent.' });
    }
    const updated = agentRegistry.restrictAgent(agentId);
    if (updated === undefined) {
      return res.status(404).json({ error: `Agent not found: ${agentId}.` });
    }
    // Emit audit event — metadata only, never raw input.
    securityEventEngine.emit({
      type: 'agent_restricted',
      severity: 'warning',
      agentId,
      message: `Agent "${agentId}" restricted.`,
      metadata: { trustScore: updated.trustScore }
    });
    const body: AgentRestrictHttpResponse = {
      agentId,
      status: 'restricted',
      updatedAt: updated.updatedAt
    };
    return res.status(200).json(body);
  });

  // POST /v1/agents/:agentId/evict — evict an agent
  app.post('/v1/agents/:agentId/evict', (req, res) => {
    const { agentId } = req.params;
    const existing = agentRegistry.getAgent(agentId);
    if (existing === undefined) {
      return res.status(404).json({ error: `Agent not found: ${agentId}.` });
    }
    const updated = agentRegistry.evictAgent(agentId);
    if (updated === undefined) {
      return res.status(404).json({ error: `Agent not found: ${agentId}.` });
    }
    // Emit audit event — metadata only, never raw input.
    securityEventEngine.emit({
      type: 'agent_evicted',
      severity: 'critical',
      agentId,
      message: `Agent "${agentId}" evicted.`,
      metadata: { trustScore: updated.trustScore }
    });
    const body: AgentEvictHttpResponse = {
      agentId,
      status: 'evicted',
      updatedAt: updated.updatedAt
    };
    return res.status(200).json(body);
  });

  // Catch all other methods on the parameterised agent path.
  app.all('/v1/agents/:agentId', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/agents/:agentId.'
    });
  });

  app.all('/v1/agents/:agentId/restrict', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use POST /v1/agents/:agentId/restrict.'
    });
  });

  app.all('/v1/agents/:agentId/evict', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use POST /v1/agents/:agentId/evict.'
    });
  });

  // GET /v1/agents/:agentId/leases — list active leases for an agent
  app.get('/v1/agents/:agentId/leases', (req, res) => {
    const { agentId } = req.params;
    const runtime = agentRegistry.getAgent(agentId);
    if (runtime === undefined) {
      return res.status(404).json({ error: `Agent not found: ${agentId}.` });
    }
    const allLeases = leaseManager.listLeases().filter(
      (l) => l.holderAgentId === agentId
    );
    const body: AgentLeasesHttpResponse = {
      agentId,
      leases: allLeases.map(toLeaseView)
    };
    return res.status(200).json(body);
  });
  app.all('/v1/agents/:agentId/leases', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/agents/:agentId/leases.'
    });
  });

  // GET /v1/agents/:agentId/sessions — session quota summary for an agent
  app.get('/v1/agents/:agentId/sessions', (req, res) => {
    const { agentId } = req.params;
    const runtime = agentRegistry.getAgent(agentId);
    if (runtime === undefined) {
      return res.status(404).json({ error: `Agent not found: ${agentId}.` });
    }
    const body: AgentSessionsHttpResponse = {
      agentId,
      activeSessions: runtime.activeSessions,
      maxSessions: runtime.quota.maxSessions
    };
    return res.status(200).json(body);
  });
  app.all('/v1/agents/:agentId/sessions', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/agents/:agentId/sessions.'
    });
  });

  // GET /v1/agents/:agentId/trust — agent-level trust summary
  app.get('/v1/agents/:agentId/trust', (req, res) => {
    const { agentId } = req.params;
    const runtime = agentRegistry.getAgent(agentId);
    if (runtime === undefined) {
      return res.status(404).json({ error: `Agent not found: ${agentId}.` });
    }
    const trustView: AgentTrustView = {
      agentId,
      trustScore: runtime.trustScore,
      status: runtime.status
    };
    const body: AgentTrustHttpResponse = { trust: trustView };
    return res.status(200).json(body);
  });
  app.all('/v1/agents/:agentId/trust', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/agents/:agentId/trust.'
    });
  });

  // ── Sprint 24 — Behavioral Privacy endpoints ──
  app.get('/v1/privacy/behavioral/profiles', (_req, res) => {
    const profiles = behavioralPrivacyEngine
      .listProfiles()
      .map(toBehavioralProfileView);
    const body: BehavioralProfilesHttpResponse = { profiles };
    return res.status(200).json(body);
  });
  app.all('/v1/privacy/behavioral/profiles', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/privacy/behavioral/profiles.'
    });
  });

  app.get('/v1/privacy/behavioral/profiles/:agentId', (req, res) => {
    const { agentId } = req.params;
    const profile = behavioralPrivacyEngine.getProfile(agentId);
    if (profile === undefined) {
      return res.status(404).json({ error: `Behavioral profile not found: ${agentId}.` });
    }
    const body: BehavioralProfileHttpResponse = {
      profile: toBehavioralProfileView(profile)
    };
    return res.status(200).json(body);
  });
  app.all('/v1/privacy/behavioral/profiles/:agentId', (_req, res) => {
    res.status(405).json({
      error:
        'Method not allowed. Use GET /v1/privacy/behavioral/profiles/:agentId.'
    });
  });

  app.get('/v1/privacy/fragments', (req, res) => {
    const rawAgentId = req.query['agentId'];
    if (Array.isArray(rawAgentId)) {
      return res.status(400).json({ error: 'Query "agentId" must be a single value.' });
    }
    const all =
      typeof rawAgentId === 'string' && rawAgentId.length > 0
        ? behavioralPrivacyEngine.fragmentManager.listFragments(rawAgentId)
        : behavioralPrivacyEngine.fragmentManager.listAllFragments();
    const body: IdentityFragmentsHttpResponse = {
      fragments: all.map(toIdentityFragmentView)
    };
    return res.status(200).json(body);
  });
  app.all('/v1/privacy/fragments', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/privacy/fragments.'
    });
  });

  app.get('/v1/privacy/fragments/:agentId', (req, res) => {
    const { agentId } = req.params;
    const fragments = behavioralPrivacyEngine.fragmentManager.listFragments(agentId);
    const body: IdentityFragmentsHttpResponse = {
      fragments: fragments.map(toIdentityFragmentView)
    };
    return res.status(200).json(body);
  });
  app.all('/v1/privacy/fragments/:agentId', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/privacy/fragments/:agentId.'
    });
  });

  app.get('/v1/privacy/jitter-policies', (_req, res) => {
    const body: JitterPoliciesHttpResponse = {
      jitterPolicy: behavioralPrivacyEngine.getJitterPolicy(),
      fragmentationPolicy: behavioralPrivacyEngine.getFragmentationPolicy(),
      correlationPolicy: behavioralPrivacyEngine.getCorrelationPolicy()
    };
    return res.status(200).json(body);
  });
  app.all('/v1/privacy/jitter-policies', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/privacy/jitter-policies.'
    });
  });

  // ── Sprint 25 — Persona Isolation endpoints ──

  // GET /v1/privacy/personas — list all personas across all agents
  app.get('/v1/privacy/personas', (_req, res) => {
    const personas = personaIsolationEngine.listPersonas().map(toSearchPersonaView);
    const body: PersonasHttpResponse = { personas };
    return res.status(200).json(body);
  });
  app.all('/v1/privacy/personas', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed. Use GET /v1/privacy/personas.' });
  });

  // GET /v1/privacy/personas/:agentId — list personas for a specific agent
  app.get('/v1/privacy/personas/:agentId', (req, res) => {
    const { agentId } = req.params;
    const personas = personaIsolationEngine.listPersonas(agentId).map(toSearchPersonaView);
    const body: PersonasByAgentHttpResponse = { agentId, personas };
    return res.status(200).json(body);
  });
  app.all('/v1/privacy/personas/:agentId', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed. Use GET /v1/privacy/personas/:agentId.' });
  });

  // GET /v1/privacy/persona-bindings — list all persona-fragment bindings
  app.get('/v1/privacy/persona-bindings', (req, res) => {
    const rawAgentId = req.query['agentId'];
    if (Array.isArray(rawAgentId)) {
      return res.status(400).json({ error: 'Query "agentId" must be a single value.' });
    }
    const agentId = typeof rawAgentId === 'string' && rawAgentId.length > 0 ? rawAgentId : undefined;
    const bindings = personaIsolationEngine.listPersonaBindings(agentId).map(toPersonaFragmentBindingView);
    const body: PersonaBindingsHttpResponse = { bindings };
    return res.status(200).json(body);
  });
  app.all('/v1/privacy/persona-bindings', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed. Use GET /v1/privacy/persona-bindings.' });
  });

  // GET /v1/privacy/persona-bindings/:agentId — bindings for a specific agent
  app.get('/v1/privacy/persona-bindings/:agentId', (req, res) => {
    const { agentId } = req.params;
    const bindings = personaIsolationEngine
      .listPersonaBindings(agentId)
      .map(toPersonaFragmentBindingView);
    const body: PersonaBindingsByAgentHttpResponse = { agentId, bindings };
    return res.status(200).json(body);
  });
  app.all('/v1/privacy/persona-bindings/:agentId', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/privacy/persona-bindings/:agentId.'
    });
  });

  // GET /v1/privacy/segmentation-policies — current segmentation policy
  app.get('/v1/privacy/segmentation-policies', (_req, res) => {
    const body: SegmentationPoliciesHttpResponse = {
      segmentationPolicy: personaIsolationEngine.getSegmentationPolicy()
    };
    return res.status(200).json(body);
  });
  app.all('/v1/privacy/segmentation-policies', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/privacy/segmentation-policies.'
    });
  });

  // ── Sprint 26 — Temporal Obfuscation endpoints ──

  // GET /v1/privacy/temporal/profiles — list all temporal profiles
  app.get('/v1/privacy/temporal/profiles', (_req, res) => {
    const profiles = temporalObfuscationEngine.listProfiles().map(toTemporalProfileView);
    const body: TemporalProfilesHttpResponse = { profiles };
    return res.status(200).json(body);
  });
  app.all('/v1/privacy/temporal/profiles', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/privacy/temporal/profiles.'
    });
  });

  // GET /v1/privacy/temporal/profiles/:agentId — get profile for a specific agent
  app.get('/v1/privacy/temporal/profiles/:agentId', (req, res) => {
    const { agentId } = req.params;
    const profile = temporalObfuscationEngine.getProfile(agentId);
    if (profile === undefined) {
      return res.status(404).json({ error: `Temporal profile not found: ${agentId}.` });
    }
    const body: TemporalProfileHttpResponse = { profile: toTemporalProfileView(profile) };
    return res.status(200).json(body);
  });
  app.all('/v1/privacy/temporal/profiles/:agentId', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/privacy/temporal/profiles/:agentId.'
    });
  });

  // GET /v1/privacy/temporal/budgets — list all temporal budgets
  app.get('/v1/privacy/temporal/budgets', (_req, res) => {
    const budgets = temporalObfuscationEngine.budgetManager.listBudgets().map(toTemporalBudgetView);
    const body: TemporalBudgetsHttpResponse = { budgets };
    return res.status(200).json(body);
  });
  app.all('/v1/privacy/temporal/budgets', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/privacy/temporal/budgets.'
    });
  });

  // GET /v1/privacy/temporal/budgets/:agentId — get budget for a specific agent
  app.get('/v1/privacy/temporal/budgets/:agentId', (req, res) => {
    const { agentId } = req.params;
    const budget = toTemporalBudgetView(temporalObfuscationEngine.budgetManager.getBudget(agentId));
    const body: TemporalBudgetHttpResponse = { agentId, budget };
    return res.status(200).json(body);
  });
  app.all('/v1/privacy/temporal/budgets/:agentId', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/privacy/temporal/budgets/:agentId.'
    });
  });

  // GET /v1/privacy/temporal/policies — current temporal policies
  app.get('/v1/privacy/temporal/policies', (_req, res) => {
    const body: TemporalPoliciesHttpResponse = {
      cadencePolicy: temporalObfuscationEngine.getCadencePolicy(),
      burstPolicy: temporalObfuscationEngine.getBurstPolicy(),
      budgetPolicy: temporalObfuscationEngine.getBudgetPolicy()
    };
    return res.status(200).json(body);
  });
  app.all('/v1/privacy/temporal/policies', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/privacy/temporal/policies.'
    });
  });

  // GET /v1/privacy/fingerprints
  app.get('/v1/privacy/fingerprints', (_req, res) => {
    const profiles = transportFingerprintEngine.listProfiles().map(toFingerprintProfileView);
    const body: FingerprintProfilesHttpResponse = { profiles };
    return res.status(200).json(body);
  });
  app.all('/v1/privacy/fingerprints', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed. Use GET /v1/privacy/fingerprints.' });
  });

  // GET /v1/privacy/fingerprints/:agentId
  app.get('/v1/privacy/fingerprints/:agentId', (req, res) => {
    const { agentId } = req.params;
    const profile = transportFingerprintEngine.getProfile(agentId);
    if (!profile) {
      return res.status(404).json({ error: `Fingerprint profile not found: ${agentId}` });
    }
    const body: FingerprintProfileHttpResponse = {
      agentId,
      profile: toFingerprintProfileView(profile)
    };
    return res.status(200).json(body);
  });
  app.all('/v1/privacy/fingerprints/:agentId', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed. Use GET /v1/privacy/fingerprints/:agentId.' });
  });

  // GET /v1/privacy/header-policies
  app.get('/v1/privacy/header-policies', (_req, res) => {
    const policy: HeaderIsolationPolicy = transportFingerprintEngine.getPolicy();
    const body: HeaderPoliciesHttpResponse = { policy };
    return res.status(200).json(body);
  });
  app.all('/v1/privacy/header-policies', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed. Use GET /v1/privacy/header-policies.' });
  });

  // GET /v1/privacy/header-profiles
  app.get('/v1/privacy/header-profiles', (_req, res) => {
    const raw = transportFingerprintEngine.listHeaderProfiles();
    const profiles: HeaderProfileView[] = raw.map((p) => ({
      id: p.id,
      userAgent: p.userAgent,
      acceptLanguage: p.acceptLanguage,
      createdAt: p.createdAt,
      active: p.active
    }));
    const body: HeaderProfilesHttpResponse = { profiles };
    return res.status(200).json(body);
  });
  app.all('/v1/privacy/header-profiles', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed. Use GET /v1/privacy/header-profiles.' });
  });

  // Expose multi-agent components for test injection / inspection.
  // These are set on the express app instance so integration tests can reach them.
  (app as unknown as Record<string, unknown>)['_agentRegistry'] = agentRegistry;
  (app as unknown as Record<string, unknown>)['_quotaManager'] = quotaManager;
  (app as unknown as Record<string, unknown>)['_leaseManager'] = leaseManager;
  (app as unknown as Record<string, unknown>)['_agentScheduler'] = agentScheduler;
  (app as unknown as Record<string, unknown>)['_isolationEngine'] = isolationEngine;
  (app as unknown as Record<string, unknown>)['_personaIsolationEngine'] = personaIsolationEngine;
  (app as unknown as Record<string, unknown>)['_temporalObfuscationEngine'] = temporalObfuscationEngine;
  (app as unknown as Record<string, unknown>)['_transportFingerprintEngine'] = transportFingerprintEngine;
  (app as unknown as Record<string, unknown>)['_runtimePolicyOrchestrator'] = runtimePolicyOrchestrator;

  // ── Sprint 28 — Runtime Policy Orchestrator endpoints ──
  // Metadata only: policies, accumulated signals, last composite decision.
  // Never raw input, never tokens, never secrets.

  // GET /v1/runtime/policy-orchestrator/policies — list registered policies.
  app.get('/v1/runtime/policy-orchestrator/policies', (_req, res) => {
    const policies: CompositePrivacyPolicyView[] = runtimePolicyOrchestrator
      .listPolicies()
      .map((p) => ({
        id: p.id,
        enabled: p.enabled,
        precedence: [...p.precedence],
        defaultAction: p.defaultAction,
        failClosed: p.failClosed,
        mergeStrategy: p.mergeStrategy
      }));
    const body: PolicyOrchestratorPoliciesHttpResponse = { policies };
    return res.status(200).json(body);
  });
  app.all('/v1/runtime/policy-orchestrator/policies', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/runtime/policy-orchestrator/policies.'
    });
  });

  // GET /v1/runtime/policy-orchestrator/signals — list buffered signals.
  //
  // Sprint 29 — optional filters: ?source=&action=&severity=&limit=.
  // Filters are validated against the closed signal vocabulary; an unknown
  // value is rejected fail-closed with HTTP 400 rather than silently ignored.
  // `limit` must be a positive integer and is clamped to the orchestrator's
  // bounded buffer size. Filters compose with AND semantics; `limit` keeps the
  // most recent matching signals.
  app.get('/v1/runtime/policy-orchestrator/signals', (req, res) => {
    const { source, action, severity, limit } = req.query;

    const readScalar = (value: unknown): string | undefined => {
      if (value === undefined) return undefined;
      return Array.isArray(value) ? String(value[value.length - 1]) : String(value);
    };

    const sourceParam = readScalar(source);
    if (sourceParam !== undefined && !VALID_POLICY_SIGNAL_SOURCES.includes(sourceParam as PolicySignalSourceValue)) {
      return res.status(400).json({ error: `Invalid source: "${sourceParam}".` });
    }
    const actionParam = readScalar(action);
    if (actionParam !== undefined && !VALID_UNIFIED_PRIVACY_ACTIONS.includes(actionParam as UnifiedPrivacyActionValue)) {
      return res.status(400).json({ error: `Invalid action: "${actionParam}".` });
    }
    const severityParam = readScalar(severity);
    if (severityParam !== undefined && !VALID_POLICY_SIGNAL_SEVERITIES.includes(severityParam as PolicySignalSeverityValue)) {
      return res.status(400).json({ error: `Invalid severity: "${severityParam}".` });
    }
    let limitParam: number | undefined;
    const rawLimit = readScalar(limit);
    if (rawLimit !== undefined) {
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return res.status(400).json({ error: `Invalid limit: "${rawLimit}". Must be a positive integer.` });
      }
      // Clamp to the bounded buffer — the buffer can never hold more anyway.
      limitParam = Math.min(parsed, runtimePolicyOrchestrator.maxSignals);
    }

    let filtered = runtimePolicyOrchestrator.listSignals();
    if (sourceParam !== undefined) filtered = filtered.filter((s) => s.source === sourceParam);
    if (actionParam !== undefined) filtered = filtered.filter((s) => s.action === actionParam);
    if (severityParam !== undefined) filtered = filtered.filter((s) => s.severity === severityParam);
    if (limitParam !== undefined && filtered.length > limitParam) {
      // Keep the most recent matching signals.
      filtered = filtered.slice(filtered.length - limitParam);
    }

    const signals: PolicySignalView[] = filtered.map((s): PolicySignalView => ({
      id: s.id,
      source: s.source,
      action: s.action,
      severity: s.severity,
      reason: s.reason,
      createdAt: s.createdAt,
      ...(s.metadata !== undefined ? { metadata: { ...s.metadata } } : {})
    }));
    const body: PolicyOrchestratorSignalsHttpResponse = { signals };
    return res.status(200).json(body);
  });
  app.all('/v1/runtime/policy-orchestrator/signals', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/runtime/policy-orchestrator/signals.'
    });
  });

  // GET /v1/runtime/policy-orchestrator/last-decision — last composite decision.
  app.get('/v1/runtime/policy-orchestrator/last-decision', (_req, res) => {
    const last = runtimePolicyOrchestrator.lastDecision;
    const body: PolicyOrchestratorLastDecisionHttpResponse = {
      decision: last ? toRuntimePolicyDecisionView(last) : null
    };
    return res.status(200).json(body);
  });
  app.all('/v1/runtime/policy-orchestrator/last-decision', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use GET /v1/runtime/policy-orchestrator/last-decision.'
    });
  });

  // Unknown routes → 404.
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  // Body-parser and runtime errors → typed HTTP codes.
  app.use(
    (
      err: Error & { type?: string; status?: number; statusCode?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      const status = err.status ?? err.statusCode;
      if (err.type === 'entity.too.large' || status === 413) {
        return res.status(413).json({ error: 'Payload too large.' });
      }
      if (err.type === 'entity.parse.failed' || err instanceof SyntaxError || status === 400) {
        return res.status(400).json({ error: 'Invalid JSON body.' });
      }
      return res.status(500).json({ error: 'Internal server error.' });
    }
  );

  return app;
}

export interface LocalApiServerConfig {
  host: string;
  port: number;
  maxBodyBytes: number;
  approvalTtlMs: number;
  sessionTtlMs: number;
  sessionMaxRequests: number;
  sessionReusePolicy: SessionReusePolicy;
}

/** Parse a reuse policy from an env value, falling back to the default. */
export function parseReusePolicy(
  value: string | undefined
): SessionReusePolicy {
  return value === 'always_rotate' || value === 'reuse_active'
    ? value
    : DEFAULT_SESSION_REUSE_POLICY;
}

/**
 * Resolve the server configuration from an environment map.
 *
 * Reads `GRL_HOST`, `GRL_PORT`, `GRL_MAX_BODY_BYTES`, `GRL_APPROVAL_TTL_MS`,
 * `GRL_SESSION_TTL_MS`, `GRL_SESSION_MAX_REQUESTS`, and
 * `GRL_SESSION_REUSE_POLICY`. The `env` argument is injectable so configuration
 * can be tested without mutating global state.
 */
export function resolveServerConfig(
  env: NodeJS.ProcessEnv = process.env
): LocalApiServerConfig {
  const port = env.GRL_PORT ? Number(env.GRL_PORT) : DEFAULT_PORT;
  const maxBodyBytes = env.GRL_MAX_BODY_BYTES
    ? Number(env.GRL_MAX_BODY_BYTES)
    : DEFAULT_MAX_BODY_BYTES;
  const approvalTtlMs = env.GRL_APPROVAL_TTL_MS
    ? Number(env.GRL_APPROVAL_TTL_MS)
    : DEFAULT_APPROVAL_TTL_MS;
  const sessionTtlMs = env.GRL_SESSION_TTL_MS
    ? Number(env.GRL_SESSION_TTL_MS)
    : DEFAULT_SESSION_TTL_MS;
  const sessionMaxRequests = env.GRL_SESSION_MAX_REQUESTS
    ? Number(env.GRL_SESSION_MAX_REQUESTS)
    : DEFAULT_SESSION_MAX_REQUESTS;
  return {
    host: env.GRL_HOST || DEFAULT_HOST,
    port: Number.isFinite(port) ? port : DEFAULT_PORT,
    maxBodyBytes: Number.isFinite(maxBodyBytes) ? maxBodyBytes : DEFAULT_MAX_BODY_BYTES,
    approvalTtlMs:
      Number.isFinite(approvalTtlMs) && approvalTtlMs > 0
        ? approvalTtlMs
        : DEFAULT_APPROVAL_TTL_MS,
    sessionTtlMs:
      Number.isFinite(sessionTtlMs) && sessionTtlMs > 0
        ? sessionTtlMs
        : DEFAULT_SESSION_TTL_MS,
    sessionMaxRequests:
      Number.isFinite(sessionMaxRequests) && sessionMaxRequests > 0
        ? sessionMaxRequests
        : DEFAULT_SESSION_MAX_REQUESTS,
    sessionReusePolicy: parseReusePolicy(env.GRL_SESSION_REUSE_POLICY)
  };
}

function startLocalApiServer(): void {
  const config = resolveServerConfig();
  const transportRegistry = buildBootstrapTransportRegistry();

  // Sprint 16 — load the runtime config from GRL_CONFIG_PATH when present; fall
  // back to the in-memory DEFAULT_RUNTIME_CONFIG bootstrap otherwise. The loader
  // is local-only (filesystem + JSON) and performs no network work.
  const runtimeConfigLoader = new RuntimeConfigLoader();
  const configPath = process.env.GRL_CONFIG_PATH;
  let activeConfig: RuntimeConfig = DEFAULT_RUNTIME_CONFIG;
  if (configPath && configPath.length > 0) {
    try {
      const snapshot = runtimeConfigLoader.loadFromFile(configPath);
      activeConfig = snapshot.config;
      if (process.env.GRL_CONFIG_WATCH === '1') {
        runtimeConfigLoader.watch();
      }
    } catch (error) {
      // Fail-closed: refuse to start on an explicitly-requested but invalid
      // config rather than silently falling back to defaults.
      // eslint-disable-next-line no-console
      console.error(
        `Failed to load GRL_CONFIG_PATH=${configPath}: ${(error as Error).message}`
      );
      process.exitCode = 1;
      return;
    }
  }

  // Sprint 20 — resolve the active runtime profile from GRL_PROFILE.
  // Defaults to 'balanced'. An invalid profile name falls back to 'balanced'
  // at the app level (fail-closed, logged at startup).
  const rawProfile = process.env.GRL_PROFILE;
  const activeProfileName: RuntimeProfileName = isValidProfileName(rawProfile)
    ? rawProfile
    : 'balanced';

  if (rawProfile && !isValidProfileName(rawProfile)) {
    // eslint-disable-next-line no-console
    console.error(
      `GRL_PROFILE="${rawProfile}" is not a valid profile name. ` +
        `Valid profiles: ${RUNTIME_PROFILE_NAMES.join(', ')}. Falling back to "balanced".`
    );
  }

  const app = createLocalApiApp({
    firewall: buildFirewallFromConfig(activeConfig.firewallPolicies),
    maxBodyBytes: config.maxBodyBytes,
    approvalQueue: buildApprovalQueue(config.approvalTtlMs),
    executionEngine: buildMockExecutionEngine(transportRegistry),
    sessionManager: buildBootstrapSessionManager({
      ttlMs: config.sessionTtlMs,
      maxRequests: config.sessionMaxRequests,
      reusePolicy: config.sessionReusePolicy
    }),
    transportRegistry,
    runtimeConfigLoader,
    activeProfileName
  });
  app.listen(config.port, config.host, () => {
    // eslint-disable-next-line no-console
    console.log(
      `GRL Local API listening on http://${config.host}:${config.port} [profile: ${activeProfileName}]`
    );
  });
}

const invokedDirectly =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  startLocalApiServer();
}
