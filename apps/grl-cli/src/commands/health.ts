import type { GrlApiClient } from '../client/api-client.js';
import type { GrlCliConfig } from '../config/cli-config.js';
import { printJson } from '../format/json.js';
import { printKeyValue } from '../format/table.js';

/**
 * grl health
 *
 * Displays: runtime status, service name, runtime config version, checksum.
 */
export async function runHealth(
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  const [health, runtimeCfg] = await Promise.all([
    client.health(),
    client.runtimeConfig().catch(() => null)
  ]);

  if (config.output === 'json') {
    printJson({ health, runtime: runtimeCfg });
    return;
  }

  const pairs: Array<[string, unknown]> = [
    ['status', health.status],
    ['service', health.service]
  ];

  if (runtimeCfg) {
    pairs.push(['config_version', runtimeCfg.version]);
    pairs.push(['config_checksum', runtimeCfg.checksum]);
  }

  printKeyValue(pairs);
}
