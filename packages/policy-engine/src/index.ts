import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { CapabilityDecision, CapabilityRequest } from '../../core/src/index.js';

export interface PolicyRule {
  effect: 'allow' | 'deny';
  agentId: string;
  compartment: string;
  tool: CapabilityRequest['tool'];
  riskLevel: CapabilityRequest['riskLevel'];
  requiresConfirmation?: boolean;
  delayMs?: number;
}

export interface PolicyDocument {
  defaultDeny: boolean;
  rules: PolicyRule[];
}

export class YamlPolicyEngine {
  constructor(private readonly policy: PolicyDocument) {}

  static fromFile(path: string): YamlPolicyEngine {
    const doc = yaml.load(readFileSync(path, 'utf8')) as PolicyDocument;
    return new YamlPolicyEngine({
      defaultDeny: doc.defaultDeny ?? true,
      rules: doc.rules ?? []
    });
  }

  evaluate(request: CapabilityRequest): CapabilityDecision {
    const matchedRule = this.policy.rules.find((rule) =>
      rule.agentId === request.agentId &&
      rule.compartment === request.compartment &&
      rule.tool === request.tool &&
      rule.riskLevel === request.riskLevel
    );

    if (!matchedRule) {
      return {
        allowed: false,
        reason: this.policy.defaultDeny ? 'Denied by default policy.' : 'No matching rule.',
        requiresConfirmation: false
      };
    }

    if (matchedRule.effect === 'deny') {
      return {
        allowed: false,
        reason: 'Denied by explicit policy rule.',
        requiresConfirmation: false,
        delayMs: matchedRule.delayMs
      };
    }

    return {
      allowed: true,
      reason: 'Allowed by explicit policy rule.',
      requiresConfirmation: Boolean(matchedRule.requiresConfirmation),
      delayMs: matchedRule.delayMs,
      sanitizedInput: request.input
    };
  }
}
