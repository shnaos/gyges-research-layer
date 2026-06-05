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
import type {
  AdapterSandboxPolicy,
  SandboxDecision
} from '../transport-registry/types.js';
import type { TransportCapabilityRegistry } from '../transport-registry/registry.js';

export interface ExecutionEngineOptions {
  /** Adapters to register at construction time. */
  adapters?: TransportAdapter[];
  /** Injectable clock for deterministic timing in tests. Defaults to {@link Date.now}. */
  now?: () => number;
  /** Injectable id generator for engine-built results. Defaults to {@link randomUUID}. */
  generateId?: () => string;
  /**
   * Optional transport capability registry. When provided (together with a
   * {@link AdapterSandboxPolicy}), the engine evaluates the adapter sandbox
   * BEFORE calling `adapter.execute()` and refuses (`blocked`) any violation.
   *
   * When omitted the engine behaves exactly as before — no sandbox gating — so
   * existing callers are unaffected. The registry is purely in-memory and never
   * performs real network, filesystem, process, or plugin work.
   */
  registry?: TransportCapabilityRegistry;
  /**
   * Sandbox policy enforced against the registered manifest. Required for the
   * sandbox gate to run; ignored when {@link registry} is not provided.
   */
  sandboxPolicy?: AdapterSandboxPolicy;
}

export class ExecutionEngine {
  private readonly adapters = new Map<TransportKind, TransportAdapter>();
  private readonly now: () => number;
  private readonly generateId: () => string;
  private readonly registry?: TransportCapabilityRegistry;
  private readonly sandboxPolicy?: AdapterSandboxPolicy;

  constructor(options: ExecutionEngineOptions = {}) {
    this.now = options.now ?? Date.now;
    this.generateId = options.generateId ?? randomUUID;
    this.registry = options.registry;
    this.sandboxPolicy = options.sandboxPolicy;
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
   * - sandbox blocks  → `blocked` result carrying the {@link SandboxDecision}
   *   (the adapter is NEVER called)
   * - adapter found   → returns `adapter.execute()` (with the allow decision
   *   attached when a registry is wired)
   * - adapter absent  → `blocked` result with a clear reason (fail-closed)
   * - adapter throws  → `failed` result carrying a clean error message
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const kind = request.session.transportKind;

    // Sandbox gate (only when a registry + policy are wired). It verifies the
    // transport is registered, the tool is supported, and the manifest complies
    // with the sandbox policy — all BEFORE any adapter is selected or invoked.
    let sandbox: SandboxDecision | undefined;
    if (this.registry && this.sandboxPolicy) {
      sandbox = this.registry.evaluateSandbox(kind, request.tool, this.sandboxPolicy);
      if (sandbox.action === 'block') {
        const startedAt = this.now();
        return {
          id: this.generateId(),
          requestId: request.id,
          status: 'blocked',
          transportKind: kind,
          error: 'Sandbox blocked transport execution.',
          sandbox,
          startedAt,
          completedAt: this.now()
        };
      }
    }

    const adapter = this.adapters.get(kind);

    if (!adapter) {
      const startedAt = this.now();
      return {
        id: this.generateId(),
        requestId: request.id,
        status: 'blocked',
        transportKind: kind,
        error: `No transport adapter registered for kind "${kind}".`,
        ...(sandbox ? { sandbox } : {}),
        startedAt,
        completedAt: this.now()
      };
    }

    const startedAt = this.now();
    try {
      const result = await adapter.execute(request);
      return sandbox ? { ...result, sandbox } : result;
    } catch (err) {
      return {
        id: this.generateId(),
        requestId: request.id,
        status: 'failed',
        transportKind: kind,
        error: err instanceof Error ? err.message : 'Transport adapter error.',
        ...(sandbox ? { sandbox } : {}),
        startedAt,
        completedAt: this.now()
      };
    }
  }
}
