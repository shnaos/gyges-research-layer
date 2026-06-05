import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * GRL CLI runtime configuration.
 *
 * Loaded from (in order of precedence):
 *   1. Environment variables
 *   2. Local .grl-cli.json file
 *   3. Hardcoded defaults
 *
 * No remote config. No cloud. No auth. No telemetry.
 */
export interface GrlCliConfig {
  baseUrl: string;
  timeoutMs: number;
  output: 'table' | 'json';
}

export const DEFAULT_CLI_CONFIG: GrlCliConfig = {
  baseUrl: 'http://127.0.0.1:8787',
  timeoutMs: 5000,
  output: 'table'
};

const CONFIG_FILE_NAME = '.grl-cli.json';

function loadFileConfig(): Partial<GrlCliConfig> {
  try {
    const path = resolve(process.cwd(), CONFIG_FILE_NAME);
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const partial: Partial<GrlCliConfig> = {};
    if (typeof parsed.baseUrl === 'string') partial.baseUrl = parsed.baseUrl;
    if (typeof parsed.timeoutMs === 'number') partial.timeoutMs = parsed.timeoutMs;
    if (parsed.output === 'table' || parsed.output === 'json') {
      partial.output = parsed.output;
    }
    return partial;
  } catch {
    return {};
  }
}

function loadEnvConfig(): Partial<GrlCliConfig> {
  const partial: Partial<GrlCliConfig> = {};

  const rawUrl = process.env['GRL_CLI_BASE_URL'];
  if (rawUrl) partial.baseUrl = rawUrl;

  const rawTimeout = process.env['GRL_CLI_TIMEOUT_MS'];
  if (rawTimeout) {
    const parsed = Number(rawTimeout);
    if (Number.isFinite(parsed) && parsed > 0) partial.timeoutMs = parsed;
  }

  const rawOutput = process.env['GRL_CLI_OUTPUT'];
  if (rawOutput === 'table' || rawOutput === 'json') {
    partial.output = rawOutput;
  }

  return partial;
}

/**
 * Resolve the active GRL CLI configuration.
 * CLI flags (passed as overrides) take highest precedence.
 */
export function resolveCliConfig(
  overrides: Partial<GrlCliConfig> = {}
): GrlCliConfig {
  const fileConfig = loadFileConfig();
  const envConfig = loadEnvConfig();
  return {
    ...DEFAULT_CLI_CONFIG,
    ...fileConfig,
    ...envConfig,
    ...overrides
  };
}
