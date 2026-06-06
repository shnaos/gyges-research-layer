/**
 * @gyges/agent-sdk — agent management method tests.
 *
 * All tests use a mock fetch so no real network I/O occurs.
 *
 * Covers:
 *  - listAgents
 *  - getAgent
 *  - listAgentLeases
 *  - getAgentTrust
 *  - restrictAgent
 *  - evictAgent
 *  - invalid argument validation
 *  - non-200 HTTP handling
 *  - no token / secret leak
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { GrlAgentClient } from '../src/client.js';
import { GrlAgentSdkError } from '../src/errors.js';

// ---------------------------------------------------------------------------
// Mock fetch utility (mirrors agent-sdk.test.ts pattern)
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const QUOTA_FIXTURE = {
  maxConcurrentExecutions: 5,
  maxSessions: 10,
  maxApprovalsPending: 20,
  maxAuditEvents: 1000,
  maxIncidents: 50
};

const AGENT_A = {
  agentId: 'agent-a',
  status: 'idle',
  trustScore: 70,
  activeSessions: 0,
  activeExecutions: 0,
  compartments: [],
  createdAt: 1000,
  updatedAt: 1000,
  quota: QUOTA_FIXTURE
};

const AGENTS_RESPONSE = { agents: [AGENT_A] };
const AGENT_RESPONSE = { agent: AGENT_A };

const LEASES_RESPONSE = {
  agentId: 'agent-a',
  leases: [
    {
      id: 'lease-1',
      acquiredAt: 1000,
      expiresAt: 301000,
      renewable: true,
      holderAgentId: 'agent-a'
    }
  ]
};

const TRUST_RESPONSE = {
  trust: {
    agentId: 'agent-a',
    trustScore: 70,
    status: 'idle'
  }
};

const RESTRICT_RESPONSE = {
  agentId: 'agent-a',
  status: 'restricted',
  updatedAt: 2000
};

const EVICT_RESPONSE = {
  agentId: 'agent-a',
  status: 'evicted',
  updatedAt: 3000
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('@gyges/agent-sdk — agent management', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // listAgents
  // -------------------------------------------------------------------------

  describe('listAgents', () => {
    it('returns an array of agent runtime infos', async () => {
      mockFetch(() => jsonResponse(AGENTS_RESPONSE));
      const client = new GrlAgentClient();
      const agents = await client.listAgents();
      expect(Array.isArray(agents)).toBe(true);
      expect(agents[0].agentId).toBe('agent-a');
      expect(agents[0].status).toBe('idle');
    });

    it('calls GET /v1/agents', async () => {
      let capturedUrl = '';
      mockFetch((url) => {
        capturedUrl = url;
        return jsonResponse(AGENTS_RESPONSE);
      });
      const client = new GrlAgentClient();
      await client.listAgents();
      expect(capturedUrl).toContain('/v1/agents');
    });

    it('throws GrlAgentSdkError on non-200', async () => {
      mockFetch(() => jsonResponse({ error: 'server error' }, 500));
      const client = new GrlAgentClient();
      await expect(client.listAgents()).rejects.toBeInstanceOf(GrlAgentSdkError);
    });

    it('returns empty array when no agents are registered', async () => {
      mockFetch(() => jsonResponse({ agents: [] }));
      const client = new GrlAgentClient();
      const agents = await client.listAgents();
      expect(agents).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // getAgent
  // -------------------------------------------------------------------------

  describe('getAgent', () => {
    it('returns a single agent runtime info', async () => {
      mockFetch(() => jsonResponse(AGENT_RESPONSE));
      const client = new GrlAgentClient();
      const agent = await client.getAgent('agent-a');
      expect(agent.agentId).toBe('agent-a');
      expect(agent.trustScore).toBe(70);
      expect(agent.quota).toBeDefined();
    });

    it('calls GET /v1/agents/:agentId', async () => {
      let capturedUrl = '';
      mockFetch((url) => {
        capturedUrl = url;
        return jsonResponse(AGENT_RESPONSE);
      });
      const client = new GrlAgentClient();
      await client.getAgent('agent-a');
      expect(capturedUrl).toContain('/v1/agents/agent-a');
    });

    it('throws GrlAgentSdkError for invalid agentId', async () => {
      const client = new GrlAgentClient();
      await expect(client.getAgent('')).rejects.toBeInstanceOf(GrlAgentSdkError);
    });

    it('throws GrlAgentSdkError on 404', async () => {
      mockFetch(() => jsonResponse({ error: 'not found' }, 404));
      const client = new GrlAgentClient();
      await expect(client.getAgent('nobody')).rejects.toBeInstanceOf(GrlAgentSdkError);
    });
  });

  // -------------------------------------------------------------------------
  // listAgentLeases
  // -------------------------------------------------------------------------

  describe('listAgentLeases', () => {
    it('returns an array of lease infos', async () => {
      mockFetch(() => jsonResponse(LEASES_RESPONSE));
      const client = new GrlAgentClient();
      const leases = await client.listAgentLeases('agent-a');
      expect(Array.isArray(leases)).toBe(true);
      expect(leases[0].id).toBe('lease-1');
      expect(leases[0].holderAgentId).toBe('agent-a');
    });

    it('calls GET /v1/agents/:agentId/leases', async () => {
      let capturedUrl = '';
      mockFetch((url) => {
        capturedUrl = url;
        return jsonResponse(LEASES_RESPONSE);
      });
      const client = new GrlAgentClient();
      await client.listAgentLeases('agent-a');
      expect(capturedUrl).toContain('/v1/agents/agent-a/leases');
    });

    it('throws GrlAgentSdkError for invalid agentId', async () => {
      const client = new GrlAgentClient();
      await expect(client.listAgentLeases('')).rejects.toBeInstanceOf(GrlAgentSdkError);
    });

    it('returns empty array when no leases exist', async () => {
      mockFetch(() => jsonResponse({ agentId: 'agent-a', leases: [] }));
      const client = new GrlAgentClient();
      const leases = await client.listAgentLeases('agent-a');
      expect(leases).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // getAgentTrust
  // -------------------------------------------------------------------------

  describe('getAgentTrust', () => {
    it('returns agent trust info', async () => {
      mockFetch(() => jsonResponse(TRUST_RESPONSE));
      const client = new GrlAgentClient();
      const trust = await client.getAgentTrust('agent-a');
      expect(trust.agentId).toBe('agent-a');
      expect(trust.trustScore).toBe(70);
      expect(trust.status).toBe('idle');
    });

    it('calls GET /v1/agents/:agentId/trust', async () => {
      let capturedUrl = '';
      mockFetch((url) => {
        capturedUrl = url;
        return jsonResponse(TRUST_RESPONSE);
      });
      const client = new GrlAgentClient();
      await client.getAgentTrust('agent-a');
      expect(capturedUrl).toContain('/v1/agents/agent-a/trust');
    });

    it('throws GrlAgentSdkError for invalid agentId', async () => {
      const client = new GrlAgentClient();
      await expect(client.getAgentTrust('')).rejects.toBeInstanceOf(GrlAgentSdkError);
    });
  });

  // -------------------------------------------------------------------------
  // restrictAgent
  // -------------------------------------------------------------------------

  describe('restrictAgent', () => {
    it('returns an AgentActionResult with restricted status', async () => {
      mockFetch(() => jsonResponse(RESTRICT_RESPONSE));
      const client = new GrlAgentClient();
      const result = await client.restrictAgent('agent-a');
      expect(result.agentId).toBe('agent-a');
      expect(result.status).toBe('restricted');
      expect(typeof result.updatedAt).toBe('number');
    });

    it('calls POST /v1/agents/:agentId/restrict', async () => {
      let capturedUrl = '';
      let capturedMethod = '';
      mockFetch((url, init) => {
        capturedUrl = url;
        capturedMethod = init?.method ?? '';
        return jsonResponse(RESTRICT_RESPONSE);
      });
      const client = new GrlAgentClient();
      await client.restrictAgent('agent-a');
      expect(capturedUrl).toContain('/v1/agents/agent-a/restrict');
      expect(capturedMethod).toBe('POST');
    });

    it('throws GrlAgentSdkError for invalid agentId', async () => {
      const client = new GrlAgentClient();
      await expect(client.restrictAgent('')).rejects.toBeInstanceOf(GrlAgentSdkError);
    });

    it('throws GrlAgentSdkError on 400 (e.g. evicted agent)', async () => {
      mockFetch(() => jsonResponse({ error: 'Cannot restrict an evicted agent.' }, 400));
      const client = new GrlAgentClient();
      await expect(client.restrictAgent('agent-a')).rejects.toBeInstanceOf(GrlAgentSdkError);
    });
  });

  // -------------------------------------------------------------------------
  // evictAgent
  // -------------------------------------------------------------------------

  describe('evictAgent', () => {
    it('returns an AgentActionResult with evicted status', async () => {
      mockFetch(() => jsonResponse(EVICT_RESPONSE));
      const client = new GrlAgentClient();
      const result = await client.evictAgent('agent-a');
      expect(result.agentId).toBe('agent-a');
      expect(result.status).toBe('evicted');
      expect(typeof result.updatedAt).toBe('number');
    });

    it('calls POST /v1/agents/:agentId/evict', async () => {
      let capturedUrl = '';
      let capturedMethod = '';
      mockFetch((url, init) => {
        capturedUrl = url;
        capturedMethod = init?.method ?? '';
        return jsonResponse(EVICT_RESPONSE);
      });
      const client = new GrlAgentClient();
      await client.evictAgent('agent-a');
      expect(capturedUrl).toContain('/v1/agents/agent-a/evict');
      expect(capturedMethod).toBe('POST');
    });

    it('throws GrlAgentSdkError for invalid agentId', async () => {
      const client = new GrlAgentClient();
      await expect(client.evictAgent('')).rejects.toBeInstanceOf(GrlAgentSdkError);
    });

    it('throws GrlAgentSdkError on 404 (unknown agent)', async () => {
      mockFetch(() => jsonResponse({ error: 'not found' }, 404));
      const client = new GrlAgentClient();
      await expect(client.evictAgent('nobody')).rejects.toBeInstanceOf(GrlAgentSdkError);
    });
  });

  // -------------------------------------------------------------------------
  // Security guarantees
  // -------------------------------------------------------------------------

  describe('security guarantees', () => {
    it('does not send secret headers', async () => {
      let capturedHeaders: Record<string, string> = {};
      mockFetch((_url, init) => {
        capturedHeaders = Object.fromEntries(
          Object.entries((init?.headers as Record<string, string>) ?? {})
        );
        return jsonResponse(AGENTS_RESPONSE);
      });
      const client = new GrlAgentClient();
      await client.listAgents();
      const keys = Object.keys(capturedHeaders).map((k) => k.toLowerCase());
      expect(keys).not.toContain('authorization');
      expect(keys).not.toContain('cookie');
    });

    it('error messages do not contain raw input', async () => {
      mockFetch(() => jsonResponse({ error: 'server error' }, 500));
      const client = new GrlAgentClient();
      try {
        await client.listAgents();
        expect.fail('should have thrown');
      } catch (err) {
        if (err instanceof GrlAgentSdkError) {
          expect(err.message).not.toContain('password');
          expect(err.message).not.toContain('secret');
        }
      }
    });
  });
});
