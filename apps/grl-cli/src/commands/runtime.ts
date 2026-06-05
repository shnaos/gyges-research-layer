import type { GrlApiClient } from '../client/api-client.js';
import type { GrlCliConfig } from '../config/cli-config.js';
import { CliError } from '../errors.js';
import { printJson } from '../format/json.js';
import { printKeyValue } from '../format/table.js';

/**
 * grl runtime version
 * grl runtime reload
 * grl runtime profiles
 * grl runtime profile
 * grl runtime profile <name>
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

export async function runRuntimeProfiles(
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  const result = await client.listRuntimeProfiles();

  if (config.output === 'json') {
    printJson(result);
    return;
  }

  for (const profile of result.profiles) {
    const rows: [string, unknown][] = [
      ['name', profile.name],
      ['enabled', profile.enabled],
      ['packs', profile.packIds.join(', ') || '(none)']
    ];
    if (profile.extends) rows.push(['extends', profile.extends]);
    if (profile.description) rows.push(['description', profile.description]);
    printKeyValue(rows);
    process.stdout.write('\n');
  }
}

export async function runRuntimeProfile(
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  const result = await client.getActiveProfile();

  if (config.output === 'json') {
    printJson(result);
    return;
  }

  const profile = result.profile;
  const rows: [string, unknown][] = [
    ['name', profile.name],
    ['enabled', profile.enabled],
    ['packs', profile.packIds.join(', ') || '(none)']
  ];
  if (profile.extends) rows.push(['extends', profile.extends]);
  if (profile.description) rows.push(['description', profile.description]);
  printKeyValue(rows);
}

export async function runRuntimeProfileSwitch(
  name: string,
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  if (!name || name.trim().length === 0) {
    throw new CliError('command_failed', 'Profile name is required.');
  }

  const result = await client.switchProfile(name.trim());

  if (config.output === 'json') {
    printJson(result);
    return;
  }

  printKeyValue([
    ['switched_to', result.profile.name],
    ['packs', result.profile.packIds.join(', ') || '(none)'],
    ['switched_at', new Date(result.switchedAt).toISOString()]
  ]);
}

export async function runRuntimePacks(
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  const result = await client.listRuntimePacks();

  if (config.output === 'json') {
    printJson(result);
    return;
  }

  for (const pack of result.packs) {
    const rows: [string, unknown][] = [['id', pack.id]];
    if (pack.description) rows.push(['description', pack.description]);
    rows.push(['fields', pack.definedFields.join(', ') || '(none)']);
    printKeyValue(rows);
    process.stdout.write('\n');
  }
}
