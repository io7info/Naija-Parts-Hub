import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/env.dart';
import '../core/errors.dart';

/// Phone OTP authentication (SOW section 2).
///
/// Works identically against the Auth emulator and a live project — the only
/// difference is where the code comes from, and that is handled by
/// [fetchEmulatorOtp] rather than by branching in the UI.
class AuthService {
  AuthService(this._auth);

  final FirebaseAuth _auth;

  Stream<User?> get authStateChanges => _auth.authStateChanges();
  User? get currentUser => _auth.currentUser;
  String? get uid => _auth.currentUser?.uid;

  /// Sends an OTP. Returns the verificationId needed to confirm it.
  ///
  /// On a live Android build, instant verification can complete sign-in without
  /// any code being entered. The inherited implementation dropped that case on
  /// the floor, leaving the login screen waiting forever for an SMS that never
  /// arrived — [onAutoVerified] exists so the UI can react.
  Future<String> sendOtp(
    String phoneNumber, {
    required void Function(UserCredential credential) onAutoVerified,
    required void Function(String message) onError,
  }) async {
    final completer = Completer<String>();

    await _auth.verifyPhoneNumber(
      phoneNumber: phoneNumber,
      verificationCompleted: (credential) async {
        try {
          final result = await _auth.signInWithCredential(credential);
          onAutoVerified(result);
        } catch (e) {
          // These messages go straight into the login screen's error banner, so
          // they must already be readable — the screen cannot re-map them.
          onError(friendlyError(e));
        }
      },
      verificationFailed: (e) {
        onError(friendlyError(e));
        if (!completer.isCompleted) completer.completeError(e);
      },
      codeSent: (verificationId, _) {
        if (!completer.isCompleted) completer.complete(verificationId);
      },
      codeAutoRetrievalTimeout: (verificationId) {
        if (!completer.isCompleted) completer.complete(verificationId);
      },
    );

    return completer.future;
  }

  Future<UserCredential> confirmOtp(String verificationId, String smsCode) {
    return _auth.signInWithCredential(
      PhoneAuthProvider.credential(
        verificationId: verificationId,
        smsCode: smsCode,
      ),
    );
  }

  Future<void> signOut() => _auth.signOut();

  /// Sends an OTP for **reauthentication**, not sign-in.
  ///
  /// Apple Guideline 5.1.1(v) and Google Play both require in-app account
  /// deletion, and deletion is irreversible: it destroys every listing, every
  /// photo and the store's public URL. A typed confirmation only proves someone
  /// can read; proving it is the account holder needs the phone.
  ///
  /// Deliberately separate from [sendOtp]: the sign-in flow completes on
  /// `verificationCompleted` via Android instant verification, which would
  /// silently satisfy a deletion challenge without the dealer entering
  /// anything. Here instant verification is reported back for the caller to
  /// handle explicitly rather than auto-accepted.
  Future<String> sendReauthOtp({
    required void Function(PhoneAuthCredential credential) onAutoRetrieved,
    required void Function(String message) onError,
  }) async {
    final user = _auth.currentUser;
    final phone = user?.phoneNumber;
    if (user == null || phone == null || phone.isEmpty) {
      throw FirebaseAuthException(
        code: 'no-phone-number',
        message: 'This account has no phone number to verify against.',
      );
    }

    final completer = Completer<String>();

    await _auth.verifyPhoneNumber(
      phoneNumber: phone,
      verificationCompleted: onAutoRetrieved,
      verificationFailed: (e) {
        onError(friendlyError(e));
        if (!completer.isCompleted) completer.completeError(e);
      },
      codeSent: (verificationId, _) {
        if (!completer.isCompleted) completer.complete(verificationId);
      },
      codeAutoRetrievalTimeout: (verificationId) {
        if (!completer.isCompleted) completer.complete(verificationId);
      },
    );

    return completer.future;
  }

  /// Proves the caller still holds the account's phone, immediately before a
  /// destructive action.
  ///
  /// `reauthenticateWithCredential` also refreshes the token's `auth_time`,
  /// which is what stops a long-lived session being enough on its own.
  Future<void> reauthenticate(PhoneAuthCredential credential) async {
    final user = _auth.currentUser;
    if (user == null) {
      throw FirebaseAuthException(
        code: 'user-not-signed-in',
        message: 'Sign in again before continuing.',
      );
    }
    await user.reauthenticateWithCredential(credential);
  }

  /// Builds the credential from a typed code.
  PhoneAuthCredential credentialFrom(String verificationId, String smsCode) =>
      PhoneAuthProvider.credential(verificationId: verificationId, smsCode: smsCode);

  /// Pulls the OTP straight out of the Auth emulator.
  ///
  /// The emulator never sends an SMS; it exposes issued codes over a REST
  /// endpoint instead. Reading it here keeps local development unblocked
  /// without a real phone number or Firebase project. Returns null against a
  /// live project, where no such endpoint exists.
  Future<String?> fetchEmulatorOtp(String phoneNumber) async {
    if (!Env.useEmulator) return null;
    try {
      final uri = Uri.parse(
        'http://${Env.emulatorHost}:${Env.authPort}'
        '/emulator/v1/projects/${Env.demoProjectId}/verificationCodes',
      );
      final client = HttpClient();
      final request = await client.getUrl(uri);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      client.close();

      final codes = (jsonDecode(body) as Map<String, dynamic>)['verificationCodes'];
      if (codes is! List || codes.isEmpty) return null;

      final normalized = phoneNumber.replaceAll(RegExp(r'[^0-9+]'), '');
      for (final entry in codes.reversed) {
        final session = entry as Map<String, dynamic>;
        if ((session['phoneNumber'] as String?)?.replaceAll(RegExp(r'[^0-9+]'), '') ==
            normalized) {
          return session['code'] as String?;
        }
      }
      return (codes.last as Map<String, dynamic>)['code'] as String?;
    } catch (e) {
      debugPrint('Could not read emulator OTP: $e');
      return null;
    }
  }
}

final authServiceProvider = Provider<AuthService>(
  (ref) => AuthService(FirebaseAuth.instance),
);

/// Drives the auth gate. Using the stream rather than a one-shot
/// currentUser read means the UI cannot fall out of sync with auth state —
/// which is what happened on Android instant verification previously.
final authStateProvider = StreamProvider<User?>(
  (ref) => ref.watch(authServiceProvider).authStateChanges,
);
