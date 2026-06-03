export type CapabilityTool = 'search' | 'fetch_html';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface CapabilityRequest {
  agentId: string;
  compartment: string;
  tool: CapabilityTool;
  riskLevel: RiskLevel;
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
