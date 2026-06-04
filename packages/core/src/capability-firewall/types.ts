/**
 * Capability Firewall MVP — core primitives and contracts.
 *
 * These types are deliberately self-contained and agnostic. They describe a
 * generic privacy/capability control surface for AI agents and carry no
 * coupling to any specific business product or transport implementation.
 */

export type CapabilityTool = 'search' | 'fetch_html' | 'fetch_json';

export type RiskLevel = 'low' | 'medium' | 'high';

/** All capability tools known to this build. Used for `tool inconnu => deny`. */
export const KNOWN_TOOLS: readonly CapabilityTool[] = [
  'search',
  'fetch_html',
  'fetch_json'
];

/** All risk levels known to this build, in ascending order of severity. */
export const KNOWN_RISK_LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high'];

/** Numeric rank used to compare risk levels deterministically. */
export const RISK_RANK: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2
};

export interface CapabilityRequest {
  agentId: string;
  compartmentId: string;
  tool: CapabilityTool;
  riskLevel: RiskLevel;
  input: unknown;
}

export interface CapabilityDecision {
  allowed: boolean;
  reason: string;
  requiresConfirmation: boolean;
  sanitizedInput?: unknown;
  delayMs?: number;
}

export interface CapabilityPolicy {
  agentId: string;
  compartmentId: string;
  allowedTools: CapabilityTool[];
  maxRiskLevel: RiskLevel;
  /**
   * When set, any request whose risk level is strictly above this threshold is
   * still allowed (subject to all other rules) but flagged as requiring
   * explicit confirmation.
   */
  requiresConfirmationAbove?: RiskLevel;
}

export function isKnownTool(value: unknown): value is CapabilityTool {
  return (
    typeof value === 'string' &&
    (KNOWN_TOOLS as readonly string[]).includes(value)
  );
}

export function isKnownRiskLevel(value: unknown): value is RiskLevel {
  return (
    typeof value === 'string' &&
    (KNOWN_RISK_LEVELS as readonly string[]).includes(value)
  );
}
