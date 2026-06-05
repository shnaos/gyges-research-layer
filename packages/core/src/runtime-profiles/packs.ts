/**
 * Built-in policy packs and runtime profiles for the Sprint 20 MVP.
 *
 * Every pack and profile entry is pure, static, secret-free configuration —
 * no ML, no AI, no semantic classification, no real network, no durable
 * persistence. All values are metadata only: ids, enums, numeric thresholds,
 * booleans. NEVER tokens, secrets, credentials, raw headers, raw env, raw
 * stack traces, or raw request input.
 *
 * Pack merging semantics (enforced by {@link RuntimeProfileResolver}):
 *   - Packs are applied in declaration order (parent profile's packs first).
 *   - For each defined field, the pack **replaces** the working config's field.
 *   - Undefined pack fields are left untouched.
 *   - Profile `overrides` are applied after all packs.
 */

import { BOOTSTRAP_TRANSPORT_POLICY_RULES } from '../transport-policy/bootstrap.js';
import { BOOTSTRAP_PRIVACY_BOUNDARY_RULES } from '../privacy-boundary/bootstrap.js';
import {
  BOOTSTRAP_ADAPTIVE_DEFENSE_POLICIES,
  BOOTSTRAP_RATE_LIMIT_POLICIES
} from '../adaptive-defense/bootstrap.js';
import {
  BOOTSTRAP_CAPABILITY_TRANSITION_RULES,
  BOOTSTRAP_DEPENDENCY_ISOLATION_POLICY
} from '../capability-graph/bootstrap.js';
import type { PolicyPack, RuntimeProfile } from './types.js';

// ---------------------------------------------------------------------------
// Policy Packs
// ---------------------------------------------------------------------------

/**
 * balanced-default-pack
 *
 * The standard policy set. Mirrors the DEFAULT_RUNTIME_CONFIG exactly:
 * deny-by-default firewall, standard rate limits, standard adaptive defence,
 * the bootstrap transport/privacy/trust/graph surface, and a fully sandboxed
 * mock transport.
 */
export const BALANCED_DEFAULT_PACK: PolicyPack = {
  id: 'balanced-default-pack',
  description:
    'Standard default policy set. Mirrors the boot-time defaults: deny-by-default firewall, ' +
    'reasonable rate limits, bootstrap transport/privacy/trust/graph surface.',
  firewallPolicies: [
    {
      agentId: 'local-agent',
      compartmentId: 'research',
      allowedTools: ['search', 'fetch_html', 'fetch_json'],
      maxRiskLevel: 'low'
    },
    {
      agentId: 'local-agent',
      compartmentId: 'research',
      allowedTools: ['fetch_html'],
      maxRiskLevel: 'medium',
      requiresConfirmationAbove: 'low'
    }
  ],
  transportPolicies: [...BOOTSTRAP_TRANSPORT_POLICY_RULES],
  adaptiveDefensePolicies: [...BOOTSTRAP_ADAPTIVE_DEFENSE_POLICIES],
  rateLimitPolicies: [...BOOTSTRAP_RATE_LIMIT_POLICIES],
  privacyBoundaryRules: [...BOOTSTRAP_PRIVACY_BOUNDARY_RULES],
  graphTransitionRules: [...BOOTSTRAP_CAPABILITY_TRANSITION_RULES],
  isolationPolicies: [BOOTSTRAP_DEPENDENCY_ISOLATION_POLICY],
  trustPolicies: {
    enabled: true,
    baselineScore: 70,
    quarantinedThreshold: 19,
    restrictedThreshold: 49
  },
  sandboxPolicies: [
    {
      transportKind: 'mock',
      allowNetwork: false,
      allowFilesystem: false,
      allowProcessSpawn: false,
      allowBrowser: false
    }
  ]
};

/**
 * strict-defense-pack
 *
 * Aggressive deny-by-default: only `search` at `low` risk is allowed (requires
 * confirmation even at low), very tight rate limits (3 req/min), and all
 * anomalies escalate to temporary block rather than cooldown.
 */
