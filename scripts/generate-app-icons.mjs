#!/usr/bin/env node
/**
 * Regenerates every Android and iOS launcher icon from the NPH mark.
 *
 * Source of truth: apps/mobile/assets/brand/nph-logo-light.png — the same file
 * the in-app NphLogo widget renders, so the launcher and the splash can never
 * drift apart.
 *
 * Why this is not just "resize the PNG into mipmap-*":
 *
 *   The source is a white rounded square with BLACK corners. Android 8+ wraps
 *   any non-adaptive icon in a white circle and scales it to ~66% to make room
 *   for the mask, which is why the launcher was showing a small dark tile
 *   floating in a white disc instead of the logo.
 *
 *   The fix is a real adaptive icon: a white background layer plus a foreground
 *   holding only the gear, sized to the 66dp keyline inside the 108dp canvas so
 *   the circle mask crops nothing. The black corners are dropped entirely — on
 *   Android they are outside the mask, and on iOS they would show as slivers
 *   under the system's superellipse.
 *
 * Usage: node scripts/generate-app-icons.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'apps/mobile/assets/brand/nph-logo-light.png');
const ANDROID_RES = join(ROOT, 'apps/mobile/android/app/src/main/res');
const IOS_ICONS = join(ROOT, 'apps/mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset');

/**
 * Adaptive-icon geometry, in dp. The layer is 108; launchers guarantee only the
 * centre 72 survives masking, and Material's keyline for a circular logo inside
 * that is 66. Anything larger risks the gear teeth being shaved off on devices
 * that use a circle mask.
 */
const LAYER_DP = 108;
const KEYLINE_DP = 66;

/** iOS applies its own superellipse, so the artwork sits on a full white square. */
const IOS_ARTWORK_FRACTION = 0.80;

/** Corner radius of the legacy (pre-API-26) icon, as a fraction of its size. */
const LEGACY_RADIUS_FRACTION = 0.22;
const LEGACY_ARTWORK_FRACTION = 0.82;

const DENSITIES = {
  mdpi: 1,
  hdpi: 1.5,
  xhdpi: 2,
  xxhdpi: 3,
  xxxhdpi: 4,
};

/** Legacy launcher icon edge length per density, in px. */
const LEGACY_PX = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

/**
 * Locates the gear inside the source.
 *
 * Scans only between the first and last white pixel of each row, so the black
 * area outside the rounded rectangle is never mistaken for artwork — measuring
 * naively returns the full canvas and silently produces an icon at the wrong
 * scale.
 */
async function findArtworkBounds(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const isWhite = (x, y) => {
    const i = (y * width + x) * channels;
    return data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235;
  };

  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < width; x++) if (isWhite(x, y)) { left = x; break; }
    for (let x = width - 1; x >= 0; x--) if (isWhite(x, y)) { right = x; break; }
    if (left < 0) continue;
    for (let x = left; x <= right; x++) {
      if (isWhite(x, y)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }

  if (x1 < 0) throw new Error(`No artwork found inside ${file}`);
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** The gear, cropped square and scaled to `size` px. */
function artworkAt(source, bounds, size) {
  return sharp(source).extract(bounds).resize(size, size, { fit: 'fill' }).png().toBuffer();
}

function write(file, buffer) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buffer);
  console.log(`  ${file.slice(ROOT.length + 1).replace(/\\/g, '/')}`);
}

async function main() {
  if (!existsSync(SOURCE)) throw new Error(`Missing source logo: ${SOURCE}`);

  const bounds = await findArtworkBounds(SOURCE);
  console.log(`Source artwork: ${bounds.width}x${bounds.height} at ${bounds.left},${bounds.top}\n`);

  // ---- Android: adaptive foreground (transparent, gear on the keyline) ----
  //
  // The plate is the background layer, not baked in here, so the two layers can
  // be parallaxed independently and a monochrome layer can be added later.
  //
  // If a rebuild appears not to change the icon, suspect the launcher's icon
  // cache before the generator: reinstalling is not enough, it takes
  // `adb shell pm clear com.google.android.apps.nexuslauncher`.
  console.log('Android adaptive foreground');
  for (const [density, scale] of Object.entries(DENSITIES)) {
    const canvas = Math.round(LAYER_DP * scale);
    const artwork = Math.round(canvas * (KEYLINE_DP / LAYER_DP));
    const offset = Math.round((canvas - artwork) / 2);

    const png = await sharp({
      create: { width: canvas, height: canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: await artworkAt(SOURCE, bounds, artwork), top: offset, left: offset }])
      .png()
      .toBuffer();

    write(join(ANDROID_RES, `mipmap-${density}`, 'ic_launcher_foreground.png'), png);
  }

  // ---- Android: legacy icon for API < 26, which is shown unmasked ----
  console.log('Android legacy icon');
  for (const [density, size] of Object.entries(LEGACY_PX)) {
    const radius = Math.round(size * LEGACY_RADIUS_FRACTION);
    const artwork = Math.round(size * LEGACY_ARTWORK_FRACTION);
    const offset = Math.round((size - artwork) / 2);
    const plate = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
        `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#FFFFFF"/></svg>`,
    );

    const png = await sharp(plate)
      .composite([{ input: await artworkAt(SOURCE, bounds, artwork), top: offset, left: offset }])
      .png()
      .toBuffer();

    write(join(ANDROID_RES, `mipmap-${density}`, 'ic_launcher.png'), png);
  }

  // ---- Android: adaptive descriptors ----
  console.log('Android adaptive descriptors');
  const adaptive =
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n' +
    '    <background android:drawable="@color/ic_launcher_background" />\n' +
    '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n' +
    '</adaptive-icon>\n';
  write(join(ANDROID_RES, 'mipmap-anydpi-v26', 'ic_launcher.xml'), Buffer.from(adaptive));
  write(join(ANDROID_RES, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), Buffer.from(adaptive));
  write(
    join(ANDROID_RES, 'values', 'ic_launcher_background.xml'),
    Buffer.from(
      '<?xml version="1.0" encoding="utf-8"?>\n' +
        '<resources>\n' +
        '    <!-- The logo plate is white; the gear sits on it as the foreground layer. -->\n' +
        '    <color name="ic_launcher_background">#FFFFFF</color>\n' +
        '</resources>\n',
    ),
  );

  // ---- iOS: opaque squares, no alpha (the App Store rejects transparency) ----
  console.log('iOS app icons');
  const contents = JSON.parse(readFileSync(join(IOS_ICONS, 'Contents.json'), 'utf8'));
  const files = [...new Set(contents.images.map((i) => i.filename).filter(Boolean))];

  for (const name of files) {
    const target = join(IOS_ICONS, name);
    const { width } = await sharp(target).metadata();
    const artwork = Math.round(width * IOS_ARTWORK_FRACTION);
    const offset = Math.round((width - artwork) / 2);

    const png = await sharp({
      create: { width, height: width, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    })
      .composite([{ input: await artworkAt(SOURCE, bounds, artwork), top: offset, left: offset }])
      .flatten({ background: '#FFFFFF' })
      .removeAlpha()
      .png()
      .toBuffer();

    write(target, png);
  }

  console.log('\nDone. Rebuild the app to see the new launcher icon.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
