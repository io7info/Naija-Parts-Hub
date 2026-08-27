import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:naija_parts_hub/core/env.dart';
import 'package:naija_parts_hub/design/components.dart';
import 'package:naija_parts_hub/design/theme.dart';
import 'package:naija_parts_hub/features/registration/business_type_screen.dart';
import 'package:naija_parts_hub/features/registration/mechanic_registration_screen.dart';
import 'package:naija_parts_hub/features/registration/registration_screen.dart';
import 'package:naija_parts_hub/services/feature_flags_service.dart';

import '../support/mechanic_doubles.dart';

/// The gate that keeps Auto Mechanic out of production until KYC is live.
///
/// This is the highest-consequence code in the mechanic feature. If the flag
/// reads wrong, a real mechanic in Lagos is offered a signup path that ends at
/// an identity check the platform cannot perform — the exact outcome the
/// client ruled out ("do not expose a signup path that users cannot
/// complete").
///
/// So the assertions here are about two separate things, and both matter:
/// what the flag RESOLVES to under every degraded condition, and what the UI
/// DOES with it.
Widget _app({required bool enabled, Widget? home}) {
  return ProviderScope(
    overrides: mechanicOverrides(mechanicSignupEnabled: enabled),
    child: MaterialApp(
      theme: buildNphTheme(),
      home: home ?? const BusinessTypeScreen(),
    ),
  );
}

