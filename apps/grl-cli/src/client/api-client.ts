import { CliError } from '../errors.js';
import type { GrlCliConfig } from '../config/cli-config.js';

// ---------------------------------------------------------------------------
// Wire-format response types (minimal subset needed by the CLI).
// These mirror the shapes produced by apps/grl-server/src/api-contract.ts
// without importing from grl-server to keep grl-cli fully independent.
// ---------------------------------------------------------------------------

export interface HealthResponse {
  status: 'ok';
  service: string;
}

export interface ExecuteResponse {
  decision: 'allowed' | 'denied' | 'pending';
  reason: string;
  trust?: { compartmentId: string; score: number; level: string };
  routing?: { transportKind: string };
  execution?: { status: string; transportKind: string; output?: unknown; error?: string };
}

export interface AuditEvent {
  id: string;
  timestamp: number;
  type: string;
  severity: string;
  agentId?: string;
  compartmentId?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface AuditEventsResponse {
  events: AuditEvent[];
}

export interface TrustProfile {
  compartmentId: string;
  score: number;
  level: string;
  createdAt: number;
  updatedAt: number;
}

export interface TrustProfilesResponse {
  profiles: TrustProfile[];
}

export interface TrustProfileResponse {
  profile: TrustProfile;
}

export interface Incident {
  id: string;
  createdAt: number;
  updatedAt: number;
  severity: string;
  status: string;
  summary: string;
}

export interface IncidentsResponse {
  incidents: Incident[];
}

export interface RuntimeVersionResponse {
  version: number;
}

export interface RuntimeReloadResponse {
  version: number;
  loadedAt: number;
  checksum: string;
}

export interface RuntimeConfigResponse {
  version: number;
  loadedAt: number;
  checksum: string;
}

export interface RuntimeProfileView {
  name: string;
  description?: string;
  extends?: string;
  packIds: string[];
  enabled: boolean;
}

export interface PolicyPackView {
  id: string;
  description?: string;
  definedFields: string[];
}

export interface RuntimeProfilesResponse {
  profiles: RuntimeProfileView[];
}

export interface RuntimeProfileResponse {
  profile: RuntimeProfileView;
}

export interface RuntimePacksResponse {
  packs: PolicyPackView[];
}

export interface RuntimeProfileSwitchResponse {
  profile: RuntimeProfileView;
  switchedAt: number;
}

export interface AgentQuotaView {
  maxConcurrentExecutions: number;
  maxSessions: number;
  maxApprovalsPending: number;
  maxAuditEvents: number;
  maxIncidents: number;
}

export interface AgentLeaseView {
  id: string;
  acquiredAt: number;
  expiresAt: number;
  renewable: boolean;
  holderAgentId: string;
}

export interface AgentRuntimeView {
  agentId: string;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'idle' | 'restricted' | 'quarantined' | 'evicted';
  compartments: string[];
  trustScore: number;
  activeSessions: number;
  activeExecutions: number;
  quota: AgentQuotaView;
  lease?: AgentLeaseView;
}

export interface AgentsResponse {
  agents: AgentRuntimeView[];
}

export interface AgentResponse {
  agent: AgentRuntimeView;
}

export interface AgentLeasesResponse {
  agentId: string;
  leases: AgentLeaseView[];
}

export interface AgentTrustResponse {
  trust: {
    agentId: string;
    trustScore: number;
    status: string;
  };
}

export interface AgentActionResponse {
  agentId: string;
  status: string;
  updatedAt: number;
}

export interface BehavioralProfileView {
  agentId: string;
  createdAt: number;
  updatedAt: number;
  correlationRisk: 'low' | 'medium' | 'high' | 'critical';
  activeIdentityFragments: number;
  recentSearchTopics: string[];
  temporalPatternsDetected: number;
  repeatedBehaviorScore: number;
}

export interface BehavioralProfilesResponse {
  profiles: BehavioralProfileView[];
}

export interface BehavioralProfileResponse {
  profile: BehavioralProfileView;
}

export interface IdentityFragmentView {
  id: string;
  agentId: string;
  createdAt: number;
  expiresAt: number;
  isolatedSessionIds: string[];
  isolatedTransportKinds: string[];
  active: boolean;
  requestCount: number;
}

export interface IdentityFragmentsResponse {
  fragments: IdentityFragmentView[];
}

export interface TransportManifest {
  kind: string;
  name: string;
  version: string;
  supportedTools: string[];
  declaredPermissions: string[];
  networkAccess: boolean;
  browserAccess: boolean;
  filesystemAccess: boolean;
  processSpawnAccess: boolean;
  envAccess: boolean;
}

export interface TransportsResponse {
  transports: TransportManifest[];
}

export interface AuditFilters {
  type?: string;
  severity?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// API Client
// ---------------------------------------------------------------------------

/**
 * GRL API client.
 *
 * Constraints:
 *  - Local API only (no remote, no auth, no cloud).
 *  - Mandatory timeout on every request.
 *  - Fail-closed: any network error, timeout, or non-200 is a CliError.
 *  - No retry, no cache, no cookies, no secret headers.
 *  - Never logs tokens, raw inputs, secrets, or full headers.
 */
export class GrlApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: Pick<GrlCliConfig, 'baseUrl' | 'timeoutMs'>) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      const init: RequestInit = {
        method,
        signal: controller.signal,
        headers: { 'accept': 'application/json' }
      };
      if (body !== undefined) {
        (init.headers as Record<string, string>)['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      response = await fetch(url, init);
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new CliError(
          'request_timeout',
          `Request timed out after ${this.timeoutMs}ms (${method} ${path})`
        );
      }
      throw new CliError(
        'runtime_unreachable',
        `GRL runtime unreachable at ${this.baseUrl} — is the server running?`
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`;
      try {
        const errBody = (await response.json()) as { error?: unknown };
        if (typeof errBody.error === 'string') errorMsg = errBody.error;
      } catch {
        // ignore parse failure
      }
      throw new CliError('command_failed', errorMsg);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new CliError('invalid_response', `Invalid JSON response from ${method} ${path}`);
    }

    return json as T;
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/v1/health');
  }

  async executeSearch(query: string): Promise<ExecuteResponse> {
    return this.request<ExecuteResponse>('POST', '/v1/capabilities/execute', {
      agentId: 'grl-cli',
      compartmentId: 'research',
      tool: 'web_search',
      riskLevel: 'low',
      input: { query }
    });
  }

  async listAuditEvents(filters: AuditFilters = {}): Promise<AuditEventsResponse> {
    const params = new URLSearchParams();
    if (filters.type) params.set('type', filters.type);
    if (filters.severity) params.set('severity', filters.severity);
    if (filters.limit !== undefined) params.set('limit', String(filters.limit));
    const qs = params.toString();
    return this.request<AuditEventsResponse>('GET', `/v1/audit/events${qs ? `?${qs}` : ''}`);
  }

  async listTrustProfiles(): Promise<TrustProfilesResponse> {
    return this.request<TrustProfilesResponse>('GET', '/v1/trust/profiles');
  }

  async getTrustProfile(compartmentId: string): Promise<TrustProfileResponse> {
    const encoded = encodeURIComponent(compartmentId);
    return this.request<TrustProfileResponse>('GET', `/v1/trust/profiles/${encoded}`);
  }

  async listIncidents(): Promise<IncidentsResponse> {
    return this.request<IncidentsResponse>('GET', '/v1/security/incidents');
  }

  async listBehavioralProfiles(): Promise<BehavioralProfilesResponse> {
    return this.request<BehavioralProfilesResponse>('GET', '/v1/privacy/behavioral/profiles');
  }

  async getBehavioralProfile(agentId: string): Promise<BehavioralProfileResponse> {
    const encoded = encodeURIComponent(agentId);
    return this.request<BehavioralProfileResponse>(
      'GET',
      `/v1/privacy/behavioral/profiles/${encoded}`
    );
  }

  async listIdentityFragments(agentId?: string): Promise<IdentityFragmentsResponse> {
    if (agentId !== undefined) {
      const encoded = encodeURIComponent(agentId);
      return this.request<IdentityFragmentsResponse>('GET', `/v1/privacy/fragments/${encoded}`);
    }
    return this.request<IdentityFragmentsResponse>('GET', '/v1/privacy/fragments');
  }

  async runtimeVersion(): Promise<RuntimeVersionResponse> {
    return this.request<RuntimeVersionResponse>('GET', '/v1/runtime/config/version');
  }

  async runtimeConfig(): Promise<RuntimeConfigResponse> {
    return this.request<RuntimeConfigResponse>('GET', '/v1/runtime/config');
  }

  async runtimeReload(): Promise<RuntimeReloadResponse> {
    return this.request<RuntimeReloadResponse>('POST', '/v1/runtime/reload');
  }

  async listTransports(): Promise<TransportsResponse> {
    return this.request<TransportsResponse>('GET', '/v1/transports');
  }

  async listRuntimeProfiles(): Promise<RuntimeProfilesResponse> {
    return this.request<RuntimeProfilesResponse>('GET', '/v1/runtime/profiles');
  }

  async getActiveProfile(): Promise<RuntimeProfileResponse> {
    return this.request<RuntimeProfileResponse>('GET', '/v1/runtime/profile');
  }

  async listRuntimePacks(): Promise<RuntimePacksResponse> {
    return this.request<RuntimePacksResponse>('GET', '/v1/runtime/packs');
  }

  async switchProfile(name: string): Promise<RuntimeProfileSwitchResponse> {
    const encoded = encodeURIComponent(name);
    return this.request<RuntimeProfileSwitchResponse>('POST', `/v1/runtime/profile/${encoded}`);
  }

  async listAgents(): Promise<AgentsResponse> {
    return this.request<AgentsResponse>('GET', '/v1/agents');
  }

  async getAgent(agentId: string): Promise<AgentResponse> {
    const encoded = encodeURIComponent(agentId);
    return this.request<AgentResponse>('GET', `/v1/agents/${encoded}`);
  }

  async listAgentLeases(agentId: string): Promise<AgentLeasesResponse> {
    const encoded = encodeURIComponent(agentId);
    return this.request<AgentLeasesResponse>('GET', `/v1/agents/${encoded}/leases`);
  }

  async getAgentTrust(agentId: string): Promise<AgentTrustResponse> {
    const encoded = encodeURIComponent(agentId);
    return this.request<AgentTrustResponse>('GET', `/v1/agents/${encoded}/trust`);
  }

  async restrictAgent(agentId: string): Promise<AgentActionResponse> {
    const encoded = encodeURIComponent(agentId);
    return this.request<AgentActionResponse>('POST', `/v1/agents/${encoded}/restrict`);
  }

  async evictAgent(agentId: string): Promise<AgentActionResponse> {
    const encoded = encodeURIComponent(agentId);
    return this.request<AgentActionResponse>('POST', `/v1/agents/${encoded}/evict`);
  }
}
