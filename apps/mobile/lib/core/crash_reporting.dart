import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart';

import 'env.dart';

/// Crash and error reporting (SOW §1, "basic error logging and crash monitoring").
///
/// The Crashlytics SDK catches native crashes on its own the moment the plugin
/// is present, which is why the dependency alone looked like it was doing the
/// job. It was not: a Dart exception is not a native crash. Flutter catches
/// those itself and routes them to `FlutterError.onError`, whose default merely
/// prints to the console — so every framework error, failed build and unhandled
/// async throw was invisible in production. Those are the majority of what
/// actually breaks a Flutter app.
///
/// Two handlers are needed, and they cover different things:
///
///   * `FlutterError.onError` — errors raised inside the framework: build,
///     layout and paint failures, and anything thrown in a widget callback.
///   * `PlatformDispatcher.instance.onError` — everything else that reaches the
///     root zone, which is where an unawaited Future's exception lands.
///
/// Without the second, a `Future` that throws with no `await` and no `catch`
/// disappears silently — and this app deliberately leaves writes unawaited so
/// offline saves do not block the UI.
class CrashReporting {
  const CrashReporting._();

  /// True when reports should reach Crashlytics.
  ///
  /// Debug builds are excluded on purpose. Every hot reload, every deliberately
  /// triggered error while working on a screen, and every emulator disconnect
  /// would otherwise land in the same dashboard the team uses to judge whether
  /// production is healthy — and a signal nobody trusts gets ignored. Emulator
  /// runs are excluded for the same reason: they are development, whatever the
  /// build mode says.
  static bool get isEnabled => !kDebugMode && !Env.useEmulator;

  /// Installs the two error handlers. Safe to call once, at startup.
  ///
  /// Called only after Firebase has initialised — Crashlytics needs the default
  /// app, and touching it earlier throws the very error it is meant to report.
  static Future<void> install() async {
    if (!isEnabled) {
      // Still route framework errors somewhere visible in development, which is
      // what the default handler does anyway. Stated explicitly so the disabled
      // path is a decision rather than an omission.
      FlutterError.onError = FlutterError.presentError;
      return;
    }

    final crashlytics = FirebaseCrashlytics.instance;
    await crashlytics.setCrashlyticsCollectionEnabled(true);

    FlutterError.onError = (details) {
      // presentError first: the console output is what a developer reads when
      // reproducing a report, and recordFlutterFatalError does not print.
      FlutterError.presentError(details);
      crashlytics.recordFlutterFatalError(details);
    };

    PlatformDispatcher.instance.onError = (error, stack) {
      crashlytics.recordError(error, stack, fatal: true);
      // true = handled. Returning false would let the error propagate and
      // terminate the isolate, turning a reportable error into a crash.
      return true;
    };
  }

  /// Attaches the signed-in dealer to subsequent reports.
  ///
  /// The store id, which is the dealer's uid — enough to ask "is this one
  /// dealer's device or everyone?", which is usually the first question a crash
  /// report raises. No phone number, name or address: a crash dashboard is not
  /// a place to accumulate personal data.
  static Future<void> setDealer(String? storeId) async {
    if (!isEnabled) return;
    await FirebaseCrashlytics.instance.setUserIdentifier(storeId ?? '');
  }

  /// Reports a caught error that the app handled but should not have hit.
  ///
  /// For the `catch` blocks that degrade gracefully — a failed image upload, a
  /// callable that returned an unexpected code. The dealer sees a friendly
  /// message; this makes sure someone also sees the cause.
  static Future<void> recordHandled(Object error, StackTrace stack, {String? reason}) async {
    if (!isEnabled) {
      debugPrint('Handled error${reason == null ? '' : ' ($reason)'}: $error');
      return;
    }
    await FirebaseCrashlytics.instance.recordError(error, stack, reason: reason, fatal: false);
  }
}
