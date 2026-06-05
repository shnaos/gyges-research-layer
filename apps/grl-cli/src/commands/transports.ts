import type { GrlApiClient } from '../client/api-client.js';
import type { GrlCliConfig } from '../config/cli-config.js';
import { printJson } from '../format/json.js';
import { printTable } from '../format/table.js';

/**
 * grl transports
 *
 * Lists registered transport manifests: kind, name, permissions, sandbox status.
 */
export async function runTransports(
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  const result = await client.listTransports();

  if (config.output === 'json') {
    printJson(result);
    return;
  }

  printTable(
    [
      { header: 'KIND', key: 'kind' },
      { header: 'NAME', key: 'name' },
      { header: 'VERSION', key: 'version' },
      { header: 'NETWORK', key: 'networkAccess' },
      { header: 'BROWSER', key: 'browserAccess' },
      { header: 'PERMISSIONS', key: 'permissions' }
    ],
    result.transports.map((t) => ({
      ...t,
      permissions: t.declaredPermissions.join(',')
    }))
  );
}
