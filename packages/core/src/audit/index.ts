/**
 * Capability Execution Audit Trail & Security Event Engine MVP — public surface.
 *
 * Sprint 11 contracts plus the deterministic, in-memory {@link AuditStore} and
 * {@link SecurityEventEngine}. No database, file, network, fetch, DNS, socket,
 * browser, durable persistence, or cloud telemetry is exposed here.
 */

export type {
  EventSeverity,
  SecurityEventType,
  SecurityEvent,
  RuntimeIncident,
  AuditTrailEntry,
  AuditQuery
} from './types.js';

export { AuditStore } from './store.js';

export { SecurityEventEngine } from './engine.js';
export type { SecurityEventEngineOptions } from './engine.js';
