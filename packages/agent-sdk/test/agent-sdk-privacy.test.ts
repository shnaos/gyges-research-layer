import { afterEach, describe, expect, it, vi } from 'vitest'
import { GrlAgentClient } from '../src/client.js'
import { GrlAgentSdkError } from '../src/errors.js'

type MockFetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>

function mockFetch(handler: MockFetchHandler): void {
  vi.stubGlobal('fetch', vi.fn(handler))
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('@gyges/agent-sdk — behavioral privacy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists behavioral profiles', async () => {
    mockFetch(() =>
      jsonResponse({
        profiles: [
          {
            agentId: 'agent-a',
            createdAt: 0,
            updatedAt: 1,
            correlationRisk: 'medium',
            activeIdentityFragments: 2,
            recentSearchTopics: ['privacy'],
            temporalPatternsDetected: 4,
            repeatedBehaviorScore: 35
          }
        ]
      })
    )
    const client = new GrlAgentClient()
    const result = await client.listBehavioralProfiles()
    expect(result.profiles[0].agentId).toBe('agent-a')
  })

  it('gets a behavioral profile by agent id', async () => {
    let capturedUrl = ''
    mockFetch((url) => {
      capturedUrl = url
      return jsonResponse({
        profile: {
          agentId: 'agent-a',
          createdAt: 0,
          updatedAt: 1,
          correlationRisk: 'low',
          activeIdentityFragments: 1,
          recentSearchTopics: [],
          temporalPatternsDetected: 0,
          repeatedBehaviorScore: 0
        }
      })
    })
    const client = new GrlAgentClient()
    const result = await client.getBehavioralProfile('agent-a')
    expect(capturedUrl).toContain('/v1/privacy/behavioral/profiles/agent-a')
    expect(result.profile.agentId).toBe('agent-a')
  })

  it('validates behavioral profile arguments', async () => {
    const client = new GrlAgentClient()
    await expect(client.getBehavioralProfile('')).rejects.toBeInstanceOf(GrlAgentSdkError)
  })

  it('lists identity fragments with and without agent filters', async () => {
    const called: string[] = []
    mockFetch((url) => {
      called.push(url)
      return jsonResponse({ fragments: [] })
    })
    const client = new GrlAgentClient()
    await client.listIdentityFragments()
    await client.listIdentityFragments('agent-a')
    expect(called[0]).toContain('/v1/privacy/fragments')
    expect(called[1]).toContain('/v1/privacy/fragments/agent-a')
  })
})

// ---------------------------------------------------------------------------
// Sprint 25 — Persona Isolation SDK tests
// ---------------------------------------------------------------------------

describe('@gyges/agent-sdk — persona isolation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listPersonas returns all personas', async () => {
    mockFetch(() =>
      jsonResponse({
        personas: [
          {
            id: 'persona-1',
            agentId: 'agent-a',
            createdAt: 1000,
            updatedAt: 2000,
            category: 'finance',
            active: true,
            fragmentIds: [],
            isolatedSessionIds: [],
            searchCount: 3,
            correlationRisk: 'low'
          }
        ]
      })
    )
    const client = new GrlAgentClient()
    const result = await client.listPersonas()
    expect((result as any).personas[0].agentId).toBe('agent-a')
  })

  it('listPersonas scopes to agentId when provided', async () => {
    const called: string[] = []
    mockFetch((url) => {
      called.push(url)
      return jsonResponse({ agentId: 'agent-a', personas: [] })
    })
    const client = new GrlAgentClient()
    await client.listPersonas('agent-a')
    expect(called[0]).toContain('/v1/privacy/personas/agent-a')
  })

  it('getPersonas validates agentId argument', async () => {
    const client = new GrlAgentClient()
    await expect(client.getPersonas('')).rejects.toBeInstanceOf(GrlAgentSdkError)
  })

  it('getPersonas calls the correct endpoint', async () => {
    const called: string[] = []
    mockFetch((url) => {
      called.push(url)
      return jsonResponse({ agentId: 'agent-b', personas: [] })
    })
    const client = new GrlAgentClient()
    await client.getPersonas('agent-b')
    expect(called[0]).toContain('/v1/privacy/personas/agent-b')
  })

  it('listPersonaBindings returns all bindings', async () => {
    mockFetch(() =>
      jsonResponse({
        bindings: [
          { personaId: 'persona-1', fragmentId: 'frag-1', createdAt: 1000, active: true }
        ]
      })
    )
    const client = new GrlAgentClient()
    const result = await client.listPersonaBindings()
    expect((result as any).bindings[0].personaId).toBe('persona-1')
  })

  it('listPersonaBindings scopes to agentId when provided', async () => {
    const called: string[] = []
    mockFetch((url) => {
      called.push(url)
      return jsonResponse({ agentId: 'agent-a', bindings: [] })
    })
    const client = new GrlAgentClient()
    await client.listPersonaBindings('agent-a')
    expect(called[0]).toContain('/v1/privacy/persona-bindings/agent-a')
  })
})
