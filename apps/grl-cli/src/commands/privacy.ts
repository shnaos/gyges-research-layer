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
