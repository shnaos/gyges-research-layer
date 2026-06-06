import { AddressInfo } from 'node:net'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { BehavioralPrivacyEngine } from '../../../packages/core/src/index.js'
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

function behavioralEngineFactory(): {
  engine: BehavioralPrivacyEngine
  advance: () => void
} {
  let current = 1000
  let seq = 0
  return {
    engine: new BehavioralPrivacyEngine({
      now: () => current,
      generateId: () => `frag-${++seq}`
    }),
    advance: () => {
      current += 1000
    }
  }
}

async function startApp(
  extra: Partial<LocalApiOptions> = {}
): Promise<{ base: string; privacy: ReturnType<typeof behavioralEngineFactory> }> {
  const privacy = behavioralEngineFactory()
  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    approvalQueue: buildApprovalQueue(),
    securityEventEngine: buildSecurityEventEngine(),
    heuristicsEngine: buildRuntimeSecurityHeuristicsEngine(),
    incidentDetector: buildIncidentDetector(),
    trustEngine: buildCompartmentTrustEngine(),
    behavioralPrivacyEngine: privacy.engine,
    ...extra
  })
  const server = app.listen(0, DEFAULT_HOST)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address() as AddressInfo
  cleanups.push(() => server.close())
  return { base: `http://${DEFAULT_HOST}:${address.port}`, privacy }
}

async function rawRequest(
  base: string,
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${base}${path}`, init)
  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
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
  input: { q: 'never-stored' }
}

function seedBehavior(
  privacy: ReturnType<typeof behavioralEngineFactory>,
  loops: number,
  agentId = 'local-agent'
): void {
  for (let i = 0; i < loops; i++) {
    privacy.engine.evaluateRequest({ agentId })
    privacy.engine.recordBehavior({ agentId })
    privacy.advance()
  }
}

describe('behavioral privacy endpoints', () => {
  it('lists profiles and fragments after an execution', async () => {
    const { base, privacy } = await startApp()
    const exec = await executeMock(base, ALLOW_BODY)
    expect(exec.status).toBe(200)
    expect(exec.json.decision).toBe('allowed')
    privacy.advance()

    const profiles = await rawRequest(base, '/v1/privacy/behavioral/profiles')
    expect(profiles.status).toBe(200)
    expect(profiles.json.profiles).toHaveLength(1)
    expect(profiles.json.profiles[0].agentId).toBe('local-agent')
    expect(profiles.json.profiles[0].correlationRisk).toBe('low')
    expect(profiles.json.profiles[0].activeIdentityFragments).toBe(1)

    const single = await rawRequest(base, '/v1/privacy/behavioral/profiles/local-agent')
    expect(single.status).toBe(200)
    expect(single.json.profile.agentId).toBe('local-agent')

    const fragments = await rawRequest(base, '/v1/privacy/fragments')
    expect(fragments.status).toBe(200)
    expect(fragments.json.fragments).toHaveLength(1)
    expect(fragments.json.fragments[0].id).toBe('frag-1')

    const filtered = await rawRequest(base, '/v1/privacy/fragments?agentId=local-agent')
    expect(filtered.status).toBe(200)
    expect(filtered.json.fragments).toHaveLength(1)

    const byAgent = await rawRequest(base, '/v1/privacy/fragments/local-agent')
    expect(byAgent.status).toBe(200)
    expect(byAgent.json.fragments).toHaveLength(1)
  })

  it('returns policies and method errors', async () => {
    const { base } = await startApp()
    const policies = await rawRequest(base, '/v1/privacy/jitter-policies')
    expect(policies.status).toBe(200)
    expect(policies.json.jitterPolicy.enabled).toBe(true)
    expect(policies.json.fragmentationPolicy.maxRequestsPerFragment).toBe(10)
    expect(policies.json.correlationPolicy.repeatedQueryThreshold).toBe(5)

    const wrongMethod = await rawRequest(base, '/v1/privacy/behavioral/profiles', {
      method: 'POST'
    })
    expect(wrongMethod.status).toBe(405)

    const missing = await rawRequest(base, '/v1/privacy/behavioral/profiles/missing')
    expect(missing.status).toBe(404)
  })

  it('rotates fragments at high correlation risk and blocks at critical risk', async () => {
    const highPrivacy = behavioralEngineFactory()
    const initial = highPrivacy.engine.fragmentManager.getActiveFragment('local-agent')
    highPrivacy.engine.fragmentManager.recordRequest('local-agent', initial.id)
    highPrivacy.engine.refreshProfile('local-agent')
    seedBehavior(highPrivacy, 10)

    const { base: highBase } = await startApp({
      behavioralPrivacyEngine: highPrivacy.engine
    })
    const highResponse = await executeMock(highBase, ALLOW_BODY)
    expect(highResponse.json.decision).toBe('allowed')

    const profile = await rawRequest(
      highBase,
      '/v1/privacy/behavioral/profiles/local-agent'
    )
    expect(profile.json.profile.correlationRisk).toBe('high')

    const fragments = await rawRequest(highBase, '/v1/privacy/fragments/local-agent')
    expect(fragments.json.fragments.length).toBeGreaterThan(1)
    expect(fragments.json.fragments.filter((fragment: any) => fragment.active)).toHaveLength(1)

    const rotateEvents = await rawRequest(
      highBase,
      '/v1/audit/events?type=behavior_fragment_rotated'
    )
    expect(rotateEvents.status).toBe(200)
    expect(rotateEvents.json.events.length).toBeGreaterThan(0)

    const criticalPrivacy = behavioralEngineFactory()
    seedBehavior(criticalPrivacy, 16)
    const { base: criticalBase } = await startApp({
      behavioralPrivacyEngine: criticalPrivacy.engine
    })
    const blocked = await executeMock(criticalBase, ALLOW_BODY)
    expect(blocked.json.decision).toBe('denied')
    expect(blocked.json.reason).toBe('critical_correlation_risk')

    const escalated = await rawRequest(
      criticalBase,
      '/v1/audit/events?type=behavioral_privacy_escalated'
    )
    expect(escalated.status).toBe(200)
    expect(escalated.json.events.length).toBeGreaterThan(0)
  })

  it('rotates fragment when maxRequestsPerFragment boundary is reached', async () => {
    // Seed a fresh engine and exhaust the first fragment's request budget
    // (maxRequestsPerFragment = 10) so the next getActiveFragment call
    // returns a new fragment — verifying rotation at the exact threshold.
    const { engine } = behavioralEngineFactory()
    const first = engine.fragmentManager.getActiveFragment('agent-boundary')
    for (let i = 0; i < 10; i++) {
      engine.fragmentManager.recordRequest('agent-boundary', first.id)
    }
    // The first fragment is now at capacity — the next getActiveFragment must
    // create a second fragment (rotation at boundary).
    const second = engine.fragmentManager.getActiveFragment('agent-boundary')
    expect(second.id).not.toBe(first.id)
    expect(second.requestCount).toBe(0)

    const allFragments = engine.fragmentManager.listFragments('agent-boundary')
    expect(allFragments).toHaveLength(2)
    expect(allFragments[0].requestCount).toBe(10)
    expect(allFragments[1].active).toBe(true)
  })
})
