/**
 * SessionManager — in-memory, local-first session lifecycle for Identity
 * Compartments.
 *
 * The manager owns the full lifecycle of sessions belonging to registered
 * compartments:
 *
 *   active ──maxRequests / always_rotate──▶ rotated  (terminal)
 *   active ──TTL elapsed─────────────────▶ expired  (terminal)
 *   active ──revokeSession───────────────▶ revoked  (terminal)
 *
 * Design constraints (Sprint 7 MVP):
 *   - purely in-memory: no DB, no Redis, no persistence of any kind
 *   - no real network, no browser, no real transport — only metadata
 *   - deterministic transitions: terminal states never change again
 *   - strictly separate from the TransportAdapter layer: the manager decides
 *     *which session identity* an execution runs under, never how it connects
 *   - returned records are defensive copies; the canonical state is private
 */

import { randomUUID } from 'node:crypto';
import { SessionContext, TransportKind } from '../execution/types.js';
import {
  IdentityCompartment,
  SessionManagerConfig,
  SessionManagerErrorKind,
  SessionRecord
} from './types.js';

/** Typed error raised by {@link SessionManager} on a misuse. */
export class SessionManagerError extends Error {
  constructor(
    readonly kind: SessionManagerErrorKind,
    message: string
  ) {
    super(message);
    this.name = 'SessionManagerError';
  }
}

export interface SessionManagerOptions {
  /** Injectable clock for deterministic testing. Defaults to {@link Date.now}. */
  now?: () => number;
}

export class SessionManager {
  private readonly compartments = new Map<string, IdentityCompartment>();
  /** Canonical, mutable session state, keyed by session id. */
  private readonly sessions = new Map<string, SessionRecord>();
  /** Index of session ids per compartment, in creation order. */
  private readonly byCompartment = new Map<string, string[]>();
  private readonly config: SessionManagerConfig;
  private readonly now: () => number;

  constructor(config: SessionManagerConfig, options: SessionManagerOptions = {}) {
    this.config = config;
    this.now = options.now ?? Date.now;
  }

  /** Configuration defaults this manager was constructed with. */
  getConfig(): SessionManagerConfig {
    return { ...this.config };
  }

  /**
   * Register a compartment. Throws on a duplicate id — there is no implicit
   * overwrite, so a compartment's policy can never be silently replaced.
   */
  registerCompartment(compartment: IdentityCompartment): void {
    if (this.compartments.has(compartment.id)) {
      throw new SessionManagerError(
        'duplicate_compartment',
        `Compartment "${compartment.id}" is already registered.`
      );
    }
    this.compartments.set(compartment.id, { ...compartment });
    this.byCompartment.set(compartment.id, []);
  }

  /** Fetch a registered compartment, or `undefined` when none matches. */
  getCompartment(compartmentId: string): IdentityCompartment | undefined {
    const compartment = this.compartments.get(compartmentId);
    return compartment ? { ...compartment } : undefined;
  }

  /** List every registered compartment. Returns defensive copies. */
  listCompartments(): IdentityCompartment[] {
    return [...this.compartments.values()].map((c) => ({ ...c }));
  }

  /**
   * Get a reusable active session for the compartment, or mint a new one.
   *
   * Applies the compartment's {@link SessionReusePolicy}:
   *   - `reuse_active`  — reuse the active session when it is non-expired,
   *     non-revoked, and below `maxRequests`; otherwise rotate + create
   *   - `always_rotate` — rotate any active session and always create a new one
   *
   * Throws {@link SessionManagerError} (`unknown_compartment`) when the
   * compartment is not registered.
   */
  getOrCreateSession(compartmentId: string): SessionRecord {
    const compartment = this.requireCompartment(compartmentId);

    // Bring this compartment's sessions up to date (lazy TTL expiry) before any
    // reuse decision so a stale session can never be handed back.
    this.expireCompartment(compartmentId);

    if (compartment.reusePolicy === 'always_rotate') {
      this.markActiveAsRotated(compartmentId);
      return this.clone(this.createSession(compartment));
    }

    // reuse_active
    const active = this.findActive(compartmentId);
    if (active) {
      if (active.requestCount >= compartment.maxRequests) {
        // Request ceiling reached → rotate and mint a fresh session.
        active.status = 'rotated';
        return this.clone(this.createSession(compartment));
      }
      return this.clone(active);
    }

    return this.clone(this.createSession(compartment));
  }

  /**
   * Force a rotation: mark any active session of the compartment as `rotated`
   * and mint a fresh one. Throws when the compartment is unknown.
   */
  rotateSession(compartmentId: string): SessionRecord {
    const compartment = this.requireCompartment(compartmentId);
    this.expireCompartment(compartmentId);
    this.markActiveAsRotated(compartmentId);
    return this.clone(this.createSession(compartment));
  }

