/**
 * Bootstrap transition rules and dependency-isolation policy for the Execution
 * Capability Graph MVP.
 *
 * These are the deterministic defaults the {@link CapabilityGraphEngine} and the
 * local server start with. They are pure, static configuration — no ML, no AI,
 * no semantic classification, no real network, no durable persistence.
 */

import {
  CapabilityTransitionRule,
  DependencyIsolationPolicy
} from './types.js';

/**
 * Default transition rules: the research path may flow
 * `search → fetch_html → fetch_json`, each step capped at `medium` risk and
 * diverting to human approval when that ceiling is exceeded. Any other tool
 * transition is unlisted and therefore blocked (deny-by-default).
 */
export const BOOTSTRAP_CAPABILITY_TRANSITION_RULES: readonly CapabilityTransitionRule[] =
  [
    {
      id: 'search-to-fetch-html',
      fromTool: 'search',
      toTool: 'fetch_html',
      maxAllowedRisk: 'medium',
      actionOnViolation: 'require_approval',
      enabled: true
    },
    {
      id: 'fetch-html-to-fetch-json',
      fromTool: 'fetch_html',
      toTool: 'fetch_json',
      maxAllowedRisk: 'medium',
      actionOnViolation: 'require_approval',
      enabled: true
    }
  ];

/**
 * Default dependency-isolation policy for the single static `research`
 * compartment: paths are capped at 5 capabilities, cross-tool escalation is
 * forbidden, every tool change needs approval, and any high-risk path is blocked.
 */
export const BOOTSTRAP_DEPENDENCY_ISOLATION_POLICY: DependencyIsolationPolicy = {
  id: 'research-default-dependency-isolation',
  compartmentId: 'research',
  maxPathLength: 5,
  forbidCrossToolEscalation: true,
  requireApprovalOnToolChange: true,
  blockOnHighRiskPath: true,
  enabled: true
};
