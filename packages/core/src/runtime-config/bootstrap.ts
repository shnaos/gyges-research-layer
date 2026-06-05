/**
 * Fallback bootstrap runtime configuration.
 *
 * {@link DEFAULT_RUNTIME_CONFIG} is the in-memory fallback the local server uses
 * when no `GRL_CONFIG_PATH` is provided (or the file is absent). It mirrors,
 * exactly, the previously hard-coded Sprint 3–15 bootstrap constants so the
 * server's behaviour is identical whether it boots from this fallback or from a
 * file describing the same policies.
 *
 * It is pure, static, secret-free data — no network, no persistence, no AI.
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
import { RuntimeConfig } from './types.js';
import { deepClone } from './snapshot.js';

/**
 * The single fallback config. Every policy slice reproduces the corresponding
 * Sprint 3–15 bootstrap constant:
 *
 *  - one `research` compartment
 *  - the firewall's deny-by-default low-risk allowance plus the medium-risk
 *    `fetch_html` confirmation rule
 *  - the bootstrap transport / privacy / adaptive-defense / rate-limit policies
 *  - the trust baseline (neutral 70, restricted ≤49, quarantined ≤19)
 *  - the bootstrap graph transition rules and the `research` isolation policy
 *  - the fully-sandboxed `mock` transport surface
 */
export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  version: 1,
  compartments: [
    {
      id: 'research',
      description: 'Default research compartment',
      enabled: true
    }
  ],
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
  transportPolicies: deepClone([...BOOTSTRAP_TRANSPORT_POLICY_RULES]),
  privacyBoundaryRules: deepClone([...BOOTSTRAP_PRIVACY_BOUNDARY_RULES]),
  adaptiveDefensePolicies: deepClone([...BOOTSTRAP_ADAPTIVE_DEFENSE_POLICIES]),
  rateLimitPolicies: deepClone([...BOOTSTRAP_RATE_LIMIT_POLICIES]),
  trustPolicies: {
    enabled: true,
    baselineScore: 70,
    quarantinedThreshold: 19,
    restrictedThreshold: 49
  },
  graphTransitionRules: deepClone([...BOOTSTRAP_CAPABILITY_TRANSITION_RULES]),
  isolationPolicies: [deepClone(BOOTSTRAP_DEPENDENCY_ISOLATION_POLICY)],
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
