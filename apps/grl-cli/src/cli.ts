#!/usr/bin/env node
/**
 * GRL CLI — Local Operator UX for Gyges Research Layer.
 *
 * Privacy-first, local-first, deterministic.
 * No telemetry. No analytics. No cloud. No auth.
 * No tokens, secrets, or raw inputs are ever logged.
 */

import { Command } from 'commander';
import { GrlApiClient } from './client/api-client.js';
import { GrlCliConfig, resolveCliConfig } from './config/cli-config.js';
import { CliError } from './errors.js';
import { runHealth } from './commands/health.js';
import { runSearch } from './commands/search.js';
import { runAudit } from './commands/audit.js';
import { runTrust } from './commands/trust.js';
import { runIncidents } from './commands/incidents.js';
import { runRuntimeVersion, runRuntimeReload, runRuntimeProfiles, runRuntimeProfile, runRuntimeProfileSwitch, runRuntimePacks, runRuntimePolicy, runRuntimePolicySignals, runRuntimePolicyLastDecision } from './commands/runtime.js';
import { runTransports } from './commands/transports.js';
import { runNetworkRelays, runNetworkRoutes, runNetworkBindings, runNetworkIsolation } from './commands/network.js';
import { runAgentsList, runAgentGet, runAgentLeases, runAgentEvict, runAgentRestrict } from './commands/agents.js';
import {
  runPrivacyFragments,
  runPrivacyProfile,
  runPrivacyProfiles,
  runPrivacyPersonas,
  runPrivacyBindings,
  runPrivacyTemporal,
  runPrivacyBudgets,
  runPrivacyFingerprints,
  runPrivacyHeaderPolicies
} from './commands/privacy.js';

const program: Command = new Command();

program
  .name('grl')
  .description('GRL CLI — Local operator interface for Gyges Research Layer')
  .version('0.1.0', '-v, --version')
  .option('--base-url <url>', 'GRL server base URL (default: http://127.0.0.1:8787)')
  .option('--timeout <ms>', 'Request timeout in milliseconds (default: 5000)')
  .option('--json', 'Output as JSON');

// ---------------------------------------------------------------------------
// grl health
// ---------------------------------------------------------------------------
program
  .command('health')
  .description('Show GRL runtime status and config checksum')
  .action(async () => {
    await runCommand(async (client, cfg) => {
      await runHealth(client, cfg);
    });
  });

// ---------------------------------------------------------------------------
// grl search "<query>"
// ---------------------------------------------------------------------------
program
  .command('search <query>')
  .description('Execute a search via the GRL runtime')
  .action(async (query: string) => {
    await runCommand(async (client, cfg) => {
      await runSearch(query, client, cfg);
    });
  });

// ---------------------------------------------------------------------------
// grl audit
// ---------------------------------------------------------------------------
program
  .command('audit')
  .description('List security audit events')
  .option('--type <type>', 'Filter by event type')
  .option('--severity <severity>', 'Filter by severity (debug|info|warning|critical)')
  .option('--limit <n>', 'Maximum number of events to show')
  .action(async (opts: { type?: string; severity?: string; limit?: string }) => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      const limit: number | undefined = opts.limit !== undefined ? parseInt(opts.limit, 10) : undefined;
      await runAudit({ type: opts.type, severity: opts.severity, limit }, client, cfg);
    });
  });

// ---------------------------------------------------------------------------
// grl trust [compartmentId]
// ---------------------------------------------------------------------------
program
  .command('trust [compartmentId]')
  .description('List trust profiles or show a single profile')
  .action(async (compartmentId?: string) => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      await runTrust(compartmentId, client, cfg);
    });
  });

// ---------------------------------------------------------------------------
// grl incidents
// ---------------------------------------------------------------------------
program
  .command('incidents')
  .description('List runtime security incidents')
  .action(async () => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      await runIncidents(client, cfg);
    });
  });

// ---------------------------------------------------------------------------
// grl runtime <subcommand>
// ---------------------------------------------------------------------------
const runtimeCmd = program
  .command('runtime')
  .description('Runtime management commands');

runtimeCmd
  .command('version')
  .description('Show the active runtime config version')
  .action(async () => {
    await runCommand(async (client, cfg) => {
      await runRuntimeVersion(client, cfg);
    });
  });

runtimeCmd
  .command('reload')
  .description('Reload the runtime configuration from disk')
  .action(async () => {
    await runCommand(async (client, cfg) => {
      await runRuntimeReload(client, cfg);
    });
  });

