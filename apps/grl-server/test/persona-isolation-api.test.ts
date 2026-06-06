import { AddressInfo } from 'node:net'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { PersonaIsolationEngine } from '../../../packages/core/src/index.js'
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

function makePersonaEngine(): PersonaIsolationEngine {
  let seq = 0
  return new PersonaIsolationEngine({
    now: () => Date.now(),
    generateId: () => `test-persona-${++seq}`
  })
}

async function startApp(
  extra: Partial<LocalApiOptions> = {}
): Promise<{ base: string; personaEngine: PersonaIsolationEngine }> {
  const personaEngine = extra.personaIsolationEngine ?? makePersonaEngine()
  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    approvalQueue: buildApprovalQueue(),
    securityEventEngine: buildSecurityEventEngine(),
    heuristicsEngine: buildRuntimeSecurityHeuristicsEngine(),
    incidentDetector: buildIncidentDetector(),
    trustEngine: buildCompartmentTrustEngine(),
    personaIsolationEngine: personaEngine,
    ...extra
  })
  const server = app.listen(0, DEFAULT_HOST)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address() as AddressInfo
  cleanups.push(() => server.close())
  return { base: `http://${DEFAULT_HOST}:${address.port}`, personaEngine }
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
  input: { q: 'test' }
}

// ---------------------------------------------------------------------------
// GET /v1/privacy/personas
// ---------------------------------------------------------------------------
describe('GET /v1/privacy/personas', () => {
  it('returns empty list when no executions', async () => {
    const { base } = await startApp()
    const { status, json } = await rawRequest(base, '/v1/privacy/personas')
    expect(status).toBe(200)
    expect(json.personas).toBeInstanceOf(Array)
    expect(json.personas).toHaveLength(0)
  })

  it('returns personas after execute-mock', async () => {
    const { base } = await startApp()
    await executeMock(base, ALLOW_BODY)
    const { status, json } = await rawRequest(base, '/v1/privacy/personas')
    expect(status).toBe(200)
    expect(json.personas.length).toBeGreaterThan(0)
    const persona = json.personas[0]
    expect(persona).toHaveProperty('id')
    expect(persona).toHaveProperty('agentId')
    expect(persona).toHaveProperty('category')
    expect(persona).toHaveProperty('active')
    expect(persona).toHaveProperty('correlationRisk')
    expect(persona).toHaveProperty('searchCount')
  })

  it('never exposes raw input or tokens', async () => {
    const { base } = await startApp()
    await executeMock(base, { ...ALLOW_BODY, input: { q: 'secret-query' } })
    const { json } = await rawRequest(base, '/v1/privacy/personas')
    const raw = JSON.stringify(json)
    expect(raw).not.toContain('secret-query')
  })

  it('returns 405 for non-GET method', async () => {
    const { base } = await startApp()
    const { status } = await rawRequest(base, '/v1/privacy/personas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(status).toBe(405)
  })
})

// ---------------------------------------------------------------------------
// GET /v1/privacy/personas/:agentId
// ---------------------------------------------------------------------------
describe('GET /v1/privacy/personas/:agentId', () => {
  it('returns personas for the requested agent', async () => {
    const { base } = await startApp()
    await executeMock(base, ALLOW_BODY)
    const { status, json } = await rawRequest(base, '/v1/privacy/personas/local-agent')
    expect(status).toBe(200)
    expect(json.agentId).toBe('local-agent')
    expect(json.personas).toBeInstanceOf(Array)
    expect(json.personas.length).toBeGreaterThan(0)
    expect(json.personas[0].agentId).toBe('local-agent')
  })

  it('returns empty personas for unknown agent', async () => {
    const { base } = await startApp()
    const { status, json } = await rawRequest(base, '/v1/privacy/personas/unknown-agent')
    expect(status).toBe(200)
    expect(json.agentId).toBe('unknown-agent')
    expect(json.personas).toHaveLength(0)
  })

  it('returns 405 for POST on persona by agentId', async () => {
    const { base } = await startApp()
    const { status } = await rawRequest(base, '/v1/privacy/personas/local-agent', { method: 'DELETE' })
    expect(status).toBe(405)
  })
})

// ---------------------------------------------------------------------------
// GET /v1/privacy/persona-bindings
// ---------------------------------------------------------------------------
describe('GET /v1/privacy/persona-bindings', () => {
  it('returns empty list before any execution', async () => {
    const { base } = await startApp()
    const { status, json } = await rawRequest(base, '/v1/privacy/persona-bindings')
    expect(status).toBe(200)
    expect(json.bindings).toBeInstanceOf(Array)
  })

  it('returns 400 for multiple agentId query values', async () => {
    const { base } = await startApp()
    const { status } = await rawRequest(base, '/v1/privacy/persona-bindings?agentId=a&agentId=b')
    expect(status).toBe(400)
  })

  it('returns 405 for non-GET', async () => {
    const { base } = await startApp()
    const { status } = await rawRequest(base, '/v1/privacy/persona-bindings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(status).toBe(405)
  })
})

// ---------------------------------------------------------------------------
// GET /v1/privacy/persona-bindings/:agentId
// ---------------------------------------------------------------------------
describe('GET /v1/privacy/persona-bindings/:agentId', () => {
  it('returns bindings scoped to the agent', async () => {
    const { base } = await startApp()
    await executeMock(base, ALLOW_BODY)
    const { status, json } = await rawRequest(base, '/v1/privacy/persona-bindings/local-agent')
    expect(status).toBe(200)
    expect(json.agentId).toBe('local-agent')
    expect(json.bindings).toBeInstanceOf(Array)
  })

  it('returns 405 for non-GET', async () => {
    const { base } = await startApp()
    const { status } = await rawRequest(base, '/v1/privacy/persona-bindings/local-agent', { method: 'DELETE' })
    expect(status).toBe(405)
  })
})

// ---------------------------------------------------------------------------
// GET /v1/privacy/segmentation-policies
// ---------------------------------------------------------------------------
describe('GET /v1/privacy/segmentation-policies', () => {
  it('returns the segmentation policy', async () => {
    const { base } = await startApp()
    const { status, json } = await rawRequest(base, '/v1/privacy/segmentation-policies')
    expect(status).toBe(200)
    expect(json.segmentationPolicy).toBeDefined()
    expect(typeof json.segmentationPolicy.maxSearchesPerPersona).toBe('number')
    expect(typeof json.segmentationPolicy.enabled).toBe('boolean')
    expect(typeof json.segmentationPolicy.forceRotationOnCategoryChange).toBe('boolean')
    expect(typeof json.segmentationPolicy.isolateHighRiskCategories).toBe('boolean')
  })

  it('returns 405 for non-GET', async () => {
    const { base } = await startApp()
    const { status } = await rawRequest(base, '/v1/privacy/segmentation-policies', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(status).toBe(405)
  })
})

// ---------------------------------------------------------------------------
// Category rotation visible via API
// ---------------------------------------------------------------------------
describe('category rotation visible via API', () => {
  it('creates a new persona when category changes in execute-mock', async () => {
    const { base } = await startApp()
    await executeMock(base, { ...ALLOW_BODY, input: { categoryHint: 'general' } })
    await executeMock(base, { ...ALLOW_BODY, input: { categoryHint: 'finance' } })
    const { json } = await rawRequest(base, '/v1/privacy/personas/local-agent')
    const categories = json.personas.map((p: any) => p.category)
    expect(categories).toContain('general')
    expect(categories).toContain('finance')
  })
})

// ---------------------------------------------------------------------------
// No raw input leak
// ---------------------------------------------------------------------------
describe('no raw input or token leak in persona endpoints', () => {
  it('persona list does not echo raw input', async () => {
    const { base } = await startApp()
    await executeMock(base, { ...ALLOW_BODY, input: { q: 'confidential-query' } })
    const r1 = await rawRequest(base, '/v1/privacy/personas')
    const r2 = await rawRequest(base, '/v1/privacy/persona-bindings')
    const r3 = await rawRequest(base, '/v1/privacy/segmentation-policies')
    for (const r of [r1, r2, r3]) {
      expect(r.text).not.toContain('confidential-query')
    }
  })
})
