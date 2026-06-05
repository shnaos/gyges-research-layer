/**
 * IncidentStore — deterministic, in-memory store for {@link RuntimeIncident}s.
 *
 * Responsibilities (Sprint 12 MVP):
 *   - append an already-built {@link RuntimeIncident}
 *   - list incidents, optionally filtered by {@link IncidentStatus}
 *   - look an incident up by id
 *   - update an incident's status (open ↔ closed)
 *   - clear / report size
 *
 * Strict non-goals: it is purely in-memory and side-effect free. It NEVER
 * touches a database, NEVER writes a file, NEVER opens a socket / DNS / network
 * connection, NEVER spawns a process, and NEVER performs cloud logging. There is
 * no durable persistence of any kind.
 *
 * Determinism & immutability:
 *   - stable ordering: results are returned in insertion order
 *   - defensive copies: stored and returned incidents are deep-cloned, so a
 *     caller can never mutate internal state through a held reference, and a
 *     later mutation of the caller's object can never reach the store
 */

import { IncidentStatus, RuntimeIncident } from './types.js';

/** Deep-clone a {@link RuntimeIncident}, including its id arrays. */
export function cloneIncident(incident: RuntimeIncident): RuntimeIncident {
  return {
    id: incident.id,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
    severity: incident.severity,
    status: incident.status,
    anomalyIds: [...incident.anomalyIds],
    relatedEventIds: [...incident.relatedEventIds],
    summary: incident.summary
  };
}

export class IncidentStore {
  /** Canonical incident state, in insertion order. */
  private readonly incidents: RuntimeIncident[] = [];

  /**
   * Append an incident. The incident is deep-cloned on the way in, so a later
   * mutation of the caller's object can never affect the store. Returns a
   * defensive copy of the stored incident.
   */
  append(incident: RuntimeIncident): RuntimeIncident {
    const stored = cloneIncident(incident);
    this.incidents.push(stored);
    return cloneIncident(stored);
  }

  /**
   * List incidents, optionally filtered by `status`, in stable insertion
   * order. Returns deep copies — never internal state.
   */
  list(status?: IncidentStatus): RuntimeIncident[] {
    return this.incidents
      .filter((incident) => status === undefined || incident.status === status)
      .map(cloneIncident);
  }

  /** Return a deep copy of the incident with `id`, or `undefined` when absent. */
  getById(id: string): RuntimeIncident | undefined {
    const stored = this.incidents.find((incident) => incident.id === id);
    return stored ? cloneIncident(stored) : undefined;
  }

  /**
   * Update the status of the incident with `id` and bump its `updatedAt` to
   * `now`. Returns a defensive copy of the updated incident.
   *
   * Throws when no incident matches `id`; callers that need a soft check should
   * use {@link getById} first.
   */
  updateStatus(
    id: string,
    status: IncidentStatus,
    now: number = Date.now()
  ): RuntimeIncident {
    const stored = this.incidents.find((incident) => incident.id === id);
    if (!stored) {
      throw new Error(`Unknown incident: ${id}`);
    }
    stored.status = status;
    stored.updatedAt = now;
    return cloneIncident(stored);
  }

  /** Remove every stored incident. */
  clear(): void {
    this.incidents.length = 0;
  }

  /** Number of stored incidents. */
  size(): number {
    return this.incidents.length;
  }
}
