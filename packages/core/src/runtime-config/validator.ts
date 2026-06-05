/**
 * Runtime config validator — strict, fail-closed.
 *
 * The validator turns an untrusted `unknown` (typically the parsed JSON of a
 * local config file) into a typed {@link RuntimeConfig}, or throws a
 * {@link RuntimeConfigValidationError}. There is NO partial acceptance and NO
 * silent defaulting of policy fields: a malformed config is rejected outright so
 * GRL never runs on a half-understood policy surface (fail-closed).
 *
 * Validation is purely structural and bounded — no network, no I/O, no AI.
 */

import {
  AdaptiveDefensePolicy,
  CapabilityPolicy,
  CapabilityTransitionRule,
  DependencyIsolationPolicy,
  PrivacyBoundaryRule,
  RateLimitPolicy,
  RuntimeCompartment,
  RuntimeConfig,
  RuntimeSandboxPolicy,
  RuntimeTrustPolicy,
  TransportPolicyRule
} from './types.js';

/**
 * The closed vocabulary of validation failure reasons.
 *
 * - `invalid_json`          — the source text was not parseable JSON
 * - `invalid_schema`        — a required field is missing or of the wrong type
 * - `duplicate_compartment` — two compartments share an id
 * - `duplicate_policy`      — two policies/rules collide on their identity key
 * - `invalid_threshold`     — a trust/numeric threshold is incoherent
 * - `invalid_version`       — `version` is not a positive integer
 * - `invalid_enum`          — an enum-typed field holds an unknown value
 */
export type RuntimeConfigValidationReason =
  | 'invalid_json'
  | 'invalid_schema'
  | 'duplicate_compartment'
  | 'duplicate_policy'
  | 'invalid_threshold'
  | 'invalid_version'
  | 'invalid_enum';

/** Error thrown by {@link validateRuntimeConfig} and the JSON parser. */
export class RuntimeConfigValidationError extends Error {
  readonly reason: RuntimeConfigValidationReason;

  constructor(reason: RuntimeConfigValidationReason, message: string) {
    super(message);
    this.name = 'RuntimeConfigValidationError';
    this.reason = reason;
    // Restore the prototype chain for `instanceof` across transpilation.
    Object.setPrototypeOf(this, RuntimeConfigValidationError.prototype);
  }
}

const TRANSPORT_KINDS = [
  'mock',
  'direct',
  'tor',
  'proxy',
  'searxng',
  'browser'
] as const;
const CAPABILITY_TOOLS = ['search', 'fetch_html', 'fetch_json'] as const;
const RISK_LEVELS = ['low', 'medium', 'high'] as const;
const ISOLATION_LEVELS = ['none', 'session', 'compartment', 'strict'] as const;
const CORRELATION_RISK_LEVELS = ['none', 'low', 'medium', 'high'] as const;
const PRIVACY_BOUNDARY_ACTIONS = [
  'allow',
  'rotate_session',
  'require_approval',
  'block'
] as const;
const RATE_LIMIT_SCOPES = ['agent', 'compartment', 'session', 'tool'] as const;
const DEFENSE_ACTIONS = [
  'allow',
  'cooldown',
  'temporary_block',
  'require_approval',
  'escalate_risk'
] as const;
const RUNTIME_ANOMALY_TYPES = [
  'repeated_denied_capabilities',
  'sandbox_violation_attempts',
  'privacy_boundary_violations',
  'rapid_session_rotation',
  'high_risk_execution_pattern',
  'approval_rejection_pattern'
] as const;
const INCIDENT_SEVERITIES = ['info', 'warning', 'critical'] as const;
const EXECUTION_PATH_RISKS = ['low', 'medium', 'high', 'blocked'] as const;
const CAPABILITY_PATH_ACTIONS = [
  'allow',
  'require_approval',
  'force_rotation',
  'block'
] as const;

