import { afterEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import { AddressInfo } from 'node:net'
import { GrlApiClient } from '../src/client/api-client.js'
import {
  runPrivacyTemporal,
  runPrivacyBudgets
} from '../src/commands/privacy.js'
import type { GrlCliConfig } from '../src/config/cli-config.js'

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

const SAMPLE_PROFILE = {
  agentId: 'local-agent',
  createdAt: 1000,
  updatedAt: 2000,
  cadenceRisk: 'low',
  recentExecutionTimestamps: [1000],
  detectedBursts: 0,
  smoothedRequests: 1,
  temporalBudget: {
    maxRequestsPerWindow: 60,
    windowMs: 60000,
    consumed: 1,
    remaining: 59,
    resetsAt: 61000
  },
  currentDelayMs: 0
}

const SAMPLE_BUDGET = {
  maxRequestsPerWindow: 60,
  windowMs: 60000,
  consumed: 1,
  remaining: 59,
  resetsAt: 61000
}

// ---------------------------------------------------------------------------
// grl privacy temporal (list all profiles)
// ---------------------------------------------------------------------------
describe('runPrivacyTemporal (no agentId)', () => {
  it('renders table for list of profiles', async () => {
    const { base } = await startServer(routeServer({
      'GET /v1/privacy/temporal/profiles': {
        status: 200,
        body: { profiles: [SAMPLE_PROFILE] }
      }
    }))
    const client = new GrlApiClient(tableConfig(base))
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await runPrivacyTemporal(undefined, client, tableConfig(base))
    const output = spy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('local-agent')
    expect(output).toContain('low')
  })

  it('renders JSON output', async () => {
    const { base } = await startServer(routeServer({
      'GET /v1/privacy/temporal/profiles': {
        status: 200,
        body: { profiles: [SAMPLE_PROFILE] }
      }
    }))
    const client = new GrlApiClient(jsonConfig(base))
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await runPrivacyTemporal(undefined, client, jsonConfig(base))
    const output = spy.mock.calls.map((c) => String(c[0])).join('')
    const parsed = JSON.parse(output)
    expect(parsed.profiles[0].agentId).toBe('local-agent')
  })
})

// ---------------------------------------------------------------------------
// grl privacy temporal local-agent (get single profile)
// ---------------------------------------------------------------------------
describe('runPrivacyTemporal (with agentId)', () => {
  it('renders single profile in table format', async () => {
    const { base } = await startServer(routeServer({
      'GET /v1/privacy/temporal/profiles/local-agent': {
        status: 200,
        body: { profile: SAMPLE_PROFILE }
      }
    }))
    const client = new GrlApiClient(tableConfig(base))
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await runPrivacyTemporal('local-agent', client, tableConfig(base))
    const output = spy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('local-agent')
    expect(output).toContain('low')
  })

  it('renders JSON for single profile', async () => {
    const { base } = await startServer(routeServer({
      'GET /v1/privacy/temporal/profiles/local-agent': {
        status: 200,
        body: { profile: SAMPLE_PROFILE }
      }
    }))
    const client = new GrlApiClient(jsonConfig(base))
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await runPrivacyTemporal('local-agent', client, jsonConfig(base))
    const output = spy.mock.calls.map((c) => String(c[0])).join('')
    const parsed = JSON.parse(output)
    expect(parsed.profile.agentId).toBe('local-agent')
  })
})

// ---------------------------------------------------------------------------
// grl privacy budgets (list all budgets)
// ---------------------------------------------------------------------------
describe('runPrivacyBudgets (no agentId)', () => {
  it('renders table for list of budgets', async () => {
    const { base } = await startServer(routeServer({
      'GET /v1/privacy/temporal/budgets': {
        status: 200,
        body: { budgets: [SAMPLE_BUDGET] }
      }
    }))
    const client = new GrlApiClient(tableConfig(base))
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await runPrivacyBudgets(undefined, client, tableConfig(base))
    const output = spy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('60')
  })

  it('renders JSON output', async () => {
    const { base } = await startServer(routeServer({
      'GET /v1/privacy/temporal/budgets': {
        status: 200,
        body: { budgets: [SAMPLE_BUDGET] }
      }
    }))
    const client = new GrlApiClient(jsonConfig(base))
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await runPrivacyBudgets(undefined, client, jsonConfig(base))
    const output = spy.mock.calls.map((c) => String(c[0])).join('')
    const parsed = JSON.parse(output)
    expect(parsed.budgets[0].maxRequestsPerWindow).toBe(60)
  })
})

// ---------------------------------------------------------------------------
// grl privacy budgets local-agent (get single budget)
// ---------------------------------------------------------------------------
describe('runPrivacyBudgets (with agentId)', () => {
  it('renders single budget in table format', async () => {
    const { base } = await startServer(routeServer({
      'GET /v1/privacy/temporal/budgets/local-agent': {
        status: 200,
        body: { agentId: 'local-agent', budget: SAMPLE_BUDGET }
      }
    }))
    const client = new GrlApiClient(tableConfig(base))
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await runPrivacyBudgets('local-agent', client, tableConfig(base))
    const output = spy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('local-agent')
    expect(output).toContain('60')
  })

  it('renders JSON for single budget', async () => {
    const { base } = await startServer(routeServer({
      'GET /v1/privacy/temporal/budgets/local-agent': {
        status: 200,
        body: { agentId: 'local-agent', budget: SAMPLE_BUDGET }
      }
    }))
    const client = new GrlApiClient(jsonConfig(base))
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await runPrivacyBudgets('local-agent', client, jsonConfig(base))
    const output = spy.mock.calls.map((c) => String(c[0])).join('')
    const parsed = JSON.parse(output)
    expect(parsed.agentId).toBe('local-agent')
    expect(parsed.budget.remaining).toBe(59)
  })
})
