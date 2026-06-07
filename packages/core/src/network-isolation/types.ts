/**
 * Privacy Transport Relay & Network Isolation Layer — types (Sprint 30).
 *
 * GRL's first network-privacy layer. It introduces a purely **logical** relay /
 * route abstraction whose only purpose is to reduce *unnecessary* cross-
 * correlation between outbound research activities (cross-persona interest
 * aggregation, implicit route reuse, trivially stable network signatures).
 *
 * HARD CONSTRAINTS — enforced by construction:
 *  - This is metadata only. There is NO real Tor, proxy, VPN, SOCKS, DNS
 *    resolver, browser, cloud relay, or network egress anywhere in this module.
 *  - It NEVER stores an IP, host, URL, DNS name, endpoint, credential, token,
 *    secret, or raw caller input. Relays and routes are opaque local
 *    identifiers and structural metadata only.
 *  - Purely in-memory, deterministic, fail-closed.
 *  - No AI/ML/NLP, no persistence, no DB/Redis, no websocket/SSE.
 *
 * GRL is NOT an anonymity network, NOT a Tor replacement, and makes NO promise
 * of invisibility, anti-forensics, or anti-detection. See
 * `docs/network-isolation.md`.
 */

/**
 * How strongly a relay separates outbound activity.
 *
 * - `shared`   — the route may be shared across compartments (least isolation).
 * - `isolated` — the route is bound to a single compartment (default).
 * - `strict`   — the route is bound to a single compartment AND rotated
 *                aggressively on any persona / category / risk change.
 */
export type RelayIsolationLevel = 'shared' | 'isolated' | 'strict';

/**
 * A logical relay profile. Opaque, local-only metadata — it carries NO host,
 * IP, URL, DNS name, or credential, and represents no real network endpoint.
 */
export interface RelayProfile {
  id: string;
  name: string;
  enabled: boolean;
  isolationLevel: RelayIsolationLevel;
  /** Whether this relay can carry per-scope DNS isolation metadata. */
  supportsDnsIsolation: boolean;
  tags: string[];
  createdAt: number;
}

/**
 * A logical route through a relay profile, optionally bound to a compartment /
 * persona / fragment scope. A route is an opaque local identifier — it is NOT a
 * connection, socket, circuit, or endpoint.
 */
export interface RelayRoute {
  id: string;
  relayProfileId: string;
  compartmentId?: string;
  personaId?: string;
  fragmentId?: string;
  assignedAt: number;
  active: boolean;
}

/**
 * A stable binding of a compartment to a relay route. Prevents cross-compartment
 * route reuse and gives each compartment a deterministic logical route.
 */
export interface NetworkCompartmentBinding {
  compartmentId: string;
  relayRouteId: string;
  isolationLevel: RelayIsolationLevel;
  createdAt: number;
}

/**
 * The result of assigning (or rotating to) a route. Structural metadata only.
 */
export interface RelayAssignment {
  routeId: string;
  relayProfileId: string;
  compartmentId: string;
  personaId?: string;
  fragmentId?: string;
  isolationLevel: RelayIsolationLevel;
  /** How many times this compartment's route has been (re)assigned. */
  assignmentCount: number;
  assignedAt: number;
  /** Whether this assignment replaced a prior active route (a rotation). */
  rotated: boolean;
}

/**
 * DNS isolation policy — METADATA MODEL ONLY.
 *
 * GRL performs NO real DNS resolution and ships no resolver. This policy only
 * records the operator's intent and drives runtime decisions / auditability.
 */
export interface DnsIsolationPolicy {
  enabled: boolean;
  isolatePerCompartment: boolean;
  isolatePerPersona: boolean;
  isolatePerFragment: boolean;
}

/**
 * When a compartment's logical route should be rotated.
 */
export interface RelayRotationPolicy {
  enabled: boolean;
  rotateOnPersonaChange: boolean;
  rotateOnCategoryChange: boolean;
  rotateOnCriticalRisk: boolean;
  /** Rotate once a route has been (re)used this many times. */
  maxAssignmentsPerRoute: number;
}

/**
 * The deterministic decision produced by {@link NetworkIsolationEngine.evaluateIsolation}.
 */
export interface RouteSelectionDecision {
  allowed: boolean;
  relayProfileId?: string;
  relayRouteId?: string;
  isolationLevel: RelayIsolationLevel;
  shouldRotate: boolean;
  reason: string;
}

/**
 * Context for a route resolution / isolation evaluation. Carries scope
 * identifiers and runtime signals only — never raw input, hosts, or secrets.
 */
export interface IsolationContext {
  compartmentId: string;
  personaId?: string;
  fragmentId?: string;
  /** The research category changed for this compartment since the last request. */
  categoryChanged?: boolean;
  /** A persona rotation occurred for this request. */
  personaRotated?: boolean;
  /** A critical behavioral / privacy risk was raised for this request. */
  criticalRisk?: boolean;
  /** Whether the outbound transport is enabled. Defaults to true. */
  transportEnabled?: boolean;
  /** Whether the compartment is quarantined. Defaults to false. */
  quarantined?: boolean;
  /** Requested isolation level override. Defaults to the relay profile's level. */
  isolationLevel?: RelayIsolationLevel;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default isolation level applied to a fresh compartment route. */
export const DEFAULT_RELAY_ISOLATION_LEVEL: RelayIsolationLevel = 'isolated';

/** Default upper bound on retained routes (FIFO eviction of inactive routes). */
export const DEFAULT_MAX_ROUTES = 500;

/** The bootstrap local relay profile id. */
export const DEFAULT_RELAY_PROFILE_ID = 'local-default';

/** Default DNS isolation policy (metadata model only). */
export const DEFAULT_DNS_ISOLATION_POLICY: DnsIsolationPolicy = {
  enabled: true,
  isolatePerCompartment: true,
  isolatePerPersona: false,
  isolatePerFragment: false
};

/** Default relay rotation policy. */
export const DEFAULT_RELAY_ROTATION_POLICY: RelayRotationPolicy = {
  enabled: true,
  rotateOnPersonaChange: true,
  rotateOnCategoryChange: true,
  rotateOnCriticalRisk: true,
  maxAssignmentsPerRoute: 50
};
