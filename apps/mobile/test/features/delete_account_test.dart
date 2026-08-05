import 'package:firebase_auth/firebase_auth.dart' show PhoneAuthCredential;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:naija_parts_hub/design/theme.dart';
import 'package:naija_parts_hub/features/account/delete_account_screen.dart';
import 'package:naija_parts_hub/models/store.dart';
import 'package:naija_parts_hub/services/auth_service.dart';

import '../support/test_providers.dart';

/// Account deletion.
///
/// The property under test is an *ordering* one: `deleteAccount()` must not be
/// reachable until `reauthenticate()` has succeeded. The backend callable runs
/// on the Admin SDK, which never challenges the caller itself — so this screen
/// is the only thing standing between an unattended, already-signed-in handset
/// and the permanent loss of a dealer's store. Asserting that the button
/// *exists* would prove nothing; these assert that the callable is never
/// invoked on the failure paths.
class _MockAuth extends Mock implements AuthService {}

class _FakeCredential extends Fake implements PhoneAuthCredential {}

Store _store() => const Store(
      storeId: 'dealer-1',
      businessName: 'Ladipo Auto Spares',
      ownerName: 'Tinuoye Adeyemi',
      phone: '+2349053114741',
      whatsapp: '',
      cacNumber: 'RC-1846352',
      address: '50 Ladipo Market Road',
      state: 'Lagos',
      city: 'Mushin',
      description: '',
      slug: 'ladipo-auto-spares',
      status: StoreStatus.approved,
      visible: true,
      activeListingCount: 7,
      subscription: Subscription(plan: 'free', status: 'none'),
    );

