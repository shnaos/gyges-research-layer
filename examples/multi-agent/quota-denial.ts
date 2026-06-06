/**
 * Multi-Agent Quota Denial Example
 *
 * Demonstrates per-agent quota enforcement. An agent that exceeds its
 * concurrent execution or session quota receives a denial response.
 *
 * Run: GRL_URL=http://127.0.0.1:8787 node quota-denial.ts
 */

const baseUrl = process.env.GRL_URL ?? 'http://127.0.0.1:8787';

async function getAgent(agentId: string): Promise<any> {
  const res = await fetch(`${baseUrl}/v1/agents/${encodeURIComponent(agentId)}`);
  if (!res.ok) return null;
  return res.json();
}

async function restrictAgent(agentId: string): Promise<void> {
  const res = await fetch(`${baseUrl}/v1/agents/${encodeURIComponent(agentId)}/restrict`, {
    method: 'POST'
  });
  const data = await res.json();
  console.log(`[restrict:${agentId}] status=${data.status ?? data.error}`);
}

async function getAgentSessions(agentId: string): Promise<void> {
  const res = await fetch(`${baseUrl}/v1/agents/${encodeURIComponent(agentId)}/sessions`);
  const data = await res.json();
  console.log(
    `[sessions:${agentId}] active=${data.activeSessions}/${data.maxSessions}`
  );
}

async function run(): Promise<void> {
  console.log('=== Quota Denial Example ===\n');

  // Inspect a known agent's runtime (must have been registered via execute-mock first).
  const agentId = 'quota-test-agent';

  const runtime = await getAgent(agentId);
  if (!runtime) {
    console.log(
      `Agent "${agentId}" not found. Run concurrent-agents.ts first, or trigger a ` +
        'request to register it.'
    );
    return;
  }

  const { agent } = runtime;
  console.log(
    `Agent "${agentId}": status=${agent.status}, ` +
      `executions=${agent.activeExecutions}/${agent.quota.maxConcurrentExecutions}, ` +
      `sessions=${agent.activeSessions}/${agent.quota.maxSessions}`
  );

  // Show session quota information.
  await getAgentSessions(agentId);

  // Restrict the agent manually to demonstrate quota-style denial.
  console.log('\n--- Restricting agent to demonstrate access denial ---');
  await restrictAgent(agentId);

  const updated = await getAgent(agentId);
  if (updated) {
    console.log(`After restrict: status=${updated.agent.status}`);
    console.log('Any further execution attempts will be denied (fail-closed).');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