export const STRICT_DEFENSE_PACK: PolicyPack = {
  id: 'strict-defense-pack',
  description:
    'Aggressive deny-by-default. Only low-risk search is allowed with mandatory ' +
    'confirmation. Tight rate limits (3 req/min). All anomalies escalate to temporary block.',
  firewallPolicies: [
    {
      agentId: 'local-agent',
      compartmentId: 'research',
      allowedTools: ['search'],
      maxRiskLevel: 'low',
      requiresConfirmationAbove: 'low'
    }
  ],
  rateLimitPolicies: [
    {
      id: 'strict-agent-rate',
      scope: 'agent',
      maxRequests: 3,
      windowMs: 60_000,
      action: 'cooldown',
      enabled: true
    },
    {
      id: 'strict-tool-rate',
      scope: 'tool',
      maxRequests: 2,
      windowMs: 60_000,
      action: 'require_approval',
      enabled: true
    }
  ],
  adaptiveDefensePolicies: [
    {
      id: 'strict-repeated-denied-defense',
      triggerAnomalyTypes: ['repeated_denied_capabilities'],
      triggerIncidentSeverities: ['warning'],
      resultingAction: 'temporary_block',
      cooldownMs: 300_000,
      enabled: true
    },
    {
      id: 'strict-sandbox-defense',
      triggerAnomalyTypes: ['sandbox_violation_attempts'],
      triggerIncidentSeverities: ['critical'],
      resultingAction: 'temporary_block',
      cooldownMs: 600_000,
      enabled: true
    },
    {
      id: 'strict-privacy-boundary-defense',
      triggerAnomalyTypes: ['privacy_boundary_violations'],
      triggerIncidentSeverities: ['critical'],
      resultingAction: 'temporary_block',
      cooldownMs: 300_000,
      enabled: true
    },
    {
      id: 'strict-approval-rejection-defense',
      triggerAnomalyTypes: ['approval_rejection_pattern'],
      triggerIncidentSeverities: ['warning'],
      resultingAction: 'temporary_block',
      cooldownMs: 300_000,
      enabled: true
    },
    {
      id: 'strict-risk-escalation-defense',
      triggerAnomalyTypes: ['high_risk_execution_pattern'],
      triggerIncidentSeverities: ['warning', 'critical'],
      resultingAction: 'temporary_block',
      cooldownMs: 300_000,
      enabled: true
    }
  ]
};

/**
 * strict-sandbox-pack
 *
 * Strict sandbox, isolation, and graph controls:
 *   - Fully sandboxed mock transport (all flags false)
 *   - Max path length 3, cross-tool escalation forbidden, approval on tool change
 *   - Only search→fetch_html transition at `low` risk; no further transitions
 *   - Session reuse forbidden; always-rotate strict isolation
 */
export const STRICT_SANDBOX_PACK: PolicyPack = {
  id: 'strict-sandbox-pack',
  description:
    'Strict sandbox and isolation controls. Max path length 3, approval on every ' +
    'tool change, session reuse forbidden. Only search→fetch_html at low risk.',
  sandboxPolicies: [
    {
      transportKind: 'mock',
      allowNetwork: false,
      allowFilesystem: false,
      allowProcessSpawn: false,
      allowBrowser: false
    }
  ],
  isolationPolicies: [
    {
      id: 'strict-isolation-policy',
      compartmentId: 'research',
      maxPathLength: 3,
      forbidCrossToolEscalation: true,
      requireApprovalOnToolChange: true,
      blockOnHighRiskPath: true,
      enabled: true
    }
  ],
  graphTransitionRules: [
    {
      id: 'strict-search-to-fetch-html',
      fromTool: 'search',
      toTool: 'fetch_html',
      maxAllowedRisk: 'low',
      actionOnViolation: 'require_approval',
      enabled: true
    }
  ],
  transportPolicies: [
    {
      tool: 'search',
      riskLevel: 'low',
      preferredTransport: 'mock',
      isolationPolicy: {
        level: 'strict',
        forceRotateOnHighRisk: true,
        forbidSessionReuse: true,
        allowCrossToolReuse: false
      }
    },
    {
      tool: 'fetch_html',
      riskLevel: 'low',
      preferredTransport: 'mock',
      isolationPolicy: {
        level: 'strict',
        forceRotateOnHighRisk: true,
        forbidSessionReuse: true,
        allowCrossToolReuse: false
      }
    }
  ]
};

/**
 * research-flex-pack
 *
 * Relaxed graph transitions and more generous rate limits for exploration:
 *   - Both search→fetch_html and fetch_html→fetch_json transitions allowed at
 *     `medium` risk (violations block rather than requiring approval)
 *   - Max path length 8; no approval required on tool change
 *   - 20 req/min per agent, 10 per tool
 *   - Trust thresholds lowered (harder to quarantine/restrict)
 */
