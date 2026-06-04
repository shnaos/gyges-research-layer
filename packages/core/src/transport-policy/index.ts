/**
 * Transport Routing & Isolation Policies MVP — public surface.
 *
 * Sprint 8 contracts and the deterministic TransportPolicyEngine. No real
 * network, browser, DNS, socket, or persistence behaviour is exposed here.
 */

export type {
  IsolationLevel,
  RoutingReason,
  IsolationPolicy,
  TransportPolicyRule,
  RoutingDecision,
  TransportPolicyErrorKind
} from './types.js';

export { TransportPolicyEngine, TransportPolicyError } from './engine.js';

export {
  BOOTSTRAP_SEARCH_RULE,
  BOOTSTRAP_FETCH_HTML_RULE,
  BOOTSTRAP_TRANSPORT_POLICY_RULES
} from './bootstrap.js';
