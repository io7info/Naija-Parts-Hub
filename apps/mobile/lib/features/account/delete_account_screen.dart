import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/env.dart';
import '../../core/errors.dart';
import '../../core/formatting.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../models/store.dart';
import '../../services/auth_service.dart';
import '../../services/listing_service.dart';

/// Account deletion — Apple Guideline 5.1.1(v) and Google Play.
///
/// Three gates, in order:
///
///   1. Consequences, itemised. Not a generic "are you sure".
///   2. A typed confirmation, which guards against a mis-tap.
///   3. **Phone OTP reauthentication**, which guards against someone acting on
///      an unattended, already-signed-in handset.
///
/// The `deleteAccount` callable only runs after step 3 succeeds. It uses the
/// Admin SDK, which never asks for reauthentication itself — so if this screen
/// did not require it, a signed-in session left open would be enough to destroy
/// a dealer's entire business, and the session may be weeks old.
///
/// Deliberately a full screen rather than stacked dialogs: this flow has two
/// asynchronous failure paths (OTP send, OTP verify), and dialogs make error
/// state, retry and the back gesture all fight each other.
class DeleteAccountScreen extends ConsumerStatefulWidget {
  const DeleteAccountScreen({super.key, required this.store});

  final Store store;

  @override
  ConsumerState<DeleteAccountScreen> createState() => _DeleteAccountScreenState();
}

enum _Step { confirm, verify }

class _DeleteAccountScreenState extends ConsumerState<DeleteAccountScreen> {
  final _confirmCtrl = TextEditingController();
  final _codeCtrl = TextEditingController();

  _Step _step = _Step.confirm;
  String? _verificationId;
  bool _busy = false;
  String? _error;

  /// Android can complete verification with no code entered. That is convenient
  /// for sign-in and wrong for a deletion challenge, so the credential is held
  /// and the dealer still has to press Delete.
  PhoneAuthCredential? _autoCredential;

  @override
  void dispose() {
    _confirmCtrl.dispose();
    _codeCtrl.dispose();
    super.dispose();
  }

  bool get _confirmed => _confirmCtrl.text.trim().toUpperCase() == 'DELETE';

