/**
 * SearXNG Transport Adapter — MVP implementation.
 *
 * The first real-network transport in GRL. It dispatches a `search` capability
 * to a locally-configured SearXNG instance via a single authenticated GET
 * request, parses the JSON response, and returns a structured result.
 *
 * Hard security rules enforced by this adapter:
 *   - kind = 'searxng'; supports ONLY the `search` tool
 *   - refuses `fetch_html`, `fetch_json`, and any other tool
 *   - uses only the SearXNG JSON search endpoint (GET /search?format=json)
 *   - timeout is mandatory; requests that exceed it are failed-closed
 *   - maxResults is enforced after parsing
 *   - baseUrl must pass {@link isValidBaseUrl} (loopback-only by default)
 *   - no POST; no cookies; no custom secret headers
 *   - no follow-up fetch of result URLs
 *   - no browser, scraper, or HTML parser
 *   - no raw input stored or logged
 *   - disabled adapter fails-closed immediately
 *
 * The adapter is intentionally stateless. It reads config at construction time
 * and validates it immediately; a disabled or invalid config throws before the
 * adapter can be used.
 */

import { randomUUID } from 'node:crypto';
import type { ExecutionRequest, ExecutionResult, TransportAdapter } from '../../execution/types.js';
import type { SearXngTransportConfig, SearXngSearchRequest } from './types.js';
import { validateSearXngConfig, SearXngConfigError } from './config.js';
import { parseSearXngResponse } from './parser.js';

/** The only capability tool SearXNG may execute. */
const SUPPORTED_TOOL = 'search' as const;

/**
 * Build the SearXNG search URL from a validated base URL and search parameters.
 *
 * Only the allowed query parameters are ever appended:
 *   q, format, language, categories, time_range, safesearch.
 *
 * No other parameters, headers, cookies, or credentials are added.
 */
function buildSearchUrl(
  baseUrl: string,
  req: SearXngSearchRequest
): string {
  const url = new URL('/search', baseUrl);
  url.searchParams.set('q', req.query);
  url.searchParams.set('format', 'json');
  if (req.language) {
    url.searchParams.set('language', req.language);
  }
  if (req.categories && req.categories.length > 0) {
    url.searchParams.set('categories', req.categories.join(','));
  }
  if (req.timeRange) {
    url.searchParams.set('time_range', req.timeRange);
  }
  if (req.safeSearch !== undefined) {
    url.searchParams.set('safesearch', String(req.safeSearch));
  }
  return url.toString();
}

/**
 * Coerce the execution request's sanitized input into a {@link SearXngSearchRequest}.
 *
 * Accepts:
 *   - a plain string → `{ query: string }`
 *   - an object with at least a `query` string field
 *
 * Returns `null` for any other input shape (the adapter fails-closed).
 */
function toSearchRequest(input: unknown): SearXngSearchRequest | null {
  if (typeof input === 'string') {
    const query = input.trim();
    if (!query) return null;
    return { query };
  }
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const candidate = input as Record<string, unknown>;
    if (typeof candidate.query === 'string' && candidate.query.trim().length > 0) {
      const req: SearXngSearchRequest = { query: candidate.query.trim() };
      if (typeof candidate.language === 'string') {
        req.language = candidate.language;
      }
      if (Array.isArray(candidate.categories)) {
        req.categories = candidate.categories.filter(
          (c): c is string => typeof c === 'string'
        );
      }
      const timeRange = candidate.timeRange;
      if (
        timeRange === 'day' ||
        timeRange === 'week' ||
        timeRange === 'month' ||
        timeRange === 'year'
      ) {
        req.timeRange = timeRange;
      }
      const safeSearch = candidate.safeSearch;
      if (safeSearch === 0 || safeSearch === 1 || safeSearch === 2) {
        req.safeSearch = safeSearch;
      }
      return req;
    }
  }
  return null;
}

/**
 * SearXNG Transport Adapter.
 *
 * Implements {@link TransportAdapter} for the `searxng` transport kind.
 * Constructed from a validated {@link SearXngTransportConfig}; fails-closed
 * before construction if the config is disabled or invalid.
 */
