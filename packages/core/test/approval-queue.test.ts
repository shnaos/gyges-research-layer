import { describe, expect, it } from 'vitest';
import {
  ApprovalQueue,
  CreateApprovalRequestInput,
  DEFAULT_APPROVAL_TTL_MS
} from '../src/index.js';

function baseInput(
  overrides: Partial<CreateApprovalRequestInput> = {}
): CreateApprovalRequestInput {
  return {
    agentId: 'local-agent',
    compartmentId: 'research',
    tool: 'fetch_html',
    riskLevel: 'medium',
    input: 'sensitive query',
    sanitizedInput: 'sensitive query',
    reason: 'requires human confirmation',
    ...overrides
  };
}

/** Mutable clock helper for deterministic expiry tests. */
function fakeClock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    }
  };
}

describe('ApprovalQueue — creation', () => {
  it('creates a pending request and returns a one-time token', () => {
    const queue = new ApprovalQueue();
    const { request, token } = queue.create(baseInput());

    expect(request.status).toBe('pending');
    expect(request.id).toBeTruthy();
    expect(token.value).toBeTruthy();
    expect(request.agentId).toBe('local-agent');
    expect(request.compartmentId).toBe('research');
    expect(request.tool).toBe('fetch_html');
    expect(request.riskLevel).toBe('medium');
  });

  it('uses the default TTL of 10 minutes when none is configured', () => {
    const clock = fakeClock(0);
    const queue = new ApprovalQueue({ now: clock.now });
    const { request } = queue.create(baseInput());
    expect(request.expiresAt - request.createdAt).toBe(DEFAULT_APPROVAL_TTL_MS);
  });

  it('honours a configurable TTL', () => {
    const clock = fakeClock(0);
    const queue = new ApprovalQueue({ ttlMs: 5_000, now: clock.now });
    const { request } = queue.create(baseInput());
    expect(request.expiresAt - request.createdAt).toBe(5_000);
  });

  it('generates unique ids across many requests', () => {
    const queue = new ApprovalQueue();
    const ids = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      ids.add(queue.create(baseInput()).request.id);
    }
    expect(ids.size).toBe(100);
  });

  it('generates unique tokens across many requests', () => {
    const queue = new ApprovalQueue();
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      tokens.add(queue.create(baseInput()).token.value);
    }
    expect(tokens.size).toBe(100);
  });
});

