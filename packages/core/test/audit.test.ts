import { beforeEach, describe, expect, it } from 'vitest';
import {
  AuditStore,
  SecurityEvent,
  SecurityEventEngine
} from '../src/index.js';

/** Build a minimal stamped event for AuditStore tests. */
function event(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    id: overrides.id ?? 'e1',
    timestamp: overrides.timestamp ?? 1000,
    type: overrides.type ?? 'capability_allowed',
    severity: overrides.severity ?? 'info',
    message: overrides.message ?? 'allowed',
    ...overrides
  };
}

describe('AuditStore', () => {
  let store: AuditStore;
  beforeEach(() => {
    store = new AuditStore();
  });

  it('appends an event and reports size', () => {
    expect(store.size()).toBe(0);
    store.append(event());
    expect(store.size()).toBe(1);
  });

  it('returns the stored event from getById', () => {
    store.append(event({ id: 'abc' }));
    expect(store.getById('abc')?.id).toBe('abc');
    expect(store.getById('missing')).toBeUndefined();
  });

  it('clears all events', () => {
    store.append(event({ id: 'a' }));
    store.append(event({ id: 'b' }));
    store.clear();
    expect(store.size()).toBe(0);
    expect(store.list()).toEqual([]);
  });

  it('orders results by timestamp then insertion (stable)', () => {
    store.append(event({ id: 'a', timestamp: 30 }));
    store.append(event({ id: 'b', timestamp: 10 }));
    store.append(event({ id: 'c', timestamp: 10 }));
    store.append(event({ id: 'd', timestamp: 20 }));
    expect(store.list().map((e) => e.id)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('filters by type', () => {
    store.append(event({ id: 'a', type: 'capability_allowed' }));
    store.append(event({ id: 'b', type: 'capability_denied' }));
    expect(store.list({ type: 'capability_denied' }).map((e) => e.id)).toEqual([
      'b'
    ]);
  });

  it('filters by severity', () => {
    store.append(event({ id: 'a', severity: 'info' }));
    store.append(event({ id: 'b', severity: 'warning' }));
    expect(store.list({ severity: 'warning' }).map((e) => e.id)).toEqual(['b']);
  });

  it('filters by agentId, compartmentId, sessionId, requestId, executionId', () => {
    store.append(
      event({
        id: 'a',
        agentId: 'ag1',
        compartmentId: 'c1',
        sessionId: 's1',
        requestId: 'r1',
        executionId: 'x1'
      })
    );
    store.append(
      event({
        id: 'b',
        agentId: 'ag2',
        compartmentId: 'c2',
        sessionId: 's2',
        requestId: 'r2',
        executionId: 'x2'
      })
    );
    expect(store.list({ agentId: 'ag1' }).map((e) => e.id)).toEqual(['a']);
    expect(store.list({ compartmentId: 'c2' }).map((e) => e.id)).toEqual(['b']);
    expect(store.list({ sessionId: 's1' }).map((e) => e.id)).toEqual(['a']);
    expect(store.list({ requestId: 'r2' }).map((e) => e.id)).toEqual(['b']);
    expect(store.list({ executionId: 'x1' }).map((e) => e.id)).toEqual(['a']);
  });

  it('filters by since/until (inclusive)', () => {
    store.append(event({ id: 'a', timestamp: 10 }));
    store.append(event({ id: 'b', timestamp: 20 }));
    store.append(event({ id: 'c', timestamp: 30 }));
    expect(store.list({ since: 20 }).map((e) => e.id)).toEqual(['b', 'c']);
    expect(store.list({ until: 20 }).map((e) => e.id)).toEqual(['a', 'b']);
    expect(store.list({ since: 20, until: 20 }).map((e) => e.id)).toEqual(['b']);
  });

  it('applies limit after ordering', () => {
    store.append(event({ id: 'a', timestamp: 30 }));
    store.append(event({ id: 'b', timestamp: 10 }));
    store.append(event({ id: 'c', timestamp: 20 }));
    expect(store.list({ limit: 2 }).map((e) => e.id)).toEqual(['b', 'c']);
    expect(store.list({ limit: 0 })).toEqual([]);
  });

  it('returns defensive copies that cannot mutate internal state', () => {
    store.append(event({ id: 'a', metadata: { tool: 'search' } }));
    const fetched = store.getById('a')!;
    (fetched.metadata as Record<string, unknown>).tool = 'tampered';
    fetched.message = 'tampered';
    const again = store.getById('a')!;
    expect(again.metadata?.tool).toBe('search');
    expect(again.message).toBe('allowed');
  });

  it('does not alias the appended event after a later caller mutation', () => {
    const input = event({ id: 'a', metadata: { tool: 'search' } });
    store.append(input);
    (input.metadata as Record<string, unknown>).tool = 'tampered';
    input.message = 'tampered';
    expect(store.getById('a')?.metadata?.tool).toBe('search');
    expect(store.getById('a')?.message).toBe('allowed');
  });
});

describe('SecurityEventEngine', () => {
  it('stamps an id and timestamp on emit', () => {
    let n = 0;
    const engine = new SecurityEventEngine({
      now: () => 4242,
      generateId: () => `id-${++n}`
    });
    const emitted = engine.emit({
      type: 'capability_allowed',
      severity: 'info',
      message: 'ok'
    });
    expect(emitted.id).toBe('id-1');
    expect(emitted.timestamp).toBe(4242);
  });

  it('generates unique ids across emits', () => {
    const engine = new SecurityEventEngine();
    const a = engine.emit({ type: 'execution_started', severity: 'info', message: 'a' });
    const b = engine.emit({ type: 'execution_started', severity: 'info', message: 'b' });
    expect(a.id).not.toBe(b.id);
  });

  it('uses an injectable clock for deterministic timestamps', () => {
    const times = [1, 2, 3];
    let i = 0;
    const engine = new SecurityEventEngine({ now: () => times[i++] });
    engine.emit({ type: 'execution_started', severity: 'info', message: 'a' });
    engine.emit({ type: 'execution_succeeded', severity: 'info', message: 'b' });
    expect(engine.query().map((e) => e.timestamp)).toEqual([1, 2]);
  });

  it('queries by type and fetches by id', () => {
    let n = 0;
    const engine = new SecurityEventEngine({ generateId: () => `id-${++n}` });
    engine.emit({ type: 'capability_allowed', severity: 'info', message: 'a' });
    const denied = engine.emit({
      type: 'capability_denied',
      severity: 'warning',
      message: 'b'
    });
    expect(engine.query({ type: 'capability_denied' }).map((e) => e.id)).toEqual([
      denied.id
    ]);
    expect(engine.getEvent(denied.id)?.type).toBe('capability_denied');
  });

  it('clears recorded events', () => {
    const engine = new SecurityEventEngine();
    engine.emit({ type: 'execution_started', severity: 'info', message: 'a' });
    engine.clear();
    expect(engine.size()).toBe(0);
    expect(engine.query()).toEqual([]);
  });

  it('never mutates the caller-supplied metadata', () => {
    const engine = new SecurityEventEngine();
    const metadata = { tool: 'search', riskLevel: 'low' };
    const emitted = engine.emit({
      type: 'capability_allowed',
      severity: 'info',
      message: 'a',
      metadata
    });
    // Mutating the returned event must not reach the original input.
    (emitted.metadata as Record<string, unknown>).tool = 'tampered';
    expect(metadata.tool).toBe('search');
    // And the stored event must reflect the value at emit time, not later edits.
    metadata.riskLevel = 'high';
    expect(engine.getEvent(emitted.id)?.metadata?.riskLevel).toBe('low');
  });
});

// Sprint 32 — bounded audit store (memory hardening).
describe('AuditStore bounding (Sprint 32)', () => {
  it('defaults to a high cap and does not evict under normal load', () => {
    const store = new AuditStore();
    expect(store.capacity()).toBe(50_000);
    for (let i = 0; i < 100; i++) store.append(event({ id: `e${i}`, timestamp: i }));
    expect(store.size()).toBe(100);
    expect(store.evicted()).toBe(0);
  });

  it('evicts oldest events FIFO beyond the cap', () => {
    const store = new AuditStore({ maxEvents: 3 });
    for (let i = 0; i < 5; i++) store.append(event({ id: `e${i}`, timestamp: i, message: `m${i}` }));
    expect(store.size()).toBe(3);
    expect(store.evicted()).toBe(2);
    expect(store.list().map((e) => e.id)).toEqual(['e2', 'e3', 'e4']);
  });

  it('clamps a non-positive cap to 1 (always bounded)', () => {
    expect(new AuditStore({ maxEvents: 0 }).capacity()).toBe(1);
    expect(new AuditStore({ maxEvents: -10 }).capacity()).toBe(1);
  });

  it('honours maxEvents passed through the SecurityEventEngine', () => {
    const engine = new SecurityEventEngine({ maxEvents: 2 });
    for (let i = 0; i < 4; i++) {
      engine.emit({ type: 'execution_started', severity: 'info', message: `m${i}` });
    }
    expect(engine.size()).toBe(2);
  });
});
