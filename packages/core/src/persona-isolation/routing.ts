import type { SearchPersona, PersonaIsolationDecision } from './types.js'
import { HIGH_RISK_CATEGORIES } from './types.js'

/**
 * Produce a {@link PersonaIsolationDecision} from a segmentation result.
 *
 * Rules:
 *  - Any rotation → new fragment + session isolation
 *  - High-risk category → transport isolation + session isolation
 *  - Critical correlation risk → behavioral escalation
 *  - Saturation → new fragment
 *
 * This module is pure (no side effects, no I/O) and deterministic.
 */
export function computeIsolationDecision(
  persona: SearchPersona,
  opts: {
    shouldRotate: boolean
    isHighRisk: boolean
    categoryChanged: boolean
    isSaturated: boolean
    reason: string
  }
): PersonaIsolationDecision {
  const requiresNewFragment = opts.shouldRotate || opts.isSaturated
  const requiresSessionIsolation = opts.shouldRotate || opts.isHighRisk
  const requiresTransportIsolation = opts.isHighRisk
  const requiresBehavioralEscalation = persona.correlationRisk === 'critical'

  return {
    personaId: persona.id,
    requiresNewFragment,
    requiresSessionIsolation,
    requiresTransportIsolation,
    requiresBehavioralEscalation,
    reason: opts.reason
  }
}

/**
 * Produce a no-action isolation decision (used when a fresh persona was just
 * created and no escalation is needed yet).
 */
export function noActionDecision(
  personaId: string,
  isHighRisk: boolean,
  category: string
): PersonaIsolationDecision {
  const requiresTransportIsolation =
    (HIGH_RISK_CATEGORIES as readonly string[]).includes(category)
  return {
    personaId,
    requiresNewFragment: true, // fresh persona always gets a fresh fragment
    requiresSessionIsolation: isHighRisk,
    requiresTransportIsolation,
    requiresBehavioralEscalation: false,
    reason: 'new_persona'
  }
}
