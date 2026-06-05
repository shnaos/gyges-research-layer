#!/usr/bin/env tsx
/**
 * GRL Security Documentation Validator — Sprint 19
 *
 * Validates that the required security documentation exists and does not make
 * forbidden claims. Exits with code 0 on success, 1 on failure.
 *
 * Run: npm run validate:security-docs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── Required documents ────────────────────────────────────────────────────

const REQUIRED_DOCS: string[] = [
  'docs/security/threat-model.md',
  'docs/security/trust-boundaries.md',
  'docs/security/security-assumptions.md',
  'docs/security/defensive-guarantees.md',
  'docs/security/failure-modes.md',
  'docs/security/attack-surfaces.md',
  'docs/security/incident-response.md',
  'docs/security/privacy-model.md',
  'docs/runtime-config.md',
  'docs/cli.md',
  'docs/searxng-transport.md',
  'README.md',
];

// ─── README must reference security docs ───────────────────────────────────

const README_MUST_CONTAIN: string[] = [
  'docs/security/threat-model.md',
  'docs/security/trust-boundaries.md',
  'docs/security/defensive-guarantees.md',
  'docs/security/privacy-model.md',
  'GRL is NOT',
];

// ─── Forbidden claims across all security docs ─────────────────────────────
//
// These patterns flag POSITIVE security claims that would be false promises.
// All patterns require "GRL" as subject to avoid matching negation contexts
// (e.g., "GRL does not replace Tor" does not match /\bGRL\s+replaces?\s+Tor\b/).

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bGRL\s+(?:is|does|provides?|guarantees?|ensures?)\s+(?:full\s+)?anonymity\b/i,
    reason: 'GRL must not claim to provide or guarantee anonymity',
  },
  {
    pattern: /\bGRL\s+(?:is\s+)?anonymous\b/i,
    reason: 'GRL must not claim to be anonymous',
  },
  {
    pattern: /\bGRL\s+replaces?\s+Tor\b/i,
    reason: 'GRL must not claim to replace Tor',
  },
  {
    pattern: /\bGRL\s+(?:is\s+a?\s*)?Tor\s+replacement\b/i,
    reason: 'GRL must not claim to be a Tor replacement',
  },
  {
    pattern: /\bGRL\s+supports?\s+Tor\b/i,
    reason: 'GRL must not claim to support Tor routing',
  },
  {
    pattern: /\bGRL\s+(?:includes?|provides?|has)\s+(?:a\s+)?browser\b/i,
    reason: 'GRL must not claim to include a browser',
  },
  {
    pattern: /\bGRL\s+prevents?\s+(?:host|kernel)\s+compromise\b/i,
    reason: 'GRL must not claim to prevent host or kernel compromise',
  },
  {
    pattern: /\bGRL\s+guarantees?\s+(?:perfect\s+)?OPSEC\b/i,
    reason: 'GRL must not claim to guarantee OPSEC',
  },
  {
    pattern: /\bGRL\s+classif(?:ies|y|ication)\s+(?:semantic|malicious)/i,
    reason: 'GRL must not claim semantic maliciousness classification',
  },
];

// ─── Docs that must NOT contain certain patterns ───────────────────────────

const DOCS_FORBIDDEN_CONTENT: Array<{
  file: string;
  pattern: RegExp;
  reason: string;
}> = [
  {
    file: 'README.md',
    pattern: /\bGRL\s+supports?\s+Tor\b/i,
    reason: 'README must not claim Tor support',
  },
  {
    file: 'README.md',
    pattern: /\bGRL\s+(?:includes?|provides?|has)\s+(?:a\s+)?browser\b/i,
    reason: 'README must not claim browser inclusion',
  },
  {
    file: 'README.md',
    pattern: /\bGRL\s+(?:is|does|provides?|guarantees?|ensures?)\s+(?:full\s+)?anonymity\b/i,
    reason: 'README must not guarantee anonymity',
  },
];

// ─── Utilities ─────────────────────────────────────────────────────────────

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function exists(relPath: string): boolean {
  return fs.existsSync(path.join(ROOT, relPath));
}

// ─── Checks ────────────────────────────────────────────────────────────────

type CheckResult = { ok: boolean; message: string };

function checkDocsExist(): CheckResult[] {
  return REQUIRED_DOCS.map((doc) => {
    if (exists(doc)) {
      return { ok: true, message: `✓ ${doc} exists` };
    }
    return { ok: false, message: `✗ MISSING: ${doc}` };
  });
}

function checkReadmeReferencesDocs(): CheckResult[] {
  if (!exists('README.md')) {
    return [{ ok: false, message: '✗ README.md is missing' }];
  }
  const content = readFile('README.md');
  return README_MUST_CONTAIN.map((ref) => {
    if (content.includes(ref)) {
      return { ok: true, message: `✓ README.md contains reference to: ${ref}` };
    }
    return {
      ok: false,
      message: `✗ README.md is missing required reference to: ${ref}`,
    };
  });
}

function checkForbiddenClaims(): CheckResult[] {
  const results: CheckResult[] = [];
  const securityDocs = REQUIRED_DOCS.filter((d) =>
    d.startsWith('docs/security/')
  );

  for (const doc of securityDocs) {
    if (!exists(doc)) continue;
    const content = readFile(doc);
    for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
      if (pattern.test(content)) {
        results.push({
          ok: false,
          message: `✗ Forbidden claim in ${doc}: ${reason} (matched /${pattern.source}/i)`,
        });
      }
    }
  }

  if (results.length === 0) {
    results.push({
      ok: true,
      message: `✓ No forbidden security claims found in security docs`,
    });
  }

  return results;
}

function checkDocForbiddenContent(): CheckResult[] {
  const results: CheckResult[] = [];

  for (const { file, pattern, reason } of DOCS_FORBIDDEN_CONTENT) {
    if (!exists(file)) continue;
    const content = readFile(file);
    if (pattern.test(content)) {
      results.push({
        ok: false,
        message: `✗ Forbidden content in ${file}: ${reason}`,
      });
    } else {
      results.push({
        ok: true,
        message: `✓ ${file}: no forbidden content for rule "${reason}"`,
      });
    }
  }

  return results;
}

function checkNoTorSupportClaims(): CheckResult[] {
  const results: CheckResult[] = [];
  const allDocs = REQUIRED_DOCS;

  for (const doc of allDocs) {
    if (!exists(doc)) continue;
    const content = readFile(doc);
    // Only flag positive claims (GRL supports/replaces Tor), not non-goal documentation
    if (/\bGRL\s+(?:supports?|replaces?|provides?)\s+Tor\b/i.test(content)) {
      results.push({
        ok: false,
        message: `✗ Forbidden Tor support claim in ${doc}`,
      });
    }
  }

  if (results.length === 0) {
    results.push({
      ok: true,
      message: '✓ No Tor support claims found',
    });
  }

  return results;
}

function checkNoBrowserSupportClaims(): CheckResult[] {
  const results: CheckResult[] = [];
  const allDocs = REQUIRED_DOCS;

  for (const doc of allDocs) {
    if (!exists(doc)) continue;
    const content = readFile(doc);
    // Only flag positive claims (GRL supports/includes a browser)
    if (/\bGRL\s+(?:supports?|includes?|provides?|has)\s+(?:a\s+)?browser\b/i.test(content)) {
      results.push({
        ok: false,
        message: `✗ Forbidden browser support claim in ${doc}`,
      });
    }
  }

  if (results.length === 0) {
    results.push({
      ok: true,
      message: '✓ No browser support claims found',
    });
  }

  return results;
}

function checkForbiddenClaimsAllDocs(): CheckResult[] {
  const results: CheckResult[] = [];

  // Check ALL docs (not just security docs) for forbidden claims
  for (const doc of REQUIRED_DOCS) {
    if (!exists(doc)) continue;
    const content = readFile(doc);
    for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
      if (pattern.test(content)) {
        results.push({
          ok: false,
          message: `✗ Forbidden claim in ${doc}: ${reason}`,
        });
      }
    }
  }

  if (results.length === 0) {
    results.push({
      ok: true,
      message: '✓ No forbidden security claims found in any doc',
    });
  }

  return results;
}

// ─── Runner ────────────────────────────────────────────────────────────────

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

function main(): void {
  console.log('GRL Security Documentation Validator — Sprint 19\n');

  const suites: Array<[string, () => CheckResult[]]> = [
    ['Required docs exist', checkDocsExist],
    ['README references security docs', checkReadmeReferencesDocs],
    ['No forbidden security claims in security docs', checkForbiddenClaims],
    ['No forbidden content in specific docs', checkDocForbiddenContent],
    ['No Tor support claims', checkNoTorSupportClaims],
    ['No browser support claims', checkNoBrowserSupportClaims],
    ['No forbidden claims across all docs', checkForbiddenClaimsAllDocs],
  ];

  let allPassed = true;
  for (const [name, fn] of suites) {
    const ok = runSuite(name, fn);
    if (!ok) allPassed = false;
  }

  console.log('\n' + '─'.repeat(60));
  if (allPassed) {
    console.log('✓ All security documentation checks passed.');
    process.exit(0);
  } else {
    console.log('✗ Security documentation validation FAILED. See above.');
    process.exit(1);
  }
}

main();
