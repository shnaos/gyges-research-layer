import type { GrlApiClient, Incident, IncidentsResponse } from '../client/api-client.js';
import type { GrlCliConfig } from '../config/cli-config.js';
import { printJson } from '../format/json.js';
import { printTable } from '../format/table.js';

/**
 * grl incidents
 *
 * Lists all runtime security incidents.
 */
export async function runIncidents(
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  const result: IncidentsResponse = await client.listIncidents();

  if (config.output === 'json') {
    printJson(result);
    return;
  }

  printTable(
    [
      { header: 'ID', key: 'id' },
      { header: 'SEVERITY', key: 'severity' },
      { header: 'STATUS', key: 'status' },
      { header: 'CREATED_AT', key: 'createdAt' },
      { header: 'SUMMARY', key: 'summary' }
    ],
    result.incidents.map((i: Incident) => ({
      ...i,
      createdAt: new Date(i.createdAt).toISOString()
    }))
  );
}
