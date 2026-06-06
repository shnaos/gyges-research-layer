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

const SAMPLE_BUDGET = {
  maxRequestsPerWindow: 60,
  windowMs: 60000,
  consumed: 5,
  remaining: 55,
  resetsAt: 70000
}

const SAMPLE_PROFILE = {
  agentId: 'agent-a',
  createdAt: 1000,
  updatedAt: 2000,
  cadenceRisk: 'low',
  recentExecutionTimestamps: [1000, 2000],
  detectedBursts: 0,
  smoothedRequests: 2,
  temporalBudget: SAMPLE_BUDGET,
  currentDelayMs: 0
}

describe('@gyges/agent-sdk — temporal obfuscation (Sprint 26)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // -------------------------------------------------------------------------
  // listTemporalProfiles
  // -------------------------------------------------------------------------
  it('listTemporalProfiles — returns profiles list', async () => {
    mockFetch(() => jsonResponse({ profiles: [SAMPLE_PROFILE] }))
    const client = new GrlAgentClient()
    const result = await client.listTemporalProfiles()
    expect(result.profiles).toHaveLength(1)
    expect(result.profiles[0].agentId).toBe('agent-a')
    expect(result.profiles[0].cadenceRisk).toBe('low')
  })

  it('listTemporalProfiles — calls correct endpoint', async () => {
    let capturedUrl = ''
    mockFetch((url) => {
      capturedUrl = url
      return jsonResponse({ profiles: [] })
    })
    const client = new GrlAgentClient()
    await client.listTemporalProfiles()
    expect(capturedUrl).toContain('/v1/privacy/temporal/profiles')
  })

  // -------------------------------------------------------------------------
  // getTemporalProfile
  // -------------------------------------------------------------------------
  it('getTemporalProfile — returns single profile', async () => {
    mockFetch(() => jsonResponse({ profile: SAMPLE_PROFILE }))
    const client = new GrlAgentClient()
    const result = await client.getTemporalProfile('agent-a')
    expect(result.profile.agentId).toBe('agent-a')
    expect(result.profile.temporalBudget.remaining).toBe(55)
  })

  it('getTemporalProfile — encodes agentId in URL', async () => {
    let capturedUrl = ''
    mockFetch((url) => {
      capturedUrl = url
      return jsonResponse({ profile: SAMPLE_PROFILE })
    })
    const client = new GrlAgentClient()
    await client.getTemporalProfile('agent/x y')
    expect(capturedUrl).toContain(encodeURIComponent('agent/x y'))
  })

  it('getTemporalProfile — throws on empty agentId', async () => {
    const client = new GrlAgentClient()
    await expect(client.getTemporalProfile('')).rejects.toThrow(GrlAgentSdkError)
  })

  // -------------------------------------------------------------------------
  // listTemporalBudgets
  // -------------------------------------------------------------------------
  it('listTemporalBudgets — returns budgets list', async () => {
    mockFetch(() => jsonResponse({ budgets: [SAMPLE_BUDGET] }))
    const client = new GrlAgentClient()
    const result = await client.listTemporalBudgets()
    expect(result.budgets).toHaveLength(1)
    expect(result.budgets[0].consumed).toBe(5)
    expect(result.budgets[0].remaining).toBe(55)
  })

  it('listTemporalBudgets — calls correct endpoint', async () => {
    let capturedUrl = ''
    mockFetch((url) => {
      capturedUrl = url
      return jsonResponse({ budgets: [] })
    })
    const client = new GrlAgentClient()
    await client.listTemporalBudgets()
    expect(capturedUrl).toContain('/v1/privacy/temporal/budgets')
  })

  // -------------------------------------------------------------------------
  // getTemporalBudget
  // -------------------------------------------------------------------------
  it('getTemporalBudget — returns budget for agent', async () => {
    mockFetch(() => jsonResponse({ agentId: 'agent-a', budget: SAMPLE_BUDGET }))
    const client = new GrlAgentClient()
    const result = await client.getTemporalBudget('agent-a')
    expect(result.agentId).toBe('agent-a')
    expect(result.budget.maxRequestsPerWindow).toBe(60)
    expect(result.budget.remaining).toBe(55)
  })

  it('getTemporalBudget — encodes agentId in URL', async () => {
    let capturedUrl = ''
    mockFetch((url) => {
      capturedUrl = url
      return jsonResponse({ agentId: 'agent-a', budget: SAMPLE_BUDGET })
    })
    const client = new GrlAgentClient()
    await client.getTemporalBudget('agent/special')
    expect(capturedUrl).toContain(encodeURIComponent('agent/special'))
  })

  it('getTemporalBudget — throws on empty agentId', async () => {
    const client = new GrlAgentClient()
    await expect(client.getTemporalBudget('')).rejects.toThrow(GrlAgentSdkError)
  })
})