export class SearXngTransportAdapter implements TransportAdapter {
  readonly kind = 'searxng' as const;

  private readonly config: SearXngTransportConfig;
  private readonly now: () => number;
  private readonly generateId: () => string;

  /**
   * @param config - A **validated** SearXNG config (use {@link validateSearXngConfig}
   *   before passing it here).
   * @param now   - Injectable clock for deterministic timing in tests.
   * @param generateId - Injectable id generator for tests.
   */
  constructor(
    config: SearXngTransportConfig,
    now: () => number = Date.now,
    generateId: () => string = randomUUID
  ) {
    this.config = config;
    this.now = now;
    this.generateId = generateId;
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const startedAt = this.now();

    // Only `search` is supported; refuse all other tools.
    if (request.tool !== SUPPORTED_TOOL) {
      return {
        id: this.generateId(),
        requestId: request.id,
        status: 'failed',
        transportKind: 'searxng',
        error: `SearXNG adapter does not support tool "${request.tool}". Only "search" is allowed.`,
        startedAt,
        completedAt: this.now()
      };
    }

    // Coerce the sanitized input into a search request.
    const searchReq = toSearchRequest(request.sanitizedInput ?? request.input);
    if (!searchReq) {
      return {
        id: this.generateId(),
        requestId: request.id,
        status: 'failed',
        transportKind: 'searxng',
        error: 'SearXNG adapter received invalid input: expected a non-empty string or a search request object.',
        startedAt,
        completedAt: this.now()
      };
    }

    const url = buildSearchUrl(this.config.baseUrl, searchReq);

    // Perform the HTTP request with a hard timeout. No cookies, no custom
    // secret headers, no auth — only the minimal Accept header.
    let response: Response;
    try {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(
        () => controller.abort(),
        this.config.timeoutMs
      );
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutHandle);
      }
    } catch (err) {
      const isTimeout =
        err instanceof Error &&
        (err.name === 'AbortError' || err.message.includes('aborted'));
      return {
        id: this.generateId(),
        requestId: request.id,
        status: 'failed',
        transportKind: 'searxng',
        error: isTimeout
          ? 'SearXNG request timed out.'
          : `SearXNG request failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        startedAt,
        completedAt: this.now()
      };
    }

    if (!response.ok) {
      return {
        id: this.generateId(),
        requestId: request.id,
        status: 'failed',
        transportKind: 'searxng',
        error: `SearXNG returned HTTP ${response.status}.`,
        startedAt,
        completedAt: this.now()
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        id: this.generateId(),
        requestId: request.id,
        status: 'failed',
        transportKind: 'searxng',
        error: 'SearXNG returned invalid JSON.',
        startedAt,
        completedAt: this.now()
      };
    }

    let parsed;
    try {
      parsed = parseSearXngResponse(body);
    } catch (err) {
      return {
        id: this.generateId(),
        requestId: request.id,
        status: 'failed',
        transportKind: 'searxng',
        error: err instanceof Error ? err.message : 'SearXNG response parse error.',
        startedAt,
        completedAt: this.now()
      };
    }

    // Enforce maxResults.
    const trimmedResults = parsed.results.slice(0, this.config.maxResults);

    return {
      id: this.generateId(),
      requestId: request.id,
      status: 'success',
      transportKind: 'searxng',
      output: {
        query: parsed.query,
        results: trimmedResults
      },
      startedAt,
      completedAt: this.now()
    };
  }
}

/**
 * Build a {@link SearXngTransportAdapter} from an optionally-present config.
 *
 * Returns `null` when the config is absent or disabled (fail-closed). Throws
 * {@link SearXngConfigError} when the config is present but structurally
 * invalid.
 */
export function buildSearXngAdapter(
  config: SearXngTransportConfig | undefined,
  now?: () => number,
  generateId?: () => string
): SearXngTransportAdapter | null {
  if (!config) return null;
  try {
    const validated = validateSearXngConfig(config);
    return new SearXngTransportAdapter(validated, now, generateId);
  } catch (err) {
    if (err instanceof SearXngConfigError && err.reason === 'disabled') {
      return null;
    }
    throw err;
  }
}
