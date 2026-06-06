import { AddressInfo } from 'node:net'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { TemporalObfuscationEngine } from '../../../packages/core/src/index.js'
import {
  DEFAULT_HOST,
  buildApprovalQueue,
  buildBootstrapFirewall,
  buildCompartmentTrustEngine,
  buildIncidentDetector,
  buildRuntimeSecurityHeuristicsEngine,
  buildSecurityEventEngine,
  createLocalApiApp,
  type LocalApiOptions
} from '../src/local-api.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

function makeTemporalEngine(): TemporalObfuscationEngine {
  let seq = 0
  return new TemporalObfuscationEngine({ now: () => 10_000 + seq++ * 1000 })
}

async function startApp(
  extra: Partial<LocalApiOptions> = {}
): Promise<{ base: string; engine: TemporalObfuscationEngine }> {
  const engine = extra.temporalObfuscationEngine ?? makeTemporalEngine()
  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    approvalQueue: buildApprovalQueue(),
    securityEventEngine: buildSecurityEventEngine(),
    heuristicsEngine: buildRuntimeSecurityHeuristicsEngine(),
    incidentDetector: buildIncidentDetector(),
    trustEngine: buildCompartmentTrustEngine(),
    temporalObfuscationEngine: engine,
    ...extra
  })
  const server = app.listen(0, DEFAULT_HOST)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address() as AddressInfo
  cleanups.push(() => server.close())
  return { base: `http://${DEFAULT_HOST}:${address.port}`, engine }
}

