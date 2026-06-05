import type { GrlApiClient } from '../client/api-client.js';
import type { GrlCliConfig } from '../config/cli-config.js';
import { CliError } from '../errors.js';
import { printJson } from '../format/json.js';
import { printKeyValue } from '../format/table.js';

/**
 * grl runtime version
 * grl runtime reload
 */
export async function runRuntimeVersion(
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  const result = await client.runtimeVersion();

  if (config.output === 'json') {
    printJson(result);
    return;
  }

  printKeyValue([['version', result.version]]);
}

export async function runRuntimeReload(
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  const result = await client.runtimeReload();

  if (config.output === 'json') {
    printJson(result);
    return;
  }

  printKeyValue([
    ['version', result.version],
    ['checksum', result.checksum],
    ['loaded_at', new Date(result.loadedAt).toISOString()]
  ]);
}
