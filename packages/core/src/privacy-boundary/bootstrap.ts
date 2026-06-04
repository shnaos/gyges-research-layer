/**
 * Bootstrap privacy boundary rules for the MVP.
 *
 * These are the deterministic rules the local server starts with. They are pure
 * metadata: no secrets, no real transport configuration, no compartment data.
 * The single bootstrap rule authorises self-access within the `research`
 * compartment up to `low` correlation risk; anything beyond is escalated to the
 * human approval queue.
 */

import { PrivacyBoundaryRule } from './types.js';

/**
 * Rule — `research` self-access.
 *
 * - `research` -> `research` at `low` risk     → allow
 * - `research` -> `research` above `low`        → require_approval (escalation)
 * - `unknown`  -> `research` / `research` -> X  → fail-closed block (no rule)
 */
export const BOOTSTRAP_RESEARCH_SELF_RULE: PrivacyBoundaryRule = {
  id: 'research-self',
  sourceCompartmentId: 'research',
  targetCompartmentId: 'research',
  maxAllowedRisk: 'low',
  actionOnViolation: 'require_approval'
};

/** The full set of bootstrap rules, in registration order. */
export const BOOTSTRAP_PRIVACY_BOUNDARY_RULES: readonly PrivacyBoundaryRule[] = [
  BOOTSTRAP_RESEARCH_SELF_RULE
];
