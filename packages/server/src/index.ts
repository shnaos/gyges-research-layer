import express from 'express';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CapabilityFirewall, CapabilityRequest } from '../../core/src/index.js';
import { SessionManager } from '../../identity-compartment/src/index.js';
import { YamlPolicyEngine } from '../../policy-engine/src/index.js';
import { FetchHtmlAdapter, SearxngAdapter } from '../../search-adapters/src/index.js';
import { TransportRouter } from '../../transport-router/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repositoryRoot = resolve(__dirname, '../../../');
const policyPath = resolve(repositoryRoot, 'policies/default.yaml');
const firewall = new CapabilityFirewall(YamlPolicyEngine.fromFile(policyPath));
const sessionManager = new SessionManager();
const searchAdapter = new SearxngAdapter(process.env.SEARXNG_URL ?? 'http://localhost:8080');
const allowedFetchHosts = (process.env.GRL_ALLOWED_FETCH_HOSTS ?? 'example.com')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

const fetchHtmlAdapter = new FetchHtmlAdapter(allowedFetchHosts);
const transportRouter = new TransportRouter([
  { id: 'direct', type: 'direct' },
  { id: 'tor', type: 'tor', proxyUrl: process.env.TOR_PROXY_URL ?? 'socks5://localhost:9050' }
]);

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

app.post('/capability/evaluate', (req, res) => {
  if (!validateCapabilityRequest(req.body)) {
    return res.status(400).json({ error: 'agentId, compartment, tool, riskLevel, and input are required.' });
  }

  const decision = firewall.evaluate(req.body);
  logLocal('capability.evaluate', { request: req.body, decision });
  return res.json(decision);
});

app.post('/search', async (req, res) => {
  if (!validateCapabilityRequest(req.body) || req.body.tool !== 'search') {
    return res.status(400).json({ error: 'Invalid request. tool must be search.' });
  }

  const decision = firewall.evaluate(req.body);
  if (!decision.allowed) {
    return res.status(403).json(decision);
  }

  const query = (req.body.input as { query?: string })?.query;
  if (!query) {
    return res.status(400).json({ error: 'input.query is required.' });
  }

  try {
    const transportId = (req.body.input as { transportId?: string }).transportId;
    const transport = transportRouter.route(transportId);
    const results = await searchAdapter.search(query, { transport });
    sessionManager.recordHistory({ id: req.body.compartment, agentId: req.body.agentId }, { tool: 'search', query });
    sessionManager.setTransportMetadata({ id: req.body.compartment, agentId: req.body.agentId }, { transport });
    logLocal('search', { agentId: req.body.agentId, compartment: req.body.compartment, transport: transport.id });
    return res.json({ decision, results });
  } catch (error) {
    return res.status(502).json({ error: (error as Error).message });
  }
});

app.post('/fetch-html', async (req, res) => {
  if (!validateCapabilityRequest(req.body) || req.body.tool !== 'fetch_html') {
    return res.status(400).json({ error: 'Invalid request. tool must be fetch_html.' });
  }

  const decision = firewall.evaluate(req.body);
  if (!decision.allowed) {
    return res.status(403).json(decision);
  }

  const url = (req.body.input as { url?: string })?.url;
  if (!url) {
    return res.status(400).json({ error: 'input.url is required.' });
  }

  try {
    const transportId = (req.body.input as { transportId?: string }).transportId;
    const transport = transportRouter.route(transportId);
    const html = await fetchHtmlAdapter.fetchHtml(url, { transport });
    sessionManager.recordHistory({ id: req.body.compartment, agentId: req.body.agentId }, { tool: 'fetch_html', url });
    sessionManager.setTransportMetadata({ id: req.body.compartment, agentId: req.body.agentId }, { transport });
    logLocal('fetch-html', { agentId: req.body.agentId, compartment: req.body.compartment, transport: transport.id });
    return res.json({ decision, html });
  } catch (error) {
    return res.status(502).json({ error: (error as Error).message });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  logLocal('server.start', { port });
  // eslint-disable-next-line no-console
  console.log(`Gyges Research Layer listening on http://localhost:${port}`);
});
