/**
 * Sprint 3 — Capability Firewall MVP public surface.
 *
 * This barrel is kept separate from the legacy `index.ts` so the new,
 * self-contained MVP (compartmentId-based contracts, fetch_json tool,
 * CapabilityPolicy + PolicyStore) can evolve independently without breaking the
 * existing exports.
 */

export * from './capability-firewall/index.js';
export * from './policy-engine/index.js';
export * from './sanitizer/index.js';
