/**
 * Sprint 30 — Agent SDK: network isolation methods.
 *
 * Covers: listRelayProfiles / listRelayRoutes / listNetworkBindings /
 * getNetworkIsolation, the limit filter, correct paths/method, and fail-closed
 * propagation of server errors.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { GrlAgentClient } from '../src/client.js';

type MockFetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function mockFetch(handler: MockFetchHandler): void {
  vi.stubGlobal('fetch', vi.fn(handler));
}
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
afterEach(() => vi.unstubAllGlobals());

const client = new GrlAgentClient({ baseUrl: 'http://127.0.0.1:8787', timeoutMs: 100 });

describe('GrlAgentClient.listRelayProfiles()', () => {
  it('GETs /v1/network/relays and returns relays', async () => {
    let url = '';
    mockFetch((u) => {
      url = u;
      return jsonResponse({ relays: [{ id: 'local-default', name: 'Local', enabled: true, isolationLevel: 'isolated', supportsDnsIsolation: true, tags: [], createdAt: 0 }] });
    });
    const relays = await client.listRelayProfiles();
    expect(url).toContain('/v1/network/relays');
    expect(relays[0].id).toBe('local-default');
  });

  it('serialises the limit filter', async () => {
    let url = '';
    mockFetch((u) => { url = u; return jsonResponse({ relays: [] }); });
    await client.listRelayProfiles({ limit: 5 });
    expect(url).toContain('limit=5');
  });
});

describe('GrlAgentClient.listRelayRoutes()', () => {
  it('GETs /v1/network/routes', async () => {
    let url = '';
    mockFetch((u) => { url = u; return jsonResponse({ routes: [{ id: 'route-001', relayProfileId: 'local-default', assignedAt: 0, active: true }] }); });
    const routes = await client.listRelayRoutes();
    expect(url).toContain('/v1/network/routes');
    expect(routes[0].id).toBe('route-001');
  });
});

describe('GrlAgentClient.listNetworkBindings()', () => {
  it('GETs /v1/network/bindings', async () => {
    let url = '';
    mockFetch((u) => { url = u; return jsonResponse({ bindings: [{ compartmentId: 'research', relayRouteId: 'route-001', isolationLevel: 'isolated', createdAt: 0 }] }); });
    const bindings = await client.listNetworkBindings();
    expect(url).toContain('/v1/network/bindings');
    expect(bindings[0].compartmentId).toBe('research');
  });
});

describe('GrlAgentClient.getNetworkIsolation()', () => {
  it('GETs /v1/network/isolation and returns policies', async () => {
    let method = '';
    let url = '';
    mockFetch((u, init) => {
      url = u; method = init?.method ?? 'GET';
      return jsonResponse({
        dnsPolicy: { enabled: true, isolatePerCompartment: true, isolatePerPersona: false, isolatePerFragment: false },
        rotationPolicy: { enabled: true, rotateOnPersonaChange: true, rotateOnCategoryChange: true, rotateOnCriticalRisk: true, maxAssignmentsPerRoute: 50 }
      });
    });
    const iso = await client.getNetworkIsolation();
    expect(url).toContain('/v1/network/isolation');
    expect(method).toBe('GET');
    expect(iso.dnsPolicy.enabled).toBe(true);
    expect(iso.rotationPolicy.maxAssignmentsPerRoute).toBe(50);
  });

  it('propagates a server error fail-closed', async () => {
    mockFetch(() => jsonResponse({ error: 'boom' }, 500));
    await expect(client.getNetworkIsolation()).rejects.toThrow();
  });

  it('propagates a 400 (invalid limit) fail-closed', async () => {
    mockFetch(() => jsonResponse({ error: 'Invalid limit.' }, 400));
    await expect(client.listRelayRoutes({ limit: -1 })).rejects.toThrow();
  });
});
