/**
 * Trust-related type re-exports.
 *
 * Trust data is read-only: the SDK never mutates trust scores directly. All
 * data is returned as-is from the GRL Local API. No raw input, tokens, or
 * secrets are ever stored here.
 */

export type { TrustProfile } from './types.js';
