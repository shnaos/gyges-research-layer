/**
 * Conflict detection for the RuntimePolicyOrchestrator.
 *
 * A "conflict" is a situation where two or more signals recommend actions that
 * are mutually exclusive or incompatible in some way (e.g. one says `delay`
 * and another says `deny`). The orchestrator detects conflicts and records how
 * each was resolved so the final decision remains fully explainable.
 *
 * Only conflicts between non-rotation actions are surfaced; multiple rotation
 * signals are never in conflict — they accumulate.
 */

import { randomUUID } from 'node:crypto';
import type { PolicyConflict, PolicySignal, UnifiedPrivacyAction } from './types.js';
import { ROTATION_ACTIONS, precedenceOf } from './precedence.js';

/**
 * Detect conflicts between the given signals and return the resolved conflict
 * records. At most one conflict record is emitted per pair of incompatible
 * actions — the record describes the winning resolution.
 *
 * Conflict detection rules (in order):
 *  1. deny vs. anything              → deny_wins
 *  2. temporary_block vs. cooldown   → most_restrictive_wins
 *  3. cooldown vs. delay             → cooldown_wins_over_delay
 *  4. require_approval vs. delay     → approval_wins_over_delay
 *  5. any other action pair          → most_restrictive_wins
 *
 * Rotation signals never conflict with each other. They are skipped.
 */
export function detectConflicts(signals: readonly PolicySignal[]): PolicyConflict[] {
  const conflicts: PolicyConflict[] = [];

  // Collect unique non-rotation actions and the first signal id for each.
  const seen = new Map<UnifiedPrivacyAction, string>(); // action → first signalId
  for (const signal of signals) {
    if (!ROTATION_ACTIONS.has(signal.action) && !seen.has(signal.action)) {
      seen.set(signal.action, signal.id);
    }
  }

  const uniqueActions = Array.from(seen.keys());
  if (uniqueActions.length < 2) return conflicts;

  // Check every pair.
  for (let i = 0; i < uniqueActions.length; i++) {
    for (let j = i + 1; j < uniqueActions.length; j++) {
      const a = uniqueActions[i];
      const b = uniqueActions[j];

      // allow vs. anything that is more restrictive is handled normally — only
      // flag if both actions are more restrictive than allow.
      if (a === 'allow' || b === 'allow') continue;

      const signalIds = [seen.get(a)!, seen.get(b)!];
      const conflict = resolveConflict(a, b, signalIds);
      if (conflict) conflicts.push(conflict);
    }
  }

  return conflicts;
}

function resolveConflict(
  a: UnifiedPrivacyAction,
  b: UnifiedPrivacyAction,
  signalIds: string[]
): PolicyConflict | null {
  // deny always wins.
  if (a === 'deny' || b === 'deny') {
    return {
      id: randomUUID(),
      signalIds,
      conflictType: 'approval_vs_deny',
      resolution: 'deny_wins',
      reason: `"deny" wins over "${a === 'deny' ? b : a}".`
    };
  }

  // temporary_block vs. cooldown
  if (
    (a === 'temporary_block' && b === 'cooldown') ||
    (a === 'cooldown' && b === 'temporary_block')
  ) {
    return {
      id: randomUUID(),
      signalIds,
      conflictType: 'action_conflict',
      resolution: 'most_restrictive_wins',
      reason: '"temporary_block" wins over "cooldown".'
    };
  }

  // cooldown vs. delay
  if (
    (a === 'cooldown' && b === 'delay') ||
    (a === 'delay' && b === 'cooldown')
  ) {
    return {
      id: randomUUID(),
      signalIds,
      conflictType: 'delay_vs_block',
      resolution: 'cooldown_wins_over_delay',
      reason: '"cooldown" wins over "delay".'
    };
  }

  // require_approval vs. delay
  if (
    (a === 'require_approval' && b === 'delay') ||
    (a === 'delay' && b === 'require_approval')
  ) {
    return {
      id: randomUUID(),
      signalIds,
      conflictType: 'timing_conflict',
      resolution: 'approval_wins_over_delay',
      reason: '"require_approval" wins over "delay".'
    };
  }

  // General action conflict when both are non-trivial and have different precedence.
  if (precedenceOf(a) !== precedenceOf(b)) {
    const winner = precedenceOf(a) > precedenceOf(b) ? a : b;
    const loser = winner === a ? b : a;
    return {
      id: randomUUID(),
      signalIds,
      conflictType: 'action_conflict',
      resolution: 'most_restrictive_wins',
      reason: `"${winner}" is more restrictive than "${loser}".`
    };
  }

  // Same precedence, same action — no conflict.
  return null;
}
