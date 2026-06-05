/**
 * JSON output formatter for GRL CLI.
 *
 * Produces deterministic, machine-readable JSON output with no extra wrapper.
 */

/** Print a value as indented JSON to stdout. */
export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}
