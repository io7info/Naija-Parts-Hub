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
