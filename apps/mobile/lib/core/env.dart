/// Environment configuration.
///
/// Everything that differs between local emulator development and the client's
/// live Firebase project is resolved here, from `--dart-define` values with
/// emulator-friendly defaults. No feature code branches on environment, so
/// switching to the real project is a build-flag change, not a rewrite.
///
/// Local (default — no flags needed):
///   flutter run
///
/// Against a real project:
///   flutter run --dart-define=USE_FIREBASE_EMULATOR=false
///
/// The emulator host differs per platform: the Android emulator reaches the
/// host machine's loopback at 10.0.2.2, not 127.0.0.1.
library;

import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb, kReleaseMode;

enum AppEnvironment { emulator, live }

abstract final class Env {
  /// Emulator in debug and profile; **never** by default in release.
  ///
  /// The default used to be an unconditional `true`, which meant
  /// `flutter build apk --release` with no `--dart-define` produced a *release*
  /// build wired to 10.0.2.2 — an app that shows emulator diagnostics, cannot
  /// reach any backend on a real handset, and would have failed store review
  /// while looking fine on the build machine. Nothing in the build would have
  /// warned anyone.
  ///
  /// `kReleaseMode` is a compile-time constant (`dart.vm.product`), so this
  /// stays a `const` and the emulator wiring is still tree-shaken out of
  /// release binaries. An explicit `--dart-define` overrides either way, which
  /// is what the two-direction switch test relies on.
  static const bool useEmulator =
      bool.fromEnvironment('USE_FIREBASE_EMULATOR', defaultValue: !kReleaseMode);

  static AppEnvironment get current =>
      useEmulator ? AppEnvironment.emulator : AppEnvironment.live;

  /// Matches the `demo-` prefix in .firebaserc. The Emulator Suite treats any
  /// demo-* project id as offline-only: no credentials, and no possibility of
  /// a call reaching a real project by accident.
  static const String demoProjectId =
      String.fromEnvironment('DEMO_PROJECT_ID', defaultValue: 'demo-naija-parts-hub');

  /// Placeholder API key for emulator runs.
  ///
  /// Fake, but it must have the SHAPE of a real key: `AIzaSy` followed by 33
  /// characters. The Android Firebase SDK validates the format before issuing
  /// any request, so a casual placeholder like 'demo-api-key' fails with
  ///
  ///   java.lang.IllegalArgumentException: Please set a valid API key.
  ///
  /// The call never leaves the device, so the emulator logs nothing and the
  /// failure looks like a connectivity problem rather than a config one. Auth
  /// and Firestore tolerate a malformed key; Cloud Functions does not.
  static const String demoApiKey = 'AIzaSyDemoEmulatorKeyNotRealNotUsed1234';

  /// 10.0.2.2 is the Android emulator's alias for the host loopback.
  /// A physical device needs the host's LAN IP passed in explicitly.
  static String get emulatorHost {
    const override = String.fromEnvironment('EMULATOR_HOST');
    if (override.isNotEmpty) return override;
    if (kIsWeb) return 'localhost';
    return Platform.isAndroid ? '10.0.2.2' : 'localhost';
  }

  static const int authPort = int.fromEnvironment('EMULATOR_AUTH_PORT', defaultValue: 9099);
  static const int firestorePort =
      int.fromEnvironment('EMULATOR_FIRESTORE_PORT', defaultValue: 8080);
  static const int storagePort =
      int.fromEnvironment('EMULATOR_STORAGE_PORT', defaultValue: 9199);
  static const int functionsPort =
      int.fromEnvironment('EMULATOR_FUNCTIONS_PORT', defaultValue: 5001);

  /// Mirrors FUNCTIONS_REGION in packages/contracts/src/constants.ts.
  ///
  /// Dart cannot import TypeScript, so this is copied by hand and
  /// scripts/check-rules-sync.mjs fails when the two drift. Getting it wrong
  /// is not a subtle failure: every callable resolves to
  /// `https://<region>-<project>.cloudfunctions.net/<name>`, so the whole app
  /// returns "not found" for registration, publishing and deletion alike.
  static const String functionsRegion =
      String.fromEnvironment('FUNCTIONS_REGION', defaultValue: 'us-central1');

