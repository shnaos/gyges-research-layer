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
  RuntimeIncident,
  RuntimeProfileInfo,
  RuntimeProfileSwitchResult,
  TransportInfo
} from './types.js';
