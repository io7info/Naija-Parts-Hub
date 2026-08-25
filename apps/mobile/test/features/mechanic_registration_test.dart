import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:naija_parts_hub/design/components.dart';
import 'package:naija_parts_hub/design/theme.dart';
import 'package:naija_parts_hub/features/registration/mechanic_identity_screen.dart';
import 'package:naija_parts_hub/features/registration/mechanic_registration_screen.dart';
import 'package:naija_parts_hub/models/store.dart';

import '../support/mechanic_doubles.dart';

/// The four-step mechanic wizard.
///
/// What these prove is that a mechanic can get through the form, that the form
/// refuses to let them past a step they have not completed, and that what
/// finally reaches `registerStore` is what they typed. The server-side half —
/// that the callable rejects a bad payload, that the photo array is capped in
/// rules, that a pending mechanic is invisible publicly — lives in
/// firebase/tests and functions/test.
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
  late MockImageUploadService uploads;

  setUp(() {
    store = MockStoreService();
    stubRegister(store);
    uploads = workshopUploadDouble();
  });

  Future<void> pumpWizard(WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: mechanicOverrides(storeService: store, uploadService: uploads),
        child: MaterialApp(
          theme: buildNphTheme(),
          home: const MechanicRegistrationScreen(),
        ),
      ),
    );
    await tester.pump();
  }

  /// Types into the field under a given NphField label.
  ///
  /// By label rather than by index: an index-based finder silently types into
  /// the wrong box when a field is added, and the test still passes.
  Future<void> fill(WidgetTester tester, String label, String value) async {
    final field = find.descendant(
      of: find.ancestor(of: find.text(label), matching: find.byType(NphField)),
      matching: find.byType(TextFormField),
    );
    expect(field, findsOneWidget, reason: 'no field labelled "$label"');
    await tester.enterText(field, value);
    await tester.pump();
  }

  Future<void> tapContinue(WidgetTester tester) async {
    await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
    await tester.pumpAndSettle();
  }

  Future<void> completeWorkshopStep(WidgetTester tester) async {
    await fill(tester, 'Workshop or Business Name', 'Kunle Auto Works');
    await fill(tester, 'Your Full Name', 'Kunle Bakare');
    await fill(tester, 'About your workshop', 'Engine and brake specialists in Oshodi.');
  }

  Future<void> completeServicesStep(WidgetTester tester) async {
    await tester.tap(find.widgetWithText(FilterChip, 'Engine repair'));
    await tester.tap(find.widgetWithText(FilterChip, 'Brake repair'));
    await tester.pump();
  }

  Future<void> completeLocationStep(WidgetTester tester) async {
    await fill(tester, 'WhatsApp Number', '08022334455');
    await fill(tester, 'City / Town', 'Oshodi');
    await fill(tester, 'Workshop Address', '14 Oshodi Expressway');

    await tester.ensureVisible(find.byType(DropdownButtonFormField<String>));
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();

    // The menu holds all 37 states in a lazily-built list, so Lagos — 25th
    // alphabetically — is not in the tree when the menu opens. Nothing is
    // selected yet, so this text can only be the menu item.
    final lagos = find.text('Lagos');
    await tester.scrollUntilVisible(
      lagos,
      120,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.pumpAndSettle();
    await tester.tap(lagos);
    await tester.pumpAndSettle();
  }

  /// Walks all the way to the Photos step.
  Future<void> reachPhotosStep(WidgetTester tester) async {
    await completeWorkshopStep(tester);
    await tapContinue(tester);
    await completeServicesStep(tester);
    await tapContinue(tester);
    await completeLocationStep(tester);
    await tapContinue(tester);
  }

  Future<void> acceptTerms(WidgetTester tester) async {
    final box = find.byType(CheckboxListTile);
    await tester.ensureVisible(box);
    await tester.tap(box);
    await tester.pump();
  }

  group('step progression', () {
    testWidgets('opens on Workshop', (tester) async {
      await pumpWizard(tester);

      expect(find.text('Mechanic sign-up · Workshop'), findsOneWidget);
      expect(find.text('Workshop or Business Name'), findsOneWidget);
    });

    testWidgets('advances Workshop -> Services -> Location -> Photos',
        (tester) async {
      await pumpWizard(tester);

      await completeWorkshopStep(tester);
      await tapContinue(tester);
      expect(find.text('Mechanic sign-up · Services'), findsOneWidget);

      await completeServicesStep(tester);
      await tapContinue(tester);
      expect(find.text('Mechanic sign-up · Location'), findsOneWidget);

      await completeLocationStep(tester);
      await tapContinue(tester);
      expect(find.text('Mechanic sign-up · Photos'), findsOneWidget);
    });

    testWidgets('the last step offers Submit, not Continue', (tester) async {
      await pumpWizard(tester);
      await reachPhotosStep(tester);

      expect(find.widgetWithText(FilledButton, 'Submit for review'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Continue'), findsNothing);
    });

    testWidgets('back returns to the previous step, keeping what was typed',
        (tester) async {
      await pumpWizard(tester);
      await completeWorkshopStep(tester);
      await tapContinue(tester);

      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();

      expect(find.text('Mechanic sign-up · Workshop'), findsOneWidget);
      expect(find.text('Kunle Auto Works'), findsOneWidget,
          reason: 'stepping back must not discard the form');
    });
  });

  group('validation gates each step', () {
    testWidgets('an empty Workshop step will not advance', (tester) async {
      await pumpWizard(tester);

      await tapContinue(tester);

      expect(find.text('Mechanic sign-up · Workshop'), findsOneWidget);
      expect(find.text('Enter your workshop name'), findsOneWidget);
      expect(find.text('Enter your full name'), findsOneWidget);
    });

    testWidgets('CAC is genuinely optional — most workshops have none',
        (tester) async {
      await pumpWizard(tester);
      await completeWorkshopStep(tester);
      await tapContinue(tester);

      // Advanced with CAC left blank. The client was explicit that identity is
      // proven by BVN and NIN instead.
      expect(find.text('Mechanic sign-up · Services'), findsOneWidget);
    });

    testWidgets('no services selected blocks the Services step with a reason',
        (tester) async {
      await pumpWizard(tester);
      await completeWorkshopStep(tester);
      await tapContinue(tester);

      await tapContinue(tester);

      expect(find.text('Mechanic sign-up · Services'), findsOneWidget);
      expect(find.text('Choose at least one service you offer.'), findsOneWidget);
    });

    testWidgets('an empty Location step will not advance', (tester) async {
      await pumpWizard(tester);
      await completeWorkshopStep(tester);
      await tapContinue(tester);
      await completeServicesStep(tester);
      await tapContinue(tester);

      await tapContinue(tester);

      expect(find.text('Mechanic sign-up · Location'), findsOneWidget);
      expect(find.text('Buyers contact you here'), findsOneWidget);
      expect(find.text('Choose your state'), findsOneWidget);
    });
  });

  group('specialties', () {
    testWidgets('offers exactly the ten contract specialties', (tester) async {
      await pumpWizard(tester);
      await completeWorkshopStep(tester);
      await tapContinue(tester);

      expect(mechanicSpecialties.length, 10);
      for (final s in mechanicSpecialties) {
        expect(find.widgetWithText(FilterChip, s.label), findsOneWidget,
            reason: '${s.label} is missing from the picker');
      }
      expect(find.byType(FilterChip), findsNWidgets(10));
    });

    test('specialty ids match the contract, not the labels', () {
      // The id is what is stored and what the public directory filters on, so
      // a drifted id makes a mechanic unfindable rather than merely
      // mislabelled. Mirrors MECHANIC_SPECIALTIES in packages/contracts.
      expect(
        mechanicSpecialties.map((s) => s.id).toList(),
        [
          'engine',
          'transmission',
          'brakes',
          'suspension',
          'electrical',
          'ac',
          'exhaust',
          'bodywork',
          'diagnostics',
          'general',
        ],
      );
    });

    testWidgets('starts with none selected', (tester) async {
      await pumpWizard(tester);
      await completeWorkshopStep(tester);
      await tapContinue(tester);

      final chips = tester.widgetList<FilterChip>(find.byType(FilterChip));
      expect(chips.every((c) => !c.selected), isTrue);
    });

    testWidgets('selecting and deselecting is reflected in the chip state',
        (tester) async {
      await pumpWizard(tester);
      await completeWorkshopStep(tester);
      await tapContinue(tester);

      Future<bool> selected(String label) async {
        final chip = tester.widget<FilterChip>(find.widgetWithText(FilterChip, label));
        return chip.selected;
      }

      await tester.tap(find.widgetWithText(FilterChip, 'AC repair'));
      await tester.pump();
      expect(await selected('AC repair'), isTrue);

      await tester.tap(find.widgetWithText(FilterChip, 'AC repair'));
      await tester.pump();
      expect(await selected('AC repair'), isFalse);
    });

    testWidgets('choosing a service clears the "pick one" error', (tester) async {
      await pumpWizard(tester);
      await completeWorkshopStep(tester);
      await tapContinue(tester);
      await tapContinue(tester);
      expect(find.text('Choose at least one service you offer.'), findsOneWidget);

      await tester.tap(find.widgetWithText(FilterChip, 'Engine repair'));
      await tester.pump();

      expect(find.text('Choose at least one service you offer.'), findsNothing,
          reason: 'a stale error tells a mechanic they failed something they just fixed');
    });
  });

  group('workshop photos', () {
    /// One close button is rendered per photo.
    int photoCount(WidgetTester tester) =>
        tester.widgetList(find.byIcon(Icons.close)).length;

    Future<void> addPhoto(WidgetTester tester) async {
      await tester.ensureVisible(find.widgetWithText(OutlinedButton, 'Gallery'));
      await tester.tap(find.widgetWithText(OutlinedButton, 'Gallery'));
      await tester.pump();
      await tester.pump();
    }

    testWidgets('starts empty with both sources offered', (tester) async {
      await pumpWizard(tester);
      await reachPhotosStep(tester);

      expect(photoCount(tester), 0);
      expect(find.widgetWithText(OutlinedButton, 'Camera'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Gallery'), findsOneWidget);
    });

    testWidgets('adding a photo shows it', (tester) async {
      await pumpWizard(tester);
      await reachPhotosStep(tester);

      await addPhoto(tester);

      expect(photoCount(tester), 1);
      verify(() => uploads.pick(fromCamera: false)).called(1);
    });

    testWidgets('caps at ten and withdraws the add buttons', (tester) async {
      await pumpWizard(tester);
      await reachPhotosStep(tester);

      for (var i = 0; i < maxWorkshopPhotos; i++) {
        await addPhoto(tester);
      }

      expect(photoCount(tester), maxWorkshopPhotos);
      expect(find.widgetWithText(OutlinedButton, 'Camera'), findsNothing);
      expect(find.widgetWithText(OutlinedButton, 'Gallery'), findsNothing);
      expect(find.text('You have added the maximum number of photos.'), findsOneWidget);
    });

    testWidgets('an eleventh photo cannot be uploaded — no wasted call',
        (tester) async {
      await pumpWizard(tester);
      await reachPhotosStep(tester);

      for (var i = 0; i < maxWorkshopPhotos; i++) {
        await addPhoto(tester);
      }
      // Ten picks and ten uploads, and no eleventh of either: the button is
      // gone, and `_addPhoto` also returns before touching Storage. Belt and
      // braces, because an upload that rules would then reject costs the
      // mechanic mobile data for nothing.
      verify(() => uploads.pick(fromCamera: any(named: 'fromCamera')))
          .called(maxWorkshopPhotos);
      verify(
        () => uploads.uploadWorkshopPhoto(
          storeId: any(named: 'storeId'),
          source: any(named: 'source'),
        ),
      ).called(maxWorkshopPhotos);
      verifyNoMoreInteractions(uploads);
    });

    testWidgets('removing one frees a slot again', (tester) async {
      await pumpWizard(tester);
      await reachPhotosStep(tester);

      for (var i = 0; i < maxWorkshopPhotos; i++) {
        await addPhoto(tester);
      }
      expect(find.widgetWithText(OutlinedButton, 'Gallery'), findsNothing);

      await tester.tap(find.byIcon(Icons.close).first);
      await tester.pump();

      expect(photoCount(tester), maxWorkshopPhotos - 1);
      expect(find.widgetWithText(OutlinedButton, 'Gallery'), findsOneWidget);
    });

    testWidgets('photos are optional — a mechanic can submit with none',
        (tester) async {
      await pumpWizard(tester);
      await reachPhotosStep(tester);
      await acceptTerms(tester);

      await tester.tap(find.widgetWithText(FilledButton, 'Submit for review'));
      await tester.pumpAndSettle();

      expect(find.byType(MechanicIdentityScreen), findsOneWidget);
    });
  });

  group('terms', () {
    testWidgets('submitting without accepting is refused with a reason',
        (tester) async {
      await pumpWizard(tester);
      await reachPhotosStep(tester);

      await tester.tap(find.widgetWithText(FilledButton, 'Submit for review'));
      await tester.pumpAndSettle();

      expect(find.text('Please accept the Terms and Privacy Policy.'), findsOneWidget);
      verifyNever(
        () => store.register(
          businessName: any(named: 'businessName'),
          ownerName: any(named: 'ownerName'),
          phone: any(named: 'phone'),
          whatsapp: any(named: 'whatsapp'),
          cacNumber: any(named: 'cacNumber'),
          address: any(named: 'address'),
          state: any(named: 'state'),
          city: any(named: 'city'),
          description: any(named: 'description'),
          email: any(named: 'email'),
          landmark: any(named: 'landmark'),
          automotiveCategory: any(named: 'automotiveCategory'),
          businessType: any(named: 'businessType'),
          specialties: any(named: 'specialties'),
          photos: any(named: 'photos'),
        ),
      );
    });

    testWidgets('the BVN/NIN step is disclosed before submission', (tester) async {
      await pumpWizard(tester);
      await reachPhotosStep(tester);

      expect(
        find.textContaining('verify your identity with your BVN and NIN'),
        findsOneWidget,
      );
      expect(find.textContaining('We never store those numbers'), findsOneWidget);
    });
  });

  group('submission', () {
    testWidgets('registers as a mechanic, carrying the specialties chosen',
        (tester) async {
      await pumpWizard(tester);
      await reachPhotosStep(tester);
      await acceptTerms(tester);

      await tester.tap(find.widgetWithText(FilledButton, 'Submit for review'));
      await tester.pumpAndSettle();

      final captured = verify(
        () => store.register(
          businessName: captureAny(named: 'businessName'),
          ownerName: captureAny(named: 'ownerName'),
          phone: captureAny(named: 'phone'),
          whatsapp: captureAny(named: 'whatsapp'),
          cacNumber: any(named: 'cacNumber'),
          address: captureAny(named: 'address'),
          state: captureAny(named: 'state'),
          city: captureAny(named: 'city'),
          description: any(named: 'description'),
          email: any(named: 'email'),
          landmark: any(named: 'landmark'),
          automotiveCategory: any(named: 'automotiveCategory'),
          businessType: captureAny(named: 'businessType'),
          specialties: captureAny(named: 'specialties'),
          photos: any(named: 'photos'),
        ),
      ).captured;

      expect(captured[0], 'Kunle Auto Works');
      expect(captured[1], 'Kunle Bakare');
      // The signed-in phone number, not a typed one — mechanics authenticate
      // by OTP before they ever reach this form.
      expect(captured[2], '+2349053114741');
      expect(captured[3], '08022334455');
      expect(captured[4], '14 Oshodi Expressway');
      expect(captured[5], 'Lagos');
      expect(captured[6], 'Oshodi');
      expect(captured[7], BusinessType.mechanic);
      expect(captured[8], ['engine', 'brakes']);
    });

    testWidgets('lands on identity verification, framed as the last step',
        (tester) async {
      await pumpWizard(tester);
      await reachPhotosStep(tester);
      await acceptTerms(tester);

      await tester.tap(find.widgetWithText(FilledButton, 'Submit for review'));
      await tester.pumpAndSettle();

      expect(find.byType(MechanicIdentityScreen), findsOneWidget);
      expect(find.text('Your workshop details are saved'), findsOneWidget);
      // pushReplacement, so there is no back route into a form that has
      // already been submitted.
      expect(find.byType(MechanicRegistrationScreen), findsNothing);
    });

    testWidgets('a failed registration keeps the form and explains itself',
        (tester) async {
      stubRegister(store, throws: Exception('network'));

      await pumpWizard(tester);
      await reachPhotosStep(tester);
      await acceptTerms(tester);

      await tester.tap(find.widgetWithText(FilledButton, 'Submit for review'));
      await tester.pumpAndSettle();

      expect(find.byType(MechanicIdentityScreen), findsNothing);
      expect(find.byType(MechanicRegistrationScreen), findsOneWidget,
          reason: 'losing a completed four-step form to one failed call is unforgivable');
      expect(find.widgetWithText(FilledButton, 'Submit for review'), findsOneWidget);
    });
  });
}
