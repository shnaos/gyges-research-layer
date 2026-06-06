import type { GrlApiClient } from '../client/api-client.js'
import type { GrlCliConfig } from '../config/cli-config.js'
import { CliError } from '../errors.js'
import { printJson } from '../format/json.js'
import { printKeyValue, printTable } from '../format/table.js'

export async function runPrivacyProfiles(
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  const result = await client.listBehavioralProfiles()
  if (config.output === 'json') {
    printJson(result)
    return
  }
  printTable(
    [
      { header: 'AGENT_ID', key: 'agentId' },
      { header: 'RISK', key: 'correlationRisk' },
      { header: 'SCORE', key: 'repeatedBehaviorScore' },
      { header: 'FRAGMENTS', key: 'activeIdentityFragments' },
      { header: 'UPDATED_AT', key: 'updatedAt' }
    ],
    result.profiles.map((profile) => ({
      ...profile,
      updatedAt: new Date(profile.updatedAt).toISOString()
    }))
  )
}

export async function runPrivacyProfile(
  agentId: string,
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  const result = await client.getBehavioralProfile(agentId).catch((err: unknown) => {
    if (err instanceof CliError && err.code === 'command_failed') {
      throw new CliError('command_failed', `Behavioral profile not found: ${agentId}`)
    }
    throw err
  })
  if (config.output === 'json') {
    printJson(result)
    return
  }
  const profile = result.profile
  printKeyValue([
    ['agentId', profile.agentId],
    ['correlationRisk', profile.correlationRisk],
    ['repeatedBehaviorScore', String(profile.repeatedBehaviorScore)],
    ['activeIdentityFragments', String(profile.activeIdentityFragments)],
    ['temporalPatternsDetected', String(profile.temporalPatternsDetected)],
    ['topics', profile.recentSearchTopics.join(', ') || '(none)'],
    ['updatedAt', new Date(profile.updatedAt).toISOString()]
  ])
}

export async function runPrivacyFragments(
  agentId: string | undefined,
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  const result = await client.listIdentityFragments(agentId)
  if (config.output === 'json') {
    printJson(result)
    return
  }
  printTable(
    [
      { header: 'ID', key: 'id' },
      { header: 'AGENT_ID', key: 'agentId' },
      { header: 'ACTIVE', key: 'active' },
      { header: 'REQUESTS', key: 'requestCount' },
      { header: 'EXPIRES_AT', key: 'expiresAt' }
    ],
    result.fragments.map((fragment) => ({
      ...fragment,
      active: String(fragment.active),
      expiresAt: new Date(fragment.expiresAt).toISOString()
    }))
  )
}

// ---------------------------------------------------------------------------
// Sprint 25 — Persona Isolation CLI commands
// ---------------------------------------------------------------------------

export async function runPrivacyPersonas(
  agentId: string | undefined,
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  const result = agentId
    ? await client.listPersonas(agentId)
    : await client.listPersonas()
  if (config.output === 'json') {
    printJson(result)
    return
  }
  printTable(
    [
      { header: 'ID', key: 'id' },
      { header: 'AGENT_ID', key: 'agentId' },
      { header: 'CATEGORY', key: 'category' },
      { header: 'ACTIVE', key: 'active' },
      { header: 'RISK', key: 'correlationRisk' },
      { header: 'SEARCHES', key: 'searchCount' }
    ],
    result.personas.map((persona) => ({
      ...persona,
      active: String(persona.active)
    }))
  )
}

export async function runPrivacyBindings(
  agentId: string | undefined,
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  const result = agentId
    ? await client.listPersonaBindings(agentId)
    : await client.listPersonaBindings()
  if (config.output === 'json') {
    printJson(result)
    return
  }
  printTable(
    [
      { header: 'PERSONA_ID', key: 'personaId' },
      { header: 'FRAGMENT_ID', key: 'fragmentId' },
      { header: 'ACTIVE', key: 'active' },
      { header: 'CREATED_AT', key: 'createdAt' }
    ],
    result.bindings.map((binding) => ({
      ...binding,
      active: String(binding.active),
      createdAt: new Date(binding.createdAt).toISOString()
    }))
  )
}

// ---------------------------------------------------------------------------
// Sprint 26 — Temporal Obfuscation CLI commands
// ---------------------------------------------------------------------------

