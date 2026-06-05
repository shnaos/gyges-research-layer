/**
 * IncidentDetector — turns {@link RuntimeAnomaly}s into {@link RuntimeIncident}s.
 *
 * Responsibilities (Sprint 12 MVP):
 *   - receive anomalies and auto-open incidents (`status: 'open'` by default)
 *   - aggregate the `relatedEventIds` (and `anomalyIds`) of the anomalies that
 *     contribute to the same incident
 *   - suppress exact immediate duplicates: an anomaly group that would produce
 *     an incident identical to an already-open one does not open a second
 *   - close an incident on demand
 *
 * Determinism & safety:
 *   - incident ids come from an injectable generator (defaults to a local UUID)
 *   - timestamps come from an injectable clock (defaults to {@link Date.now})
 *   - backed only by an in-memory {@link IncidentStore}; no network, no
 *     persistence, no AI/ML
 */

import { randomUUID } from 'node:crypto';
import { IncidentStore } from './store.js';
import {
  IncidentSeverity,
  IncidentStatus,
  RuntimeAnomaly,
  RuntimeIncident,
  SecurityScore
} from './types.js';

export interface IncidentDetectorOptions {
  /** Backing incident store. Defaults to a fresh in-memory {@link IncidentStore}. */
  store?: IncidentStore;
  /** Injectable clock. Defaults to {@link Date.now}. */
  now?: () => number;
  /** Injectable id generator. Defaults to {@link randomUUID}. */
  generateId?: () => string;
}

/** Ordered severities, least to most urgent, for "take the most severe" logic. */
const SEVERITY_ORDER: Record<IncidentSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2
};

/** Map an anomaly {@link SecurityScore} to an {@link IncidentSeverity}. */
function severityForScore(score: SecurityScore): IncidentSeverity {
  switch (score) {
    case 'critical':
      return 'critical';
    case 'high':
    case 'medium':
      return 'warning';
    case 'low':
    default:
      return 'info';
  }
}

/** Stable de-duplication signature of an incident's defining content. */
function incidentSignature(
  severity: IncidentSeverity,
  summary: string,
  relatedEventIds: readonly string[]
): string {
  return [severity, summary, [...relatedEventIds].sort().join(',')].join('|');
}

export class IncidentDetector {
  private readonly store: IncidentStore;
  private readonly now: () => number;
  private readonly generateId: () => string;

  constructor(options: IncidentDetectorOptions = {}) {
    this.store = options.store ?? new IncidentStore();
    this.now = options.now ?? Date.now;
    this.generateId = options.generateId ?? randomUUID;
  }

  /** The backing incident store (read/clear access for the host server). */
  get incidentStore(): IncidentStore {
    return this.store;
  }

  /**
   * Process a batch of anomalies into incidents.
   *
   * Anomalies are grouped by {@link RuntimeAnomaly.type}; each group yields at
   * most one incident, aggregating the anomaly ids and (de-duplicated) related
   * event ids of the whole group. A group whose resulting incident is identical
   * to an already-open one is suppressed (no duplicate). Returns the incidents
   * that were opened or matched, as defensive copies.
   */
  process(anomalies: RuntimeAnomaly[]): RuntimeIncident[] {
    const groups = new Map<string, RuntimeAnomaly[]>();
    for (const anomaly of anomalies) {
      const group = groups.get(anomaly.type) ?? [];
      group.push(anomaly);
      groups.set(anomaly.type, group);
    }

    const result: RuntimeIncident[] = [];
    for (const group of groups.values()) {
      const anomalyIds: string[] = [];
      const relatedEventIds: string[] = [];
      const seenEvents = new Set<string>();
      let severity: IncidentSeverity = 'info';
      for (const anomaly of group) {
        anomalyIds.push(anomaly.id);
        for (const eventId of anomaly.relatedEventIds) {
          if (!seenEvents.has(eventId)) {
            seenEvents.add(eventId);
            relatedEventIds.push(eventId);
          }
        }
        const candidate = severityForScore(anomaly.score);
        if (SEVERITY_ORDER[candidate] > SEVERITY_ORDER[severity]) {
          severity = candidate;
        }
      }

      const count = group.length;
      const summary = `Runtime incident: ${group[0].type} (${count} ${
        count === 1 ? 'anomaly' : 'anomalies'
      }).`;
      const signature = incidentSignature(severity, summary, relatedEventIds);

      // Suppress an exact immediate duplicate: an identical, still-open incident.
      const existing = this.store
        .list('open')
        .find(
          (incident) =>
            incidentSignature(
              incident.severity,
              incident.summary,
              incident.relatedEventIds
            ) === signature
        );
      if (existing) {
        result.push(existing);
        continue;
      }

      const now = this.now();
      const incident = this.store.append({
        id: this.generateId(),
        createdAt: now,
        updatedAt: now,
        severity,
        status: 'open',
        anomalyIds,
        relatedEventIds,
        summary
      });
      result.push(incident);
    }
    return result;
  }

  /** List incidents, optionally filtered by status. Defensive copies. */
  listIncidents(status?: IncidentStatus): RuntimeIncident[] {
    return this.store.list(status);
  }

  /** Fetch a single incident by id, or `undefined` when absent. */
  getIncident(id: string): RuntimeIncident | undefined {
    return this.store.getById(id);
  }

  /**
   * Close the incident with `id`, bumping its `updatedAt`. Throws when no
   * incident matches; callers wanting a soft check should use
   * {@link getIncident} first.
   */
  closeIncident(id: string): RuntimeIncident {
    return this.store.updateStatus(id, 'closed', this.now());
  }
}
