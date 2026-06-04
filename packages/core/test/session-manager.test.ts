import { describe, expect, it } from 'vitest';
import {
  IdentityCompartment,
  SessionManager,
  SessionManagerConfig,
  SessionManagerError
} from '../src/index.js';

const CONFIG: SessionManagerConfig = {
  defaultTtlMs: 600_000,
  defaultMaxRequests: 25
};

/** Build a compartment with sensible defaults that individual tests override. */
function buildCompartment(
  overrides: Partial<IdentityCompartment> = {}
): IdentityCompartment {
  return {
    id: 'research',
    label: 'Default research compartment',
    transportKind: 'mock',
    reusePolicy: 'reuse_active',
    ttlMs: 600_000,
    maxRequests: 25,
    createdAt: 1_000,
    ...overrides
  };
}

/**
 * A controllable clock. `set` jumps the current time; the returned function is
 * passed to the manager as its `now`.
 */
function makeClock(start = 1_000): { now: () => number; set: (t: number) => void } {
  let current = start;
  return {
    now: () => current,
    set: (t: number) => {
      current = t;
    }
  };
}

describe('SessionManager — compartment registration', () => {
  it('registers and reads back a compartment', () => {
    const mgr = new SessionManager(CONFIG);
    const compartment = buildCompartment();
    mgr.registerCompartment(compartment);
    expect(mgr.getCompartment('research')).toEqual(compartment);
  });

  it('rejects a duplicate compartment id', () => {
    const mgr = new SessionManager(CONFIG);
    mgr.registerCompartment(buildCompartment());
    expect(() => mgr.registerCompartment(buildCompartment())).toThrow(
      SessionManagerError
    );
  });

  it('returns undefined for an unknown compartment', () => {
    const mgr = new SessionManager(CONFIG);
    expect(mgr.getCompartment('missing')).toBeUndefined();
  });

  it('rejects getOrCreateSession for an unknown compartment', () => {
    const mgr = new SessionManager(CONFIG);
    expect(() => mgr.getOrCreateSession('missing')).toThrow(SessionManagerError);
  });
});

describe('SessionManager — reuse_active', () => {
  it('reuses the same active session on a second request', () => {
    const mgr = new SessionManager(CONFIG);
    mgr.registerCompartment(buildCompartment({ reusePolicy: 'reuse_active' }));
    const first = mgr.getOrCreateSession('research');
    const second = mgr.getOrCreateSession('research');
    expect(second.sessionId).toBe(first.sessionId);
    expect(mgr.size()).toBe(1);
  });
});

describe('SessionManager — always_rotate', () => {
  it('creates a new session each time and rotates the previous one', () => {
    const mgr = new SessionManager(CONFIG);
    mgr.registerCompartment(buildCompartment({ reusePolicy: 'always_rotate' }));
    const first = mgr.getOrCreateSession('research');
    const second = mgr.getOrCreateSession('research');

    expect(second.sessionId).not.toBe(first.sessionId);
    const all = mgr.listSessions('research');
    const firstRecord = all.find((s) => s.sessionId === first.sessionId);
    expect(firstRecord?.status).toBe('rotated');
    const secondRecord = all.find((s) => s.sessionId === second.sessionId);
    expect(secondRecord?.status).toBe('active');
  });
});

describe('SessionManager — TTL expiry', () => {
  it('expires an active session once its TTL elapses', () => {
    const clock = makeClock(1_000);
    const mgr = new SessionManager(CONFIG, { now: clock.now });
    mgr.registerCompartment(buildCompartment({ ttlMs: 5_000 }));
    const created = mgr.getOrCreateSession('research');

    clock.set(6_001);
    const expiredCount = mgr.expireOldSessions();
    expect(expiredCount).toBe(1);
    const record = mgr.listSessions('research')[0];
    expect(record.sessionId).toBe(created.sessionId);
    expect(record.status).toBe('expired');
  });

  it('mints a fresh session after the previous one expired', () => {
    const clock = makeClock(1_000);
    const mgr = new SessionManager(CONFIG, { now: clock.now });
    mgr.registerCompartment(buildCompartment({ ttlMs: 5_000 }));
    const first = mgr.getOrCreateSession('research');

    clock.set(6_001);
    const second = mgr.getOrCreateSession('research');
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.status).toBe('active');
  });
});

describe('SessionManager — maxRequests rotation', () => {
  it('rotates the session once maxRequests recorded uses are reached', () => {
    const mgr = new SessionManager(CONFIG);
    mgr.registerCompartment(buildCompartment({ maxRequests: 2 }));
    const first = mgr.getOrCreateSession('research');
    mgr.recordUse(first.sessionId);
    mgr.recordUse(first.sessionId);

    // The ceiling is reached: the next get rotates and mints a new session.
    const second = mgr.getOrCreateSession('research');
    expect(second.sessionId).not.toBe(first.sessionId);

    const records = mgr.listSessions('research');
    const firstRecord = records.find((s) => s.sessionId === first.sessionId);
    expect(firstRecord?.status).toBe('rotated');
  });
});

