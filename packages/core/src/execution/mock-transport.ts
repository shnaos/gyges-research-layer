/**
 * MockTransportAdapter — the only transport shipped in Sprint 6.
 *
 * It exists so the execution path can be exercised end-to-end WITHOUT any real
 * network behaviour. It performs:
 *   - no fetch
 *   - no DNS resolution
 *   - no socket
 *   - no browser
 *
 * The adapter is fully deterministic: given the same request it always returns
 * the same `output` shape, echoing the tool, the (sanitized) input, and the
 * session id.
 */

import { randomUUID } from 'node:crypto';
import {
  ExecutionRequest,
  ExecutionResult,
  TransportAdapter,
  TransportKind
} from './types.js';

export interface MockTransportAdapterOptions {
  /** Injectable clock for deterministic timing in tests. Defaults to {@link Date.now}. */
  now?: () => number;
  /**
   * Injectable id generator for the result id. Defaults to {@link randomUUID}.
   * Useful for fully deterministic assertions in tests.
   */
  generateId?: () => string;
}

/**
 * Deterministic, network-free transport used to validate the execution layer.
 */
export class MockTransportAdapter implements TransportAdapter {
  readonly kind: TransportKind = 'mock';

  private readonly now: () => number;
  private readonly generateId: () => string;

  constructor(options: MockTransportAdapterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.generateId = options.generateId ?? randomUUID;
  }

  /**
   * "Execute" the request by returning a deterministic mock payload.
   *
   * The incoming request is treated as immutable: no field is mutated. The
   * echoed input prefers `sanitizedInput` when present, falling back to `input`.
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const startedAt = this.now();
    const echoedInput =
      'sanitizedInput' in request && request.sanitizedInput !== undefined
        ? request.sanitizedInput
        : request.input;

    const output = {
      mock: true,
      tool: request.tool,
      input: echoedInput,
      sessionId: request.session.sessionId
    };

    const completedAt = this.now();
    return {
      id: this.generateId(),
      requestId: request.id,
      status: 'success',
      transportKind: this.kind,
      output,
      startedAt,
      completedAt
    };
  }
}
