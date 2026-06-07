/**
 * Tests for GrlApiClient — covers timeout, non-200, invalid JSON, success parse,
 * and fail-closed behaviour.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { AddressInfo, createServer } from 'node:net';
import http from 'node:http';
import { GrlApiClient } from '../src/client/api-client.js';
import { CliError } from '../src/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

/** Start a minimal HTTP server with a single JSON handler. */
function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ base: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      const base = `http://127.0.0.1:${addr.port}`;
      const close = () =>
        new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
      cleanups.push(close);
      resolve({ base, close });
    });
    server.on('error', reject);
  });
}

function jsonServer(
  status: number,
  body: unknown
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
}

function brokenJsonServer(status: number): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end('not-json{{{');
  };
}

function slowServer(delayMs: number): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'grl-server' }));
    }, delayMs);
  };
}

function client(base: string, timeoutMs = 5000): GrlApiClient {
  return new GrlApiClient({ baseUrl: base, timeoutMs });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GrlApiClient', () => {
  describe('timeout', () => {
    it('throws request_timeout when server is too slow', async () => {
      const { base } = await startServer(slowServer(300));
      const c = client(base, 50);
      await expect(c.health()).rejects.toSatisfy(
        (e: unknown) => e instanceof CliError && e.code === 'request_timeout'
      );
    });
  });

  describe('unreachable', () => {
    it('throws runtime_unreachable when nothing is listening', async () => {
      // Port 1 is never in use in tests
      const c = client('http://127.0.0.1:1', 2000);
      await expect(c.health()).rejects.toSatisfy(
        (e: unknown) => e instanceof CliError && e.code === 'runtime_unreachable'
      );
    });
  });

  describe('non-200 responses', () => {
    it('throws command_failed on 500', async () => {
      const { base } = await startServer(jsonServer(500, { error: 'Internal error' }));
      await expect(client(base).health()).rejects.toSatisfy(
        (e: unknown) => e instanceof CliError && e.code === 'command_failed'
      );
    });

    it('throws command_failed on 404 with error message', async () => {
      const { base } = await startServer(jsonServer(404, { error: 'Not found' }));
      await expect(client(base).getTrustProfile('missing')).rejects.toSatisfy(
        (e: unknown) => e instanceof CliError && e.code === 'command_failed'
      );
    });
  });

  describe('invalid JSON response', () => {
    it('throws invalid_response on 200 with broken JSON', async () => {
      const { base } = await startServer(brokenJsonServer(200));
      await expect(client(base).health()).rejects.toSatisfy(
        (e: unknown) => e instanceof CliError && e.code === 'invalid_response'
      );
    });
  });

  describe('successful parse', () => {
    it('health() returns parsed response', async () => {
      const { base } = await startServer(
        jsonServer(200, { status: 'ok', service: 'grl-server' })
      );
      const result = await client(base).health();
      expect(result.status).toBe('ok');
      expect(result.service).toBe('grl-server');
    });

    it('listTrustProfiles() returns parsed profiles', async () => {
      const fixture = {
        profiles: [
          {
            compartmentId: 'research',
            score: 70,
            level: 'neutral',
            createdAt: 0,
            updatedAt: 0
          }
        ]
      };
      const { base } = await startServer(jsonServer(200, fixture));
      const result = await client(base).listTrustProfiles();
      expect(result.profiles).toHaveLength(1);
      expect(result.profiles[0]?.compartmentId).toBe('research');
    });

    it('listAuditEvents() builds query string correctly', async () => {
      let capturedUrl = '';
      const { base } = await startServer((req, res) => {
        capturedUrl = req.url ?? '';
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ events: [] }));
      });
      await client(base).listAuditEvents({ type: 'execution_failed', limit: 10 });
      expect(capturedUrl).toContain('type=execution_failed');
      expect(capturedUrl).toContain('limit=10');
    });

    it('listPolicyOrchestratorSignals() builds the filter query string', async () => {
      let capturedUrl = '';
      const { base } = await startServer((req, res) => {
        capturedUrl = req.url ?? '';
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ signals: [] }));
      });
      await client(base).listPolicyOrchestratorSignals({
        source: 'multi_agent',
        severity: 'high',
        limit: 5
      });
      expect(capturedUrl).toContain('/v1/runtime/policy-orchestrator/signals');
      expect(capturedUrl).toContain('source=multi_agent');
      expect(capturedUrl).toContain('severity=high');
      expect(capturedUrl).toContain('limit=5');
    });

    it('listPolicyOrchestratorSignals() omits the query when no filters', async () => {
      let capturedUrl = '';
      const { base } = await startServer((req, res) => {
        capturedUrl = req.url ?? '';
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ signals: [] }));
      });
      await client(base).listPolicyOrchestratorSignals();
      expect(capturedUrl).toBe('/v1/runtime/policy-orchestrator/signals');
    });

    it('listIncidents() returns parsed incidents', async () => {
      const { base } = await startServer(jsonServer(200, { incidents: [] }));
      const result = await client(base).listIncidents();
      expect(result.incidents).toEqual([]);
    });

    it('runtimeVersion() returns version', async () => {
      const { base } = await startServer(jsonServer(200, { version: 1 }));
      const result = await client(base).runtimeVersion();
      expect(result.version).toBe(1);
    });

    it('runtimeReload() posts and returns snapshot metadata', async () => {
      let capturedMethod = '';
      const { base } = await startServer((req, res) => {
        capturedMethod = req.method ?? '';
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ version: 2, loadedAt: 123, checksum: 'abc' }));
      });
      const result = await client(base).runtimeReload();
      expect(capturedMethod).toBe('POST');
      expect(result.version).toBe(2);
      expect(result.checksum).toBe('abc');
    });

    it('listTransports() returns transports', async () => {
      const fixture = {
        transports: [
          {
            kind: 'mock',
            name: 'Mock',
            version: '1.0.0',
            supportedTools: ['web_search'],
            declaredPermissions: ['execute_mock'],
            networkAccess: false,
            browserAccess: false,
            filesystemAccess: false,
            processSpawnAccess: false,
            envAccess: false
          }
        ]
      };
      const { base } = await startServer(jsonServer(200, fixture));
      const result = await client(base).listTransports();
      expect(result.transports[0]?.kind).toBe('mock');
    });
  });

  describe('fail-closed guarantees', () => {
    it('does not retry on failure', async () => {
      let callCount = 0;
      const { base } = await startServer((_req, res) => {
        callCount++;
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'fail' }));
      });
      await expect(client(base).health()).rejects.toBeInstanceOf(CliError);
      expect(callCount).toBe(1);
    });
  });
});
