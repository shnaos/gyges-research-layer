/**
 * SearXNG Transport Adapter — public barrel exports.
 */

export type {
  SearXngTransportConfig,
  SearXngSearchRequest,
  SearXngSearchResult,
  SearXngSearchResponse
} from './types.js';

export {
  isValidBaseUrl,
  validateSearXngConfig,
  DEFAULT_SEARXNG_CONFIG,
  SearXngConfigError
} from './config.js';
export type { SearXngConfigValidationReason } from './config.js';

export { parseSearXngResponse } from './parser.js';

export { SearXngTransportAdapter, buildSearXngAdapter } from './adapter.js';