describe('ApprovalQueue — approve / reject', () => {
  it('approves a pending request with a valid token', () => {
    const queue = new ApprovalQueue();
    const { request, token } = queue.create(baseInput());
    const result = queue.approve(request.id, token.value);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.status).toBe('approved');
    }
    expect(queue.getById(request.id)?.status).toBe('approved');
  });

  it('rejects a pending request with a valid token', () => {
    const queue = new ApprovalQueue();
    const { request, token } = queue.create(baseInput());
    const result = queue.reject(request.id, token.value);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.status).toBe('rejected');
    }
    expect(queue.getById(request.id)?.status).toBe('rejected');
  });

  it('refuses an invalid token and leaves the request pending', () => {
    const queue = new ApprovalQueue();
    const { request } = queue.create(baseInput());
    const result = queue.approve(request.id, 'not-the-token');
    expect(result).toEqual({ ok: false, error: 'invalid_token' });
    expect(queue.getById(request.id)?.status).toBe('pending');
  });

  it('returns not_found for an unknown id', () => {
    const queue = new ApprovalQueue();
    const result = queue.approve('does-not-exist', 'whatever');
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('ApprovalQueue — deterministic terminal transitions', () => {
  it('refuses a second approve (double approve)', () => {
    const queue = new ApprovalQueue();
    const { request, token } = queue.create(baseInput());
    expect(queue.approve(request.id, token.value).ok).toBe(true);
    const second = queue.approve(request.id, token.value);
    expect(second).toEqual({ ok: false, error: 'already_finalized' });
    expect(queue.getById(request.id)?.status).toBe('approved');
  });

  it('refuses to reject a request that was already approved', () => {
    const queue = new ApprovalQueue();
    const { request, token } = queue.create(baseInput());
    queue.approve(request.id, token.value);
    const result = queue.reject(request.id, token.value);
    expect(result).toEqual({ ok: false, error: 'already_finalized' });
    expect(queue.getById(request.id)?.status).toBe('approved');
  });

  it('refuses to approve a request that was already rejected', () => {
    const queue = new ApprovalQueue();
    const { request, token } = queue.create(baseInput());
    queue.reject(request.id, token.value);
    const result = queue.approve(request.id, token.value);
    expect(result).toEqual({ ok: false, error: 'already_finalized' });
    expect(queue.getById(request.id)?.status).toBe('rejected');
  });
});

describe('ApprovalQueue — expiration', () => {
  it('treats an expired request as no longer approvable', () => {
    const clock = fakeClock(0);
    const queue = new ApprovalQueue({ ttlMs: 1_000, now: clock.now });
    const { request, token } = queue.create(baseInput());
    clock.advance(1_001);
    const result = queue.approve(request.id, token.value);
    expect(result).toEqual({ ok: false, error: 'expired' });
    expect(queue.getById(request.id)?.status).toBe('expired');
  });

  it('expireOldRequests transitions only elapsed pending requests', () => {
    const clock = fakeClock(0);
    const queue = new ApprovalQueue({ ttlMs: 1_000, now: clock.now });
    const a = queue.create(baseInput());
    clock.advance(2_000);
    const b = queue.create(baseInput());

    const expiredCount = queue.expireOldRequests();
    expect(expiredCount).toBe(1);
    expect(queue.getById(a.request.id)?.status).toBe('expired');
    expect(queue.getById(b.request.id)?.status).toBe('pending');
  });

  it('does not re-expire or alter already-terminal requests', () => {
    const clock = fakeClock(0);
    const queue = new ApprovalQueue({ ttlMs: 1_000, now: clock.now });
    const { request, token } = queue.create(baseInput());
    queue.approve(request.id, token.value);
    clock.advance(10_000);
    expect(queue.expireOldRequests()).toBe(0);
    expect(queue.getById(request.id)?.status).toBe('approved');
  });
});

describe('ApprovalQueue — listing', () => {
  it('lists only pending requests', () => {
    const clock = fakeClock(0);
    const queue = new ApprovalQueue({ ttlMs: 1_000, now: clock.now });
    const pendingOne = queue.create(baseInput());
    const toApprove = queue.create(baseInput());
    const toReject = queue.create(baseInput());
    const toExpire = queue.create(baseInput());

    queue.approve(toApprove.request.id, toApprove.token.value);
    queue.reject(toReject.request.id, toReject.token.value);
    clock.advance(1_001);
    queue.expireOldRequests();
    // Re-create a fresh pending one after advancing the clock.
    const pendingTwo = queue.create(baseInput());

    const pending = queue.listPending();
    const ids = pending.map((r) => r.id).sort();
    expect(ids).toEqual([pendingTwo.request.id].sort());
    // pendingOne expired with the others when the clock advanced.
    expect(queue.getById(pendingOne.request.id)?.status).toBe('expired');
    expect(queue.getById(toExpire.request.id)?.status).toBe('expired');
  });

  it('never exposes the token via listPending or getById', () => {
    const queue = new ApprovalQueue();
    const { request } = queue.create(baseInput());
    const listed = queue.listPending()[0] as Record<string, unknown>;
    const fetched = queue.getById(request.id) as unknown as Record<string, unknown>;
    expect('token' in listed).toBe(false);
    expect('tokenValue' in listed).toBe(false);
    expect('token' in fetched).toBe(false);
    expect('tokenValue' in fetched).toBe(false);
  });
});
