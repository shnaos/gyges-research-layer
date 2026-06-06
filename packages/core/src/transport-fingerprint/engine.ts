/**
 * TransportFingerprintEngine — Sprint 27 core engine.
 *
 * Manages per-agent transport fingerprint profiles. Produces
 * FingerprintIsolationDecisions and maintains assigned header/UA/language sets.
 *
 * Design constraints:
 *  - deterministic, in-memory only
 *  - no AI / NLP / ML
 *  - no external entropy
 *  - no cloud sync, no persistence, no browser, no network
 *  - fail-closed
 *  - defensive copies at every public boundary
 *  - does NOT guarantee anonymity or prevent advanced fingerprinting
 */

import { randomUUID } from 'node:crypto';
import type {
  FingerprintProfile,
  HeaderProfile,
  AssignFingerprintInput,
  EvaluateFingerprintInput,
  FingerprintIsolationDecision,
  HeaderIsolationPolicy,
  TransportFingerprintEngineOptions
} from './types.js';
import { DEFAULT_HEADER_ISOLATION_POLICY, classifyFingerprintRisk } from './policy.js';
import { HeaderRandomizationEngine } from './headers.js';
import { UserAgentIsolationEngine } from './user-agent.js';
import { LanguageIsolationEngine } from './language.js';

function cloneProfile(p: FingerprintProfile): FingerprintProfile {
  return {
    agentId: p.agentId,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    activeFingerprintId: p.activeFingerprintId,
    rotationCount: p.rotationCount,
    requestCount: p.requestCount,
    correlationRisk: p.correlationRisk,
    assignedHeaders: { ...p.assignedHeaders },
    assignedUserAgent: p.assignedUserAgent,
    assignedLanguage: p.assignedLanguage
  };
}

function cloneHeaderProfile(p: HeaderProfile): HeaderProfile {
  return {
    id: p.id,
    userAgent: p.userAgent,
    acceptLanguage: p.acceptLanguage,
    headers: { ...p.headers },
    createdAt: p.createdAt,
    active: p.active
  };
}

export class TransportFingerprintEngine {
  private readonly now: () => number;
  private readonly generateId: () => string;
  private readonly policy: HeaderIsolationPolicy;
  private readonly profiles = new Map<string, FingerprintProfile>();
  /** Track per-agent header profiles (history). */
  private readonly headerProfiles = new Map<string, HeaderProfile[]>();

  readonly headerEngine: HeaderRandomizationEngine;
  readonly userAgentEngine: UserAgentIsolationEngine;
  readonly languageEngine: LanguageIsolationEngine;

  constructor(options: TransportFingerprintEngineOptions = {}) {
    this.now = options.now ?? Date.now;
    this.generateId = options.generateId ?? randomUUID;
    this.policy = {
      ...DEFAULT_HEADER_ISOLATION_POLICY,
      ...(options.policy ?? {})
    };
    this.headerEngine = new HeaderRandomizationEngine();
    this.userAgentEngine = new UserAgentIsolationEngine();
    this.languageEngine = new LanguageIsolationEngine();
  }

  /**
   * Get or create the fingerprint profile for an agent.
   * Returns a defensive copy.
   */
  getOrCreateProfile(agentId: string): FingerprintProfile {
    return cloneProfile(this.ensureProfile(agentId));
  }

  /**
   * Get the fingerprint profile for an agent if it exists.
   * Returns a defensive copy or undefined.
   */
  getProfile(agentId: string): FingerprintProfile | undefined {
    const p = this.profiles.get(agentId);
    return p ? cloneProfile(p) : undefined;
  }

  /**
   * List all fingerprint profiles (defensive copies).
   */
  listProfiles(): FingerprintProfile[] {
    return [...this.profiles.values()].map(cloneProfile);
  }

  /**
   * Evaluate whether fingerprint isolation/rotation is required.
   * Pure read — does NOT mutate state.
   */
  evaluateIsolation(input: EvaluateFingerprintInput): FingerprintIsolationDecision {
    if (!this.policy.enabled) {
      return {
        requiresRotation: false,
        requiresHeaderIsolation: false,
        requiresLanguageIsolation: false,
        requiresUserAgentIsolation: false,
        correlationRisk: 'low',
        reason: 'fingerprint_isolation_disabled'
      };
    }

    const profile = this.ensureProfile(input.agentId);
    const risk = classifyFingerprintRisk(profile.requestCount, this.policy.maxRequestsPerFingerprint);

    const saturated = profile.requestCount >= this.policy.maxRequestsPerFingerprint;
    const personaRotation = !!(input.personaChanged && this.policy.rotateOnPersonaChange);
    const temporalRotation = !!(input.temporalEscalation && this.policy.rotateOnTemporalEscalation);
    const sensitiveRotation = !!(input.sensitiveCategoryDetected && this.policy.strictSensitiveCategoryIsolation);

    const requiresRotation = saturated || personaRotation || temporalRotation || sensitiveRotation;
    const requiresHeaderIsolation = requiresRotation || risk === 'high' || risk === 'critical';
    const requiresLanguageIsolation = requiresRotation;
    const requiresUserAgentIsolation = requiresRotation;

    let reason: string;
    if (saturated) {
      reason = 'fingerprint_saturated';
    } else if (personaRotation) {
      reason = 'persona_changed';
    } else if (sensitiveRotation) {
      reason = 'sensitive_category_detected';
    } else if (temporalRotation) {
      reason = 'temporal_escalation';
    } else if (requiresHeaderIsolation) {
      reason = 'high_correlation_risk';
    } else {
      reason = 'no_rotation_needed';
    }

    return {
      requiresRotation,
      requiresHeaderIsolation,
      requiresLanguageIsolation,
      requiresUserAgentIsolation,
      correlationRisk: risk,
      reason
    };
  }

