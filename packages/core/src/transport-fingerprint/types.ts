/**
 * Transport Fingerprint Randomization & Header Isolation — types.
 *
 * Sprint 27: MVP engine that reduces transport-level correlation produced by
 * stable HTTP headers, User-Agent strings, Accept-Language headers, and
 * header ordering patterns.
 *
 * Hard constraints:
 *  - deterministic, in-memory only
 *  - no AI / NLP / ML
 *  - no external entropy sources
 *  - no browser, no Tor/proxy, no crawler
 *  - no cloud sync, no persistence
 *  - fail-closed
 *  - defensive copies at every public boundary
 *  - never stores raw input, tokens, or secrets
 *  - does NOT claim to prevent fingerprinting or guarantee anonymity
 */

export type FingerprintCorrelationRisk = 'low' | 'medium' | 'high' | 'critical';

/**
 * Per-agent transport fingerprint profile.
 * Tracks the currently assigned fingerprint, rotation state, and correlation risk.
 */
export interface FingerprintProfile {
  agentId: string;
  createdAt: number;
  updatedAt: number;
  activeFingerprintId: string;
  rotationCount: number;
  requestCount: number;
  correlationRisk: FingerprintCorrelationRisk;
  assignedHeaders: Record<string, string>;
  assignedUserAgent: string;
  assignedLanguage: string;
}

/**
 * Decision returned after evaluating whether fingerprint isolation is needed.
 */
export interface FingerprintIsolationDecision {
  requiresRotation: boolean;
  requiresHeaderIsolation: boolean;
  requiresLanguageIsolation: boolean;
  requiresUserAgentIsolation: boolean;
  correlationRisk: FingerprintCorrelationRisk;
  reason: string;
}

/**
 * Policy governing header isolation behaviour.
 */
export interface HeaderIsolationPolicy {
  enabled: boolean;
  rotateOnPersonaChange: boolean;
  rotateOnTemporalEscalation: boolean;
  maxRequestsPerFingerprint: number;
  strictSensitiveCategoryIsolation: boolean;
}

/**
 * A resolved header profile: a consistent set of HTTP headers for one
 * fingerprint identity. Never contains secrets, tokens, or raw input.
 */
export interface HeaderProfile {
  id: string;
  userAgent: string;
  acceptLanguage: string;
  headers: Record<string, string>;
  createdAt: number;
  active: boolean;
}

/**
 * Options for constructing the TransportFingerprintEngine.
 */
export interface TransportFingerprintEngineOptions {
  now?: () => number;
  generateId?: () => string;
  policy?: Partial<HeaderIsolationPolicy>;
}

/**
 * Input for evaluating fingerprint isolation needs.
 */
export interface EvaluateFingerprintInput {
  agentId: string;
  /** Whether the agent's persona just changed. */
  personaChanged?: boolean;
  /** Whether temporal escalation is active. */
  temporalEscalation?: boolean;
  /** Whether a sensitive category was detected. */
  sensitiveCategoryDetected?: boolean;
  timestamp?: number;
}

/**
 * Input for assigning a fingerprint to an agent.
 */
export interface AssignFingerprintInput {
  agentId: string;
  /** Force rotation even if the fingerprint is not yet saturated. */
  forceRotation?: boolean;
  timestamp?: number;
}
