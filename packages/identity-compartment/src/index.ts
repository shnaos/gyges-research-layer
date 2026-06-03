import { randomUUID } from 'node:crypto';
import { DnsPolicy, TransportType } from '../../core/src/index.js';

/**
 * Per-compartment cookie store. Each compartment owns exactly one jar; jars are
 * never shared between compartments (anti-correlation: no shared cookies).
 */
export class CookieJar {
  private readonly store = new Map<string, string[]>();

  set(domain: string, cookie: string): void {
    const existing = this.store.get(domain) ?? [];
    existing.push(cookie);
    this.store.set(domain, existing);
  }

  get(domain: string): string[] {
    return [...(this.store.get(domain) ?? [])];
  }

  domains(): string[] {
    return [...this.store.keys()];
  }

  size(): number {
    let total = 0;
    for (const cookies of this.store.values()) {
      total += cookies.length;
    }
    return total;
  }

  clear(): void {
    this.store.clear();
  }
}

export interface IdentityCompartment {
  compartmentId: string;
  sessionId: string;
  transport: TransportType;
  cookieJar: CookieJar;
  userAgent: string;
  dnsPolicy: DnsPolicy;
  createdAt: number;
  lastRotationAt: number;
}

export interface CreateSessionOptions {
  transport: TransportType;
  dnsPolicy?: DnsPolicy;
  userAgent?: string;
}

export interface SessionManagerOptions {
  /** Idle timeout: a compartment unused for this long is considered expired. */
  idleTimeoutMs?: number;
  /** Absolute time-to-live from creation. */
  ttlMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  /** Pool of user-agents to draw from. Reuse across live compartments is avoided. */
  userAgentPool?: string[];
}

interface CompartmentRecord {
  identity: IdentityCompartment;
  lastAccessAt: number;
  history: Array<Record<string, unknown>>;
}

const DEFAULT_USER_AGENTS = [
  'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (X11; Linux x86_64; rv:115.0) Gecko/20100101 Firefox/115.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0'
];

/**
 * Manages compartment identities and their isolated runtime state.
 *
 * Strict rule: NO cross-compartment state sharing. Cookies, sessions,
 * user-agents and transport state are owned by exactly one compartment.
 */
export class SessionManager {
  private readonly records = new Map<string, CompartmentRecord>();
  private readonly idleTimeoutMs?: number;
  private readonly ttlMs?: number;
  private readonly now: () => number;
  private readonly userAgentPool: string[];

  constructor(options: SessionManagerOptions = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs;
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? (() => Date.now());
    this.userAgentPool =
      options.userAgentPool && options.userAgentPool.length > 0
        ? [...options.userAgentPool]
        : [...DEFAULT_USER_AGENTS];
  }

  /** User-agents currently in use by live compartments, optionally excluding one id. */
  private usedUserAgents(excludeCompartmentId?: string): Set<string> {
    const used = new Set<string>();
    for (const [id, record] of this.records) {
      if (id === excludeCompartmentId) continue;
      used.add(record.identity.userAgent);
    }
    return used;
  }

  /** Pick a user-agent not already used by another live compartment. */
  private pickUserAgent(excludeCompartmentId?: string, avoid?: string): string {
    const used = this.usedUserAgents(excludeCompartmentId);
    if (avoid) used.add(avoid);
    const free = this.userAgentPool.find((ua) => !used.has(ua));
    if (free) return free;
    // Pool exhausted: derive a unique variant so two compartments never share a UA.
    const base = this.userAgentPool[0];
    return `${base} GRL/${randomUUID().slice(0, 8)}`;
  }

  private isExpired(record: CompartmentRecord, at: number): boolean {
    if (this.ttlMs !== undefined && at - record.identity.createdAt >= this.ttlMs) {
      return true;
    }
    if (this.idleTimeoutMs !== undefined && at - record.lastAccessAt >= this.idleTimeoutMs) {
      return true;
    }
    return false;
  }

  /** Create a brand new compartment. Throws if one already exists for the id. */
  create(compartmentId: string, options: CreateSessionOptions): IdentityCompartment {
    if (this.records.has(compartmentId)) {
      throw new Error(`Compartment already exists: ${compartmentId}`);
    }
    const at = this.now();
    const identity: IdentityCompartment = {
      compartmentId,
      sessionId: randomUUID(),
      transport: options.transport,
      cookieJar: new CookieJar(),
      userAgent: options.userAgent ?? this.pickUserAgent(compartmentId),
      dnsPolicy: options.dnsPolicy ?? (options.transport === 'direct' ? 'system' : 'remote'),
      createdAt: at,
      lastRotationAt: at
    };
    this.records.set(compartmentId, { identity, lastAccessAt: at, history: [] });
    return identity;
  }

  /** Return a live compartment, or undefined when missing or expired. */
  get(compartmentId: string): IdentityCompartment | undefined {
    const record = this.records.get(compartmentId);
    if (!record) return undefined;
    const at = this.now();
    if (this.isExpired(record, at)) {
      this.destroy(compartmentId);
      return undefined;
    }
    record.lastAccessAt = at;
    return record.identity;
  }

  /**
   * Get an existing live compartment or create it. Throws on transport mixing:
   * a compartment is permanently bound to a single transport.
   */
  getOrCreate(compartmentId: string, options: CreateSessionOptions): IdentityCompartment {
    const existing = this.get(compartmentId);
    if (existing) {
      if (existing.transport !== options.transport) {
        throw new Error(
          `Transport mixing forbidden for compartment ${compartmentId}: ` +
            `${existing.transport} != ${options.transport}`
        );
      }
      return existing;
    }
    return this.create(compartmentId, options);
  }

  /**
   * Rotate the identity of a compartment: new sessionId, cleared cookies and a
   * rotated user-agent. For tor transports the new sessionId is used as the
   * SOCKS circuit credential, so rotation rebuilds the Tor circuit.
   */
  rotate(compartmentId: string): IdentityCompartment {
    const record = this.records.get(compartmentId);
    if (!record) {
      throw new Error(`Cannot rotate unknown compartment: ${compartmentId}`);
    }
    const at = this.now();
    record.identity.sessionId = randomUUID();
    record.identity.cookieJar.clear();
    record.identity.userAgent = this.pickUserAgent(compartmentId, record.identity.userAgent);
    record.identity.lastRotationAt = at;
    record.lastAccessAt = at;
    return record.identity;
  }

  /** Destroy a compartment, clearing all of its isolated state. */
  destroy(compartmentId: string): boolean {
    const record = this.records.get(compartmentId);
    if (!record) return false;
    record.identity.cookieJar.clear();
    record.history.length = 0;
    return this.records.delete(compartmentId);
  }

  recordHistory(compartmentId: string, event: Record<string, unknown>): void {
    const record = this.records.get(compartmentId);
    if (!record) return;
    record.history.push(event);
    record.lastAccessAt = this.now();
  }

  historyOf(compartmentId: string): Array<Record<string, unknown>> {
    return [...(this.records.get(compartmentId)?.history ?? [])];
  }

  activeCompartments(): string[] {
    return [...this.records.keys()];
  }

  /** Remove all expired compartments and return the ids that were destroyed. */
  pruneExpired(): string[] {
    const at = this.now();
    const removed: string[] = [];
    for (const [id, record] of [...this.records]) {
      if (this.isExpired(record, at)) {
        this.destroy(id);
        removed.push(id);
      }
    }
    return removed;
  }
}
