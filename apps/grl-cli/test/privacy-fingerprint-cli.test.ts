import { afterEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import { AddressInfo } from 'node:net'
import { GrlApiClient } from '../src/client/api-client.js'
import {
  runPrivacyFingerprints,
  runPrivacyHeaderPolicies
} from '../src/commands/privacy.js'
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

const FINGERPRINTS_FIXTURE = {
  profiles: [
    {
      agentId: 'local-agent',
      createdAt: 1000,
      updatedAt: 2000,
      activeFingerprintId: 'fp-1',
      rotationCount: 1,
      requestCount: 3,
      correlationRisk: 'medium',
      assignedUserAgent: 'GRL-Agent/1.0 (compatible; research)',
      assignedLanguage: 'en-US,en;q=0.9'
    }
  ]
}

const HEADER_POLICIES_FIXTURE = {
  policy: {
    enabled: true,
    rotateOnPersonaChange: true,
    rotateOnTemporalEscalation: false,
    maxRequestsPerFingerprint: 50,
    strictSensitiveCategoryIsolation: true
  }
}

describe('privacy fingerprints CLI command', () => {
  it('prints fingerprint profiles in table mode', async () => {
    const { base } = await startServer(
      routeServer({
        'GET /v1/privacy/fingerprints': { status: 200, body: FINGERPRINTS_FIXTURE }
      })
    )
    const cfg = tableConfig(base)
    const out = captureStdout()
    await runPrivacyFingerprints(undefined, new GrlApiClient(cfg), cfg)
    out.restore()
    expect(out.get()).toContain('local-agent')
    expect(out.get()).toContain('fp-1')
  })

  it('prints a single fingerprint profile in json mode', async () => {
    const { base } = await startServer(
      routeServer({
        'GET /v1/privacy/fingerprints/local-agent': {
          status: 200,
          body: { agentId: 'local-agent', profile: FINGERPRINTS_FIXTURE.profiles[0] }
        }
      })
    )
    const cfg = jsonConfig(base)
    const out = captureStdout()
    await runPrivacyFingerprints('local-agent', new GrlApiClient(cfg), cfg)
    out.restore()
    expect(JSON.parse(out.get()).profile.agentId).toBe('local-agent')
  })

  it('maps missing fingerprint profiles to a friendly error', async () => {
    const { base } = await startServer(
      routeServer({
        'GET /v1/privacy/fingerprints/local-agent': {
          status: 404,
          body: { error: 'missing' }
        }
      })
    )
    const cfg = tableConfig(base)
    await expect(
      runPrivacyFingerprints('local-agent', new GrlApiClient(cfg), cfg)
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof CliError && err.message === 'Fingerprint profile not found: local-agent'
    )
  })
})

describe('privacy header-policies CLI command', () => {
  it('prints header policies in table mode', async () => {
    const { base } = await startServer(
      routeServer({
        'GET /v1/privacy/header-policies': { status: 200, body: HEADER_POLICIES_FIXTURE }
      })
    )
    const cfg = tableConfig(base)
    const out = captureStdout()
    await runPrivacyHeaderPolicies(new GrlApiClient(cfg), cfg)
    out.restore()
    expect(out.get()).toContain('rotateOnPersonaChange')
    expect(out.get()).toContain('50')
  })

  it('prints header policies in json mode', async () => {
    const { base } = await startServer(
      routeServer({
        'GET /v1/privacy/header-policies': { status: 200, body: HEADER_POLICIES_FIXTURE }
      })
    )
    const cfg = jsonConfig(base)
    const out = captureStdout()
    await runPrivacyHeaderPolicies(new GrlApiClient(cfg), cfg)
    out.restore()
    expect(JSON.parse(out.get()).policy.enabled).toBe(true)
  })
})
