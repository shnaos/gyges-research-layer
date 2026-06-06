import { randomUUID } from 'node:crypto'
import type {
  PersonaCategory,
  PersonaFragmentBinding,
  PersonaIsolationDecision,
  PersonaIsolationEngineOptions,
  SearchPersona
} from './types.js'
import { DEFAULT_SEGMENTATION_POLICY } from './types.js'
import { PersonaStore, derivePersonaRisk } from './personas.js'
import { PersonaFragmentManager } from './fragments.js'
import { InterestSegmentationEngine } from './segmentation.js'
import { computeIsolationDecision, noActionDecision } from './routing.js'

/**
 * PersonaIsolationEngine — Sprint 25 core.
 *
 * Manages per-agent, per-category {@link SearchPersona}s and produces
 * {@link PersonaIsolationDecision}s that drive fragment rotation, session
 * isolation, and transport isolation.
 *
 * Design constraints:
 *  - deterministic, in-memory only
 *  - no AI / NLP / semantic classification
 *  - no cloud sync, no persistence, no browser, no network
 *  - fail-closed: missing/unknown state → create fresh
 *  - defensive copies at every public boundary
 *  - no circular dependency with the audit engine (emitting is the caller's job)
 */
export class PersonaIsolationEngine {
  private readonly now: () => number
  private readonly generateId: () => string
  readonly personaStore: PersonaStore
  readonly fragmentManager: PersonaFragmentManager
  readonly segmentationEngine: InterestSegmentationEngine

  constructor(options: PersonaIsolationEngineOptions = {}) {
    this.now = options.now ?? Date.now
    this.generateId = options.generateId ?? randomUUID
    this.personaStore = new PersonaStore()
    this.fragmentManager = new PersonaFragmentManager({
      now: this.now,
      generateId: this.generateId
    })
    this.segmentationEngine = new InterestSegmentationEngine(
      options.segmentationPolicy ?? DEFAULT_SEGMENTATION_POLICY
    )
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Get or create the active {@link SearchPersona} for the given agent and
   * category.
   *
   * - When an active persona for the category already exists and is not
   *   saturated, it is returned.
   * - When none exists, or the existing one is saturated, a fresh persona is
   *   created and the old one is deactivated.
   *
   * Returns a defensive copy.
   */
  getOrCreatePersona(agentId: string, category: PersonaCategory): SearchPersona {
    const existing = this.personaStore.findActive(agentId, category)
    const segEval = this.segmentationEngine.evaluate(existing, category)

    if (!segEval.shouldRotate && existing) {
      return existing // already a defensive copy from the store
    }

    // Deactivate the previous persona if one exists.
    if (existing) {
      this.personaStore.deactivate(existing.id, this.now())
      this.fragmentManager.deactivateForPersona(existing.id)
    }

    return this.createFreshPersona(agentId, category)
  }

  /**
   * Evaluate whether the current persona requires isolation escalation for the
   * given category hint.
   *
   * Call this before executing a search to decide whether to rotate fragments,
   * isolate sessions, or isolate transports. Does NOT mutate any state (pure
   * read + decision).
   *
   * Returns a {@link PersonaIsolationDecision}.
   */
  evaluatePersonaIsolation(
    agentId: string,
    category: PersonaCategory
  ): PersonaIsolationDecision {
    const existing = this.personaStore.findActive(agentId, category)
    const segEval = this.segmentationEngine.evaluate(existing, category)

    if (!existing) {
      // Will be created fresh — return a forward-looking decision.
      const tempId = `pending-${agentId}-${category}`
      return noActionDecision(tempId, segEval.isHighRisk, category)
    }

    return computeIsolationDecision(existing, segEval)
  }

  /**
   * Record a completed search against the active persona for the given agent
   * and category. Returns the updated persona (defensive copy).
   *
   * If no active persona exists for the category one is created.
   */
  recordPersonaSearch(agentId: string, category: PersonaCategory): SearchPersona {
    const at = this.now()
    // Ensure a persona exists.
    let persona = this.personaStore.findActive(agentId, category)
    if (!persona) {
      persona = this.createFreshPersona(agentId, category)
    }

    const updated = this.personaStore.recordSearch(persona.id, at)
    if (!updated) return persona // should not happen

    // Re-derive the correlation risk from the new search count.
    const policy = this.segmentationEngine.getPolicy()
    const newRisk = derivePersonaRisk(updated.searchCount, updated.category, policy.maxSearchesPerPersona)
    const withRisk = this.personaStore.setRisk(updated.id, newRisk, at)
    return withRisk ?? updated
  }

  /**
   * Forcibly rotate the active persona for the given agent and category.
   *
   * The current persona (if any) is deactivated, its bindings are cleared, and
   * a fresh persona is returned. Returns the new persona (defensive copy).
   */
  rotatePersona(agentId: string, category: PersonaCategory): SearchPersona {
    const existing = this.personaStore.findActive(agentId, category)
    if (existing) {
      this.personaStore.deactivate(existing.id, this.now())
      this.fragmentManager.deactivateForPersona(existing.id)
    }
    return this.createFreshPersona(agentId, category)
  }

  /**
   * List all personas for a specific agent (defensive copies).
   */
  listPersonas(agentId?: string): SearchPersona[] {
    if (agentId !== undefined) {
      return this.personaStore.listByAgent(agentId)
    }
    return this.personaStore.listAll()
  }

  /**
   * List all {@link PersonaFragmentBinding}s, optionally scoped to an agent.
   *
   * When `agentId` is supplied, only bindings for that agent's personas are
   * returned. Returns defensive copies.
   */
  listPersonaBindings(agentId?: string): PersonaFragmentBinding[] {
    if (agentId === undefined) {
      return this.fragmentManager.listAll()
    }
    const personaIds = this.personaStore
      .listByAgent(agentId)
      .map((p) => p.id)
    return this.fragmentManager.listForPersonaIds(personaIds)
  }

  /**
   * Return the active segmentation policy (defensive copy).
   */
  getSegmentationPolicy() {
    return this.segmentationEngine.getPolicy()
  }

  /**
   * Clear all state (personas, bindings). For tests and reset scenarios.
   */
  clear(): void {
    this.personaStore.clear()
    this.fragmentManager.clear()
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private createFreshPersona(agentId: string, category: PersonaCategory): SearchPersona {
    const at = this.now()
    const id = this.generateId()
    const fresh: SearchPersona = {
      id,
      agentId,
      createdAt: at,
      updatedAt: at,
      category,
      active: true,
      fragmentIds: [],
      isolatedSessionIds: [],
      searchCount: 0,
      correlationRisk: 'low'
    }
    return this.personaStore.add(fresh)
  }
}