describe('SessionManager — revoke', () => {
  it('revokes an active session', () => {
    const mgr = new SessionManager(CONFIG);
    mgr.registerCompartment(buildCompartment());
    const session = mgr.getOrCreateSession('research');
    mgr.revokeSession(session.sessionId);
    expect(mgr.listSessions('research')[0].status).toBe('revoked');
  });

  it('throws when revoking an unknown session', () => {
    const mgr = new SessionManager(CONFIG);
    expect(() => mgr.revokeSession('missing')).toThrow(SessionManagerError);
  });

  it('leaves a rotated/revoked session terminal (idempotent revoke)', () => {
    const mgr = new SessionManager(CONFIG);
    mgr.registerCompartment(buildCompartment({ reusePolicy: 'always_rotate' }));
    const first = mgr.getOrCreateSession('research');
    // Rotate it away.
    mgr.getOrCreateSession('research');
    // Revoking a rotated session is a no-op and must not throw.
    mgr.revokeSession(first.sessionId);
    const record = mgr
      .listSessions('research')
      .find((s) => s.sessionId === first.sessionId);
    expect(record?.status).toBe('rotated');
  });
});

describe('SessionManager — recordUse', () => {
  it('increments requestCount', () => {
    const mgr = new SessionManager(CONFIG);
    mgr.registerCompartment(buildCompartment());
    const session = mgr.getOrCreateSession('research');
    const used = mgr.recordUse(session.sessionId);
    expect(used.requestCount).toBe(1);
  });

  it('updates lastUsedAt', () => {
    const clock = makeClock(1_000);
    const mgr = new SessionManager(CONFIG, { now: clock.now });
    mgr.registerCompartment(buildCompartment());
    const session = mgr.getOrCreateSession('research');
    clock.set(2_500);
    const used = mgr.recordUse(session.sessionId);
    expect(used.lastUsedAt).toBe(2_500);
  });

  it('rejects an unknown session', () => {
    const mgr = new SessionManager(CONFIG);
    expect(() => mgr.recordUse('missing')).toThrow(SessionManagerError);
  });

  it('rejects an expired session', () => {
    const clock = makeClock(1_000);
    const mgr = new SessionManager(CONFIG, { now: clock.now });
    mgr.registerCompartment(buildCompartment({ ttlMs: 5_000 }));
    const session = mgr.getOrCreateSession('research');
    clock.set(6_001);
    expect(() => mgr.recordUse(session.sessionId)).toThrow(SessionManagerError);
  });

  it('rejects a rotated session', () => {
    const mgr = new SessionManager(CONFIG);
    mgr.registerCompartment(buildCompartment({ reusePolicy: 'always_rotate' }));
    const first = mgr.getOrCreateSession('research');
    mgr.getOrCreateSession('research'); // rotates `first`
    expect(() => mgr.recordUse(first.sessionId)).toThrow(SessionManagerError);
  });

  it('rejects a revoked session', () => {
    const mgr = new SessionManager(CONFIG);
    mgr.registerCompartment(buildCompartment());
    const session = mgr.getOrCreateSession('research');
    mgr.revokeSession(session.sessionId);
    expect(() => mgr.recordUse(session.sessionId)).toThrow(SessionManagerError);
  });
});

describe('SessionManager — listSessions', () => {
  it('lists sessions across all compartments', () => {
    const mgr = new SessionManager(CONFIG);
    mgr.registerCompartment(buildCompartment({ id: 'research' }));
    mgr.registerCompartment(buildCompartment({ id: 'other' }));
    mgr.getOrCreateSession('research');
    mgr.getOrCreateSession('other');
    expect(mgr.listSessions()).toHaveLength(2);
  });

  it('filters sessions by compartment', () => {
    const mgr = new SessionManager(CONFIG);
    mgr.registerCompartment(buildCompartment({ id: 'research' }));
    mgr.registerCompartment(buildCompartment({ id: 'other' }));
    mgr.getOrCreateSession('research');
    mgr.getOrCreateSession('other');
    const research = mgr.listSessions('research');
    expect(research).toHaveLength(1);
    expect(research[0].compartmentId).toBe('research');
  });

  it('does not mutate internal state through returned records', () => {
    const mgr = new SessionManager(CONFIG);
    mgr.registerCompartment(buildCompartment());
    const session = mgr.getOrCreateSession('research');
    const listed = mgr.listSessions('research')[0];
    listed.requestCount = 999;
    listed.status = 'revoked';
    const again = mgr.listSessions('research')[0];
    expect(again.requestCount).toBe(0);
    expect(again.status).toBe('active');
    expect(again.sessionId).toBe(session.sessionId);
  });
});

describe('SessionManager — toSessionContext', () => {
  it('maps a session record to a minimal session context', () => {
    const clock = makeClock(4_242);
    const mgr = new SessionManager(CONFIG, { now: clock.now });
    mgr.registerCompartment(buildCompartment({ transportKind: 'mock' }));
    const session = mgr.getOrCreateSession('research');
    const ctx = mgr.toSessionContext(session);
    expect(ctx).toEqual({
      sessionId: session.sessionId,
      compartmentId: 'research',
      transportKind: 'mock',
      createdAt: 4_242
    });
  });
});