  /**
   * Revoke a session by id.
   *
   * An `active` session becomes `revoked`. Terminal sessions (`rotated`,
   * `expired`, `revoked`) are left untouched — revocation is idempotent on
   * terminal state. Throws when no session with that id exists.
   */
  revokeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SessionManagerError(
        'unknown_session',
        `Session "${sessionId}" does not exist.`
      );
    }
    this.applyExpiry(session);
    if (session.status === 'active') {
      session.status = 'revoked';
    }
  }

  /**
   * Transition every active session whose TTL has elapsed to `expired`.
   * Returns the number of sessions expired by this call.
   */
  expireOldSessions(): number {
    let expired = 0;
    for (const session of this.sessions.values()) {
      if (this.applyExpiry(session)) {
        expired += 1;
      }
    }
    return expired;
  }

  /**
   * List sessions, optionally filtered by compartment. Applies lazy TTL expiry
   * first so statuses are current, and returns defensive copies so callers can
   * never mutate the manager's internal state.
   */
  listSessions(compartmentId?: string): SessionRecord[] {
    if (compartmentId !== undefined) {
      this.expireCompartment(compartmentId);
      const ids = this.byCompartment.get(compartmentId) ?? [];
      return ids
        .map((id) => this.sessions.get(id))
        .filter((s): s is SessionRecord => s !== undefined)
        .map((s) => this.clone(s));
    }
    this.expireOldSessions();
    return [...this.sessions.values()].map((s) => this.clone(s));
  }

  /**
   * Record a use of a session: increment `requestCount` and stamp `lastUsedAt`.
   *
   * Applies lazy TTL expiry first. Throws {@link SessionManagerError}
   * (`unknown_session`) when the id is unknown, or (`session_not_active`) when
   * the session is expired, rotated, or revoked.
   */
  recordUse(sessionId: string): SessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SessionManagerError(
        'unknown_session',
        `Session "${sessionId}" does not exist.`
      );
    }
    this.applyExpiry(session);
    if (session.status !== 'active') {
      throw new SessionManagerError(
        'session_not_active',
        `Session "${sessionId}" is ${session.status} and cannot be used.`
      );
    }
    session.requestCount += 1;
    session.lastUsedAt = this.now();
    return this.clone(session);
  }

  /** Project a {@link SessionRecord} into the minimal execution-layer context. */
  toSessionContext(session: SessionRecord): SessionContext {
    return {
      sessionId: session.sessionId,
      compartmentId: session.compartmentId,
      transportKind: session.transportKind,
      createdAt: session.createdAt
    };
  }

  /** Total number of sessions tracked, regardless of status. */
  size(): number {
    return this.sessions.size;
  }

  private requireCompartment(compartmentId: string): IdentityCompartment {
    const compartment = this.compartments.get(compartmentId);
    if (!compartment) {
      throw new SessionManagerError(
        'unknown_compartment',
        `Compartment "${compartmentId}" is not registered.`
      );
    }
    return compartment;
  }

  private createSession(compartment: IdentityCompartment): SessionRecord {
    const createdAt = this.now();
    const record: SessionRecord = {
      sessionId: randomUUID(),
      compartmentId: compartment.id,
      transportKind: compartment.transportKind as TransportKind,
      status: 'active',
      createdAt,
      expiresAt: createdAt + compartment.ttlMs,
      requestCount: 0
    };
    this.sessions.set(record.sessionId, record);
    const ids = this.byCompartment.get(compartment.id);
    if (ids) {
      ids.push(record.sessionId);
    } else {
      this.byCompartment.set(compartment.id, [record.sessionId]);
    }
    return record;
  }

  /** Find the (single) active session of a compartment, if any. */
  private findActive(compartmentId: string): SessionRecord | undefined {
    const ids = this.byCompartment.get(compartmentId) ?? [];
    for (const id of ids) {
      const session = this.sessions.get(id);
      if (session && session.status === 'active') {
        return session;
      }
    }
    return undefined;
  }

  /** Mark every active session of a compartment as `rotated`. */
  private markActiveAsRotated(compartmentId: string): void {
    const ids = this.byCompartment.get(compartmentId) ?? [];
    for (const id of ids) {
      const session = this.sessions.get(id);
      if (session && session.status === 'active') {
        session.status = 'rotated';
      }
    }
  }

  /** Apply lazy TTL expiry to every active session of a compartment. */
  private expireCompartment(compartmentId: string): void {
    const ids = this.byCompartment.get(compartmentId) ?? [];
    for (const id of ids) {
      const session = this.sessions.get(id);
      if (session) {
        this.applyExpiry(session);
      }
    }
  }

  /**
   * Transition a session to `expired` when it is active and past its TTL.
   * Returns `true` when this call performed the transition.
   */
  private applyExpiry(session: SessionRecord): boolean {
    if (session.status === 'active' && this.now() >= session.expiresAt) {
      session.status = 'expired';
      return true;
    }
    return false;
  }

  /** Defensive shallow copy of a record handed back to callers. */
  private clone(session: SessionRecord): SessionRecord {
    return { ...session };
  }
}
