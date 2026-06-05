/**
 * Approval helper re-exports.
 *
 * The approval flow is fully delegated to {@link GrlAgentClient}. This module
 * exists as a named entry point so consumers can import approval-related
 * helpers from a dedicated module path.
 *
 * No token, secret, or raw input is stored or logged by this module.
 */

export { isAllowed, isDenied, isPending } from './search.js';