  /**
   * Rotate the fingerprint for an agent.
   * Increments the rotation counter and re-assigns UA/language/headers.
   * Returns the updated profile (defensive copy).
   */
  rotateFingerprint(agentId: string, timestamp?: number): FingerprintProfile {
    const at = timestamp ?? this.now();
    const profile = this.ensureProfile(agentId);

    profile.rotationCount++;
    profile.requestCount = 0;
    profile.activeFingerprintId = this.generateId();
    profile.correlationRisk = 'low';

    // Deactivate previous header profile.
    this.deactivateHeaderProfiles(agentId);

    // Assign new fingerprint.
    this.assignFingerprintToProfile(profile, at);

    return cloneProfile(profile);
  }

  /**
   * Assign or refresh the fingerprint for an agent, rotating if required.
   * Records a request use against the active fingerprint.
   * Returns the updated profile (defensive copy).
   */
  assignFingerprint(input: AssignFingerprintInput): FingerprintProfile {
    const at = input.timestamp ?? this.now();
    const profile = this.ensureProfile(input.agentId);

    if (input.forceRotation || profile.requestCount >= this.policy.maxRequestsPerFingerprint) {
      return this.rotateFingerprint(input.agentId, at);
    }

    // Increment usage counter.
    profile.requestCount++;
    profile.updatedAt = at;
    profile.correlationRisk = classifyFingerprintRisk(
      profile.requestCount,
      this.policy.maxRequestsPerFingerprint
    );

    return cloneProfile(profile);
  }

  /**
   * List all header profiles, optionally filtered to an agent.
   */
  listHeaderProfiles(agentId?: string): HeaderProfile[] {
    if (agentId !== undefined) {
      return (this.headerProfiles.get(agentId) ?? []).map(cloneHeaderProfile);
    }
    const all: HeaderProfile[] = [];
    for (const profiles of this.headerProfiles.values()) {
      for (const p of profiles) {
        all.push(cloneHeaderProfile(p));
      }
    }
    return all;
  }

  /**
   * Get the active header profile for an agent, if any.
   */
  getActiveHeaderProfile(agentId: string): HeaderProfile | undefined {
    const profiles = this.headerProfiles.get(agentId) ?? [];
    const active = profiles.find((p) => p.active);
    return active ? cloneHeaderProfile(active) : undefined;
  }

  /**
   * Return the current HeaderIsolationPolicy (defensive copy).
   */
  getPolicy(): HeaderIsolationPolicy {
    return { ...this.policy };
  }

  /**
   * Clear all profiles and header profiles.
   */
  clear(): void {
    this.profiles.clear();
    this.headerProfiles.clear();
  }

  private ensureProfile(agentId: string): FingerprintProfile {
    if (!this.profiles.has(agentId)) {
      const at = this.now();
      const fingerprintId = this.generateId();
      const rotationCount = 0;

      const ua = this.userAgentEngine.selectUserAgent(rotationCount);
      const lang = this.languageEngine.selectLanguage(rotationCount);
      const headers = this.headerEngine.selectHeaders(rotationCount, ua, lang);

      const profile: FingerprintProfile = {
        agentId,
        createdAt: at,
        updatedAt: at,
        activeFingerprintId: fingerprintId,
        rotationCount,
        requestCount: 0,
        correlationRisk: 'low',
        assignedHeaders: headers,
        assignedUserAgent: ua,
        assignedLanguage: lang
      };
      this.profiles.set(agentId, profile);

      // Create initial header profile.
      this.createHeaderProfile(agentId, fingerprintId, ua, lang, headers, at);
    }
    return this.profiles.get(agentId)!;
  }

  private assignFingerprintToProfile(profile: FingerprintProfile, at: number): void {
    const ua = this.userAgentEngine.selectUserAgent(profile.rotationCount);
    const lang = this.languageEngine.selectLanguage(profile.rotationCount);
    const headers = this.headerEngine.selectHeaders(profile.rotationCount, ua, lang);

    profile.assignedUserAgent = ua;
    profile.assignedLanguage = lang;
    profile.assignedHeaders = headers;
    profile.updatedAt = at;

    this.createHeaderProfile(
      profile.agentId,
      profile.activeFingerprintId,
      ua,
      lang,
      headers,
      at
    );
  }

  private createHeaderProfile(
    agentId: string,
    id: string,
    userAgent: string,
    acceptLanguage: string,
    headers: Record<string, string>,
    createdAt: number
  ): void {
    if (!this.headerProfiles.has(agentId)) {
      this.headerProfiles.set(agentId, []);
    }
    const list = this.headerProfiles.get(agentId)!;
    list.push({
      id,
      userAgent,
      acceptLanguage,
      headers: { ...headers },
      createdAt,
      active: true
    });
  }

  private deactivateHeaderProfiles(agentId: string): void {
    const profiles = this.headerProfiles.get(agentId);
    if (profiles) {
      for (const p of profiles) {
        p.active = false;
      }
    }
  }
}
