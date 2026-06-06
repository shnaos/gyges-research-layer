/**
 * @gyges/agent-sdk — public API surface.
 *
 * Usage:
 *   import { GrlAgentClient, isAllowed, isPending, isDenied } from '@gyges/agent-sdk';
 */

// Client
export { GrlAgentClient } from './client.js';

// Type guards / helpers
export { isAllowed, isDenied, isPending } from './search.js';

// Error type
export { GrlAgentSdkError } from './errors.js';
export type { GrlAgentSdkErrorCode } from './errors.js';

// Public types
export type {
  GrlAgentSdkConfig,
  HealthResult,
  SearchOptions,
  SearchResult,
  SearchResultItem,
  SearchAllowedResult,
  SearchDeniedResult,
  SearchPendingResult,
  CapabilityRequestInput,
  CapabilityRequestDecision,
  CapabilityRequestResult,
  ApprovalResult,
  AuditFilters,
  AuditEvent,
  TrustProfile,
  BehavioralProfileInfo,
  IdentityFragmentInfo,
  WireBehavioralProfilesResponse,
  WireBehavioralProfileResponse,
  WireIdentityFragmentsResponse,
  RuntimeIncident,
  RuntimeProfileInfo,
  RuntimeProfileSwitchResult,
  TransportInfo,
  AgentQuotaInfo,
  AgentLeaseInfo,
  AgentRuntimeInfo,
  AgentTrustInfo,
  AgentActionResult,
  FingerprintProfileInfo,
  HeaderProfileInfo,
  WireFingerprintProfilesResponse,
  WireFingerprintProfileResponse,
  WireHeaderProfilesResponse,
  WireHeaderPoliciesResponse
} from './types.js';
