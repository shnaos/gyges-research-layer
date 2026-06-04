/**
 * Bootstrap transport policy rules for the MVP.
 *
 * These are the deterministic rules the local server starts with. They are pure
 * metadata: no secrets, no real transport configuration. Only the `mock`
 * transport is referenced — Sprint 8 performs no real network I/O.
 */

import { TransportPolicyRule } from './types.js';

/**
 * Rule 1 — low-risk `search`.
 *
 * Session-scoped isolation, reuse permitted, high-risk requests would rotate.
 * A low-risk `search` therefore reuses its session (`reuse_allowed`).
 */
export const BOOTSTRAP_SEARCH_RULE: TransportPolicyRule = {
  tool: 'search',
  riskLevel: 'low',
  preferredTransport: 'mock',
  isolationPolicy: {
    level: 'session',
    forceRotateOnHighRisk: true,
    forbidSessionReuse: false,
    allowCrossToolReuse: true
  }
};

/**
 * Rule 2 — medium-risk `fetch_html`.
 *
 * Strict isolation with reuse forbidden: every routed execution forces a fresh
 * session (`forced_rotation`) and is reported at `strict` isolation level.
 */
export const BOOTSTRAP_FETCH_HTML_RULE: TransportPolicyRule = {
  tool: 'fetch_html',
  riskLevel: 'medium',
  preferredTransport: 'mock',
  isolationPolicy: {
    level: 'strict',
    forceRotateOnHighRisk: true,
    forbidSessionReuse: true,
    allowCrossToolReuse: false
  }
};

/** The full set of bootstrap rules, in registration order. */
export const BOOTSTRAP_TRANSPORT_POLICY_RULES: readonly TransportPolicyRule[] = [
  BOOTSTRAP_SEARCH_RULE,
  BOOTSTRAP_FETCH_HTML_RULE
];
