/**
 * Transport-related type re-exports.
 *
 * Transport data is read-only: the SDK surfaces transport manifests registered
 * in the GRL Transport Capability Registry. No raw input, tokens, or secrets
 * are stored here.
 */

export type { TransportInfo } from './types.js';