export async function runPrivacyTemporal(
  agentId: string | undefined,
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  if (agentId !== undefined) {
    const result = await client.getTemporalProfile(agentId).catch((err: unknown) => {
      if (err instanceof CliError && err.code === 'command_failed') {
        throw new CliError('command_failed', `Temporal profile not found: ${agentId}`)
      }
      throw err
    })
    if (config.output === 'json') {
      printJson(result)
      return
    }
    const p = result.profile
    printKeyValue([
      ['agentId', p.agentId],
      ['cadenceRisk', p.cadenceRisk],
      ['detectedBursts', String(p.detectedBursts)],
      ['smoothedRequests', String(p.smoothedRequests)],
      ['currentDelayMs', String(p.currentDelayMs)],
      ['budgetConsumed', String(p.temporalBudget.consumed)],
      ['budgetRemaining', String(p.temporalBudget.remaining)],
      ['budgetResetsAt', new Date(p.temporalBudget.resetsAt).toISOString()],
      ['updatedAt', new Date(p.updatedAt).toISOString()]
    ])
    return
  }
  const result = await client.listTemporalProfiles()
  if (config.output === 'json') {
    printJson(result)
    return
  }
  printTable(
    [
      { header: 'AGENT_ID', key: 'agentId' },
      { header: 'RISK', key: 'cadenceRisk' },
      { header: 'BURSTS', key: 'detectedBursts' },
      { header: 'SMOOTHED', key: 'smoothedRequests' },
      { header: 'DELAY_MS', key: 'currentDelayMs' },
      { header: 'UPDATED_AT', key: 'updatedAt' }
    ],
    result.profiles.map((p) => ({
      ...p,
      updatedAt: new Date(p.updatedAt).toISOString()
    }))
  )
}

export async function runPrivacyBudgets(
  agentId: string | undefined,
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  if (agentId !== undefined) {
    const result = await client.getTemporalBudget(agentId).catch((err: unknown) => {
      if (err instanceof CliError && err.code === 'command_failed') {
        throw new CliError('command_failed', `Temporal budget not found: ${agentId}`)
      }
      throw err
    })
    if (config.output === 'json') {
      printJson(result)
      return
    }
    const b = result.budget
    printKeyValue([
      ['agentId', result.agentId],
      ['maxRequestsPerWindow', String(b.maxRequestsPerWindow)],
      ['windowMs', String(b.windowMs)],
      ['consumed', String(b.consumed)],
      ['remaining', String(b.remaining)],
      ['resetsAt', new Date(b.resetsAt).toISOString()]
    ])
    return
  }
  const result = await client.listTemporalBudgets()
  if (config.output === 'json') {
    printJson(result)
    return
  }
  printTable(
    [
      { header: 'MAX_REQUESTS', key: 'maxRequestsPerWindow' },
      { header: 'CONSUMED', key: 'consumed' },
      { header: 'REMAINING', key: 'remaining' },
      { header: 'RESETS_AT', key: 'resetsAt' }
    ],
    result.budgets.map((b) => ({
      ...b,
      resetsAt: new Date(b.resetsAt).toISOString()
    }))
  )
}


// Sprint 27 — Transport Fingerprint CLI commands

export async function runPrivacyFingerprints(
  agentId: string | undefined,
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  if (agentId !== undefined) {
    const result = await client.getFingerprintProfile(agentId).catch((err: unknown) => {
      if (err instanceof CliError && err.code === 'command_failed') {
        throw new CliError('command_failed', `Fingerprint profile not found: ${agentId}`)
      }
      throw err
    })
    if (config.output === 'json') {
      printJson(result)
      return
    }
    const p = result.profile
    printKeyValue([
      ['agentId', p.agentId],
      ['activeFingerprintId', p.activeFingerprintId],
      ['correlationRisk', p.correlationRisk],
      ['rotationCount', String(p.rotationCount)],
      ['requestCount', String(p.requestCount)],
      ['assignedUserAgent', p.assignedUserAgent],
      ['assignedLanguage', p.assignedLanguage],
      ['updatedAt', new Date(p.updatedAt).toISOString()]
    ])
    return
  }
  const result = await client.listFingerprintProfiles()
  if (config.output === 'json') {
    printJson(result)
    return
  }
  printTable(
    [
      { header: 'AGENT_ID', key: 'agentId' },
      { header: 'FINGERPRINT_ID', key: 'activeFingerprintId' },
      { header: 'RISK', key: 'correlationRisk' },
      { header: 'ROTATIONS', key: 'rotationCount' },
      { header: 'REQUESTS', key: 'requestCount' },
      { header: 'USER_AGENT', key: 'assignedUserAgent' }
    ],
    result.profiles.map((p) => ({
      ...p,
      rotationCount: String(p.rotationCount),
      requestCount: String(p.requestCount)
    }))
  )
}

export async function runPrivacyHeaderPolicies(
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  const result = await client.getHeaderPolicies()
  if (config.output === 'json') {
    printJson(result)
    return
  }
  const p = result.policy
  printKeyValue([
    ['enabled', String(p.enabled)],
    ['rotateOnPersonaChange', String(p.rotateOnPersonaChange)],
    ['rotateOnTemporalEscalation', String(p.rotateOnTemporalEscalation)],
    ['maxRequestsPerFingerprint', String(p.maxRequestsPerFingerprint)],
    ['strictSensitiveCategoryIsolation', String(p.strictSensitiveCategoryIsolation)]
  ])
}