  /// Public marketplace origin — storefronts, product pages, share links and
  /// the plan upgrade flow all resolve against it.
  ///
  /// Mirrors SITE_ORIGIN in packages/contracts/src/constants.ts. Dart cannot
  /// import TypeScript, so scripts/check-rules-sync.mjs fails when the two
  /// drift, and rejects a `.ng` literal reappearing in either.
  ///
  /// The project accumulated three spellings of its own domain — naijahubparts
  /// in the SOW, naijapartshub.ng here and in the backend, naijapartshub.com in
  /// the web app. Only the `.com` was ever registered, and the `.ng` reached
  /// the Paystack return URL: a dealer completed checkout and landed on a
  /// domain that does not resolve, with no way to tell whether they had paid.
  static const String marketplaceOrigin = String.fromEnvironment(
    'MARKETPLACE_ORIGIN',
    defaultValue: 'https://naijapartshub.com',
  );

  /// Support line, digits only for `wa.me`.
  ///
  /// A dart-define rather than a literal: the client's support number is not
  /// settled, and it appears on four screens. PENDING client confirmation —
  /// the current value is a placeholder and must be replaced before release.
  static const String supportWhatsapp =
      String.fromEnvironment('SUPPORT_WHATSAPP', defaultValue: '2348031234567');

  /// Where a dealer goes to buy or renew a plan.
  ///
  /// `/dealer/subscription`, not `/plans`. The latter is the public pricing
  /// page: it has no sign-in and no pay button, so a dealer sent there sees
  /// prices and reaches a dead end — which does not satisfy SOW §5 ("the
  /// upgrade option will be displayed") or §8, both of which require the plan
  /// to actually be purchasable. `/dealer/subscription` prompts phone sign-in,
  /// then shows their real plan, expiry, history and a working checkout.
  ///
  /// Web-only by design: selling an in-app upgrade would engage App Store
  /// Guideline 3.1.1 and Apple's cut. On iOS even *linking* here is prohibited
  /// under the same guideline's anti-steering clause — see [showUpgradeLinks].
  static const String upgradeUrl = String.fromEnvironment(
    'UPGRADE_URL',
    defaultValue: '$marketplaceOrigin/dealer/subscription',
  );

  /// Whether the app may show a route to payment at all.
  ///
  /// App Store Guideline 3.1.1 forbids an iOS app carrying "buttons, external
  /// links, or other calls to action that direct customers to purchasing
  /// mechanisms other than in-app purchase". A subscription that raises the
  /// listing cap from 10 to 200 is in-app content, so on iOS the links come out
  /// entirely — the plan and usage are still shown, because stating a fact is
  /// not a call to action.
  ///
  /// Android has no such rule and keeps them.
  ///
  /// A runtime check, not a compile-time one. Dart exposes no const for the
  /// target platform, and it does not matter here: Apple reviews the running
  /// app, and a link that never renders is not a call to action a user can see.
  ///
  /// `SHOW_UPGRADE_LINKS` overrides it either way, so the iOS behaviour can be
  /// exercised from an Android device during review preparation:
  ///   flutter run --dart-define=SHOW_UPGRADE_LINKS=false
  static bool get showUpgradeLinks {
    const override = String.fromEnvironment('SHOW_UPGRADE_LINKS');
    if (override == 'true') return true;
    if (override == 'false') return false;
    return !Platform.isIOS;
  }

  /// Rewrites a Storage download URL so it is reachable from *this* device.
  ///
  /// The Storage emulator mints absolute URLs containing whatever host the
  /// seeder or uploader used — typically `http://127.0.0.1:9199/...`. Those are
  /// correct on the machine running the emulators, and meaningless on an
  /// Android emulator, where 127.0.0.1 is the handset itself: nothing is
  /// listening, so every image silently fails to load while the surrounding
  /// document renders perfectly.
  ///
  /// The stored URL is deliberately left alone. It is shared with the Next.js
  /// site, which runs on the host and needs the loopback form — so the address
  /// is resolved per client at render time rather than baked into the document.
  ///
  /// A no-op against a live project, where URLs point at
  /// firebasestorage.googleapis.com and must not be touched.
  static String resolveStorageUrl(String url) {
    if (!useEmulator || url.isEmpty) return url;
    return url.replaceFirst(
      RegExp(r'^https?://(127\.0\.0\.1|localhost)'),
      'http://$emulatorHost',
    );
  }

  static String get describe =>
      useEmulator ? 'Emulator ($emulatorHost) · $demoProjectId' : 'Live Firebase project';
}
