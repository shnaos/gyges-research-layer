/**
 * SearXNG Transport Adapter — unit tests.
 *
 * Tests cover:
 *   - disabled config fails closed
 *   - invalid baseUrl rejected
 *   - supports only search tool
 *   - rejects fetch_html / fetch_json
 *   - string input converted to query
 *   - object input parsed
 *   - malformed input failed
 *   - timeout handled
 *   - HTTP non-200 failed
 *   - invalid JSON failed
 *   - valid JSON parsed and trimmed by maxResults
 *   - no raw input mutation
 *   - no cookies / custom secret headers sent
 *   - never follows returned result URLs
 *
 * All tests that make HTTP calls use an in-process mock HTTP server. No real
 * internet access occurs.
 */

import { AddressInfo, createServer, IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SearXngTransportAdapter,
  buildSearXngAdapter,
  validateSearXngConfig,
  SearXngConfigError,
  isValidBaseUrl
} from '../src/transports/searxng/index.js';
import type { SearXngTransportConfig } from '../src/transports/searxng/index.js';
import type { ExecutionRequest } from '../src/execution/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    id: 'req-1',
    agentId: 'agent-1',
    compartmentId: 'research',
    tool: 'search',
    riskLevel: 'low',
    input: 'bitcoin privacy',
    sanitizedInput: 'bitcoin privacy',
    session: {
      sessionId: 'sess-1',
      compartmentId: 'research',
      transportKind: 'searxng',
      createdAt: Date.now()
    },
    ...overrides
  };
}

function makeConfig(overrides: Partial<SearXngTransportConfig> = {}): SearXngTransportConfig {
  return {
    baseUrl: 'http://127.0.0.1:0', // port will be replaced in tests
    timeoutMs: 5000,
    maxResults: 10,
    enabled: true,
    ...overrides
  };
}

/** Minimal valid SearXNG JSON response. */
const VALID_SEARXNG_RESPONSE = {
  query: 'bitcoin privacy',
  results: [
    { title: 'Bitcoin Privacy', url: 'https://example.com/1', content: 'Some content', engine: 'ddg', score: 0.9 },
    { title: 'Bitcoin Basics', url: 'https://example.com/2' }
  ]
};

// ---------------------------------------------------------------------------
// Mock HTTP server helpers
// ---------------------------------------------------------------------------

interface MockServer {
  baseUrl: string;
  close: () => Promise<void>;
  /** Replace the handler for the next request. */
  setHandler: (fn: (req: IncomingMessage, res: ServerResponse) => void) => void;
}

