/**
 * Structured error type for the @gyges/agent-sdk.
 *
 * Stack traces are suppressed from the default `message` to avoid leaking
 * internal paths. No token, secret, or raw query is ever stored in error state.
 */

export type GrlAgentSdkErrorCode =
  | 'runtime_unreachable'
  | 'request_timeout'
  | 'invalid_response'
  | 'invalid_arguments'
  | 'capability_failed';

export class GrlAgentSdkError extends Error {
  readonly code: GrlAgentSdkErrorCode;

  constructor(code: GrlAgentSdkErrorCode, message: string) {
    super(message);
    this.name = 'GrlAgentSdkError';
    this.code = code;
    // Suppress stack trace from default serialisation to avoid leaking paths.
    this.stack = undefined;
  }
}
