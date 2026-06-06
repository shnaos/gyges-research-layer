/**
 * HeaderOrderingEngine — deterministic header permutation.
 *
 * Produces a deterministic ordering of a header set so that identical headers
 * are not always sent in the same order, reducing trivial ordering signatures.
 *
 * The permutation is derived from the rotation count using a fixed-size Fisher-
 * Yates shuffle seeded from the counter. This is deterministic (same counter →
 * same order) but avoids stable ordering.
 *
 * No real randomness is injected — this is purely counter-based.
 */

/**
 * Apply a deterministic permutation to the keys of a header map.
 *
 * Returns a new ordered array of [key, value] pairs. The permutation is based
 * on `seed` and is reproducible for the same seed.
 */
export function permuteHeaders(
  headers: Record<string, string>,
  seed: number
): Array<[string, string]> {
  const entries = Object.entries(headers);
  if (entries.length <= 1) return entries;

  // Create a copy to shuffle in-place.
  const shuffled = [...entries];
  const n = shuffled.length;

  // Deterministic Fisher-Yates using a simple LCG seeded from `seed`.
  let state = Math.abs(seed) || 1;
  function nextInt(max: number): number {
    // LCG: a=1664525, c=1013904223, m=2^32
    state = ((state * 1664525) + 1013904223) & 0xffffffff;
    const unsigned = state >>> 0;
    return unsigned % max;
  }

  for (let i = n - 1; i > 0; i--) {
    const j = nextInt(i + 1);
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }

  return shuffled;
}

export class HeaderOrderingEngine {
  /**
   * Apply a deterministic permutation to the header map and return a new
   * ordered Record. The order in a plain JS object is insertion-order, so
   * the returned Record's keys are in the permuted order.
   */
  applyOrdering(headers: Record<string, string>, seed: number): Record<string, string> {
    const permuted = permuteHeaders(headers, seed);
    const result: Record<string, string> = {};
    for (const [k, v] of permuted) {
      result[k] = v;
    }
    return result;
  }
}
