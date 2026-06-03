export interface CapabilityRequest {
  agentId: string;
  compartment: string;
  tool: 'search' | 'fetch_html';
  riskLevel: 'low' | 'medium' | 'high';
  input: unknown;
}

export interface CapabilityDecision {
  allowed: boolean;
  reason: string;
  requiresConfirmation: boolean;
  delayMs?: number;
  sanitizedInput?: unknown;
}

export interface CapabilityPolicyEvaluator {
  evaluate(request: CapabilityRequest): CapabilityDecision;
}

export class CapabilityFirewall {
  constructor(private readonly evaluator: CapabilityPolicyEvaluator) {}

  evaluate(request: CapabilityRequest): CapabilityDecision {
    return this.evaluator.evaluate(request);
  }
}
