/**
 * Session Manager & Identity Compartments MVP — public surface.
 *
 * Sprint 7 contracts and the in-memory SessionManager. No real network,
 * browser, or persistence behaviour is exposed here.
 */

export { SessionManager, SessionManagerError } from './manager.js';
export type { SessionManagerOptions } from './manager.js';

export type {
  SessionStatus,
  SessionReusePolicy,
  SessionRotationPolicy,
  IdentityCompartment,
  SessionRecord,
  SessionManagerConfig,
  SessionManagerErrorKind
} from './types.js';
