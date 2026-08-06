#!/usr/bin/env node
/**
 * Guards the one piece of duplication the architecture cannot avoid.
 *
 * firestore.rules cannot import TypeScript, so the backend-controlled field
 * lists in packages/contracts/src/security.ts are mirrored there by hand.
 * A field added to the contract but missed in the rules would be silently
 * dealer-writable — which is exactly the hole architecture decision #4 exists
 * to close. This fails CI when the two drift.
 *
 * Usage: node scripts/check-rules-sync.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let contracts;
try {
  contracts = require(join(root, 'packages/contracts/dist/index.js'));
} catch {
  console.error('✗ @nph/contracts is not built. Run: npm run contracts:build');
  process.exit(1);
}

const rulesSource = readFileSync(join(root, 'firebase/firestore.rules'), 'utf8');

/** Pull the string array out of a zero-arg rules helper function. */
function fieldsFromRules(fnName) {
  const pattern = new RegExp(
    `function\\s+${fnName}\\s*\\(\\s*\\)\\s*\\{[^}]*?return\\s*\\[([\\s\\S]*?)\\]`,
    'm',
  );
  const match = rulesSource.match(pattern);
  if (!match) {
    console.error(`✗ could not locate ${fnName}() in firebase/firestore.rules`);
    process.exit(1);
  }
  return match[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
    .sort();
}

const PAIRS = [
  ['storeBackendFields', contracts.STORE_BACKEND_FIELDS],
  ['storeDealerFields', contracts.STORE_DEALER_FIELDS],
  ['listingBackendFields', contracts.LISTING_BACKEND_FIELDS],
  ['listingDealerFields', contracts.LISTING_DEALER_FIELDS],
];

let failures = 0;

for (const [fnName, contractFields] of PAIRS) {
  const inRules = fieldsFromRules(fnName);
  const inContract = [...contractFields].sort();

  const missingFromRules = inContract.filter((f) => !inRules.includes(f));
  const missingFromContract = inRules.filter((f) => !inContract.includes(f));

  if (missingFromRules.length || missingFromContract.length) {
    failures++;
    console.error(`✗ ${fnName} — drift detected`);
    if (missingFromRules.length) {
      console.error(`    in contracts, missing from rules: ${missingFromRules.join(', ')}`);
    }
    if (missingFromContract.length) {
      console.error(`    in rules, missing from contracts: ${missingFromContract.join(', ')}`);
    }
  } else {
    console.log(`✓ ${fnName.padEnd(22)} ${inRules.length} fields in sync`);
  }
}

// The two dealer-writable lists must never intersect the backend-only lists,
// or a dealer could write a protected field through the permitted path.
function assertDisjoint(labelA, a, labelB, b) {
  const overlap = [...a].filter((f) => [...b].includes(f));
  if (overlap.length) {
    failures++;
    console.error(`✗ ${labelA} and ${labelB} overlap: ${overlap.join(', ')}`);
  } else {
    console.log(`✓ ${labelA} ∩ ${labelB} is empty`);
  }
}

assertDisjoint(
  'STORE_DEALER_FIELDS', contracts.STORE_DEALER_FIELDS,
  'STORE_BACKEND_FIELDS', contracts.STORE_BACKEND_FIELDS,
);
assertDisjoint(
  'LISTING_DEALER_FIELDS', contracts.LISTING_DEALER_FIELDS,
  'LISTING_BACKEND_FIELDS', contracts.LISTING_BACKEND_FIELDS,
);

// ---------------------------------------------------------------------------
// The Cloud Functions region.
//
// A callable resolves to `https://<region>-<project>.cloudfunctions.net/<name>`,
// so a client that disagrees with the deployment gets a 404 on every call —
// registration, publishing, deletion, all of it — and the error reads like a
// missing function rather than a misconfigured region.
//
// The TypeScript callers import the constant and cannot drift. Dart cannot, so
// apps/mobile mirrors it by hand, which is exactly the case this file exists
// for.
// ---------------------------------------------------------------------------

const REGION_MIRRORS = [
  {
    label: 'apps/mobile/lib/core/env.dart',
    file: 'apps/mobile/lib/core/env.dart',
    // String.fromEnvironment('FUNCTIONS_REGION', defaultValue: '<region>')
    pattern: /FUNCTIONS_REGION'\s*,\s*defaultValue:\s*'([a-z0-9-]+)'/,
  },
];

for (const mirror of REGION_MIRRORS) {
  const source = readFileSync(join(root, mirror.file), 'utf8');
  const found = source.match(mirror.pattern)?.[1];

  if (!found) {
    failures++;
    console.error(`✗ could not find the region constant in ${mirror.label}`);
  } else if (found !== contracts.FUNCTIONS_REGION) {
    failures++;
    console.error(
      `✗ ${mirror.label} targets "${found}" but FUNCTIONS_REGION is "${contracts.FUNCTIONS_REGION}"`,
    );
  } else {
    console.log(`✓ ${'functions region'.padEnd(22)} ${found} in sync with ${mirror.label}`);
  }
}

// A stale region literal left anywhere else is the same bug wearing a
// different hat, so no source file may hardcode one.
const REGION_LITERALS = /'(?:europe|us|asia|australia|northamerica|southamerica)-[a-z]+[0-9]'/;
const SCANNED = [
  'functions/src/index.ts',
  'apps/web/lib/firebase-config.ts',
  'firebase/tests/e2e.test.mjs',
];

for (const file of SCANNED) {
  const source = readFileSync(join(root, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const literal = source.match(REGION_LITERALS)?.[0];
  if (literal) {
    failures++;
    console.error(`✗ ${file} hardcodes ${literal} — import FUNCTIONS_REGION instead`);
  } else {
    console.log(`✓ ${'no region literal'.padEnd(22)} ${file}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed — rules and contracts have drifted.`);
  process.exit(1);
}
console.log('\nAll rules/contract checks passed.');
