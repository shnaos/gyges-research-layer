/**
 * Precedence table for UnifiedPrivacyAction merge.
 *
 * Lower index = less restrictive; higher index = more restrictive.
 * deny is always the most restrictive — it wins every conflict.
 *
 * Rule:
 *   deny > temporary_block > cooldown > require_approval > rotate_* > delay > allow
 *
 * Rotation actions (rotate_session / rotate_fragment / rotate_fingerprint) are
 * non-exclusive and cumulate rather than conflict with each other. Within the
 * precedence table they sit between require_approval and delay so that a
 * rotate alongside a require_approval defers to require_approval, but a
 * rotate alongside a delay keeps both.
 */

import type { UnifiedPrivacyAction } from './types.js';

/** Ordered from least to most restrictive. */
export const ACTION_PRECEDENCE: readonly UnifiedPrivacyAction[] = [
  'allow',
  'delay',
  'rotate_session',
  'rotate_fragment',
  'rotate_fingerprint',
  'require_approval',
  'cooldown',
  'temporary_block',
  'deny'
] as const;

/** Set of rotation actions that accumulate (do not conflict with each other). */
export const ROTATION_ACTIONS: ReadonlySet<UnifiedPrivacyAction> = new Set([
  'rotate_session',
  'rotate_fragment',
  'rotate_fingerprint'
]);

/**
 * Return the numeric precedence rank of `action` (higher = more restrictive).
 * Unknown actions are given the lowest rank (0) so fail-closed logic can
 * treat them as safe to override but still surface as `deny` when `failClosed`
 * is true.
 */
export function precedenceOf(action: UnifiedPrivacyAction): number {
  const idx = ACTION_PRECEDENCE.indexOf(action);
  return idx < 0 ? 0 : idx;
}

/**
 * Return the more restrictive of two actions.
 *
 * When both actions are rotation actions, returns the second action (they
 * both accumulate — callers collect rotations separately).
 */
export function moreRestrictive(
  a: UnifiedPrivacyAction,
  b: UnifiedPrivacyAction
): UnifiedPrivacyAction {
  return precedenceOf(a) >= precedenceOf(b) ? a : b;
}
