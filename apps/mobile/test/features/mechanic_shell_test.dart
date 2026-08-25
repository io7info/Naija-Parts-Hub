import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:naija_parts_hub/design/theme.dart';
import 'package:naija_parts_hub/features/mechanic/mechanic_photos_screen.dart';
import 'package:naija_parts_hub/features/mechanic/mechanic_profile_screen.dart';
import 'package:naija_parts_hub/features/registration/mechanic_identity_screen.dart';
import 'package:naija_parts_hub/features/registration/mechanic_registration_screen.dart'
    show maxWorkshopPhotos;
import 'package:naija_parts_hub/features/shell/mechanic_shell.dart';
import 'package:naija_parts_hub/models/store.dart';

import '../support/mechanic_doubles.dart';

/// The approved mechanic's app.
///
/// The shape being defended: a mechanic has services, photographs and an
/// account, and nothing else. No listings, no quota, no subscription, no
/// upgrade prompt. Those belong to a dealer, and every one of them appearing
/// here would be a promise the platform does not keep for mechanics.
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

  late MockStoreService store;

  setUp(() {
    store = MockStoreService();
    when(() => store.updateProfile(any(), any())).thenAnswer((_) async {});
  });

  Future<void> pumpShell(WidgetTester tester, Store s) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: mechanicOverrides(storeService: store),
        child: MaterialApp(theme: buildNphTheme(), home: MechanicShell(store: s)),
      ),
    );
    await tester.pump();
  }

  Future<void> pumpProfile(WidgetTester tester, Store s) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: mechanicOverrides(storeService: store),
        child: MaterialApp(
          theme: buildNphTheme(),
          home: Scaffold(body: MechanicProfileScreen(store: s)),
        ),
      ),
    );
    await tester.pump();
  }

  Future<void> pumpPhotos(WidgetTester tester, Store s) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: mechanicOverrides(storeService: store),
        child: MaterialApp(
          theme: buildNphTheme(),
          home: Scaffold(body: MechanicPhotosScreen(store: s)),
        ),
      ),
    );
    await tester.pump();
  }

  group('shell', () {
    testWidgets('lays out without throwing', (tester) async {
      await pumpShell(tester, mechanicStore());
      expect(tester.takeException(), isNull);
    });

    testWidgets('shows exactly three tabs', (tester) async {
      await pumpShell(tester, mechanicStore());

      for (final label in ['My Workshop', 'Photos', 'Account']) {
        expect(find.text(label), findsOneWidget, reason: '$label tab is missing');
      }
      expect(find.byType(NavigationDestination), findsNWidgets(3));
    });

    testWidgets('offers nothing a mechanic does not have', (tester) async {
      await pumpShell(tester, mechanicStore());

      // MainShell's tabs. A mechanic has no inventory, so an Add Listing
      // button here would lead somewhere that cannot work.
      for (final dealerOnly in ['Listings', 'Add Listing', 'My Store']) {
        expect(find.text(dealerOnly), findsNothing,
            reason: '$dealerOnly belongs to the dealer shell');
      }
      expect(find.text('Active Listings'), findsNothing);
      expect(find.text('Free Plan'), findsNothing);
      expect(find.textContaining('Upgrade'), findsNothing);
    });

    testWidgets('every tab is hit-testable', (tester) async {
      await pumpShell(tester, mechanicStore());

      for (final label in ['My Workshop', 'Photos', 'Account']) {
        expect(find.text(label).hitTestable(), findsOneWidget,
            reason: '$label is rendered but cannot receive a tap');
      }
    });

    testWidgets('opens on the workshop profile', (tester) async {
      await pumpShell(tester, mechanicStore());

      expect(find.text('Kunle Auto Works'), findsOneWidget);
      expect(find.text('Services you offer'), findsOneWidget);
    });

    testWidgets('tapping Photos shows the gallery', (tester) async {
      await pumpShell(tester, mechanicStore());

      await tester.tap(find.text('Photos'));
      await tester.pumpAndSettle();

      expect(find.text('Your work'), findsOneWidget);
    });

    testWidgets('tapping Account shows the account pane', (tester) async {
      await pumpShell(tester, mechanicStore());

      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();

      expect(find.text('Delete Account'), findsOneWidget);
    });

    testWidgets('an unsaved service selection survives a tab round trip',
        (tester) async {
      // IndexedStack, matching MainShell: switching tabs must not rebuild a
      // pane and throw away a half-made edit.
      await pumpShell(tester, mechanicStore(specialties: const ['engine']));

      await tester.tap(find.widgetWithText(FilterChip, 'AC repair'));
      await tester.pump();

      await tester.tap(find.text('Photos'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('My Workshop'));
      await tester.pumpAndSettle();

      final chip = tester.widget<FilterChip>(
        find.widgetWithText(FilterChip, 'AC repair'),
      );
      expect(chip.selected, isTrue, reason: 'switching tabs discarded an edit');
    });

    testWidgets('a pending mechanic still gets the shell without throwing',
        (tester) async {
      await pumpShell(tester, mechanicStore(status: StoreStatus.pending));
      expect(tester.takeException(), isNull);
    });
  });

  group('profile — services', () {
    testWidgets('pre-selects what the mechanic already offers', (tester) async {
      await pumpProfile(tester, mechanicStore(specialties: const ['engine', 'ac']));

      FilterChip chip(String label) =>
          tester.widget<FilterChip>(find.widgetWithText(FilterChip, label));

      expect(chip('Engine repair').selected, isTrue);
      expect(chip('AC repair').selected, isTrue);
      expect(chip('Suspension').selected, isFalse);
    });

    testWidgets('saving writes the ids, not the labels', (tester) async {
      await pumpProfile(tester, mechanicStore(specialties: const ['engine']));

      await tester.tap(find.widgetWithText(FilterChip, 'Computer diagnostics'));
      await tester.pump();

      final save = find.widgetWithText(FilledButton, 'Save services');
      await tester.ensureVisible(save);
      await tester.tap(save);
      await tester.pumpAndSettle();

      final patch = verify(
        () => store.updateProfile('mechanic-1', captureAny()),
      ).captured.single as Map<String, dynamic>;

      expect(patch['mechanic']['specialties'], ['engine', 'diagnostics']);
    });

    testWidgets('saving preserves the photos it did not touch', (tester) async {
      // The whole `mechanic` map is rewritten, so dropping photos here would
      // silently wipe a gallery on every service edit.
      await pumpProfile(
        tester,
        mechanicStore(
          specialties: const ['engine'],
          photos: const ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'],
        ),
      );

      final save = find.widgetWithText(FilledButton, 'Save services');
      await tester.ensureVisible(save);
      await tester.tap(save);
      await tester.pumpAndSettle();

      final patch = verify(
        () => store.updateProfile(any(), captureAny()),
      ).captured.single as Map<String, dynamic>;

      expect(patch['mechanic']['photos'], [
        'https://cdn.example/a.jpg',
        'https://cdn.example/b.jpg',
      ]);
    });

    testWidgets('clearing every service is refused with a reason', (tester) async {
      await pumpProfile(tester, mechanicStore(specialties: const ['engine']));

      await tester.tap(find.widgetWithText(FilterChip, 'Engine repair'));
      await tester.pump();

      final save = find.widgetWithText(FilledButton, 'Save services');
      await tester.ensureVisible(save);
      await tester.tap(save);
      await tester.pumpAndSettle();

      expect(find.textContaining('Keep at least one service'), findsOneWidget);
      verifyNever(() => store.updateProfile(any(), any()));
    });

    testWidgets('confirms a successful save', (tester) async {
      await pumpProfile(tester, mechanicStore(specialties: const ['engine']));

      final save = find.widgetWithText(FilledButton, 'Save services');
      await tester.ensureVisible(save);
      await tester.tap(save);
      await tester.pumpAndSettle();

      expect(find.text('Services updated'), findsOneWidget);
    });
  });

  group('profile — identity card', () {
    testWidgets('verified shows the last four digits and no call to action',
        (tester) async {
      await pumpProfile(tester, mechanicStore(identity: IdentityStatus.verified));

      expect(find.text('Identity verified'), findsOneWidget);
      expect(find.textContaining('BVN ending 4821'), findsOneWidget);
      expect(find.textContaining('NIN ending 9930'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Verify identity'), findsNothing);
    });

    testWidgets('only the last four digits — never a full number', (tester) async {
      await pumpProfile(tester, mechanicStore(identity: IdentityStatus.verified));

      // The document holds nothing longer than this, and the screen must not
      // invent it. Eleven consecutive digits anywhere on this pane would mean
      // a raw identifier had reached the client.
      final elevenDigits = RegExp(r'\d{11}');
      for (final text in tester.widgetList<Text>(find.byType(Text))) {
        final data = text.data ?? '';
        expect(elevenDigits.hasMatch(data), isFalse,
            reason: 'a full identifier appears in "$data"');
      }
    });

    testWidgets('manual review explains the wait and asks for nothing',
        (tester) async {
      await pumpProfile(tester, mechanicStore(identity: IdentityStatus.manualReview));

      expect(find.text('Under review'), findsOneWidget);
      expect(find.textContaining('you do not need to do anything'), findsOneWidget);
    });

    testWidgets('failed offers a retry', (tester) async {
      await pumpProfile(tester, mechanicStore(identity: IdentityStatus.failed));

      expect(find.text('Verification failed'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Verify identity'), findsOneWidget);
    });

    testWidgets('unverified says approval is blocked on it', (tester) async {
      await pumpProfile(
        tester,
        mechanicStore(
          status: StoreStatus.pending,
          identity: IdentityStatus.unverified,
          bvnLast4: null,
          ninLast4: null,
        ),
      );

      expect(find.text('Identity not verified'), findsOneWidget);
      expect(
        find.textContaining('cannot be approved until your identity is verified'),
        findsOneWidget,
      );
    });

    testWidgets('a forced re-verification is framed as ours, not theirs',
        (tester) async {
      // Raised by the compromised-fingerprint-key sweep. A mechanic who reads
      // "verification failed" here would think they had done something wrong.
      await pumpProfile(
        tester,
        mechanicStore(
          identity: IdentityStatus.unverified,
          reverificationRequired: true,
        ),
      );

      expect(find.text('Please verify again'), findsOneWidget);
      expect(
        find.textContaining('This is not a problem with your account'),
        findsOneWidget,
      );
    });

    testWidgets('the retry button reaches identity verification', (tester) async {
      // Regression: this was a pushNamed against a route table the app does
      // not have, which threw instead of opening anything.
      await pumpProfile(tester, mechanicStore(identity: IdentityStatus.failed));

      final button = find.widgetWithText(FilledButton, 'Verify identity');
      await tester.ensureVisible(button);
      await tester.tap(button);
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.byType(MechanicIdentityScreen), findsOneWidget);
    });
  });

  group('profile — public link', () {
    testWidgets('an approved mechanic sees their public URL', (tester) async {
      await pumpProfile(tester, mechanicStore(status: StoreStatus.approved));

      expect(find.textContaining('/mechanic/kunle-auto-works'), findsOneWidget);
    });

    testWidgets('a pending mechanic is not handed a link that 404s',
        (tester) async {
      await pumpProfile(tester, mechanicStore(status: StoreStatus.pending));

      expect(find.textContaining('/mechanic/kunle-auto-works'), findsNothing);
      expect(
        find.textContaining('goes live once your application is approved'),
        findsOneWidget,
      );
    });
  });

  group('photos', () {
    testWidgets('counts against the ten-photo allowance', (tester) async {
      await pumpPhotos(
        tester,
        mechanicStore(photos: const [
          'https://cdn.example/a.jpg',
          'https://cdn.example/b.jpg',
          'https://cdn.example/c.jpg',
        ]),
      );

      expect(find.text('3 of 10 photos. Buyers see these on your profile.'),
          findsOneWidget);
    });

    testWidgets('an empty gallery argues for filling it', (tester) async {
      await pumpPhotos(tester, mechanicStore(photos: const []));

      expect(find.textContaining('No photos yet'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Camera'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Gallery'), findsOneWidget);
    });

    testWidgets('at ten the add buttons are withdrawn', (tester) async {
      await pumpPhotos(
        tester,
        mechanicStore(
          photos: List.generate(maxWorkshopPhotos, (i) => 'https://cdn.example/$i.jpg'),
        ),
      );

      expect(find.widgetWithText(OutlinedButton, 'Camera'), findsNothing);
      expect(find.widgetWithText(OutlinedButton, 'Gallery'), findsNothing);
      expect(
        find.textContaining('maximum of 10 photos. Remove one to add another'),
        findsOneWidget,
      );
    });

    testWidgets('removing a photo writes the remaining array', (tester) async {
      await pumpPhotos(
        tester,
        mechanicStore(photos: const [
          'https://cdn.example/a.jpg',
          'https://cdn.example/b.jpg',
        ]),
      );

      await tester.tap(find.byIcon(Icons.close).first);
      await tester.pumpAndSettle();

      final patch = verify(
        () => store.updateProfile('mechanic-1', captureAny()),
      ).captured.single as Map<String, dynamic>;

      expect(patch['mechanic']['photos'], ['https://cdn.example/b.jpg']);
    });

    testWidgets('removing preserves the specialties it did not touch',
        (tester) async {
      await pumpPhotos(
        tester,
        mechanicStore(
          specialties: const ['engine', 'brakes'],
          photos: const ['https://cdn.example/a.jpg'],
        ),
      );

      await tester.tap(find.byIcon(Icons.close).first);
      await tester.pumpAndSettle();

      final patch = verify(
        () => store.updateProfile(any(), captureAny()),
      ).captured.single as Map<String, dynamic>;

      expect(patch['mechanic']['specialties'], ['engine', 'brakes']);
    });

    testWidgets('a failed write leaves the gallery as it was and says so',
        (tester) async {
      when(() => store.updateProfile(any(), any())).thenThrow(Exception('offline'));

      await pumpPhotos(
        tester,
        mechanicStore(photos: const [
          'https://cdn.example/a.jpg',
          'https://cdn.example/b.jpg',
        ]),
      );

      await tester.tap(find.byIcon(Icons.close).first);
      await tester.pumpAndSettle();

      expect(find.text('2 of 10 photos. Buyers see these on your profile.'),
          findsOneWidget,
          reason: 'the count must not claim a deletion that did not happen');
    });
  });
}
