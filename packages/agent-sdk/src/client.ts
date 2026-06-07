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
  AgentActionResult,
  AgentLeaseInfo,
  AgentRuntimeInfo,
  AgentTrustInfo,
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
  TrustProfile,
  WireBehavioralProfileResponse,
  WireBehavioralProfilesResponse,
  WireIdentityFragmentsResponse,
  WirePersonasResponse,
  WirePersonasByAgentResponse,
  WirePersonaBindingsResponse,
  WirePersonaBindingsByAgentResponse,
  SearchPersonaInfo,
  PersonaFragmentBindingInfo,
  WireTemporalProfilesResponse,
  WireTemporalProfileResponse,
  WireTemporalBudgetsResponse,
  WireTemporalBudgetResponse,
  TemporalProfileInfo,
  TemporalBudgetInfo,
  WireFingerprintProfilesResponse,
  WireFingerprintProfileResponse,
  WireHeaderProfilesResponse,
  WireHeaderPoliciesResponse,
  FingerprintProfileInfo,
  HeaderProfileInfo
} from './types.js';
import { DEFAULT_SDK_CONFIG } from './types.js';

// Re-export helpers so consumers can use them via the client module too.
export { isAllowed, isDenied, isPending };

// Re-export persona types for consumers.
export type { SearchPersonaInfo, PersonaFragmentBindingInfo };

// Re-export temporal types for consumers.
export type { TemporalProfileInfo, TemporalBudgetInfo };

// Re-export transport fingerprint types for consumers.
export type { FingerprintProfileInfo, HeaderProfileInfo };

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

interface WireAgentsResponse {
  agents: AgentRuntimeInfo[];
}

interface WireAgentResponse {
  agent: AgentRuntimeInfo;
}

interface WireAgentLeasesResponse {
  agentId: string;
  leases: AgentLeaseInfo[];
}

interface WireAgentTrustResponse {
  trust: AgentTrustInfo;
}

interface WireAgentActionResponse {
  agentId: string;
  status: string;
  updatedAt: number;
}

// Sprint 29 — runtime policy signal source/action/severity vocabularies and
// the optional filter set accepted by listRuntimePolicySignals().
export type PolicySignalSource =
  | 'capability_graph' | 'multi_agent' | 'behavioral_privacy' | 'persona_isolation'
  | 'temporal_obfuscation' | 'transport_fingerprint' | 'trust_reputation'
  | 'adaptive_defense' | 'capability_firewall' | 'privacy_boundary'
  | 'transport_policy' | 'sandbox';
export type UnifiedPrivacyAction =
  | 'allow' | 'delay' | 'rotate_session' | 'rotate_fragment' | 'rotate_fingerprint'
  | 'require_approval' | 'cooldown' | 'temporary_block' | 'deny';
export type PolicySignalSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

/** Optional filters for {@link GrlAgentClient.listRuntimePolicySignals}. */
export interface RuntimePolicySignalFilters {
  source?: PolicySignalSource;
  action?: UnifiedPrivacyAction;
  severity?: PolicySignalSeverity;
  limit?: number;
}

// Sprint 28 — Runtime Policy Orchestrator wire types
interface WirePolicySignalView {
  id: string;
  source: string;
  action: string;
  severity: string;
  reason: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

interface WirePolicyConflictView {
  id: string;
  signalIds: string[];
  conflictType: string;
  resolution: string;
  reason: string;
}

interface WireCompositeRuntimeDecisionView {
  action: string;
  allowed: boolean;
  requiresDelay: boolean;
  delayMs?: number;
  requiresApproval: boolean;
  requiresSessionRotation: boolean;
  requiresFragmentRotation: boolean;
  requiresFingerprintRotation: boolean;
  reason: string;
  signals: WirePolicySignalView[];
  conflicts: WirePolicyConflictView[];
}

interface WireCompositePrivacyPolicyView {
  id: string;
  enabled: boolean;
  precedence: string[];
  defaultAction: string;
  failClosed: boolean;
  mergeStrategy: string;
}

interface WirePolicyOrchestratorPoliciesResponse {
  policies: WireCompositePrivacyPolicyView[];
}

interface WirePolicyOrchestratorSignalsResponse {
  signals: WirePolicySignalView[];
}

interface WirePolicyOrchestratorLastDecisionResponse {
  decision: WireCompositeRuntimeDecisionView | null;
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

  /** List all behavioral profiles. */
  async listBehavioralProfiles(): Promise<WireBehavioralProfilesResponse> {
    return this.request<WireBehavioralProfilesResponse>('GET', '/v1/privacy/behavioral/profiles');
  }

  /** Get the behavioral profile for a specific agent. */
  async getBehavioralProfile(agentId: string): Promise<WireBehavioralProfileResponse> {
    if (!agentId || typeof agentId !== 'string') {
      throw new GrlAgentSdkError('invalid_arguments', 'agentId must be a non-empty string');
    }
    const encoded = encodeURIComponent(agentId);
    return this.request<WireBehavioralProfileResponse>(
      'GET',
      `/v1/privacy/behavioral/profiles/${encoded}`
    );
  }

