import express from 'express';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CapabilityFirewall,
  CapabilityRequest,
  TransportType
} from '../../../packages/core/src/index.js';
import { SessionManager } from '../../../packages/identity-compartment/src/index.js';
import { YamlPolicyEngine } from '../../../packages/policy-engine/src/index.js';
import { SearchAdapter, SearxngAdapter } from '../../../packages/search-adapter-searxng/src/index.js';
import { SocksEndpoint, TransportRouter } from '../../../packages/transport-router/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repositoryRoot = resolve(__dirname, '../../../');

export interface ServerDeps {
  firewall: CapabilityFirewall;
  sessionManager: SessionManager;
  searchAdapter: SearchAdapter;
  transportRouter: TransportRouter;
  /** SOCKS5 endpoint used when policy resolves transport=tor. */
  torSocks?: SocksEndpoint;
  /** SOCKS5 endpoint used when policy resolves transport=proxy. */
  proxySocks?: SocksEndpoint;
  timeoutMs?: number;
  logger?: (event: string, payload: unknown) => void;
}

function validateCapabilityRequest(body: Partial<CapabilityRequest>): body is CapabilityRequest {
  return Boolean(body.agentId && body.compartment && body.tool && body.riskLevel);
}

function socksFor(
  transport: TransportType,
  deps: ServerDeps
): SocksEndpoint | undefined {
  if (transport === 'tor') return deps.torSocks;
  if (transport === 'proxy') return deps.proxySocks;
  return undefined;
}

/**
 * Build the GRL HTTP app.
 *
 * Single capability entry point. The agent only ever talks to the firewall.
 * Deny-by-default: every request is evaluated by the policy engine and refused
 * unless an explicit allow rule matches. The transport is resolved from policy,
 * the compartment session is isolated by the Session Manager, and the request
 * is routed through the Transport Router before the isolated adapter runs. The
 * agent never reaches the search engine, nor chooses its own transport.
 */
export function createApp(deps: ServerDeps): express.Express {
  const log = deps.logger ?? (() => {});
  const app = express();
  app.use(express.json());

  app.post('/capabilities/execute', async (req, res) => {
    if (!validateCapabilityRequest(req.body)) {
      return res
        .status(400)
        .json({ error: 'agentId, compartment, tool, riskLevel, and input are required.' });
    }

    const request: CapabilityRequest = req.body;
    const decision = deps.firewall.evaluate(request);
    log('capability.execute', { request, decision });

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

    const transport: TransportType = decision.transport ?? 'direct';

    // Bind (or reuse) the compartment's isolated identity. A compartment is
    // permanently bound to one transport: mixing is rejected (anti-correlation).
    let identity;
    try {
      identity = deps.sessionManager.getOrCreate(request.compartment, {
        transport,
        dnsPolicy: transport === 'direct' ? 'system' : 'remote'
      });
    } catch (error) {
      return res.status(403).json({ decision, error: (error as Error).message });
    }

    // Build a transport-bound client. Fail closed: if Tor/proxy cannot be set
    // up, the request is denied — never silently downgraded to direct.
    let client;
    try {
      client = deps.transportRouter.createClient({
        type: transport,
        userAgent: identity.userAgent,
        dnsPolicy: identity.dnsPolicy,
        sessionId: identity.sessionId,
        timeoutMs: deps.timeoutMs,
        socks: socksFor(transport, deps)
      });
    } catch (error) {
      return res.status(502).json({ decision, error: `Transport unavailable: ${(error as Error).message}` });
    }

    try {
      const results = await deps.searchAdapter.search(query, client);
      deps.sessionManager.recordHistory(request.compartment, { tool: 'search', query });
      log('search', {
        agentId: request.agentId,
        compartment: request.compartment,
        transport
      });
      return res.json({ decision, results });
    } catch (error) {
      return res.status(502).json({ decision, error: (error as Error).message });
    }
  });

  return app;
}

function fileLogger(event: string, payload: unknown): void {
  const logPath = resolve(repositoryRoot, 'logs/grl.log');
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${new Date().toISOString()} ${event} ${JSON.stringify(payload)}\n`, 'utf8');
}

function parseSocksEnv(value: string | undefined, defaultPort: number): SocksEndpoint | undefined {
  if (!value) return undefined;
  const [host, port] = value.split(':');
  return { host: host || '127.0.0.1', port: port ? Number(port) : defaultPort };
}

function startServer(): void {
  const policyPath = resolve(repositoryRoot, 'policies/default.yaml');
  const deps: ServerDeps = {
    firewall: new CapabilityFirewall(YamlPolicyEngine.fromFile(policyPath)),
    sessionManager: new SessionManager(),
    searchAdapter: new SearxngAdapter(process.env.SEARXNG_URL ?? 'http://localhost:8080'),
    transportRouter: new TransportRouter(),
    torSocks: parseSocksEnv(process.env.TOR_SOCKS ?? '127.0.0.1:9050', 9050),
    proxySocks: parseSocksEnv(process.env.PROXY_SOCKS, 1080),
    timeoutMs: process.env.TRANSPORT_TIMEOUT_MS ? Number(process.env.TRANSPORT_TIMEOUT_MS) : undefined,
    logger: fileLogger
  };

  const app = createApp(deps);
  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => {
    fileLogger('server.start', { port });
    // eslint-disable-next-line no-console
    console.log(`Gyges Research Layer listening on http://localhost:${port}`);
  });
}

const invokedDirectly =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  startServer();
}
