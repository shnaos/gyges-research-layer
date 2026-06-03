const baseUrl = process.env.GRL_URL ?? 'http://localhost:3000';

async function run(): Promise<void> {
  const response = await fetch(`${baseUrl}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: 'local-agent',
      compartment: 'research-public',
      tool: 'search',
      riskLevel: 'low',
      input: {
        query: 'Gyges ring myth privacy'
      }
    })
  });

  const payload = await response.json();
  console.log(JSON.stringify(payload, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