async function rawRequest(
  base: string,
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${base}${path}`, init)
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { json = null }
  return { status: res.status, json, text }
}

function executeMock(
  base: string,
  body: unknown
): Promise<{ status: number; json: any; text: string }> {
  return rawRequest(base, '/v1/capabilities/execute-mock', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

const ALLOW_BODY = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'search',
  riskLevel: 'low',
  input: { q: 'test-query' }
}

// ---------------------------------------------------------------------------
// GET /v1/privacy/temporal/profiles
// ---------------------------------------------------------------------------
describe('GET /v1/privacy/temporal/profiles', () => {
  it('returns empty list before any executions', async () => {
    const { base } = await startApp()
    const { status, json } = await rawRequest(base, '/v1/privacy/temporal/profiles')
    expect(status).toBe(200)
    expect(json.profiles).toBeInstanceOf(Array)
    expect(json.profiles).toHaveLength(0)
  })

  it('returns a profile after execute-mock runs', async () => {
    const { base } = await startApp()
    await executeMock(base, ALLOW_BODY)
    const { status, json } = await rawRequest(base, '/v1/privacy/temporal/profiles')
    expect(status).toBe(200)
    expect(json.profiles.length).toBeGreaterThan(0)
    const profile = json.profiles[0]
    expect(profile.agentId).toBe('local-agent')
    expect(['low', 'medium', 'high', 'critical']).toContain(profile.cadenceRisk)
    expect(typeof profile.detectedBursts).toBe('number')
    expect(typeof profile.smoothedRequests).toBe('number')
    expect(typeof profile.currentDelayMs).toBe('number')
  })

  it('does not expose raw input or tokens', async () => {
    const { base } = await startApp()
    await executeMock(base, ALLOW_BODY)
    const { json } = await rawRequest(base, '/v1/privacy/temporal/profiles')
    const profileStr = JSON.stringify(json)
    expect(profileStr).not.toContain('test-query')
    expect(profileStr).not.toContain('token')
    expect(profileStr).not.toContain('secret')
  })

  it('405 on non-GET', async () => {
    const { base } = await startApp()
    const { status } = await rawRequest(base, '/v1/privacy/temporal/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(status).toBe(405)
  })
})

// ---------------------------------------------------------------------------
// GET /v1/privacy/temporal/profiles/:agentId
// ---------------------------------------------------------------------------
describe('GET /v1/privacy/temporal/profiles/:agentId', () => {
  it('returns 404 for unknown agent', async () => {
    const { base } = await startApp()
    const { status, json } = await rawRequest(base, '/v1/privacy/temporal/profiles/ghost-agent')
    expect(status).toBe(404)
    expect(json.error).toMatch(/not found/i)
  })

  it('returns the profile after execution', async () => {
    const { base } = await startApp()
    await executeMock(base, ALLOW_BODY)
    const { status, json } = await rawRequest(base, '/v1/privacy/temporal/profiles/local-agent')
    expect(status).toBe(200)
    expect(json.profile.agentId).toBe('local-agent')
    expect(json.profile.temporalBudget).toBeDefined()
    expect(typeof json.profile.temporalBudget.consumed).toBe('number')
  })

  it('405 on non-GET', async () => {
    const { base } = await startApp()
    const { status } = await rawRequest(base, '/v1/privacy/temporal/profiles/local-agent', { method: 'DELETE' })
    expect(status).toBe(405)
  })
})

// ---------------------------------------------------------------------------
// GET /v1/privacy/temporal/budgets
// ---------------------------------------------------------------------------
describe('GET /v1/privacy/temporal/budgets', () => {
  it('returns budgets list', async () => {
    const { base } = await startApp()
    await executeMock(base, ALLOW_BODY)
    const { status, json } = await rawRequest(base, '/v1/privacy/temporal/budgets')
    expect(status).toBe(200)
    expect(json.budgets).toBeInstanceOf(Array)
  })

  it('budget shape has required fields', async () => {
    const { base } = await startApp()
    await executeMock(base, ALLOW_BODY)
    const { json } = await rawRequest(base, '/v1/privacy/temporal/budgets')
    if (json.budgets.length > 0) {
      const b = json.budgets[0]
      expect(typeof b.maxRequestsPerWindow).toBe('number')
      expect(typeof b.consumed).toBe('number')
      expect(typeof b.remaining).toBe('number')
      expect(typeof b.resetsAt).toBe('number')
    }
  })

  it('405 on non-GET', async () => {
    const { base } = await startApp()
    const { status } = await rawRequest(base, '/v1/privacy/temporal/budgets', { method: 'PUT' })
    expect(status).toBe(405)
  })
})

// ---------------------------------------------------------------------------
// GET /v1/privacy/temporal/budgets/:agentId
// ---------------------------------------------------------------------------
describe('GET /v1/privacy/temporal/budgets/:agentId', () => {
  it('returns budget even for first-time agent (auto-created)', async () => {
    const { base } = await startApp()
    const { status, json } = await rawRequest(base, '/v1/privacy/temporal/budgets/any-new-agent')
    expect(status).toBe(200)
    expect(json.agentId).toBe('any-new-agent')
    expect(typeof json.budget.remaining).toBe('number')
  })

  it('405 on non-GET', async () => {
    const { base } = await startApp()
    const { status } = await rawRequest(base, '/v1/privacy/temporal/budgets/local-agent', { method: 'DELETE' })
    expect(status).toBe(405)
  })
})

// ---------------------------------------------------------------------------
// GET /v1/privacy/temporal/policies
// ---------------------------------------------------------------------------
describe('GET /v1/privacy/temporal/policies', () => {
  it('returns cadence, burst and budget policies', async () => {
    const { base } = await startApp()
    const { status, json } = await rawRequest(base, '/v1/privacy/temporal/policies')
    expect(status).toBe(200)
    expect(json.cadencePolicy).toBeDefined()
    expect(json.burstPolicy).toBeDefined()
    expect(json.budgetPolicy).toBeDefined()
    expect(typeof json.cadencePolicy.minSpacingMs).toBe('number')
    expect(typeof json.burstPolicy.burstThreshold).toBe('number')
    expect(typeof json.budgetPolicy.maxRequestsPerWindow).toBe('number')
  })

  it('405 on non-GET', async () => {
    const { base } = await startApp()
    const { status } = await rawRequest(base, '/v1/privacy/temporal/policies', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(status).toBe(405)
  })
})

// ---------------------------------------------------------------------------
// execute-mock includes temporal metadata
// ---------------------------------------------------------------------------
describe('execute-mock temporal metadata', () => {
  it('allowed response includes temporalObfuscation metadata', async () => {
    const { base } = await startApp()
    const { json } = await executeMock(base, ALLOW_BODY)
    expect(json.decision).toBe('allowed')
    expect(json.temporalObfuscation).toBeDefined()
    expect(['low', 'medium', 'high', 'critical']).toContain(json.temporalObfuscation.cadenceRisk)
    expect(typeof json.temporalObfuscation.delayMs).toBe('number')
    expect(typeof json.temporalObfuscation.detectedBursts).toBe('number')
    expect(typeof json.temporalObfuscation.smoothedRequests).toBe('number')
    expect(typeof json.temporalObfuscation.budgetConsumed).toBe('number')
    expect(typeof json.temporalObfuscation.budgetRemaining).toBe('number')
  })

  it('temporal metadata does not contain raw input', async () => {
    const { base } = await startApp()
    const { json } = await executeMock(base, ALLOW_BODY)
    const str = JSON.stringify(json.temporalObfuscation ?? {})
    expect(str).not.toContain('test-query')
    expect(str).not.toContain('token')
    expect(str).not.toContain('secret')
  })

  it('burst escalation visible in temporalObfuscation after rapid requests', async () => {
    const burstEngine = new TemporalObfuscationEngine({
      now: Date.now,
      burstPolicy: { enabled: true, burstThreshold: 2, burstWindowMs: 30_000, cooldownMs: 5000 }
    })
    const { base } = await startApp({ temporalObfuscationEngine: burstEngine })
    await executeMock(base, ALLOW_BODY)
    await executeMock(base, ALLOW_BODY)
    const { json } = await executeMock(base, ALLOW_BODY)
    // After 3 requests with threshold 2, burst state should be active
    expect(json.temporalObfuscation).toBeDefined()
    expect(json.temporalObfuscation.detectedBursts).toBeGreaterThan(0)
  })
})
