import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:naija_parts_hub/design/theme.dart';
import 'package:naija_parts_hub/features/auth/phone_login_screen.dart';
import 'package:naija_parts_hub/features/gate/app_gate.dart';
import 'package:naija_parts_hub/features/pending/pending_screen.dart';
import 'package:naija_parts_hub/features/registration/business_type_screen.dart';
import 'package:naija_parts_hub/features/registration/registration_screen.dart';
import 'package:naija_parts_hub/features/shell/main_shell.dart';
import 'package:naija_parts_hub/features/shell/mechanic_shell.dart';
import 'package:naija_parts_hub/features/splash/splash_screen.dart';
import 'package:naija_parts_hub/models/store.dart';
import 'package:naija_parts_hub/services/auth_service.dart';
import 'package:naija_parts_hub/services/feature_flags_service.dart';
import 'package:naija_parts_hub/services/identity_service.dart';
import 'package:naija_parts_hub/services/store_service.dart';

import '../support/mechanic_doubles.dart';
import '../support/test_providers.dart';

/// Where the gate sends a signed-in business.
///
/// This is the one place in the app that decides which product a person is
/// using, so a mistake here is total: a mechanic dropped into the dealer shell
/// gets an Add Listing button that leads nowhere, and a dealer dropped into the
/// mechanic shell loses their entire inventory from the interface.
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

  /// Everything the gate and its destinations resolve.
  ///
  /// Built explicitly rather than by combining the two shared bundles, which
  /// both override the upload service — a duplicate override is an assertion
  /// failure, not a last-one-wins.
  List<Override> gateOverrides({
    required Stream<User?> auth,
    required Stream<Store?> store,
    bool mechanicSignupEnabled = false,
  }) {
    return [
      ...commonOverrides(),
      featureFlagsProvider.overrideWith(
        (ref) => Stream.value(FeatureFlags(mechanicSignupEnabled: mechanicSignupEnabled)),
      ),
      storeServiceProvider.overrideWithValue(MockStoreService()),
      identityServiceProvider.overrideWithValue(
        identityDouble(const IdentityResult(IdentityOutcome.verified)),
      ),
      authServiceProvider.overrideWithValue(authDouble()),
      authStateProvider.overrideWith((ref) => auth),
      myStoreProvider.overrideWith((ref) => store),
    ];
  }

  /// Pumps a bounded number of frames rather than settling.
  ///
  /// `pumpAndSettle` cannot be used anywhere the gate may pass through
  /// SplashScreen: its CircularProgressIndicator schedules frames forever, so
  /// settling never completes and the test dies on a ten-minute timeout rather
  /// than on the assertion that failed. Three streams have to land here — auth,
  /// the store document, and the feature flags the registration entry point
  /// reads — so a handful of frames, not one.
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 16));
    }
  }

  Future<void> pumpGate(
    WidgetTester tester, {
    Stream<User?>? auth,
    Stream<Store?>? store,
    bool mechanicSignupEnabled = false,
  }) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: gateOverrides(
          auth: auth ?? Stream.value(mockUser()),
          store: store ?? Stream.value(null),
          mechanicSignupEnabled: mechanicSignupEnabled,
        ),
        child: MaterialApp(theme: buildNphTheme(), home: const AppGate()),
      ),
    );
    await settle(tester);
  }

  group('before a store exists', () {
    testWidgets('no user lands on phone sign-in', (tester) async {
      await pumpGate(tester, auth: Stream.value(null));

      expect(find.byType(PhoneLoginScreen), findsOneWidget);
    });

    testWidgets('auth still resolving shows the splash, not a login flash',
        (tester) async {
      // A login screen that appears for one frame and vanishes is how Android
      // instant verification used to look — as if the app had forgotten them.
      await pumpGate(tester, auth: const Stream<User?>.empty());

      expect(find.byType(SplashScreen), findsOneWidget);
      expect(find.byType(PhoneLoginScreen), findsNothing);
    });

    testWidgets('signed in with no store goes to the registration entry point',
        (tester) async {
      await pumpGate(tester, store: Stream.value(null));

      expect(find.byType(BusinessTypeScreen), findsOneWidget);
    });

    testWidgets('with mechanic signup off that is the dealer wizard, unchanged',
        (tester) async {
      await pumpGate(tester, store: Stream.value(null), mechanicSignupEnabled: false);

      expect(find.byType(RegistrationScreen), findsOneWidget);
      expect(find.text('Register Your Store'), findsOneWidget);
      expect(find.text('What kind of business?'), findsNothing);
    });

    testWidgets('with mechanic signup on the choice appears', (tester) async {
      await pumpGate(tester, store: Stream.value(null), mechanicSignupEnabled: true);

      expect(find.text('What kind of business?'), findsOneWidget);
    });
  });

  group('routing by business type', () {
    testWidgets('an approved dealer gets MainShell', (tester) async {
      await pumpGate(tester, store: Stream.value(dealerStore()));

      expect(find.byType(MainShell), findsOneWidget);
      expect(find.byType(MechanicShell), findsNothing);
    });

    testWidgets('an approved mechanic gets MechanicShell', (tester) async {
      await pumpGate(tester, store: Stream.value(mechanicStore()));

      expect(find.byType(MechanicShell), findsOneWidget);
      expect(find.byType(MainShell), findsNothing);
    });

    testWidgets('a mechanic never sees the dealer inventory tabs', (tester) async {
      await pumpGate(tester, store: Stream.value(mechanicStore()));

      expect(find.text('Add Listing'), findsNothing);
      expect(find.text('My Store'), findsNothing);
    });

    testWidgets('a dealer keeps all five of theirs', (tester) async {
      await pumpGate(tester, store: Stream.value(dealerStore()));

      for (final label in ['Home', 'Listings', 'Add Listing', 'My Store', 'Account']) {
        expect(find.text(label), findsWidgets, reason: '$label went missing');
      }
    });

    testWidgets('an unverified mechanic still reaches their own shell once approved',
        (tester) async {
      // Approval already implies verification — adminReviewStore refuses to
      // approve an unverified mechanic — but the shell must not be the thing
      // enforcing it, or a data anomaly locks someone out of their account
      // rather than showing them what is wrong.
      await pumpGate(
        tester,
        store: Stream.value(
          mechanicStore(identity: IdentityStatus.unverified, bvnLast4: null, ninLast4: null),
        ),
      );

      expect(find.byType(MechanicShell), findsOneWidget);
      expect(find.text('Identity not verified'), findsOneWidget);
    });
  });

  group('routing by status', () {
    for (final status in [
      StoreStatus.pending,
      StoreStatus.rejected,
      StoreStatus.suspended,
    ]) {
      testWidgets('a $status dealer gets the status screen', (tester) async {
        await pumpGate(tester, store: Stream.value(dealerStore(status: status)));

        expect(find.byType(PendingScreen), findsOneWidget);
        expect(find.byType(MainShell), findsNothing);
      });

      testWidgets('a $status mechanic gets the same status screen',
          (tester) async {
        // Shared deliberately: the approval lifecycle is the one thing the two
        // business types genuinely have in common.
        await pumpGate(tester, store: Stream.value(mechanicStore(status: status)));

        expect(find.byType(PendingScreen), findsOneWidget);
        expect(find.byType(MechanicShell), findsNothing);
      });
    }
  });

  group('live transitions', () {
    testWidgets('approval moves a mechanic from pending to their shell without a restart',
        (tester) async {
      final store = StreamController<Store?>();
      addTearDown(store.close);

      await tester.pumpWidget(
        ProviderScope(
          overrides: gateOverrides(auth: Stream.value(mockUser()), store: store.stream),
          child: MaterialApp(theme: buildNphTheme(), home: const AppGate()),
        ),
      );

      store.add(mechanicStore(status: StoreStatus.pending));
      await settle(tester);
      expect(find.byType(PendingScreen), findsOneWidget);

      store.add(mechanicStore(status: StoreStatus.approved));
      await settle(tester);
      expect(find.byType(MechanicShell), findsOneWidget);
      expect(find.byType(PendingScreen), findsNothing);
    });

    testWidgets('completing registration moves off the wizard', (tester) async {
      final store = StreamController<Store?>();
      addTearDown(store.close);

      await tester.pumpWidget(
        ProviderScope(
          overrides: gateOverrides(auth: Stream.value(mockUser()), store: store.stream),
          child: MaterialApp(theme: buildNphTheme(), home: const AppGate()),
        ),
      );

      store.add(null);
      await settle(tester);
      expect(find.byType(RegistrationScreen), findsOneWidget);

      store.add(mechanicStore(status: StoreStatus.pending));
      await settle(tester);
      expect(find.byType(PendingScreen), findsOneWidget);
    });
  });

  group('failures', () {
    testWidgets('a store read failure offers a way out rather than a dead end',
        (tester) async {
      await pumpGate(
        tester,
        store: Stream<Store?>.error(Exception('permission-denied')),
      );

      expect(find.text('Could not load your business'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Sign out'), findsOneWidget);
    });

    testWidgets('an auth failure does the same', (tester) async {
      await pumpGate(tester, auth: Stream<User?>.error(Exception('network')));

      expect(find.text('Sign-in problem'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Sign out'), findsOneWidget);
    });
  });
}
