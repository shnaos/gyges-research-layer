/**
 * SessionContext generation — minimal Sprint 6 helper.
 *
 * This is intentionally tiny: it mints an opaque session identifier, propagates
 * the compartment id, records the transport kind, and stamps a creation time.
 *
 * There is NO persistence and NO real isolation here. It exists only to prepare
 * the future Session Manager without implementing it.
 */

import { randomUUID } from 'node:crypto';
import { SessionContext, TransportKind } from './types.js';

export interface CreateSessionContextInput {
  compartmentId: string;
  /** Transport kind for the session. Defaults to `mock` in Sprint 6. */
  transportKind?: TransportKind;
  /** Injectable clock for deterministic testing. Defaults to {@link Date.now}. */
  now?: () => number;
}

/**
 * Create a minimal {@link SessionContext}.
 *
 * The `sessionId` is an opaque, non-predictable UUID. Nothing is stored — the
 * returned context is the only copy.
 */
export function createSessionContext(
  input: CreateSessionContextInput
): SessionContext {
  const now = input.now ?? Date.now;
  return {
    sessionId: randomUUID(),
    compartmentId: input.compartmentId,
    transportKind: input.transportKind ?? 'mock',
    createdAt: now()
  };
}
