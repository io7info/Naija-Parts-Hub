import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../services/identity_service.dart';

/// BVN and NIN verification for a mechanic.
///
/// WHAT HAPPENS TO THE NUMBERS
///
/// They live in two TextEditingControllers, go into one HTTPS callable, and
/// are disposed with this screen. They are never written to Firestore by the
/// app, never put in a provider, never logged, never attached to analytics or
/// a crash report, and never held in any state that outlives the submission.
/// The backend keeps only the last four digits and a keyed fingerprint.
///
/// The copy says so plainly, because a Nigerian asked for their BVN by an app
/// they have just met is right to hesitate — BVN-harvesting fraud is common
/// enough that silence here reads as evasion.
class MechanicIdentityScreen extends ConsumerStatefulWidget {
  const MechanicIdentityScreen({super.key, this.afterRegistration = false});

  /// True when this follows straight on from the registration wizard, which
  /// changes the wording: the application is already submitted, and this is
  /// the last thing outstanding rather than a task from nowhere.
  final bool afterRegistration;

  @override
  ConsumerState<MechanicIdentityScreen> createState() => _MechanicIdentityScreenState();
}

class _MechanicIdentityScreenState extends ConsumerState<MechanicIdentityScreen> {
  final _form = GlobalKey<FormState>();
  final _bvn = TextEditingController();
  final _nin = TextEditingController();
  final _fullName = TextEditingController();

  bool _busy = false;
  IdentityResult? _result;

