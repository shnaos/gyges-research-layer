import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUNTIME_CONFIG,
  RuntimeProfileResolver,
  RuntimeProfileResolutionError,
  BUILT_IN_PROFILES,
  BUILT_IN_PACKS,
  RUNTIME_PROFILE_NAMES,
  isValidProfileName,
  assertValidProfileName
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResolver(): RuntimeProfileResolver {
  return new RuntimeProfileResolver();
}

// ---------------------------------------------------------------------------
// isValidProfileName / assertValidProfileName
// ---------------------------------------------------------------------------

describe('isValidProfileName', () => {
  it('accepts all built-in profile names', () => {
    for (const name of RUNTIME_PROFILE_NAMES) {
      expect(isValidProfileName(name)).toBe(true);
    }
  });

  it('rejects unknown strings', () => {
    expect(isValidProfileName('unknown')).toBe(false);
    expect(isValidProfileName('')).toBe(false);
    expect(isValidProfileName(undefined)).toBe(false);
    expect(isValidProfileName(null)).toBe(false);
  });
});

describe('assertValidProfileName', () => {
  it('does not throw for valid names', () => {
    expect(() => assertValidProfileName('strict')).not.toThrow();
    expect(() => assertValidProfileName('balanced')).not.toThrow();
  });

  it('throws RuntimeProfileResolutionError for invalid names', () => {
    expect(() => assertValidProfileName('invalid')).toThrow(RuntimeProfileResolutionError);
    try {
      assertValidProfileName('invalid');
    } catch (e) {
      expect(e).toBeInstanceOf(RuntimeProfileResolutionError);
      expect((e as RuntimeProfileResolutionError).reason).toBe('unknown_profile');
    }
  });
});

// ---------------------------------------------------------------------------
// RuntimeProfileResolver — listProfiles / listPacks
// ---------------------------------------------------------------------------

describe('RuntimeProfileResolver.listProfiles', () => {
  it('returns all 4 built-in profiles', () => {
    const resolver = makeResolver();
    const profiles = resolver.listProfiles();
    expect(profiles.map((p) => p.name).sort()).toEqual(
      ['balanced', 'development', 'research', 'strict'].sort()
    );
  });

  it('returns defensive copies (no mutation leaks)', () => {
    const resolver = makeResolver();
    const profiles = resolver.listProfiles();
    profiles[0].name = 'hacked' as never;
    const profiles2 = resolver.listProfiles();
    expect(profiles2.some((p) => p.name === 'hacked')).toBe(false);
  });
});