runtimeCmd
  .command('profiles')
  .description('List all available runtime profiles')
  .action(async () => {
    await runCommand(async (client, cfg) => {
      await runRuntimeProfiles(client, cfg);
    });
  });

runtimeCmd
  .command('packs')
  .description('List all available policy packs')
  .action(async () => {
    await runCommand(async (client, cfg) => {
      await runRuntimePacks(client, cfg);
    });
  });

runtimeCmd
  .command('profile [name]')
  .description('Show active profile, or switch to a named profile')
  .action(async (name?: string) => {
    await runCommand(async (client, cfg) => {
      if (name) {
        await runRuntimeProfileSwitch(name, client, cfg);
      } else {
        await runRuntimeProfile(client, cfg);
      }
    });
  });

// Sprint 28 — grl runtime policy <subcommand>
const policyCmd = runtimeCmd
  .command('policy')
  .description('Inspect the runtime policy orchestrator');

policyCmd
  .action(async () => {
    await runCommand(async (client, cfg) => {
      await runRuntimePolicy(client, cfg);
    });
  });

policyCmd
  .command('signals')
  .description('List buffered policy orchestrator signals')
  .option('--source <source>', 'Filter by signal source (e.g. multi_agent)')
  .option('--action <action>', 'Filter by unified privacy action (e.g. deny)')
  .option('--severity <severity>', 'Filter by severity (info|low|medium|high|critical)')
  .option('--limit <n>', 'Maximum number of signals to show')
  .action(async (opts: { source?: string; action?: string; severity?: string; limit?: string }) => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      const limit: number | undefined = opts.limit !== undefined ? parseInt(opts.limit, 10) : undefined;
      await runRuntimePolicySignals(client, cfg, {
        source: opts.source,
        action: opts.action,
        severity: opts.severity,
        limit
      });
    });
  });

policyCmd
  .command('last-decision')
  .description('Show the last composite runtime policy decision')
  .action(async () => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      await runRuntimePolicyLastDecision(client, cfg);
    });
  });

// ---------------------------------------------------------------------------
// grl transports
// ---------------------------------------------------------------------------
program
  .command('transports')
  .description('List registered transport manifests')
  .action(async () => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      await runTransports(client, cfg);
    });
  });

// ---------------------------------------------------------------------------
// grl network [subcommand] — Sprint 30 (metadata only; no host/IP/URL/DNS)
// ---------------------------------------------------------------------------
const networkCmd = program
  .command('network')
  .description('Network isolation / relay inspection commands (metadata only)');

networkCmd
  .command('relays', { isDefault: true })
  .description('List logical relay profiles')
  .option('--limit <n>', 'Maximum number of relays to show')
  .action(async (opts: { limit?: string }) => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      const limit: number | undefined = opts.limit !== undefined ? parseInt(opts.limit, 10) : undefined;
      await runNetworkRelays(client, cfg, { limit });
    });
  });

networkCmd
  .command('routes')
  .description('List logical relay routes (opaque ids only)')
  .option('--limit <n>', 'Maximum number of routes to show')
  .action(async (opts: { limit?: string }) => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      const limit: number | undefined = opts.limit !== undefined ? parseInt(opts.limit, 10) : undefined;
      await runNetworkRoutes(client, cfg, { limit });
    });
  });

networkCmd
  .command('bindings')
  .description('List compartment→route bindings')
  .option('--limit <n>', 'Maximum number of bindings to show')
  .action(async (opts: { limit?: string }) => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      const limit: number | undefined = opts.limit !== undefined ? parseInt(opts.limit, 10) : undefined;
      await runNetworkBindings(client, cfg, { limit });
    });
  });

networkCmd
  .command('isolation')
  .description('Show DNS + rotation isolation policies')
  .action(async () => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      await runNetworkIsolation(client, cfg);
    });
  });

// ---------------------------------------------------------------------------
// grl privacy [subcommand]
// ---------------------------------------------------------------------------
const privacyCmd = program
  .command('privacy')
  .description('Behavioral privacy inspection commands');

privacyCmd
  .command('profiles', { isDefault: true })
  .description('List all behavioral privacy profiles')
  .action(async () => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      await runPrivacyProfiles(client, cfg);
    });
  });

