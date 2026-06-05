import { beforeEach, describe, expect, it } from 'vitest';
import {
  BOOTSTRAP_HEURISTIC_RULES,
  HeuristicRule,
  IncidentDetector,
  IncidentStore,
  RuntimeAnomaly,
  RuntimeSecurityHeuristicsEngine,
  SecurityEvent,
  SecurityEventType
} from '../src/index.js';

/** Build a minimal stamped security event for engine tests. */
function event(
  type: SecurityEventType,
  overrides: Partial<SecurityEvent> = {}
): SecurityEvent {
  return {
    id: overrides.id ?? `e-${Math.random().toString(36).slice(2)}`,
    timestamp: overrides.timestamp ?? 1000,
    type,
    severity: overrides.severity ?? 'warning',
    message: overrides.message ?? type,
    ...overrides
  };
}

/** A deterministic, incrementing id generator. */
function seqIds(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${n++}`;
}

const DENIED_RULE: HeuristicRule = {
  id: 'repeated-denied',
  name: 'Repeated denied capabilities',
  anomalyType: 'repeated_denied_capabilities',
  threshold: 3,
  timeWindowMs: 60_000,
  severity: 'warning',
  enabled: true
};

describe('RuntimeSecurityHeuristicsEngine — rules', () => {
  let engine: RuntimeSecurityHeuristicsEngine;
  beforeEach(() => {
    engine = new RuntimeSecurityHeuristicsEngine({ generateId: seqIds('a') });
  });

  it('registers a rule and lists it', () => {
    engine.registerRule(DENIED_RULE);
    expect(engine.listRules()).toHaveLength(1);
    expect(engine.listRules()[0].id).toBe('repeated-denied');
  });

  it('rejects a duplicate rule id', () => {
    engine.registerRule(DENIED_RULE);
    expect(() => engine.registerRule(DENIED_RULE)).toThrow();
  });

  it('clears rules', () => {
    engine.registerRule(DENIED_RULE);
    engine.clearRules();
    expect(engine.listRules()).toEqual([]);
  });

  it('does not leak internal rule state through listRules', () => {
    engine.registerRule(DENIED_RULE);
    const rules = engine.listRules();
    rules[0].threshold = 999;
    expect(engine.listRules()[0].threshold).toBe(3);
  });
});

describe('RuntimeSecurityHeuristicsEngine — ingest', () => {
  let engine: RuntimeSecurityHeuristicsEngine;
  beforeEach(() => {
    engine = new RuntimeSecurityHeuristicsEngine({ generateId: seqIds('a') });
    engine.registerRule(DENIED_RULE);
  });

  it('raises no anomaly below threshold', () => {
    expect(engine.ingest(event('capability_denied', { id: 'd1' }))).toEqual([]);
    expect(engine.ingest(event('capability_denied', { id: 'd2' }))).toEqual([]);
    expect(engine.queryAnomalies()).toEqual([]);
  });

  it('raises an anomaly exactly at threshold', () => {
    engine.ingest(event('capability_denied', { id: 'd1' }));
    engine.ingest(event('capability_denied', { id: 'd2' }));
    const anomalies = engine.ingest(event('capability_denied', { id: 'd3' }));
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].type).toBe('repeated_denied_capabilities');
    expect(anomalies[0].relatedEventIds).toEqual(['d1', 'd2', 'd3']);
    expect(anomalies[0].score).toBe('high');
  });

  it('fires only once on the threshold crossing (not on every later event)', () => {
    for (const id of ['d1', 'd2', 'd3', 'd4', 'd5']) {
      engine.ingest(event('capability_denied', { id }));
    }
    expect(engine.queryAnomalies()).toHaveLength(1);
  });

  it('ignores events unrelated to any rule', () => {
    expect(engine.ingest(event('capability_allowed', { id: 'a1' }))).toEqual([]);
    expect(engine.queryAnomalies()).toEqual([]);
  });

  it('ignores a disabled rule', () => {
    engine.clearRules();
    engine.registerRule({ ...DENIED_RULE, enabled: false });
    for (const id of ['d1', 'd2', 'd3', 'd4']) {
      engine.ingest(event('capability_denied', { id }));
    }
    expect(engine.queryAnomalies()).toEqual([]);
  });

  it('respects the time window (out-of-window events do not count)', () => {
    engine.ingest(event('capability_denied', { id: 'd1', timestamp: 0 }));
    engine.ingest(event('capability_denied', { id: 'd2', timestamp: 1_000 }));
    // 70s later — the first event has fallen out of the 60s window.
    const anomalies = engine.ingest(
      event('capability_denied', { id: 'd3', timestamp: 70_000 })
    );
    expect(anomalies).toEqual([]);
  });

  it('is deterministic for the same event sequence', () => {
    const build = () => {
      const e = new RuntimeSecurityHeuristicsEngine({ generateId: seqIds('z') });
      e.registerRule(DENIED_RULE);
      for (const id of ['d1', 'd2', 'd3']) {
        e.ingest(event('capability_denied', { id }));
      }
      return e.queryAnomalies();
    };
    expect(build()).toEqual(build());
  });

  it('does not mutate the caller event', () => {
    const e = event('capability_denied', { id: 'd1' });
    const frozen = JSON.stringify(e);
    engine.ingest(e);
    expect(JSON.stringify(e)).toBe(frozen);
  });

  it('does not leak internal anomaly state through queryAnomalies', () => {
    for (const id of ['d1', 'd2', 'd3']) {
      engine.ingest(event('capability_denied', { id }));
    }
    const anomalies = engine.queryAnomalies();
    anomalies[0].relatedEventIds.push('tampered');
    expect(engine.queryAnomalies()[0].relatedEventIds).toEqual(['d1', 'd2', 'd3']);
  });

  it('clears anomalies', () => {
    for (const id of ['d1', 'd2', 'd3']) {
      engine.ingest(event('capability_denied', { id }));
    }
    engine.clearAnomalies();
    expect(engine.queryAnomalies()).toEqual([]);
  });
});

describe('RuntimeSecurityHeuristicsEngine — bootstrap heuristics', () => {
  function freshEngine(): RuntimeSecurityHeuristicsEngine {
    const engine = new RuntimeSecurityHeuristicsEngine({
      generateId: seqIds('a')
    });
    for (const rule of BOOTSTRAP_HEURISTIC_RULES) engine.registerRule(rule);
    return engine;
  }

  function feed(
    engine: RuntimeSecurityHeuristicsEngine,
    type: SecurityEventType,
    count: number
  ): RuntimeAnomaly[] {
    let last: RuntimeAnomaly[] = [];
    for (let i = 0; i < count; i++) {
      last = engine.ingest(event(type, { id: `${type}-${i}` }));
    }
    return last;
  }

  it('detects a sandbox violation anomaly at threshold 2', () => {
    const anomalies = feed(freshEngine(), 'sandbox_blocked', 2);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].type).toBe('sandbox_violation_attempts');
    expect(anomalies[0].score).toBe('critical');
  });

  it('detects a privacy boundary anomaly at threshold 2', () => {
    const anomalies = feed(freshEngine(), 'privacy_boundary_blocked', 2);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].type).toBe('privacy_boundary_violations');
  });

  it('detects a rapid session rotation anomaly at threshold 5', () => {
    const engine = freshEngine();
    expect(feed(engine, 'session_rotated', 4)).toEqual([]);
    const anomalies = engine.ingest(
      event('session_rotated', { id: 'session_rotated-4' })
    );
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].type).toBe('rapid_session_rotation');
  });

  it('detects a high risk execution anomaly from mixed failed/blocked events', () => {
    const engine = freshEngine();
    engine.ingest(event('execution_failed', { id: 'x1' }));
    engine.ingest(event('execution_blocked', { id: 'x2' }));
    const anomalies = engine.ingest(event('execution_failed', { id: 'x3' }));
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].type).toBe('high_risk_execution_pattern');
    expect(anomalies[0].relatedEventIds).toEqual(['x1', 'x2', 'x3']);
  });

  it('detects an approval rejection anomaly at threshold 3', () => {
    const anomalies = feed(freshEngine(), 'approval_rejected', 3);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].type).toBe('approval_rejection_pattern');
  });
});

describe('IncidentStore', () => {
  let store: IncidentStore;
  beforeEach(() => {
    store = new IncidentStore();
  });

  function incident(id: string, overrides = {}) {
    return {
      id,
      createdAt: 1,
      updatedAt: 1,
      severity: 'warning' as const,
      status: 'open' as const,
      anomalyIds: ['a1'],
      relatedEventIds: ['e1'],
      summary: 'x',
      ...overrides
    };
  }

  it('appends and reports size', () => {
    expect(store.size()).toBe(0);
    store.append(incident('i1'));
    expect(store.size()).toBe(1);
  });

  it('returns defensive copies on append and getById', () => {
    const appended = store.append(incident('i1'));
    appended.relatedEventIds.push('tampered');
    expect(store.getById('i1')?.relatedEventIds).toEqual(['e1']);
  });

  it('lists by status', () => {
    store.append(incident('i1', { status: 'open' }));
    store.append(incident('i2', { status: 'closed' }));
    expect(store.list('open').map((i) => i.id)).toEqual(['i1']);
    expect(store.list('closed').map((i) => i.id)).toEqual(['i2']);
    expect(store.list()).toHaveLength(2);
  });

  it('updates status and bumps updatedAt', () => {
    store.append(incident('i1'));
    const updated = store.updateStatus('i1', 'closed', 999);
    expect(updated.status).toBe('closed');
    expect(updated.updatedAt).toBe(999);
  });

  it('throws when updating an unknown incident', () => {
    expect(() => store.updateStatus('nope', 'closed', 1)).toThrow();
  });

  it('clears', () => {
    store.append(incident('i1'));
    store.clear();
    expect(store.size()).toBe(0);
  });
});

describe('IncidentDetector', () => {
  let detector: IncidentDetector;
  beforeEach(() => {
    detector = new IncidentDetector({
      now: () => 5000,
      generateId: seqIds('inc')
    });
  });

  function anomaly(overrides: Partial<RuntimeAnomaly> = {}): RuntimeAnomaly {
    return {
      id: overrides.id ?? 'an1',
      createdAt: overrides.createdAt ?? 1000,
      type: overrides.type ?? 'repeated_denied_capabilities',
      score: overrides.score ?? 'high',
      relatedEventIds: overrides.relatedEventIds ?? ['e1', 'e2', 'e3'],
      summary: overrides.summary ?? 'x',
      ...overrides
    };
  }

  it('auto-opens an incident from an anomaly', () => {
    const incidents = detector.process([anomaly()]);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].status).toBe('open');
    expect(incidents[0].severity).toBe('warning');
    expect(incidents[0].relatedEventIds).toEqual(['e1', 'e2', 'e3']);
    expect(detector.listIncidents('open')).toHaveLength(1);
  });

  it('aggregates relatedEventIds across same-type anomalies in one batch', () => {
    const incidents = detector.process([
      anomaly({ id: 'an1', relatedEventIds: ['e1', 'e2'] }),
      anomaly({ id: 'an2', relatedEventIds: ['e2', 'e3'] })
    ]);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].anomalyIds).toEqual(['an1', 'an2']);
    expect(incidents[0].relatedEventIds).toEqual(['e1', 'e2', 'e3']);
  });

  it('suppresses an exact immediate duplicate incident', () => {
    detector.process([anomaly()]);
    detector.process([anomaly()]);
    expect(detector.listIncidents()).toHaveLength(1);
  });

  it('opens distinct incidents for different anomaly types', () => {
    detector.process([anomaly({ type: 'repeated_denied_capabilities' })]);
    detector.process([
      anomaly({
        type: 'sandbox_violation_attempts',
        relatedEventIds: ['s1', 's2']
      })
    ]);
    expect(detector.listIncidents()).toHaveLength(2);
  });

  it('closes an incident', () => {
    const [opened] = detector.process([anomaly()]);
    const closed = detector.closeIncident(opened.id);
    expect(closed.status).toBe('closed');
    expect(detector.listIncidents('open')).toHaveLength(0);
    expect(detector.listIncidents('closed')).toHaveLength(1);
  });

  it('queries incidents by status', () => {
    const [opened] = detector.process([anomaly()]);
    detector.process([
      anomaly({ type: 'sandbox_violation_attempts', relatedEventIds: ['s1'] })
    ]);
    detector.closeIncident(opened.id);
    expect(detector.listIncidents('open')).toHaveLength(1);
    expect(detector.listIncidents('closed')).toHaveLength(1);
  });

  it('maps a critical anomaly score to a critical incident', () => {
    const [opened] = detector.process([anomaly({ score: 'critical' })]);
    expect(opened.severity).toBe('critical');
  });
});
