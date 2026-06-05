/**
 * Type guard helpers for {@link SearchResult} variants.
 *
 * Privacy guarantees:
 *  - These functions inspect only the `status` discriminant.
 *  - No query, token, or raw input is ever read, logged, or stored.
 */

import type { SearchAllowedResult, SearchDeniedResult, SearchPendingResult, SearchResult } from './types.js';

/** Returns true when the result was allowed by the GRL firewall. */
export function isAllowed(result: SearchResult): result is SearchAllowedResult {
  return result.status === 'allowed';
}

/** Returns true when the result was denied by the GRL firewall. */
export function isDenied(result: SearchResult): result is SearchDeniedResult {
  return result.status === 'denied';
}

/** Returns true when the result is waiting for human approval. */
export function isPending(result: SearchResult): result is SearchPendingResult {
  return result.status === 'pending';
}