void main() {
  setUpAll(registerMechanicFallbacks);

  setUp(() {
    final view = TestWidgetsFlutterBinding.ensureInitialized().platformDispatcher.views.first;
    view.devicePixelRatio = 1.0;
    view.physicalSize = const Size(400, 900);
  });

  tearDown(() {
    final view = TestWidgetsFlutterBinding.ensureInitialized().platformDispatcher.views.first;
    view.resetPhysicalSize();
    view.resetDevicePixelRatio();
  });

  group('flag parsing', () {
    test('an explicit true switches mechanics on', () {
      expect(
        FeatureFlags.fromMap({'mechanicSignupEnabled': true}).mechanicSignupEnabled,
        isTrue,
      );
    });

    test('an explicit false switches mechanics off, whatever the build says', () {
      expect(
        FeatureFlags.fromMap({'mechanicSignupEnabled': false}).mechanicSignupEnabled,
        isFalse,
        reason: 'the remote kill switch must beat the compile-time default',
      );
    });

    test('a missing document falls back to the build default', () {
      expect(
        FeatureFlags.fromMap(null).mechanicSignupEnabled,
        Env.mechanicSignupDefault,
      );
    });

    test('a document without the key falls back to the build default', () {
      expect(
        FeatureFlags.fromMap({'someOtherFlag': true}).mechanicSignupEnabled,
        Env.mechanicSignupDefault,
      );
    });

    test('a value of the wrong type falls back rather than being coerced', () {
      // 'true' as a string is the realistic mistake — someone editing the
      // document in the Firebase console picks the wrong field type. Coercing
      // it would switch a feature on by accident.
      for (final bad in <Object>['true', 1, 'yes', <String>[]]) {
        expect(
          FeatureFlags.fromMap({'mechanicSignupEnabled': bad}).mechanicSignupEnabled,
          Env.mechanicSignupDefault,
          reason: '$bad (${bad.runtimeType}) must not be read as a boolean',
        );
      }
    });

    test('the build default is tied to the build mode', () {
      // Pins the relationship rather than the value: release builds must not
      // offer mechanic signup, debug and profile builds must, so a developer
      // can exercise the flow without seeding a config document.
      expect(
        Env.mechanicSignupDefault,
        equals(!kReleaseMode),
        reason: 'a hard-coded default here is what would leak the flow into production',
      );
    });
  });

  group('flag resolution never blocks the UI', () {
    test('while the document is still loading, the build default applies', () {
      final c = ProviderContainer(
        overrides: [
          // A stream that never emits — a cold start with no network.
          featureFlagsProvider.overrideWith((ref) => const Stream<FeatureFlags>.empty()),
        ],
      );
      addTearDown(c.dispose);
      c.listen(mechanicSignupEnabledProvider, (_, __) {});

      expect(
        c.read(mechanicSignupEnabledProvider),
        Env.mechanicSignupDefault,
        reason: 'a spinner in place of a registration choice would be worse than a default',
      );
    });

    test('a read failure resolves to the build default, not to an error', () async {
      final c = ProviderContainer(
        overrides: [
          featureFlagsProvider.overrideWith(
            (ref) => Stream<FeatureFlags>.error(Exception('permission-denied')),
          ),
        ],
      );
      addTearDown(c.dispose);
      c.listen(mechanicSignupEnabledProvider, (_, __) {});

      await pumpEventQueue();

      expect(
        c.read(mechanicSignupEnabledProvider),
        Env.mechanicSignupDefault,
        reason: 'a feature flag must never be able to block a dealer from registering',
      );
    });
  });

  group('mechanic signup OFF — production today', () {
    testWidgets('the dealer wizard is what renders, not a one-option selector',
        (tester) async {
      await tester.pumpWidget(_app(enabled: false));
      await tester.pump();

      expect(find.byType(RegistrationScreen), findsOneWidget);
      expect(find.text('Register Your Store'), findsOneWidget);
    });

    testWidgets('the selector is never built at all', (tester) async {
      await tester.pumpWidget(_app(enabled: false));
      await tester.pump();

      // Not "rendered then hidden" — absent. Nothing on screen, and nothing in
      // the tree, can lead a user toward an identity check that cannot run.
      expect(find.text('What kind of business?'), findsNothing);
      expect(find.text('Auto Mechanic'), findsNothing);
      expect(find.text('Parts Dealer'), findsNothing);
      expect(find.byType(MechanicRegistrationScreen), findsNothing);
    });

    testWidgets('no BVN or NIN wording is reachable from registration', (tester) async {
      await tester.pumpWidget(_app(enabled: false));
      await tester.pump();

      expect(find.textContaining('BVN'), findsNothing);
      expect(find.textContaining('NIN'), findsNothing);
    });
  });

  group('mechanic signup ON', () {
    testWidgets('both business types are offered', (tester) async {
      await tester.pumpWidget(_app(enabled: true));
      await tester.pump();

      expect(find.text('What kind of business?'), findsOneWidget);
      expect(find.text('Parts Dealer'), findsOneWidget);
      expect(find.text('Auto Mechanic'), findsOneWidget);
      expect(find.text('I sell auto parts'), findsOneWidget);
      expect(find.text('I repair and service vehicles'), findsOneWidget);
    });

    testWidgets('the choice is stated to be permanent', (tester) async {
      await tester.pumpWidget(_app(enabled: true));
      await tester.pump();

      // businessType is set once at registration and never rewritten, so a
      // mechanic who picks Parts Dealer is stuck. Saying so up front is the
      // only warning they get.
      expect(find.textContaining('cannot change it later'), findsOneWidget);
    });

    testWidgets('the mechanic card discloses BVN and NIN before the tap',
        (tester) async {
      await tester.pumpWidget(_app(enabled: true));
      await tester.pump();

      // Nobody should discover a BVN requirement four steps into a form.
      expect(find.textContaining('verify your identity with BVN and NIN'), findsOneWidget);
    });

    testWidgets('both cards are hit-testable', (tester) async {
      await tester.pumpWidget(_app(enabled: true));
      await tester.pump();

      expect(find.text('Parts Dealer').hitTestable(), findsOneWidget);
      expect(find.text('Auto Mechanic').hitTestable(), findsOneWidget);
    });

    testWidgets('Parts Dealer opens the existing dealer wizard', (tester) async {
      await tester.pumpWidget(_app(enabled: true));
      await tester.pump();

      await tester.tap(find.text('Parts Dealer'));
      await tester.pumpAndSettle();

      expect(find.byType(RegistrationScreen), findsOneWidget);
      expect(find.text('Register Your Store'), findsOneWidget);
    });

    testWidgets('Auto Mechanic opens the mechanic wizard', (tester) async {
      await tester.pumpWidget(_app(enabled: true));
      await tester.pump();

      await tester.tap(find.text('Auto Mechanic'));
      await tester.pumpAndSettle();

      expect(find.byType(MechanicRegistrationScreen), findsOneWidget);
      expect(find.text('Mechanic sign-up · Workshop'), findsOneWidget);
    });
  });

  group('flipping the flag reaches a running app', () {
    testWidgets('a live switch to true reveals the selector without a restart',
        (tester) async {
      // The whole reason the flag is a Firestore stream rather than a constant:
      // it can be switched on the day Dojah goes live, without a Play release.
      final flags = StreamController<FeatureFlags>();
      addTearDown(flags.close);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            ...mechanicOverrides(),
            featureFlagsProvider.overrideWith((ref) => flags.stream),
          ],
          child: MaterialApp(theme: buildNphTheme(), home: const BusinessTypeScreen()),
        ),
      );

      flags.add(const FeatureFlags(mechanicSignupEnabled: false));
      await tester.pump();
      expect(find.text('What kind of business?'), findsNothing);

      flags.add(const FeatureFlags(mechanicSignupEnabled: true));
      await tester.pump();
      expect(find.text('What kind of business?'), findsOneWidget);
      expect(find.text('Auto Mechanic'), findsOneWidget);
    });

    testWidgets('a live switch to false withdraws it again', (tester) async {
      // The kill switch. If Dojah goes down, mechanic signup has to stop
      // without shipping anything.
      final flags = StreamController<FeatureFlags>();
      addTearDown(flags.close);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            ...mechanicOverrides(),
            featureFlagsProvider.overrideWith((ref) => flags.stream),
          ],
          child: MaterialApp(theme: buildNphTheme(), home: const BusinessTypeScreen()),
        ),
      );

      flags.add(const FeatureFlags(mechanicSignupEnabled: true));
      await tester.pumpAndSettle();
      expect(find.text('Auto Mechanic'), findsOneWidget);

      flags.add(const FeatureFlags(mechanicSignupEnabled: false));
      await tester.pumpAndSettle();
      expect(find.text('Auto Mechanic'), findsNothing);
      expect(find.byType(RegistrationScreen), findsOneWidget);
    });
  });

  group('registration entry point', () {
    test('is the business-type screen, which decides for itself', () {
      // app_gate asks for "the registration entry point" and does not know the
      // flag exists. Keeping that indirection means the gate cannot drift out
      // of step with the flag.
      expect(registrationEntryPoint(), isA<BusinessTypeScreen>());
    });
  });

  group('the two business types are visually distinguishable', () {
    testWidgets('each card names what the account will be', (tester) async {
      await tester.pumpWidget(_app(enabled: true));
      await tester.pump();

      // The choice cannot be changed afterwards, so the difference has to be
      // stated rather than inferred from an icon: a dealer manages inventory,
      // a mechanic is found by their services.
      expect(find.text('Inventory'), findsOneWidget);
      expect(find.text('Services'), findsOneWidget);
    });

    testWidgets('both cards sit on the shared card surface', (tester) async {
      await tester.pumpWidget(_app(enabled: true));
      await tester.pump();

      // NphCard, not a bespoke container — same radius, border and surface as
      // every other card in the app.
      expect(find.byType(NphCard), findsNWidgets(2));
    });

    testWidgets('the dealer card promises inventory, not services', (tester) async {
      await tester.pumpWidget(_app(enabled: true));
      await tester.pump();

      expect(find.textContaining('List parts with prices and photos'), findsOneWidget);
      expect(find.textContaining('Advertise the services you offer'), findsOneWidget);
    });

    testWidgets('the mechanic card warns about BVN and NIN up front', (tester) async {
      await tester.pumpWidget(_app(enabled: true));
      await tester.pump();

      // Nobody should discover a BVN requirement four steps into a form.
      expect(find.textContaining('verify your identity with BVN and NIN'), findsOneWidget);
    });
  });

  group('the selector is not a dead end', () {
    testWidgets('offers a way to sign out', (tester) async {
      // This screen is the gate's root when a signed-in user has no store —
      // no back button, because there is nothing behind it. Someone who
      // signed in on the wrong number could otherwise neither register as
      // themselves nor leave, short of clearing the app's data.
      await tester.pumpWidget(_app(enabled: true));
      await tester.pump();

      expect(find.widgetWithText(TextButton, 'Sign Out'), findsOneWidget);
    });

    testWidgets('signing out actually calls the service', (tester) async {
      final auth = authDouble();
      await tester.pumpWidget(
        ProviderScope(
          overrides: mechanicOverrides(mechanicSignupEnabled: true, authService: auth),
          child: MaterialApp(theme: buildNphTheme(), home: const BusinessTypeScreen()),
        ),
      );
      await tester.pump();

      // Below the fold on a 400x900 viewport — two cards, the guidance text
      // and a divider sit above it.
      final signOut = find.widgetWithText(TextButton, 'Sign Out');
      await tester.ensureVisible(signOut);
      await tester.pumpAndSettle();
      await tester.tap(signOut);
      await tester.pump();

      verify(() => auth.signOut()).called(1);
    });

    testWidgets('shows which number is signed in, so a wrong one is visible',
        (tester) async {
      await tester.pumpWidget(_app(enabled: true));
      await tester.pump();

      // The number is the thing that makes the mistake noticeable at all.
      expect(find.textContaining('Signed in as'), findsOneWidget);
    });
  });
}
