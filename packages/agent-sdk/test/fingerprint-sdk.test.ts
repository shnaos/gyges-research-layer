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

describe('@gyges/agent-sdk — transport fingerprint', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listFingerprintProfiles returns profiles list', async () => {
    mockFetch(() =>
      jsonResponse({
        profiles: [
          {
            agentId: 'agent-a',
            activeFingerprintId: 'fp-1',
            rotationCount: 1,
            requestCount: 2,
            correlationRisk: 'medium',
            assignedUserAgent: 'GRL-Agent/1.0 (compatible; research)',
            assignedLanguage: 'en-US,en;q=0.9',
            createdAt: 1000,
            updatedAt: 2000
          }
        ]
      })
    )
    const client = new GrlAgentClient()
    const result = await client.listFingerprintProfiles()
    expect(result.profiles[0].agentId).toBe('agent-a')
  })

  it('getFingerprintProfile encodes agentId in URL', async () => {
    let capturedUrl = ''
    mockFetch((url) => {
      capturedUrl = url
      return jsonResponse({
        agentId: 'agent/x y',
        profile: {
          agentId: 'agent/x y',
          activeFingerprintId: 'fp-1',
          rotationCount: 0,
          requestCount: 1,
          correlationRisk: 'low',
          assignedUserAgent: 'GRL-Agent/1.0 (compatible; research)',
          assignedLanguage: 'en-US,en;q=0.9',
          createdAt: 1000,
          updatedAt: 2000
        }
      })
    })
    const client = new GrlAgentClient()
    const result = await client.getFingerprintProfile('agent/x y')
    expect(capturedUrl).toContain(encodeURIComponent('agent/x y'))
    expect(result.profile.activeFingerprintId).toBe('fp-1')
  })

  it('getFingerprintProfile throws on empty agentId', async () => {
    const client = new GrlAgentClient()
    await expect(client.getFingerprintProfile('')).rejects.toThrow(GrlAgentSdkError)
  })

  it('listHeaderProfiles returns header profiles', async () => {
    mockFetch(() =>
      jsonResponse({
        profiles: [
          {
            id: 'fp-1',
            userAgent: 'GRL-Agent/1.0 (compatible; research)',
            acceptLanguage: 'en-US,en;q=0.9',
            createdAt: 1000,
            active: true
          }
        ]
      })
    )
    const client = new GrlAgentClient()
    const result = await client.listHeaderProfiles()
    expect(result.profiles[0].id).toBe('fp-1')
    expect(result.profiles[0].active).toBe(true)
  })

  it('getHeaderPolicies returns policy', async () => {
    mockFetch(() =>
      jsonResponse({
        policy: {
          enabled: true,
          rotateOnPersonaChange: true,
          rotateOnTemporalEscalation: false,
          maxRequestsPerFingerprint: 50,
          strictSensitiveCategoryIsolation: true
        }
      })
    )
    const client = new GrlAgentClient()
    const result = await client.getHeaderPolicies()
    expect(result.policy.maxRequestsPerFingerprint).toBe(50)
  })
})
