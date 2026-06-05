/**
 * SearXNG Transport Adapter — JSON response parser.
 *
 * Parses the raw JSON body returned by the SearXNG `/search?format=json`
 * endpoint into a typed {@link SearXngSearchResponse}. The parser is strict and
 * defensive: unknown or malformed fields are silently dropped rather than
 * propagating untrusted data; the `query` field is validated as a non-empty
 * string.
 *
 * Security:
 *   - no follow-up fetch of result URLs
 *   - no scraping or HTML processing
 *   - no cookies or credentials propagated
 *   - raw input is never stored or logged
 */

import type { SearXngSearchResponse, SearXngSearchResult } from './types.js';

/**
 * Parse a single result object from the SearXNG JSON response array.
 *
 * Fields that are missing or of the wrong type are omitted from the output so
 * the output is always a valid {@link SearXngSearchResult}.
 */
function parseResult(raw: unknown): SearXngSearchResult | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const entry = raw as Record<string, unknown>;
  const title = typeof entry.title === 'string' ? entry.title : '';
  const url = typeof entry.url === 'string' ? entry.url : '';
  if (!url) {
    // A result without a URL is unusable.
    return null;
  }
  const result: SearXngSearchResult = { title, url };
  if (typeof entry.content === 'string') {
    result.content = entry.content;
  }
  if (typeof entry.engine === 'string') {
    result.engine = entry.engine;
  }
  if (typeof entry.score === 'number' && Number.isFinite(entry.score)) {
    result.score = entry.score;
  }
  return result;
}

/**
 * Parse the raw JSON body returned by SearXNG into a typed response.
 *
 * @throws `Error` with a clear message when the body is not a valid SearXNG
 * response (missing `query` field or non-array `results`).
 */
export function parseSearXngResponse(body: unknown): SearXngSearchResponse {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('SearXNG response is not a JSON object.');
  }
  const raw = body as Record<string, unknown>;

  // `query` must be present and a string.
  if (typeof raw.query !== 'string') {
    throw new Error('SearXNG response missing required string field "query".');
  }

  // `results` must be present and an array (may be empty).
  if (!Array.isArray(raw.results)) {
    throw new Error('SearXNG response missing required array field "results".');
  }

  const results: SearXngSearchResult[] = raw.results
    .map(parseResult)
    .filter((r): r is SearXngSearchResult => r !== null);

  return { query: raw.query, results };
}
