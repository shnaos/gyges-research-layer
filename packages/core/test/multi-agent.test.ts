/**
 * Multi-Agent Runtime Isolation — core unit tests.
 *
 * Covers:
 *  - AgentRegistry: register, duplicate, getAgent, listAgents, evict, restrict, quarantine
 *  - AgentRegistry: defensive copies (no mutation leaks)
 *  - AgentQuotaManager: canExecute, canCreateSession, violation counting, auto-restrict
 *  - RuntimeLeaseManager: acquire, release, expiration
 *  - RuntimeScheduler: deterministic scheduling, denial reasons
 *  - IsolationEngine: checkIsolation, trust degradation, compartment trust propagation
 *  - Trust degradation below thresholds
 *  - Quarantine propagation
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  AgentRegistry,
  AgentQuotaManager,
  RuntimeLeaseManager,
  RuntimeScheduler,
  IsolationEngine,
  DEFAULT_AGENT_QUOTA,
  INITIAL_AGENT_TRUST_SCORE,
  AGENT_RESTRICTED_THRESHOLD,
  AGENT_QUARANTINED_THRESHOLD
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let clock = 1000;
const fakeNow = () => clock;
let idSeq = 0;
const fakeId = () => `id-${++idSeq}`;

function makeRegistry() {
  return new AgentRegistry({ now: fakeNow, generateId: fakeId });
}

// ---------------------------------------------------------------------------
// AgentRegistry
// ---------------------------------------------------------------------------

describe('AgentRegistry — registration', () => {
  let registry: AgentRegistry;
  beforeEach(() => {
    clock = 1000;
    idSeq = 0;
    registry = makeRegistry();
  });

  it('registers a new agent with idle status and default quota', () => {
    const runtime = registry.registerAgent('agent-a');
    expect(runtime.agentId).toBe('agent-a');
    expect(runtime.status).toBe('idle');
    expect(runtime.trustScore).toBe(INITIAL_AGENT_TRUST_SCORE);
    expect(runtime.activeSessions).toBe(0);
    expect(runtime.activeExecutions).toBe(0);
    expect(runtime.quota).toEqual(DEFAULT_AGENT_QUOTA);
    expect(runtime.compartments).toEqual([]);
    expect(runtime.createdAt).toBe(1000);
    expect(runtime.lease).toBeUndefined();
  });

  it('duplicate registration returns existing runtime unchanged', () => {
    const first = registry.registerAgent('agent-a');
    clock = 9999;
    const second = registry.registerAgent('agent-a');
    expect(second).toEqual(first);
    expect(registry.size()).toBe(1);
  });

  it('getAgent returns undefined for unknown agent', () => {
    expect(registry.getAgent('unknown')).toBeUndefined();
  });

  it('listAgents returns all registered runtimes in insertion order', () => {
    registry.registerAgent('agent-a');
    registry.registerAgent('agent-b');
    const list = registry.listAgents();
    expect(list.map((r) => r.agentId)).toEqual(['agent-a', 'agent-b']);
  });

  it('size reflects only registered agents', () => {
    expect(registry.size()).toBe(0);
    registry.registerAgent('agent-a');
    registry.registerAgent('agent-b');
    expect(registry.size()).toBe(2);
  });

  it('clear removes all agents', () => {
    registry.registerAgent('agent-a');
    registry.clear();
    expect(registry.size()).toBe(0);
    expect(registry.getAgent('agent-a')).toBeUndefined();
  });
});

describe('AgentRegistry — status transitions', () => {
  let registry: AgentRegistry;
  beforeEach(() => {
    clock = 1000;
    idSeq = 0;
    registry = makeRegistry();
    registry.registerAgent('agent-a');
  });

  it('evictAgent sets status to evicted and clears active counts', () => {
    registry.updateAgent('agent-a', { activeExecutions: 3, activeSessions: 2 });
    const evicted = registry.evictAgent('agent-a');
    expect(evicted?.status).toBe('evicted');
    expect(evicted?.activeExecutions).toBe(0);
    expect(evicted?.activeSessions).toBe(0);
    expect(evicted?.lease).toBeUndefined();
  });

  it('restrictAgent sets status to restricted', () => {
    const restricted = registry.restrictAgent('agent-a');
    expect(restricted?.status).toBe('restricted');
  });

  it('quarantineAgent sets status to quarantined', () => {
    const quarantined = registry.quarantineAgent('agent-a');
    expect(quarantined?.status).toBe('quarantined');
  });

  it('restrictAgent on evicted agent returns evicted runtime unchanged', () => {
    registry.evictAgent('agent-a');
    const result = registry.restrictAgent('agent-a');
    expect(result?.status).toBe('evicted');
  });

  it('quarantineAgent on evicted agent returns evicted runtime unchanged', () => {
    registry.evictAgent('agent-a');
    const result = registry.quarantineAgent('agent-a');
    expect(result?.status).toBe('evicted');
  });

  it('evictAgent on unknown agent returns undefined', () => {
    expect(registry.evictAgent('nobody')).toBeUndefined();
  });

  it('restrictAgent on unknown agent returns undefined', () => {
    expect(registry.restrictAgent('nobody')).toBeUndefined();
  });
});

describe('AgentRegistry — defensive copies', () => {
  let registry: AgentRegistry;
  beforeEach(() => {
    clock = 1000;
    registry = makeRegistry();
  });

  it('returned runtime is a deep copy — mutations do not affect registry', () => {
    registry.registerAgent('agent-a');
    const runtime = registry.getAgent('agent-a')!;
    runtime.status = 'evicted';
    runtime.compartments.push('malicious');
    runtime.trustScore = 0;
    const fresh = registry.getAgent('agent-a')!;
    expect(fresh.status).toBe('idle');
    expect(fresh.compartments).toEqual([]);
    expect(fresh.trustScore).toBe(INITIAL_AGENT_TRUST_SCORE);
  });

  it('listAgents returns independent copies', () => {
    registry.registerAgent('agent-a');
    const list = registry.listAgents();
    list[0].status = 'evicted';
    expect(registry.getAgent('agent-a')?.status).toBe('idle');
  });

  it('updateAgent with compartments stores a copy', () => {
    registry.registerAgent('agent-a');
    const compartments = ['c1', 'c2'];
    registry.updateAgent('agent-a', { compartments });
    compartments.push('c3'); // mutate the array after update
    expect(registry.getAgent('agent-a')?.compartments).toEqual(['c1', 'c2']);
  });
});

// ---------------------------------------------------------------------------
// AgentQuotaManager
// ---------------------------------------------------------------------------

describe('AgentQuotaManager — execution quota', () => {
  let registry: AgentRegistry;
  let quotaManager: AgentQuotaManager;
  beforeEach(() => {
    clock = 1000;
    registry = makeRegistry();
    registry.registerAgent('agent-a');
    quotaManager = new AgentQuotaManager({ registry });
  });

  it('canExecute returns true for idle agent below quota', () => {
    expect(quotaManager.canExecute('agent-a')).toBe(true);
  });

  it('canExecute returns false for unknown agent', () => {
    expect(quotaManager.canExecute('nobody')).toBe(false);
  });

  it('canExecute returns false for evicted agent', () => {
    registry.evictAgent('agent-a');
    expect(quotaManager.canExecute('agent-a')).toBe(false);
  });

  it('canExecute returns false for quarantined agent', () => {
    registry.quarantineAgent('agent-a');
    expect(quotaManager.canExecute('agent-a')).toBe(false);
  });

  it('canExecute returns false for restricted agent', () => {
    registry.restrictAgent('agent-a');
    expect(quotaManager.canExecute('agent-a')).toBe(false);
  });

  it('recordExecutionStart increments activeExecutions and sets status active', () => {
    quotaManager.recordExecutionStart('agent-a');
    const runtime = registry.getAgent('agent-a')!;
    expect(runtime.activeExecutions).toBe(1);
    expect(runtime.status).toBe('active');
  });

  it('recordExecutionEnd decrements activeExecutions and returns to idle', () => {
    quotaManager.recordExecutionStart('agent-a');
    quotaManager.recordExecutionEnd('agent-a');
    const runtime = registry.getAgent('agent-a')!;
    expect(runtime.activeExecutions).toBe(0);
    expect(runtime.status).toBe('idle');
  });

  it('concurrent execution denial when quota reached', () => {
    const quota = DEFAULT_AGENT_QUOTA.maxConcurrentExecutions;
    for (let i = 0; i < quota; i++) {
      quotaManager.recordExecutionStart('agent-a');
    }
    expect(quotaManager.canExecute('agent-a')).toBe(false);
  });

  it('recordViolation restricts agent after threshold violations', () => {
    const mgr = new AgentQuotaManager({
      registry,
      violationsBeforeRestriction: 3
    });
    expect(mgr.recordViolation('agent-a')).toBe(false); // 1st
    expect(mgr.recordViolation('agent-a')).toBe(false); // 2nd
    const restricted = mgr.recordViolation('agent-a'); // 3rd → restrict
    expect(restricted).toBe(true);
    expect(registry.getAgent('agent-a')?.status).toBe('restricted');
  });

  it('violation count resets on successful execution start', () => {
    const mgr = new AgentQuotaManager({
      registry,
      violationsBeforeRestriction: 3
    });
    mgr.recordViolation('agent-a'); // 1st
    mgr.recordExecutionStart('agent-a'); // reset
    expect(mgr.getViolationCount('agent-a')).toBe(0);
  });
});

describe('AgentQuotaManager — session quota', () => {
  let registry: AgentRegistry;
  let quotaManager: AgentQuotaManager;
  beforeEach(() => {
    clock = 1000;
    registry = makeRegistry();
    registry.registerAgent('agent-a');
    quotaManager = new AgentQuotaManager({ registry });
  });

  it('canCreateSession returns true for idle agent below quota', () => {
    expect(quotaManager.canCreateSession('agent-a')).toBe(true);
  });

  it('canCreateSession returns false for evicted agent', () => {
    registry.evictAgent('agent-a');
    expect(quotaManager.canCreateSession('agent-a')).toBe(false);
  });

  it('recordSessionCreated increments activeSessions', () => {
    quotaManager.recordSessionCreated('agent-a');
    expect(registry.getAgent('agent-a')?.activeSessions).toBe(1);
  });

  it('recordSessionClosed decrements activeSessions', () => {
    quotaManager.recordSessionCreated('agent-a');
    quotaManager.recordSessionClosed('agent-a');
    expect(registry.getAgent('agent-a')?.activeSessions).toBe(0);
  });

  it('session quota denial when at ceiling', () => {
    const max = DEFAULT_AGENT_QUOTA.maxSessions;
    for (let i = 0; i < max; i++) {
      quotaManager.recordSessionCreated('agent-a');
    }
    expect(quotaManager.canCreateSession('agent-a')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RuntimeLeaseManager
// ---------------------------------------------------------------------------

describe('RuntimeLeaseManager — lifecycle', () => {
  let registry: AgentRegistry;
  let leaseManager: RuntimeLeaseManager;
  beforeEach(() => {
    clock = 1000;
    idSeq = 0;
    registry = makeRegistry();
    registry.registerAgent('agent-a');
    leaseManager = new RuntimeLeaseManager({
      registry,
      now: fakeNow,
      generateId: fakeId,
      leaseTtlMs: 5000
    });
  });

  it('acquireLease returns a lease with correct metadata', () => {
    const lease = leaseManager.acquireLease('agent-a');
    expect(lease.holderAgentId).toBe('agent-a');
    expect(lease.acquiredAt).toBe(1000);
    expect(lease.expiresAt).toBe(6000);
    expect(lease.renewable).toBe(true);
  });

  it('acquireLease attaches lease to agent runtime', () => {
    leaseManager.acquireLease('agent-a');
    const runtime = registry.getAgent('agent-a')!;
    expect(runtime.lease).toBeDefined();
    expect(runtime.lease?.holderAgentId).toBe('agent-a');
  });

  it('releaseLease removes the lease and detaches from agent', () => {
    const lease = leaseManager.acquireLease('agent-a');
    leaseManager.releaseLease(lease.id);
    expect(leaseManager.size()).toBe(0);
    expect(registry.getAgent('agent-a')?.lease).toBeUndefined();
  });

  it('releaseLease on unknown id is a no-op', () => {
    expect(() => leaseManager.releaseLease('nonexistent')).not.toThrow();
  });

  it('expireLeases removes stale leases', () => {
    leaseManager.acquireLease('agent-a');
    clock = 10000; // past expiry (1000 + 5000 = 6000)
    leaseManager.expireLeases();
    expect(leaseManager.size()).toBe(0);
    expect(registry.getAgent('agent-a')?.lease).toBeUndefined();
  });

  it('listLeases returns only live leases', () => {
    leaseManager.acquireLease('agent-a');
    clock = 10000; // expire
    const list = leaseManager.listLeases();
    expect(list).toEqual([]);
  });

  it('acquiring a second lease replaces the first', () => {
    const first = leaseManager.acquireLease('agent-a');
    const second = leaseManager.acquireLease('agent-a');
    expect(leaseManager.size()).toBe(1);
    expect(second.id).not.toBe(first.id);
  });

  it('getAgentLease returns the active lease', () => {
    leaseManager.acquireLease('agent-a');
    const lease = leaseManager.getAgentLease('agent-a');
    expect(lease).toBeDefined();
    expect(lease?.holderAgentId).toBe('agent-a');
  });

  it('getAgentLease returns undefined after expiry', () => {
    leaseManager.acquireLease('agent-a');
    clock = 10000;
    expect(leaseManager.getAgentLease('agent-a')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// RuntimeScheduler
// ---------------------------------------------------------------------------

describe('RuntimeScheduler — deterministic scheduling', () => {
  let registry: AgentRegistry;
  let scheduler: RuntimeScheduler;
  beforeEach(() => {
    clock = 1000;
    registry = makeRegistry();
    scheduler = new RuntimeScheduler({
      registry,
      maxGlobalConcurrentExecutions: 4
    });
  });

  it('allows execution for a registered idle agent', () => {
    registry.registerAgent('agent-a');
    const decision = scheduler.scheduleExecution('agent-a');
    expect(decision.allowed).toBe(true);
  });

  it('denies execution for unknown agent', () => {
    const decision = scheduler.scheduleExecution('unknown');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/not registered/i);
  });

  it('denies execution for evicted agent', () => {
    registry.registerAgent('agent-a');
    registry.evictAgent('agent-a');
    const decision = scheduler.scheduleExecution('agent-a');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/evicted/i);
  });

  it('denies execution for quarantined agent', () => {
    registry.registerAgent('agent-a');
    registry.quarantineAgent('agent-a');
    const decision = scheduler.scheduleExecution('agent-a');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/quarantined/i);
  });

  it('denies execution for restricted agent', () => {
    registry.registerAgent('agent-a');
    registry.restrictAgent('agent-a');
    const decision = scheduler.scheduleExecution('agent-a');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/restricted/i);
  });

  it('denies when agent hits its own quota ceiling', () => {
    registry.registerAgent('agent-a');
    registry.updateAgent('agent-a', {
      activeExecutions: DEFAULT_AGENT_QUOTA.maxConcurrentExecutions
    });
    const decision = scheduler.scheduleExecution('agent-a');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/quota/i);
  });

  it('denies when global ceiling reached', () => {
    registry.registerAgent('agent-a');
    registry.registerAgent('agent-b');
    // Saturate global ceiling across two agents.
    registry.updateAgent('agent-a', { activeExecutions: 2 });
    registry.updateAgent('agent-b', { activeExecutions: 2 });
    const decision = scheduler.scheduleExecution('agent-a');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/ceiling/i);
  });

  it('same registry state always yields same decision (deterministic)', () => {
    registry.registerAgent('agent-a');
    const d1 = scheduler.scheduleExecution('agent-a');
    const d2 = scheduler.scheduleExecution('agent-a');
    expect(d1).toEqual(d2);
  });
});

// ---------------------------------------------------------------------------
// IsolationEngine
// ---------------------------------------------------------------------------

describe('IsolationEngine — checkIsolation', () => {
  let registry: AgentRegistry;
  let isolationEngine: IsolationEngine;
  beforeEach(() => {
    clock = 1000;
    registry = makeRegistry();
    isolationEngine = new IsolationEngine({ registry });
  });

  it('denies unknown agent (fail-closed)', () => {
    const decision = isolationEngine.checkIsolation('nobody');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/not registered/i);
  });

  it('allows idle agent with healthy trust score', () => {
    registry.registerAgent('agent-a');
    const decision = isolationEngine.checkIsolation('agent-a');
    expect(decision.allowed).toBe(true);
  });

  it('denies evicted agent', () => {
    registry.registerAgent('agent-a');
    registry.evictAgent('agent-a');
    const decision = isolationEngine.checkIsolation('agent-a');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/evicted/i);
  });

  it('denies quarantined agent', () => {
    registry.registerAgent('agent-a');
    registry.quarantineAgent('agent-a');
    const decision = isolationEngine.checkIsolation('agent-a');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/quarantined/i);
  });

  it('denies restricted agent', () => {
    registry.registerAgent('agent-a');
    registry.restrictAgent('agent-a');
    const decision = isolationEngine.checkIsolation('agent-a');
    expect(decision.allowed).toBe(false);
    expect(decision.requiresRestriction).toBe(true);
  });

  it('auto-quarantines agent when trust score drops below quarantine threshold', () => {
    registry.registerAgent('agent-a');
    registry.updateAgent('agent-a', { trustScore: AGENT_QUARANTINED_THRESHOLD - 1 });
    const decision = isolationEngine.checkIsolation('agent-a');
    expect(decision.allowed).toBe(false);
    expect(registry.getAgent('agent-a')?.status).toBe('quarantined');
  });

  it('auto-restricts agent when trust score drops below restriction threshold', () => {
    registry.registerAgent('agent-a');
    registry.updateAgent('agent-a', {
      trustScore: AGENT_RESTRICTED_THRESHOLD - 1
    });
    const decision = isolationEngine.checkIsolation('agent-a');
    expect(decision.allowed).toBe(false);
    expect(decision.requiresRestriction).toBe(true);
    expect(registry.getAgent('agent-a')?.status).toBe('restricted');
  });
});

describe('IsolationEngine — trust degradation', () => {
  let registry: AgentRegistry;
  let isolationEngine: IsolationEngine;
  beforeEach(() => {
    clock = 1000;
    registry = makeRegistry();
    isolationEngine = new IsolationEngine({ registry });
  });

  it('degradeTrust reduces trust score', () => {
    registry.registerAgent('agent-a');
    const newScore = isolationEngine.degradeTrust('agent-a', 10);
    expect(newScore).toBe(INITIAL_AGENT_TRUST_SCORE - 10);
    expect(registry.getAgent('agent-a')?.trustScore).toBe(INITIAL_AGENT_TRUST_SCORE - 10);
  });

  it('degradeTrust clamps to 0', () => {
    registry.registerAgent('agent-a');
    const newScore = isolationEngine.degradeTrust('agent-a', 200);
    expect(newScore).toBe(0);
  });

  it('degradeTrust quarantines agent when score falls below quarantine threshold', () => {
    registry.registerAgent('agent-a');
    isolationEngine.degradeTrust('agent-a', INITIAL_AGENT_TRUST_SCORE - AGENT_QUARANTINED_THRESHOLD + 1);
    expect(registry.getAgent('agent-a')?.status).toBe('quarantined');
  });

  it('degradeTrust restricts agent when score falls below restriction threshold', () => {
    registry.registerAgent('agent-a');
    isolationEngine.degradeTrust('agent-a', INITIAL_AGENT_TRUST_SCORE - AGENT_RESTRICTED_THRESHOLD + 1);
    expect(registry.getAgent('agent-a')?.status).toBe('restricted');
  });

  it('degradeTrust on evicted agent returns existing trust score unchanged', () => {
    registry.registerAgent('agent-a');
    registry.evictAgent('agent-a');
    const newScore = isolationEngine.degradeTrust('agent-a', 50);
    expect(newScore).toBe(INITIAL_AGENT_TRUST_SCORE);
  });
});

describe('IsolationEngine — compartment trust propagation', () => {
  let registry: AgentRegistry;
  let isolationEngine: IsolationEngine;
  beforeEach(() => {
    clock = 1000;
    registry = makeRegistry();
    isolationEngine = new IsolationEngine({
      registry,
      quarantinedCompartmentThreshold: 2
    });
  });

  it('propagates average compartment score to agent', () => {
    registry.registerAgent('agent-a');
    registry.updateAgent('agent-a', { compartments: ['c1', 'c2'] });
    const scores = new Map([['c1', 80], ['c2', 60]]);
    isolationEngine.propagateCompartmentTrust('agent-a', scores);
    expect(registry.getAgent('agent-a')?.trustScore).toBe(70); // (80+60)/2
  });

  it('restricts agent when ≥2 compartments are quarantined', () => {
    registry.registerAgent('agent-a');
    registry.updateAgent('agent-a', { compartments: ['c1', 'c2', 'c3'] });
    const scores = new Map([
      ['c1', AGENT_QUARANTINED_THRESHOLD - 1],
      ['c2', AGENT_QUARANTINED_THRESHOLD - 1],
      ['c3', 70]
    ]);
    isolationEngine.propagateCompartmentTrust('agent-a', scores);
    const status = registry.getAgent('agent-a')?.status;
    expect(status === 'restricted' || status === 'quarantined').toBe(true);
  });

  it('propagation is a no-op for unknown agent', () => {
    expect(() =>
      isolationEngine.propagateCompartmentTrust('nobody', new Map())
    ).not.toThrow();
  });
});
