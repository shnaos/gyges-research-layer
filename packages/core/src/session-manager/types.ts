/**
 * Session Manager & Identity Compartments MVP — core primitives and contracts.
 *
 * Sprint 7 introduces a first-class, in-memory Session Manager and formalises
 * Identity Compartments. These contracts describe *how* sessions are minted,
 * reused, rotated, expired, and revoked for a given compartment — but carry NO
 * real network, browser, or persistence behaviour.
 *
 * The types are deliberately self-contained and agnostic: no coupling to any
 * specific business product, persistence, browser, or real transport
 * implementation. The Session Manager is strictly separate from the
 * TransportAdapter layer — it only decides *which session identity* an
 * execution runs under; it never opens a connection.
 */

import { TransportKind } from '../execution/types.js';

/**
 * Lifecycle status of a {@link SessionRecord}.
 *
 * A session starts as `active` and reaches exactly one terminal state:
 * `rotated`, `expired`, or `revoked`. Terminal states never transition again.
 *
 * - `active`  — usable; may be reused or recorded against
 * - `rotated` — superseded by a newer session (reuse limit hit or always_rotate)
 * - `expired` — its TTL elapsed before it was rotated or revoked
 * - `revoked` — explicitly invalidated by {@link SessionManager.revokeSession}
 */
export type SessionStatus = 'active' | 'rotated' | 'expired' | 'revoked';

/**
 * Strategy deciding whether {@link SessionManager.getOrCreateSession} reuses an
 * existing active session or always mints a fresh one.
 *
 * - `reuse_active`  — reuse a session that is active, non-expired, non-revoked,
 *   and below its request ceiling; otherwise create a new one
 * - `always_rotate` — create a new session on every request, marking any prior
 *   active session as `rotated`
 */
export type SessionReusePolicy = 'reuse_active' | 'always_rotate';

/**
 * Rotation thresholds that drive a session out of the `active` state.
 *
 * These are derived from the owning {@link IdentityCompartment}; they describe
 * the time-to-live and the maximum number of recorded uses before a session
 * must be rotated. They are surfaced as a named contract so future transports
 * (Tor/proxy/SearXNG/browser) can reason about rotation uniformly.
 */
export interface SessionRotationPolicy {
  /** Maximum lifetime of a session, in milliseconds, before it expires. */
  ttlMs: number;
  /** Maximum number of recorded uses before a session is rotated. */
  maxRequests: number;
}

/**
 * An Identity Compartment: a named isolation boundary that owns sessions.
 *
 * A compartment groups sessions that share a transport kind and a reuse/rotation
 * policy. It carries NO secrets, credentials, or real transport configuration —
 * only the metadata needed to mint and rotate sessions deterministically.
 */
export interface IdentityCompartment {
  id: string;
  label?: string;
  transportKind: TransportKind;
  reusePolicy: SessionReusePolicy;
  ttlMs: number;
  maxRequests: number;
  createdAt: number;
}

/**
 * A single session minted for a compartment.
 *
 * This is the public, shareable shape of a session. It carries NO secret token,
 * credential, or transport handle — only metadata describing the session's
 * identity and lifecycle. It maps cleanly to a `SessionContext` for execution.
 */
export interface SessionRecord {
  sessionId: string;
  compartmentId: string;
  transportKind: TransportKind;
  status: SessionStatus;
  createdAt: number;
  expiresAt: number;
  requestCount: number;
  lastUsedAt?: number;
}

/** Default configuration for a {@link SessionManager}. */
export interface SessionManagerConfig {
  /** Default session TTL (ms) for compartments that omit one. */
  defaultTtlMs: number;
  /** Default maximum recorded uses for compartments that omit one. */
  defaultMaxRequests: number;
}

/**
 * Reason a {@link SessionManager} operation could not complete.
 *
 * Surfaced as a typed error class so callers can distinguish a genuine misuse
 * (unknown compartment/session, duplicate registration, terminal session) from
 * an unexpected failure.
 */
export type SessionManagerErrorKind =
  | 'unknown_compartment'
  | 'duplicate_compartment'
  | 'unknown_session'
  | 'session_not_active';
