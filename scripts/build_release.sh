#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Naija Parts Hub — one-command local release build
# Operated by Lytod Motors Ltd
#
# Usage:
#   ./scripts/build_release.sh
#
# Requires:
#   - Flutter SDK installed and on PATH
#   - android/key.properties filled in (see android/key.properties.template)
#   - A release keystore at android/app/release-keystore.jks
# ---------------------------------------------------------------------------

set -euo pipefail

echo "== Naija Parts Hub release build =="

if [ ! -f "android/key.properties" ]; then
  echo "ERROR: android/key.properties not found."
  echo "Copy android/key.properties.template to android/key.properties and fill it in first."
  exit 1
fi

echo "-- Cleaning old build --"
flutter clean

echo "-- Getting packages --"
flutter pub get

echo "-- Running analyzer --"
flutter analyze

echo "-- Building App Bundle (for Play Store upload) --"
flutter build appbundle --release

echo "-- Building split APKs (for direct install / beta testers) --"
flutter build apk --release --split-per-abi

echo ""
echo "== Build complete =="
echo "AAB (upload this to Play Console):"
echo "  build/app/outputs/bundle/release/app-release.aab"
echo ""
echo "APKs (for sideloading / beta testers):"
echo "  build/app/outputs/flutter-apk/"
