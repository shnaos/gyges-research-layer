/**
 * Signal helpers for the RuntimePolicyOrchestrator.
 *
 * Provides the factory function used by pipeline gates to create normalised
 * {@link PolicySignal}s in a consistent, secret-free way.
 */

import { randomUUID } from 'node:crypto';
import type {
  PolicySignal,
  PolicySignalSource,
  PolicySignalSeverity,
  UnifiedPrivacyAction
} from './types.js';

export interface CreateSignalInput {
  source: PolicySignalSource;
  action: UnifiedPrivacyAction;
  severity: PolicySignalSeverity;
  reason: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create a new {@link PolicySignal} with a fresh UUID and the current
 * timestamp. The returned signal is a plain object — no class, no mutation.
 *
 * `metadata` MUST be minimal and secret-free (reason codes, risk levels,
 * structural flags only — NO raw input, NO tokens, NO credentials).
 */
export function createSignal(
  input: CreateSignalInput,
  now: () => number = Date.now
): PolicySignal {
  return {
    id: randomUUID(),
    source: input.source,
    action: input.action,
    severity: input.severity,
    reason: input.reason,
    createdAt: now(),
    ...(input.metadata !== undefined ? { metadata: { ...input.metadata } } : {})
  };
}
