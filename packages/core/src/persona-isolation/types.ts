/**
 * Persona Isolation types — Sprint 25.
 *
 * Defines the contracts for the Identity Fragmentation & Search Persona
 * Isolation system. All types are purely in-memory and carry only secret-free
 * metadata: no raw queries, no tokens, no credentials, no transport secrets.
 *
 * Design constraints:
 *  - deterministic, in-memory only
 *  - no AI / NLP / ML
 *  - no cloud sync, no persistence, no browser
 *  - fail-closed
 *  - defensive copies at every boundary
 */

/**
 * The research interest category a {@link SearchPersona} belongs to.
 *
 * The caller supplies this as a `categoryHint` — the engine never performs
 * semantic classification. When no hint is provided the persona defaults to
 * `'unknown'`.
 */
export type PersonaCategory =
  | 'general'
  | 'finance'
  | 'crypto'
  | 'security'
  | 'health'
  | 'politics'
  | 'development'
  | 'research'
  | 'unknown'

/**
 * Categories that trigger strict isolation by default.
 *
 * These categories are treated as high-risk from a behavioural-correlation
 * perspective and receive mandatory fragment rotation, session isolation, and
 * transport isolation when the policy so demands.
 */
export const HIGH_RISK_CATEGORIES: readonly PersonaCategory[] = [
  'crypto',
  'security',
  'health',
  'politics',
  'finance'
]

/**
 * A search persona — the unit of behavioural isolation for a specific interest
 * category per agent.
 *
 * One agent may hold multiple personas (one per category). Personas must never
 * share fragments or sessions across categories unless the policy explicitly
 * permits it.
 */
export interface SearchPersona {
  id: string
  agentId: string
  createdAt: number
  updatedAt: number
  category: PersonaCategory
  active: boolean
  fragmentIds: string[]
  isolatedSessionIds: string[]
  searchCount: number
  correlationRisk: 'low' | 'medium' | 'high' | 'critical'
}

/**
 * The isolation decision produced by {@link PersonaIsolationEngine} for a
 * single capability request.
 */
export interface PersonaIsolationDecision {
  personaId: string
  requiresNewFragment: boolean
  requiresSessionIsolation: boolean
  requiresTransportIsolation: boolean
  requiresBehavioralEscalation: boolean
  reason: string
}

/**
 * Policy governing interest-segmentation behaviour.
 *
 * All fields are runtime-configurable so tests can inject tight thresholds.
 */
export interface InterestSegmentationPolicy {
  enabled: boolean
  maxSearchesPerPersona: number
  forceRotationOnCategoryChange: boolean
  isolateHighRiskCategories: boolean
}

export const DEFAULT_SEGMENTATION_POLICY: InterestSegmentationPolicy = {
  enabled: true,
  maxSearchesPerPersona: 20,
  forceRotationOnCategoryChange: true,
  isolateHighRiskCategories: true
}

/**
 * A binding between a {@link SearchPersona} and an identity fragment (from the
 * Sprint 24 {@link IdentityFragmentManager}).
 *
 * Bindings are immutable once created: deactivate then create a new one rather
 * than mutating an existing binding.
 */
export interface PersonaFragmentBinding {
  personaId: string
  fragmentId: string
  createdAt: number
  active: boolean
}

/**
 * Options for constructing a {@link PersonaIsolationEngine}.
 */
export interface PersonaIsolationEngineOptions {
  now?: () => number
  generateId?: () => string
  segmentationPolicy?: InterestSegmentationPolicy
}
