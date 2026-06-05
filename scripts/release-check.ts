#!/usr/bin/env tsx
/**
 * GRL Release Check — Sprint 22
 *
 * Pre-release gate that verifies the repository is in a clean, publishable
 * state. Exits 0 on success, 1 on any failure (fail-closed).
 *
 * Checks:
 *  - dist outputs exist for all packages
 *  - package exports are coherent
 *  - required security docs are present
 *  - required distribution docs are present
 *  - examples are present
 *  - no secrets, tokens, or .env files committed
 *  - no forbidden file extensions in root
 *
 * Run: npm run release-check
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function exists(relPath: string): boolean {
  return fs.existsSync(path.join(ROOT, relPath));
}

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function runSuite(name: string, fn: () => CheckResult[]): boolean {
  console.log(`\n── ${name} ──`);
  const results = fn();
  let allOk = true;
  for (const r of results) {
    console.log(`  ${r.message}`);
    if (!r.ok) allOk = false;
  }
  return allOk;
}

// ─── 1. Dist outputs ────────────────────────────────────────────────────────

const DIST_OUTPUTS: Array<{ label: string; path: string }> = [
  { label: '@gyges/core', path: 'packages/core/dist/index.js' },
  { label: '@gyges/core types', path: 'packages/core/dist/index.d.ts' },
  { label: '@gyges/agent-sdk', path: 'packages/agent-sdk/dist/index.js' },
  { label: '@gyges/agent-sdk types', path: 'packages/agent-sdk/dist/index.d.ts' },
  { label: '@gyges/grl-cli', path: 'apps/grl-cli/dist/cli.js' },
  { label: 'grl-server (local-api)', path: 'apps/grl-server/dist/apps/grl-server/src/local-api.js' },
];

function checkDistOutputs(): CheckResult[] {
  return DIST_OUTPUTS.map(({ label, path: p }) =>
    exists(p) ? pass(`${label}: ${p}`) : fail(`${label}: ${p} is missing`)
  );
}

// ─── 2. Package exports coherence ───────────────────────────────────────────

const PACKAGES_WITH_EXPORTS: Array<{
  label: string;
  pkgPath: string;
  distMain: string;
}> = [
  {
    label: '@gyges/core',
    pkgPath: 'packages/core/package.json',
    distMain: 'packages/core/dist/index.js',
  },
  {
    label: '@gyges/agent-sdk',
    pkgPath: 'packages/agent-sdk/package.json',
    distMain: 'packages/agent-sdk/dist/index.js',
  },
  {
    label: '@gyges/grl-cli',
    pkgPath: 'apps/grl-cli/package.json',
    distMain: 'apps/grl-cli/dist/cli.js',
  },
];

function checkPackageExports(): CheckResult[] {
  const results: CheckResult[] = [];

  for (const { label, pkgPath, distMain } of PACKAGES_WITH_EXPORTS) {
    if (!exists(pkgPath)) {
      results.push(fail(`${label}: ${pkgPath} not found`));
      continue;
    }

    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(readFile(pkgPath)) as Record<string, unknown>;
    } catch {
      results.push(fail(`${label}: ${pkgPath} is not valid JSON`));
      continue;
    }

    if (!pkg.name) results.push(fail(`${label}: missing "name" field`));
    else results.push(pass(`${label}: name="${pkg.name}"`));

    if (!pkg.version) results.push(fail(`${label}: missing "version" field`));
    else results.push(pass(`${label}: version="${pkg.version}"`));

    if (!pkg.main) results.push(fail(`${label}: missing "main" field`));
    else results.push(pass(`${label}: main="${pkg.main}"`));

    if (!pkg.types) results.push(fail(`${label}: missing "types" field`));
    else results.push(pass(`${label}: types="${pkg.types}"`));

    if (!pkg.exports) results.push(fail(`${label}: missing "exports" field`));
    else results.push(pass(`${label}: "exports" field present`));

    if (!pkg.files) results.push(fail(`${label}: missing "files" field`));
    else results.push(pass(`${label}: "files" field present`));

    if (!exists(distMain)) {
      results.push(fail(`${label}: dist main "${distMain}" does not exist`));
    } else {
      results.push(pass(`${label}: dist main exists`));
    }
  }

  return results;
}

// ─── 3. Security docs ───────────────────────────────────────────────────────

const REQUIRED_SECURITY_DOCS: string[] = [
  'docs/security/threat-model.md',
  'docs/security/trust-boundaries.md',
  'docs/security/security-assumptions.md',
  'docs/security/defensive-guarantees.md',
  'docs/security/failure-modes.md',
  'docs/security/attack-surfaces.md',
  'docs/security/incident-response.md',
  'docs/security/privacy-model.md',
];

function checkSecurityDocs(): CheckResult[] {
  return REQUIRED_SECURITY_DOCS.map((doc) =>
    exists(doc) ? pass(`${doc} exists`) : fail(`${doc} MISSING`)
  );
}

// ─── 4. Distribution docs ────────────────────────────────────────────────────

const REQUIRED_DOCS: string[] = [
  'docs/installation.md',
  'docs/quickstart.md',
  'docs/packaging.md',
  'docs/distribution.md',
  'README.md',
];

function checkDistributionDocs(): CheckResult[] {
  return REQUIRED_DOCS.map((doc) =>
    exists(doc) ? pass(`${doc} exists`) : fail(`${doc} MISSING`)
  );
}

// ─── 5. Examples present ────────────────────────────────────────────────────

const REQUIRED_EXAMPLES: string[] = [
  'examples/quickstart/local-runtime.sh',
  'examples/quickstart/cli-demo.sh',
  'examples/quickstart/sdk-demo.ts',
];

function checkExamples(): CheckResult[] {
  return REQUIRED_EXAMPLES.map((ex) =>
    exists(ex) ? pass(`${ex} exists`) : fail(`${ex} MISSING`)
  );
}

// ─── 6. No secrets / .env files ─────────────────────────────────────────────

const FORBIDDEN_FILES: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^\.env$/, reason: '.env file at root' },
  { pattern: /^\.env\.local$/, reason: '.env.local file at root' },
  { pattern: /^\.env\.production$/, reason: '.env.production file at root' },
  { pattern: /^\.env\.staging$/, reason: '.env.staging file at root' },
  { pattern: /^secrets\.json$/, reason: 'secrets.json at root' },
  { pattern: /^credentials\.json$/, reason: 'credentials.json at root' },
  { pattern: /^id_rsa$/, reason: 'id_rsa private key at root' },
  { pattern: /^.*\.pem$/, reason: '.pem file at root' },
  { pattern: /^.*\.key$/, reason: '.key file at root' },
];

const FORBIDDEN_CONTENT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, reason: 'Private key material' },
  { pattern: /ghp_[a-zA-Z0-9]{36}/, reason: 'GitHub personal access token' },
  { pattern: /sk-[a-zA-Z0-9]{48}/, reason: 'OpenAI API key' },
  { pattern: /AKIA[0-9A-Z]{16}/, reason: 'AWS access key' },
];

function checkNoSecretFiles(): CheckResult[] {
  const results: CheckResult[] = [];
  const rootFiles = fs.readdirSync(ROOT);

  for (const f of rootFiles) {
    for (const { pattern, reason } of FORBIDDEN_FILES) {
      if (pattern.test(f)) {
        results.push(fail(`Forbidden file at root: ${f} (${reason})`));
      }
    }
  }

  if (results.length === 0) {
    results.push(pass('No forbidden files found at root'));
  }

  return results;
}

function checkNoSecretContent(): CheckResult[] {
  const results: CheckResult[] = [];
  const filesToScan = [
    'package.json',
    'vitest.config.ts',
    'tsconfig.base.json',
  ];

  for (const f of filesToScan) {
    if (!exists(f)) continue;
    const content = readFile(f);
    for (const { pattern, reason } of FORBIDDEN_CONTENT_PATTERNS) {
      if (pattern.test(content)) {
        results.push(fail(`Forbidden content in ${f}: ${reason}`));
      }
    }
  }

  if (results.length === 0) {
    results.push(pass('No secret content found in scanned files'));
  }

  return results;
}

// ─── 7. CI workflows ────────────────────────────────────────────────────────

const REQUIRED_WORKFLOWS: string[] = [
  '.github/workflows/ci.yml',
  '.github/workflows/release-check.yml',
];

function checkCiWorkflows(): CheckResult[] {
  return REQUIRED_WORKFLOWS.map((wf) =>
    exists(wf) ? pass(`${wf} exists`) : fail(`${wf} MISSING`)
  );
}

// ─── Runner ─────────────────────────────────────────────────────────────────

function main(): void {
  console.log('GRL Release Check — Sprint 22\n');

  const suites: Array<[string, () => CheckResult[]]> = [
    ['Dist outputs', checkDistOutputs],
    ['Package exports coherence', checkPackageExports],
    ['Security docs', checkSecurityDocs],
    ['Distribution docs', checkDistributionDocs],
    ['Examples', checkExamples],
    ['No forbidden files at root', checkNoSecretFiles],
    ['No secret content in config files', checkNoSecretContent],
    ['CI workflows', checkCiWorkflows],
  ];

  let allPassed = true;
  for (const [name, fn] of suites) {
    const ok = runSuite(name, fn);
    if (!ok) allPassed = false;
  }

  console.log('\n' + '─'.repeat(60));
  if (allPassed) {
    console.log('✓ Release check passed. Ready for packaging.');
    process.exit(0);
  } else {
    console.log('✗ Release check FAILED. Fix the issues above before releasing.');
    process.exit(1);
  }
}

main();
