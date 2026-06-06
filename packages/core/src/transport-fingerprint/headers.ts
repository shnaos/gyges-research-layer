/**
 * HeaderRandomizationEngine — deterministic header set selection.
 *
 * Maintains predefined header sets and selects from them deterministically
 * based on a rotation counter. No browser fingerprint spoofing, no TLS/JA3
 * manipulation, no canvas or WebRTC spoofing.
 *
 * Purpose: avoid trivially stable header sets across all agent requests.
 */

import { HeaderOrderingEngine } from './ordering.js';

/**
 * A predefined, safe header set variant.
 * Only standard, non-sensitive headers are included.
 */
interface HeaderSetVariant {
  readonly headers: Record<string, string>;
}

/** Predefined header set variants. Vary Accept and Accept-Encoding slightly. */
const HEADER_SET_POOL: readonly HeaderSetVariant[] = [
  {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Cache-Control': 'no-cache'
    }
  },
  {
    headers: {
      'Accept': 'application/json, */*;q=0.8',
      'Accept-Encoding': 'gzip',
      'Cache-Control': 'no-store'
    }
  },
  {
    headers: {
      'Accept': 'application/json;q=1.0',
      'Accept-Encoding': 'deflate, gzip',
      'Pragma': 'no-cache'
    }
  },
  {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache, no-store'
    }
  },
  {
    headers: {
      'Accept': 'application/json, text/plain;q=0.5',
      'Accept-Encoding': 'gzip',
      'Cache-Control': 'no-cache'
    }
  }
] as const;

export class HeaderRandomizationEngine {
  private readonly pool: readonly HeaderSetVariant[];
  private readonly orderingEngine: HeaderOrderingEngine;

  constructor(pool?: readonly HeaderSetVariant[]) {
    this.pool = pool ?? HEADER_SET_POOL;
    this.orderingEngine = new HeaderOrderingEngine();
  }

  /**
   * Select and return a header set deterministically.
   * Also applies ordering permutation based on the rotation count.
   * Returns a defensive copy.
   */
  selectHeaders(
    rotationCount: number,
    userAgent: string,
    acceptLanguage: string
  ): Record<string, string> {
    const index = rotationCount % this.pool.length;
    const variant = this.pool[index];

    // Build the full header map including UA and language.
    const merged: Record<string, string> = {
      ...variant.headers,
      'User-Agent': userAgent,
      'Accept-Language': acceptLanguage
    };

    // Apply deterministic ordering.
    return this.orderingEngine.applyOrdering(merged, rotationCount);
  }

  get poolSize(): number {
    return this.pool.length;
  }
}