void main() {
  late _MockAuth auth;
  late MockListingService listings;

  setUpAll(() => registerFallbackValue(_FakeCredential()));

  setUp(() {
    auth = _MockAuth();
    listings = listingServiceDouble();

    when(() => auth.credentialFrom(any(), any())).thenReturn(_FakeCredential());
    when(() => auth.reauthenticate(any())).thenAnswer((_) async {});
    when(() => listings.deleteAccount()).thenAnswer((_) async {});

    final view = TestWidgetsFlutterBinding.ensureInitialized().platformDispatcher.views.first;
    view.devicePixelRatio = 1.0;
    view.physicalSize = const Size(400, 1600);
  });

  tearDown(() {
    final view = TestWidgetsFlutterBinding.ensureInitialized().platformDispatcher.views.first;
    view.resetPhysicalSize();
    view.resetDevicePixelRatio();
  });

  /// Stubs the OTP send. [autoRetrieve] simulates Android instant verification,
  /// which hands back a credential with no code ever typed.
  void stubSendOtp({bool autoRetrieve = false}) {
    when(() => auth.sendReauthOtp(
          onAutoRetrieved: any(named: 'onAutoRetrieved'),
          onError: any(named: 'onError'),
        )).thenAnswer((invocation) async {
      if (autoRetrieve) {
        final cb = invocation.namedArguments[#onAutoRetrieved]
            as void Function(PhoneAuthCredential);
        cb(_FakeCredential());
      }
      return 'verification-id-1';
    });
  }

  Widget wrap() => ProviderScope(
        overrides: [
          ...commonOverrides(listingService: listings),
          authServiceProvider.overrideWithValue(auth),
        ],
        child: MaterialApp(
          theme: buildNphTheme(),
          home: DeleteAccountScreen(store: _store()),
        ),
      );

  Future<void> typeDeleteAndContinue(WidgetTester tester) async {
    await tester.enterText(find.widgetWithText(TextField, 'DELETE'), 'DELETE');
    await tester.pump();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
  }

  group('gate 1 — consequences', () {
    testWidgets('itemises what is destroyed, with real numbers', (tester) async {
      await tester.pumpWidget(wrap());
      await tester.pumpAndSettle();

      // A generic "are you sure" is what dealers dismiss without reading.
      expect(find.text('Your store, "Ladipo Auto Spares"'), findsOneWidget);
      expect(find.text('Every listing — 7 active, plus all drafts'), findsOneWidget);
      expect(find.text('All product photos'), findsOneWidget);
      expect(find.textContaining('Your public store link'), findsOneWidget);
    });

    testWidgets('offers a way out that is not the back gesture', (tester) async {
      await tester.pumpWidget(wrap());
      await tester.pumpAndSettle();

      expect(find.text('Cancel — keep my account'), findsOneWidget);
    });
  });

  group('gate 2 — typed confirmation', () {
    testWidgets('Continue is disabled until DELETE is typed', (tester) async {
      await tester.pumpWidget(wrap());
      await tester.pumpAndSettle();

      expect(
        tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Continue')).onPressed,
        isNull,
        reason: 'a mis-tap must not be able to start this flow',
      );
    });

    testWidgets('a near-miss does not unlock it', (tester) async {
      await tester.pumpWidget(wrap());
      await tester.pumpAndSettle();

      await tester.enterText(find.widgetWithText(TextField, 'DELETE'), 'DELET');
      await tester.pump();

      expect(
        tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Continue')).onPressed,
        isNull,
      );
    });

    testWidgets('typing DELETE unlocks it and sends the code', (tester) async {
      stubSendOtp();
      await tester.pumpWidget(wrap());
      await tester.pumpAndSettle();

      await typeDeleteAndContinue(tester);

      verify(() => auth.sendReauthOtp(
            onAutoRetrieved: any(named: 'onAutoRetrieved'),
            onError: any(named: 'onError'),
          )).called(1);
      expect(find.text('Verify it is you'), findsOneWidget);
      // Still nothing destroyed — this step only proves intent.
      verifyNever(() => listings.deleteAccount());
    });
  });

  group('gate 3 — phone OTP reauthentication', () {
    testWidgets('shows where the code was sent, in readable form', (tester) async {
      stubSendOtp();
      await tester.pumpWidget(wrap());
      await tester.pumpAndSettle();
      await typeDeleteAndContinue(tester);

      expect(find.textContaining('+234 905 311 4741'), findsOneWidget);
    });

    testWidgets('a short code is refused before anything is called', (tester) async {
      stubSendOtp();
      await tester.pumpWidget(wrap());
      await tester.pumpAndSettle();
      await typeDeleteAndContinue(tester);

      await tester.enterText(find.widgetWithText(TextField, '000000'), '123');
      await tester.pump();
      await tester.tap(find.text('Delete my account permanently'));
      await tester.pumpAndSettle();

      expect(find.text('Enter the six-digit code sent to your phone.'), findsOneWidget);
      verifyNever(() => auth.reauthenticate(any()));
      verifyNever(() => listings.deleteAccount());
    });

    testWidgets('a wrong code reauthenticates but never deletes', (tester) async {
      stubSendOtp();
      when(() => auth.reauthenticate(any())).thenThrow(
        FirebaseAuthExceptionStub('invalid-verification-code'),
      );

      await tester.pumpWidget(wrap());
      await tester.pumpAndSettle();
      await typeDeleteAndContinue(tester);

      await tester.enterText(find.widgetWithText(TextField, '000000'), '123456');
      await tester.pump();
      await tester.tap(find.text('Delete my account permanently'));
      await tester.pumpAndSettle();

      verify(() => auth.reauthenticate(any())).called(1);
      // The whole point: reauthentication failing must leave the account
      // completely untouched.
      verifyNever(() => listings.deleteAccount());
    });

    testWidgets('a valid code reauthenticates first, then deletes', (tester) async {
      stubSendOtp();
      await tester.pumpWidget(wrap());
      await tester.pumpAndSettle();
      await typeDeleteAndContinue(tester);

      await tester.enterText(find.widgetWithText(TextField, '000000'), '123456');
      await tester.pump();
      await tester.tap(find.text('Delete my account permanently'));
      await tester.pumpAndSettle();

      verifyInOrder([
        () => auth.credentialFrom('verification-id-1', '123456'),
        () => auth.reauthenticate(any()),
        () => listings.deleteAccount(),
      ]);
    });
  });

  group('Android instant verification', () {
    testWidgets('still requires a deliberate press, not an auto-delete',
        (tester) async {
      stubSendOtp(autoRetrieve: true);
      await tester.pumpWidget(wrap());
      await tester.pumpAndSettle();
      await typeDeleteAndContinue(tester);

      // verificationCompleted fires with no interaction at all. Acting on it
      // would delete the account of anyone holding an unlocked handset.
      expect(find.textContaining('Press Delete to finish'), findsOneWidget);
      verifyNever(() => listings.deleteAccount());

      await tester.tap(find.text('Delete my account permanently'));
      await tester.pumpAndSettle();

      verify(() => listings.deleteAccount()).called(1);
    });
  });
}

/// A stand-in for a FirebaseAuthException.
///
/// The real one cannot be constructed usefully against a mocked service, and
/// what matters here is only that reauthentication threw.
class FirebaseAuthExceptionStub implements Exception {
  FirebaseAuthExceptionStub(this.code);
  final String code;
  @override
  String toString() => 'FirebaseAuthExceptionStub($code)';
}