export const RESEARCH_FLEX_PACK: PolicyPack = {
  id: 'research-flex-pack',
  description:
    'Relaxed graph transitions for exploration. Transitions up to medium risk without ' +
    'approval. 20 req/min. Lower quarantine/restriction thresholds.',
  graphTransitionRules: [
    {
      id: 'research-search-to-fetch-html',
      fromTool: 'search',
      toTool: 'fetch_html',
      maxAllowedRisk: 'medium',
      actionOnViolation: 'block',
      enabled: true
    },
    {
      id: 'research-fetch-html-to-fetch-json',
      fromTool: 'fetch_html',
      toTool: 'fetch_json',
      maxAllowedRisk: 'medium',
      actionOnViolation: 'block',
      enabled: true
    }
  ],
  isolationPolicies: [
    {
      id: 'research-isolation-policy',
      compartmentId: 'research',
      maxPathLength: 8,
      forbidCrossToolEscalation: true,
      requireApprovalOnToolChange: false,
      blockOnHighRiskPath: true,
      enabled: true
    }
  ],
  rateLimitPolicies: [
    {
      id: 'research-agent-rate',
      scope: 'agent',
      maxRequests: 20,
      windowMs: 60_000,
      action: 'cooldown',
      enabled: true
    },
    {
      id: 'research-tool-rate',
      scope: 'tool',
      maxRequests: 10,
      windowMs: 60_000,
      action: 'cooldown',
      enabled: true
    }
  ],
  trustPolicies: {
    enabled: true,
    baselineScore: 70,
    quarantinedThreshold: 15,
    restrictedThreshold: 40
  }
};

/**
 * development-low-friction-pack
 *
 * Minimal friction for local development:
 *   - All tools allowed up to `medium` risk, no confirmation required
 *   - Very generous rate limits (100 req/min per agent)
 *   - Only sandbox violations trigger an approval (no cooldown/block by default)
 *   - Max path length 20; cross-tool escalation allowed; no approval on tool change
 *   - Trust: permissive baseline 80, quarantine at 10, restrict at 30
 *   - Sandbox always active (no real network/filesystem/process/browser access)
 */
export const DEVELOPMENT_LOW_FRICTION_PACK: PolicyPack = {
  id: 'development-low-friction-pack',
  description:
    'Minimal friction for local development. All tools up to medium risk, no confirmation. ' +
    '100 req/min. Max path 20. Sandbox always active.',
  firewallPolicies: [
    {
      agentId: 'local-agent',
      compartmentId: 'research',
      allowedTools: ['search', 'fetch_html', 'fetch_json'],
      maxRiskLevel: 'medium'
    }
  ],
  rateLimitPolicies: [
    {
      id: 'dev-agent-rate',
      scope: 'agent',
      maxRequests: 100,
      windowMs: 60_000,
      action: 'cooldown',
      enabled: true
    },
    {
      id: 'dev-tool-rate',
      scope: 'tool',
      maxRequests: 50,
      windowMs: 60_000,
      action: 'cooldown',
      enabled: true
    }
  ],
  adaptiveDefensePolicies: [
    {
      id: 'dev-sandbox-defense',
      triggerAnomalyTypes: ['sandbox_violation_attempts'],
      triggerIncidentSeverities: ['critical'],
      resultingAction: 'require_approval',
      enabled: true
    }
  ],
  trustPolicies: {
    enabled: true,
    baselineScore: 80,
    quarantinedThreshold: 10,
    restrictedThreshold: 30
  },
  isolationPolicies: [
    {
      id: 'dev-isolation-policy',
      compartmentId: 'research',
      maxPathLength: 20,
      forbidCrossToolEscalation: false,
      requireApprovalOnToolChange: false,
      blockOnHighRiskPath: false,
      enabled: true
    }
  ],
  graphTransitionRules: [
    {
      id: 'dev-search-to-fetch-html',
      fromTool: 'search',
      toTool: 'fetch_html',
      maxAllowedRisk: 'high',
      actionOnViolation: 'require_approval',
      enabled: true
    },
    {
      id: 'dev-fetch-html-to-fetch-json',
      fromTool: 'fetch_html',
      toTool: 'fetch_json',
      maxAllowedRisk: 'high',
      actionOnViolation: 'require_approval',
      enabled: true
    }
  ],
  // Sandbox is always active, even in development.
  sandboxPolicies: [
    {
      transportKind: 'mock',
      allowNetwork: false,
      allowFilesystem: false,
      allowProcessSpawn: false,
      allowBrowser: false
    }
  ]
};

/**
 * privacy-hardening-pack
 *
 * Strengthens the privacy boundary by blocking (not just requiring approval for)
 * risk violations within the research compartment's self-access rule.
 */
