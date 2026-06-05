#!/usr/bin/env tsx
/**
 * GRL Package Export Validator — Sprint 22
 *
 * Validates that all GRL packages have correct exports, dist files,
 * type definitions, and bin paths. Exits 0 on success, 1 on failure.
 *
 * Run: npm run validate:exports
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

function readJson(relPath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
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

// ─── Package definitions ────────────────────────────────────────────────────

interface PackageDef {
  label: string;
  pkgPath: string;
  expectedExports: string[];
  expectedDist: string[];
  expectedTypes: string[];
  binPaths?: string[];
}

const PACKAGES: PackageDef[] = [
  {
    label: '@gyges/core',
    pkgPath: 'packages/core/package.json',
    expectedExports: ['.'],
    expectedDist: [
      'packages/core/dist/index.js',
      'packages/core/dist/index.d.ts',
    ],
    expectedTypes: ['packages/core/dist/index.d.ts'],
  },
  {
    label: '@gyges/agent-sdk',
    pkgPath: 'packages/agent-sdk/package.json',
    expectedExports: ['.'],
    expectedDist: [
      'packages/agent-sdk/dist/index.js',
      'packages/agent-sdk/dist/index.d.ts',
    ],
    expectedTypes: ['packages/agent-sdk/dist/index.d.ts'],
  },
  {
    label: '@gyges/grl-cli',
    pkgPath: 'apps/grl-cli/package.json',
    expectedExports: ['.'],
    expectedDist: ['apps/grl-cli/dist/cli.js'],
    expectedTypes: [],
    binPaths: ['apps/grl-cli/dist/cli.js'],
  },
];

// ─── Check: package.json fields ─────────────────────────────────────────────

function checkPackageFields(def: PackageDef): CheckResult[] {
  const results: CheckResult[] = [];
  const pkg = readJson(def.pkgPath);

  if (!pkg) {
    return [fail(`${def.label}: ${def.pkgPath} is missing or not valid JSON`)];
  }

  const REQUIRED_FIELDS = ['name', 'version', 'main', 'exports', 'files'] as const;
  for (const field of REQUIRED_FIELDS) {
    if (pkg[field] !== undefined && pkg[field] !== null) {
      results.push(pass(`${def.label}: "${field}" = ${JSON.stringify(pkg[field]).slice(0, 60)}`));
    } else {
      results.push(fail(`${def.label}: missing required field "${field}"`));
    }
  }

  // Check "types" field
  if (def.expectedTypes.length > 0) {
    if (pkg['types']) {
      results.push(pass(`${def.label}: "types" = "${pkg['types']}"`));
    } else {
      results.push(fail(`${def.label}: missing "types" field`));
    }
  }

  return results;
}

// ─── Check: exports map keys ─────────────────────────────────────────────────

function checkExportsMap(def: PackageDef): CheckResult[] {
  const results: CheckResult[] = [];
  const pkg = readJson(def.pkgPath);
  if (!pkg || !pkg.exports) {
    return [fail(`${def.label}: "exports" field missing`)];
  }

  const exportsMap = pkg.exports as Record<string, unknown>;
  for (const key of def.expectedExports) {
    if (exportsMap[key] !== undefined) {
      results.push(pass(`${def.label}: exports["${key}"] is present`));
    } else {
      results.push(fail(`${def.label}: exports["${key}"] is MISSING`));
    }
  }

  // Check that each export sub-object has "import" and "types" keys
  for (const [key, value] of Object.entries(exportsMap)) {
    if (typeof value === 'object' && value !== null) {
      const exp = value as Record<string, unknown>;
      if (!exp['import']) {
        results.push(fail(`${def.label}: exports["${key}"].import is missing`));
      } else {
        results.push(pass(`${def.label}: exports["${key}"].import = "${exp['import']}"`));
      }
    }
  }

  return results;
}

// ─── Check: dist files exist ─────────────────────────────────────────────────

function checkDistFiles(def: PackageDef): CheckResult[] {
  return def.expectedDist.map((p) =>
    exists(p) ? pass(`${def.label}: ${p} exists`) : fail(`${def.label}: ${p} MISSING`)
  );
}

// ─── Check: type definitions ─────────────────────────────────────────────────

function checkTypeDefinitions(def: PackageDef): CheckResult[] {
  if (def.expectedTypes.length === 0) {
    return [pass(`${def.label}: no type definitions required`)];
  }
  return def.expectedTypes.map((p) =>
    exists(p)
      ? pass(`${def.label}: ${p} exists`)
      : fail(`${def.label}: type definition ${p} MISSING`)
  );
}

// ─── Check: bin paths ─────────────────────────────────────────────────────────

function checkBinPaths(def: PackageDef): CheckResult[] {
  if (!def.binPaths || def.binPaths.length === 0) {
    return [];
  }

  const results: CheckResult[] = [];
  const pkg = readJson(def.pkgPath);

  if (!pkg || !pkg.bin) {
    results.push(fail(`${def.label}: "bin" field missing in package.json`));
    return results;
  }

  for (const binPath of def.binPaths) {
    if (exists(binPath)) {
      results.push(pass(`${def.label}: bin "${binPath}" exists`));
    } else {
      results.push(fail(`${def.label}: bin "${binPath}" MISSING`));
    }
  }

  return results;
}

// ─── Check: no accidental private exports ────────────────────────────────────

const PRIVATE_PATTERNS = [
  /node_modules/,
  /\.env/,
  /secrets/,
  /credentials/,
  /\.key$/,
  /\.pem$/,
];

function checkNoPrivateExports(def: PackageDef): CheckResult[] {
  const pkg = readJson(def.pkgPath);
  if (!pkg || !pkg.files) {
    return [fail(`${def.label}: no "files" field to check`)];
  }

  const files = pkg.files as string[];
  const results: CheckResult[] = [];

  for (const f of files) {
    for (const pattern of PRIVATE_PATTERNS) {
      if (pattern.test(f)) {
        results.push(fail(`${def.label}: files[] contains potentially sensitive path: "${f}"`));
      }
    }
  }

  if (results.length === 0) {
    results.push(pass(`${def.label}: no accidental private exports in "files" field`));
  }

  return results;
}

// ─── Check: SDK named exports importable (static analysis) ──────────────────

function checkSdkNamedExports(): CheckResult[] {
  const sdkIndex = 'packages/agent-sdk/src/index.ts';
  if (!exists(sdkIndex)) {
    return [fail(`SDK source index ${sdkIndex} not found`)];
  }

  const content = fs.readFileSync(path.join(ROOT, sdkIndex), 'utf8');
  const results: CheckResult[] = [];

  const EXPECTED_EXPORTS = [
    'GrlAgentClient',
    'isAllowed',
    'isDenied',
    'isPending',
    'GrlAgentSdkError',
  ];

  for (const exp of EXPECTED_EXPORTS) {
    if (content.includes(exp)) {
      results.push(pass(`@gyges/agent-sdk exports "${exp}"`));
    } else {
      results.push(fail(`@gyges/agent-sdk MISSING export "${exp}"`));
    }
  }

  return results;
}

// ─── Runner ─────────────────────────────────────────────────────────────────

function main(): void {
  console.log('GRL Package Export Validator — Sprint 22\n');

  let allPassed = true;

  for (const def of PACKAGES) {
    const suiteName = `Package: ${def.label}`;
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Package: ${def.label}`);
    console.log(`${'─'.repeat(60)}`);

    const suites: Array<[string, () => CheckResult[]]> = [
      ['package.json fields', () => checkPackageFields(def)],
      ['exports map', () => checkExportsMap(def)],
      ['dist files', () => checkDistFiles(def)],
      ['type definitions', () => checkTypeDefinitions(def)],
      ['bin paths', () => checkBinPaths(def)],
      ['no private exports', () => checkNoPrivateExports(def)],
    ];

    for (const [name, fn] of suites) {
      const ok = runSuite(name, fn);
      if (!ok) allPassed = false;
    }
  }

  // Global checks
  console.log(`\n${'─'.repeat(60)}`);
  console.log('Global checks');
  console.log(`${'─'.repeat(60)}`);

  const ok = runSuite('SDK named exports (static)', checkSdkNamedExports);
  if (!ok) allPassed = false;

  console.log('\n' + '─'.repeat(60));
  if (allPassed) {
    console.log('✓ All package export validations passed.');
    process.exit(0);
  } else {
    console.log('✗ Package export validation FAILED. Fix the issues above.');
    process.exit(1);
  }
}

main();
