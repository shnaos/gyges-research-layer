import type { GrlApiClient, NetworkBindingsResponse, NetworkBindingView, NetworkIsolationResponse, NetworkListFilters, NetworkRelaysResponse, NetworkRoutesResponse, RelayProfileView, RelayRouteView } from '../client/api-client.js';
import type { GrlCliConfig } from '../config/cli-config.js';
import { printJson } from '../format/json.js';
import { printKeyValue, printTable } from '../format/table.js';

/**
 * grl network relays    — list logical relay profiles (metadata only)
 * grl network routes    — list logical relay routes (opaque ids only)
 * grl network bindings  — list compartment→route bindings
 * grl network isolation — show DNS + rotation isolation policies
 *
 * All output is metadata only: never a host, IP, URL, DNS name, endpoint,
 * credential, token, or raw input.
 */

export async function runNetworkRelays(
  client: GrlApiClient,
  config: GrlCliConfig,
  filters: NetworkListFilters = {}
): Promise<void> {
  const result: NetworkRelaysResponse = await client.listNetworkRelays(filters);
  if (config.output === 'json') {
    printJson(result);
    return;
  }
  if (result.relays.length === 0) {
    process.stdout.write('No relay profiles registered.\n');
    return;
  }
  printTable(
    [
      { header: 'ID', key: 'id' },
      { header: 'NAME', key: 'name' },
      { header: 'ENABLED', key: 'enabled' },
      { header: 'ISOLATION', key: 'isolationLevel' },
      { header: 'DNS_ISO', key: 'supportsDnsIsolation' }
    ],
    result.relays.map((r:RelayProfileView) => ({ ...r }))
  );
}

export async function runNetworkRoutes(
  client: GrlApiClient,
  config: GrlCliConfig,
  filters: NetworkListFilters = {}
): Promise<void> {
  const result: NetworkRoutesResponse = await client.listNetworkRoutes(filters);
  if (config.output === 'json') {
    printJson(result);
    return;
  }
  if (result.routes.length === 0) {
    process.stdout.write('No relay routes assigned.\n');
    return;
  }
  printTable(
    [
      { header: 'ROUTE', key: 'id' },
      { header: 'RELAY', key: 'relayProfileId' },
      { header: 'COMPARTMENT', key: 'compartmentId' },
      { header: 'PERSONA', key: 'personaId' },
      { header: 'ACTIVE', key: 'active' }
    ],
    result.routes.map((r: RelayRouteView) => ({ ...r }))
  );
}

export async function runNetworkBindings(
  client: GrlApiClient,
  config: GrlCliConfig,
  filters: NetworkListFilters = {}
): Promise<void> {
  const result: NetworkBindingsResponse = await client.listNetworkBindings(filters);
  if (config.output === 'json') {
    printJson(result);
    return;
  }
  if (result.bindings.length === 0) {
    process.stdout.write('No compartment bindings.\n');
    return;
  }
  printTable(
    [
      { header: 'COMPARTMENT', key: 'compartmentId' },
      { header: 'ROUTE', key: 'relayRouteId' },
      { header: 'ISOLATION', key: 'isolationLevel' }
    ],
    result.bindings.map((b: NetworkBindingView) => ({ ...b }))
  );
}

export async function runNetworkIsolation(
  client: GrlApiClient,
  config: GrlCliConfig
): Promise<void> {
  const result: NetworkIsolationResponse = await client.getNetworkIsolation();
  if (config.output === 'json') {
    printJson(result);
    return;
  }
  printKeyValue([
    ['dns_enabled', result.dnsPolicy.enabled],
    ['dns_isolate_per_compartment', result.dnsPolicy.isolatePerCompartment],
    ['dns_isolate_per_persona', result.dnsPolicy.isolatePerPersona],
    ['dns_isolate_per_fragment', result.dnsPolicy.isolatePerFragment],
    ['rotation_enabled', result.rotationPolicy.enabled],
    ['rotate_on_persona_change', result.rotationPolicy.rotateOnPersonaChange],
    ['rotate_on_category_change', result.rotationPolicy.rotateOnCategoryChange],
    ['rotate_on_critical_risk', result.rotationPolicy.rotateOnCriticalRisk],
    ['max_assignments_per_route', result.rotationPolicy.maxAssignmentsPerRoute]
  ]);
}
