import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:naija_parts_hub/design/theme.dart';
import 'package:naija_parts_hub/features/registration/registration_screen.dart';
import 'package:naija_parts_hub/models/store.dart';
import 'package:naija_parts_hub/services/identity_service.dart';
import 'package:naija_parts_hub/services/store_service.dart';

import '../support/mechanic_doubles.dart';

/// Proof that adding mechanics changed nothing for parts dealers.
///
/// The client's constraint was unambiguous: "Parts Dealer registration and
/// existing production behavior must remain unchanged." There are real dealers
/// on this app today with live listings and paid subscriptions, and an
/// installed build that has not been updated must keep registering exactly as
/// it did before.
///
/// So these assert the two things that could actually break them — what goes
/// on the wire, and what a document with no mechanic fields parses to.
class MockFunctions extends Mock implements FirebaseFunctions {}

class MockCallable extends Mock implements HttpsCallable {}

class MockCallableResult extends Mock
    implements HttpsCallableResult<Map<String, dynamic>> {}

/// Never touched: `register` goes through the callable, so the Firestore
/// handle is only there to satisfy the constructor.
class MockFirestoreUnused extends Mock implements FirebaseFirestore {}

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

  group('the registerStore payload', () {
    late MockFunctions functions;
    late MockCallable callable;
    late StoreService service;

    setUp(() {
      functions = MockFunctions();
      callable = MockCallable();
      final result = MockCallableResult();

      when(() => result.data).thenReturn({'storeId': 'store-1', 'slug': 'a-slug'});
      when(() => callable.call<Map<String, dynamic>>(any()))
          .thenAnswer((_) async => result);
      when(() => functions.httpsCallable('registerStore')).thenReturn(callable);

      // `register` never touches Firestore — the whole point of a callable is
      // that the slug reservation and the backend-controlled fields are the
      // server's business.
      service = StoreService(MockFirestoreUnused(), functions);
    });

    Future<Map<String, dynamic>> registerAndCapture({
      BusinessType businessType = BusinessType.partsDealer,
      List<String> specialties = const [],
      List<String> photos = const [],
    }) async {
      await service.register(
        businessName: 'Ladipo Auto Spares',
        ownerName: 'Tinuoye Adeyemi',
        phone: '+2349053114741',
        whatsapp: '+2349053114741',
        cacNumber: 'RC-1846352',
        address: '50 Ladipo Market Road',
        state: 'Lagos',
        city: 'Mushin',
        description: 'Genuine parts.',
        businessType: businessType,
        specialties: specialties,
        photos: photos,
      );

      final captured = verify(() => callable.call<Map<String, dynamic>>(captureAny()))
          .captured
          .single;
      return Map<String, dynamic>.from(captured as Map);
    }

    test('a dealer sends no businessType at all', () async {
      final payload = await registerAndCapture();

      // Not 'parts_dealer' — absent. The callable defaults to a dealer when
      // the field is missing, which is exactly what keeps an older installed
      // build registering identically. Sending an explicit value would be a
      // new field on a request that has been stable in production.
      expect(payload.containsKey('businessType'), isFalse);
    });

    test('a dealer sends no mechanic block', () async {
      final payload = await registerAndCapture();
      expect(payload.containsKey('mechanic'), isFalse);
    });

    test('a dealer payload carries exactly the keys it always did', () async {
      final payload = await registerAndCapture();

      expect(
        payload.keys.toSet(),
        {
          'businessName',
          'ownerName',
          'phone',
          'whatsapp',
          'cacNumber',
          'address',
          'state',
          'city',
          'description',
          'email',
          'landmark',
          'automotiveCategory',
          'acceptedTerms',
        },
        reason: 'a new key on the dealer request is a production change',
      );
    });

    test('a dealer never sends specialties or photos, even if passed some',
        () async {
      // Defensive: nothing in the dealer flow supplies these, but if a future
      // caller did, they must not silently reshape the dealer request.
      final payload = await registerAndCapture(
        specialties: const ['engine'],
        photos: const ['https://cdn.example/a.jpg'],
      );

      expect(payload.containsKey('specialties'), isFalse);
      expect(payload.containsKey('mechanic'), isFalse);
    });

    test('a mechanic does send both', () async {
      final payload = await registerAndCapture(
        businessType: BusinessType.mechanic,
        specialties: const ['engine', 'brakes'],
        photos: const ['https://cdn.example/a.jpg'],
      );

      expect(payload['businessType'], 'mechanic');
      expect(payload['mechanic'], {
        'specialties': ['engine', 'brakes'],
        'photos': ['https://cdn.example/a.jpg'],
      });
    });

    test('the wire value is the contract string, not the Dart enum name',
        () async {
      // Mirrors BusinessType in packages/contracts/src/store.ts. 'mechanic'
      // there, not 'BusinessType.mechanic'.
      expect(BusinessType.mechanic.wire, 'mechanic');
      expect(BusinessType.partsDealer.wire, 'parts_dealer');
    });
  });

  group('a store document with no mechanic fields', () {
    test('an absent businessType reads as a parts dealer', () {
      expect(BusinessType.parse(null), BusinessType.partsDealer);
    });

    test('an unrecognised businessType reads as a parts dealer', () {
      // A value written by a newer build must not crash an older app, and
      // dealer is the safe reading — it grants nothing a mechanic would not
      // already have.
      for (final unknown in ['towing', 'PANEL_BEATER', '', 'Mechanic']) {
        expect(BusinessType.parse(unknown), BusinessType.partsDealer,
            reason: '"$unknown" must not be mistaken for a mechanic');
      }
    });

    test('only the exact contract string makes a mechanic', () {
      expect(BusinessType.parse('mechanic'), BusinessType.mechanic);
    });

    test('every store today defaults to a dealer with no mechanic or identity block',
        () {
      final dealer = dealerStore();

      expect(dealer.businessType, BusinessType.partsDealer);
      expect(dealer.isPartsDealer, isTrue);
      expect(dealer.isMechanic, isFalse);
      expect(dealer.mechanic, isNull);
      expect(dealer.identity, isNull);
    });

    test('a dealer is never gated on identity', () {
      final dealer = dealerStore();

      // `identityVerified` is false for a dealer because they have no identity
      // block — which is correct, and must never be read as "blocked". The
      // client was explicit that BVN and NIN are not part of the dealer flow.
      expect(dealer.identityVerified, isFalse);
      expect(needsIdentityVerification(dealer), isFalse,
          reason: 'a dealer asked for a BVN would be a change to production');
    });

    test('an unverified mechanic is gated', () {
      expect(
        needsIdentityVerification(mechanicStore(identity: IdentityStatus.unverified)),
        isTrue,
      );
    });

    test('a verified mechanic is not', () {
      expect(
        needsIdentityVerification(mechanicStore(identity: IdentityStatus.verified)),
        isFalse,
      );
    });
  });

  group('dealer subscription behaviour is untouched', () {
    test('the free allowance is still ten active listings', () {
      expect(dealerStore().activeListingLimit, 10);
    });

    test('a paid dealer still gets two hundred', () {
      final paid = Store(
        storeId: 'dealer-2',
        businessName: 'Paid Motors',
        ownerName: 'Ada',
        phone: '+2348000000000',
        whatsapp: '+2348000000000',
        cacNumber: 'RC-1',
        address: 'Somewhere',
        state: 'Lagos',
        city: 'Ikeja',
        description: '',
        slug: 'paid-motors',
        status: StoreStatus.approved,
        visible: true,
        activeListingCount: 0,
        subscription: Subscription(
          plan: 'monthly',
          status: 'active',
          expiresAt: DateTime.now().add(const Duration(days: 20)),
        ),
      );

      expect(paid.activeListingLimit, 200);
    });
  });

  group('the dealer wizard itself', () {
    testWidgets('still opens on its own first step with mechanic signup off',
        (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: mechanicOverrides(mechanicSignupEnabled: false),
          child: MaterialApp(theme: buildNphTheme(), home: const RegistrationScreen()),
        ),
      );
      await tester.pump();

      expect(find.text('Register Your Store'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('asks a dealer for nothing about identity', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: mechanicOverrides(mechanicSignupEnabled: false),
          child: MaterialApp(theme: buildNphTheme(), home: const RegistrationScreen()),
        ),
      );
      await tester.pump();

      expect(find.textContaining('BVN'), findsNothing);
      expect(find.textContaining('NIN'), findsNothing);
      expect(find.textContaining('specialt'), findsNothing);
    });
  });
}