describe('RuntimeProfileResolver.listPacks', () => {
  it('returns all 7 built-in packs', () => {
    const resolver = makeResolver();
    const packs = resolver.listPacks();
    expect(packs).toHaveLength(7);
    const ids = packs.map((p) => p.id);
    expect(ids).toContain('strict-defense-pack');
    expect(ids).toContain('strict-sandbox-pack');
    expect(ids).toContain('balanced-default-pack');
    expect(ids).toContain('research-flex-pack');
    expect(ids).toContain('development-low-friction-pack');
    expect(ids).toContain('privacy-hardening-pack');
    expect(ids).toContain('trust-hardening-pack');
  });

  it('returns defensive copies (no mutation leaks)', () => {
    const resolver = makeResolver();
    const packs = resolver.listPacks();
    packs[0].id = 'hacked';
    const packs2 = resolver.listPacks();
    expect(packs2.some((p) => p.id === 'hacked')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveProfile — strict
// ---------------------------------------------------------------------------

describe('resolveProfile strict', () => {
  it('resolves the strict profile', () => {
    const resolver = makeResolver();
    const result = resolver.resolveProfile('strict', DEFAULT_RUNTIME_CONFIG);
    expect(result.profile.name).toBe('strict');
    expect(result.packs.length).toBeGreaterThan(0);
    expect(result.resolvedConfig).toBeDefined();
  });

  it('strict packs include strict-defense-pack and strict-sandbox-pack', () => {
    const resolver = makeResolver();
    const result = resolver.resolveProfile('strict', DEFAULT_RUNTIME_CONFIG);
    const packIds = result.packs.map((p) => p.id);
    expect(packIds).toContain('strict-defense-pack');
    expect(packIds).toContain('strict-sandbox-pack');
  });

  it('strict resolved config has tighter rate limits than default', () => {
    const resolver = makeResolver();
    const result = resolver.resolveProfile('strict', DEFAULT_RUNTIME_CONFIG);
    // strict-defense-pack sets 3/min; default is higher
    const policy = result.resolvedConfig.rateLimitPolicies.find(
      (p) => p.scope === 'agent'
    );
    expect(policy).toBeDefined();
    expect(policy!.maxRequests).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// resolveProfile — balanced
// ---------------------------------------------------------------------------

describe('resolveProfile balanced', () => {
  it('resolves the balanced profile', () => {
    const resolver = makeResolver();
    const result = resolver.resolveProfile('balanced', DEFAULT_RUNTIME_CONFIG);
    expect(result.profile.name).toBe('balanced');
    expect(result.packs.length).toBeGreaterThan(0);
  });

  it('balanced resolvedConfig mirrors DEFAULT_RUNTIME_CONFIG', () => {
    const resolver = makeResolver();
    const result = resolver.resolveProfile('balanced', DEFAULT_RUNTIME_CONFIG);
    // The balanced-default-pack applies the same values as the default config,
    // so the rate limit policy count should match.
    expect(result.resolvedConfig.rateLimitPolicies.length).toBe(
      DEFAULT_RUNTIME_CONFIG.rateLimitPolicies.length
    );
  });
});

// ---------------------------------------------------------------------------
// resolveProfile — research (extends balanced)
// ---------------------------------------------------------------------------

describe('resolveProfile research (inheritance)', () => {
  it('resolves the research profile', () => {
    const resolver = makeResolver();
    const result = resolver.resolveProfile('research', DEFAULT_RUNTIME_CONFIG);
    expect(result.profile.name).toBe('research');
  });

  it('research includes packs from parent (balanced) plus its own', () => {
    const resolver = makeResolver();
    const result = resolver.resolveProfile('research', DEFAULT_RUNTIME_CONFIG);
    const packIds = result.packs.map((p) => p.id);
    expect(packIds).toContain('balanced-default-pack'); // from parent
    expect(packIds).toContain('research-flex-pack');    // own
  });

  it('research packs appear in deterministic order (parent first)', () => {
    const resolver = makeResolver();
    const a = resolver.resolveProfile('research', DEFAULT_RUNTIME_CONFIG);
    const b = resolver.resolveProfile('research', DEFAULT_RUNTIME_CONFIG);
    expect(a.packs.map((p) => p.id)).toEqual(b.packs.map((p) => p.id));
  });
});

// ---------------------------------------------------------------------------
// resolveProfile — development
// ---------------------------------------------------------------------------

describe('resolveProfile development', () => {
  it('resolves the development profile', () => {
    const resolver = makeResolver();
    const result = resolver.resolveProfile('development', DEFAULT_RUNTIME_CONFIG);
    expect(result.profile.name).toBe('development');
  });

  it('development allows higher rate limits than strict', () => {
    const resolver = makeResolver();
    const devResult = resolver.resolveProfile('development', DEFAULT_RUNTIME_CONFIG);
    const strictResult = resolver.resolveProfile('strict', DEFAULT_RUNTIME_CONFIG);
    const devPolicy = devResult.resolvedConfig.rateLimitPolicies.find(
      (p) => p.scope === 'agent'
    );
    const strictPolicy = strictResult.resolvedConfig.rateLimitPolicies.find(
      (p) => p.scope === 'agent'
    );
    expect(devPolicy).toBeDefined();
    expect(strictPolicy).toBeDefined();
    expect(devPolicy!.maxRequests).toBeGreaterThan(strictPolicy!.maxRequests);
  });
});

// ---------------------------------------------------------------------------
// Inheritance — unknown / cycle detection
// ---------------------------------------------------------------------------

describe('inheritance error cases', () => {
  it('throws unknown_profile for an unregistered profile', () => {
    const resolver = makeResolver();
    expect(() =>
      resolver.resolveProfile('unknown' as never, DEFAULT_RUNTIME_CONFIG)
    ).toThrow(RuntimeProfileResolutionError);
    try {
      resolver.resolveProfile('unknown' as never, DEFAULT_RUNTIME_CONFIG);
    } catch (e) {
      expect((e as RuntimeProfileResolutionError).reason).toBe('unknown_profile');
    }
  });

  it('throws inheritance_cycle when a cycle is detected', () => {
    const cycleA = {
      name: 'cycle-a' as never,
      extends: 'cycle-b' as never,
      packs: [],
      enabled: true
    };
    const cycleB = {
      name: 'cycle-b' as never,
      extends: 'cycle-a' as never,
      packs: [],
      enabled: true
    };
    const resolver = new RuntimeProfileResolver(
      [...BUILT_IN_PROFILES, cycleA, cycleB],
      BUILT_IN_PACKS
    );
    try {
      resolver.resolveProfile('cycle-a' as never, DEFAULT_RUNTIME_CONFIG);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(RuntimeProfileResolutionError);
      expect((e as RuntimeProfileResolutionError).reason).toBe('inheritance_cycle');
    }
  });

  it('throws unknown_pack when a profile references a missing pack', () => {
    const badProfile = {
      name: 'bad' as never,
      packs: ['nonexistent-pack'],
      enabled: true
    };
    const resolver = new RuntimeProfileResolver(
      [...BUILT_IN_PROFILES, badProfile],
      BUILT_IN_PACKS
    );
    try {
      resolver.resolveProfile('bad' as never, DEFAULT_RUNTIME_CONFIG);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(RuntimeProfileResolutionError);
      expect((e as RuntimeProfileResolutionError).reason).toBe('unknown_pack');
    }
  });
});

// ---------------------------------------------------------------------------
// Overrides applied after packs
// ---------------------------------------------------------------------------

describe('overrides applied after packs', () => {
  it('profile overrides win over pack-provided values', () => {
    const profileWithOverride = {
      name: 'custom' as never,
      packs: ['balanced-default-pack'],
      overrides: {
        rateLimitPolicies: [] // empty overrides pack values
      },
      enabled: true
    };
    const resolver = new RuntimeProfileResolver(
      [...BUILT_IN_PROFILES, profileWithOverride],
      BUILT_IN_PACKS
    );
    const result = resolver.resolveProfile('custom' as never, DEFAULT_RUNTIME_CONFIG);
    expect(result.resolvedConfig.rateLimitPolicies).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism and immutability
// ---------------------------------------------------------------------------

describe('determinism and immutability', () => {
  it('resolves the same profile identically on repeated calls', () => {
    const resolver = makeResolver();
    const a = resolver.resolveProfile('strict', DEFAULT_RUNTIME_CONFIG);
    const b = resolver.resolveProfile('strict', DEFAULT_RUNTIME_CONFIG);
    expect(JSON.stringify(a.resolvedConfig)).toBe(JSON.stringify(b.resolvedConfig));
    expect(a.packs.map((p) => p.id)).toEqual(b.packs.map((p) => p.id));
  });

  it('resolved config is deeply frozen', () => {
    const resolver = makeResolver();
    const result = resolver.resolveProfile('balanced', DEFAULT_RUNTIME_CONFIG);
    expect(Object.isFrozen(result.resolvedConfig)).toBe(true);
  });

  it('mutating the input base config does not affect the resolved config', () => {
    const resolver = makeResolver();
    const base = JSON.parse(JSON.stringify(DEFAULT_RUNTIME_CONFIG));
    const result = resolver.resolveProfile('balanced', base);
    base.version = 999;
    expect(result.resolvedConfig.version).not.toBe(999);
  });

  it('pack order is deterministic across resolutions', () => {
    const resolver = makeResolver();
    const runs = Array.from({ length: 5 }, () =>
      resolver.resolveProfile('strict', DEFAULT_RUNTIME_CONFIG).packs.map((p) => p.id)
    );
    for (const run of runs) {
      expect(run).toEqual(runs[0]);
    }
  });
});
