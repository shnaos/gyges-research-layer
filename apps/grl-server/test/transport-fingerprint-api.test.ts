import { AddressInfo } from 'node:net'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { TransportFingerprintEngine } from '../../../packages/core/src/index.js'
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

function makeFingerprintEngine(maxRequestsPerFingerprint = 50): TransportFingerprintEngine {
  let now = 10_000
  let id = 0
  return new TransportFingerprintEngine({
    now: () => now++,
    generateId: () => `fp-${++id}`,
    policy: { maxRequestsPerFingerprint }
  })
}

async function startApp(
  extra: Partial<LocalApiOptions> = {}
): Promise<{ base: string; fingerprintEngine: TransportFingerprintEngine }> {
  const fingerprintEngine = extra.transportFingerprintEngine ?? makeFingerprintEngine()
  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    approvalQueue: buildApprovalQueue(),
    securityEventEngine: buildSecurityEventEngine(),
    heuristicsEngine: buildRuntimeSecurityHeuristicsEngine(),
    incidentDetector: buildIncidentDetector(),
    trustEngine: buildCompartmentTrustEngine(),
    transportFingerprintEngine: fingerprintEngine,
    mockFallbackEnabled: true,
    ...extra
  })
  const server = app.listen(0, DEFAULT_HOST)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address() as AddressInfo
  cleanups.push(() => server.close())
  return { base: `http://${DEFAULT_HOST}:${address.port}`, fingerprintEngine }
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

function execute(
  base: string,
  body: unknown
): Promise<{ status: number; json: any; text: string }> {
  return rawRequest(base, '/v1/capabilities/execute', {
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
  input: { q: 'test-query', categoryHint: 'finance' }
}

describe('transport fingerprint API', () => {
  it('GET /v1/privacy/fingerprints returns empty profiles initially', async () => {
    const { base } = await startApp()
    const { status, json } = await rawRequest(base, '/v1/privacy/fingerprints')
    expect(status).toBe(200)
    expect(json.profiles).toEqual([])
  })

  it('GET /v1/privacy/fingerprints returns profiles after execute-mock', async () => {
    const { base } = await startApp()
    await executeMock(base, ALLOW_BODY)
    const { status, json } = await rawRequest(base, '/v1/privacy/fingerprints')
    expect(status).toBe(200)
    expect(json.profiles).toHaveLength(1)
    expect(json.profiles[0].agentId).toBe('local-agent')
    expect(typeof json.profiles[0].assignedUserAgent).toBe('string')
    expect(json.profiles[0].assignedUserAgent.length).toBeGreaterThan(0)
  })

  it('GET /v1/privacy/fingerprints/:agentId returns 404 for unknown', async () => {
    const { base } = await startApp()
    const { status, json } = await rawRequest(base, '/v1/privacy/fingerprints/ghost-agent')
    expect(status).toBe(404)
    expect(json.error).toMatch(/not found/i)
  })

  it('GET /v1/privacy/fingerprints/:agentId returns profile after execute', async () => {
    const { base } = await startApp()
    await execute(base, ALLOW_BODY)
    const { status, json } = await rawRequest(base, '/v1/privacy/fingerprints/local-agent')
    expect(status).toBe(200)
    expect(json.agentId).toBe('local-agent')
    expect(json.profile.activeFingerprintId).toBeDefined()
  })

  it('GET /v1/privacy/header-policies returns policy', async () => {
    const { base } = await startApp()
    const { status, json } = await rawRequest(base, '/v1/privacy/header-policies')
    expect(status).toBe(200)
    expect(json.policy.enabled).toBe(true)
    expect(typeof json.policy.maxRequestsPerFingerprint).toBe('number')
  })

  it('GET /v1/privacy/header-profiles returns profiles', async () => {
    const { base } = await startApp()
    await executeMock(base, ALLOW_BODY)
    const { status, json } = await rawRequest(base, '/v1/privacy/header-profiles')
    expect(status).toBe(200)
    expect(json.profiles.length).toBeGreaterThan(0)
    expect(json.profiles[0].userAgent).toBeDefined()
    expect(json.profiles[0].acceptLanguage).toBeDefined()
    expect(json.profiles[0].headers).toBeUndefined()
  })

  it('execute-mock includes fingerprint metadata', async () => {
    const { base } = await startApp()
    const { status, json } = await executeMock(base, ALLOW_BODY)
    expect(status).toBe(200)
    expect(json.fingerprint).toBeDefined()
    expect(json.fingerprint.activeFingerprintId).toBeDefined()
    expect(json.fingerprint.rotationCount).toBe(1)
    expect(typeof json.fingerprint.rotated).toBe('boolean')
  })

  it('fingerprint rotation is visible after many requests', async () => {
    const { base } = await startApp({ transportFingerprintEngine: makeFingerprintEngine(2) })
    const body = {
      ...ALLOW_BODY,
      input: { q: 'test-query', categoryHint: 'general' }
    }
    await executeMock(base, body)
    await executeMock(base, body)
    const third = await executeMock(base, body)
    expect(third.json.fingerprint.rotated).toBe(true)
    expect(third.json.fingerprint.rotationCount).toBe(2)
    const profiles = await rawRequest(base, '/v1/privacy/header-profiles')
    expect(profiles.json.profiles.length).toBeGreaterThan(1)
  })

  it('no raw input leak in responses', async () => {
    const { base } = await startApp()
    await executeMock(base, {
      ...ALLOW_BODY,
      input: { q: 'raw-secret-query', categoryHint: 'finance' }
    })
    const { text } = await rawRequest(base, '/v1/privacy/fingerprints')
    expect(text).not.toContain('raw-secret-query')
  })

  it('no token leak in responses', async () => {
    const { base } = await startApp()
    await executeMock(base, ALLOW_BODY)
    const fingerprints = await rawRequest(base, '/v1/privacy/fingerprints')
    const headers = await rawRequest(base, '/v1/privacy/header-profiles')
    expect(fingerprints.text).not.toContain('token')
    expect(headers.text).not.toContain('approval')
  })

  it('405 on wrong method', async () => {
    const { base } = await startApp()
    const fingerprints = await rawRequest(base, '/v1/privacy/fingerprints', { method: 'POST' })
    const policies = await rawRequest(base, '/v1/privacy/header-policies', { method: 'DELETE' })
    expect(fingerprints.status).toBe(405)
    expect(policies.status).toBe(405)
  })
})
