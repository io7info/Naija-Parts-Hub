import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/env.dart';
import '../../core/errors.dart';
import '../../design/tokens.dart';
import '../../design/widgets.dart';
import '../../services/auth_service.dart';
import '../splash/splash_screen.dart';
import 'otp_screen.dart';

/// Dealer sign-in (SOW section 2).
///
/// Styled to the approved design. The authentication logic is unchanged —
/// every AuthService call and state transition is exactly as verified working
/// against the emulator.
///
/// One deliberate change the design forces: +234 is now a fixed prefix rather
/// than part of the editable text. The controller therefore holds the national
/// number and [_e164] composes it, stripping the leading 0 Nigerians usually
/// type (0803… -> +234803…). Sending "+2340803…" would be rejected.
class PhoneLoginScreen extends ConsumerStatefulWidget {
  const PhoneLoginScreen({super.key});

  @override
  ConsumerState<PhoneLoginScreen> createState() => _PhoneLoginScreenState();
}

class _PhoneLoginScreenState extends ConsumerState<PhoneLoginScreen> {
  final _phoneCtrl = TextEditingController();

  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _phoneCtrl.dispose();
    super.dispose();
  }

  /// National digits -> E.164. Nigerians dial 0803…; the country code replaces
  /// that trunk 0.
  String get _e164 {
    final digits = _phoneCtrl.text.replaceAll(RegExp(r'[^0-9]'), '');
    final national = digits.startsWith('0') ? digits.substring(1) : digits;
    return '+234$national';
  }

  bool get _canSubmit => _phoneCtrl.text.replaceAll(RegExp(r'[^0-9]'), '').length >= 10;

  Future<void> _sendOtp() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final phone = _e164;
      final id = await ref.read(authServiceProvider).sendOtp(
            phone,
            // Android instant verification signs in with no code entered. The
            // auth gate listens to authStateChanges, so it routes on its own.
            onAutoVerified: (_) {},
            onError: (m) {
              if (mounted) setState(() => _error = m);
            },
          );
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => OtpScreen(verificationId: id, phoneNumber: phone),
        ),
      );
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(
                  horizontal: NphSpacing.page,
                  vertical: NphSpacing.xxl,
                ),
                children: [
                  const SizedBox(height: NphSpacing.lg),
                  Text('Dealer Sign In', style: text.displayMedium),
                  const SizedBox(height: NphSpacing.sm),
                  Text(
                    'Use your Nigerian phone number to manage your store.',
                    style: text.bodyLarge?.copyWith(color: NphColors.mutedForeground),
                  ),

                  const SizedBox(height: NphSpacing.xxxl),

                  const NphFieldLabel('Phone number'),
                  TextField(
                    controller: _phoneCtrl,
                    keyboardType: TextInputType.phone,
                    enabled: !_busy,
                    autofillHints: const [AutofillHints.telephoneNumberNational],
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(11),
                    ],
                    onChanged: (_) => setState(() {}),
                    style: text.bodyLarge,
                    decoration: const InputDecoration(
                      hintText: '903 672 6262',
                      prefixIcon: Padding(
                        padding: EdgeInsets.only(left: NphSpacing.lg, right: NphSpacing.md),
                        child: _CountryPrefix(),
                      ),
                      prefixIconConstraints: BoxConstraints(minWidth: 0, minHeight: 0),
                    ),
                  ),

                  if (_error != null) ...[
                    const SizedBox(height: NphSpacing.lg),
                    NphNotice(message: _error!),
                  ],

                  const SizedBox(height: NphSpacing.xxl),

                  ElevatedButton(
                    onPressed: (_busy || !_canSubmit) ? null : _sendOtp,
                    child: _busy
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('Send OTP'),
                  ),

                  const SizedBox(height: NphSpacing.md),

                  // Registration happens after sign-in — a dealer must have a
                  // verified phone number before a store can be created, since
                  // the store document is keyed by their uid.
                  TextButton(
                    onPressed: _busy ? null : _sendOtp,
                    child: const Text('Register a New Store'),
                  ),

                  // Both conditions, not just useEmulator. That flag now
                  // defaults to false in release, but a stray
                  // --dart-define on a release build would still surface
                  // backend diagnostics to a dealer. kDebugMode cannot be
                  // overridden from the command line.
                  if (kDebugMode && Env.useEmulator) ...[
                    const SizedBox(height: NphSpacing.lg),
                    Text(
                      Env.describe,
                      textAlign: TextAlign.center,
                      style: text.labelSmall,
                    ),
                  ],
                ],
              ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(
                NphSpacing.page,
                0,
                NphSpacing.page,
                NphSpacing.xl,
              ),
              child: NphLegalFooter(),
            ),
          ],
        ),
      ),
    );
  }
}

/// The fixed +234 prefix with its divider, as in the approved design.
class _CountryPrefix extends StatelessWidget {
  const _CountryPrefix();

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.phone_outlined, size: 18, color: NphColors.orange),
        const SizedBox(width: NphSpacing.sm),
        Text(
          '+234',
          style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(width: NphSpacing.md),
        Container(width: 1, height: 22, color: NphColors.border),
      ],
    );
  }
}
