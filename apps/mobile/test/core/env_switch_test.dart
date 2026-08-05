import 'package:flutter_test/flutter_test.dart';
import 'package:naija_parts_hub/core/env.dart';
import 'package:naija_parts_hub/firebase_options.dart';

/// Proves the emulator/live switch in both directions.
///
/// `USE_FIREBASE_EMULATOR` is a compile-time constant, so a single test run can
/// only observe one side of it. This file asserts whichever side it was built
/// with, and is run twice:
///
///   flutter test test/core/env_switch_test.dart
///   flutter test test/core/env_switch_test.dart --dart-define=USE_FIREBASE_EMULATOR=false
///
/// Both are wired into `npm run test:mobile-env`. A switch that is only ever
/// exercised in one direction is not a switch, it is a default.
void main() {
  group('environment switch', () {
    test('resolves exactly one environment, consistently', () {
      // The enum and the boolean must never disagree; feature code reads both.
      expect(Env.current, Env.useEmulator ? AppEnvironment.emulator : AppEnvironment.live);
      expect(Env.describe.contains('Emulator'), Env.useEmulator);
    });

    test('emulator build targets the demo project and never the live one', () {
      if (!Env.useEmulator) return;

      // The demo- prefix is a security property, not a naming convention: the
      // Emulator Suite refuses to reach a real project for any demo-* id.
      expect(Env.demoProjectId, startsWith('demo-'));
      expect(Env.demoProjectId, isNot(DefaultFirebaseOptions.android.projectId));
      expect(Env.describe, contains(Env.demoProjectId));
    });

    test('live build carries no emulator wiring', () {
      if (Env.useEmulator) return;

      expect(Env.describe, 'Live Firebase project');
      expect(Env.describe, isNot(contains('10.0.2.2')));
      expect(Env.describe, isNot(contains(Env.demoProjectId)));
    });
  });

  group('storage URL resolution', () {
    // The Storage emulator mints absolute URLs naming whatever host uploaded
    // the object — usually the seeder's 127.0.0.1. That address means "this
    // handset" on an Android emulator, so images silently fail to load while
    // the surrounding document renders perfectly. Nothing errors; the picture
    // is simply never there, which is why this is worth pinning down.
    const seeded =
        'http://127.0.0.1:9199/v0/b/demo-naija-parts-hub.appspot.com/o/'
        'stores%2Fseed-ladipo-auto%2Flistings%2Fx%2Fseed-1.jpg?alt=media&token=abc';

    test('emulator build retargets loopback at the host, preserving the rest', () {
      if (!Env.useEmulator) return;

      final resolved = Env.resolveStorageUrl(seeded);

      expect(resolved, startsWith('http://${Env.emulatorHost}:9199/'));
      // Port, object path and the download token must survive untouched — the
      // token is what makes the object readable at all.
      expect(resolved, contains(':9199/v0/b/demo-naija-parts-hub.appspot.com/o/'));
      expect(resolved, endsWith('?alt=media&token=abc'));
      expect(resolved, isNot(contains('127.0.0.1')));
    });

    test('only the host is rewritten, never a matching substring elsewhere', () {
      if (!Env.useEmulator) return;

      // A bare replace would corrupt this: the loopback address also appears
      // inside the query string, where it is data rather than a destination.
      const tricky = 'http://localhost:9199/o/file.jpg?from=127.0.0.1';
      final resolved = Env.resolveStorageUrl(tricky);

      expect(resolved, startsWith('http://${Env.emulatorHost}:9199/'));
      expect(resolved, endsWith('?from=127.0.0.1'));
    });

    test('leaves a live Google Storage URL alone', () {
      const live =
          'https://firebasestorage.googleapis.com/v0/b/naijapartshub.firebasestorage.app/'
          'o/stores%2Fabc%2Fx.jpg?alt=media&token=def';

      // Must hold in BOTH builds: rewriting a production URL would break every
      // image for every real dealer.
      expect(Env.resolveStorageUrl(live), live);
    });

    test('live build rewrites nothing at all', () {
      if (Env.useEmulator) return;

      expect(Env.resolveStorageUrl(seeded), seeded);
    });

    test('an empty url stays empty rather than becoming a host', () {
      // Listings legitimately have no photo while a dealer is still drafting.
      expect(Env.resolveStorageUrl(''), '');
    });
  });

  group('generated Firebase options', () {
    test('both platforms point at the live project', () {
      expect(DefaultFirebaseOptions.android.projectId, 'naijapartshub');
      expect(DefaultFirebaseOptions.ios.projectId, 'naijapartshub');
    });

    test('identifiers match the store-registered ids', () {
      // These can never change after release: Play and the App Store treat a
      // different id as a different app, with no reviews or install base.
      expect(DefaultFirebaseOptions.ios.iosBundleId, 'com.lytodmotors.naijapartshub');
      // Android has no equivalent field on FirebaseOptions; the package name is
      // enforced by the google-services plugin at build time, which is why a
      // mismatch fails the build outright rather than at runtime.
      expect(DefaultFirebaseOptions.android.appId, startsWith('1:813389632700:android:'));
    });

    test('the two platforms are distinct app registrations', () {
      // Reusing one appId across platforms silently misattributes every metric
      // and breaks per-platform config in the console.
      expect(
        DefaultFirebaseOptions.android.appId,
        isNot(DefaultFirebaseOptions.ios.appId),
      );
    });
  });
}
