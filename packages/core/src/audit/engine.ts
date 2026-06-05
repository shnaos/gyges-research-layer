/**
 * SecurityEventEngine — the runtime façade that stamps and records
 * {@link SecurityEvent}s into an {@link AuditStore}.
 *
 * Responsibilities (Sprint 11 MVP):
 *   - assign each emitted event a unique `id` and a `timestamp`
 *   - persist it (in-memory only) into the backing {@link AuditStore}
 *   - expose read access (`query`, `getEvent`) and a `clear`
 *
 * Determinism & safety:
 *   - the id generator and clock are injectable, so tests are fully
 *     deterministic; by default a local UUID and {@link Date.now} are used
 *   - the caller's `metadata` is never mutated — it is deep-cloned before the
 *     event is stamped, so the engine has no observable side effect on inputs
 *   - no external dependency, no network, no persistence beyond the in-memory
 *     store
 */

import { randomUUID } from 'node:crypto';
import { AuditStore } from './store.js';
import { AuditQuery, SecurityEvent } from './types.js';

export interface SecurityEventEngineOptions {
  /** Injectable clock for deterministic timestamps. Defaults to {@link Date.now}. */
  now?: () => number;
  /** Injectable id generator. Defaults to {@link randomUUID}. */
  generateId?: () => string;
  /** Backing store. Defaults to a fresh in-memory {@link AuditStore}. */
  store?: AuditStore;
}

export class SecurityEventEngine {
  private readonly store: AuditStore;
  private readonly now: () => number;
  private readonly generateId: () => string;

  constructor(options: SecurityEventEngineOptions = {}) {
    this.store = options.store ?? new AuditStore();
    this.now = options.now ?? Date.now;
    this.generateId = options.generateId ?? randomUUID;
  }

  /**
   * Stamp and record a security event.
   *
   * The input carries everything except `id` and `timestamp`, which the engine
   * assigns. Any `metadata` is deep-cloned so the caller's object is never
   * mutated and never aliased into the store. Returns a defensive copy of the
   * stored event.
   */
  emit(input: Omit<SecurityEvent, 'id' | 'timestamp'>): SecurityEvent {
    const event: SecurityEvent = {
      id: this.generateId(),
      timestamp: this.now(),
      type: input.type,
      severity: input.severity,
      message: input.message
    };
    if (input.agentId !== undefined) event.agentId = input.agentId;
    if (input.compartmentId !== undefined) event.compartmentId = input.compartmentId;
    if (input.sessionId !== undefined) event.sessionId = input.sessionId;
    if (input.requestId !== undefined) event.requestId = input.requestId;
    if (input.executionId !== undefined) event.executionId = input.executionId;
    if (input.approvalRequestId !== undefined) {
      event.approvalRequestId = input.approvalRequestId;
    }
    if (input.metadata !== undefined) {
      event.metadata = structuredClone(input.metadata);
    }
    return this.store.append(event);
  }

  /** Query recorded events. Returns defensive copies in stable order. */
  query(query: AuditQuery = {}): SecurityEvent[] {
    return this.store.list(query);
  }

  /** Fetch a single recorded event by id, or `undefined` when absent. */
  getEvent(id: string): SecurityEvent | undefined {
    return this.store.getById(id);
  }

  /** Drop every recorded event. */
  clear(): void {
    this.store.clear();
  }

  /** Number of recorded events. */
  size(): number {
    return this.store.size();
  }
}
