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
import { resolveCliConfig } from './config/cli-config.js';
import { CliError } from './errors.js';
import { runHealth } from './commands/health.js';
import { runSearch } from './commands/search.js';
import { runAudit } from './commands/audit.js';
import { runTrust } from './commands/trust.js';
import { runIncidents } from './commands/incidents.js';
import { runRuntimeVersion, runRuntimeReload, runRuntimeProfiles, runRuntimeProfile, runRuntimeProfileSwitch, runRuntimePacks } from './commands/runtime.js';
import { runTransports } from './commands/transports.js';
import { runAgentsList, runAgentGet, runAgentLeases, runAgentEvict, runAgentRestrict } from './commands/agents.js';

const program = new Command();

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
    await runCommand(async (client, cfg) => {
      const limit = opts.limit !== undefined ? parseInt(opts.limit, 10) : undefined;
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
    await runCommand(async (client, cfg) => {
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
    await runCommand(async (client, cfg) => {
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

// ---------------------------------------------------------------------------
// grl transports
// ---------------------------------------------------------------------------
program
  .command('transports')
  .description('List registered transport manifests')
  .action(async () => {
    await runCommand(async (client, cfg) => {
      await runTransports(client, cfg);
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
    await runCommand(async (client, cfg) => {
      await runAgentsList(client, cfg);
    });
  });

// grl agents <agentId> — show single agent
agentsCmd
  .command('get <agentId>')
  .description('Show the runtime state for a single agent')
  .action(async (agentId: string) => {
    await runCommand(async (client, cfg) => {
      await runAgentGet(agentId, client, cfg);
    });
  });

// grl agents leases [agentId] — list leases
agentsCmd
  .command('leases [agentId]')
  .description('List active runtime leases (optionally filtered to one agent)')
  .action(async (agentId?: string) => {
    await runCommand(async (client, cfg) => {
      await runAgentLeases(agentId, client, cfg);
    });
  });

// grl agents evict <agentId> — evict an agent
agentsCmd
  .command('evict <agentId>')
  .description('Evict an agent from the runtime')
  .action(async (agentId: string) => {
    await runCommand(async (client, cfg) => {
      await runAgentEvict(agentId, client, cfg);
    });
  });

// grl agents restrict <agentId> — restrict an agent
agentsCmd
  .command('restrict <agentId>')
  .description('Restrict an agent (block further execution)')
  .action(async (agentId: string) => {
    await runCommand(async (client, cfg) => {
      await runAgentRestrict(agentId, client, cfg);
    });
  });

// ---------------------------------------------------------------------------
// Shared runner: resolve config, build client, execute command, handle errors.
// ---------------------------------------------------------------------------
async function runCommand(
  fn: (client: GrlApiClient, config: ReturnType<typeof resolveCliConfig>) => Promise<void>
): Promise<void> {
  const opts = program.opts<{ baseUrl?: string; timeout?: string; json?: boolean }>();

  const cfg = resolveCliConfig({
    baseUrl: opts.baseUrl,
    timeoutMs: opts.timeout !== undefined ? parseInt(opts.timeout, 10) : undefined,
    output: opts.json ? 'json' : undefined
  });

  const client = new GrlApiClient(cfg);

  try {
    await fn(client, cfg);
  } catch (err: unknown) {
    if (err instanceof CliError) {
      process.stderr.write(`error [${err.code}]: ${err.message}\n`);
      process.exit(err.exitCode);
    }
    // Unexpected error — surface minimal info, no stack trace by default.
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error [command_failed]: ${msg}\n`);
    process.exit(5);
  }
}

program.parse(process.argv);
