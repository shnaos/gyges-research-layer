/**
 * RuntimeSecurityHeuristicsEngine — deterministic, static behavioural detection.
 *
 * The engine is a passive observer. It {@link ingest}s the normalised
 * {@link SecurityEvent}s emitted across the request lifecycle, keeps a bounded
 * in-memory history, and applies a set of static {@link HeuristicRule}s over a
 * sliding time window. When a rule's `threshold` of matching events is reached
 * within its `timeWindowMs`, a {@link RuntimeAnomaly} is raised.
 *
 * Determinism & safety:
 *   - purely local, no ML / AI / semantic classification — only counting
 *   - an anomaly is raised exactly once per threshold crossing (the event that
 *     brings the in-window count up to `threshold`), keeping output stable and
 *     non-noisy
 *   - the reference time for the window is the ingested event's own
 *     `timestamp`, so detection never depends on a wall clock and is fully
 *     reproducible from an event sequence
 *   - anomaly ids come from an injectable generator (defaults to a local UUID)
 *   - no network, no persistence beyond the in-memory history
 */

import { randomUUID } from 'node:crypto';
import { SecurityEvent, SecurityEventType } from '../audit/types.js';
import {
  ANOMALY_EVENT_TYPES,
  HeuristicRule,
  IncidentSeverity,
  RuntimeAnomaly,
  SecurityScore
} from './types.js';

export interface RuntimeSecurityHeuristicsEngineOptions {
  /** Injectable id generator for anomalies. Defaults to {@link randomUUID}. */
  generateId?: () => string;
}

/** Minimal, secret-free projection of an event kept in the sliding history. */
interface ObservedEvent {
  id: string;
  timestamp: number;
  type: SecurityEventType;
}

/** Map a rule severity to the coarse anomaly {@link SecurityScore}. */
function scoreForSeverity(severity: IncidentSeverity): SecurityScore {
  switch (severity) {
    case 'critical':
      return 'critical';
    case 'warning':
      return 'high';
    case 'info':
    default:
      return 'low';
  }
}

export class RuntimeSecurityHeuristicsEngine {
  private readonly rules: HeuristicRule[] = [];
  private readonly history: ObservedEvent[] = [];
  private readonly anomalies: RuntimeAnomaly[] = [];
  private readonly generateId: () => string;

  constructor(options: RuntimeSecurityHeuristicsEngineOptions = {}) {
    this.generateId = options.generateId ?? randomUUID;
  }

  /**
   * Register a heuristic rule. Rule ids are unique: registering a rule whose id
   * is already present throws, so the rule set stays unambiguous.
   */
  registerRule(rule: HeuristicRule): void {
    if (this.rules.some((existing) => existing.id === rule.id)) {
      throw new Error(`Duplicate heuristic rule id: ${rule.id}`);
    }
    this.rules.push({ ...rule });
  }

  /** List the registered rules. Returns defensive copies in registration order. */
  listRules(): HeuristicRule[] {
    return this.rules.map((rule) => ({ ...rule }));
  }

  /** Remove every registered rule. The event history is left untouched. */
  clearRules(): void {
    this.rules.length = 0;
  }

  /**
   * Ingest one security event and return any anomalies it triggers.
   *
   * The event is projected to a minimal, secret-free record and appended to the
   * sliding history. Every enabled rule whose watched event types include the
   * event's type is then evaluated against the window ending at the event's
   * timestamp. A rule fires only on the exact threshold crossing.
   *
   * The caller's event object is never mutated.
   */
  ingest(event: SecurityEvent): RuntimeAnomaly[] {
    const observed: ObservedEvent = {
      id: event.id,
      timestamp: event.timestamp,
      type: event.type
    };
    this.history.push(observed);

    const triggered: RuntimeAnomaly[] = [];
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      const watched = ANOMALY_EVENT_TYPES[rule.anomalyType];
      if (!watched.includes(event.type)) continue;

      const windowStart = observed.timestamp - rule.timeWindowMs;
      const matches = this.history.filter(
        (entry) =>
          watched.includes(entry.type) &&
          entry.timestamp >= windowStart &&
          entry.timestamp <= observed.timestamp
      );

      // Fire exactly once, when this event brings the in-window count up to the
      // threshold. A count below the threshold (or already beyond it) is silent.
      if (matches.length !== rule.threshold) continue;

      const anomaly: RuntimeAnomaly = {
        id: this.generateId(),
        createdAt: observed.timestamp,
        type: rule.anomalyType,
        score: scoreForSeverity(rule.severity),
        relatedEventIds: matches.map((entry) => entry.id),
        summary: `${rule.name}: ${matches.length} ${event.type} event(s) within ${rule.timeWindowMs}ms.`,
        metadata: {
          ruleId: rule.id,
          anomalyType: rule.anomalyType,
          eventType: event.type,
          watchedEventTypes: [...watched],
          matchedCount: matches.length,
          threshold: rule.threshold,
          timeWindowMs: rule.timeWindowMs,
          severity: rule.severity
        }
      };
      this.anomalies.push(anomaly);
      triggered.push(anomaly);
    }
    return triggered.map(cloneAnomaly);
  }

  /** Return every anomaly raised so far, in detection order (defensive copies). */
  queryAnomalies(): RuntimeAnomaly[] {
    return this.anomalies.map(cloneAnomaly);
  }

  /** Drop every raised anomaly. The rule set and history are left untouched. */
  clearAnomalies(): void {
    this.anomalies.length = 0;
  }

  /** Drop the sliding event history (e.g. between independent test cases). */
  clearHistory(): void {
    this.history.length = 0;
  }
}

/** Deep-clone a {@link RuntimeAnomaly}, including its arrays and metadata. */
function cloneAnomaly(anomaly: RuntimeAnomaly): RuntimeAnomaly {
  const clone: RuntimeAnomaly = {
    id: anomaly.id,
    createdAt: anomaly.createdAt,
    type: anomaly.type,
    score: anomaly.score,
    relatedEventIds: [...anomaly.relatedEventIds],
    summary: anomaly.summary
  };
  if (anomaly.metadata !== undefined) {
    clone.metadata = structuredClone(anomaly.metadata);
  }
  return clone;
}
