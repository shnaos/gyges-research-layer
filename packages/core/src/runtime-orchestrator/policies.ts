/**
 * Bootstrap CompositePrivacyPolicy for the RuntimePolicyOrchestrator.
 *
 * This is the default policy shipped with GRL. It is purely declarative and
 * performs no network, persistence, AI/ML, or browser work.
 *
 * Precedence (descending priority, first = most authoritative):
 *   capability_firewall > sandbox > trust_reputation > adaptive_defense >
 *   privacy_boundary > capability_graph > multi_agent > transport_policy >
 *   transport_fingerprint > persona_isolation > temporal_obfuscation >
 *   behavioral_privacy
 */

import type { CompositePrivacyPolicy } from './types.js';

export const DEFAULT_COMPOSITE_PRIVACY_POLICY: CompositePrivacyPolicy = {
  id: 'default-composite-privacy-policy',
  enabled: true,
  precedence: [
    'capability_firewall',
    'sandbox',
    'trust_reputation',
    'adaptive_defense',
    'privacy_boundary',
    'network_isolation',
    'capability_graph',
    'multi_agent',
    'transport_policy',
    'transport_fingerprint',
    'persona_isolation',
    'temporal_obfuscation',
    'behavioral_privacy'
  ],
  defaultAction: 'allow',
  failClosed: true,
  mergeStrategy: 'most_restrictive'
} as const;
