import type { GrlApiClient, TrustProfile, TrustProfileResponse, TrustProfilesResponse } from '../client/api-client.js';
import type { GrlCliConfig } from '../config/cli-config.js';
import { CliError } from '../errors.js';
import { printJson } from '../format/json.js';
import { printTable, printKeyValue } from '../format/table.js';

/**
 * grl trust [compartmentId]
 *
 * Without compartmentId: lists all trust profiles.
 * With compartmentId: shows a single profile.
 */
export async function runTrust(
  compartmentId: string | undefined,
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  if (compartmentId) {
    const result :TrustProfileResponse = await client.getTrustProfile(compartmentId).catch((err: unknown) => {
      if (err instanceof CliError && err.code === 'command_failed') {
        throw new CliError('command_failed', `Trust profile not found: ${compartmentId}`);
      }
      throw err;
    });

    if (config.output === 'json') {
      printJson(result);
      return;
    }

    const p: TrustProfile = result.profile;
    printKeyValue([
      ['compartment', p.compartmentId],
      ['score', p.score],
      ['level', p.level],
      ['updatedAt', new Date(p.updatedAt).toISOString()]
    ]);
  } else {
    const result :TrustProfilesResponse = await client.listTrustProfiles();

    if (config.output === 'json') {
      printJson(result);
      return;
    }

    printTable(
      [
        { header: 'COMPARTMENT', key: 'compartmentId' },
        { header: 'SCORE', key: 'score' },
        { header: 'LEVEL', key: 'level' },
        { header: 'UPDATED_AT', key: 'updatedAt' }
      ],
      result.profiles.map((p: TrustProfile) => ({
        ...p,
        updatedAt: new Date(p.updatedAt).toISOString()
      }))
    );
  }
}
