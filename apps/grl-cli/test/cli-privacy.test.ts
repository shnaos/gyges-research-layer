import { afterEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import { AddressInfo } from 'node:net'
import { GrlApiClient } from '../src/client/api-client.js'
import { runPrivacyFragments, runPrivacyProfile, runPrivacyProfiles } from '../src/commands/privacy.js'
import type { GrlCliConfig } from '../src/config/cli-config.js'
import { CliError } from '../src/errors.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
  vi.restoreAllMocks()
})

function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ base: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      cleanups.push(
        () => new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res())))
      )
      resolve({ base: `http://127.0.0.1:${addr.port}` })
    })
    server.on('error', reject)
  })
}

type RouteMap = Record<string, { status: number; body: unknown }>

function routeServer(routes: RouteMap): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req, res) => {
    const key = `${req.method} ${(req.url ?? '/').split('?')[0]}`
    const match = routes[key]
    if (match) {
      res.writeHead(match.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(match.body))
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: `No route for ${key}` }))
  }
}

function tableConfig(baseUrl: string): GrlCliConfig {
  return { baseUrl, timeoutMs: 5000, output: 'table' }
}

function jsonConfig(baseUrl: string): GrlCliConfig {
  return { baseUrl, timeoutMs: 5000, output: 'json' }
}

function captureStdout(): { get: () => string; restore: () => void } {
  const chunks: string[] = []
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    chunks.push(String(chunk))
    return true
  })
  return {
    get: () => chunks.join(''),
    restore: () => spy.mockRestore()
  }
}

const PROFILES_FIXTURE = {
  profiles: [
    {
      agentId: 'local-agent',
      createdAt: 0,
      updatedAt: 1000,
      correlationRisk: 'medium',
      activeIdentityFragments: 2,
      recentSearchTopics: ['privacy'],
      temporalPatternsDetected: 5,
      repeatedBehaviorScore: 30
    }
  ]
}

const PROFILE_FIXTURE = {
  profile: PROFILES_FIXTURE.profiles[0]
}

const FRAGMENTS_FIXTURE = {
  fragments: [
    {
      id: 'frag-1',
      agentId: 'local-agent',
      createdAt: 0,
      expiresAt: 1000,
      isolatedSessionIds: [],
      isolatedTransportKinds: [],
      active: true,
      requestCount: 3
    }
  ]
}

describe('privacy CLI commands', () => {
  it('prints privacy profiles in table mode', async () => {
    const { base } = await startServer(
      routeServer({
        'GET /v1/privacy/behavioral/profiles': { status: 200, body: PROFILES_FIXTURE }
      })
    )
    const cfg = tableConfig(base)
    const out = captureStdout()
    await runPrivacyProfiles(new GrlApiClient(cfg), cfg)
    out.restore()
    expect(out.get()).toContain('local-agent')
    expect(out.get()).toContain('medium')
  })

  it('prints a single privacy profile in json mode', async () => {
    const { base } = await startServer(
      routeServer({
        'GET /v1/privacy/behavioral/profiles/local-agent': {
          status: 200,
          body: PROFILE_FIXTURE
        }
      })
    )
    const cfg = jsonConfig(base)
    const out = captureStdout()
    await runPrivacyProfile('local-agent', new GrlApiClient(cfg), cfg)
    out.restore()
    expect(JSON.parse(out.get()).profile.agentId).toBe('local-agent')
  })

  it('maps missing profiles to a friendly error', async () => {
    const { base } = await startServer(
      routeServer({
        'GET /v1/privacy/behavioral/profiles/local-agent': {
          status: 404,
          body: { error: 'missing' }
        }
      })
    )
    const cfg = tableConfig(base)
    await expect(
      runPrivacyProfile('local-agent', new GrlApiClient(cfg), cfg)
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof CliError && err.message === 'Behavioral profile not found: local-agent'
    )
  })

  it('prints identity fragments in table mode', async () => {
    const { base } = await startServer(
      routeServer({
        'GET /v1/privacy/fragments/local-agent': {
          status: 200,
          body: FRAGMENTS_FIXTURE
        }
      })
    )
    const cfg = tableConfig(base)
    const out = captureStdout()
    await runPrivacyFragments('local-agent', new GrlApiClient(cfg), cfg)
    out.restore()
    expect(out.get()).toContain('frag-1')
    expect(out.get()).toContain('local-agent')
  })
})
