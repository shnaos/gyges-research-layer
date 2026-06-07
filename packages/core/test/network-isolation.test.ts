/**
 * Sprint 30 — NetworkIsolationEngine unit tests.
 *
 * Covers: relay profile registration, route assignment, rotation (persona /
 * category / critical risk / assignment ceiling), compartment + persona
 * isolation, deterministic assignment, no mutation leaks, bounded route lists,
 * and fail-closed behaviour (no relay, transport disabled, quarantined).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  NetworkIsolationEngine,
  DEFAULT_RELAY_PROFILE_ID,
  type RelayProfile
} from '../src/network-isolation/index.js';

let seq = 0;
const fixedNow = () => 1_000 + seq++;

function engine(): NetworkIsolationEngine {
  return new NetworkIsolationEngine({ now: fixedNow });
}

beforeEach(() => {
  seq = 0;
});

describe('NetworkIsolationEngine — profiles', () => {
  it('seeds the bootstrap local-default relay profile', () => {
    const e = engine();
    const profiles = e.listRelayProfiles();
    expect(profiles.some((p) => p.id === DEFAULT_RELAY_PROFILE_ID)).toBe(true);
    const def = profiles.find((p) => p.id === DEFAULT_RELAY_PROFILE_ID)!;
    expect(def.enabled).toBe(true);
    expect(def.isolationLevel).toBe('isolated');
  });

  it('registers a custom relay profile and rejects duplicates', () => {
    const e = engine();
    const p: RelayProfile = {
      id: 'extra', name: 'Extra', enabled: true, isolationLevel: 'strict',
      supportsDnsIsolation: false, tags: ['x'], createdAt: 0
    };
    e.registerRelayProfile(p);
    expect(e.listRelayProfiles().some((x) => x.id === 'extra')).toBe(true);
    expect(() => e.registerRelayProfile(p)).toThrow();
  });
});

describe('NetworkIsolationEngine — assignment & isolation', () => {
  it('assigns an isolated route to a fresh compartment', () => {
    const e = engine();
    const d = e.evaluateIsolation({ compartmentId: 'research' });
    expect(d.allowed).toBe(true);
    expect(d.relayProfileId).toBe(DEFAULT_RELAY_PROFILE_ID);
    expect(d.relayRouteId).toMatch(/^route-\d{3}$/);
    expect(d.isolationLevel).toBe('isolated');
    expect(d.shouldRotate).toBe(false);
  });

  it('reuses the same route for the same compartment (deterministic, stable)', () => {
    const e = engine();
    const a = e.evaluateIsolation({ compartmentId: 'research' });
    const b = e.evaluateIsolation({ compartmentId: 'research' });
    expect(b.relayRouteId).toBe(a.relayRouteId);
    expect(b.shouldRotate).toBe(false);
  });

  it('assigns distinct routes to different compartments (no cross-compartment reuse)', () => {
    const e = engine();
    const a = e.evaluateIsolation({ compartmentId: 'research' });
    const b = e.evaluateIsolation({ compartmentId: 'finance' });
    expect(a.relayRouteId).not.toBe(b.relayRouteId);
  });

  it('produces deterministic route ids (route-001, route-002, …)', () => {
    const e = engine();
    expect(e.evaluateIsolation({ compartmentId: 'a' }).relayRouteId).toBe('route-001');
    expect(e.evaluateIsolation({ compartmentId: 'b' }).relayRouteId).toBe('route-002');
  });

  it('binds persona and fragment scope onto the route', () => {
    const e = engine();
    e.evaluateIsolation({ compartmentId: 'research', personaId: 'p1', fragmentId: 'f1' });
    const route = e.resolveRoute('research')!;
    expect(route.personaId).toBe('p1');
    expect(route.fragmentId).toBe('f1');
  });
});

describe('NetworkIsolationEngine — rotation', () => {
  it('rotates on persona change', () => {
    const e = engine();
    const a = e.evaluateIsolation({ compartmentId: 'research' });
    const b = e.evaluateIsolation({ compartmentId: 'research', personaRotated: true });
    expect(b.shouldRotate).toBe(true);
    expect(b.relayRouteId).not.toBe(a.relayRouteId);
  });

  it('rotates on category change', () => {
    const e = engine();
    e.evaluateIsolation({ compartmentId: 'research' });
    const b = e.evaluateIsolation({ compartmentId: 'research', categoryChanged: true });
    expect(b.shouldRotate).toBe(true);
  });

  it('rotates implicitly when the personaId (research category) changes', () => {
    const e = engine();
    const a = e.evaluateIsolation({ compartmentId: 'research', personaId: 'crypto' });
    expect(a.shouldRotate).toBe(false);
    // Same persona → stable route.
    const same = e.evaluateIsolation({ compartmentId: 'research', personaId: 'crypto' });
    expect(same.shouldRotate).toBe(false);
    expect(same.relayRouteId).toBe(a.relayRouteId);
    // Different persona → rotation.
    const changed = e.evaluateIsolation({ compartmentId: 'research', personaId: 'health' });
    expect(changed.shouldRotate).toBe(true);
    expect(changed.relayRouteId).not.toBe(a.relayRouteId);
  });

  it('rotates on critical risk', () => {
    const e = engine();
    e.evaluateIsolation({ compartmentId: 'research' });
    const b = e.evaluateIsolation({ compartmentId: 'research', criticalRisk: true });
    expect(b.shouldRotate).toBe(true);
  });

  it('does not rotate when the rotation policy is disabled', () => {
    const e = new NetworkIsolationEngine({
      now: fixedNow,
      rotationPolicy: {
        enabled: false, rotateOnPersonaChange: true, rotateOnCategoryChange: true,
        rotateOnCriticalRisk: true, maxAssignmentsPerRoute: 50
      }
    });
    e.evaluateIsolation({ compartmentId: 'research' });
    const b = e.evaluateIsolation({ compartmentId: 'research', criticalRisk: true });
    expect(b.shouldRotate).toBe(false);
  });

  it('rotates once the assignment ceiling is reached', () => {
    const e = new NetworkIsolationEngine({
      now: fixedNow,
      rotationPolicy: {
        enabled: true, rotateOnPersonaChange: false, rotateOnCategoryChange: false,
        rotateOnCriticalRisk: false, maxAssignmentsPerRoute: 1
      }
    });
    const a = e.evaluateIsolation({ compartmentId: 'research' }); // count=1
    const b = e.evaluateIsolation({ compartmentId: 'research' }); // ceiling reached → rotate
    expect(b.shouldRotate).toBe(true);
    expect(b.relayRouteId).not.toBe(a.relayRouteId);
  });
});

describe('NetworkIsolationEngine — fail-closed', () => {
  it('denies when no enabled relay is available', () => {
    const e = new NetworkIsolationEngine({ now: fixedNow, seedDefaultProfile: false });
    const d = e.evaluateIsolation({ compartmentId: 'research' });
    expect(d.allowed).toBe(false);
    expect(d.relayRouteId).toBeUndefined();
    expect(d.reason).toMatch(/no enabled relay/i);
  });

  it('denies when outbound transport is disabled', () => {
    const e = engine();
    const d = e.evaluateIsolation({ compartmentId: 'research', transportEnabled: false });
    expect(d.allowed).toBe(false);
  });

  it('denies a quarantined compartment', () => {
    const e = engine();
    const d = e.evaluateIsolation({ compartmentId: 'research', quarantined: true });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/quarantined/i);
  });
});

describe('NetworkIsolationEngine — defensive copies & bounds', () => {
  it('returns defensive copies of profiles (no mutation leak)', () => {
    const e = engine();
    const profiles = e.listRelayProfiles();
    profiles[0].tags.push('mutated');
    profiles[0].enabled = false;
    expect(e.listRelayProfiles()[0].tags).not.toContain('mutated');
    expect(e.listRelayProfiles().find((p) => p.id === DEFAULT_RELAY_PROFILE_ID)!.enabled).toBe(true);
  });

  it('returns defensive copies of routes and bindings', () => {
    const e = engine();
    e.evaluateIsolation({ compartmentId: 'research' });
    const route = e.listRoutes()[0];
    route.active = false;
    route.compartmentId = 'hacked';
    expect(e.resolveRoute('research')).toBeDefined();
    const binding = e.listBindings()[0];
    binding.relayRouteId = 'tampered';
    expect(e.getBinding('research')!.relayRouteId).not.toBe('tampered');
  });

  it('bounds retained routes via FIFO eviction of inactive routes', () => {
    const e = new NetworkIsolationEngine({
      now: fixedNow,
      maxRoutes: 3,
      rotationPolicy: {
        enabled: true, rotateOnPersonaChange: false, rotateOnCategoryChange: false,
        rotateOnCriticalRisk: false, maxAssignmentsPerRoute: 1
      }
    });
    // Force many rotations for one compartment; inactive routes must be pruned.
    for (let i = 0; i < 10; i++) {
      e.evaluateIsolation({ compartmentId: 'research' });
    }
    expect(e.listRoutes().length).toBeLessThanOrEqual(3);
    // The active route remains resolvable.
    expect(e.resolveRoute('research')).toBeDefined();
  });

  it('respects the limit argument on list methods', () => {
    const e = engine();
    e.evaluateIsolation({ compartmentId: 'a' });
    e.evaluateIsolation({ compartmentId: 'b' });
    e.evaluateIsolation({ compartmentId: 'c' });
    expect(e.listRoutes(2)).toHaveLength(2);
    expect(e.listBindings(1)).toHaveLength(1);
  });
});

describe('NetworkIsolationEngine — DNS isolation metadata', () => {
  it('exposes the default DNS isolation policy (metadata only)', () => {
    const e = engine();
    const dns = e.getDnsPolicy();
    expect(dns.enabled).toBe(true);
    expect(dns.isolatePerCompartment).toBe(true);
    // Defensive copy.
    dns.enabled = false;
    expect(e.getDnsPolicy().enabled).toBe(true);
  });
});
