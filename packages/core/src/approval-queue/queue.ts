/**
 * ApprovalQueue — in-memory, local-first human approval queue.
 *
 * The queue holds capability requests that the firewall flagged as requiring
 * explicit human confirmation. It owns the full lifecycle:
 *
 *   pending ──approve(id, token)──▶ approved   (terminal)
 *   pending ──reject(id, token)───▶ rejected   (terminal)
 *   pending ──TTL elapsed────────▶ expired     (terminal)
 *
 * Design constraints (Sprint 5 MVP):
 *   - purely in-memory: no DB, no Redis, no persistence of any kind
 *   - deterministic transitions: terminal states never change again
 *   - opaque tokens generated with Node's standard crypto; never a JWT
 *   - tokens are stored privately and never exposed via {@link listPending}
 *     or {@link getById}; they are returned exactly once, at creation time
 */

import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  ApprovalActionResult,
  ApprovalRequest,
  ApprovalToken,
  CreateApprovalRequestInput,
  CreatedApproval
} from './types.js';

/** Default time-to-live for a pending request: 10 minutes. */
export const DEFAULT_APPROVAL_TTL_MS = 10 * 60 * 1000;

/** Number of random bytes backing an approval token (256 bits of entropy). */
const TOKEN_BYTES = 32;

export interface ApprovalQueueOptions {
  /** Time-to-live for pending requests, in milliseconds. */
  ttlMs?: number;
  /** Injectable clock for deterministic testing. Defaults to {@link Date.now}. */
  now?: () => number;
}

interface QueueEntry {
  request: ApprovalRequest;
  /** Secret token value. Never leaves the queue except at creation time. */
  tokenValue: string;
}

export class ApprovalQueue {
  private readonly entries = new Map<string, QueueEntry>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: ApprovalQueueOptions = {}) {
    const ttl = options.ttlMs ?? DEFAULT_APPROVAL_TTL_MS;
    this.ttlMs = Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_APPROVAL_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Enqueue a new pending request and mint its one-time approval token.
   *
   * The returned {@link CreatedApproval.token} is the ONLY time the token value
   * is exposed; it is never returned again by any other method.
   */
  create(input: CreateApprovalRequestInput): CreatedApproval {
    const createdAt = this.now();
    const request: ApprovalRequest = {
      id: randomUUID(),
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      agentId: input.agentId,
      compartmentId: input.compartmentId,
      tool: input.tool,
      riskLevel: input.riskLevel,
      input: input.input,
      sanitizedInput: input.sanitizedInput,
      reason: input.reason,
      status: 'pending'
    };
    const tokenValue = randomBytes(TOKEN_BYTES).toString('hex');
    this.entries.set(request.id, { request, tokenValue });
    return { request, token: { value: tokenValue } };
  }

  /**
   * List only the requests that are still pending.
   *
   * Requests whose TTL has elapsed are lazily transitioned to `expired` first,
   * so they are excluded. The returned objects never contain the secret token.
   */
  listPending(): ApprovalRequest[] {
    const pending: ApprovalRequest[] = [];
    for (const entry of this.entries.values()) {
      this.applyExpiry(entry);
      if (entry.request.status === 'pending') {
        pending.push(entry.request);
      }
    }
    return pending;
  }

  /**
   * Fetch a single request by id, applying lazy expiry first. Returns
   * `undefined` when no request with that id exists. Never exposes the token.
   */
  getById(id: string): ApprovalRequest | undefined {
    const entry = this.entries.get(id);
    if (!entry) {
      return undefined;
    }
    this.applyExpiry(entry);
    return entry.request;
  }

  /** Approve a pending request. Requires the matching opaque token. */
  approve(id: string, token: string): ApprovalActionResult {
    return this.finalize(id, token, 'approved');
  }

  /** Reject a pending request. Requires the matching opaque token. */
  reject(id: string, token: string): ApprovalActionResult {
    return this.finalize(id, token, 'rejected');
  }

  /**
   * Transition every pending request whose TTL has elapsed to `expired`.
   *
   * Returns the number of requests expired by this call. Safe to call as often
   * as desired; already-terminal requests are left untouched.
   */
  expireOldRequests(): number {
    let expired = 0;
    for (const entry of this.entries.values()) {
      if (this.applyExpiry(entry)) {
        expired += 1;
      }
    }
    return expired;
  }

  /** Total number of requests tracked, regardless of status. */
  size(): number {
    return this.entries.size;
  }

  private finalize(
    id: string,
    token: string,
    target: 'approved' | 'rejected'
  ): ApprovalActionResult {
    const entry = this.entries.get(id);
    if (!entry) {
      return { ok: false, error: 'not_found' };
    }

    // Lazily expire before any decision so a stale request can never be
    // approved or rejected.
    this.applyExpiry(entry);

    if (entry.request.status === 'expired') {
      return { ok: false, error: 'expired' };
    }
    if (entry.request.status !== 'pending') {
      return { ok: false, error: 'already_finalized' };
    }
    if (!this.tokenMatches(entry.tokenValue, token)) {
      return { ok: false, error: 'invalid_token' };
    }

    entry.request.status = target;
    return { ok: true, request: entry.request };
  }

  /**
   * Transition an entry to `expired` if it is pending and past its TTL.
   * Returns `true` when this call performed the transition.
   */
  private applyExpiry(entry: QueueEntry): boolean {
    if (entry.request.status === 'pending' && this.now() >= entry.request.expiresAt) {
      entry.request.status = 'expired';
      return true;
    }
    return false;
  }

  /** Constant-time comparison of two token values. */
  private tokenMatches(expected: string, provided: unknown): boolean {
    if (typeof provided !== 'string' || provided.length === 0) {
      return false;
    }
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const providedBuffer = Buffer.from(provided, 'utf8');
    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }
    return timingSafeEqual(expectedBuffer, providedBuffer);
  }
}
