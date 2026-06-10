import type { AgentActionResponse, AgentLeasesResponse, AgentLeaseView, AgentResponse, AgentRuntimeView, AgentsResponse, GrlApiClient } from '../client/api-client.js';
import type { GrlCliConfig } from '../config/cli-config.js';
import { CliError } from '../errors.js';
import { printJson } from '../format/json.js';
import { printTable, printKeyValue } from '../format/table.js';

/**
 * grl agents
 *
 * List all registered agent runtimes.
 */
export async function runAgentsList(
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  const result: AgentsResponse = await client.listAgents();

  if (config.output === 'json') {
    printJson(result);
    return;
  }

  printTable(
    [
      { header: 'AGENT_ID', key: 'agentId' },
      { header: 'STATUS', key: 'status' },
      { header: 'TRUST', key: 'trustScore' },
      { header: 'SESSIONS', key: 'activeSessions' },
      { header: 'EXECUTIONS', key: 'activeExecutions' },
      { header: 'UPDATED_AT', key: 'updatedAt' }
    ],
    result.agents.map((a: AgentRuntimeView) => ({
      ...a,
      updatedAt: new Date(a.updatedAt).toISOString()
    }))
  );
}

/**
 * grl agents <agentId>
 *
 * Show the runtime state for a single agent.
 */
export async function runAgentGet(
  agentId: string,
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  const result: AgentResponse = await client.getAgent(agentId).catch((err: unknown) => {
    if (err instanceof CliError && err.code === 'command_failed') {
      throw new CliError('command_failed', `Agent not found: ${agentId}`);
    }
    throw err;
  });

  if (config.output === 'json') {
    printJson(result);
    return;
  }

  const a = result.agent;
  printKeyValue([
    ['agentId', a.agentId],
    ['status', a.status],
    ['trustScore', a.trustScore],
    ['activeSessions', a.activeSessions],
    ['activeExecutions', a.activeExecutions],
    ['compartments', a.compartments.join(', ') || '(none)'],
    ['updatedAt', new Date(a.updatedAt).toISOString()],
    ['createdAt', new Date(a.createdAt).toISOString()]
  ]);
}

/**
 * grl agents leases [agentId]
 *
 * List leases — optionally filtered to a single agent.
 */
export async function runAgentLeases(
  agentId: string | undefined,
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  if (agentId) {
    const result: AgentLeasesResponse = await client.listAgentLeases(agentId).catch((err: unknown) => {
      if (err instanceof CliError && err.code === 'command_failed') {
        throw new CliError('command_failed', `Agent not found: ${agentId}`);
      }
      throw err;
    });

    if (config.output === 'json') {
      printJson(result);
      return;
    }

    if (result.leases.length === 0) {
      process.stdout.write(`No active leases for agent "${agentId}".\n`);
      return;
    }

    printTable(
      [
        { header: 'LEASE_ID', key: 'id' },
        { header: 'AGENT', key: 'holderAgentId' },
        { header: 'ACQUIRED_AT', key: 'acquiredAt' },
        { header: 'EXPIRES_AT', key: 'expiresAt' },
        { header: 'RENEWABLE', key: 'renewable' }
      ],
      result.leases.map((l: AgentLeaseView) => ({
        ...l,
        acquiredAt: new Date(l.acquiredAt).toISOString(),
        expiresAt: new Date(l.expiresAt).toISOString()
      }))
    );
  } else {
    // Without an agentId, list all agents and show a lease summary.
    const agentsResult: AgentsResponse = await client.listAgents();
    const leased: AgentRuntimeView[] = agentsResult.agents.filter((a) => a.lease !== undefined);

    if (config.output === 'json') {
      printJson({ leases: leased.map((a: AgentRuntimeView) => a.lease) });
      return;
    }

    if (leased.length === 0) {
      process.stdout.write('No active leases.\n');
      return;
    }

    printTable(
      [
        { header: 'LEASE_ID', key: 'id' },
        { header: 'AGENT', key: 'holderAgentId' },
        { header: 'ACQUIRED_AT', key: 'acquiredAt' },
        { header: 'EXPIRES_AT', key: 'expiresAt' }
      ],
      leased.map((a: AgentRuntimeView) => ({
        id: a.lease!.id,
        holderAgentId: a.lease!.holderAgentId,
        acquiredAt: new Date(a.lease!.acquiredAt).toISOString(),
        expiresAt: new Date(a.lease!.expiresAt).toISOString()
      }))
    );
  }
}

/**
 * grl agents evict <agentId>
 *
 * Evict an agent — permanently removes it from execution.
 */
export async function runAgentEvict(
  agentId: string,
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  const result: AgentActionResponse = await client.evictAgent(agentId).catch((err: unknown) => {
    if (err instanceof CliError && err.code === 'command_failed') {
      throw new CliError('command_failed', `Agent not found or cannot be evicted: ${agentId}`);
    }
    throw err;
  });

  if (config.output === 'json') {
    printJson(result);
    return;
  }

  printKeyValue([
    ['agentId', result.agentId],
    ['status', result.status],
    ['updatedAt', new Date(result.updatedAt).toISOString()]
  ]);
}

/**
 * grl agents restrict <agentId>
 *
 * Restrict an agent — blocks further execution.
 */
export async function runAgentRestrict(
  agentId: string,
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  const result: AgentActionResponse = await client.restrictAgent(agentId).catch((err: unknown) => {
    if (err instanceof CliError && err.code === 'command_failed') {
      throw new CliError('command_failed', `Agent not found or cannot be restricted: ${agentId}`);
    }
    throw err;
  });

  if (config.output === 'json') {
    printJson(result);
    return;
  }

  printKeyValue([
    ['agentId', result.agentId],
    ['status', result.status],
    ['updatedAt', new Date(result.updatedAt).toISOString()]
  ]);
}
