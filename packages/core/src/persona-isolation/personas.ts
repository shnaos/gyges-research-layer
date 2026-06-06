import type { SearchPersona, PersonaCategory } from './types.js'
import { HIGH_RISK_CATEGORIES } from './types.js'

/**
 * In-memory store for {@link SearchPersona} records.
 *
 * All mutations are performed on the live record; callers receive defensive
 * copies. This class has no I/O: no network, no filesystem, no database.
 */
export class PersonaStore {
  private readonly personas = new Map<string, SearchPersona[]>()

  /** Return all personas for an agent, creating an empty list when absent. */
  private list(agentId: string): SearchPersona[] {
    let list = this.personas.get(agentId)
    if (!list) {
      list = []
      this.personas.set(agentId, list)
    }
    return list
  }

  /** Find the live record by id. */
  private findById(personaId: string): SearchPersona | undefined {
    for (const list of this.personas.values()) {
      const found = list.find((p) => p.id === personaId)
      if (found) return found
    }
    return undefined
  }

  /**
   * Add a persona to the store. Returns a defensive copy.
   */
  add(persona: SearchPersona): SearchPersona {
    this.list(persona.agentId).push(persona)
    return clonePersona(persona)
  }

  /**
   * Find the active persona for a given agent + category. Returns a defensive
   * copy, or undefined when none exists.
   */
  findActive(agentId: string, category: PersonaCategory): SearchPersona | undefined {
    const found = this.list(agentId).find(
      (p) => p.agentId === agentId && p.category === category && p.active
    )
    return found ? clonePersona(found) : undefined
  }

  /** Get a persona by id. Returns a defensive copy. */
  get(personaId: string): SearchPersona | undefined {
    const found = this.findById(personaId)
    return found ? clonePersona(found) : undefined
  }

  /** Deactivate a persona by id. Returns a defensive copy of the updated record. */
  deactivate(personaId: string, at: number): SearchPersona | undefined {
    const found = this.findById(personaId)
    if (!found) return undefined
    found.active = false
    found.updatedAt = at
    return clonePersona(found)
  }

  /** Record a search on a live persona. Returns a defensive copy. */
  recordSearch(personaId: string, at: number): SearchPersona | undefined {
    const found = this.findById(personaId)
    if (!found) return undefined
    found.searchCount += 1
    found.updatedAt = at
    return clonePersona(found)
  }

  /** Attach a fragment id to a persona. Returns a defensive copy. */
  bindFragment(personaId: string, fragmentId: string, at: number): SearchPersona | undefined {
    const found = this.findById(personaId)
    if (!found) return undefined
    if (!found.fragmentIds.includes(fragmentId)) {
      found.fragmentIds.push(fragmentId)
    }
    found.updatedAt = at
    return clonePersona(found)
  }

  /** Attach a session id to a persona. Returns a defensive copy. */
  bindSession(personaId: string, sessionId: string, at: number): SearchPersona | undefined {
    const found = this.findById(personaId)
    if (!found) return undefined
    if (!found.isolatedSessionIds.includes(sessionId)) {
      found.isolatedSessionIds.push(sessionId)
    }
    found.updatedAt = at
    return clonePersona(found)
  }

  /** Set the correlation risk on a persona. Returns a defensive copy. */
  setRisk(
    personaId: string,
    risk: SearchPersona['correlationRisk'],
    at: number
  ): SearchPersona | undefined {
    const found = this.findById(personaId)
    if (!found) return undefined
    found.correlationRisk = risk
    found.updatedAt = at
    return clonePersona(found)
  }

  /** List all personas across all agents (defensive copies). */
  listAll(): SearchPersona[] {
    const result: SearchPersona[] = []
    for (const list of this.personas.values()) {
      for (const p of list) result.push(clonePersona(p))
    }
    return result
  }

  /** List all personas for a specific agent (defensive copies). */
  listByAgent(agentId: string): SearchPersona[] {
    return this.list(agentId).map(clonePersona)
  }

  /** Clear all state. */
  clear(): void {
    this.personas.clear()
  }
}

/** Derive a correlation-risk level from a search count and whether the category is high-risk. */
export function derivePersonaRisk(
  searchCount: number,
  category: PersonaCategory,
  maxSearches: number
): SearchPersona['correlationRisk'] {
  const isHighRisk = (HIGH_RISK_CATEGORIES as readonly string[]).includes(category)
  const saturation = searchCount / Math.max(maxSearches, 1)

  if (saturation >= 1.0) return 'critical'
  if (saturation >= 0.75 || (isHighRisk && saturation >= 0.5)) return 'high'
  if (saturation >= 0.4 || (isHighRisk && saturation >= 0.2)) return 'medium'
  return 'low'
}

/** Deep clone a SearchPersona to prevent external mutation. */
export function clonePersona(persona: SearchPersona): SearchPersona {
  return {
    id: persona.id,
    agentId: persona.agentId,
    createdAt: persona.createdAt,
    updatedAt: persona.updatedAt,
    category: persona.category,
    active: persona.active,
    fragmentIds: [...persona.fragmentIds],
    isolatedSessionIds: [...persona.isolatedSessionIds],
    searchCount: persona.searchCount,
    correlationRisk: persona.correlationRisk
  }
}
