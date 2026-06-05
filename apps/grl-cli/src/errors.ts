/**
 * Structured CLI error types for GRL CLI.
 *
 * Messages are human-readable; stack traces are suppressed by default.
 * Exit codes are deterministic and consistent.
 */

export type CliErrorCode =
  | 'runtime_unreachable'
  | 'request_timeout'
  | 'invalid_response'
  | 'invalid_arguments'
  | 'command_failed';

/** Exit codes for each error category. */
export const CLI_EXIT_CODES: Record<CliErrorCode, number> = {
  runtime_unreachable: 2,
  request_timeout: 3,
  invalid_response: 4,
  invalid_arguments: 1,
  command_failed: 5
};

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly exitCode: number;

  constructor(code: CliErrorCode, message: string) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.exitCode = CLI_EXIT_CODES[code];
  }
}
