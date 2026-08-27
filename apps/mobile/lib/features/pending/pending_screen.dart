import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/env.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../models/store.dart';
import '../../services/auth_service.dart';
import '../../services/identity_service.dart';
import '../registration/mechanic_identity_screen.dart';
import '../store/store_profile_screen.dart';

/// SOW §3: "New businesses will remain pending until approved."
///
/// The approved design replaces the old single-paragraph holding screen with a
/// three-node timeline, because "we are reviewing your details" tells a dealer
/// nothing about where they are in the process or whether anything is required
/// of them.
///
/// This screen is reached from the auth gate, which watches the store document
/// as a live stream — so when an administrator approves the business, the
/// dealer moves to the Home tab without restarting the app.
class PendingScreen extends ConsumerWidget {
  const PendingScreen({super.key, required this.store});

  final Store store;

  Future<void> _contactSupport() async {
    // wa.me rather than a tel: link — support is a WhatsApp line, and the same
    // handoff the marketplace uses for buyer-to-dealer contact.
    // Env.supportWhatsapp, not a literal. This screen hardcoded the
    // placeholder while every other screen read the constant, so setting
    // --dart-define=SUPPORT_WHATSAPP would have fixed support everywhere
    // except here — the one screen a business waiting on approval uses.
    final uri = Uri.parse('https://wa.me/${Env.supportWhatsapp}?text=${Uri.encodeComponent(
      'Hello Naija Parts Hub, I need help with my store registration (${store.businessName}).',
    )}');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rejected = store.status == StoreStatus.rejected;
    final suspended = store.status == StoreStatus.suspended;
    final blocked = rejected || suspended;

    // Dealers never satisfy this — they carry no identity block at all, and
    // the client was explicit that BVN and NIN are not part of their flow.
    // Suspended and rejected stores are excluded too: verifying would not
    // change either outcome, and offering it would imply otherwise.
    final needsIdentity =
        store.status == StoreStatus.pending && needsIdentityVerification(store);

