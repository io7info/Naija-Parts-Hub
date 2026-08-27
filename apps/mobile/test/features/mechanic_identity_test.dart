import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:naija_parts_hub/design/components.dart';
import 'package:naija_parts_hub/design/theme.dart';
import 'package:naija_parts_hub/features/registration/mechanic_identity_screen.dart';
import 'package:naija_parts_hub/services/identity_service.dart';

import '../support/mechanic_doubles.dart';

/// BVN and NIN capture.
///
/// Two things are being protected here and they pull in opposite directions.
///
/// The first is the mechanic's data. A Nigerian asked for their BVN by an app
/// they have just met is right to hesitate, and these assert that the numbers
/// are shown to be handled honestly and are dropped the moment they are no
/// longer needed.
///
/// The second is the mechanic's account. Every attempt is a billable provider
/// call, so the screen must not resubmit, must not retry a terminal verdict,
/// and must not tell someone they failed a check when in truth we never ran
/// one.
const _validBvn = '22345678901';
const _validNin = '70123456789';

void main() {
  setUpAll(registerMechanicFallbacks);

  setUp(() {
    final view = TestWidgetsFlutterBinding.ensureInitialized().platformDispatcher.views.first;
    view.devicePixelRatio = 1.0;
    view.physicalSize = const Size(400, 1200);
  });

  tearDown(() {
    final view = TestWidgetsFlutterBinding.ensureInitialized().platformDispatcher.views.first;
    view.resetPhysicalSize();
    view.resetDevicePixelRatio();
  });

  Future<MockIdentityService> pumpIdentity(
    WidgetTester tester, {
    IdentityResult result = const IdentityResult(IdentityOutcome.verified),
    bool afterRegistration = false,
  }) async {
    final identity = identityDouble(result);
    await tester.pumpWidget(
      ProviderScope(
        overrides: mechanicOverrides(identityService: identity),
        child: MaterialApp(
          theme: buildNphTheme(),
          home: MechanicIdentityScreen(afterRegistration: afterRegistration),
        ),
      ),
    );
    await tester.pump();
    return identity;
  }

  Future<void> fill(WidgetTester tester, String label, String value) async {
    final field = find.descendant(
      of: find.ancestor(of: find.text(label), matching: find.byType(NphField)),
      matching: find.byType(TextFormField),
    );
    expect(field, findsOneWidget, reason: 'no field labelled "$label"');
    await tester.enterText(field, value);
    await tester.pump();
  }

  Future<void> fillValid(WidgetTester tester) async {
    await fill(tester, 'Full name as it appears on your NIN', 'Kunle Bakare');
    await fill(tester, 'BVN', _validBvn);
    await fill(tester, 'NIN', _validNin);
  }

  Future<void> submit(WidgetTester tester) async {
    final button = find.widgetWithText(FilledButton, 'Verify my identity');
    await tester.ensureVisible(button);
    await tester.tap(button);
    await tester.pump();
    await tester.pump();
    await tester.pump();
  }

  group('what the screen tells the mechanic', () {
    testWidgets('states plainly that the numbers are not stored', (tester) async {
      await pumpIdentity(tester);

      expect(find.textContaining('We do not store your BVN or NIN'), findsOneWidget);
      expect(find.textContaining('only the last four digits'), findsOneWidget);
      expect(
        find.textContaining('Nobody at Naija Parts Hub can see the full numbers'),
        findsOneWidget,
      );
    });

    testWidgets('gives a reason for asking at all', (tester) async {
      await pumpIdentity(tester);
      expect(find.text('Why we ask for this'), findsOneWidget);
    });

    testWidgets('after registration it reads as the last outstanding step',
        (tester) async {
      await pumpIdentity(tester, afterRegistration: true);

      expect(find.text('Your workshop details are saved'), findsOneWidget);
      // No back button: the store document already exists, and a route back
      // into a submitted form would invite a second registration.
      expect(find.byType(BackButton), findsNothing);
    });

    testWidgets('reached from the profile it can be backed out of', (tester) async {
      await pumpIdentity(tester, afterRegistration: false);
      expect(find.text('Your workshop details are saved'), findsNothing);
    });
  });

  group('input rules', () {
    testWidgets('both numbers must be exactly eleven digits', (tester) async {
      final identity = await pumpIdentity(tester);

      await fill(tester, 'Full name as it appears on your NIN', 'Kunle Bakare');
      await fill(tester, 'BVN', '2234567');
      await fill(tester, 'NIN', '7012345678');
      await submit(tester);

      expect(find.text('Must be exactly 11 digits'), findsNWidgets(2));
      // The provider is billed per call, so a locally-invalid form must never
      // reach it.
      verifyNever(
        () => identity.verify(
          bvn: any(named: 'bvn'),
          nin: any(named: 'nin'),
          fullName: any(named: 'fullName'),
        ),
      );
    });

    testWidgets('a missing legal name is refused', (tester) async {
      await pumpIdentity(tester);

      await fill(tester, 'BVN', _validBvn);
      await fill(tester, 'NIN', _validNin);
      await submit(tester);

      expect(find.text('Enter your full legal name'), findsOneWidget);
    });

    testWidgets('non-digits are stripped rather than rejected', (tester) async {
      await pumpIdentity(tester);

      // A pasted BVN often carries spaces or a stray letter. An 11-digit rule
      // that rejected them would be a dead end the mechanic cannot see.
      await fill(tester, 'BVN', '223 4567 8901');
      expect(find.text(_validBvn), findsOneWidget);
    });

    testWidgets('a valid form reaches the callable with exactly what was typed',
        (tester) async {
      final identity = await pumpIdentity(tester);

      await fill(tester, 'Full name as it appears on your NIN', '  Kunle Bakare  ');
      await fill(tester, 'BVN', _validBvn);
      await fill(tester, 'NIN', _validNin);
      await submit(tester);

      verify(
        () => identity.verify(
          bvn: _validBvn,
          nin: _validNin,
          fullName: 'Kunle Bakare',
        ),
      ).called(1);
    });
  });

  group('outcomes', () {
    testWidgets('verified is terminal and says what happens next', (tester) async {
      await pumpIdentity(tester);
      await fillValid(tester);
      await submit(tester);

      expect(find.text('Identity verified'), findsOneWidget);
      expect(find.textContaining('Your application is with our team now'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Done'), findsOneWidget);
    });

    testWidgets('manual review is terminal too — retrying cannot change it',
        (tester) async {
      await pumpIdentity(
        tester,
        result: const IdentityResult(
          IdentityOutcome.manualReview,
          message: 'An administrator will review it.',
        ),
      );
      await fillValid(tester);
      await submit(tester);

      expect(find.text('Sent for review'), findsOneWidget);
      // Disabled, because the decision is a human's now and every extra press
      // would be another billable call that cannot help.
      final button = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Verify my identity'),
      );
      expect(button.onPressed, isNull);
    });

    testWidgets('provider unavailable is never dressed up as a failure',
        (tester) async {
      await pumpIdentity(
        tester,
        result: const IdentityResult(IdentityOutcome.unavailable),
      );
      await fillValid(tester);
      await submit(tester);

      expect(find.text('Verification temporarily unavailable'), findsOneWidget);
      // The distinction the client's constraint turns on: the platform is
      // unfinished, and blaming the mechanic for our configuration would be a
      // lie with consequences for someone's livelihood.
      expect(find.textContaining('could not verify'), findsNothing);
      expect(find.textContaining('failed'), findsNothing);
    });

    testWidgets('unavailable promises no automatic retry, because there is none',
        (tester) async {
      await pumpIdentity(
        tester,
        result: const IdentityResult(IdentityOutcome.unavailable),
      );
      await fillValid(tester);
      await submit(tester);

      // Nothing re-runs a verification that could not start — the only
      // scheduled functions in the project are the subscription sweep and the
      // payment reconcile, and neither touches identity. A mechanic told "we
      // will finish this for you" would wait forever for an approval that
      // cannot come, so the copy has to send them back to this button.
      expect(find.textContaining('try this step again later'), findsOneWidget);
      expect(find.textContaining('Your registration has been saved'), findsOneWidget);

      for (final promise in [
        'nothing more for you to do',
        'We will finish',
        'we will complete',
        'automatically',
        'shortly',
      ]) {
        expect(find.textContaining(promise), findsNothing,
            reason: '"$promise" implies a background retry that does not exist');
      }
    });

    testWidgets('unavailable claims only what is true in every case',
        (tester) async {
      await pumpIdentity(
        tester,
        result: const IdentityResult(IdentityOutcome.unavailable),
      );
      await fillValid(tester);
      await submit(tester);

      // The one assurance that holds whichever backend produced the code: we
      // do not keep the numbers.
      expect(
        find.textContaining('does not store your full BVN or NIN'),
        findsOneWidget,
      );
    });

    testWidgets('unavailable never claims the numbers were not sent',
        (tester) async {
      // The app sees an error code, not which of the three paths produced it.
      // One of them — a malformed response — is thrown from inside the
      // provider call, so the identifiers may already be with Dojah. A blanket
      // "not submitted" would be a privacy promise we cannot keep, and the one
      // person who would find out is the mechanic whose BVN did travel.
      await pumpIdentity(
        tester,
        result: const IdentityResult(IdentityOutcome.unavailable),
      );
      await fillValid(tester);
      await submit(tester);

      for (final claim in [
        'were not submitted',
        'not sent to the verification provider',
        'were not sent',
        'never left',
      ]) {
        expect(find.textContaining(claim), findsNothing,
            reason: '"$claim" cannot be proven for every path that reaches this state');
      }
    });

    testWidgets('unavailable stays retryable', (tester) async {
      await pumpIdentity(
        tester,
        result: const IdentityResult(IdentityOutcome.unavailable),
      );
      await fillValid(tester);
      await submit(tester);

      final button = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Verify my identity'),
      );
      expect(button.onPressed, isNotNull,
          reason: 'once KYC is live the same mechanic must be able to try again');
      expect(find.widgetWithText(OutlinedButton, 'Done'), findsNothing);
    });

    testWidgets('a rate limit is named as one', (tester) async {
      await pumpIdentity(
        tester,
        result: const IdentityResult(
          IdentityOutcome.rateLimited,
          message: 'Try again in an hour.',
        ),
      );
      await fillValid(tester);
      await submit(tester);

      expect(find.text('Too many attempts'), findsOneWidget);
      expect(find.text('Try again in an hour.'), findsOneWidget);
    });

    testWidgets('a duplicate identity is named as one', (tester) async {
      await pumpIdentity(
        tester,
        result: const IdentityResult(
          IdentityOutcome.alreadyUsed,
          message: 'These details already belong to another account.',
        ),
      );
      await fillValid(tester);
      await submit(tester);

      expect(find.text('Already registered'), findsOneWidget);
    });

    testWidgets('a genuine rejection shows the attempts left', (tester) async {
      await pumpIdentity(
        tester,
        result: const IdentityResult(
          IdentityOutcome.failed,
          message: 'Check the numbers and try again.',
          attemptsRemaining: 3,
        ),
      );
      await fillValid(tester);
      await submit(tester);

      expect(find.text('We could not verify those details'), findsOneWidget);
      expect(
        find.textContaining('3 attempt(s) remaining'),
        findsOneWidget,
        reason: 'a lockout that arrives without warning reads as the app breaking',
      );
    });

    testWidgets('a terminal outcome does not show an attempts countdown',
        (tester) async {
      await pumpIdentity(
        tester,
        result: const IdentityResult(IdentityOutcome.verified, attemptsRemaining: 4),
      );
      await fillValid(tester);
      await submit(tester);

      expect(find.textContaining('attempt(s) remaining'), findsNothing);
    });
  });

  group('the numbers do not linger', () {
    testWidgets('a successful check clears BVN and NIN from the form',
        (tester) async {
      await pumpIdentity(tester);
      await fillValid(tester);
      expect(find.text(_validBvn), findsOneWidget);

      await submit(tester);

      expect(find.text(_validBvn), findsNothing,
          reason: 'the identifiers must not survive on screen after the one call');
      expect(find.text(_validNin), findsNothing);
    });

    testWidgets('manual review clears them too', (tester) async {
      await pumpIdentity(
        tester,
        result: const IdentityResult(IdentityOutcome.manualReview),
      );
      await fillValid(tester);
      await submit(tester);

      expect(find.text(_validBvn), findsNothing);
      expect(find.text(_validNin), findsNothing);
    });

    testWidgets('no outcome ever echoes the numbers back', (tester) async {
      for (final outcome in IdentityOutcome.values) {
        await pumpIdentity(
          tester,
          // The message is where a careless backend string could leak an echo
          // of the submitted value; nothing here should render it either way.
          result: IdentityResult(outcome, message: 'Something went wrong.'),
        );
        await fillValid(tester);
        await submit(tester);

        expect(find.textContaining(_validBvn), findsNothing,
            reason: 'BVN visible after $outcome');
        expect(find.textContaining(_validNin), findsNothing,
            reason: 'NIN visible after $outcome');
      }
    });

    testWidgets('a failed check keeps them so the mechanic can correct a typo',
        (tester) async {
      await pumpIdentity(
        tester,
        result: const IdentityResult(IdentityOutcome.failed, attemptsRemaining: 4),
      );
      await fillValid(tester);
      await submit(tester);

      // Deliberately NOT cleared here: retyping both numbers from scratch after
      // a single mistyped digit is how a mechanic burns their five attempts.
      expect(find.text(_validBvn), findsOneWidget);
    });
  });

  group('double submission', () {
    testWidgets('the button is disabled while a check is in flight',
        (tester) async {
      final identity = MockIdentityService();
      // Never completes, so the in-flight state can be observed.
      when(
        () => identity.verify(
          bvn: any(named: 'bvn'),
          nin: any(named: 'nin'),
          fullName: any(named: 'fullName'),
        ),
      ).thenAnswer((_) => Completer<IdentityResult>().future);

      await tester.pumpWidget(
        ProviderScope(
          overrides: mechanicOverrides(identityService: identity),
          child: MaterialApp(
            theme: buildNphTheme(),
            home: const MechanicIdentityScreen(),
          ),
        ),
      );
      await tester.pump();

      await fillValid(tester);
      final button = find.widgetWithText(FilledButton, 'Verify my identity');
      await tester.ensureVisible(button);
      await tester.tap(button);
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      final disabled = tester.widget<FilledButton>(find.byType(FilledButton));
      expect(disabled.onPressed, isNull,
          reason: 'a second tap would be a second billable provider call');
    });
  });
}
