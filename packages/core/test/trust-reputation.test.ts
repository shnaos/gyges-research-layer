import { beforeEach, describe, expect, it } from 'vitest';
import {
  CompartmentTrustEngine,
  INITIAL_TRUST_SCORE,
  ReputationDecayPolicy,
  ReputationEventInput,
  ReputationProfile,
  TrustRecoveryPolicy,
  clampScore,
  levelForScore,
  makeTrustScore
} from '../src/index.js';

/**
 * Build a deterministic engine: a fixed clock and a monotonic id generator so
 * every test is fully reproducible (deterministic ids/timestamps).
 */
function deterministicEngine(
  overrides: Partial<{
    now: number;
    decayPolicy: ReputationDecayPolicy;
    recoveryPolicy: TrustRecoveryPolicy;
  }> = {}
): CompartmentTrustEngine {
  let seq = 0;
  return new CompartmentTrustEngine({
    now: () => overrides.now ?? 1000,
    generateId: () => `rep-${++seq}`,
    ...(overrides.decayPolicy ? { decayPolicy: overrides.decayPolicy } : {}),
    ...(overrides.recoveryPolicy
      ? { recoveryPolicy: overrides.recoveryPolicy }
      : {})
  });
}

function record(
  engine: CompartmentTrustEngine,
  overrides: Partial<ReputationEventInput> & { type: ReputationEventInput['type'] }
): ReputationProfile {
  return engine.recordEvent({
    compartmentId: 'research',
    reason: 'test event',
    ...overrides
  });
}

describe('trust scoring helpers', () => {
  it('clamps scores into [0, 100]', () => {
    expect(clampScore(-5)).toBe(0);
    expect(clampScore(0)).toBe(0);
    expect(clampScore(50)).toBe(50);
    expect(clampScore(100)).toBe(100);
    expect(clampScore(150)).toBe(100);
  });

  it('classifies trusted/neutral/restricted/quarantined levels', () => {
    expect(levelForScore(100)).toBe('trusted');
    expect(levelForScore(80)).toBe('trusted');
    expect(levelForScore(79)).toBe('neutral');
    expect(levelForScore(50)).toBe('neutral');
    expect(levelForScore(49)).toBe('restricted');
    expect(levelForScore(20)).toBe('restricted');
    expect(levelForScore(19)).toBe('quarantined');
    expect(levelForScore(0)).toBe('quarantined');
  });

  it('builds a consistent clamped score', () => {
    expect(makeTrustScore(150)).toEqual({ value: 100, level: 'trusted' });
    expect(makeTrustScore(-10)).toEqual({ value: 0, level: 'quarantined' });
  });
});

describe('CompartmentTrustEngine — profile lifecycle', () => {
  let engine: CompartmentTrustEngine;
  beforeEach(() => {
    engine = deterministicEngine();
  });

  it('creates a profile lazily with the neutral initial score', () => {
    expect(engine.getProfile('research')).toBeUndefined();
    const profile = engine.getOrCreateProfile('research');
    expect(profile.compartmentId).toBe('research');
    expect(profile.score.value).toBe(INITIAL_TRUST_SCORE);
    expect(profile.score.value).toBe(70);
    expect(profile.score.level).toBe('neutral');
    expect(profile.events).toEqual([]);
    expect(engine.size()).toBe(1);
  });

  it('is idempotent for getOrCreateProfile', () => {
    engine.getOrCreateProfile('research');
    engine.getOrCreateProfile('research');
    expect(engine.size()).toBe(1);
  });

  it('clears all profiles', () => {
    engine.getOrCreateProfile('research');
    engine.getOrCreateProfile('other');
    expect(engine.size()).toBe(2);
    engine.clear();
    expect(engine.size()).toBe(0);
    expect(engine.getProfile('research')).toBeUndefined();
  });
});

