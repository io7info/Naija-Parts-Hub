#!/usr/bin/env node
/**
 * Fails if any tracked binary has been damaged by text processing.
 *
 * Written after 23 PNGs — every Android launcher icon and iOS app icon — were
 * silently corrupted and committed. A branding pass ran `sed -i` across every
 * tracked file without excluding binaries; on MSYS that normalises CRLF to LF,
 * stripping the 0x0D from each PNG signature and mangling the rest.
 *
 * Nothing caught it. `flutter analyze` passed, the tests passed, and the DEBUG
 * build passed — only the release build failed, with an AAPT error that named
 * the files but not the cause. This check exists so the next occurrence is a
 * one-line CI failure rather than an afternoon.
 *
 * Usage: node scripts/check-binary-integrity.mjs
 */

import { execFileSync } from 'node:child_process';
import { openSync, readSync, closeSync } from 'node:fs';

/** First bytes that must appear, per extension. */
const SIGNATURES = {
  '.png': ['89504e470d0a1a0a'],
  '.jpg': ['ffd8ff'],
  // The approved design ships a PNG named .jpeg; both are accepted rather than
  // renaming an asset the client signed off on.
  '.jpeg': ['ffd8ff', '89504e470d0a1a0a'],
  '.gif': ['474946'],
  '.webp': ['52494646'],
  '.ico': ['00000100'],
  '.ttf': ['00010000', '74727565'],
  '.otf': ['4f54544f'],
  '.woff': ['774f4646'],
  '.woff2': ['774f4632'],
  '.pdf': ['25504446'],
  '.docx': ['504b0304'],
  '.zip': ['504b0304'],
  '.jks': ['feedfeed', '504b0304'],
};

function head(path, bytes = 8) {
  const fd = openSync(path, 'r');
  const buf = Buffer.alloc(bytes);
  try {
    readSync(fd, buf, 0, bytes, 0);
  } finally {
    closeSync(fd);
  }
  return buf.toString('hex');
}

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

let checked = 0;
const damaged = [];

for (const file of tracked) {
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  const expected = SIGNATURES[ext];
  if (!expected) continue;

  checked++;
  let actual;
  try {
    actual = head(file);
  } catch {
    continue; // not present in this checkout
  }

  if (!expected.some((sig) => actual.startsWith(sig))) {
    damaged.push({ file, actual: actual.slice(0, 16), expected: expected.join(' or ') });
  }
}

if (damaged.length > 0) {
  console.error(`✗ ${damaged.length} of ${checked} tracked binaries are damaged:\n`);
  for (const d of damaged) {
    console.error(`  ${d.file}`);
    console.error(`      found ${d.actual}, expected ${d.expected}`);
  }
  console.error('\nAlmost always caused by a text tool touching a binary —');
  console.error('sed -i, a line-ending conversion, or an editor "fixing" the file.');
  console.error('Restore from a clean source; do not hand-edit.');
  process.exit(1);
}

console.log(`✓ ${checked} tracked binaries intact.`);
