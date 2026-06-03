export interface IdentityCompartment {
  id: string;
  agentId: string;
  label?: string;
}

export interface SessionState {
  cache: Record<string, unknown>;
  history: Array<Record<string, unknown>>;
  transportMetadata: Record<string, unknown>;
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionState>();

  getOrCreate(compartment: IdentityCompartment): SessionState {
    if (!this.sessions.has(compartment.id)) {
      this.sessions.set(compartment.id, {
        cache: {},
        history: [],
        transportMetadata: {}
      });
    }

    return this.sessions.get(compartment.id)!;
  }

  recordHistory(compartment: IdentityCompartment, event: Record<string, unknown>): void {
    const session = this.getOrCreate(compartment);
    session.history.push(event);
  }

  setTransportMetadata(compartment: IdentityCompartment, metadata: Record<string, unknown>): void {
    const session = this.getOrCreate(compartment);
    session.transportMetadata = { ...session.transportMetadata, ...metadata };
  }
}
