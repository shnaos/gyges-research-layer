/**
 * Execution & Transport Adapter MVP — public surface.
 *
 * Sprint 6 contracts and the single mock transport. No real network behaviour
 * is exposed here.
 */

export type {
  ExecutionStatus,
  TransportKind,
  SessionContext,
  ExecutionRequest,
  ExecutionResult,
  TransportAdapter
} from './types.js';

export { ExecutionEngine } from './engine.js';
export type { ExecutionEngineOptions } from './engine.js';

export { MockTransportAdapter } from './mock-transport.js';
export type { MockTransportAdapterOptions } from './mock-transport.js';

export { createSessionContext } from './session.js';
export type { CreateSessionContextInput } from './session.js';
