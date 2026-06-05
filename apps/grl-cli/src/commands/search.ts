import type { GrlApiClient } from '../client/api-client.js';
import type { GrlCliConfig } from '../config/cli-config.js';
import { CliError } from '../errors.js';
import { printJson } from '../format/json.js';
import { printKeyValue } from '../format/table.js';

/**
 * grl search "<query>"
 *
 * Executes a search via POST /v1/capabilities/execute and displays:
 *   decision, transportKind, result count, trust level, execution status.
 */
export async function runSearch(
  query: string,
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  if (!query || query.trim().length === 0) {
    throw new CliError('invalid_arguments', 'Search query must not be empty.');
  }

  const result = await client.executeSearch(query.trim());

  if (config.output === 'json') {
    printJson(result);
    return;
  }

  const pairs: Array<[string, unknown]> = [
    ['decision', result.decision],
    ['reason', result.reason]
  ];

  if (result.trust) {
    pairs.push(['trust_level', result.trust.level]);
    pairs.push(['trust_score', result.trust.score]);
  }

  if (result.routing) {
    pairs.push(['transport', result.routing.transportKind]);
  }

  if (result.execution) {
    pairs.push(['execution_status', result.execution.status]);
    pairs.push(['execution_transport', result.execution.transportKind]);
    if (result.execution.error) {
      pairs.push(['execution_error', result.execution.error]);
    }
    if (result.execution.output !== undefined) {
      const output = result.execution.output;
      if (Array.isArray(output)) {
        pairs.push(['result_count', output.length]);
      }
    }
  }

  printKeyValue(pairs);
}
