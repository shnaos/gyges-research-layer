/**
 * Multi-Agent Concurrent Agents Example
 *
 * Demonstrates two independent agent runtimes operating concurrently through GRL.
 * Each agent has its own isolated runtime state, trust score, and quotas.
 *
 * Run: GRL_URL=http://127.0.0.1:8787 node concurrent-agents.ts
 */

const baseUrl = process.env.GRL_URL ?? 'http://127.0.0.1:8787';

async function listAgents(): Promise<void> {
  const res = await fetch(`${baseUrl}/v1/agents`);
  const data = await res.json();
  console.log('[agents] registered runtimes:', JSON.stringify(data, null, 2));
}

async function getAgentTrust(agentId: string): Promise<void> {
  const res = await fetch(`${baseUrl}/v1/agents/${encodeURIComponent(agentId)}/trust`);
  const data = await res.json();
  console.log(`[trust:${agentId}]`, JSON.stringify(data, null, 2));
}

async function executeMock(agentId: string, compartmentId: string): Promise<void> {
  const res = await fetch(`${baseUrl}/v1/capabilities/execute-mock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentId,
      compartmentId,
      tool: 'search',
      riskLevel: 'low',
      input: { q: `research from ${agentId}` }
    })
  });
  const data = await res.json();
  console.log(`[execute:${agentId}] decision=${data.decision}`);
}

async function run(): Promise<void> {
  console.log('=== Concurrent Multi-Agent Example ===\n');

  // List initial state (server auto-registers agents on first execute-mock call).
  console.log('--- Initial agent registry ---');
  await listAgents();

  // Two agents execute concurrently — their runtimes are fully isolated.
  console.log('\n--- Concurrent execution ---');
  await Promise.all([
    executeMock('research-agent-a', 'research'),
    executeMock('research-agent-b', 'research')
  ]);

  // Each agent now has its own runtime entry.
  console.log('\n--- Agent runtimes after execution ---');
  await listAgents();

  // Trust scores are independent per-agent.
  console.log('\n--- Per-agent trust ---');
  await getAgentTrust('research-agent-a');
  await getAgentTrust('research-agent-b');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
