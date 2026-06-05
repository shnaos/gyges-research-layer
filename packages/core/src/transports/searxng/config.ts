/**
 * SearXNG Transport Adapter — configuration validation.
 *
 * The validator is strict and fail-closed: any missing, malformed, or
 * out-of-range field causes an error rather than a silent default. The adapter
 * never runs on a half-understood config.
 *
 * baseUrl constraints (local-only by default):
 *   - must be a non-empty string
 *   - must be a valid URL
 *   - scheme must be http or https
 *   - host must be 127.0.0.1, localhost, or ::1 (explicit loopback only)
 *   - no credentials (username/password) in the URL
 */

import type { SearXngTransportConfig } from './types.js';

/** Default loopback port for a locally-run SearXNG instance. */
const DEFAULT_SEARXNG_PORT = 8080;

/** Default request timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 5000;

/** Default maximum number of results per search. */
const DEFAULT_MAX_RESULTS = 10;

/** Closed set of allowed loopback hostnames. */
const ALLOWED_LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Returns true if baseUrl is a valid, loopback-only HTTP/HTTPS URL with no
 * embedded credentials.
 *
 * This is the security boundary for local-only SearXNG. Fail-closed: any
 * non-loopback URL is rejected even when the adapter is explicitly enabled.
 */
export function isValidBaseUrl(baseUrl: unknown): baseUrl is string {
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return false;
  }
  // Only http or https.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  // No embedded credentials.
  if (parsed.username || parsed.password) {
    return false;
  }
  // Loopback only.
  if (!ALLOWED_LOOPBACK_HOSTS.has(parsed.hostname)) {
    return false;
  }
  return true;
}

/** Reason a SearXNG config validation failed. */
export type SearXngConfigValidationReason =
  | 'disabled'
  | 'invalid_base_url'
  | 'invalid_timeout'
  | 'invalid_max_results';

/** Error thrown when a {@link SearXngTransportConfig} is invalid. */
export class SearXngConfigError extends Error {
  readonly reason: SearXngConfigValidationReason;

  constructor(reason: SearXngConfigValidationReason, message: string) {
    super(message);
    this.name = 'SearXngConfigError';
    this.reason = reason;
    Object.setPrototypeOf(this, SearXngConfigError.prototype);
  }
}

/**
 * Validate a {@link SearXngTransportConfig} and return it if valid.
 *
 * Throws {@link SearXngConfigError} for any invalid field. Fail-closed: a
 * disabled config throws with reason `disabled` so callers can distinguish a
 * deliberate "off" from a malformed config.
 */
export function validateSearXngConfig(
  config: SearXngTransportConfig
): SearXngTransportConfig {
  if (!config.enabled) {
    throw new SearXngConfigError('disabled', 'SearXNG transport is disabled.');
  }
  if (!isValidBaseUrl(config.baseUrl)) {
    throw new SearXngConfigError(
      'invalid_base_url',
      `SearXNG baseUrl is invalid or non-loopback: "${config.baseUrl}". ` +
        'Only http(s)://127.0.0.1, localhost, or ::1 are allowed.'
    );
  }
  if (
    typeof config.timeoutMs !== 'number' ||
    !Number.isFinite(config.timeoutMs) ||
    config.timeoutMs <= 0
  ) {
    throw new SearXngConfigError(
      'invalid_timeout',
      'SearXNG timeoutMs must be a positive finite number.'
    );
  }
  if (
    typeof config.maxResults !== 'number' ||
    !Number.isInteger(config.maxResults) ||
    config.maxResults < 1
  ) {
    throw new SearXngConfigError(
      'invalid_max_results',
      'SearXNG maxResults must be a positive integer.'
    );
  }
  return config;
}

/**
 * Default SearXNG transport config — disabled by default, local-only endpoint.
 *
 * No network access is enabled without explicit runtime config setting
 * `enabled: true`.
 */
export const DEFAULT_SEARXNG_CONFIG: SearXngTransportConfig = {
  baseUrl: `http://127.0.0.1:${DEFAULT_SEARXNG_PORT}`,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxResults: DEFAULT_MAX_RESULTS,
  enabled: false
};
