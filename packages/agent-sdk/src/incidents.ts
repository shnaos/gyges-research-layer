/**
 * Incident-related type re-exports.
 *
 * Incident data is read-only: the SDK surfaces incidents detected by the GRL
 * runtime heuristics engine. No raw input, tokens, or secrets are stored here.
 */

export type { RuntimeIncident } from './types.js';
