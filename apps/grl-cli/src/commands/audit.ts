import type { GrlApiClient, AuditFilters, AuditEvent, AuditEventsResponse } from '../client/api-client.js';
import type { GrlCliConfig } from '../config/cli-config.js';
import { printJson } from '../format/json.js';
import { printTable } from '../format/table.js';

/**
 * grl audit [--type <type>] [--severity <severity>] [--limit <n>]
 *
 * Lists security audit events.
 */
export async function runAudit(
  filters: AuditFilters,
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  const result: AuditEventsResponse = await client.listAuditEvents(filters);

  if (config.output === 'json') {
    printJson(result);
    return;
  }

  printTable(
    [
      { header: 'TIMESTAMP', key: 'timestamp' },
      { header: 'TYPE', key: 'type' },
      { header: 'SEVERITY', key: 'severity' },
      { header: 'MESSAGE', key: 'message' }
    ],
    result.events.map((e: AuditEvent) => ({
      ...e,
      timestamp: new Date(e.timestamp).toISOString()
    }))
  );
}
