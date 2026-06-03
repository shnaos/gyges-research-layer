import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import {
  CapabilityDecision,
  CapabilityRequest,
  RiskLevel,
  TransportType
} from '../../core/src/index.js';

export interface PolicyRule {
  effect: 'allow' | 'deny';
  agentId: string;
  compartment: string;
  tool: CapabilityRequest['tool'];
  /** Legacy exact risk match. Either this or `maxRiskLevel` may be set. */
  riskLevel?: RiskLevel;
  /** Ceiling risk: the request risk must be at or below this level. */
  maxRiskLevel?: RiskLevel;
  /** Transport this rule binds to. Defaults to `direct` when omitted. */
  transport?: TransportType;
  requiresConfirmation?: boolean;
  delayMs?: number;
}

export interface PolicyDocument {
  defaultDeny: boolean;
  rules: PolicyRule[];
}

const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

function riskMatches(rule: PolicyRule, request: CapabilityRequest): boolean {
  if (rule.riskLevel) {
    return rule.riskLevel === request.riskLevel;
  }
  if (rule.maxRiskLevel) {
    return RISK_RANK[request.riskLevel] <= RISK_RANK[rule.maxRiskLevel];
  }
  // No risk constraint on the rule: any risk level matches.
  return true;
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
    const matchedRule = this.policy.rules.find(
      (rule) =>
        rule.agentId === request.agentId &&
        rule.compartment === request.compartment &&
        rule.tool === request.tool &&
        riskMatches(rule, request)
    );

    if (!matchedRule) {
      return {
        allowed: false,
        reason: this.policy.defaultDeny ? 'Denied by default policy.' : 'No matching rule.',
        requiresConfirmation: false
      };
    }

    const transport: TransportType = matchedRule.transport ?? 'direct';

    if (matchedRule.effect === 'deny') {
      return {
        allowed: false,
        reason: 'Denied by explicit policy rule.',
        requiresConfirmation: false,
        delayMs: matchedRule.delayMs,
        transport
      };
    }

    // Deny any attempt to use a transport other than the one the policy binds
    // to this capability. This blocks silent transport escalation.
    if (request.transport && request.transport !== transport) {
      return {
        allowed: false,
        reason: `Transport not permitted by policy (requested ${request.transport}, allowed ${transport}).`,
        requiresConfirmation: false,
        transport
      };
    }

    return {
      allowed: true,
      reason: 'Allowed by explicit policy rule.',
      requiresConfirmation: Boolean(matchedRule.requiresConfirmation),
      delayMs: matchedRule.delayMs,
      sanitizedInput: request.input,
      transport
    };
  }
}
