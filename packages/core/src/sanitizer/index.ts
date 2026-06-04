/**
 * Sanitizer MVP.
 *
 * Intentionally minimal and deterministic:
 *   - trims strings
 *   - strips dangerous control characters
 *   - enforces a configurable maximum string length
 *   - rejects payloads that exceed a configurable maximum size
 *
 * There is deliberately NO AI logic and NO semantic classification here. The
 * sanitizer only performs structural, side-effect-free normalisation.
 */

export interface SanitizerOptions {
  /** Maximum allowed length for any single string value. */
  maxStringLength: number;
  /** Maximum allowed size, in UTF-8 bytes, of the whole serialized payload. */
  maxPayloadBytes: number;
}

export const DEFAULT_SANITIZER_OPTIONS: SanitizerOptions = {
  maxStringLength: 4_096,
  maxPayloadBytes: 64 * 1024
};

export type SanitizeResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: string };

/**
 * Control characters considered dangerous. We keep the common whitespace
 * characters tab (\t), line feed (\n) and carriage return (\r); everything
 * else in the C0/C1 control ranges (plus DEL) is removed.
 */
const DANGEROUS_CONTROL_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

function stripControlChars(value: string): string {
  return value.replace(DANGEROUS_CONTROL_CHARS, '');
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function sanitizeNode(
  value: unknown,
  options: SanitizerOptions
): SanitizeResult {
  if (typeof value === 'string') {
    const cleaned = stripControlChars(value).trim();
    if (cleaned.length > options.maxStringLength) {
      return { ok: false, reason: 'String exceeds maximum allowed length.' };
    }
    return { ok: true, value: cleaned };
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return { ok: false, reason: 'Numeric value is not finite.' };
    }
    return { ok: true, value };
  }

  if (typeof value === 'boolean' || value === null) {
    return { ok: true, value };
  }

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const result = sanitizeNode(item, options);
      if (!result.ok) {
        return result;
      }
      out.push(result.value);
    }
    return { ok: true, value: out };
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const result = sanitizeNode(item, options);
      if (!result.ok) {
        return result;
      }
      out[key] = result.value;
    }
    return { ok: true, value: out };
  }

  // undefined, functions, symbols, bigint, etc. are not valid capability input.
  return { ok: false, reason: 'Unsupported input type.' };
}

/**
 * Sanitize an arbitrary capability input. Returns the cleaned value on success
 * or a rejection with a deterministic reason. The original input is never
 * mutated.
 */
export function sanitizeInput(
  input: unknown,
  options: SanitizerOptions = DEFAULT_SANITIZER_OPTIONS
): SanitizeResult {
  if (input === undefined) {
    return { ok: false, reason: 'Input is undefined.' };
  }

  // Reject oversized payloads before doing any per-node work.
  let serialized: string;
  try {
    serialized = JSON.stringify(input);
  } catch {
    return { ok: false, reason: 'Input is not serializable.' };
  }
  if (serialized === undefined) {
    return { ok: false, reason: 'Input is not serializable.' };
  }
  if (byteLength(serialized) > options.maxPayloadBytes) {
    return { ok: false, reason: 'Payload exceeds maximum allowed size.' };
  }

  return sanitizeNode(input, options);
}
