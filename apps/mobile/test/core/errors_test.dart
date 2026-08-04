import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:naija_parts_hub/core/errors.dart';

/// These guard one specific regression: a dealer being shown a Dart stack
/// trace. Registration failures were rendering five frames of
/// `CloudFunctionsHostApi.call` on screen, which reads as a crash rather than
/// "your business name is too long".
void main() {
  group('friendlyError', () {
    test('uses the callable message and drops the trailing stack trace', () {
      final error = FirebaseFunctionsException(
        code: 'invalid-argument',
        message: 'businessName must be between 1 and 100 characters\n'
            '#0      CloudFunctionsHostApi.call (package:cloud_functions_platform_interface/…)\n'
            '#1      MethodChannelHttpsCallableReference.call (…)',
      );

      final shown = friendlyError(error);

      expect(shown, 'businessName must be between 1 and 100 characters');
      expect(shown, isNot(contains('#0')));
      expect(shown, isNot(contains('package:')));
    });

    test('falls back to a plain sentence when the callable sends no message', () {
      // A transport-level failure (no connection, function cold-start timeout)
      // reaches the client with the code set and the message blank.
      expect(
        friendlyError(FirebaseFunctionsException(code: 'unauthenticated', message: '')),
        'Please sign in again.',
      );
      expect(
        friendlyError(FirebaseFunctionsException(code: 'unavailable', message: '   ')),
        contains('Check your connection'),
      );
    });

    test('explains a consumed verification id as expiry, not as a bug', () {
      // What a dealer hit by tapping "Verify" twice. "invalid-verification-id"
      // is meaningless to them; "request a new code" is actionable.
      final shown = friendlyError(FirebaseAuthException(code: 'invalid-verification-id'));

      expect(shown, 'This code has expired. Request a new one.');
      expect(shown, isNot(contains('verification-id')));
    });

    test('distinguishes a wrong code from a network failure', () {
      expect(
        friendlyError(FirebaseAuthException(code: 'invalid-verification-code')),
        contains('not correct'),
      );
      expect(
        friendlyError(FirebaseAuthException(code: 'network-request-failed')),
        contains('No internet connection'),
      );
    });

    test('names the emulator and the fix when the local suite is not running', () {
      // Verbatim from the device with the Emulator Suite stopped. The SDK
      // reports it as a generic internal error, which reads as an app bug.
      final shown = friendlyError(
        FirebaseAuthException(
          code: 'unknown',
          message: 'An internal error has occurred. '
              '[ Failed to connect to /10.0.2.2:9099 ]',
        ),
      );

      expect(shown, contains('10.0.2.2:9099'));
      expect(shown, contains('npm run emulators'));
      expect(shown, isNot(contains('internal error')));
    });

    test('reports a remote host as a plain connectivity problem', () {
      // Not the emulator, so the emulator advice would be wrong and confusing.
      final shown = friendlyError(
        FirebaseAuthException(
          code: 'unknown',
          message: 'Failed to connect to /142.250.200.10:443',
        ),
      );

      expect(shown, contains('Check your connection'));
      expect(shown, isNot(contains('npm run emulators')));
    });

    test('strips the [plugin/code] prefix from unmapped SDK messages', () {
      final shown = friendlyError(
        FirebaseAuthException(code: 'some-new-code', message: '[firebase_auth/some-new-code] Boom.'),
      );

      expect(shown, 'Boom.');
    });

    test('handles a plain exception without leaking the Exception: prefix', () {
      expect(friendlyError(Exception('Something broke')), 'Something broke');
    });
  });
}