async function startMockServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(VALID_SEARXNG_RESPONSE));
  }
): Promise<MockServer> {
  let currentHandler = handler;
  const server = createServer((req, res) => currentHandler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    setHandler: (fn) => { currentHandler = fn; }
  };
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe('isValidBaseUrl', () => {
  it('accepts 127.0.0.1 http', () => expect(isValidBaseUrl('http://127.0.0.1:8080')).toBe(true));
  it('accepts localhost http', () => expect(isValidBaseUrl('http://localhost:8080')).toBe(true));
  it('accepts localhost https', () => expect(isValidBaseUrl('https://localhost')).toBe(true));
  it('rejects non-loopback', () => expect(isValidBaseUrl('http://10.0.0.1:8080')).toBe(false));
  it('rejects remote domain', () => expect(isValidBaseUrl('http://searxng.example.com')).toBe(false));
  it('rejects empty string', () => expect(isValidBaseUrl('')).toBe(false));
  it('rejects non-url', () => expect(isValidBaseUrl('not-a-url')).toBe(false));
  it('rejects URL with credentials', () => expect(isValidBaseUrl('******127.0.0.1')).toBe(false));
  it('rejects ftp scheme', () => expect(isValidBaseUrl('ftp://127.0.0.1')).toBe(false));
  it('rejects non-string', () => expect(isValidBaseUrl(123)).toBe(false));
});

describe('validateSearXngConfig', () => {
  it('rejects disabled config with reason disabled', () => {
    expect(() => validateSearXngConfig(makeConfig({ enabled: false }))).toThrow(SearXngConfigError);
    try {
      validateSearXngConfig(makeConfig({ enabled: false }));
    } catch (e) {
      expect((e as SearXngConfigError).reason).toBe('disabled');
    }
  });

  it('rejects invalid baseUrl', () => {
    expect(() =>
      validateSearXngConfig(makeConfig({ baseUrl: 'http://remote.example.com' }))
    ).toThrow(SearXngConfigError);
  });

  it('rejects non-positive timeoutMs', () => {
    expect(() => validateSearXngConfig(makeConfig({ timeoutMs: -1 }))).toThrow(SearXngConfigError);
    expect(() => validateSearXngConfig(makeConfig({ timeoutMs: 0 }))).toThrow(SearXngConfigError);
  });

  it('rejects non-integer maxResults', () => {
    expect(() => validateSearXngConfig(makeConfig({ maxResults: 0.5 }))).toThrow(SearXngConfigError);
    expect(() => validateSearXngConfig(makeConfig({ maxResults: 0 }))).toThrow(SearXngConfigError);
  });

  it('accepts a valid config', () => {
    const cfg = makeConfig({ baseUrl: 'http://127.0.0.1:9090' });
    expect(() => validateSearXngConfig(cfg)).not.toThrow();
  });
});

describe('buildSearXngAdapter', () => {
  it('returns null for undefined config', () => {
    expect(buildSearXngAdapter(undefined)).toBeNull();
  });

  it('returns null for disabled config', () => {
    expect(buildSearXngAdapter(makeConfig({ enabled: false }))).toBeNull();
  });

  it('throws SearXngConfigError for invalid baseUrl when enabled', () => {
    expect(() => buildSearXngAdapter(makeConfig({ baseUrl: 'http://evil.com', enabled: true }))).toThrow(SearXngConfigError);
  });

  it('returns adapter for valid enabled config', () => {
    const adapter = buildSearXngAdapter(makeConfig({ baseUrl: 'http://127.0.0.1:9090' }));
    expect(adapter).not.toBeNull();
    expect(adapter?.kind).toBe('searxng');
  });
});

// ---------------------------------------------------------------------------
// Adapter execute — tool validation
// ---------------------------------------------------------------------------

describe('SearXngTransportAdapter — tool validation', () => {
  let server: MockServer;
  let adapter: SearXngTransportAdapter;

  beforeEach(async () => {
    server = await startMockServer();
    adapter = new SearXngTransportAdapter(
      makeConfig({ baseUrl: server.baseUrl }),
      Date.now,
      () => 'test-id'
    );
  });
  afterEach(() => server.close());

  it('supports the search tool', async () => {
    const result = await adapter.execute(makeRequest());
    expect(result.status).toBe('success');
    expect(result.transportKind).toBe('searxng');
  });

  it('rejects fetch_html with status failed', async () => {
    const result = await adapter.execute(makeRequest({ tool: 'fetch_html' }));
    expect(result.status).toBe('failed');
    expect(result.error).toContain('fetch_html');
  });

  it('rejects fetch_json with status failed', async () => {
    const result = await adapter.execute(makeRequest({ tool: 'fetch_json' }));
    expect(result.status).toBe('failed');
    expect(result.error).toContain('fetch_json');
  });
});

// ---------------------------------------------------------------------------
// Adapter execute — input parsing
// ---------------------------------------------------------------------------

describe('SearXngTransportAdapter — input parsing', () => {
  let server: MockServer;
  let adapter: SearXngTransportAdapter;
  let lastUrl: string | undefined;

  beforeEach(async () => {
    server = await startMockServer((req, res) => {
      lastUrl = req.url ?? '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(VALID_SEARXNG_RESPONSE));
    });
    adapter = new SearXngTransportAdapter(makeConfig({ baseUrl: server.baseUrl }));
    lastUrl = undefined;
  });
  afterEach(() => server.close());

  it('converts a plain string sanitizedInput to a query', async () => {
    const result = await adapter.execute(makeRequest({ sanitizedInput: 'test query' }));
    expect(result.status).toBe('success');
    expect(lastUrl).toContain('q=test+query');
  });

  it('uses input when sanitizedInput is absent', async () => {
    const result = await adapter.execute(makeRequest({ sanitizedInput: undefined, input: 'fallback query' }));
    expect(result.status).toBe('success');
    expect(lastUrl).toContain('q=fallback+query');
  });

  it('accepts a SearXngSearchRequest object as sanitizedInput', async () => {
    const result = await adapter.execute(
      makeRequest({ sanitizedInput: { query: 'object query', language: 'en', safeSearch: 1 } })
    );
    expect(result.status).toBe('success');
    expect(lastUrl).toContain('q=object+query');
    expect(lastUrl).toContain('language=en');
    expect(lastUrl).toContain('safesearch=1');
  });

  it('fails with malformed input (null)', async () => {
    const result = await adapter.execute(makeRequest({ input: null, sanitizedInput: null }));
    expect(result.status).toBe('failed');
    expect(result.error).toBeTruthy();
  });

  it('fails with empty string input', async () => {
    const result = await adapter.execute(makeRequest({ sanitizedInput: '   ' }));
    expect(result.status).toBe('failed');
  });

  it('fails with object missing query field', async () => {
    const result = await adapter.execute(makeRequest({ sanitizedInput: { url: 'http://example.com' } }));
    expect(result.status).toBe('failed');
  });

  it('never mutates the incoming request', async () => {
    const req = makeRequest({ input: 'original', sanitizedInput: 'original' });
    const inputBefore = req.input;
    const sanitizedBefore = req.sanitizedInput;
    await adapter.execute(req);
    expect(req.input).toBe(inputBefore);
    expect(req.sanitizedInput).toBe(sanitizedBefore);
  });
});

// ---------------------------------------------------------------------------
// Adapter execute — HTTP behaviour
// ---------------------------------------------------------------------------

describe('SearXngTransportAdapter — HTTP behaviour', () => {
  let server: MockServer;
  let adapter: SearXngTransportAdapter;

  beforeEach(async () => {
    server = await startMockServer();
    adapter = new SearXngTransportAdapter(makeConfig({ baseUrl: server.baseUrl }));
  });
  afterEach(() => server.close());

  it('sends only GET requests (no POST)', async () => {
    let method: string | undefined;
    server.setHandler((req, res) => {
      method = req.method;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(VALID_SEARXNG_RESPONSE));
    });
    await adapter.execute(makeRequest());
    expect(method).toBe('GET');
  });

  it('sends format=json in the request', async () => {
    let url: string | undefined;
    server.setHandler((req, res) => {
      url = req.url;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(VALID_SEARXNG_RESPONSE));
    });
    await adapter.execute(makeRequest());
    expect(url).toContain('format=json');
  });

  it('does not send cookies or custom secret headers', async () => {
    const headers: Record<string, string | string[] | undefined> = {};
    server.setHandler((req, res) => {
      Object.assign(headers, req.headers);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(VALID_SEARXNG_RESPONSE));
    });
    await adapter.execute(makeRequest());
    expect(headers.cookie).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
    expect(headers['x-api-key']).toBeUndefined();
  });

  it('handles HTTP non-200 responses as failed', async () => {
    server.setHandler((_req, res) => {
      res.writeHead(500);
      res.end('Internal Server Error');
    });
    const result = await adapter.execute(makeRequest());
    expect(result.status).toBe('failed');
    expect(result.error).toContain('500');
  });

  it('handles 404 as failed', async () => {
    server.setHandler((_req, res) => { res.writeHead(404); res.end(); });
    const result = await adapter.execute(makeRequest());
    expect(result.status).toBe('failed');
  });

  it('handles invalid JSON response as failed', async () => {
    server.setHandler((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('not valid json {{{');
    });
    const result = await adapter.execute(makeRequest());
    expect(result.status).toBe('failed');
    expect(result.error).toBeTruthy();
  });

  it('handles missing query field in response as failed', async () => {
    server.setHandler((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: [] })); // missing query
    });
    const result = await adapter.execute(makeRequest());
    expect(result.status).toBe('failed');
  });

  it('handles missing results field in response as failed', async () => {
    server.setHandler((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ query: 'test' })); // missing results
    });
    const result = await adapter.execute(makeRequest());
    expect(result.status).toBe('failed');
  });

  it('parses a valid response into a SearXngSearchResponse output', async () => {
    const result = await adapter.execute(makeRequest());
    expect(result.status).toBe('success');
    const output = result.output as { query: string; results: unknown[] };
    expect(output.query).toBe('bitcoin privacy');
    expect(Array.isArray(output.results)).toBe(true);
  });

  it('applies maxResults trimming', async () => {
    // maxResults = 1; response has 2 results
    const adapterOne = new SearXngTransportAdapter(makeConfig({ baseUrl: server.baseUrl, maxResults: 1 }));
    const result = await adapterOne.execute(makeRequest());
    expect(result.status).toBe('success');
    const output = result.output as { results: unknown[] };
    expect(output.results).toHaveLength(1);
  });

  it('never follows result URLs after a successful search', async () => {
    let requestCount = 0;
    server.setHandler((_req, res) => {
      requestCount++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(VALID_SEARXNG_RESPONSE));
    });
    await adapter.execute(makeRequest());
    // Only one request should have been made (the search); not one per result URL
    expect(requestCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Adapter execute — timeout
// ---------------------------------------------------------------------------

describe('SearXngTransportAdapter — timeout', () => {
  it('handles timeout as failed with timeout message', async () => {
    const server = createServer((_req, _res) => {
      // never respond — simulates a hung server
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    const adapter = new SearXngTransportAdapter(
      makeConfig({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 100 })
    );
    const result = await adapter.execute(makeRequest());
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/timed out/i);

    server.close();
  }, 5000);
});
