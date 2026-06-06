/**
 * UserAgentIsolationEngine — deterministic UA pool rotation.
 *
 * Maintains a small static pool of research-oriented User-Agent strings.
 * Rotation is counter-based (deterministic). No browser spoofing.
 * No canvas, TLS, JA3, or WebRTC spoofing.
 */

/** Static pool of research-oriented User-Agent strings. */
const UA_POOL: readonly string[] = [
  'GRL-Agent/1.0 (compatible; research)',
  'ResearchBot/2.1 (privacy-first; grl)',
  'GRL-Research/0.9 (local-first)',
  'PrivacyAgent/1.2 (grl; research-layer)',
  'GRL/3.0 (research; local)',
  'GrlResearch/1.5 (agent; privacy)',
  'ResearchLayer/0.8 (grl; deterministic)'
] as const;

export class UserAgentIsolationEngine {
  private readonly pool: readonly string[];

  constructor(pool?: readonly string[]) {
    this.pool = pool ?? UA_POOL;
  }

  /**
   * Select a User-Agent string deterministically from the pool.
   * Uses a simple modulo on the rotation counter so the result is stable
   * for the same counter value and reproducible across restarts.
   */
  selectUserAgent(rotationCount: number): string {
    const index = rotationCount % this.pool.length;
    return this.pool[index];
  }

  /** Return all User-Agent strings in the pool (defensive copy). */
  listPool(): string[] {
    return [...this.pool];
  }

  get poolSize(): number {
    return this.pool.length;
  }
}
