/**
 * LanguageIsolationEngine — deterministic Accept-Language rotation.
 *
 * Maintains a static pool of Accept-Language header values.
 * Rotation is counter-based (deterministic). Each profile is coherent
 * (primary language + fallbacks). No cross-persona leakage.
 */

/** Predefined Accept-Language profiles. */
const LANGUAGE_POOL: readonly string[] = [
  'en-US,en;q=0.9',
  'en-GB,en;q=0.8,fr;q=0.5',
  'de-DE,de;q=0.9,en;q=0.8',
  'fr-FR,fr;q=0.9,en;q=0.7',
  'es-ES,es;q=0.9,en;q=0.8',
  'nl-NL,nl;q=0.9,en;q=0.8',
  'pt-BR,pt;q=0.9,en;q=0.7'
] as const;

export class LanguageIsolationEngine {
  private readonly pool: readonly string[];

  constructor(pool?: readonly string[]) {
    this.pool = pool ?? LANGUAGE_POOL;
  }

  /**
   * Select an Accept-Language string deterministically from the pool.
   * Uses rotation count modulo pool size.
   */
  selectLanguage(rotationCount: number): string {
    const index = rotationCount % this.pool.length;
    return this.pool[index];
  }

  /** Return all language profiles in the pool (defensive copy). */
  listPool(): string[] {
    return [...this.pool];
  }

  get poolSize(): number {
    return this.pool.length;
  }
}
