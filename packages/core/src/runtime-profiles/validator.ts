/**
 * RuntimeProfileValidator — structural validation helpers for profiles and packs.
 *
 * These helpers provide lightweight, synchronous validation without touching the
 * resolver. They are used at the API boundary to produce actionable 4xx errors
 * before attempting resolution.
 *
 * Hard constraints: no I/O, no network, no persistence, no AI/ML. Pure
 * structural checks only.
 */

import {
  RUNTIME_PROFILE_NAMES,
  RuntimeProfileResolutionError,
  type RuntimeProfileName
} from './types.js';

/**
 * Assert that `value` is a valid {@link RuntimeProfileName}.
 *
 * @throws {@link RuntimeProfileResolutionError} with reason `'unknown_profile'`
 *   when the value is not a recognised profile name.
 */
export function assertValidProfileName(
  value: unknown
): asserts value is RuntimeProfileName {
  if (
    typeof value !== 'string' ||
    !(RUNTIME_PROFILE_NAMES as readonly string[]).includes(value)
  ) {
    throw new RuntimeProfileResolutionError(
      'unknown_profile',
      `"${String(value)}" is not a valid runtime profile name. ` +
        `Valid names: ${RUNTIME_PROFILE_NAMES.join(', ')}.`
    );
  }
}

/**
 * Return `true` when `value` is a valid {@link RuntimeProfileName}.
 */
export function isValidProfileName(value: unknown): value is RuntimeProfileName {
  return (
    typeof value === 'string' &&
    (RUNTIME_PROFILE_NAMES as readonly string[]).includes(value)
  );
}
