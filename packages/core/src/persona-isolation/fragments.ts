import { randomUUID } from 'node:crypto'
import type { PersonaFragmentBinding } from './types.js'

/**
 * Manages {@link PersonaFragmentBinding}s — the association between a search
 * persona and its identity fragments.
 *
 * Purely in-memory; no I/O of any kind.
 */
export class PersonaFragmentManager {
  private readonly bindings: PersonaFragmentBinding[] = []
  private readonly generateId: () => string
  private readonly now: () => number

  constructor(options: { generateId?: () => string; now?: () => number } = {}) {
    this.generateId = options.generateId ?? randomUUID
    this.now = options.now ?? Date.now
  }

  /**
   * Create a new binding between a persona and a fragment. Only one active
   * binding per (personaId, fragmentId) pair is allowed — deduplicates silently.
   * Returns a defensive copy.
   */
  bind(personaId: string, fragmentId: string): PersonaFragmentBinding {
    const existing = this.bindings.find(
      (b) => b.personaId === personaId && b.fragmentId === fragmentId && b.active
    )
    if (existing) {
      return cloneBinding(existing)
    }
    const binding: PersonaFragmentBinding = {
      personaId,
      fragmentId,
      createdAt: this.now(),
      active: true
    }
    this.bindings.push(binding)
    return cloneBinding(binding)
  }

  /**
   * Deactivate all bindings for a persona (e.g. on persona rotation). Returns
   * the number of bindings deactivated.
   */
  deactivateForPersona(personaId: string): number {
    let count = 0
    for (const b of this.bindings) {
      if (b.personaId === personaId && b.active) {
        b.active = false
        count++
      }
    }
    return count
  }

  /**
   * List active bindings for a persona.
   * Returns defensive copies.
   */
  listForPersona(personaId: string): PersonaFragmentBinding[] {
    return this.bindings
      .filter((b) => b.personaId === personaId && b.active)
      .map(cloneBinding)
  }

  /**
   * List all bindings, optionally filtered by agentId (inferred from persona ids
   * passed in).
   */
  listAll(): PersonaFragmentBinding[] {
    return this.bindings.map(cloneBinding)
  }

  /**
   * List bindings for a set of persona ids (used to scope to an agent).
   */
  listForPersonaIds(personaIds: string[]): PersonaFragmentBinding[] {
    const set = new Set(personaIds)
    return this.bindings.filter((b) => set.has(b.personaId)).map(cloneBinding)
  }

  /** Clear all bindings. */
  clear(): void {
    this.bindings.length = 0
  }
}

function cloneBinding(binding: PersonaFragmentBinding): PersonaFragmentBinding {
  return {
    personaId: binding.personaId,
    fragmentId: binding.fragmentId,
    createdAt: binding.createdAt,
    active: binding.active
  }
}
