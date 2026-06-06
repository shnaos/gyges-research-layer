/**
 * Multi-Agent Lease Expiration Example
 *
 * Demonstrates RuntimeLease acquisition and expiration.
 * Leases are used to temporarily reserve runtime capacity for an agent
 * and automatically expire after their TTL.
 *
 * Run: GRL_URL=http://127.0.0.1:8787 node lease-expiration.ts
 */

const baseUrl = process.env.GRL_URL ?? 'http://127.0.0.1:8787';

async function listAgents(): Promise<any[]> {
  const res = await fetch(`${baseUrl}/v1/agents`);
  const data = await res.json();
  return data.agents ?? [];
}

async function getAgentLeases(agentId: string): Promise<any[]> {
  const res = await fetch(`${baseUrl}/v1/agents/${encodeURIComponent(agentId)}/leases`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.leases ?? [];
}

function formatMs(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${seconds}s`;
}

async function run(): Promise<void> {
  console.log('=== Lease Expiration Example ===\n');

  const agents = await listAgents();
  if (agents.length === 0) {
    console.log(
      'No agents registered yet. Run concurrent-agents.ts first to register some.'
    );
    return;
  }

  console.log(`Found ${agents.length} registered agent(s).\n`);

  for (const agent of agents) {
    console.log(`--- Agent: ${agent.agentId} ---`);
    const leases = await getAgentLeases(agent.agentId);

    if (leases.length === 0) {
      console.log('  No active leases.\n');
      continue;
    }

    const now = Date.now();
    for (const lease of leases) {
      const remainingMs = lease.expiresAt - now;
      const acquired = new Date(lease.acquiredAt).toISOString();
      const expires = new Date(lease.expiresAt).toISOString();
      console.log(`  Lease ID  : ${lease.id}`);
      console.log(`  Acquired  : ${acquired}`);
      console.log(`  Expires   : ${expires}`);
      console.log(`  TTL left  : ${remainingMs > 0 ? formatMs(remainingMs) : 'EXPIRED'}`);
      console.log(`  Renewable : ${lease.renewable}`);
      console.log('');
    }
  }

  console.log(
    'Note: Leases are automatically expired by the GRL runtime on next activity.\n' +
      '      Expired leases are never returned by GET /v1/agents/:agentId/leases.'
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
