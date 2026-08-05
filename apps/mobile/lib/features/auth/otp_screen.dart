import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/env.dart';
import '../../core/errors.dart';
import '../../design/tokens.dart';
import '../../design/widgets.dart';
import '../../services/auth_service.dart';

/// OTP verification (SOW section 2).
///
/// Split out of the sign-in screen to match the approved design, which shows
/// these as two screens with back navigation. The authentication calls are
/// unchanged: confirmOtp and the emulator code lookup behave exactly as they
/// did when this was a second state of the login screen.
///
/// No navigation on success — the auth gate watches authStateChanges and
/// re-routes on its own. That is what stops Android instant verification
/// stranding the UI, so it is preserved deliberately.
class OtpScreen extends ConsumerStatefulWidget {
  const OtpScreen({
    super.key,
    required this.verificationId,
    required this.phoneNumber,
  });

  final String verificationId;
  final String phoneNumber;

  @override
  ConsumerState<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends ConsumerState<OtpScreen> {
  static const _length = 6;
  static const _expirySeconds = 300;

  final _otpCtrl = TextEditingController();
  final _focus = FocusNode();

  bool _busy = false;
  String? _error;
  late int _remaining = _expirySeconds;
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() => _remaining = _remaining > 0 ? _remaining - 1 : 0);
    });
    _prefillEmulatorCode();
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _otpCtrl.dispose();
    _focus.dispose();
    super.dispose();
  }

  /// Reads the code straight from the Auth emulator so local testing needs no
  /// real phone. No-op against a live project.
  Future<void> _prefillEmulatorCode() async {
    final code = await ref.read(authServiceProvider).fetchEmulatorOtp(widget.phoneNumber);
    if (code != null && mounted) setState(() => _otpCtrl.text = code);
  }

  Future<void> _confirm() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(authServiceProvider)
          .confirmOtp(widget.verificationId, _otpCtrl.text.trim());

      // The gate re-routes on authStateChanges, but it sits BELOW this pushed
      // route — so without popping, sign-in succeeds invisibly and the dealer
      // sees nothing happen. Tapping again then reuses a verificationId that
      // has already been consumed, producing
      // [firebase_auth/invalid-verification-id].
      //
      // popUntil isFirst rather than pop(): it also clears the sign-in screen,
      // so Android's back button cannot return to a login form for a session
      // that is already authenticated.
      if (mounted) {
        Navigator.of(context).popUntil((route) => route.isFirst);
      }
    } catch (e) {
      // friendlyError distinguishes a wrong code from an expired one from a
      // network failure. The inherited screen reported "Invalid code" for every
      // failure here — including a network error after a successful sign-in,
      // which left dealers permanently stuck.
      if (mounted) setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String get _clock {
    final m = (_remaining ~/ 60).toString().padLeft(2, '0');
    final s = (_remaining % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  /// "+2349036726262" -> "+234 903 672 6262"
  String get _prettyPhone {
    final d = widget.phoneNumber.replaceAll(RegExp(r'[^0-9]'), '');
    if (d.length < 13) return widget.phoneNumber;
    return '+${d.substring(0, 3)} ${d.substring(3, 6)} ${d.substring(6, 9)} ${d.substring(9)}';
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final complete = _otpCtrl.text.trim().length == _length;

    return Scaffold(
      appBar: AppBar(leading: const BackButton()),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(
                  horizontal: NphSpacing.page,
                  vertical: NphSpacing.sm,
                ),
                children: [
                  Text('Enter Verification Code', style: text.displayMedium),
                  const SizedBox(height: NphSpacing.sm),
                  Text.rich(
                    TextSpan(
                      text: 'We sent a six-digit code to ',
                      children: [
                        TextSpan(
                          text: _prettyPhone,
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            color: NphColors.foreground,
                          ),
                        ),
                        const TextSpan(text: '.'),
                      ],
                    ),
                    style: text.bodyLarge?.copyWith(color: NphColors.mutedForeground),
                  ),

                  const SizedBox(height: NphSpacing.xxxl),

                  _CodeBoxes(
                    controller: _otpCtrl,
                    focusNode: _focus,
                    length: _length,
                    onChanged: () => setState(() {}),
                  ),

                  if (_error != null) ...[
                    const SizedBox(height: NphSpacing.xl),
                    NphNotice(message: _error!),
                  ],

                  const SizedBox(height: NphSpacing.xxl),

                  ElevatedButton(
                    onPressed: (_busy || !complete) ? null : _confirm,
                    child: _busy
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('Verify and Continue'),
                  ),

                  const SizedBox(height: NphSpacing.md),
                  TextButton(
                    onPressed: _busy || _remaining > 0 ? null : () => Navigator.of(context).pop(),
                    child: Text(_remaining > 0 ? 'Resend Code in $_clock' : 'Resend Code'),
                  ),
                  TextButton(
                    onPressed: _busy ? null : () => Navigator.of(context).pop(),
                    style: TextButton.styleFrom(foregroundColor: NphColors.mutedForeground),
                    child: const Text('Change Phone Number'),
                  ),

                  if (kDebugMode && Env.useEmulator) ...[
                    const SizedBox(height: NphSpacing.sm),
                    Text(
                      'Emulator: code filled in automatically',
                      textAlign: TextAlign.center,
                      style: text.labelSmall,
                    ),
                  ],
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(bottom: NphSpacing.xl),
              child: Text(
                _remaining > 0 ? 'Code expires in $_clock' : 'Code expired',
                style: text.bodySmall,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Six boxes that share one hidden field.
///
/// A single TextField behind six painted boxes, rather than six real fields:
/// SMS autofill and paste both deliver the whole code at once, and per-box
/// fields make that fiddly — a dealer pasting a code should not have to
/// distribute six digits by hand.
class _CodeBoxes extends StatelessWidget {
  const _CodeBoxes({
    required this.controller,
    required this.focusNode,
    required this.length,
    required this.onChanged,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final int length;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final digits = controller.text.split('');

    return Stack(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: List.generate(length, (i) {
            final filled = i < digits.length;
            return Container(
              width: 48,
              height: 56,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: filled ? NphColors.orangeSubtle : NphColors.background,
                borderRadius: NphRadius.fieldBorder,
                border: Border.all(
                  color: filled ? NphColors.orange : NphColors.border,
                  width: filled ? 1.5 : 1,
                ),
              ),
              child: Text(
                filled ? digits[i] : '',
                style: const TextStyle(
                  fontFamily: NphFonts.body,
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                  color: NphColors.foreground,
                ),
              ),
            );
          }),
        ),
        Positioned.fill(
          child: Opacity(
            opacity: 0,
            child: TextField(
              controller: controller,
              focusNode: focusNode,
              autofocus: true,
              keyboardType: TextInputType.number,
              maxLength: length,
              autofillHints: const [AutofillHints.oneTimeCode],
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              onChanged: (_) => onChanged(),
              decoration: const InputDecoration(counterText: ''),
            ),
          ),
        ),
      ],
    );
  }
}