function fail(
  reason: RuntimeConfigValidationReason,
  message: string
): never {
  throw new RuntimeConfigValidationError(reason, message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, where: string): Record<string, unknown> {
  if (!isObject(value)) {
    fail('invalid_schema', `${where} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) {
    fail('invalid_schema', `${where} must be an array.`);
  }
  return value as unknown[];
}

function requireNonEmptyString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail('invalid_schema', `${where} must be a non-empty string.`);
  }
  return value as string;
}

function requireBoolean(value: unknown, where: string): boolean {
  if (typeof value !== 'boolean') {
    fail('invalid_schema', `${where} must be a boolean.`);
  }
  return value as boolean;
}

function requireFiniteNumber(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('invalid_schema', `${where} must be a finite number.`);
  }
  return value as number;
}

function requireNonNegativeInteger(value: unknown, where: string): number {
  const n = requireFiniteNumber(value, where);
  if (!Number.isInteger(n) || n < 0) {
    fail('invalid_schema', `${where} must be a non-negative integer.`);
  }
  return n;
}

function requirePositiveInteger(value: unknown, where: string): number {
  const n = requireFiniteNumber(value, where);
  if (!Number.isInteger(n) || n <= 0) {
    fail('invalid_schema', `${where} must be a positive integer.`);
  }
  return n;
}

function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  where: string
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail(
      'invalid_enum',
      `${where} must be one of: ${allowed.join(', ')}.`
    );
  }
  return value as T;
}

function validateCompartments(value: unknown): RuntimeCompartment[] {
  const arr = requireArray(value, 'compartments');
  const seen = new Set<string>();
  return arr.map((raw, i) => {
    const obj = requireObject(raw, `compartments[${i}]`);
    const id = requireNonEmptyString(obj.id, `compartments[${i}].id`);
    if (seen.has(id)) {
      fail('duplicate_compartment', `Duplicate compartment id: ${id}.`);
    }
    seen.add(id);
    const enabled = requireBoolean(obj.enabled, `compartments[${i}].enabled`);
    const compartment: RuntimeCompartment = { id, enabled };
    if (obj.description !== undefined) {
      compartment.description = requireNonEmptyString(
        obj.description,
        `compartments[${i}].description`
      );
    }
    return compartment;
  });
}

function validateFirewallPolicies(value: unknown): CapabilityPolicy[] {
  const arr = requireArray(value, 'firewallPolicies');
  const seen = new Set<string>();
  return arr.map((raw, i) => {
    const obj = requireObject(raw, `firewallPolicies[${i}]`);
    const agentId = requireNonEmptyString(
      obj.agentId,
      `firewallPolicies[${i}].agentId`
    );
    const compartmentId = requireNonEmptyString(
      obj.compartmentId,
      `firewallPolicies[${i}].compartmentId`
    );
    const tools = requireArray(
      obj.allowedTools,
      `firewallPolicies[${i}].allowedTools`
    ).map((t, j) =>
      requireEnum(
        t,
        CAPABILITY_TOOLS,
        `firewallPolicies[${i}].allowedTools[${j}]`
      )
    );
    const maxRiskLevel = requireEnum(
      obj.maxRiskLevel,
      RISK_LEVELS,
      `firewallPolicies[${i}].maxRiskLevel`
    );
    const key = `${agentId}\u0000${compartmentId}\u0000${maxRiskLevel}`;
    if (seen.has(key)) {
      fail(
        'duplicate_policy',
        `Duplicate firewall policy for agent/compartment/maxRiskLevel: ${agentId}/${compartmentId}/${maxRiskLevel}.`
      );
    }
    seen.add(key);
    const policy: CapabilityPolicy = {
      agentId,
      compartmentId,
      allowedTools: tools,
      maxRiskLevel
    };
    if (obj.requiresConfirmationAbove !== undefined) {
      policy.requiresConfirmationAbove = requireEnum(
        obj.requiresConfirmationAbove,
        RISK_LEVELS,
        `firewallPolicies[${i}].requiresConfirmationAbove`
      );
    }
    return policy;
  });
}

function validateTransportPolicies(value: unknown): TransportPolicyRule[] {
  const arr = requireArray(value, 'transportPolicies');
  const seen = new Set<string>();
  return arr.map((raw, i) => {
    const obj = requireObject(raw, `transportPolicies[${i}]`);
    const tool = requireEnum(
      obj.tool,
      CAPABILITY_TOOLS,
      `transportPolicies[${i}].tool`
    );
    const riskLevel = requireEnum(
      obj.riskLevel,
      RISK_LEVELS,
      `transportPolicies[${i}].riskLevel`
    );
    const key = `${tool}\u0000${riskLevel}`;
    if (seen.has(key)) {
      fail(
        'duplicate_policy',
        `Duplicate transport policy for tool/riskLevel: ${tool}/${riskLevel}.`
      );
    }
    seen.add(key);
    const preferredTransport = requireEnum(
      obj.preferredTransport,
      TRANSPORT_KINDS,
      `transportPolicies[${i}].preferredTransport`
    );
    const iso = requireObject(
      obj.isolationPolicy,
      `transportPolicies[${i}].isolationPolicy`
    );
    return {
      tool,
      riskLevel,
      preferredTransport,
      isolationPolicy: {
        level: requireEnum(
          iso.level,
          ISOLATION_LEVELS,
          `transportPolicies[${i}].isolationPolicy.level`
        ),
        forceRotateOnHighRisk: requireBoolean(
          iso.forceRotateOnHighRisk,
          `transportPolicies[${i}].isolationPolicy.forceRotateOnHighRisk`
        ),
        forbidSessionReuse: requireBoolean(
          iso.forbidSessionReuse,
          `transportPolicies[${i}].isolationPolicy.forbidSessionReuse`
        ),
        allowCrossToolReuse: requireBoolean(
          iso.allowCrossToolReuse,
          `transportPolicies[${i}].isolationPolicy.allowCrossToolReuse`
        )
      }
    };
  });
}

function validatePrivacyBoundaryRules(value: unknown): PrivacyBoundaryRule[] {
  const arr = requireArray(value, 'privacyBoundaryRules');
  const seen = new Set<string>();
  return arr.map((raw, i) => {
    const obj = requireObject(raw, `privacyBoundaryRules[${i}]`);
    const id = requireNonEmptyString(obj.id, `privacyBoundaryRules[${i}].id`);
    if (seen.has(id)) {
      fail('duplicate_policy', `Duplicate privacy boundary rule id: ${id}.`);
    }
    seen.add(id);
    return {
      id,
      sourceCompartmentId: requireNonEmptyString(
        obj.sourceCompartmentId,
        `privacyBoundaryRules[${i}].sourceCompartmentId`
      ),
      targetCompartmentId: requireNonEmptyString(
        obj.targetCompartmentId,
        `privacyBoundaryRules[${i}].targetCompartmentId`
      ),
      maxAllowedRisk: requireEnum(
        obj.maxAllowedRisk,
        CORRELATION_RISK_LEVELS,
        `privacyBoundaryRules[${i}].maxAllowedRisk`
      ),
      actionOnViolation: requireEnum(
        obj.actionOnViolation,
        PRIVACY_BOUNDARY_ACTIONS,
        `privacyBoundaryRules[${i}].actionOnViolation`
      )
    };
  });
}

function validateAdaptiveDefensePolicies(
  value: unknown
): AdaptiveDefensePolicy[] {
  const arr = requireArray(value, 'adaptiveDefensePolicies');
  const seen = new Set<string>();
  return arr.map((raw, i) => {
    const obj = requireObject(raw, `adaptiveDefensePolicies[${i}]`);
    const id = requireNonEmptyString(
      obj.id,
      `adaptiveDefensePolicies[${i}].id`
    );
    if (seen.has(id)) {
      fail('duplicate_policy', `Duplicate adaptive defense policy id: ${id}.`);
    }
    seen.add(id);
    const triggerAnomalyTypes = requireArray(
      obj.triggerAnomalyTypes,
      `adaptiveDefensePolicies[${i}].triggerAnomalyTypes`
    ).map((t, j) =>
      requireEnum(
        t,
        RUNTIME_ANOMALY_TYPES,
        `adaptiveDefensePolicies[${i}].triggerAnomalyTypes[${j}]`
      )
    );
    const triggerIncidentSeverities = requireArray(
      obj.triggerIncidentSeverities,
      `adaptiveDefensePolicies[${i}].triggerIncidentSeverities`
    ).map((s, j) =>
      requireEnum(
        s,
        INCIDENT_SEVERITIES,
        `adaptiveDefensePolicies[${i}].triggerIncidentSeverities[${j}]`
      )
    );
    const policy: AdaptiveDefensePolicy = {
      id,
      triggerAnomalyTypes,
      triggerIncidentSeverities,
      resultingAction: requireEnum(
        obj.resultingAction,
        DEFENSE_ACTIONS,
        `adaptiveDefensePolicies[${i}].resultingAction`
      ),
      enabled: requireBoolean(
        obj.enabled,
        `adaptiveDefensePolicies[${i}].enabled`
      )
    };
    if (obj.cooldownMs !== undefined) {
      policy.cooldownMs = requireNonNegativeInteger(
        obj.cooldownMs,
        `adaptiveDefensePolicies[${i}].cooldownMs`
      );
    }
    if (obj.escalationRiskLevel !== undefined) {
      policy.escalationRiskLevel = requireEnum(
        obj.escalationRiskLevel,
        RISK_LEVELS,
        `adaptiveDefensePolicies[${i}].escalationRiskLevel`
      );
    }
    return policy;
  });
}

function validateRateLimitPolicies(value: unknown): RateLimitPolicy[] {
  const arr = requireArray(value, 'rateLimitPolicies');
  const seen = new Set<string>();
  return arr.map((raw, i) => {
    const obj = requireObject(raw, `rateLimitPolicies[${i}]`);
    const id = requireNonEmptyString(obj.id, `rateLimitPolicies[${i}].id`);
    if (seen.has(id)) {
      fail('duplicate_policy', `Duplicate rate limit policy id: ${id}.`);
    }
    seen.add(id);
    const maxRequests = requireNonNegativeInteger(
      obj.maxRequests,
      `rateLimitPolicies[${i}].maxRequests`
    );
    const windowMs = requirePositiveInteger(
      obj.windowMs,
      `rateLimitPolicies[${i}].windowMs`
    );
    return {
      id,
      scope: requireEnum(
        obj.scope,
        RATE_LIMIT_SCOPES,
        `rateLimitPolicies[${i}].scope`
      ),
      maxRequests,
      windowMs,
      action: requireEnum(
        obj.action,
        DEFENSE_ACTIONS,
        `rateLimitPolicies[${i}].action`
      ),
      enabled: requireBoolean(obj.enabled, `rateLimitPolicies[${i}].enabled`)
    };
  });
}

function validateTrustPolicies(value: unknown): RuntimeTrustPolicy {
  const obj = requireObject(value, 'trustPolicies');
  const enabled = requireBoolean(obj.enabled, 'trustPolicies.enabled');
  const baselineScore = requireFiniteNumber(
    obj.baselineScore,
    'trustPolicies.baselineScore'
  );
  const quarantinedThreshold = requireFiniteNumber(
    obj.quarantinedThreshold,
    'trustPolicies.quarantinedThreshold'
  );
  const restrictedThreshold = requireFiniteNumber(
    obj.restrictedThreshold,
    'trustPolicies.restrictedThreshold'
  );
  if (baselineScore < 0 || baselineScore > 100) {
    fail('invalid_threshold', 'trustPolicies.baselineScore must be within 0..100.');
  }
  if (
    quarantinedThreshold < 0 ||
    !(quarantinedThreshold < restrictedThreshold) ||
    !(restrictedThreshold < baselineScore)
  ) {
    fail(
      'invalid_threshold',
      'trustPolicies thresholds must satisfy 0 <= quarantinedThreshold < restrictedThreshold < baselineScore.'
    );
  }
  return { enabled, baselineScore, quarantinedThreshold, restrictedThreshold };
}

function validateGraphTransitionRules(
  value: unknown
): CapabilityTransitionRule[] {
  const arr = requireArray(value, 'graphTransitionRules');
  const seen = new Set<string>();
  return arr.map((raw, i) => {
    const obj = requireObject(raw, `graphTransitionRules[${i}]`);
    const id = requireNonEmptyString(obj.id, `graphTransitionRules[${i}].id`);
    if (seen.has(id)) {
      fail('duplicate_policy', `Duplicate graph transition rule id: ${id}.`);
    }
    seen.add(id);
    return {
      id,
      fromTool: requireEnum(
        obj.fromTool,
        CAPABILITY_TOOLS,
        `graphTransitionRules[${i}].fromTool`
      ),
      toTool: requireEnum(
        obj.toTool,
        CAPABILITY_TOOLS,
        `graphTransitionRules[${i}].toTool`
      ),
      maxAllowedRisk: requireEnum(
        obj.maxAllowedRisk,
        EXECUTION_PATH_RISKS,
        `graphTransitionRules[${i}].maxAllowedRisk`
      ),
      actionOnViolation: requireEnum(
        obj.actionOnViolation,
        CAPABILITY_PATH_ACTIONS,
        `graphTransitionRules[${i}].actionOnViolation`
      ),
      enabled: requireBoolean(
        obj.enabled,
        `graphTransitionRules[${i}].enabled`
      )
    };
  });
}

function validateIsolationPolicies(
  value: unknown
): DependencyIsolationPolicy[] {
  const arr = requireArray(value, 'isolationPolicies');
  const seen = new Set<string>();
  return arr.map((raw, i) => {
    const obj = requireObject(raw, `isolationPolicies[${i}]`);
    const id = requireNonEmptyString(obj.id, `isolationPolicies[${i}].id`);
    if (seen.has(id)) {
      fail('duplicate_policy', `Duplicate isolation policy id: ${id}.`);
    }
    seen.add(id);
    return {
      id,
      compartmentId: requireNonEmptyString(
        obj.compartmentId,
        `isolationPolicies[${i}].compartmentId`
      ),
      maxPathLength: requirePositiveInteger(
        obj.maxPathLength,
        `isolationPolicies[${i}].maxPathLength`
      ),
      forbidCrossToolEscalation: requireBoolean(
        obj.forbidCrossToolEscalation,
        `isolationPolicies[${i}].forbidCrossToolEscalation`
      ),
      requireApprovalOnToolChange: requireBoolean(
        obj.requireApprovalOnToolChange,
        `isolationPolicies[${i}].requireApprovalOnToolChange`
      ),
      blockOnHighRiskPath: requireBoolean(
        obj.blockOnHighRiskPath,
        `isolationPolicies[${i}].blockOnHighRiskPath`
      ),
      enabled: requireBoolean(obj.enabled, `isolationPolicies[${i}].enabled`)
    };
  });
}

function validateSandboxPolicies(value: unknown): RuntimeSandboxPolicy[] {
  const arr = requireArray(value, 'sandboxPolicies');
  const seen = new Set<string>();
  return arr.map((raw, i) => {
    const obj = requireObject(raw, `sandboxPolicies[${i}]`);
    const transportKind = requireEnum(
      obj.transportKind,
      TRANSPORT_KINDS,
      `sandboxPolicies[${i}].transportKind`
    );
    if (seen.has(transportKind)) {
      fail(
        'duplicate_policy',
        `Duplicate sandbox policy for transport: ${transportKind}.`
      );
    }
    seen.add(transportKind);
    return {
      transportKind,
      allowNetwork: requireBoolean(
        obj.allowNetwork,
        `sandboxPolicies[${i}].allowNetwork`
      ),
      allowFilesystem: requireBoolean(
        obj.allowFilesystem,
        `sandboxPolicies[${i}].allowFilesystem`
      ),
      allowProcessSpawn: requireBoolean(
        obj.allowProcessSpawn,
        `sandboxPolicies[${i}].allowProcessSpawn`
      ),
      allowBrowser: requireBoolean(
        obj.allowBrowser,
        `sandboxPolicies[${i}].allowBrowser`
      )
    };
  });
}

/**
 * Validate an untrusted value into a typed {@link RuntimeConfig}.
 *
 * Throws {@link RuntimeConfigValidationError} (fail-closed) on the first
 * problem. The returned object is a fresh, normalised structure — it shares no
 * references with the input and contains only the recognised fields.
 */
export function validateRuntimeConfig(value: unknown): RuntimeConfig {
  const obj = requireObject(value, 'config');

  const version = requireFiniteNumber(obj.version, 'version');
  if (!Number.isInteger(version) || version <= 0) {
    fail('invalid_version', 'version must be a positive integer.');
  }

  return {
    version,
    compartments: validateCompartments(obj.compartments),
    firewallPolicies: validateFirewallPolicies(obj.firewallPolicies),
    transportPolicies: validateTransportPolicies(obj.transportPolicies),
    privacyBoundaryRules: validatePrivacyBoundaryRules(obj.privacyBoundaryRules),
    adaptiveDefensePolicies: validateAdaptiveDefensePolicies(
      obj.adaptiveDefensePolicies
    ),
    rateLimitPolicies: validateRateLimitPolicies(obj.rateLimitPolicies),
    trustPolicies: validateTrustPolicies(obj.trustPolicies),
    graphTransitionRules: validateGraphTransitionRules(obj.graphTransitionRules),
    isolationPolicies: validateIsolationPolicies(obj.isolationPolicies),
    sandboxPolicies: validateSandboxPolicies(obj.sandboxPolicies)
  };
}

/**
 * Parse a JSON string into a typed {@link RuntimeConfig}.
 *
 * A malformed JSON text fails with reason `invalid_json`; a well-formed but
 * structurally invalid config fails through {@link validateRuntimeConfig}.
 */
export function parseRuntimeConfig(text: string): RuntimeConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(
      'invalid_json',
      `Config is not valid JSON: ${(error as Error).message}`
    );
  }
  return validateRuntimeConfig(parsed);
}