  Future<void> _sendCode() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final id = await ref.read(authServiceProvider).sendReauthOtp(
            onAutoRetrieved: (credential) {
              if (!mounted) return;
              setState(() => _autoCredential = credential);
            },
            onError: (m) {
              if (mounted) setState(() => _error = m);
            },
          );
      if (!mounted) return;
      setState(() {
        _verificationId = id;
        _step = _Step.verify;
      });
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reauthenticateAndDelete() async {
    final code = _codeCtrl.text.trim();
    final auth = ref.read(authServiceProvider);

    // Instant verification supplies a credential without a code; otherwise the
    // dealer must have typed all six digits.
    final credential = _autoCredential ??
        (code.length == 6 && _verificationId != null
            ? auth.credentialFrom(_verificationId!, code)
            : null);

    if (credential == null) {
      setState(() => _error = 'Enter the six-digit code sent to your phone.');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      // Order matters: prove identity first, delete second. A failure here must
      // leave the account completely untouched.
      await auth.reauthenticate(credential);
      await ref.read(listingServiceProvider).deleteAccount();
      // Deleting the auth user invalidates the token, so authStateChanges emits
      // null and the gate returns to sign-in on its own. Nothing to navigate.
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = friendlyError(e);
          // A wrong or expired code must not leave a stale auto-credential
          // behind, or the next attempt silently reuses it.
          _autoCredential = null;
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: NphColors.background,
      appBar: AppBar(
        title: const Text('Delete Account'),
        leading: NphIconButton(
          icon: Icons.arrow_back,
          tooltip: 'Back',
          onPressed: _busy ? null : () => Navigator.of(context).maybePop(),
        ),
        shape: const Border(bottom: BorderSide(color: NphColors.border)),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(NphSpacing.appPage),
          children: [
            const NphIconTile(
              icon: Icons.warning_amber_rounded,
              size: NphIconTileSize.hero,
              background: NphColors.error10,
              foreground: NphColors.error,
            ),
            const SizedBox(height: NphSpacing.xl),
            Text(
              _step == _Step.confirm ? 'Delete your account?' : 'Verify it is you',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: NphSpacing.md),
            if (_step == _Step.confirm) ..._confirmStep() else ..._verifyStep(),
            if (_error != null) ...[
              const SizedBox(height: NphSpacing.lg),
              NphNotice(message: _error!),
            ],
            const SizedBox(height: NphSpacing.xl),
            _primaryAction(),
            const SizedBox(height: NphSpacing.sm),
            TextButton(
              onPressed: _busy ? null : () => Navigator.of(context).maybePop(),
              style: TextButton.styleFrom(foregroundColor: NphColors.mutedForeground),
              child: const Text('Cancel — keep my account'),
            ),
            const SizedBox(height: NphSpacing.xxxl),
          ],
        ),
      ),
    );
  }

  List<Widget> _confirmStep() {
    final store = widget.store;
    return [
      Text(
        'This cannot be undone.',
        textAlign: TextAlign.center,
        style: Theme.of(context)
            .textTheme
            .bodyMedium
            ?.copyWith(color: NphColors.mutedForeground),
      ),
      const SizedBox(height: NphSpacing.xl),
      NphCard(
        color: NphColors.warm,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Deleting removes permanently:',
              style: TextStyle(
                fontFamily: NphFonts.body,
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: NphColors.foreground,
              ),
            ),
            const SizedBox(height: NphSpacing.md),
            _bullet('Your store, "${store.businessName}"'),
            _bullet('Every listing — ${store.activeListingCount} active, plus all drafts'),
            _bullet('All product photos'),
            if (store.slug.isNotEmpty)
              _bullet(
                'Your public store link. It cannot be reissued, so any link a '
                'buyer has saved stops working.',
              ),
          ],
        ),
      ),
      const SizedBox(height: NphSpacing.xl),
      const NphFieldLabel('Type DELETE to continue'),
      TextField(
        controller: _confirmCtrl,
        enabled: !_busy,
        textCapitalization: TextCapitalization.characters,
        inputFormatters: [LengthLimitingTextInputFormatter(10)],
        decoration: const InputDecoration(hintText: 'DELETE'),
        onChanged: (_) => setState(() {}),
      ),
    ];
  }

  List<Widget> _verifyStep() {
    return [
      Text(
        'For your security, confirm the phone number on this account before we '
        'delete anything.',
        textAlign: TextAlign.center,
        style: Theme.of(context)
            .textTheme
            .bodyMedium
            ?.copyWith(color: NphColors.mutedForeground),
      ),
      const SizedBox(height: NphSpacing.xl),
      NphBanner(
        message: _autoCredential != null
            ? 'Your phone verified automatically. Press Delete to finish.'
            : 'We sent a six-digit code to ${formatNigerianPhone(widget.store.phone)}.',
        tone: _autoCredential != null ? NphTone.success : NphTone.neutral,
        icon: _autoCredential != null ? Icons.verified_outlined : Icons.sms_outlined,
      ),
      const SizedBox(height: NphSpacing.xl),
      if (_autoCredential == null) ...[
        const NphFieldLabel('Verification code'),
        TextField(
          controller: _codeCtrl,
          enabled: !_busy,
          keyboardType: TextInputType.number,
          autofillHints: const [AutofillHints.oneTimeCode],
          inputFormatters: [
            FilteringTextInputFormatter.digitsOnly,
            LengthLimitingTextInputFormatter(6),
          ],
          style: const TextStyle(
            fontFamily: NphFonts.heading,
            fontSize: 20,
            fontWeight: FontWeight.w700,
            letterSpacing: 8,
          ),
          decoration: const InputDecoration(hintText: '000000'),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: NphSpacing.sm),
        TextButton(
          onPressed: _busy ? null : _sendCode,
          child: const Text('Resend code'),
        ),
      ],
    ];
  }

  Widget _primaryAction() {
    if (_step == _Step.confirm) {
      return FilledButton(
        style: FilledButton.styleFrom(backgroundColor: NphColors.error),
        onPressed: (_busy || !_confirmed) ? null : _sendCode,
        child: _busy ? const _Spinner() : const Text('Continue'),
      );
    }
    return FilledButton(
      style: FilledButton.styleFrom(backgroundColor: NphColors.error),
      onPressed: _busy ? null : _reauthenticateAndDelete,
      child: _busy ? const _Spinner() : const Text('Delete my account permanently'),
    );
  }

  Widget _bullet(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 6, right: NphSpacing.sm),
            child: SizedBox(
              width: 4,
              height: 4,
              child: DecoratedBox(
                decoration: BoxDecoration(color: NphColors.error, shape: BoxShape.circle),
              ),
            ),
          ),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                fontFamily: NphFonts.body,
                fontSize: 13,
                height: 1.5,
                color: NphColors.foreground,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Spinner extends StatelessWidget {
  const _Spinner();

  @override
  Widget build(BuildContext context) => const SizedBox(
        height: 18,
        width: 18,
        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
      );
}

/// Debug helper: the Auth emulator never sends an SMS.
///
/// Kept out of the widget above so there is no chance of it reaching a release
/// build — this is only referenced from a kDebugMode branch.
Future<String?> emulatorReauthCode(WidgetRef ref, String phone) {
  if (!Env.useEmulator) return Future.value(null);
  return ref.read(authServiceProvider).fetchEmulatorOtp(phone);
}
