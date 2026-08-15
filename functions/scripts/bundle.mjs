/**
 * Bundles the functions for deployment, inlining `@nph/contracts`.
 *
 * WHY THIS EXISTS
 *
 * `firebase deploy --only functions` uploads only the `source` directory from
 * firebase.json — `functions/` — and Cloud Build then runs `npm install`
 * inside it. A workspace sibling like `@nph/contracts` is not in that upload
 * and is not on the public registry, so npm resolved it against
 * registry.npmjs.org and the build died with:
 *
 *     npm error 404  '@nph/contracts@*' is not in this registry.
 *
 * This is invisible locally, because the root `npm install` symlinks the
 * workspace into node_modules and `tsc` resolves it happily. It only appears
 * in Cloud Build, after the upload, once per function.
 *
 * A `file:` dependency cannot fix it: the path would have to point outside
 * the upload root, and a path inside it breaks `npm install` on a fresh clone
 * (the target does not exist until something generates it). Bundling sidesteps
 * the resolution problem entirely — the contracts source becomes part of
 * index.js, and the deployed package.json no longer names it at all.
 *
 * `@nph/contracts` therefore is NOT a dependency in functions/package.json. It
 * is resolved at bundle time via the workspace symlink, and its types come
 * from the `paths` mapping in tsconfig.json. Both point at the same place.
 *
 * `tsc` still emits lib/ for the tests, which import compiled files directly
 * (`../lib/lib/subscription.js`). That output keeps its `require("@nph/
 * contracts")` calls and resolves them through the workspace, which is correct
 * for a dev machine and irrelevant to deployment. lib/ is not uploaded.
 */
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const OUTFILE = 'dist/index.js';

// firebase-functions must stay external: the CLI loads this bundle to discover
// the exported function definitions, and it compares them against its own
// copy of the library. A second, bundled instance would produce objects that
// fail those identity checks. firebase-admin is external for the same reason
// its singleton app registry has to be shared with the runtime.
const EXTERNAL = [
  'firebase-admin',
  'firebase-admin/*',
  'firebase-functions',
  'firebase-functions/*',
];

await build({
  entryPoints: ['src/index.ts'],
  outfile: OUTFILE,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: EXTERNAL,
  // Not minified on purpose. These stack traces are read in Cloud Logging
  // during incidents, and Crashlytics is not in play server-side.
  minify: false,
  sourcemap: true,
  logLevel: 'info',
});

// Fail loudly rather than shipping an artifact that 404s in Cloud Build. A
// stray dynamic require, or a future dependency added to contracts, would
// otherwise reproduce the exact bug this script exists to prevent — and the
// next person would see it as a deploy failure, not a bundling one.
const out = await readFile(OUTFILE, 'utf8');
const unresolved = out.match(/require\(["']@nph\/[^"']+["']\)/g);
if (unresolved) {
  console.error(
    `\n${OUTFILE} still requires workspace packages at runtime:\n` +
      `  ${[...new Set(unresolved)].join('\n  ')}\n\n` +
      'Cloud Build cannot resolve these. They must be inlined, which means ' +
      'they have to be statically importable — check for a dynamic import().\n',
  );
  process.exit(1);
}

console.log(`${OUTFILE}: no unresolved workspace requires`);
