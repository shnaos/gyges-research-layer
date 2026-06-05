/**
 * Runtime config snapshot helpers — deterministic, immutable, defensively
 * cloned.
 *
 * A {@link RuntimeConfigSnapshot} is the immutable unit handed to the engines.
 * These helpers build one from a validated {@link RuntimeConfig} by:
 *   1. deep-cloning the config (no shared references with the caller),
 *   2. computing a deterministic checksum over its canonical serialisation, and
 *   3. deep-freezing the clone so it can never be mutated downstream.
 *
 * No I/O, no network, no persistence — pure in-memory transformation only.
 */

import { createHash } from 'node:crypto';
import { RuntimeConfig, RuntimeConfigSnapshot } from './types.js';

/**
 * Deep-clone an arbitrary JSON-shaped value.
 *
 * The runtime config is JSON-only by contract, so a structured clone is exact.
 * `structuredClone` is preferred; a JSON round-trip is the deterministic
 * fallback. Either way the result shares NO references with the input.
 */
export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Produce a canonical JSON string with object keys sorted recursively.
 *
 * Canonicalisation makes the checksum independent of key ordering: two
 * structurally equal configs always serialise identically, so their checksums
 * match. Arrays preserve order (their order is semantically meaningful).
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, sortValue((value as Record<string, unknown>)[key])]);
    return Object.fromEntries(entries);
  }
  return value;
}

/**
 * Compute the deterministic checksum of a {@link RuntimeConfig}.
 *
 * The checksum is a SHA-256 hex digest over the canonical serialisation. It is
 * stable across processes and never includes any I/O timestamp.
 */
export function computeChecksum(config: RuntimeConfig): string {
  return createHash('sha256').update(canonicalize(config)).digest('hex');
}

/**
 * Recursively deep-freeze a value in place and return it.
 *
 * After freezing, the snapshot's config is immutable: assignments and array
 * mutations throw in strict mode and are silently ignored otherwise, so no
 * downstream code can leak a mutation back into the shared snapshot.
 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * Build an immutable {@link RuntimeConfigSnapshot} from a validated config.
 *
 * The input config is deep-cloned first, so the snapshot never shares state
 * with the caller; the clone is then deep-frozen. `loadedAt` is supplied by the
 * caller (injectable for deterministic tests).
 */
export function createSnapshot(
  config: RuntimeConfig,
  loadedAt: number
): RuntimeConfigSnapshot {
  const cloned = deepClone(config);
  const checksum = computeChecksum(cloned);
  const snapshot: RuntimeConfigSnapshot = {
    version: cloned.version,
    loadedAt,
    checksum,
    config: cloned
  };
  return deepFreeze(snapshot);
}
