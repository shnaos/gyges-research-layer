/**
 * Human Approval Queue MVP — core primitives and contracts.
 *
 * These types describe a generic, local-first human-in-the-loop approval
 * surface for capability requests that the firewall flags as requiring explicit
 * confirmation. They are deliberately self-contained and agnostic: no coupling
 * to any specific business product, transport, persistence, or UI.
 */

import { CapabilityTool, RiskLevel } from '../index.js';

/**
 * Lifecycle status of an {@link ApprovalRequest}.
 *
 * A request starts as `pending` and reaches exactly one terminal state:
 * `approved`, `rejected`, or `expired`. Terminal states never transition again.
 */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

/**
 * A capability request awaiting human approval.
 *
 * This is the public, shareable shape of a queued request. It carries NO secret
 * approval token — the token is stored privately by the {@link ApprovalQueue}
 * and returned to the caller only once, at creation time.
 */
export interface ApprovalRequest {
  id: string;
  createdAt: number;
  expiresAt: number;

  agentId: string;
  compartmentId: string;

  tool: CapabilityTool;
  riskLevel: RiskLevel;

  input: unknown;
  sanitizedInput?: unknown;

  reason: string;

  status: ApprovalStatus;
}

/**
 * Opaque, local-only approval token.
 *
 * The token is a random, non-predictable value generated with Node's standard
 * crypto. It is NOT a JWT and carries no embedded claims — it is purely an
 * unguessable handle that authorises {@link ApprovalQueue.approve} and
 * {@link ApprovalQueue.reject}.
 */
export interface ApprovalToken {
  value: string;
}

/** Input required to enqueue a new pending approval request. */
export interface CreateApprovalRequestInput {
  agentId: string;
  compartmentId: string;
  tool: CapabilityTool;
  riskLevel: RiskLevel;
  input: unknown;
  sanitizedInput?: unknown;
  reason: string;
}

/** Result of {@link ApprovalQueue.create}: the request plus its one-time token. */
export interface CreatedApproval {
  request: ApprovalRequest;
  token: ApprovalToken;
}

/**
 * Reason an approve/reject action could not complete.
 *
 * - `not_found`         — no request with that id exists
 * - `expired`           — the request's TTL elapsed; it can no longer change
 * - `already_finalized` — the request is already approved or rejected
 * - `invalid_token`     — the supplied token does not match the request
 */
export type ApprovalActionError =
  | 'not_found'
  | 'expired'
  | 'already_finalized'
  | 'invalid_token';

/** Discriminated result of an approve/reject action. */
export type ApprovalActionResult =
  | { ok: true; request: ApprovalRequest }
  | { ok: false; error: ApprovalActionError };