privacyCmd
  .command('profile <agentId>')
  .description('Show a single behavioral privacy profile')
  .action(async (agentId: string) => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      await runPrivacyProfile(agentId, client, cfg);
    });
  });

privacyCmd
  .command('fragments [agentId]')
  .description('List identity fragments, optionally filtered to one agent')
  .action(async (agentId?: string) => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      await runPrivacyFragments(agentId, client, cfg);
    });
  });

privacyCmd
  .command('personas [agentId]')
  .description('List search personas, optionally filtered to one agent')
  .action(async (agentId?: string) => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      await runPrivacyPersonas(agentId, client, cfg);
    });
  });

privacyCmd
  .command('bindings [agentId]')
  .description('List persona-fragment bindings, optionally filtered to one agent')
  .action(async (agentId?: string) => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      await runPrivacyBindings(agentId, client, cfg);
    });
  });

privacyCmd
  .command('temporal [agentId]')
  .description('List temporal obfuscation profiles (optionally for one agent)')
  .action(async (agentId?: string) => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      await runPrivacyTemporal(agentId, client, cfg);
    });
  });

privacyCmd
  .command('budgets [agentId]')
  .description('List temporal privacy budgets (optionally for one agent)')
  .action(async (agentId?: string) => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      await runPrivacyBudgets(agentId, client, cfg);
    });
  });

privacyCmd
  .command('fingerprints [agentId]')
  .description('List fingerprint profiles (optionally for one agent)')
  .action(async (agentId?: string) => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      await runPrivacyFingerprints(agentId, client, cfg);
    });
  });

privacyCmd
  .command('header-policies')
  .description('Show transport header isolation policies')
  .action(async () => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      await runPrivacyHeaderPolicies(client, cfg);
    });
  });

// ---------------------------------------------------------------------------
// grl agents [subcommand]
// ---------------------------------------------------------------------------
const agentsCmd = program
  .command('agents')
  .description('Multi-agent runtime management commands');

// grl agents — list all agents
agentsCmd
  .command('list', { isDefault: true })
  .description('List all registered agent runtimes')
  .action(async () => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      await runAgentsList(client, cfg);
    });
  });

// grl agents <agentId> — show single agent
agentsCmd
  .command('get <agentId>')
  .description('Show the runtime state for a single agent')
  .action(async (agentId: string) => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      await runAgentGet(agentId, client, cfg);
    });
  });

// grl agents leases [agentId] — list leases
agentsCmd
  .command('leases [agentId]')
  .description('List active runtime leases (optionally filtered to one agent)')
  .action(async (agentId?: string) => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      await runAgentLeases(agentId, client, cfg);
    });
  });

// grl agents evict <agentId> — evict an agent
agentsCmd
  .command('evict <agentId>')
  .description('Evict an agent from the runtime')
  .action(async (agentId: string) => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      await runAgentEvict(agentId, client, cfg);
    });
  });

// grl agents restrict <agentId> — restrict an agent
agentsCmd
  .command('restrict <agentId>')
  .description('Restrict an agent (block further execution)')
  .action(async (agentId: string) => {
    await runCommand(async (client: GrlApiClient, cfg: GrlCliConfig) => {
      await runAgentRestrict(agentId, client, cfg);
    });
  });

// ---------------------------------------------------------------------------
// Shared runner: resolve config, build client, execute command, handle errors.
// ---------------------------------------------------------------------------
async function runCommand(
  fn: (client: GrlApiClient, config: GrlCliConfig) => Promise<void>
): Promise<void> {
  const opts: { baseUrl?: string; timeout?: string; json?: boolean } = program.opts<{ baseUrl?: string; timeout?: string; json?: boolean }>();

  const cfg : GrlCliConfig = resolveCliConfig({
    baseUrl: opts.baseUrl,
    timeoutMs: opts.timeout !== undefined ? parseInt(opts.timeout, 10) : undefined,
    output: opts.json ? 'json' : undefined
  });

  const client: GrlApiClient = new GrlApiClient(cfg);

  try {
    await fn(client, cfg);
  } catch (err: unknown) {
    if (err instanceof CliError) {
      process.stderr.write(`error [${err.code}]: ${err.message}\n`);
      process.exit(err.exitCode);
    }
    // Unexpected error — surface minimal info, no stack trace by default.
    const msg: string = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error [command_failed]: ${msg}\n`);
    process.exit(5);
  }
}

program.parse(process.argv);