export const PRIVACY_HARDENING_PACK: PolicyPack = {
  id: 'privacy-hardening-pack',
  description:
    'Hardened privacy boundary. Self-access above low risk is blocked outright ' +
    '(not just require_approval), making the boundary fail-closed on correlation risk.',
  privacyBoundaryRules: [
    {
      id: 'hardened-research-self',
      sourceCompartmentId: 'research',
      targetCompartmentId: 'research',
      maxAllowedRisk: 'low',
      actionOnViolation: 'block'
    }
  ]
};

/**
 * trust-hardening-pack
 *
 * Conservative trust thresholds: lower baseline score, higher quarantine and
 * restriction bands, so compartments are penalised more quickly.
 */
export const TRUST_HARDENING_PACK: PolicyPack = {
  id: 'trust-hardening-pack',
  description:
    'Conservative trust thresholds. Baseline 65 (vs 70), quarantine at 29 (vs 19), ' +
    'restrict at 54 (vs 49). Compartments penalised more quickly.',
  trustPolicies: {
    enabled: true,
    baselineScore: 65,
    quarantinedThreshold: 29,
    restrictedThreshold: 54
  }
};

/** All built-in policy packs, in stable registration order. */
export const BUILT_IN_PACKS: readonly PolicyPack[] = [
  BALANCED_DEFAULT_PACK,
  STRICT_DEFENSE_PACK,
  STRICT_SANDBOX_PACK,
  RESEARCH_FLEX_PACK,
  DEVELOPMENT_LOW_FRICTION_PACK,
  PRIVACY_HARDENING_PACK,
  TRUST_HARDENING_PACK
];

// ---------------------------------------------------------------------------
// Built-in Runtime Profiles
// ---------------------------------------------------------------------------

/**
 * strict
 *
 * Aggressive deny-by-default posture:
 *   - Only low-risk `search` is allowed; approval required for every request
 *   - All anomalies escalate to temporary block (no cooldown)
 *   - Max path length 3, session reuse forbidden
 *   - Hardened privacy boundary (block on violation)
 *   - Conservative trust thresholds
 */
const STRICT_PROFILE: RuntimeProfile = {
  name: 'strict',
  description:
    'Aggressive deny-by-default. Frequent approvals, strict trust, strict sandbox, ' +
    'hardened privacy boundary, minimal session reuse.',
  packs: [
    'strict-defense-pack',
    'strict-sandbox-pack',
    'privacy-hardening-pack',
    'trust-hardening-pack'
  ],
  enabled: true
};

/**
 * balanced
 *
 * Default recommended profile. Mirrors the boot-time DEFAULT_RUNTIME_CONFIG
 * exactly: deny-by-default firewall, standard rate limits, standard adaptive
 * defence, bootstrap transport/privacy/trust/graph surface.
 */
const BALANCED_PROFILE: RuntimeProfile = {
  name: 'balanced',
  description:
    'Default recommended profile. Reasonable protections with usable UX. ' +
    'Mirrors the boot-time DEFAULT_RUNTIME_CONFIG exactly.',
  packs: ['balanced-default-pack'],
  enabled: true
};

/**
 * research
 *
 * Extends `balanced` and then overlays the research-flex-pack:
 *   - Inherits all balanced policies
 *   - Relaxes graph transitions (medium risk without approval)
 *   - More generous rate limits (20 req/min)
 *   - Lower quarantine/restriction thresholds (faster recovery)
 */
const RESEARCH_PROFILE: RuntimeProfile = {
  name: 'research',
  description:
    'Permissive exploration mode. Extends balanced with relaxed graph transitions ' +
    'at medium risk, more generous rate limits, and faster trust recovery.',
  extends: 'balanced',
  packs: ['research-flex-pack'],
  enabled: true
};

/**
 * development
 *
 * Minimal friction for local development:
 *   - Balanced defaults as base, then overridden by development-low-friction-pack
 *   - All tools up to medium risk, no confirmation required
 *   - 100 req/min; minimal adaptive defence
 *   - Sandbox always active (no real network/filesystem/process/browser)
 */
const DEVELOPMENT_PROFILE: RuntimeProfile = {
  name: 'development',
  description:
    'Minimal friction for local development. Balanced base then overridden: all tools ' +
    'up to medium risk, 100 req/min, permissive trust, sandbox always active.',
  packs: ['balanced-default-pack', 'development-low-friction-pack'],
  enabled: true
};

/** All built-in runtime profiles, in stable registration order. */
export const BUILT_IN_PROFILES: readonly RuntimeProfile[] = [
  STRICT_PROFILE,
  BALANCED_PROFILE,
  RESEARCH_PROFILE,
  DEVELOPMENT_PROFILE
];
