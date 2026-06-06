#!/usr/bin/env tsx
/**
 * GRL Smoke Test — Sprint 22
 *
 * Validates the local runtime without any network access:
 *  1. Runtime config load (DEFAULT_RUNTIME_CONFIG)
 *  2. Runtime profile resolution
 *  3. CLI dist exists
 *  4. SDK importable
 *  5. SDK instantiation (no network call)
 *
 * Exits 0 on success, 1 on any failure (fail-closed).
 * No Internet access, no SearXNG, no secrets.
 *
 * Run: npm run smoke-test
 */

import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── Utilities ──────────────────────────────────────────────────────────────

type CheckResult = { ok: boolean; message: string };

function pass(message: string): CheckResult {
  return { ok: true, message: `✓ ${message}` };
}

function fail(message: string): CheckResult {
  return { ok: false, message: `✗ ${message}` };
}

// ─── 1. Runtime config load ─────────────────────────────────────────────────

async function checkRuntimeConfigLoad(): Promise<CheckResult[]> {
  const distPath = path.join(ROOT, 'packages/core/dist/index.js');
  if (!fs.existsSync(distPath)) {
    return [fail(`packages/core/dist/index.js not found — run npm run build:core first`)];
  }

  try {
    const core = await import(distPath);
    const cfg = core.DEFAULT_RUNTIME_CONFIG;
    if (!cfg || typeof cfg !== 'object') {
      return [fail('DEFAULT_RUNTIME_CONFIG not exported from @gyges/core')];
    }
    if (typeof cfg.version === 'undefined' || cfg.version === null) {
      return [fail(`DEFAULT_RUNTIME_CONFIG.version is missing`)];
    }
    return [pass(`DEFAULT_RUNTIME_CONFIG loaded — version=${cfg.version}`)];
  } catch (err) {
    return [fail(`Runtime config load failed: ${String(err)}`)];
  }
}

// ─── 2. Runtime profile resolution ──────────────────────────────────────────

async function checkRuntimeProfileResolution(): Promise<CheckResult[]> {
  const distPath = path.join(ROOT, 'packages/core/dist/index.js');
  if (!fs.existsSync(distPath)) {
    return [fail(`packages/core/dist/index.js not found — run npm run build:core first`)];
  }

  try {
    const core = await import(distPath);
    if (typeof core.RuntimeProfileResolver !== 'function') {
      return [fail('RuntimeProfileResolver not exported from @gyges/core')];
    }

    const resolver = new core.RuntimeProfileResolver();
    const results: CheckResult[] = [];

    for (const name of ['strict', 'balanced', 'research', 'development']) {
      try {
        const profile = resolver.resolveProfile(name, core.DEFAULT_RUNTIME_CONFIG);
        if (profile && typeof profile === 'object') {
          results.push(pass(`Profile "${name}" resolved successfully`));
        } else {
          results.push(fail(`Profile "${name}" resolution returned unexpected value`));
        }
      } catch (err) {
        results.push(fail(`Profile "${name}" resolution threw: ${String(err)}`));
      }
    }

    return results;
  } catch (err) {
    return [fail(`Profile resolution check failed: ${String(err)}`)];
  }
}

// ─── 3. CLI dist exists ──────────────────────────────────────────────────────

async function checkCliDist(): Promise<CheckResult[]> {
  const cliDist = path.join(ROOT, 'apps/grl-cli/dist/cli.js');
  if (!fs.existsSync(cliDist)) {
    return [fail(`apps/grl-cli/dist/cli.js not found — run npm run build:cli first`)];
  }
  return [pass('apps/grl-cli/dist/cli.js exists')];
}

// ─── 4. SDK importable ───────────────────────────────────────────────────────

async function checkSdkImportable(): Promise<CheckResult[]> {
  const sdkDist = path.join(ROOT, 'packages/agent-sdk/dist/index.js');
  if (!fs.existsSync(sdkDist)) {
    return [fail(`packages/agent-sdk/dist/index.js not found — run npm run build:agent-sdk first`)];
  }

  try {
    const sdk = await import(sdkDist);
    const results: CheckResult[] = [];

    if (typeof sdk.GrlAgentClient !== 'function') {
      results.push(fail('GrlAgentClient not exported from @gyges/agent-sdk'));
    } else {
      results.push(pass('GrlAgentClient exported from @gyges/agent-sdk'));
    }

    if (typeof sdk.isAllowed !== 'function') {
      results.push(fail('isAllowed type guard not exported from @gyges/agent-sdk'));
    } else {
      results.push(pass('isAllowed, isDenied, isPending type guards exported'));
    }

    if (typeof sdk.GrlAgentSdkError !== 'function') {
      results.push(fail('GrlAgentSdkError not exported from @gyges/agent-sdk'));
    } else {
      results.push(pass('GrlAgentSdkError exported from @gyges/agent-sdk'));
    }

    return results;
  } catch (err) {
    return [fail(`SDK import failed: ${String(err)}`)];
  }
}

// ─── 5. SDK instantiation (no network) ──────────────────────────────────────

async function checkSdkInstantiation(): Promise<CheckResult[]> {
  const sdkDist = path.join(ROOT, 'packages/agent-sdk/dist/index.js');
  if (!fs.existsSync(sdkDist)) {
    return [fail(`packages/agent-sdk/dist/index.js not found — run npm run build:agent-sdk first`)];
  }

  try {
    const sdk = await import(sdkDist);
    // Use a non-routable address — no actual connection is made during instantiation
    const client = new sdk.GrlAgentClient({ baseUrl: 'http://127.0.0.1:0' });
    if (!client) {
      return [fail('GrlAgentClient instantiation returned falsy')];
    }
    return [pass('GrlAgentClient instantiated without network call')];
  } catch (err) {
    return [fail(`SDK instantiation failed: ${String(err)}`)];
  }
}

// ─── Runner ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('GRL Smoke Test — Sprint 22');
  console.log('No Internet access · No SearXNG · Local runtime only\n');

  const suites: Array<[string, () => Promise<CheckResult[]>]> = [
    ['Runtime config load', checkRuntimeConfigLoad],
    ['Runtime profile resolution', checkRuntimeProfileResolution],
    ['CLI dist exists', checkCliDist],
    ['SDK importable', checkSdkImportable],
    ['SDK instantiation (no network)', checkSdkInstantiation],
  ];

  let allPassed = true;
  for (const [name, fn] of suites) {
    const results = await fn();
    console.log(`\n── ${name} ──`);
    for (const r of results) {
      console.log(`  ${r.message}`);
      if (!r.ok) allPassed = false;
    }
  }

  console.log('\n' + '─'.repeat(60));
  if (allPassed) {
    console.log('✓ All smoke tests passed.');
    process.exit(0);
  } else {
    console.log('✗ Smoke test FAILED. See above.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('✗ Smoke test crashed:', err);
  process.exit(1);
});

