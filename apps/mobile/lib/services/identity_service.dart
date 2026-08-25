import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/store.dart';
import 'store_service.dart';

/// The outcome of a BVN/NIN check, as the app needs to present it.
enum IdentityOutcome {
  verified,

  /// Both numbers are real but the name disagrees with the government record.
  /// An administrator resolves it — the mechanic can still submit.
  manualReview,

  /// The identifiers were not found, or did not belong together.
  failed,

  /// Too many attempts. Every one is a paid provider call.
  rateLimited,

  /// These details already belong to another mechanic account.
  alreadyUsed,

  /// Identity verification is not switched on yet.
  ///
  /// A distinct outcome, never folded into `failed`: it means the platform is
  /// unfinished, not that this person failed a check, and telling a mechanic
  /// the latter when the former is true would be a lie with consequences.
  ///
  /// Recovering from it is MANUAL. No scheduled function, queue or trigger
  /// re-runs a verification that could not start, so every message for this
  /// outcome has to send the mechanic back to the button rather than imply
  /// the check will complete by itself.
  unavailable,
}

class IdentityResult {
  const IdentityResult(this.outcome, {this.message, this.attemptsRemaining});

  final IdentityOutcome outcome;
  final String? message;
  final int? attemptsRemaining;
}

/// BVN and NIN verification for mechanics.
///
/// The numbers go straight from the form into this callable over HTTPS and no
/// further. They are never written to Firestore by the app, never logged,
/// never attached to analytics or a crash report, and never held in a provider
/// or any state that outlives the submission.
class IdentityService {
  IdentityService(this._functions);

  final FirebaseFunctions _functions;

  Future<IdentityResult> verify({
    required String bvn,
    required String nin,
    required String fullName,
  }) async {
    try {
      final result = await _functions
          .httpsCallable('verifyMechanicIdentity')
          .call<Map<String, dynamic>>({
        'bvn': bvn,
        'nin': nin,
        'fullName': fullName,
      });

      final data = result.data;
      final remaining = (data['attemptsRemaining'] as num?)?.toInt();

      return switch (data['status'] as String?) {
        'verified' => IdentityResult(IdentityOutcome.verified, attemptsRemaining: remaining),
        'manual_review' => IdentityResult(
            IdentityOutcome.manualReview,
            message: 'Your identity was found, but the name does not match our records exactly. '
                'An administrator will review it — you can continue.',
            attemptsRemaining: remaining,
          ),
        _ => IdentityResult(
            IdentityOutcome.failed,
            message: 'We could not verify those details. Check the numbers and try again.',
            attemptsRemaining: remaining,
          ),
      };
    } on FirebaseFunctionsException catch (e) {
      // The backend's ErrorCode travels in `details`, so the app can tell a
      // rate limit from a genuine rejection without parsing message text.
      final details = e.details is Map ? Map<String, dynamic>.from(e.details as Map) : null;
      final code = details?['code'] as String?;

      return switch (code) {
        'IDENTITY_PROVIDER_UNAVAILABLE' => IdentityResult(
            IdentityOutcome.unavailable,
            // Retrying is manual — see the note in mechanic_identity_screen.
            // Nothing in the backend picks this up again on its own, and this
            // fallback makes no claim about whether the identifiers reached
            // the provider, because from here that is unknowable.
            message: e.message ??
                'We could not complete identity verification right now. Your registration '
                    'has been saved. Please try again later.',
          ),
        'IDENTITY_ATTEMPTS_EXCEEDED' =>
          IdentityResult(IdentityOutcome.rateLimited, message: e.message),
        'IDENTITY_ALREADY_USED' =>
          IdentityResult(IdentityOutcome.alreadyUsed, message: e.message),
        _ => IdentityResult(
            IdentityOutcome.failed,
            message: e.message ?? 'We could not complete the identity check.',
          ),
      };
    }
  }
}

final identityServiceProvider = Provider<IdentityService>(
  (ref) => IdentityService(ref.watch(functionsProvider)),
);

/// Whether a store still needs to complete identity verification.
///
/// Dealers never do — they have no identity block and the client was explicit
/// that BVN and NIN are not part of their flow.
bool needsIdentityVerification(Store store) =>
    store.isMechanic && !store.identityVerified;
