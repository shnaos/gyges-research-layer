/**
 * Execution & Transport Adapter MVP — core primitives and contracts.
 *
 * Sprint 6 introduces the execution and transport abstraction layer. These
 * contracts describe *how* an already-authorised capability is carried out, but
 * carry NO real network behaviour: the only transport shipped in this sprint is
 * a deterministic in-process mock.
 *
 * The types are deliberately self-contained and agnostic — no coupling to any
 * specific business product, persistence, browser, or real transport
 * implementation.
 */

import { CapabilityTool, RiskLevel } from '../index.js';
import type { SandboxDecision } from '../transport-registry/types.js';

/**
 * Terminal status of an {@link ExecutionResult}.
 *
 * - `success` — the transport adapter executed the request and returned output
 * - `blocked` — execution was refused before any adapter ran (e.g. no adapter
 *   registered for the requested transport kind)
 * - `failed`  — an adapter was selected but execution raised an error
 */
export type ExecutionStatus = 'success' | 'blocked' | 'failed';

/**
 * Transport mechanisms the execution layer can route through.
 *
 * Only `mock` is implemented in Sprint 6. The remaining kinds are declared so
 * the contract is stable for future sprints (`direct`, `tor`, `proxy`,
 * `searxng`, `browser`) but none of them perform any real network I/O yet.
 */
export type TransportKind =
  | 'mock'
  | 'direct'
  | 'tor'
  | 'proxy'
  | 'searxng'
  | 'browser';

/**
 * Minimal session context propagated through an execution.
 *
 * Sprint 6 ships only the shape and a minimal generator. There is no
 * persistence and no real isolation yet — this prepares the future Session
 * Manager without implementing it.
 */
export interface SessionContext {
  sessionId: string;
  compartmentId: string;
  transportKind: TransportKind;
  createdAt: number;
}

/**
 * A fully-authorised request handed to the {@link ExecutionEngine}.
 *
 * By the time an `ExecutionRequest` exists, the Capability Firewall has already
 * allowed the capability and any required human approval has been resolved. The
 * execution layer never re-evaluates policy; it only routes and runs.
 */
export interface ExecutionRequest {
  id: string;
  agentId: string;
  compartmentId: string;
  tool: CapabilityTool;
  riskLevel: RiskLevel;
  input: unknown;
  sanitizedInput?: unknown;
  /**
   * Optional transport-level headers to inject into the outbound request.
   * Provided by the TransportFingerprintEngine to reduce trivial header
   * correlation. Never contains secrets, tokens, or raw input.
   */
  transportHeaders?: Record<string, string>;
  session: SessionContext;
}

/**
 * The deterministic outcome of running an {@link ExecutionRequest}.
 *
 * `output` is present on success; `error` is present on a `blocked`/`failed`
 * result. `transportKind` records which transport produced (or would have
 * produced) the result.
 */
export interface ExecutionResult {
  id: string;
  requestId: string;
  status: ExecutionStatus;
  transportKind: TransportKind;
  output?: unknown;
  error?: string;
  startedAt: number;
  completedAt: number;
  /**
   * Sandbox decision evaluated before the adapter ran, when the engine is wired
   * with a {@link TransportCapabilityRegistry}. Present on both an allowed
   * execution and a sandbox-`blocked` result; absent when no registry is wired.
   */
  sandbox?: SandboxDecision;
}

/**
 * Contract every transport implementation must satisfy.
 *
 * An adapter declares the {@link TransportKind} it serves and executes a
 * request, returning an {@link ExecutionResult}. Adapters must treat the
 * incoming request as immutable.
 */
export interface TransportAdapter {
  kind: TransportKind;
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
}
