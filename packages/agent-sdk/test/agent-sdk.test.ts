/**
 * @gyges/agent-sdk — comprehensive test suite.
 *
 * All tests use a mock fetch so no real network I/O occurs. This verifies:
 *  - default / custom config
 *  - health success
 *  - search allowed / denied / pending
 *  - isAllowed / isDenied / isPending helpers
 *  - approve / reject success
 *  - audit events list
 *  - trust profiles list / single
 *  - incidents list
 *  - runtime profile get / list / switch
 *  - transports list
 *  - timeout handling
 *  - runtime unreachable
 *  - invalid JSON
 *  - non-200 HTTP
 *  - invalid arguments
 *  - no token leak in errors
 *  - no raw input leak in errors
 *  - no direct web call
 *  - no cookies / secret headers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GrlAgentClient } from '../src/client.js';
import { GrlAgentSdkError } from '../src/errors.js';
import { isAllowed, isDenied, isPending } from '../src/search.js';
import { DEFAULT_SDK_CONFIG } from '../src/types.js';

// ---------------------------------------------------------------------------
// Mock fetch utility
// ---------------------------------------------------------------------------

type MockFetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(handler: MockFetchHandler): void {
  vi.stubGlobal('fetch', vi.fn(handler));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}

function networkError(): never {
  throw new TypeError('fetch failed');
}

// Simulates AbortError for timeout tests
function abortError(): never {
  const err = new DOMException('The operation was aborted.', 'AbortError');
  throw err;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('@gyges/agent-sdk', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  describe('default config', () => {
    it('uses the expected defaults', () => {
      expect(DEFAULT_SDK_CONFIG.baseUrl).toBe('http://127.0.0.1:8787');
      expect(DEFAULT_SDK_CONFIG.timeoutMs).toBe(5000);
      expect(DEFAULT_SDK_CONFIG.agentId).toBe('local-agent');
      expect(DEFAULT_SDK_CONFIG.compartmentId).toBe('research');
    });

    it('client applies defaults when no config is given', async () => {
      let capturedUrl = '';
      mockFetch((url) => {
        capturedUrl = url;
        return jsonResponse({ status: 'ok', service: 'grl-server' });
      });

      const client = new GrlAgentClient();
      await client.health();
      expect(capturedUrl).toContain('127.0.0.1:8787');
    });
  });

  describe('custom config', () => {
    it('uses custom baseUrl, agentId and compartmentId', async () => {
      let capturedBody = '';
      mockFetch((_url, init) => {
        if (init?.body) capturedBody = init.body as string;
        return jsonResponse({
          decision: 'allowed',
          reason: 'ok',
          execution: { status: 'success', transportKind: 'mock', output: { results: [] } }
        });
      });

      const client = new GrlAgentClient({
        baseUrl: 'http://127.0.0.1:9999',
        agentId: 'my-agent',
        compartmentId: 'ops'
      });
      await client.search('test query');

      const body = JSON.parse(capturedBody) as Record<string, unknown>;
      expect(body['agentId']).toBe('my-agent');
      expect(body['compartmentId']).toBe('ops');
    });

    it('strips trailing slash from baseUrl', async () => {
      let capturedUrl = '';
      mockFetch((url) => {
        capturedUrl = url;
        return jsonResponse({ status: 'ok', service: 'grl-server' });
      });

      const client = new GrlAgentClient({ baseUrl: 'http://127.0.0.1:8787/' });
      await client.health();
      expect(capturedUrl).toBe('http://127.0.0.1:8787/v1/health');
    });
  });

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  describe('health()', () => {
    it('returns health result on success', async () => {
      mockFetch(() => jsonResponse({ status: 'ok', service: 'grl-server' }));

      const client = new GrlAgentClient();
      const result = await client.health();
      expect(result.status).toBe('ok');
      expect(result.service).toBe('grl-server');
    });
  });

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  describe('search()', () => {
    it('returns allowed result when firewall permits', async () => {
      const mockResults = [
        { title: 'Article', url: 'https://example.com', content: 'text', engine: 'google', score: 0.9 }
      ];
      mockFetch(() =>
        jsonResponse({
          decision: 'allowed',
          reason: 'ok',
          execution: {
            status: 'success',
            transportKind: 'searxng',
            output: { results: mockResults }
          }
        })
      );

      const client = new GrlAgentClient();
      const result = await client.search('bitcoin privacy');

      expect(isAllowed(result)).toBe(true);
      if (isAllowed(result)) {
        expect(result.executionStatus).toBe('success');
        expect(result.transportKind).toBe('searxng');
        expect(result.results).toHaveLength(1);
        expect(result.results![0].title).toBe('Article');
      }
    });

    it('returns denied result when firewall blocks', async () => {
      mockFetch(() =>
        jsonResponse({
          decision: 'denied',
          reason: 'compartment quarantined'
        })
      );

      const client = new GrlAgentClient();
      const result = await client.search('some query');

      expect(isDenied(result)).toBe(true);
      if (isDenied(result)) {
        expect(result.reason).toBe('compartment quarantined');
      }
    });

    it('returns pending result when approval is required', async () => {
      mockFetch(() =>
        jsonResponse({
          decision: 'pending',
          reason: 'requires human approval',
          approvalRequestId: 'req-123',
          approvalToken: 'tok-abc'
        })
      );

      const client = new GrlAgentClient();
      const result = await client.search('sensitive topic');

      expect(isPending(result)).toBe(true);
      if (isPending(result)) {
        expect(result.approvalRequestId).toBe('req-123');
        expect(result.approvalToken).toBe('tok-abc');
      }
    });

    it('posts to /v1/capabilities/execute with tool=search', async () => {
      let capturedUrl = '';
      let capturedBody: Record<string, unknown> = {};
      mockFetch((url, init) => {
        capturedUrl = url;
        if (init?.body) capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return jsonResponse({
          decision: 'allowed',
          reason: 'ok',
          execution: { status: 'success', transportKind: 'mock', output: {} }
        });
      });

      const client = new GrlAgentClient();
      await client.search('my query');

      expect(capturedUrl).toContain('/v1/capabilities/execute');
      expect(capturedBody['tool']).toBe('search');
      expect(capturedBody['riskLevel']).toBe('low');
    });

    it('throws invalid_arguments for empty query', async () => {
      const client = new GrlAgentClient();
      await expect(client.search('')).rejects.toThrow(GrlAgentSdkError);
      await expect(client.search('  ')).rejects.toThrow(GrlAgentSdkError);
    });

    it('does not log query in request headers', async () => {
      let capturedHeaders: Record<string, string> = {};
      mockFetch((_url, init) => {
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        return jsonResponse({
          decision: 'allowed',
          reason: 'ok',
          execution: { status: 'success', transportKind: 'mock', output: {} }
        });
      });

      const client = new GrlAgentClient();
      await client.search('secret search query');

      const headerValues = Object.values(capturedHeaders).join(' ');
      expect(headerValues).not.toContain('secret search query');
    });

    it('does not include cookie or auth headers', async () => {
      let capturedHeaders: Record<string, string> = {};
      mockFetch((_url, init) => {
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        return jsonResponse({
          decision: 'allowed',
          reason: 'ok',
          execution: { status: 'success', transportKind: 'mock', output: {} }
        });
      });

      const client = new GrlAgentClient();
      await client.search('test');

      const headerKeys = Object.keys(capturedHeaders).map((k) => k.toLowerCase());
      expect(headerKeys).not.toContain('cookie');
      expect(headerKeys).not.toContain('authorization');
      expect(headerKeys).not.toContain('x-secret');
    });

    it('only calls local API, never a direct web URL', async () => {
      const calledUrls: string[] = [];
      mockFetch((url) => {
        calledUrls.push(url);
        return jsonResponse({
          decision: 'allowed',
          reason: 'ok',
          execution: { status: 'success', transportKind: 'mock', output: {} }
        });
      });

      const client = new GrlAgentClient();
      await client.search('test');

      for (const url of calledUrls) {
        expect(url).toMatch(/^http:\/\/127\.0\.0\.1/);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Type guards
  // -------------------------------------------------------------------------

  describe('isAllowed / isDenied / isPending', () => {
    it('isAllowed returns true only for allowed status', () => {
      const allowed = { status: 'allowed' as const, executionStatus: 'success' as const, raw: {} };
      const denied = { status: 'denied' as const, reason: 'x', raw: {} };
      const pending = { status: 'pending' as const, reason: 'y', approvalRequestId: 'r', approvalToken: 't', raw: {} };

      expect(isAllowed(allowed)).toBe(true);
      expect(isAllowed(denied)).toBe(false);
      expect(isAllowed(pending)).toBe(false);
    });

    it('isDenied returns true only for denied status', () => {
      const allowed = { status: 'allowed' as const, executionStatus: 'success' as const, raw: {} };
      const denied = { status: 'denied' as const, reason: 'x', raw: {} };
      const pending = { status: 'pending' as const, reason: 'y', approvalRequestId: 'r', approvalToken: 't', raw: {} };

      expect(isDenied(denied)).toBe(true);
      expect(isDenied(allowed)).toBe(false);
      expect(isDenied(pending)).toBe(false);
    });

    it('isPending returns true only for pending status', () => {
      const allowed = { status: 'allowed' as const, executionStatus: 'success' as const, raw: {} };
      const denied = { status: 'denied' as const, reason: 'x', raw: {} };
      const pending = { status: 'pending' as const, reason: 'y', approvalRequestId: 'r', approvalToken: 't', raw: {} };

      expect(isPending(pending)).toBe(true);
      expect(isPending(allowed)).toBe(false);
      expect(isPending(denied)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Approvals
  // -------------------------------------------------------------------------

  describe('approve()', () => {
    it('returns approved status on success', async () => {
      mockFetch(() => jsonResponse({ id: 'req-123', status: 'approved' }));

      const client = new GrlAgentClient();
      const result = await client.approve('req-123', 'tok-abc');

      expect(result.id).toBe('req-123');
      expect(result.status).toBe('approved');
    });

    it('throws invalid_arguments for empty id', async () => {
      const client = new GrlAgentClient();
      await expect(client.approve('', 'tok')).rejects.toThrow(GrlAgentSdkError);
    });

    it('throws invalid_arguments for empty token', async () => {
      const client = new GrlAgentClient();
      await expect(client.approve('id', '')).rejects.toThrow(GrlAgentSdkError);
    });

    it('token is never exposed in error messages', async () => {
      mockFetch(() => jsonResponse({ error: 'not found' }, 404));

      const client = new GrlAgentClient();
      try {
        await client.approve('req-id', 'super-secret-token');
        expect.fail('should have thrown');
      } catch (err) {
        if (err instanceof GrlAgentSdkError) {
          expect(err.message).not.toContain('super-secret-token');
        }
      }
    });
  });

  describe('reject()', () => {
    it('returns rejected status on success', async () => {
      mockFetch(() => jsonResponse({ id: 'req-456', status: 'rejected' }));

      const client = new GrlAgentClient();
      const result = await client.reject('req-456', 'tok-xyz');

      expect(result.id).toBe('req-456');
      expect(result.status).toBe('rejected');
    });

    it('throws invalid_arguments for empty id', async () => {
      const client = new GrlAgentClient();
      await expect(client.reject('', 'tok')).rejects.toThrow(GrlAgentSdkError);
    });

    it('throws invalid_arguments for empty token', async () => {
      const client = new GrlAgentClient();
      await expect(client.reject('id', '')).rejects.toThrow(GrlAgentSdkError);
    });
  });

  // -------------------------------------------------------------------------
  // Audit events
  // -------------------------------------------------------------------------

  describe('listAuditEvents()', () => {
    it('returns audit events list', async () => {
      const events = [
        { id: 'evt-1', timestamp: 1000, type: 'capability_allowed', severity: 'info', message: 'ok' }
      ];
      mockFetch(() => jsonResponse({ events }));

      const client = new GrlAgentClient();
      const result = await client.listAuditEvents();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('evt-1');
    });

    it('passes filters as query params', async () => {
      let capturedUrl = '';
      mockFetch((url) => {
        capturedUrl = url;
        return jsonResponse({ events: [] });
      });

      const client = new GrlAgentClient();
      await client.listAuditEvents({ type: 'capability_denied', severity: 'warn', limit: 10 });

      expect(capturedUrl).toContain('type=capability_denied');
      expect(capturedUrl).toContain('severity=warn');
      expect(capturedUrl).toContain('limit=10');
    });
  });

  // -------------------------------------------------------------------------
  // Trust profiles
  // -------------------------------------------------------------------------

  describe('listTrustProfiles()', () => {
    it('returns trust profiles list', async () => {
      const profiles = [
        { compartmentId: 'research', score: 70, level: 'neutral', createdAt: 1000, updatedAt: 2000 }
      ];
      mockFetch(() => jsonResponse({ profiles }));

      const client = new GrlAgentClient();
      const result = await client.listTrustProfiles();

      expect(result).toHaveLength(1);
      expect(result[0].compartmentId).toBe('research');
      expect(result[0].score).toBe(70);
    });
  });

  describe('getTrustProfile()', () => {
    it('returns a single trust profile', async () => {
      const profile = { compartmentId: 'research', score: 80, level: 'trusted', createdAt: 1000, updatedAt: 2000 };
      mockFetch(() => jsonResponse({ profile }));

      const client = new GrlAgentClient();
      const result = await client.getTrustProfile('research');

      expect(result.compartmentId).toBe('research');
      expect(result.level).toBe('trusted');
    });

    it('throws invalid_arguments for empty compartmentId', async () => {
      const client = new GrlAgentClient();
      await expect(client.getTrustProfile('')).rejects.toThrow(GrlAgentSdkError);
    });
  });

  // -------------------------------------------------------------------------
  // Incidents
  // -------------------------------------------------------------------------

  describe('listIncidents()', () => {
    it('returns incidents list', async () => {
      const incidents = [
        { id: 'inc-1', createdAt: 1000, updatedAt: 2000, severity: 'high', status: 'open', summary: 'rate limit exceeded' }
      ];
      mockFetch(() => jsonResponse({ incidents }));

      const client = new GrlAgentClient();
      const result = await client.listIncidents();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('inc-1');
    });
  });

  // -------------------------------------------------------------------------
  // Runtime profiles
  // -------------------------------------------------------------------------

  describe('getRuntimeProfile()', () => {
    it('returns the active runtime profile', async () => {
      const profile = { name: 'default', packIds: ['base'], enabled: true };
      mockFetch(() => jsonResponse({ profile }));

      const client = new GrlAgentClient();
      const result = await client.getRuntimeProfile();

      expect(result.name).toBe('default');
      expect(result.enabled).toBe(true);
    });
  });

  describe('listRuntimeProfiles()', () => {
    it('returns all runtime profiles', async () => {
      const profiles = [
        { name: 'default', packIds: ['base'], enabled: true },
        { name: 'strict', packIds: ['base', 'strict-privacy'], enabled: false }
      ];
      mockFetch(() => jsonResponse({ profiles }));

      const client = new GrlAgentClient();
      const result = await client.listRuntimeProfiles();

      expect(result).toHaveLength(2);
      expect(result[1].name).toBe('strict');
    });
  });

  describe('switchRuntimeProfile()', () => {
    it('returns switch result', async () => {
      const profile = { name: 'strict', packIds: ['base', 'strict-privacy'], enabled: true };
      mockFetch(() => jsonResponse({ profile, switchedAt: 9999 }));

      const client = new GrlAgentClient();
      const result = await client.switchRuntimeProfile('strict');

      expect(result.profile.name).toBe('strict');
      expect(result.switchedAt).toBe(9999);
    });

    it('throws invalid_arguments for empty name', async () => {
      const client = new GrlAgentClient();
      await expect(client.switchRuntimeProfile('')).rejects.toThrow(GrlAgentSdkError);
    });
  });

  // -------------------------------------------------------------------------
  // Transports
  // -------------------------------------------------------------------------

  describe('listTransports()', () => {
    it('returns transports list', async () => {
      const transports = [
        {
          kind: 'mock',
          name: 'Mock Transport',
          version: '1.0.0',
          supportedTools: ['search'],
          declaredPermissions: [],
          networkAccess: false,
          browserAccess: false,
          filesystemAccess: false,
          processSpawnAccess: false,
          envAccess: false
        }
      ];
      mockFetch(() => jsonResponse({ transports }));

      const client = new GrlAgentClient();
      const result = await client.listTransports();

      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('mock');
      expect(result[0].networkAccess).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('timeout handling', () => {
    it('throws request_timeout on AbortError', async () => {
      mockFetch(() => abortError());

      const client = new GrlAgentClient({ timeoutMs: 1 });

      await expect(client.health()).rejects.toMatchObject({
        code: 'request_timeout'
      });
    });
  });

  describe('runtime unreachable', () => {
    it('throws runtime_unreachable on network error', async () => {
      mockFetch(() => networkError());

      const client = new GrlAgentClient();

      await expect(client.health()).rejects.toMatchObject({
        code: 'runtime_unreachable'
      });
    });
  });

  describe('invalid JSON response', () => {
    it('throws invalid_response when response is not valid JSON', async () => {
      mockFetch(() => textResponse('not json'));

      const client = new GrlAgentClient();

      await expect(client.health()).rejects.toMatchObject({
        code: 'invalid_response'
      });
    });
  });

  describe('non-200 HTTP response', () => {
    it('throws capability_failed on HTTP 500', async () => {
      mockFetch(() => jsonResponse({ error: 'internal server error' }, 500));

      const client = new GrlAgentClient();

      await expect(client.health()).rejects.toMatchObject({
        code: 'capability_failed'
      });
    });

    it('throws capability_failed on HTTP 404', async () => {
      mockFetch(() => jsonResponse({ error: 'not found' }, 404));

      const client = new GrlAgentClient();

      await expect(client.listIncidents()).rejects.toMatchObject({
        code: 'capability_failed'
      });
    });
  });

  describe('invalid_arguments', () => {
    it('search throws for non-string query', async () => {
      const client = new GrlAgentClient();
      // @ts-expect-error intentional type violation for test
      await expect(client.search(42)).rejects.toMatchObject({ code: 'invalid_arguments' });
    });

    it('getTrustProfile throws for empty compartmentId', async () => {
      const client = new GrlAgentClient();
      await expect(client.getTrustProfile('')).rejects.toMatchObject({ code: 'invalid_arguments' });
    });

    it('approve throws for empty id', async () => {
      const client = new GrlAgentClient();
      await expect(client.approve('', 'token')).rejects.toMatchObject({ code: 'invalid_arguments' });
    });

    it('reject throws for empty id', async () => {
      const client = new GrlAgentClient();
      await expect(client.reject('', 'token')).rejects.toMatchObject({ code: 'invalid_arguments' });
    });

    it('switchRuntimeProfile throws for empty name', async () => {
      const client = new GrlAgentClient();
      await expect(client.switchRuntimeProfile('')).rejects.toMatchObject({ code: 'invalid_arguments' });
    });
  });

  describe('GrlAgentSdkError properties', () => {
    it('has name GrlAgentSdkError', () => {
      const err = new GrlAgentSdkError('runtime_unreachable', 'test');
      expect(err.name).toBe('GrlAgentSdkError');
      expect(err.code).toBe('runtime_unreachable');
      expect(err.message).toBe('test');
    });

    it('suppresses stack trace by default', () => {
      const err = new GrlAgentSdkError('request_timeout', 'timeout');
      expect(err.stack).toBeUndefined();
    });

    it('does not include token in error properties', () => {
      const err = new GrlAgentSdkError('capability_failed', 'HTTP 403');
      const serialized = JSON.stringify(err);
      expect(serialized).not.toContain('token');
      expect(serialized).not.toContain('secret');
    });
  });

  describe('no raw input leak', () => {
    it('search error does not contain the query', async () => {
      mockFetch(() => networkError());

      const client = new GrlAgentClient();
      try {
        await client.search('my very private query');
        expect.fail('should have thrown');
      } catch (err) {
        if (err instanceof GrlAgentSdkError) {
          expect(err.message).not.toContain('my very private query');
        }
      }
    });
  });

  describe('requestCapability()', () => {
    it('posts to /v1/capabilities/request', async () => {
      let capturedUrl = '';
      mockFetch((url) => {
        capturedUrl = url;
        return jsonResponse({ decision: 'allowed', reason: 'ok' });
      });

      const client = new GrlAgentClient();
      const result = await client.requestCapability({ tool: 'fetch_html', riskLevel: 'low' });

      expect(capturedUrl).toContain('/v1/capabilities/request');
      expect(result.decision).toBe('allowed');
    });

    it('throws invalid_arguments for missing tool', async () => {
      const client = new GrlAgentClient();
      // @ts-expect-error intentional type violation for test
      await expect(client.requestCapability({ tool: '' })).rejects.toMatchObject({
        code: 'invalid_arguments'
      });
    });
  });
});
