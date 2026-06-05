/**
 * GRL Agent SDK HTTP client.
 *
 * Privacy / security guarantees (strictly enforced):
 *  - ONLY talks to the GRL Local API (baseUrl, loopback by default).
 *  - Mandatory timeout on every request — no hanging calls.
 *  - Fail-closed: any error produces a typed {@link GrlAgentSdkError}.
 *  - No retry, no cookie, no cache, no telemetry, no analytics.
 *  - No secret or auth header of any kind.
 *  - No direct web fetch, no SearXNG call, no browser, no WebSocket/SSE.
 *  - No file writes, no DB, no Redis, no cloud sync.
 *  - Raw query and approvalToken are NEVER logged or stored.
 */

import { GrlAgentSdkError } from './errors.js';
import { isAllowed, isDenied, isPending } from './search.js';
import type {
  ApprovalResult,
  AuditEvent,
  AuditFilters,
  CapabilityRequestInput,
  CapabilityRequestResult,
  GrlAgentSdkConfig,
  HealthResult,
  RuntimeIncident,
  RuntimeProfileInfo,
  RuntimeProfileSwitchResult,
  SearchOptions,
  SearchResult,
  SearchResultItem,
  TransportInfo,
  TrustProfile
} from './types.js';
import { DEFAULT_SDK_CONFIG } from './types.js';

// Re-export helpers so consumers can use them via the client module too.
export { isAllowed, isDenied, isPending };

// ---------------------------------------------------------------------------
// Internal wire types — mirror GRL Local API shapes without importing from
// grl-server to keep the SDK fully standalone.
// ---------------------------------------------------------------------------

interface WireExecuteResponse {
  decision: 'allowed' | 'denied' | 'pending';
  reason: string;
  execution?: {
    status: 'success' | 'blocked' | 'failed';
    transportKind: string;
    output?: unknown;
    error?: string;
  };
  approvalRequestId?: string;
  approvalToken?: string;
}

interface WireRequestResponse {
  decision: 'allowed' | 'denied' | 'pending';
  reason: string;
  approvalRequestId?: string;
  approvalToken?: string;
}

interface WireApprovalDecisionResponse {
  id: string;
  status: 'approved' | 'rejected';
}

interface WireAuditEventsResponse {
  events: AuditEvent[];
}

interface WireTrustProfilesResponse {
  profiles: TrustProfile[];
}

interface WireTrustProfileResponse {
  profile: TrustProfile;
}

interface WireIncidentsResponse {
  incidents: RuntimeIncident[];
}

interface WireRuntimeProfilesResponse {
  profiles: RuntimeProfileInfo[];
}

interface WireRuntimeProfileResponse {
  profile: RuntimeProfileInfo;
}

interface WireRuntimeProfileSwitchResponse {
  profile: RuntimeProfileInfo;
  switchedAt: number;
}

interface WireTransportsResponse {
  transports: TransportInfo[];
}

interface WireHealthResponse {
  status: 'ok';
  service: string;
}

// ---------------------------------------------------------------------------
// GrlAgentClient
// ---------------------------------------------------------------------------

/**
 * Main entry point for agents using the GRL Local API.
 *
 * All network I/O goes exclusively through the local GRL API — never directly
 * to the web, SearXNG, a browser, or any external service.
 */
