import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';

/// Turns an exception into something a dealer should actually read.
///
/// Interpolating an exception with `'$e'` includes the whole asynchronous
/// stack trace, which is how a registration failure ended up showing five
/// frames of `CloudFunctionsHostApi.call` on screen. A dealer cannot act on a
/// stack trace, and it makes a routine validation error look like a crash.
///
/// The underlying error is still worth having, so callers should log it — this
/// governs presentation only.
String friendlyError(Object error) {
  if (error is FirebaseFunctionsException) {
    // Transport failures are handled BEFORE `message`, because for these the
    // SDK has no server text to carry and fills `message` with the raw gRPC
    // status name instead. Preferring the message put "DEADLINE_EXCEEDED" on
    // screen where a dealer expected a sentence.
    switch (error.code) {
      case 'deadline-exceeded':
      case 'unavailable':
      case 'cancelled':
        return 'Could not reach the server. Check your connection and try again.';
    }

    // Server-side validation and business rules arrive here. `message` is the
    // text the callable chose deliberately; the code is plumbing.
    final message = error.message?.trim();
    if (message != null && message.isNotEmpty && !_looksMachineGenerated(message)) {
      return _tidy(message);
    }
    return switch (error.code) {
      'unauthenticated' => 'Please sign in again.',
      'permission-denied' => 'You do not have permission to do that.',
      'resource-exhausted' => 'You have reached a limit on your plan.',
      'unavailable' || 'deadline-exceeded' =>
        'Could not reach the server. Check your connection and try again.',
      _ => 'Something went wrong. Please try again.',
    };
  }

  if (error is FirebaseAuthException) {
    // Checked before the code switch, because the SDK reports an unreachable
    // backend as the catch-all "internal-error" with the real cause buried in
    // the message. Left alone, a stopped Emulator Suite reads as
    //   "An internal error has occurred. [ Failed to connect to /10.0.2.2:9099 ]"
    // which sounds like an app bug rather than a service that is not running.
    final unreachable = _unreachableBackend(error.message);
    if (unreachable != null) return unreachable;

    return switch (error.code) {
      'invalid-verification-code' => 'That code is not correct. Please check and try again.',
      // Happens when a code is reused after a successful sign-in, or after the
      // session has been restarted.
      'invalid-verification-id' => 'This code has expired. Request a new one.',
      'session-expired' => 'The code has expired. Request a new one.',
      'too-many-requests' => 'Too many attempts. Please wait a few minutes.',
      'invalid-phone-number' => 'That phone number does not look right.',
      'network-request-failed' =>
        'No internet connection. Check your network and try again.',
      _ => _tidy(error.message ?? 'Sign-in failed. Please try again.'),
    };
  }

  if (error is FirebaseException) {
    // Firestore and Storage refusals arrive here. `permission-denied` is the
    // one a dealer is most likely to hit, and its raw message ("Missing or
    // insufficient permissions.") reads like a bug in the app rather than what
    // it usually is: a store that is still pending, or has been suspended.
    switch (error.code) {
      case 'permission-denied':
        return 'You do not have access to this yet. If your business is still '
            'awaiting approval, publishing and editing unlock once an '
            'administrator approves it.';
      case 'unauthenticated':
        return 'Your session has expired. Please sign in again.';
      case 'unavailable':
        return 'Could not reach the server. Your changes are saved on this '
            'phone and will sync when you are back online.';
      case 'not-found':
        return 'That item no longer exists. It may have been deleted from '
            'another device.';
      case 'resource-exhausted':
        return 'You have reached a limit on your plan.';
    }
    return _tidy(error.message ?? 'Something went wrong. Please try again.');
  }

  return _tidy(error.toString());
}

/// Recognises "the backend is not reachable" hiding inside an SDK message.
///
/// Returns null when the message says nothing of the sort, so the caller falls
/// through to its normal handling.
String? _unreachableBackend(String? message) {
  if (message == null) return null;

  final match = RegExp(r'Failed to connect to /?([\d.]+):(\d+)').firstMatch(message);
  if (match == null) return null;

  final host = match.group(1)!;
  final port = match.group(2)!;

  // 10.0.2.2 is the Android emulator's alias for the host loopback, so this can
  // only be a local Emulator Suite that is not running. Naming the command is
  // the whole point — the raw message gives an address and leaves you guessing.
  if (host == '10.0.2.2' || host.startsWith('127.') || host == 'localhost') {
    return 'Cannot reach the local Firebase emulator on $host:$port.\n'
        'Start it with "npm run emulators" from the project root, then try again.';
  }

  return 'Could not reach the server. Check your connection and try again.';
}

/// Whether this failure means the account already has a store.
///
/// Worth telling apart from other refusals. It is exactly what a registration
/// that succeeded on the server but timed out on the way back looks like when
/// the user presses the button again — the work is done, and reporting it as a
/// failure would strand someone behind a completed form.
bool isAlreadyRegistered(Object error) {
  if (error is! FirebaseFunctionsException) return false;
  if (error.code == 'already-exists') return true;
  final details = error.details;
  return details is Map && details['code'] == 'ALREADY_REGISTERED';
}

/// Whether a message is a machine token rather than something written for a
/// person — `DEADLINE_EXCEEDED`, `UNAVAILABLE`, `INTERNAL_ERROR`.
///
/// A backstop for the codes not enumerated above. Every message this project
/// writes deliberately is a sentence, so nothing legitimate is caught by it.
bool _looksMachineGenerated(String message) =>
    RegExp(r'^[A-Z][A-Z0-9_]{2,}$').hasMatch(message);

/// Strips stack frames and SDK prefixes from a message.
String _tidy(String raw) {
  final firstLine = raw.split('\n').first.trim();
  return firstLine
      .replaceFirst(RegExp(r'^\[[^\]]+\]\s*'), '') // [firebase_auth/...] prefix
      .replaceFirst(RegExp(r'^(Exception|Error):\s*'), '')
      .trim();
}
