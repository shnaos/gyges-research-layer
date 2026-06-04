import { describe, expect, it } from 'vitest';
import {
  ExecutionEngine,
  ExecutionRequest,
  MockTransportAdapter,
  TransportAdapter,
  createSessionContext
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

describe('createSessionContext', () => {
  it('mints an opaque session id and propagates compartment + transport', () => {
    const session = createSessionContext({
      compartmentId: 'research',
      now: () => 42
    });
    expect(session.sessionId).toBeTruthy();
    expect(typeof session.sessionId).toBe('string');
    expect(session.compartmentId).toBe('research');
    expect(session.transportKind).toBe('mock');
    expect(session.createdAt).toBe(42);
  });

  it('generates unique session ids', () => {
    const a = createSessionContext({ compartmentId: 'research' });
    const b = createSessionContext({ compartmentId: 'research' });
    expect(a.sessionId).not.toBe(b.sessionId);
  });
});

describe('MockTransportAdapter', () => {
  it('returns a deterministic success output without any network', async () => {
    const adapter = new MockTransportAdapter({
      now: () => 100,
      generateId: () => 'res-1'
    });
    const request = buildRequest();
    const result = await adapter.execute(request);

    expect(result.status).toBe('success');
    expect(result.transportKind).toBe('mock');
    expect(result.requestId).toBe('req-1');
    expect(result.id).toBe('res-1');
    expect(result.output).toEqual({
      mock: true,
      tool: 'search',
      input: 'bitcoin privacy research',
      sessionId: request.session.sessionId
    });
  });

  it('echoes sanitizedInput when present', async () => {
    const adapter = new MockTransportAdapter();
    const request = buildRequest({
      input: 'raw <script>',
      sanitizedInput: 'raw'
    });
    const result = await adapter.execute(request);
    expect((result.output as { input: unknown }).input).toBe('raw');
  });
});

describe('ExecutionEngine', () => {
  it('executes via the mock adapter and propagates transportKind + sessionId', async () => {
    const engine = new ExecutionEngine({
      adapters: [new MockTransportAdapter({ generateId: () => 'res-1' })]
    });
    const request = buildRequest();
    const result = await engine.execute(request);

    expect(result.status).toBe('success');
    expect(result.transportKind).toBe('mock');
    expect((result.output as { sessionId: string }).sessionId).toBe(
      request.session.sessionId
    );
  });

  it('blocks with a clear reason when no adapter is registered', async () => {
    const engine = new ExecutionEngine();
    const request = buildRequest();
    const result = await engine.execute(request);

    expect(result.status).toBe('blocked');
    expect(result.transportKind).toBe('mock');
    expect(result.output).toBeUndefined();
    expect(result.error).toContain('mock');
  });

  it('fails cleanly when an adapter throws', async () => {
    const throwing: TransportAdapter = {
      kind: 'mock',
      async execute() {
        throw new Error('boom');
      }
    };
    const engine = new ExecutionEngine({ adapters: [throwing] });
    const result = await engine.execute(buildRequest());

    expect(result.status).toBe('failed');
    expect(result.transportKind).toBe('mock');
    expect(result.error).toBe('boom');
    expect(result.output).toBeUndefined();
  });

  it('does not mutate the incoming request', async () => {
    const engine = new ExecutionEngine({
      adapters: [new MockTransportAdapter()]
    });
    const request = buildRequest();
    const snapshot = JSON.parse(JSON.stringify(request));
    await engine.execute(request);
    expect(JSON.parse(JSON.stringify(request))).toEqual(snapshot);
  });

  it('produces a deterministic mock output for the same request', async () => {
    const engine = new ExecutionEngine({
      adapters: [new MockTransportAdapter({ generateId: () => 'res' })]
    });
    const request = buildRequest();
    const a = await engine.execute(request);
    const b = await engine.execute(request);
    expect(a.output).toEqual(b.output);
  });

  it('hasAdapter reflects registration', () => {
    const engine = new ExecutionEngine();
    expect(engine.hasAdapter('mock')).toBe(false);
    engine.register(new MockTransportAdapter());
    expect(engine.hasAdapter('mock')).toBe(true);
  });
});