describe('CompartmentTrustEngine — scoring rules', () => {
  let engine: CompartmentTrustEngine;
  beforeEach(() => {
    engine = deterministicEngine();
  });

  it('records clean_execution as +1', () => {
    const profile = record(engine, { type: 'clean_execution' });
    expect(profile.score.value).toBe(71);
    expect(profile.events).toHaveLength(1);
    expect(profile.events[0].delta).toBe(1);
    expect(profile.events[0].type).toBe('clean_execution');
  });

  it('records capability_allowed as +0', () => {
    const profile = record(engine, { type: 'capability_allowed' });
    expect(profile.score.value).toBe(70);
    expect(profile.events[0].delta).toBe(0);
  });

  it('records capability_denied as -2', () => {
    const profile = record(engine, { type: 'capability_denied' });
    expect(profile.score.value).toBe(68);
    expect(profile.events[0].delta).toBe(-2);
  });

  it('records approval_rejected as -4', () => {
    const profile = record(engine, { type: 'approval_rejected' });
    expect(profile.score.value).toBe(66);
  });

  it('records privacy_boundary_blocked as -8', () => {
    const profile = record(engine, { type: 'privacy_boundary_blocked' });
    expect(profile.score.value).toBe(62);
  });

  it('records sandbox_blocked as -10', () => {
    const profile = record(engine, { type: 'sandbox_blocked' });
    expect(profile.score.value).toBe(60);
  });

  it('records execution_failed as -6', () => {
    const profile = record(engine, { type: 'execution_failed' });
    expect(profile.score.value).toBe(64);
  });

  it('records incident_opened warning as -12', () => {
    const profile = record(engine, {
      type: 'incident_opened',
      incidentSeverity: 'warning'
    });
    expect(profile.score.value).toBe(58);
    expect(profile.events[0].delta).toBe(-12);
  });

  it('records incident_opened critical as -25', () => {
    const profile = record(engine, {
      type: 'incident_opened',
      incidentSeverity: 'critical'
    });
    expect(profile.score.value).toBe(45);
    expect(profile.score.level).toBe('restricted');
    expect(profile.events[0].delta).toBe(-25);
  });

  it('records incident_closed as +5', () => {
    // Degrade first so the recovery is visible and not clamped at the cap.
    record(engine, { type: 'sandbox_blocked' }); // 70 -> 60
    const profile = record(engine, { type: 'incident_closed' }); // 60 -> 65
    expect(profile.score.value).toBe(65);
    const closed = profile.events.find((e) => e.type === 'incident_closed');
    expect(closed?.delta).toBe(5);
  });

  it('clamps the score at the floor (never below 0)', () => {
    for (let i = 0; i < 5; i++) {
      record(engine, { type: 'incident_opened', incidentSeverity: 'critical' });
    }
    const profile = engine.getProfile('research');
    expect(profile?.score.value).toBe(0);
    expect(profile?.score.level).toBe('quarantined');
  });

  it('clamps the score at the ceiling (never above 100)', () => {
    const recoveryEngine = deterministicEngine({
      recoveryPolicy: {
        cleanExecutionDelta: 50,
        incidentClosedDelta: 50,
        maxRecoveryPerWindow: 1000,
        windowMs: 3_600_000,
        enabled: true
      }
    });
    for (let i = 0; i < 5; i++) {
      record(recoveryEngine, { type: 'clean_execution' });
    }
    const profile = recoveryEngine.getProfile('research');
    expect(profile?.score.value).toBe(100);
    expect(profile?.score.level).toBe('trusted');
  });

  it('crosses into restricted then quarantined as denials accumulate', () => {
    // 70 - 25 = 45 (restricted) - 25 = 20 (restricted) - 25 -> 0 (quarantined)
    record(engine, { type: 'incident_opened', incidentSeverity: 'critical' });
    expect(engine.getProfile('research')?.score.level).toBe('restricted');
    record(engine, { type: 'incident_opened', incidentSeverity: 'critical' });
    expect(engine.getProfile('research')?.score.level).toBe('restricted');
    record(engine, { type: 'incident_opened', incidentSeverity: 'critical' });
    expect(engine.getProfile('research')?.score.level).toBe('quarantined');
  });
});

