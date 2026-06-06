/**
 * Default HeaderIsolationPolicy and helper functions.
 */

import type { HeaderIsolationPolicy } from './types.js';

export const DEFAULT_HEADER_ISOLATION_POLICY: HeaderIsolationPolicy = {
  enabled: true,
  rotateOnPersonaChange: true,
  rotateOnTemporalEscalation: false,
  maxRequestsPerFingerprint: 50,
  strictSensitiveCategoryIsolation: true
};

/**
 * Classify the correlation risk based on request count and rotation state.
 */
export function classifyFingerprintRisk(
  requestCount: number,
  maxRequestsPerFingerprint: number
): 'low' | 'medium' | 'high' | 'critical' {
  const saturation = requestCount / maxRequestsPerFingerprint;
  if (saturation >= 1.0) return 'critical';
  if (saturation >= 0.75) return 'high';
  if (saturation >= 0.4) return 'medium';
  return 'low';
}
