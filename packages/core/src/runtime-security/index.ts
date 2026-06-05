/**
 * Runtime Security Heuristics & Incident Detection MVP — public surface.
 *
 * Sprint 12 contracts plus the deterministic, in-memory
 * {@link RuntimeSecurityHeuristicsEngine}, {@link IncidentDetector}, and
 * {@link IncidentStore}. No database, file, network, fetch, DNS, socket,
 * browser, durable persistence, cloud telemetry, or AI/ML is exposed here.
 */

export type {
  RuntimeAnomalyType,
  SecurityScore,
  IncidentSeverity,
  IncidentStatus,
  RuntimeAnomaly,
  HeuristicRule,
  RuntimeIncident
} from './types.js';

export { ANOMALY_EVENT_TYPES } from './types.js';

export { IncidentStore, cloneIncident } from './store.js';

export { RuntimeSecurityHeuristicsEngine } from './engine.js';
export type { RuntimeSecurityHeuristicsEngineOptions } from './engine.js';

export { IncidentDetector } from './detector.js';
export type { IncidentDetectorOptions } from './detector.js';

export { BOOTSTRAP_HEURISTIC_RULES } from './bootstrap.js';