describe('CompartmentTrustEngine — decay / recovery', () => {
  it('decay restores a degraded compartment below 70', () => {
    const engine = deterministicEngine();
    record(engine, { type: 'sandbox_blocked' }); // 70 -> 60
    const changed = engine.applyDecay(1000);
    expect(changed).toHaveLength(1);
    expect(changed[0].score.value).toBe(61);
  });

  it('decay never lifts a compartment above 70 by itself', () => {
    const engine = deterministicEngine();
    // A healthy 70 compartment is never inflated by decay.
    engine.getOrCreateProfile('research');
    expect(engine.applyDecay(1000)).toEqual([]);
    expect(engine.getProfile('research')?.score.value).toBe(70);

    // A compartment one step below the cap is restored to exactly 70, no more.
    const engine2 = new CompartmentTrustEngine({
      now: () => 1000,
      generateId: () => 'x',
      decayPolicy: {
        intervalMs: 0,
        recoveryDelta: 5,
        maxScore: 70,
        enabled: true
      }
    });
    engine2.recordEvent({
      compartmentId: 'research',
      type: 'capability_denied',
      reason: 'd'
    }); // 70 -> 68
    engine2.applyDecay(2000); // 68 -> 70 (capped)
    expect(engine2.getProfile('research')?.score.value).toBe(70);
    // Subsequent passes do not exceed 70.
    engine2.applyDecay(3000);
    expect(engine2.getProfile('research')?.score.value).toBe(70);
  });

  it('recovery never exceeds 100', () => {
    const engine = new CompartmentTrustEngine({
      now: () => 1000,
      generateId: () => 'x',
      recoveryPolicy: {
        cleanExecutionDelta: 5,
        incidentClosedDelta: 40,
        maxRecoveryPerWindow: 1000,
        windowMs: 3_600_000,
        enabled: true
      }
    });
    for (let i = 0; i < 10; i++) {
      engine.recordEvent({
        compartmentId: 'research',
        type: 'incident_closed',
        reason: 'closed'
      });
    }
    expect(engine.getProfile('research')?.score.value).toBe(100);
  });

  it('caps positive recovery within the sliding window', () => {
    const engine = new CompartmentTrustEngine({
      now: () => 1000,
      generateId: () => 'x',
      recoveryPolicy: {
        cleanExecutionDelta: 5,
        incidentClosedDelta: 5,
        maxRecoveryPerWindow: 6,
        windowMs: 10_000,
        enabled: true
      }
    });
    // Degrade well below the cap so clamping is not the limiting factor.
    for (let i = 0; i < 3; i++) {
      engine.recordEvent({
        compartmentId: 'research',
        type: 'incident_opened',
        incidentSeverity: 'critical',
        reason: 'i'
      });
    }
    const before = engine.getProfile('research')?.score.value ?? 0;
    // Two clean executions would be +10 nominal, but the window caps at +6.
    engine.recordEvent({
      compartmentId: 'research',
      type: 'clean_execution',
      reason: 'c',
      createdAt: 1000
    });
    engine.recordEvent({
      compartmentId: 'research',
      type: 'clean_execution',
      reason: 'c',
      createdAt: 1000
    });
    const after = engine.getProfile('research')?.score.value ?? 0;
    expect(after - before).toBe(6);
  });
});

describe('CompartmentTrustEngine — determinism & immutability', () => {
  it('assigns deterministic ids and timestamps', () => {
    const engine = deterministicEngine();
    const profile = record(engine, { type: 'clean_execution' });
    expect(profile.events[0].id).toBe('rep-1');
    expect(profile.events[0].createdAt).toBe(1000);
  });

  it('honours a caller-supplied createdAt', () => {
    const engine = deterministicEngine();
    const profile = record(engine, { type: 'clean_execution', createdAt: 5555 });
    expect(profile.events[0].createdAt).toBe(5555);
    expect(profile.updatedAt).toBe(5555);
  });

  it('listProfiles returns defensive copies that cannot mutate engine state', () => {
    const engine = deterministicEngine();
    record(engine, { type: 'capability_denied' });
    const [copy] = engine.listProfiles();
    copy.score.value = 999;
    copy.events.push({
      id: 'evil',
      createdAt: 0,
      compartmentId: 'research',
      type: 'capability_allowed',
      delta: 100,
      reason: 'mutation'
    });
    const fresh = engine.getProfile('research');
    expect(fresh?.score.value).toBe(68);
    expect(fresh?.events).toHaveLength(1);
  });

  it('returned event copies cannot mutate engine state', () => {
    const engine = deterministicEngine();
    const profile = record(engine, { type: 'capability_denied' });
    profile.events[0].delta = -999;
    expect(engine.getProfile('research')?.events[0].delta).toBe(-2);
  });

  it('does not mutate the caller input object', () => {
    const engine = deterministicEngine();
    const input: ReputationEventInput = {
      compartmentId: 'research',
      type: 'capability_denied',
      reason: 'immutable'
    };
    const snapshot = JSON.stringify(input);
    engine.recordEvent(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