export class GrlAgentClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly agentId: string;
  private readonly compartmentId: string;

  constructor(config: GrlAgentSdkConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_SDK_CONFIG.baseUrl).replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? DEFAULT_SDK_CONFIG.timeoutMs;
    this.agentId = config.agentId ?? DEFAULT_SDK_CONFIG.agentId;
    this.compartmentId = config.compartmentId ?? DEFAULT_SDK_CONFIG.compartmentId;
  }

  // -------------------------------------------------------------------------
  // Internal HTTP transport
  // -------------------------------------------------------------------------

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
      const headers: Record<string, string> = { accept: 'application/json' };
      const init: RequestInit = { method, signal: controller.signal, headers };
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      response = await fetch(url, init);
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new GrlAgentSdkError(
          'request_timeout',
          `Request timed out after ${this.timeoutMs}ms`
        );
      }
      throw new GrlAgentSdkError(
        'runtime_unreachable',
        'GRL runtime unreachable — is the server running?'
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const errBody = (await response.json()) as { error?: unknown };
        if (typeof errBody.error === 'string') detail = errBody.error;
      } catch {
        // ignore parse failure
      }
      throw new GrlAgentSdkError('capability_failed', detail);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new GrlAgentSdkError(
        'invalid_response',
        `Invalid JSON response from ${method} ${path}`
      );
    }

    return json as T;
  }

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  /** Check whether the GRL runtime is reachable and healthy. */
  async health(): Promise<HealthResult> {
    const wire = await this.request<WireHealthResponse>('GET', '/v1/health');
    return { status: wire.status, service: wire.service };
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  /**
   * Execute a search query through the GRL runtime.
   *
   * Privacy guarantee: the raw query string is NEVER logged or persisted by
   * this SDK. It is forwarded only to the local GRL API endpoint.
   *
   * @param query - The search query string.
   * @param options - Optional overrides for risk level, agentId, compartmentId.
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult> {
    if (typeof query !== 'string' || query.trim() === '') {
      throw new GrlAgentSdkError('invalid_arguments', 'query must be a non-empty string');
    }

    const agentId = options.agentId ?? this.agentId;
    const compartmentId = options.compartmentId ?? this.compartmentId;
    const riskLevel = options.riskLevel ?? 'low';

    const wire = await this.request<WireExecuteResponse>(
      'POST',
      '/v1/capabilities/execute',
      {
        agentId,
        compartmentId,
        tool: 'search',
        riskLevel,
        input: { query }
      }
    );

    return this.mapExecuteToSearchResult(wire);
  }

  private mapExecuteToSearchResult(wire: WireExecuteResponse): SearchResult {
    if (wire.decision === 'denied') {
      const result: import('./types.js').SearchDeniedResult = {
        status: 'denied',
        reason: wire.reason,
        raw: wire
      };
      return result;
    }

    if (wire.decision === 'pending') {
      const result: import('./types.js').SearchPendingResult = {
        status: 'pending',
        reason: wire.reason,
        approvalRequestId: wire.approvalRequestId ?? '',
        approvalToken: wire.approvalToken ?? '',
        raw: wire
      };
      return result;
    }

    // allowed
    const exec = wire.execution;
    let results: SearchResultItem[] | undefined;

    if (exec?.output && typeof exec.output === 'object') {
      const output = exec.output as Record<string, unknown>;
      if (Array.isArray(output['results'])) {
        results = (output['results'] as unknown[]).filter(
          (r): r is SearchResultItem =>
            typeof r === 'object' && r !== null && typeof (r as Record<string, unknown>)['title'] === 'string'
        );
      }
    }

    const result: import('./types.js').SearchAllowedResult = {
      status: 'allowed',
      executionStatus: exec?.status ?? 'success',
      transportKind: exec?.transportKind,
      results,
      raw: wire
    };
    return result;
  }

  // -------------------------------------------------------------------------
  // Capability Request (generic)
  // -------------------------------------------------------------------------

  /**
   * Request a generic capability from the GRL runtime.
   *
   * Allows callers to request capabilities other than search. The runtime
   * evaluates the request against the active firewall policy and returns a
   * decision with optional approval fields when pending.
   */
  async requestCapability(input: CapabilityRequestInput): Promise<CapabilityRequestResult> {
    if (!input.tool || typeof input.tool !== 'string') {
      throw new GrlAgentSdkError('invalid_arguments', 'tool must be a non-empty string');
    }

    const wire = await this.request<WireRequestResponse>(
      'POST',
      '/v1/capabilities/request',
      {
        agentId: input.agentId ?? this.agentId,
        compartmentId: input.compartmentId ?? this.compartmentId,
        tool: input.tool,
        riskLevel: input.riskLevel ?? 'low',
        input: input.input ?? null
      }
    );

    return {
      decision: wire.decision,
      reason: wire.reason,
      approvalRequestId: wire.approvalRequestId,
      approvalToken: wire.approvalToken,
      raw: wire
    };
  }

  // -------------------------------------------------------------------------
  // Approvals
  // -------------------------------------------------------------------------

  /**
   * Approve a pending capability request.
   *
   * Privacy guarantee: the approvalToken is forwarded only to the local GRL
   * API and is NEVER logged or stored by this SDK.
   */
  async approve(id: string, token: string): Promise<ApprovalResult> {
    if (!id || typeof id !== 'string') {
      throw new GrlAgentSdkError('invalid_arguments', 'id must be a non-empty string');
    }
    if (!token || typeof token !== 'string') {
      throw new GrlAgentSdkError('invalid_arguments', 'token must be a non-empty string');
    }

    const encoded = encodeURIComponent(id);
    const wire = await this.request<WireApprovalDecisionResponse>(
      'POST',
      `/v1/approvals/${encoded}/approve`,
      { token }
    );

    return { id: wire.id, status: wire.status, raw: wire };
  }

  /**
   * Reject a pending capability request.
   *
   * Privacy guarantee: the approvalToken is forwarded only to the local GRL
   * API and is NEVER logged or stored by this SDK.
   */
  async reject(id: string, token: string): Promise<ApprovalResult> {
    if (!id || typeof id !== 'string') {
      throw new GrlAgentSdkError('invalid_arguments', 'id must be a non-empty string');
    }
    if (!token || typeof token !== 'string') {
      throw new GrlAgentSdkError('invalid_arguments', 'token must be a non-empty string');
    }

    const encoded = encodeURIComponent(id);
    const wire = await this.request<WireApprovalDecisionResponse>(
      'POST',
      `/v1/approvals/${encoded}/reject`,
      { token }
    );

    return { id: wire.id, status: wire.status, raw: wire };
  }

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  /** List audit events from the GRL runtime, optionally filtered. */
  async listAuditEvents(filters: AuditFilters = {}): Promise<AuditEvent[]> {
    const params = new URLSearchParams();
    if (filters.type) params.set('type', filters.type);
    if (filters.severity) params.set('severity', filters.severity);
    if (filters.limit !== undefined) params.set('limit', String(filters.limit));
    const qs = params.toString();
    const wire = await this.request<WireAuditEventsResponse>(
      'GET',
      `/v1/audit/events${qs ? `?${qs}` : ''}`
    );
    return wire.events;
  }

  // -------------------------------------------------------------------------
  // Trust
  // -------------------------------------------------------------------------

  /** List all compartment trust profiles. */
  async listTrustProfiles(): Promise<TrustProfile[]> {
    const wire = await this.request<WireTrustProfilesResponse>('GET', '/v1/trust/profiles');
    return wire.profiles;
  }

  /** Get the trust profile for a specific compartment. */
  async getTrustProfile(compartmentId: string): Promise<TrustProfile> {
    if (!compartmentId || typeof compartmentId !== 'string') {
      throw new GrlAgentSdkError('invalid_arguments', 'compartmentId must be a non-empty string');
    }
    const encoded = encodeURIComponent(compartmentId);
    const wire = await this.request<WireTrustProfileResponse>(
      'GET',
      `/v1/trust/profiles/${encoded}`
    );
    return wire.profile;
  }

  // -------------------------------------------------------------------------
  // Incidents
  // -------------------------------------------------------------------------

  /** List runtime security incidents detected by the GRL heuristics engine. */
  async listIncidents(): Promise<RuntimeIncident[]> {
    const wire = await this.request<WireIncidentsResponse>('GET', '/v1/security/incidents');
    return wire.incidents;
  }

  // -------------------------------------------------------------------------
  // Runtime profiles
  // -------------------------------------------------------------------------

  /** Get the currently active runtime profile. */
  async getRuntimeProfile(): Promise<RuntimeProfileInfo> {
    const wire = await this.request<WireRuntimeProfileResponse>('GET', '/v1/runtime/profile');
    return wire.profile;
  }

  /** List all available runtime profiles. */
  async listRuntimeProfiles(): Promise<RuntimeProfileInfo[]> {
    const wire = await this.request<WireRuntimeProfilesResponse>('GET', '/v1/runtime/profiles');
    return wire.profiles;
  }

  /**
   * Switch the active runtime profile by name.
   *
   * The GRL runtime applies the new profile immediately. Capabilities and
   * firewall rules are re-derived from the new profile's policy packs.
   */
  async switchRuntimeProfile(name: string): Promise<RuntimeProfileSwitchResult> {
    if (!name || typeof name !== 'string') {
      throw new GrlAgentSdkError('invalid_arguments', 'name must be a non-empty string');
    }
    const encoded = encodeURIComponent(name);
    const wire = await this.request<WireRuntimeProfileSwitchResponse>(
      'POST',
      `/v1/runtime/profile/${encoded}`
    );
    return { profile: wire.profile, switchedAt: wire.switchedAt, raw: wire };
  }

  // -------------------------------------------------------------------------
  // Transports
  // -------------------------------------------------------------------------

  /** List all transports registered in the GRL Transport Capability Registry. */
  async listTransports(): Promise<TransportInfo[]> {
    const wire = await this.request<WireTransportsResponse>('GET', '/v1/transports');
    return wire.transports;
  }
}
