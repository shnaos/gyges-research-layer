import express from 'express';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CapabilityFirewall, CapabilityRequest } from '../../../packages/core/src/index.js';
import { SessionManager } from '../../../packages/identity-compartment/src/index.js';
import { YamlPolicyEngine } from '../../../packages/policy-engine/src/index.js';
import { SearxngAdapter } from '../../../packages/search-adapter-searxng/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repositoryRoot = resolve(__dirname, '../../../');
const policyPath = resolve(repositoryRoot, 'policies/default.yaml');

const firewall = new CapabilityFirewall(YamlPolicyEngine.fromFile(policyPath));
const sessionManager = new SessionManager();
const searchAdapter = new SearxngAdapter(process.env.SEARXNG_URL ?? 'http://localhost:8080');

const app = express();
app.use(express.json());

function validateCapabilityRequest(body: Partial<CapabilityRequest>): body is CapabilityRequest {
  return Boolean(body.agentId && body.compartment && body.tool && body.riskLevel);
}

function logLocal(event: string, payload: unknown): void {
  const logPath = resolve(repositoryRoot, 'logs/grl.log');
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${new Date().toISOString()} ${event} ${JSON.stringify(payload)}\n`, 'utf8');
}

/**
 * Single capability entry point.
 *
 * The agent only ever talks to the firewall. Deny-by-default: every request is
 * evaluated by the policy engine and refused unless an explicit allow rule
 * matches. Only when allowed is the isolated adapter invoked on the agent's
 * behalf, so the agent never reaches the search engine directly.
 */
app.post('/capabilities/execute', async (req, res) => {
  if (!validateCapabilityRequest(req.body)) {
    return res
      .status(400)
      .json({ error: 'agentId, compartment, tool, riskLevel, and input are required.' });
  }

  const request: CapabilityRequest = req.body;
  const decision = firewall.evaluate(request);
  logLocal('capability.execute', { request, decision });

  if (!decision.allowed) {
    return res.status(403).json({ decision });
  }

  if (request.tool !== 'search') {
    return res.status(501).json({ decision, error: `Tool not implemented: ${request.tool}` });
  }

  const query = (request.input as { query?: string })?.query;
  if (!query) {
    return res.status(400).json({ decision, error: 'input.query is required for search.' });
  }

  try {
    const results = await searchAdapter.search(query);
    sessionManager.recordHistory(
      { id: request.compartment, agentId: request.agentId },
      { tool: 'search', query }
    );
    logLocal('search', { agentId: request.agentId, compartment: request.compartment });
    return res.json({ decision, results });
  } catch (error) {
    return res.status(502).json({ decision, error: (error as Error).message });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  logLocal('server.start', { port });
  // eslint-disable-next-line no-console
  console.log(`Gyges Research Layer listening on http://localhost:${port}`);
});
