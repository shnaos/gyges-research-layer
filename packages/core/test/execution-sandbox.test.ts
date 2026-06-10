import { describe, expect, it, vi } from 'vitest';
import {
  ExecutionEngine,
  ExecutionRequest,
  MockTransportAdapter,
  TransportAdapter,
  TransportCapabilityRegistry,
  createSessionContext,
  BOOTSTRAP_MOCK_MANIFEST,
  STRICT_SANDBOX_POLICY
} from '../src/index.js';

/** Build a deterministic execution request bound to the given transport kind. */
function buildRequest(
  overrides: Partial<ExecutionRequest> = {}
): ExecutionRequest {
  const session = createSessionContext({
    compartmentId: 'research',
    transportKind: overrides.session?.transportKind ?? 'mock',
    now: () => 1_000
  });
  return {
    id: 'req-1',
    agentId: 'local-agent',
    compartmentId: 'research',
    tool: 'search',
    riskLevel: 'low',
    input: 'bitcoin privacy research',
    session,
    ...overrides
  };
}

/** A registry seeded with the bootstrap mock manifest. */
function bootstrapRegistry(): TransportCapabilityRegistry {
  const registry = new TransportCapabilityRegistry();
  registry.registerManifest(BOOTSTRAP_MOCK_MANIFEST);
  return registry;
}

describe('ExecutionEngine — sandbox gate', () => {
  it('blocks an unknown transport via the registry before any adapter runs', async () => {
    const registry = new TransportCapabilityRegistry(); // empty: mock unregistered
    const adapter = new MockTransportAdapter();
    const spy = vi.spyOn(adapter, 'execute');
    const engine = new ExecutionEngine({
      adapters: [adapter],
      registry,
      sandboxPolicy: STRICT_SANDBOX_POLICY
    });

    const result = await engine.execute(buildRequest());

    expect(result.status).toBe('blocked');
    expect(result.error).toBe('Sandbox blocked transport execution.');
    expect(result.sandbox?.action).toBe('block');
    expect(result.sandbox?.violations[0].code).toBe('transport_not_registered');
    expect(spy).not.toHaveBeenCalled();
  });

  it('blocks an unsupported tool', async () => {
    const registry = new TransportCapabilityRegistry();
    registry.registerManifest({ ...BOOTSTRAP_MOCK_MANIFEST, supportedTools: ['search'] });
    const adapter = new MockTransportAdapter();
    const spy = vi.spyOn(adapter, 'execute');
    const engine = new ExecutionEngine({
      adapters: [adapter],
      registry,
      sandboxPolicy: STRICT_SANDBOX_POLICY
    });

    const result = await engine.execute(buildRequest({ tool: 'fetch_html' }));

    expect(result.status).toBe('blocked');
    expect(result.sandbox?.violations[0].code).toBe('tool_not_supported');
    expect(spy).not.toHaveBeenCalled();
  });

  it('blocks a sandbox policy violation and never calls the adapter', async () => {
    const registry = new TransportCapabilityRegistry();
    registry.registerManifest({ ...BOOTSTRAP_MOCK_MANIFEST, networkAccess: true });
    const adapter = new MockTransportAdapter();
    const spy = vi.spyOn(adapter, 'execute');
    const engine = new ExecutionEngine({
      adapters: [adapter],
      registry,
      sandboxPolicy: STRICT_SANDBOX_POLICY
    });

    const result = await engine.execute(buildRequest());

    expect(result.status).toBe('blocked');
    expect(result.sandbox?.violations.map((v) => v.code)).toContain(
      'network_not_allowed'
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('executes the mock when the sandbox allows and attaches the allow decision', async () => {
    const engine = new ExecutionEngine({
      adapters: [new MockTransportAdapter({ generateId: () => 'res-1' })],
      registry: bootstrapRegistry(),
      sandboxPolicy: STRICT_SANDBOX_POLICY
    });

    const result = await engine.execute(buildRequest());

    expect(result.status).toBe('success');
    expect(result.transportKind).toBe('mock');
    expect(result.sandbox?.action).toBe('allow');
    expect(result.sandbox?.violations).toEqual([]);
  });

  it('keeps a thrown adapter as failed even with the sandbox wired (allow)', async () => {
    const throwing: TransportAdapter = {
      kind: 'mock',
      isReal: false,
      async execute() {
        throw new Error('boom');
      }
    };
    const engine = new ExecutionEngine({
      adapters: [throwing],
      registry: bootstrapRegistry(),
      sandboxPolicy: STRICT_SANDBOX_POLICY
    });

    const result = await engine.execute(buildRequest());

    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
    expect(result.sandbox?.action).toBe('allow');
  });

  it('behaves exactly as before when no registry is wired (no sandbox field)', async () => {
    const engine = new ExecutionEngine({
      adapters: [new MockTransportAdapter()]
    });
    const result = await engine.execute(buildRequest());
    expect(result.status).toBe('success');
    expect(result.sandbox).toBeUndefined();
  });
});
