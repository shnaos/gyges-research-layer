/**
 * Privacy Transport Relay & Network Isolation Layer — public API (Sprint 30).
 *
 * Logical, metadata-only relay/route abstraction. No real Tor, proxy, VPN,
 * SOCKS, DNS, browser, or network egress; no IP/host/URL/DNS/credential stored.
 */

export type {
  RelayIsolationLevel,
  RelayProfile,
  RelayRoute,
  NetworkCompartmentBinding,
  RelayAssignment,
  DnsIsolationPolicy,
  RelayRotationPolicy,
  RouteSelectionDecision,
  IsolationContext
} from './types.js';

export {
  DEFAULT_RELAY_ISOLATION_LEVEL,
  DEFAULT_MAX_ROUTES,
  DEFAULT_RELAY_PROFILE_ID,
  DEFAULT_DNS_ISOLATION_POLICY,
  DEFAULT_RELAY_ROTATION_POLICY
} from './types.js';

export { NetworkIsolationEngine } from './engine.js';
export type { NetworkIsolationEngineOptions } from './engine.js';