    return Scaffold(
      backgroundColor: NphColors.background,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(
                  NphSpacing.page,
                  NphSpacing.xxxl,
                  NphSpacing.page,
                  NphSpacing.lg,
                ),
                child: Column(
                  children: [
                    NphIconTile(
                      icon: blocked ? Icons.gpp_maybe_outlined : Icons.verified_user_outlined,
                      size: NphIconTileSize.hero,
                      background: blocked ? NphColors.error10 : NphColors.orange10,
                      foreground: blocked ? NphColors.error : NphColors.orange,
                    ),
                    const SizedBox(height: NphSpacing.xxl),
                    Text(
                      switch (store.status) {
                        StoreStatus.rejected => 'Registration Not Approved',
                        StoreStatus.suspended => 'Your Store Is Suspended',
                        _ => 'Your Store Is Under Review',
                      },
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.headlineMedium,
                    ),
                    const SizedBox(height: NphSpacing.md),
                    Text(
                      switch (store.status) {
                        StoreStatus.rejected => store.rejectionReason?.isNotEmpty == true
                            ? store.rejectionReason!
                            : 'Your registration was not approved. Contact support to find out '
                                'what needs to change.',
                        StoreStatus.suspended => store.rejectionReason?.isNotEmpty == true
                            ? store.rejectionReason!
                            : 'Your listings are hidden while your business is suspended. '
                                'Contact support to resolve this.',
                        _ => 'We are reviewing your business details. You will be notified '
                            'when your store is approved.',
                      },
                      textAlign: TextAlign.center,
                      style: Theme.of(context)
                          .textTheme
                          .bodyMedium
                          ?.copyWith(color: NphColors.mutedForeground),
                    ),
                    const SizedBox(height: NphSpacing.xxxl),
                    NphTimeline(steps: _timeline(store.status)),
                    const SizedBox(height: NphSpacing.xxl),
                    // A mechanic who has not verified is not waiting on us —
                    // we are waiting on them, and the timeline above would
                    // otherwise tell them the opposite.
                    if (needsIdentity)
                      const NphBanner(
                        message: 'Your identity has not been verified yet. '
                            'Your workshop cannot be approved until it is.',
                        tone: NphTone.warning,
                        icon: Icons.badge_outlined,
                      )
                    else if (store.status == StoreStatus.pending)
                      const NphBanner(
                        message: 'Reviews usually finish within one business day. '
                            'You can keep this app closed — we will notify you.',
                        tone: NphTone.neutral,
                        icon: Icons.info_outline,
                      ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                NphSpacing.page,
                0,
                NphSpacing.page,
                NphSpacing.xl,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // THE WAY BACK TO VERIFICATION.
                  //
                  // Without this the flow is a trap. Identity verification is
                  // reached by pushReplacement straight after registration, and
                  // nowhere else: the other entry point lives on the mechanic's
                  // own profile, inside MechanicShell, which the gate only
                  // reaches once the store is approved — and approval requires
                  // the very verification being sought. A mechanic who closed
                  // the app on that screen, or whose check could not run,
                  // landed here permanently: pending forever, unable to verify,
                  // impossible to approve.
                  if (needsIdentity) ...[
                    FilledButton(
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => const MechanicIdentityScreen(),
                        ),
                      ),
                      child: const Text('Verify my identity'),
                    ),
                    const SizedBox(height: NphSpacing.md),
                  ],
                  FilledButton(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        // Read-only while pending: the dealer can check what
                        // they submitted, but editing during review would let
                        // the reviewed details change under the reviewer.
                        builder: (_) => StoreProfileScreen(store: store, readOnly: true),
                      ),
                    ),
                    child: const Text('View Submitted Details'),
                  ),
                  const SizedBox(height: NphSpacing.md),
                  OutlinedButton(
                    onPressed: _contactSupport,
                    child: const Text('Contact Support'),
                  ),
                  const SizedBox(height: NphSpacing.xs),
                  TextButton(
                    onPressed: () => ref.read(authServiceProvider).signOut(),
                    style: TextButton.styleFrom(foregroundColor: NphColors.mutedForeground),
                    child: const Text('Sign Out'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// The three nodes from the approved design, resolved against real store
  /// state rather than hardcoded. A rejected or suspended store shows its
  /// review node as done — the review happened; the outcome was simply "no".
  List<NphTimelineStep> _timeline(StoreStatus status) {
    return switch (status) {
      StoreStatus.pending => const [
          NphTimelineStep(label: 'Registration Submitted', state: NphTimelineState.done),
          NphTimelineStep(label: 'Business Review', state: NphTimelineState.active),
          NphTimelineStep(label: 'Store Activation', state: NphTimelineState.todo),
        ],
      StoreStatus.rejected => const [
          NphTimelineStep(label: 'Registration Submitted', state: NphTimelineState.done),
          NphTimelineStep(
            label: 'Business Review',
            state: NphTimelineState.done,
            caption: 'Not approved',
          ),
          NphTimelineStep(
            label: 'Store Activation',
            state: NphTimelineState.todo,
            caption: 'Blocked',
          ),
        ],
      StoreStatus.suspended => const [
          NphTimelineStep(label: 'Registration Submitted', state: NphTimelineState.done),
          NphTimelineStep(label: 'Business Review', state: NphTimelineState.done),
          NphTimelineStep(
            label: 'Store Activation',
            state: NphTimelineState.todo,
            caption: 'Suspended',
          ),
        ],
      StoreStatus.approved => const [
          NphTimelineStep(label: 'Registration Submitted', state: NphTimelineState.done),
          NphTimelineStep(label: 'Business Review', state: NphTimelineState.done),
          NphTimelineStep(label: 'Store Activation', state: NphTimelineState.done),
        ],
    };
  }
}
