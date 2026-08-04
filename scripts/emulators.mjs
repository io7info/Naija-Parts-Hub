#!/usr/bin/env node
/**
 * Launch the Firebase Emulator Suite with the settings this project needs.
 *
 * A wrapper rather than a longer npm script because two of these are
 * environment variables, and `VAR=x cmd` is not portable to Windows shells.
 *
 * What it adds over `firebase emulators:start`:
 *
 * 1. FUNCTIONS_DISCOVERY_TIMEOUT
 *    The emulator spawns one runtime worker per function and waits 30 s for it
 *    to report ready, then fails the request with
 *
 *      !! functions: Failed to start functions ...: FirebaseError: Failed to
 *         load function.
 *
 *    On a slow host — Node newer than the declared engine, or antivirus
 *    scanning node_modules on every spawn — a cold worker can take ~30 s and
 *    lose that race by a second, while the runtime logs "initialized" moments
 *    later. The function was never broken; it just had not finished loading.
 *    firebase-tools reads this override (in SECONDS) for exactly this case.
 *
 * 2. --import / --export-on-exit
 *    Emulator state is in memory. Without this, every restart discards the
 *    seeded admin, the categories and any dealer registered while testing —
 *    which also invalidates the app's stored refresh token and leaves it
 *    looking signed in while every call fails with INVALID_REFRESH_TOKEN.
 *    Persisting the data removes that whole class of confusion.
 *
 * 3. A build before start
 *    The emulator serves functions/lib, never functions/src. Starting with a
 *    stale or missing lib is what produces callables that 404 as NOT_FOUND
 *    while the console cheerfully prints "All emulators ready!".
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, '.emulator-data');

/** Seconds. Generous rather than tuned — overshooting costs nothing, and the
 *  penalty for undershooting is a failed request that looks like a code bug. */
const DISCOVERY_TIMEOUT_SECONDS = process.env.FUNCTIONS_DISCOVERY_TIMEOUT ?? '180';

const run = (cmd, args, env = {}) =>
  spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...env },
  });

console.log('Building contracts and functions before start...\n');
for (const args of [
  ['run', 'contracts:build'],
  ['run', 'build', '--workspace', '@nph/functions'],
]) {
  const r = run('npm', args);
  if (r.status !== 0) {
    console.error(`\n✗ ${args.join(' ')} failed — not starting the emulators.`);
    console.error('  Starting with a stale functions/lib is how callables end up 404ing.');
    process.exit(r.status ?? 1);
  }
}

// --import fails outright if the directory is absent, which would make the
// very first run error. Creating it up front makes a cold checkout just work.
mkdirSync(dataDir, { recursive: true });

console.log(`\nFunction worker start timeout: ${DISCOVERY_TIMEOUT_SECONDS}s`);
console.log(`Persisting emulator state to:   ${dataDir}\n`);

const result = run(
  'firebase',
  [
    'emulators:start',
    '--project',
    'demo-naija-parts-hub',
    '--import',
    JSON.stringify(dataDir),
    '--export-on-exit',
  ],
  { FUNCTIONS_DISCOVERY_TIMEOUT: DISCOVERY_TIMEOUT_SECONDS },
);

process.exit(result.status ?? 0);
