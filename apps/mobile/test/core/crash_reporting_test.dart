import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:naija_parts_hub/core/crash_reporting.dart';
import 'package:naija_parts_hub/core/env.dart';

/// Crash reporting is switched on for the builds that matter and off for the
/// ones that do not.
///
/// The interesting assertion is the negative one. Crashlytics reports are only
/// worth reading if they describe real dealers: a dashboard filling up with
/// hot-reload errors and emulator disconnects from a developer's machine is one
/// nobody checks, and an unchecked dashboard is the same as no dashboard.
///
/// What is NOT asserted here is that a thrown error reaches Crashlytics —
/// `FirebaseCrashlytics.instance` needs a real Firebase app and a platform
/// channel, neither of which exists in a test binding. That path is exercised
/// by the release build itself; what can be pinned down here is the decision
/// about when to report at all, which is the part that was wrong.
void main() {
  group('reporting is enabled only where it is useful', () {
    test('never in a debug build', () {
      // `flutter test` runs in debug, so this is the live case: the guard has
      // to be false right now, which also means these tests cannot accidentally
      // send anything.
      expect(kDebugMode, isTrue, reason: 'flutter test runs in debug mode');
      expect(CrashReporting.isEnabled, isFalse);
    });

    test('never while pointed at the emulators', () {
      // Emulator runs are development regardless of build mode. A profile build
      // against localhost is still someone at a desk, not a dealer in Ladipo.
      expect(Env.useEmulator, isTrue, reason: 'tests default to the emulator profile');
      expect(CrashReporting.isEnabled, isFalse);
    });
  });

  group('installing the handlers', () {
    tearDown(() {
      // Restore whatever the test harness expects, or a later test that pumps a
      // widget will report its own failures through a handler this one left.
      FlutterError.onError = FlutterError.presentError;
    });

    test('still routes framework errors somewhere visible when disabled', () async {
      await CrashReporting.install();

      // The disabled path must not leave onError null: that would swallow every
      // framework error silently, which is worse than the default.
      expect(FlutterError.onError, isNotNull);
      expect(FlutterError.onError, same(FlutterError.presentError));
    });

    test('a handled error is logged rather than thrown when disabled', () async {
      // recordHandled is called from catch blocks that degrade gracefully. If it
      // threw when reporting was off, it would turn a recovered error into a
      // crash — in development only, which is the worst place to discover it.
      await expectLater(
        CrashReporting.recordHandled(
          StateError('upload failed'),
          StackTrace.current,
          reason: 'image upload',
        ),
        completes,
      );
    });

    test('setDealer is a no-op rather than an error when disabled', () async {
      await expectLater(CrashReporting.setDealer('dealer-1'), completes);
      await expectLater(CrashReporting.setDealer(null), completes);
    });
  });
}
