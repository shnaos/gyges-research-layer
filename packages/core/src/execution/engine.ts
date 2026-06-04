/**
 * ExecutionEngine — routes an authorised {@link ExecutionRequest} to the
 * {@link TransportAdapter} that serves its session's {@link TransportKind}.
 *
 * Responsibilities (Sprint 6 MVP):
 *   - receive an ExecutionRequest
 *   - select the adapter by `request.session.transportKind`
 *   - refuse (fail-closed) when no adapter is registered for that kind
 *   - call `adapter.execute()` and return its {@link ExecutionResult}
 *   - translate an adapter that throws into a clean `failed` result
 *   - NEVER touch the network itself
 *
 * The engine never mutates the incoming request.
 */

import { randomUUID } from 'node:crypto';
import {
  ExecutionRequest,
  ExecutionResult,
  TransportAdapter,
  TransportKind
} from './types.js';

export interface ExecutionEngineOptions {
  /** Adapters to register at construction time. */
  adapters?: TransportAdapter[];
  /** Injectable clock for deterministic timing in tests. Defaults to {@link Date.now}. */
  now?: () => number;
  /** Injectable id generator for engine-built results. Defaults to {@link randomUUID}. */
  generateId?: () => string;
}

export class ExecutionEngine {
  private readonly adapters = new Map<TransportKind, TransportAdapter>();
  private readonly now: () => number;
  private readonly generateId: () => string;

  constructor(options: ExecutionEngineOptions = {}) {
    this.now = options.now ?? Date.now;
    this.generateId = options.generateId ?? randomUUID;
    for (const adapter of options.adapters ?? []) {
      this.register(adapter);
    }
  }

  /**
   * Register (or replace) the adapter for its declared {@link TransportKind}.
   * Returns the engine for fluent chaining.
   */
  register(adapter: TransportAdapter): this {
    this.adapters.set(adapter.kind, adapter);
    return this;
  }

  /** Whether an adapter is registered for the given transport kind. */
  hasAdapter(kind: TransportKind): boolean {
    return this.adapters.has(kind);
  }

  /**
   * Execute an authorised request through the adapter bound to its session's
   * transport kind.
   *
   * - adapter found   → returns `adapter.execute()`
   * - adapter absent  → `blocked` result with a clear reason (fail-closed)
   * - adapter throws  → `failed` result carrying a clean error message
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const kind = request.session.transportKind;
    const adapter = this.adapters.get(kind);

    if (!adapter) {
      const startedAt = this.now();
      return {
        id: this.generateId(),
        requestId: request.id,
        status: 'blocked',
        transportKind: kind,
        error: `No transport adapter registered for kind "${kind}".`,
        startedAt,
        completedAt: this.now()
      };
    }

    const startedAt = this.now();
    try {
      return await adapter.execute(request);
    } catch (err) {
      return {
        id: this.generateId(),
        requestId: request.id,
        status: 'failed',
        transportKind: kind,
        error: err instanceof Error ? err.message : 'Transport adapter error.',
        startedAt,
        completedAt: this.now()
      };
    }
  }
}
