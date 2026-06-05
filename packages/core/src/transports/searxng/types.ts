/**
 * SearXNG Transport Adapter — core types and contracts.
 *
 * Sprint 17 introduces the first real network transport for GRL. SearXNG is
 * the only permitted transport in this sprint — no Tor, no proxy chain, no
 * browser, no scraping, no follow-up fetch of returned URLs.
 *
 * Security constraints:
 *   - disabled by default (enabled: false)
 *   - local-only by default (127.0.0.1 / localhost)
 *   - fail-closed on invalid config
 *   - no cookies, no custom secret headers
 *   - no follow-up fetch of result URLs
 *   - no raw input stored or logged
 */

/**
 * Runtime configuration for the SearXNG transport adapter.
 *
 * All fields are required when the transport is enabled; the adapter rejects
 * any config that is missing or structurally invalid.
 */
export interface SearXngTransportConfig {
  /** Base URL of the SearXNG instance. Must be local by default. */
  baseUrl: string;
  /** HTTP request timeout in milliseconds. */
  timeoutMs: number;
  /** Maximum number of results to return. */
  maxResults: number;
  /** Whether the transport is enabled. False by default; fail-closed. */
  enabled: boolean;
}

/**
 * A search request to dispatch to the SearXNG instance.
 *
 * Only these fields are forwarded as URL query parameters. No other parameters
 * are ever sent (especially no cookies, no secrets, no auth headers).
 */
export interface SearXngSearchRequest {
  query: string;
  language?: string;
  categories?: string[];
  timeRange?: 'day' | 'week' | 'month' | 'year';
  safeSearch?: 0 | 1 | 2;
}

/**
 * A single search result entry returned by SearXNG.
 */
export interface SearXngSearchResult {
  title: string;
  url: string;
  content?: string;
  engine?: string;
  score?: number;
}

/**
 * The parsed response from a SearXNG JSON search endpoint.
 */
export interface SearXngSearchResponse {
  query: string;
  results: SearXngSearchResult[];
}