  /** List identity fragments, optionally filtered to one agent. */
  async listIdentityFragments(agentId?: string): Promise<WireIdentityFragmentsResponse> {
    if (agentId !== undefined) {
      const encoded = encodeURIComponent(agentId);
      return this.request<WireIdentityFragmentsResponse>(
        'GET',
        `/v1/privacy/fragments/${encoded}`
      );
    }
    return this.request<WireIdentityFragmentsResponse>('GET', '/v1/privacy/fragments');
  }

  // -------------------------------------------------------------------------
  // Persona Isolation (Sprint 25)
  // -------------------------------------------------------------------------

  /** List all search personas, optionally filtered to one agent. */
  async listPersonas(agentId?: string): Promise<WirePersonasResponse | WirePersonasByAgentResponse> {
    if (agentId !== undefined) {
      const encoded = encodeURIComponent(agentId);
      return this.request<WirePersonasByAgentResponse>(
        'GET',
        `/v1/privacy/personas/${encoded}`
      );
    }
    return this.request<WirePersonasResponse>('GET', '/v1/privacy/personas');
  }

  /** Get all search personas for a specific agent. */
  async getPersonas(agentId: string): Promise<WirePersonasByAgentResponse> {
    if (!agentId || typeof agentId !== 'string') {
      throw new GrlAgentSdkError('invalid_arguments', 'agentId must be a non-empty string');
    }
    const encoded = encodeURIComponent(agentId);
    return this.request<WirePersonasByAgentResponse>(
      'GET',
      `/v1/privacy/personas/${encoded}`
    );
  }

  /** List persona-fragment bindings, optionally filtered to one agent. */
  async listPersonaBindings(
    agentId?: string
  ): Promise<WirePersonaBindingsResponse | WirePersonaBindingsByAgentResponse> {
    if (agentId !== undefined) {
      const encoded = encodeURIComponent(agentId);
      return this.request<WirePersonaBindingsByAgentResponse>(
        'GET',
        `/v1/privacy/persona-bindings/${encoded}`
      );
    }
    return this.request<WirePersonaBindingsResponse>('GET', '/v1/privacy/persona-bindings');
  }

  // -------------------------------------------------------------------------
  // Temporal Obfuscation (Sprint 26)
  // -------------------------------------------------------------------------

  /** List all temporal profiles (no raw input, no tokens). */
  async listTemporalProfiles(): Promise<WireTemporalProfilesResponse> {
    return this.request<WireTemporalProfilesResponse>('GET', '/v1/privacy/temporal/profiles');
  }

  /** Get the temporal profile for a specific agent. */
  async getTemporalProfile(agentId: string): Promise<WireTemporalProfileResponse> {
    if (!agentId || typeof agentId !== 'string') {
      throw new GrlAgentSdkError('invalid_arguments', 'agentId must be a non-empty string');
    }
    const encoded = encodeURIComponent(agentId);
    return this.request<WireTemporalProfileResponse>(
      'GET',
      `/v1/privacy/temporal/profiles/${encoded}`
    );
  }

  /** List temporal privacy budgets for all agents. */
  async listTemporalBudgets(): Promise<WireTemporalBudgetsResponse> {
    return this.request<WireTemporalBudgetsResponse>('GET', '/v1/privacy/temporal/budgets');
  }

  /** Get the temporal privacy budget for a specific agent. */
  async getTemporalBudget(agentId: string): Promise<WireTemporalBudgetResponse> {
    if (!agentId || typeof agentId !== 'string') {
      throw new GrlAgentSdkError('invalid_arguments', 'agentId must be a non-empty string');
    }
    const encoded = encodeURIComponent(agentId);
    return this.request<WireTemporalBudgetResponse>(
      'GET',
      `/v1/privacy/temporal/budgets/${encoded}`
    );
  }

  /** List all transport fingerprint profiles. */
  async listFingerprintProfiles(): Promise<WireFingerprintProfilesResponse> {
    return this.request<WireFingerprintProfilesResponse>('GET', '/v1/privacy/fingerprints');
  }

  /** Get the fingerprint profile for a specific agent. */
  async getFingerprintProfile(agentId: string): Promise<WireFingerprintProfileResponse> {
    if (!agentId || typeof agentId !== 'string') {
      throw new GrlAgentSdkError('invalid_arguments', 'agentId must be a non-empty string');
    }
    const encoded = encodeURIComponent(agentId);
    return this.request<WireFingerprintProfileResponse>('GET', `/v1/privacy/fingerprints/${encoded}`);
  }

  /** List all header profiles. */
  async listHeaderProfiles(): Promise<WireHeaderProfilesResponse> {
    return this.request<WireHeaderProfilesResponse>('GET', '/v1/privacy/header-profiles');
  }

