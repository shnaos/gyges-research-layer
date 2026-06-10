/**
 * Bootstrap transport policy rules.
 *
 * Both rules name `searxng` as the preferred transport — the only real
 * transport GRL ships. When SearXNG is not configured the execute endpoint
 * fails closed (denied) rather than falling back to mock.
 *
 * These rules are intentionally NOT compatible with the mock transport.
 * The execute-mock endpoint bypasses transport-kind enforcement and always
 * runs the MockTransportAdapter directly.
 */

import { TransportPolicyRule } from './types.js';

/**
 * Rule 1 — low-risk `search`.
 *
 * Routes to SearXNG. Session-scoped isolation, reuse permitted.
 */
export const BOOTSTRAP_SEARCH_RULE: TransportPolicyRule = {
  tool: 'search',
  riskLevel: 'low',
  preferredTransport: 'searxng',
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
 * Routes to SearXNG. Strict isolation, reuse forbidden.
 */
export const BOOTSTRAP_FETCH_HTML_RULE: TransportPolicyRule = {
  tool: 'fetch_html',
  riskLevel: 'medium',
  preferredTransport: 'searxng',
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
