/**
 * @gyges/agent-sdk — Runtime profile switch example.
 *
 * Demonstrates how to:
 *   1. List available runtime profiles.
 *   2. Get the currently active profile.
 *   3. Switch to a different profile.
 *   4. Verify the switch by re-reading the active profile.
 *
 * Prerequisites:
 *   - GRL runtime running locally (npm run dev:server from repo root)
 *
 * Usage:
 *   npx tsx examples/agent-sdk/runtime-profile-switch.ts
 */

import { GrlAgentClient } from '../../packages/agent-sdk/src/index.js';

const client = new GrlAgentClient();

// 1. List all available runtime profiles.
const profiles = await client.listRuntimeProfiles();
console.log('Available runtime profiles:');
for (const p of profiles) {
  console.log(`  - ${p.name}${p.enabled ? ' (active)' : ''}`);
  if (p.description) console.log(`      ${p.description}`);
}

// 2. Get the currently active profile.
const active = await client.getRuntimeProfile();
console.log('\nCurrent active profile:', active.name);
console.log('Pack IDs:', active.packIds.join(', '));

// 3. Switch to a different profile (use first non-active if available).
const target = profiles.find((p) => p.name !== active.name);
if (!target) {
  console.log('\nOnly one profile available — nothing to switch to.');
  process.exit(0);
}

console.log(`\nSwitching to profile: ${target.name}`);
const switchResult = await client.switchRuntimeProfile(target.name);
console.log('Switched at:', new Date(switchResult.switchedAt).toISOString());
console.log('New active profile:', switchResult.profile.name);

// 4. Verify by re-reading the active profile.
const newActive = await client.getRuntimeProfile();
console.log('\nVerified active profile:', newActive.name);

// Restore original profile.
await client.switchRuntimeProfile(active.name);
console.log('\nRestored original profile:', active.name);