  /** Get the current header isolation policies. */
  async getHeaderPolicies(): Promise<WireHeaderPoliciesResponse> {
    return this.request<WireHeaderPoliciesResponse>('GET', '/v1/privacy/header-policies');
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

  // -------------------------------------------------------------------------
  // Multi-Agent Runtime (Sprint 23)
  // -------------------------------------------------------------------------

  /** List all registered agent runtimes. */
  async listAgents(): Promise<AgentRuntimeInfo[]> {
    const wire = await this.request<WireAgentsResponse>('GET', '/v1/agents');
    return wire.agents;
  }

  /** Get the runtime state for a specific agent. */
  async getAgent(agentId: string): Promise<AgentRuntimeInfo> {
    if (!agentId || typeof agentId !== 'string') {
      throw new GrlAgentSdkError('invalid_arguments', 'agentId must be a non-empty string');
    }
    const encoded = encodeURIComponent(agentId);
    const wire = await this.request<WireAgentResponse>('GET', `/v1/agents/${encoded}`);
    return wire.agent;
  }

  /** List active leases for a specific agent. */
  async listAgentLeases(agentId: string): Promise<AgentLeaseInfo[]> {
    if (!agentId || typeof agentId !== 'string') {
      throw new GrlAgentSdkError('invalid_arguments', 'agentId must be a non-empty string');
    }
    const encoded = encodeURIComponent(agentId);
    const wire = await this.request<WireAgentLeasesResponse>(
      'GET',
      `/v1/agents/${encoded}/leases`
    );
    return wire.leases;
  }

  /** Get the trust summary for a specific agent. */
  async getAgentTrust(agentId: string): Promise<AgentTrustInfo> {
    if (!agentId || typeof agentId !== 'string') {
      throw new GrlAgentSdkError('invalid_arguments', 'agentId must be a non-empty string');
    }
    const encoded = encodeURIComponent(agentId);
    const wire = await this.request<WireAgentTrustResponse>(
      'GET',
      `/v1/agents/${encoded}/trust`
    );
    return wire.trust;
  }

  /** Restrict an agent — blocks further execution. */
  async restrictAgent(agentId: string): Promise<AgentActionResult> {
    if (!agentId || typeof agentId !== 'string') {
      throw new GrlAgentSdkError('invalid_arguments', 'agentId must be a non-empty string');
    }
    const encoded = encodeURIComponent(agentId);
    const wire = await this.request<WireAgentActionResponse>(
      'POST',
      `/v1/agents/${encoded}/restrict`
    );
    return { agentId: wire.agentId, status: wire.status, updatedAt: wire.updatedAt, raw: wire };
  }

  /** Evict an agent — permanently removes it from execution. */
  async evictAgent(agentId: string): Promise<AgentActionResult> {
    if (!agentId || typeof agentId !== 'string') {
      throw new GrlAgentSdkError('invalid_arguments', 'agentId must be a non-empty string');
    }
    const encoded = encodeURIComponent(agentId);
    const wire = await this.request<WireAgentActionResponse>(
      'POST',
      `/v1/agents/${encoded}/evict`
    );
    return { agentId: wire.agentId, status: wire.status, updatedAt: wire.updatedAt, raw: wire };
  }

  // ---------------------------------------------------------------------------
  // Sprint 28 — Runtime Policy Orchestrator
  // ---------------------------------------------------------------------------

  /**
   * List all registered composite privacy policies in the runtime orchestrator.
   * Returns metadata only — never raw input, tokens, or secrets.
   */
  async listRuntimePolicyOrchestratorPolicies(): Promise<WireCompositePrivacyPolicyView[]> {
    const wire = await this.request<WirePolicyOrchestratorPoliciesResponse>(
      'GET',
      '/v1/runtime/policy-orchestrator/policies'
    );
    return wire.policies;
  }

  /**
   * List buffered policy signals from the runtime orchestrator.
   *
   * Sprint 29 — optional filters (`source`, `action`, `severity`, `limit`) are
   * sent as query params and validated server-side; an invalid value yields a
   * `capability_failed` error (HTTP 400). Returns metadata only — never raw
   * input, tokens, or secrets.
   */
  async listRuntimePolicySignals(
    filters: RuntimePolicySignalFilters = {}
  ): Promise<WirePolicySignalView[]> {
    const params = new URLSearchParams();
    if (filters.source !== undefined) params.set('source', filters.source);
    if (filters.action !== undefined) params.set('action', filters.action);
    if (filters.severity !== undefined) params.set('severity', filters.severity);
    if (filters.limit !== undefined) params.set('limit', String(filters.limit));
    const query = params.toString();
    const path = `/v1/runtime/policy-orchestrator/signals${query ? `?${query}` : ''}`;
    const wire = await this.request<WirePolicyOrchestratorSignalsResponse>('GET', path);
    return wire.signals;
  }

  /**
   * Get the last composite runtime policy decision produced by the orchestrator.
   * Returns `null` if no decision has been produced yet.
   * Returns metadata only — never raw input, tokens, or secrets.
   */
  async getLastRuntimePolicyDecision(): Promise<WireCompositeRuntimeDecisionView | null> {
    const wire = await this.request<WirePolicyOrchestratorLastDecisionResponse>(
      'GET',
      '/v1/runtime/policy-orchestrator/last-decision'
    );
    return wire.decision;
  }
}
