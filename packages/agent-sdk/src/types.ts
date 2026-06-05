/**
 * Public types for the @gyges/agent-sdk.
 *
 * All types describe the wire format produced by the GRL Local API. Internal
 * implementation details (transport configuration, session internals, policy
 * internals) are never surfaced here. No secrets, tokens, or raw inputs are
 * stored in any of these types.
 */

// ---------------------------------------------------------------------------
// SDK Configuration
// ---------------------------------------------------------------------------

export interface GrlAgentSdkConfig {
  /** Base URL of the GRL Local API. Defaults to http://127.0.0.1:8787 */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 5000. */
  timeoutMs?: number;
  /** Agent identifier used in capability requests. Defaults to "local-agent". */
  agentId?: string;
  /** Compartment identifier used in capability requests. Defaults to "research". */
  compartmentId?: string;
}

export const DEFAULT_SDK_CONFIG: Required<GrlAgentSdkConfig> = {
  baseUrl: 'http://127.0.0.1:8787',
  timeoutMs: 5000,
  agentId: 'local-agent',
  compartmentId: 'research'
};

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface HealthResult {
  status: 'ok';
  service: string;
}

// ---------------------------------------------------------------------------
// Search Results
// ---------------------------------------------------------------------------

export interface SearchResultItem {
  title: string;
  url: string;
  content?: string;
  engine?: string;
  score?: number;
}

export interface SearchAllowedResult {
  status: 'allowed';
  executionStatus: 'success' | 'blocked' | 'failed';
  transportKind?: string;
  results?: SearchResultItem[];
  raw: unknown;
}

export interface SearchDeniedResult {
  status: 'denied';
  reason: string;
  raw: unknown;
}

export interface SearchPendingResult {
  status: 'pending';
  reason: string;
  approvalRequestId: string;
  approvalToken: string;
  raw: unknown;
}

export type SearchResult =
  | SearchAllowedResult
  | SearchDeniedResult
  | SearchPendingResult;

// ---------------------------------------------------------------------------
// Search Options
// ---------------------------------------------------------------------------

export interface SearchOptions {
  /** Risk level. Defaults to "low". */
  riskLevel?: 'low' | 'medium' | 'high';
  /** Override the compartmentId from config. */
  compartmentId?: string;
  /** Override the agentId from config. */
  agentId?: string;
}

// ---------------------------------------------------------------------------
// Capability Request
// ---------------------------------------------------------------------------

export interface CapabilityRequestInput {
  agentId?: string;
  compartmentId?: string;
  tool: string;
  riskLevel?: 'low' | 'medium' | 'high';
  input?: unknown;
}

export type CapabilityRequestDecision = 'allowed' | 'denied' | 'pending';

export interface CapabilityRequestResult {
  decision: CapabilityRequestDecision;
  reason: string;
  approvalRequestId?: string;
  approvalToken?: string;
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export interface ApprovalResult {
  id: string;
  status: 'approved' | 'rejected';
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditFilters {
  type?: string;
  severity?: string;
  limit?: number;
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

// ---------------------------------------------------------------------------
// Trust
// ---------------------------------------------------------------------------

export interface TrustProfile {
  compartmentId: string;
  score: number;
  level: string;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

export interface RuntimeIncident {
  id: string;
  createdAt: number;
  updatedAt: number;
  severity: string;
  status: string;
  summary: string;
}

// ---------------------------------------------------------------------------
// Runtime Profiles
// ---------------------------------------------------------------------------

export interface RuntimeProfileInfo {
  name: string;
  description?: string;
  extends?: string;
  packIds: string[];
  enabled: boolean;
}

export interface RuntimeProfileSwitchResult {
  profile: RuntimeProfileInfo;
  switchedAt: number;
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

export interface TransportInfo {
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