  @override
  void dispose() {
    // The identifiers cease to exist with these controllers.
    _bvn.dispose();
    _nin.dispose();
    _fullName.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    if (!(_form.currentState?.validate() ?? false)) return;

    setState(() {
      _busy = true;
      _result = null;
    });
    try {
      final result = await ref.read(identityServiceProvider).verify(
            bvn: _bvn.text.trim(),
            nin: _nin.text.trim(),
            fullName: _fullName.text.trim(),
          );
      if (!mounted) return;
      setState(() => _result = result);

      if (result.outcome == IdentityOutcome.verified ||
          result.outcome == IdentityOutcome.manualReview) {
        // Both are terminal for this screen: verified is done, and manual
        // review is an administrator's decision the mechanic cannot influence
        // by trying again. Clear the fields immediately either way.
        _bvn.clear();
        _nin.clear();
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    final done = result?.outcome == IdentityOutcome.verified ||
        result?.outcome == IdentityOutcome.manualReview;

    return Scaffold(
      backgroundColor: NphColors.background,
      appBar: AppBar(
        title: const Text('Verify your identity'),
        automaticallyImplyLeading: !widget.afterRegistration,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
          child: Form(
            key: _form,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (widget.afterRegistration)
                  const _Notice(
                    icon: Icons.check_circle_outline,
                    tone: NphColors.success,
                    title: 'Your workshop details are saved',
                    body: 'One step left. We verify every mechanic before their profile goes '
                        'live, so buyers know who they are calling.',
                  ),
                const SizedBox(height: 16),

                const Text(
                  'Why we ask for this',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Customers hand their vehicles to you. Verifying your identity is what lets '
                  'us show them a Verified badge on your profile.',
                  style: TextStyle(color: NphColors.mutedForeground, height: 1.4),
                ),
                const SizedBox(height: 16),

                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: NphColors.warm,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(Icons.lock_outline, size: 18, color: NphColors.foreground),
                      SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          'We do not store your BVN or NIN. They are checked once, and we keep '
                          'only the last four digits so you can recognise which numbers you '
                          'used. Nobody at Naija Parts Hub can see the full numbers.',
                          style: TextStyle(fontSize: 12.5, height: 1.45),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),

                NphField(
                  label: 'Full name as it appears on your NIN',
                  child: TextFormField(
                    controller: _fullName,
                    enabled: !done,
                    textCapitalization: TextCapitalization.words,
                    validator: (v) =>
                        (v ?? '').trim().length < 3 ? 'Enter your full legal name' : null,
                  ),
                ),
                NphField(
                  label: 'BVN',
                  child: TextFormField(
                    controller: _bvn,
                    enabled: !done,
                    keyboardType: TextInputType.number,
                    maxLength: 11,
                    // Digits only: a pasted number often carries spaces, and
                    // an 11-digit rule that rejects them is a dead end the
                    // user cannot see.
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    validator: _elevenDigits,
                  ),
                ),
                NphField(
                  label: 'NIN',
                  child: TextFormField(
                    controller: _nin,
                    enabled: !done,
                    keyboardType: TextInputType.number,
                    maxLength: 11,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    validator: _elevenDigits,
                  ),
                ),

                if (result != null) _resultBanner(result),

                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: _busy || done ? null : _verify,
                    child: _busy
                        ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('Verify my identity'),
                  ),
                ),

                if (done)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: SizedBox(
                      width: double.infinity,
                      child: OutlinedButton(
                        // Pops back to the gate, which re-reads the store and
                        // routes on its new state.
                        onPressed: () => Navigator.of(context).popUntil((r) => r.isFirst),
                        child: const Text('Done'),
                      ),
                    ),
                  ),

                if (result?.attemptsRemaining != null && !done)
                  Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: Text(
                      '${result!.attemptsRemaining} attempt(s) remaining before a temporary lock.',
                      style: const TextStyle(fontSize: 12, color: NphColors.mutedForeground),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String? _elevenDigits(String? v) {
    final digits = (v ?? '').trim();
    if (digits.length != 11) return 'Must be exactly 11 digits';
    return null;
  }

  Widget _resultBanner(IdentityResult r) {
    final (IconData icon, Color tone, String title) = switch (r.outcome) {
      IdentityOutcome.verified => (
          Icons.verified_outlined,
          NphColors.success,
          'Identity verified',
        ),
      IdentityOutcome.manualReview => (
          Icons.hourglass_empty,
          NphColors.warning,
          'Sent for review',
        ),
      // The distinction that matters most: the platform is unfinished, and
      // saying "verification failed" here would blame the mechanic for our
      // configuration.
      IdentityOutcome.unavailable => (
          Icons.info_outline,
          NphColors.mutedForeground,
          'Verification temporarily unavailable',
        ),
      IdentityOutcome.rateLimited => (
          Icons.timer_outlined,
          NphColors.warning,
          'Too many attempts',
        ),
      IdentityOutcome.alreadyUsed => (
          Icons.person_off_outlined,
          NphColors.error,
          'Already registered',
        ),
      IdentityOutcome.failed => (
          Icons.error_outline,
          NphColors.error,
          'We could not verify those details',
        ),
    };

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: _Notice(
        icon: icon,
        tone: tone,
        title: title,
        body: r.outcome == IdentityOutcome.verified
            ? 'Your application is with our team now. You will be notified when it is approved.'
            // Two things this must not claim.
            //
            // Nothing retries it. There is no queue, no scheduled sweep and no
            // background job that will pick the check up later — only this
            // button — so the copy cannot imply the platform will finish it on
            // the mechanic's behalf. Someone who believes that waits
            // indefinitely for an approval that cannot arrive.
            //
            // And it cannot claim the numbers were never sent. The app sees
            // only an error code, and one of the three backends that produce
            // it is a malformed response to a request the provider already
            // received. Promising non-submission here would be a privacy
            // assurance we cannot stand behind. What IS true in every case is
            // that we never store them, so that is what it says.
            : r.outcome == IdentityOutcome.unavailable
                ? 'Your registration has been saved, but we couldn\'t complete identity '
                    'verification right now. Naija Parts Hub does not store your full BVN '
                    'or NIN. Please come back and try this step again later.'
                : (r.message ?? 'Please try again.'),
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({
    required this.icon,
    required this.tone,
    required this.title,
    required this.body,
  });

  final IconData icon;
  final Color tone;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: tone.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: tone),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: TextStyle(fontWeight: FontWeight.bold, color: tone)),
                const SizedBox(height: 3),
                Text(
                  body,
                  style: const TextStyle(fontSize: 12.5, height: 1.4, color: NphColors.foreground),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
