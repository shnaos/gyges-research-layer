/**
 * AuditStore — deterministic, in-memory store for {@link SecurityEvent}s.
 *
 * Responsibilities (Sprint 11 MVP):
 *   - append an already-stamped {@link SecurityEvent} (id + timestamp set by the
 *     {@link SecurityEventEngine})
 *   - list events with an optional {@link AuditQuery} (AND semantics)
 *   - look an event up by id
 *   - clear / report size
 *
 * Strict non-goals: it is purely in-memory and side-effect free. It NEVER
 * touches a database, NEVER writes a file, NEVER opens a socket / DNS / network
 * connection, NEVER spawns a process, and NEVER performs cloud logging. There is
 * no durable persistence of any kind.
 *
 * Determinism & immutability:
 *   - stable ordering: results are sorted by `timestamp` ascending, then by
 *     insertion order for ties
 *   - defensive copies: stored and returned events are deep-cloned, so a caller
 *     can never mutate internal state through a reference it holds, and a later
 *     mutation of the caller's object can never reach the store
 */

import { AuditQuery, SecurityEvent } from './types.js';

/** Deep-clone a {@link SecurityEvent}, including its `metadata`. */
function cloneEvent(event: SecurityEvent): SecurityEvent {
  const clone: SecurityEvent = {
    id: event.id,
    timestamp: event.timestamp,
    type: event.type,
    severity: event.severity,
    message: event.message
  };
  if (event.agentId !== undefined) clone.agentId = event.agentId;
  if (event.compartmentId !== undefined) clone.compartmentId = event.compartmentId;
  if (event.sessionId !== undefined) clone.sessionId = event.sessionId;
  if (event.requestId !== undefined) clone.requestId = event.requestId;
  if (event.executionId !== undefined) clone.executionId = event.executionId;
  if (event.approvalRequestId !== undefined) {
    clone.approvalRequestId = event.approvalRequestId;
  }
  if (event.metadata !== undefined) {
    clone.metadata = structuredClone(event.metadata);
  }
  return clone;
}

/** Internal record pairing a stored event with its monotonic insertion index. */
interface StoredEvent {
  event: SecurityEvent;
  seq: number;
}

export class AuditStore {
  /** Canonical event state, in insertion order. */
  private readonly events: StoredEvent[] = [];
  /** Monotonic insertion counter used to break `timestamp` ties stably. */
  private seq = 0;

  /**
   * Append an event. The event is deep-cloned on the way in, so a later
   * mutation of the caller's object can never affect the store. Returns a
   * defensive copy of the stored event.
   */
  append(event: SecurityEvent): SecurityEvent {
    const stored = cloneEvent(event);
    this.events.push({ event: stored, seq: this.seq++ });
    return cloneEvent(stored);
  }

  /**
   * List events matching the optional query, in stable order (`timestamp`
   * ascending, then insertion). Returns deep copies — never internal state.
   */
  list(query: AuditQuery = {}): SecurityEvent[] {
    const matched = this.events.filter((stored) => matches(stored.event, query));
    matched.sort(
      (a, b) => a.event.timestamp - b.event.timestamp || a.seq - b.seq
    );
    let result = matched.map((stored) => cloneEvent(stored.event));
    if (query.limit !== undefined) {
      result = result.slice(0, Math.max(0, query.limit));
    }
    return result;
  }

  /** Return a deep copy of the event with `id`, or `undefined` when absent. */
  getById(id: string): SecurityEvent | undefined {
    const stored = this.events.find((entry) => entry.event.id === id);
    return stored ? cloneEvent(stored.event) : undefined;
  }

  /** Remove every stored event. */
  clear(): void {
    this.events.length = 0;
  }

  /** Number of stored events. */
  size(): number {
    return this.events.length;
  }
}

/** Whether an event satisfies every constraint in the query (AND semantics). */
function matches(event: SecurityEvent, query: AuditQuery): boolean {
  if (query.type !== undefined && event.type !== query.type) return false;
  if (query.severity !== undefined && event.severity !== query.severity) {
    return false;
  }
  if (query.agentId !== undefined && event.agentId !== query.agentId) {
    return false;
  }
  if (
    query.compartmentId !== undefined &&
    event.compartmentId !== query.compartmentId
  ) {
    return false;
  }
  if (query.sessionId !== undefined && event.sessionId !== query.sessionId) {
    return false;
  }
  if (query.requestId !== undefined && event.requestId !== query.requestId) {
    return false;
  }
  if (
    query.executionId !== undefined &&
    event.executionId !== query.executionId
  ) {
    return false;
  }
  if (query.since !== undefined && event.timestamp < query.since) return false;
  if (query.until !== undefined && event.timestamp > query.until) return false;
  return true;
}
