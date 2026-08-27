import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/env.dart';
import 'store_service.dart';

/// Runtime feature flags, read from `config/features`.
///
/// WHY FIRESTORE RATHER THAN REMOTE CONFIG
///
/// The app already depends on Firestore and already reads it on the path where
/// this is needed, so a flag document costs nothing: no new package, no second
/// SDK to initialise, no extra network stack, no additional failure mode.
/// Firebase Remote Config would be a dependency added for one boolean.
///
/// What it buys over a compile-time constant: mechanic signup can be switched
/// on the day Dojah goes live, without building, signing and pushing a release
/// through Play review.
class FeatureFlags {
  const FeatureFlags({required this.mechanicSignupEnabled});

  /// Whether to offer Auto Mechanic as a registration option.
  final bool mechanicSignupEnabled;

  /// What the build itself says, before any remote document is consulted.
  ///
  /// Debug and profile builds get the mechanic flow; release builds do not.
  static const FeatureFlags fallback =
      FeatureFlags(mechanicSignupEnabled: Env.mechanicSignupDefault);

  /// Reads the document, falling back per-field.
  static FeatureFlags fromSnapshot(DocumentSnapshot<Map<String, dynamic>>? doc) =>
      fromMap(doc?.data());

  /// The parsing rule itself, expressed over a plain map.
  ///
  /// Separate from [fromSnapshot] because `DocumentSnapshot` is sealed and
  /// cannot be faked, so the rule below would otherwise only be reachable
  /// through a live Firestore read — and it is the part with the decisions in
  /// it, not the unwrapping.
  ///
  /// A missing document, a missing key, or a value of the wrong type all fall
  /// back to the build default rather than to `false`. That distinction
  /// matters: an emulator with no seeded config must still show the mechanic
  /// flow to a developer testing it, and a production app must not switch a
  /// feature on because someone wrote a malformed value.
  static FeatureFlags fromMap(Map<String, dynamic>? data) {
    final raw = data?['mechanicSignupEnabled'];
    return FeatureFlags(
      mechanicSignupEnabled: raw is bool ? raw : Env.mechanicSignupDefault,
    );
  }
}

/// Live feature flags.
///
/// A stream rather than a one-shot read, so flipping the flag in Firestore
/// reaches an app that is already open — the registration screen picks up the
/// mechanic option without a restart.
///
/// Errors are not surfaced. If the read fails — offline, rules, a missing
/// document — the build default applies and the app carries on. A feature flag
/// must never be able to block startup: the failure mode of "we could not
/// reach the config" is "behave as this build was compiled to behave", not an
/// error screen in front of a dealer trying to register.
final featureFlagsProvider = StreamProvider<FeatureFlags>((ref) {
  final db = ref.watch(firestoreProvider);
  return db
      .collection('config')
      .doc('features')
      .snapshots()
      .map(FeatureFlags.fromSnapshot)
      .handleError((_) => FeatureFlags.fallback);
});

/// The flags, resolved. Loading and error both read as the build default.
///
/// Callers want a boolean, not an AsyncValue: every use site is "should this
/// option appear", and rendering a spinner in place of a registration choice
/// while a flag loads would be worse than showing the built-in default.
final mechanicSignupEnabledProvider = Provider<bool>((ref) {
  return ref
      .watch(featureFlagsProvider)
      .maybeWhen(data: (f) => f.mechanicSignupEnabled, orElse: () => Env.mechanicSignupDefault);
});
