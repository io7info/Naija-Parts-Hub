import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:naija_parts_hub/design/theme.dart';
import 'package:naija_parts_hub/features/account/account_screen.dart';
import 'package:naija_parts_hub/features/mechanic/mechanic_photos_screen.dart';
import 'package:naija_parts_hub/features/pending/pending_screen.dart';
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
    testWidgets('verified states the outcome and asks for nothing',
        (tester) async {
      await pumpProfile(tester, mechanicStore(identity: IdentityStatus.verified));

      expect(find.text('Identity verified'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Verify identity'), findsNothing);
    });

    testWidgets('verified does NOT print the last four digits', (tester) async {
      // A workshop screen is opened every day, in a workshop, with customers
      // nearby. The last four answered a question asked once, at entry, and
      // then sat on screen forever. The evidence belongs in admin review.
      await pumpProfile(tester, mechanicStore(identity: IdentityStatus.verified));

      expect(find.textContaining('4821'), findsNothing);
      expect(find.textContaining('9930'), findsNothing);
      expect(find.textContaining('ending'), findsNothing);
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

      expect(find.textContaining('No work photos yet'), findsOneWidget);
      // Camera is the primary action — a mechanic photographs the job in front
      // of them far more often than they dig through a gallery. Gallery stays
      // secondary. Asserted by type so a silent demotion is caught.
      expect(find.widgetWithText(FilledButton, 'Camera'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Gallery'), findsOneWidget);
    });

    testWidgets('at ten the add buttons are withdrawn', (tester) async {
      await pumpPhotos(
        tester,
        mechanicStore(
          photos: List.generate(maxWorkshopPhotos, (i) => 'https://cdn.example/$i.jpg'),
        ),
      );

      // By text, not by button type: asserting the absence of an
      // OutlinedButton labelled Camera would pass the moment Camera became a
      // FilledButton, whether or not it was actually withdrawn.
      expect(find.text('Camera'), findsNothing);
      expect(find.text('Gallery'), findsNothing);
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

      // Deleting now asks first. A workshop photo is of a job that has been
      // delivered — one mis-tap on a 15px glyph should not lose it.
      await tester.tap(find.byIcon(Icons.close).first);
      await tester.pumpAndSettle();
      expect(find.text('Remove this photo?'), findsOneWidget);
      await tester.tap(find.widgetWithText(TextButton, 'Remove'));
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
      await tester.tap(find.widgetWithText(TextButton, 'Remove'));
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
      await tester.tap(find.widgetWithText(TextButton, 'Remove'));
      await tester.pumpAndSettle();

      expect(find.text('2 of 10 photos. Buyers see these on your profile.'),
          findsOneWidget,
          reason: 'the count must not claim a deletion that did not happen');
    });
  });

  group('pending screen — the way back to verification', () {
    Future<void> pumpPending(WidgetTester tester, Store s) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: mechanicOverrides(storeService: store),
          child: MaterialApp(theme: buildNphTheme(), home: PendingScreen(store: s)),
        ),
      );
      await tester.pump();
    }

    testWidgets('an unverified pending mechanic is offered verification',
        (tester) async {
      // Without this the flow is a trap: identity is reached by
      // pushReplacement straight after registration and nowhere else, because
      // the other entry point lives inside MechanicShell, which the gate only
      // reaches once approved — and approval requires the verification being
      // sought. Closing the app on that screen left a mechanic pending
      // forever, unable to verify and impossible to approve.
      await pumpPending(
        tester,
        mechanicStore(
          status: StoreStatus.pending,
          identity: IdentityStatus.unverified,
          bvnLast4: null,
          ninLast4: null,
        ),
      );

      expect(find.widgetWithText(FilledButton, 'Verify my identity'), findsOneWidget);
    });

    testWidgets('and the button actually opens the identity screen',
        (tester) async {
      await pumpPending(
        tester,
        mechanicStore(
          status: StoreStatus.pending,
          identity: IdentityStatus.unverified,
          bvnLast4: null,
          ninLast4: null,
        ),
      );

      await tester.tap(find.widgetWithText(FilledButton, 'Verify my identity'));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.byType(MechanicIdentityScreen), findsOneWidget);
    });

    testWidgets('it says the wait is on them, not on us', (tester) async {
      await pumpPending(
        tester,
        mechanicStore(
          status: StoreStatus.pending,
          identity: IdentityStatus.unverified,
          bvnLast4: null,
          ninLast4: null,
        ),
      );

      expect(find.textContaining('cannot be approved until'), findsOneWidget);
      // The reassuring "keep this app closed" line would be a lie here — there
      // is something outstanding and it is theirs.
      expect(find.textContaining('keep this app closed'), findsNothing);
    });

    testWidgets('a verified pending mechanic is not asked again', (tester) async {
      await pumpPending(
        tester,
        mechanicStore(status: StoreStatus.pending, identity: IdentityStatus.verified),
      );

      expect(find.widgetWithText(FilledButton, 'Verify my identity'), findsNothing);
      expect(find.textContaining('keep this app closed'), findsOneWidget);
    });

    testWidgets('a pending DEALER is never asked for identity', (tester) async {
      // The client was explicit that BVN and NIN are not part of the dealer
      // flow. A dealer has no identity block at all.
      await pumpPending(tester, dealerStore(status: StoreStatus.pending));

      expect(find.widgetWithText(FilledButton, 'Verify my identity'), findsNothing);
      expect(find.textContaining('BVN'), findsNothing);
      expect(find.textContaining('keep this app closed'), findsOneWidget);
    });

    for (final status in [StoreStatus.rejected, StoreStatus.suspended]) {
      testWidgets('a $status mechanic is not offered verification', (tester) async {
        // Verifying would not change either outcome, and offering it would
        // imply it might.
        await pumpPending(
          tester,
          mechanicStore(
            status: status,
            identity: IdentityStatus.unverified,
            bvnLast4: null,
            ninLast4: null,
          ),
        );

        expect(find.widgetWithText(FilledButton, 'Verify my identity'), findsNothing);
      });
    }
  });

  group('account pane — shared with the dealer shell', () {
    Future<void> pumpAccount(WidgetTester tester, Store s) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: mechanicOverrides(storeService: store),
          child: MaterialApp(
            theme: buildNphTheme(),
            home: Scaffold(body: AccountScreen(store: s)),
          ),
        ),
      );
      await tester.pump();
    }

    testWidgets('a mechanic is not offered listings or a subscription',
        (tester) async {
      // "My Listings" called goToShellTab(ShellTab.listings) — a MainShell
      // index. MechanicShell keeps its own tab state and ignores that
      // provider, so the row reported "0 active" and did nothing when tapped.
      // "Plan & Usage" opened a subscription screen for a business that has no
      // subscription and is never asked to pay.
      await pumpAccount(tester, mechanicStore());

      expect(find.text('My Listings'), findsNothing);
      expect(find.text('Plan & Usage'), findsNothing);
    });

    testWidgets('a mechanic is called a mechanic', (tester) async {
      await pumpAccount(tester, mechanicStore());

      // "Identity Verified", not "Verified mechanic". The badge attests to who
      // they are — a BVN and NIN matched against government records. It says
      // nothing about whether they can rebuild a gearbox, and a label that
      // blurred the two would have Naija Parts Hub vouching for competence it
      // has never assessed.
      expect(find.text('Identity Verified'), findsOneWidget);
      expect(find.text('Verified dealer'), findsNothing);
      expect(find.text('Workshop Profile'), findsOneWidget);
      expect(find.text('Store Profile'), findsNothing);
    });

    testWidgets('the badge does not claim NPH vouches for their work',
        (tester) async {
      await pumpAccount(tester, mechanicStore());

      for (final overclaim in ['Certified', 'Approved mechanic', 'Trusted', 'Expert']) {
        expect(find.textContaining(overclaim), findsNothing,
            reason: '"$overclaim" claims more than an identity check establishes');
      }
    });

    testWidgets('a mechanic keeps what genuinely applies', (tester) async {
      await pumpAccount(tester, mechanicStore());

      // Offline sync and the account actions are not dealer-specific.
      for (final kept in ['Sync Status', 'Contact Support', 'Log Out', 'Delete Account']) {
        expect(find.text(kept), findsOneWidget, reason: '$kept went missing');
      }
    });

    testWidgets('a dealer keeps every row, unchanged', (tester) async {
      // The regression that matters: this pane is shared, and dealers are in
      // production today.
      await pumpAccount(tester, dealerStore());

      for (final row in [
        'Store Profile',
        'My Listings',
        'Plan & Usage',
        'Sync Status',
        'Log Out',
        'Delete Account',
      ]) {
        expect(find.text(row), findsOneWidget, reason: '$row went missing for a dealer');
      }
      expect(find.text('Verified dealer'), findsOneWidget);
      expect(find.text('Verified mechanic'), findsNothing);
      expect(find.text('Workshop Profile'), findsNothing);
    });
  });

  group('no dealer language reaches a mechanic', () {
    /// Every string on a pane, so an assertion cannot miss one by looking in
    /// the wrong widget.
    List<String> textsOn(WidgetTester tester) => tester
        .widgetList<Text>(find.byType(Text))
        .map((t) => t.data ?? '')
        .where((d) => d.isNotEmpty)
        .toList();

    const banned = [
      'My Listings',
      'Plan & Usage',
      'MY STORE',
      'My store',
      'Verified dealer',
      'Store Profile',
      'Active Listings',
      'Free Plan',
      'Add Listing',
      'Upgrade',
    ];

    testWidgets('not on the workshop tab', (tester) async {
      await pumpShell(tester, mechanicStore());
      final texts = textsOn(tester);
      for (final phrase in banned) {
        expect(texts.any((t) => t.contains(phrase)), isFalse,
            reason: '"$phrase" is dealer language and appears on My Workshop');
      }
    });

    testWidgets('not on the photos tab', (tester) async {
      await pumpShell(tester, mechanicStore());
      await tester.tap(find.text('Photos'));
      await tester.pumpAndSettle();

      final texts = textsOn(tester);
      for (final phrase in banned) {
        expect(texts.any((t) => t.contains(phrase)), isFalse,
            reason: '"$phrase" is dealer language and appears on Photos');
      }
    });

    testWidgets('not on the account tab', (tester) async {
      await pumpShell(tester, mechanicStore());
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();

      final texts = textsOn(tester);
      for (final phrase in banned) {
        expect(texts.any((t) => t.contains(phrase)), isFalse,
            reason: '"$phrase" is dealer language and appears on Account');
      }
    });

    testWidgets('no BVN or NIN fragment anywhere in the mechanic shell',
        (tester) async {
      await pumpShell(tester, mechanicStore());
      for (final tab in ['My Workshop', 'Photos', 'Account']) {
        await tester.tap(find.text(tab));
        await tester.pumpAndSettle();

        for (final t in textsOn(tester)) {
          expect(t.contains('4821'), isFalse, reason: 'BVN fragment on $tab: "$t"');
          expect(t.contains('9930'), isFalse, reason: 'NIN fragment on $tab: "$t"');
        }
      }
    });
  });

  group('photos — confirm before deleting', () {
    testWidgets('keeping the photo writes nothing', (tester) async {
      await pumpPhotos(
        tester,
        mechanicStore(photos: const ['https://cdn.example/a.jpg']),
      );

      await tester.tap(find.byIcon(Icons.close).first);
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Keep'));
      await tester.pumpAndSettle();

      verifyNever(() => store.updateProfile(any(), any()));
      expect(find.text('1 of 10 photos. Buyers see these on your profile.'),
          findsOneWidget);
    });

    testWidgets('the prompt says what removal actually does', (tester) async {
      await pumpPhotos(
        tester,
        mechanicStore(photos: const ['https://cdn.example/a.jpg']),
      );

      await tester.tap(find.byIcon(Icons.close).first);
      await tester.pumpAndSettle();

      expect(
        find.textContaining('no longer appear on your public profile'),
        findsOneWidget,
      );
    });
  });

  group('the workshop header renders real values', () {
    testWidgets('shows the location, not a template', (tester) async {
      await pumpProfile(tester, mechanicStore());

      expect(find.text('Oshodi, Lagos'), findsOneWidget);
    });

    testWidgets('shows the service count, not a template', (tester) async {
      await pumpProfile(tester, mechanicStore(specialties: const ['engine', 'brakes']));

      expect(find.text('2 services'), findsOneWidget);
    });

    testWidgets('one service is singular', (tester) async {
      await pumpProfile(tester, mechanicStore(specialties: const ['engine']));

      expect(find.text('1 service'), findsOneWidget);
    });

    testWidgets('the count follows the chips as they are tapped', (tester) async {
      await pumpProfile(tester, mechanicStore(specialties: const ['engine']));
      expect(find.text('1 service'), findsOneWidget);

      await tester.tap(find.widgetWithText(FilterChip, 'AC repair'));
      await tester.pump();

      expect(find.text('2 services'), findsOneWidget);
    });

    testWidgets('no un-interpolated template survives on any tab', (tester) async {
      // The bug this exists for: a build script escaped the dollar signs, so
      // the header rendered the literal source text "\${store.city}" to a
      // mechanic. Every assertion passed — nothing checked what the header
      // actually said, only that a title was present.
      await pumpShell(tester, mechanicStore());

      for (final tab in ['My Workshop', 'Photos', 'Account']) {
        await tester.tap(find.text(tab));
        await tester.pumpAndSettle();

        for (final t in tester.widgetList<Text>(find.byType(Text))) {
          final data = t.data ?? '';
          expect(data.contains(r'${'), isFalse,
              reason: 'un-rendered template on $tab: "$data"');
        }
      }
    });
  });
}
