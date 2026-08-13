import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/env.dart';
import '../../core/formatting.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../models/store.dart';
import '../plan/plan_status_screen.dart';
import 'store_profile_screen.dart';

/// My Store — the dealer's store record and its public presence.
///
/// This tab used to be a second copy of the dashboard. The dashboard now lives
/// on Home, so My Store answers a different question: *what do buyers see, and
/// what is my store's standing?*
///
/// Every backend-controlled value here is displayed but not editable. Approval,
/// verification, visibility, subscription and suspension are set by admins and
/// Cloud Functions (ADR-001 #4); `firestore.rules` refuses a dealer write to any
/// of them. Rendering them as read-only rows rather than hiding them is
/// deliberate — a dealer needs to know their store is invisible, and why, far
/// more than they need a control they are not allowed to use.
class MyStoreScreen extends ConsumerWidget {
  const MyStoreScreen({super.key, required this.store});

  final Store store;

  static final _date = DateFormat('d MMM yyyy');

  String get _publicUrl => '${Env.marketplaceOrigin}/store/${store.slug}';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListView(
      padding: const EdgeInsets.all(NphSpacing.appPage),
      children: [
        _identity(context),
        const SizedBox(height: NphSpacing.lg),
        _visibilityBanner(),
        const SizedBox(height: NphSpacing.xl),
        _actions(context),
        const SizedBox(height: NphSpacing.xl),

        const NphSectionHeader(title: 'Public store'),
        const SizedBox(height: NphSpacing.md),
        _storeLink(context),
        const SizedBox(height: NphSpacing.md),
        NphSettingsGroup(
          title: 'Buyers find you here',
          children: [
            NphSettingsRow(
              icon: Icons.visibility_outlined,
              label: 'Visible to buyers',
              value: store.visible ? 'Yes' : 'No',
            ),
            NphSettingsRow(
              icon: Icons.inventory_2_outlined,
              label: 'Active listings',
              value: '${store.activeListingCount}',
            ),
          ],
        ),
        const SizedBox(height: NphSpacing.xl),

        const NphSectionHeader(title: 'Business details'),
        const SizedBox(height: NphSpacing.md),
        NphSettingsGroup(
          title: 'Submitted at registration',
          children: [
            NphSettingsRow(
              icon: Icons.badge_outlined,
              label: 'Owner / contact',
              value: store.ownerName.isEmpty ? '—' : store.ownerName,
            ),
            NphSettingsRow(
              icon: Icons.assignment_outlined,
              label: 'CAC registration',
              value: store.cacNumber.isEmpty ? '—' : store.cacNumber,
            ),
            if (store.automotiveCategory.isNotEmpty)
              NphSettingsRow(
                icon: Icons.category_outlined,
                label: 'Trades in',
                value: store.automotiveCategory,
              ),
          ],
        ),
        const SizedBox(height: NphSpacing.xl),

        const NphSectionHeader(title: 'Contact'),
        const SizedBox(height: NphSpacing.md),
        NphSettingsGroup(
          title: 'Shown to buyers',
          children: [
            NphSettingsRow(
              icon: Icons.phone_outlined,
              label: 'Phone',
              value: formatNigerianPhone(store.phone),
            ),
            NphSettingsRow(
              icon: Icons.chat_outlined,
              label: 'WhatsApp',
              value: store.whatsapp.isEmpty ? 'Not set' : formatNigerianPhone(store.whatsapp),
            ),
            if (store.email.isNotEmpty)
              NphSettingsRow(
                icon: Icons.mail_outline,
                label: 'Email',
                value: store.email,
              ),
            NphSettingsRow(
              icon: Icons.location_on_outlined,
              label: 'Address',
              value: [store.address, store.city, store.state]
                  .where((s) => s.isNotEmpty)
                  .join(', '),
            ),
            if (store.landmark.isNotEmpty)
              NphSettingsRow(
                icon: Icons.place_outlined,
                label: 'Landmark',
                value: store.landmark,
              ),
          ],
        ),
        const SizedBox(height: NphSpacing.xl),

        const NphSectionHeader(title: 'Standing'),
        const SizedBox(height: NphSpacing.md),
        // Read-only by design. See the class comment.
        NphSettingsGroup(
          title: 'Managed by Naija Parts Hub',
          children: [
            NphSettingsRow(
              icon: Icons.verified_outlined,
              label: 'Verification',
              value: switch (store.status) {
                StoreStatus.approved => 'Verified',
                StoreStatus.pending => 'Under review',
                StoreStatus.rejected => 'Not approved',
                StoreStatus.suspended => 'Suspended',
              },
            ),
            NphSettingsRow(
              icon: Icons.workspace_premium_outlined,
              label: 'Plan',
              value: store.subscription.isPaid()
                  ? '${store.subscription.plan[0].toUpperCase()}'
                      '${store.subscription.plan.substring(1)}'
                  : 'Free',
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => PlanStatusScreen(store: store)),
              ),
            ),
            if (store.subscription.expiresAt != null)
              NphSettingsRow(
                icon: Icons.event_outlined,
                label: store.subscription.status == 'grace' ? 'Lapsed on' : 'Renews on',
                value: _date.format(store.subscription.expiresAt!),
              ),
          ],
        ),

        if (store.description.isNotEmpty) ...[
          const SizedBox(height: NphSpacing.xl),
          const NphSectionHeader(title: 'About'),
          const SizedBox(height: NphSpacing.md),
          NphCard(
            child: Text(
              store.description,
              style: const TextStyle(
                fontFamily: NphFonts.body,
                fontSize: 14,
                height: 1.55,
                color: NphColors.mutedForeground,
              ),
            ),
          ),
        ],

        const SizedBox(height: NphSpacing.xxxl),
      ],
    );
  }

  // --- Header --------------------------------------------------------------

  Widget _identity(BuildContext context) {
    return NphCard(
      child: Row(
        children: [
          NphInitialsAvatar(name: store.businessName, size: 60),
          const SizedBox(width: NphSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  store.businessName.isEmpty ? 'Your store' : store.businessName,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 4),
                Text(
                  [store.city, store.state].where((s) => s.isNotEmpty).join(', '),
                  style: const TextStyle(
                    fontFamily: NphFonts.body,
                    fontSize: 13,
                    color: NphColors.mutedForeground,
                  ),
                ),
                const SizedBox(height: 6),
                if (store.status == StoreStatus.approved)
                  const NphVerifiedBadge()
                else
                  NphStatusBadge.forStoreStatus(store.status.name),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Explains an invisible storefront rather than leaving a dealer to discover
  /// it by opening their own link.
  Widget _visibilityBanner() {
    if (store.status == StoreStatus.approved && store.visible) {
      return const NphBanner(
        message: 'Your store is live. Buyers can find it and contact you.',
        tone: NphTone.success,
        icon: Icons.public,
      );
    }
    return NphBanner(
      message: switch (store.status) {
        StoreStatus.pending =>
          'Your store is not public yet. It goes live once an administrator '
              'approves your business.',
        StoreStatus.rejected => store.rejectionReason?.isNotEmpty == true
            ? store.rejectionReason!
            : 'Your registration was not approved, so your store is not public.',
        StoreStatus.suspended => store.rejectionReason?.isNotEmpty == true
            ? store.rejectionReason!
            : 'Your store is suspended and hidden from buyers. Contact support.',
        StoreStatus.approved =>
          'Your store is approved but currently hidden by an administrator.',
      },
      tone: store.status == StoreStatus.pending ? NphTone.warning : NphTone.error,
      icon: Icons.visibility_off_outlined,
    );
  }

  // --- Actions -------------------------------------------------------------

  Widget _actions(BuildContext context) {
    final hasSlug = store.slug.isNotEmpty;
    final live = store.status == StoreStatus.approved && store.visible;

    return Column(
      children: [
        FilledButton(
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute<void>(builder: (_) => StoreProfileScreen(store: store)),
          ),
          child: const Text('Edit Store Profile'),
        ),
        const SizedBox(height: NphSpacing.sm),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                // Disabled rather than hidden when the store is not live: the
                // link exists, it just 404s until approval, and a dealer who
                // taps it and sees "not found" concludes the app is broken.
                onPressed: hasSlug && live ? _openPublicStore : null,
                child: const Text('View Store'),
              ),
            ),
            const SizedBox(width: NphSpacing.sm),
            Expanded(
              child: OutlinedButton(
                onPressed: hasSlug ? () => _copyLink(context) : null,
                child: const Text('Copy Link'),
              ),
            ),
          ],
        ),
        const SizedBox(height: NphSpacing.sm),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: hasSlug ? _shareLink : null,
                child: const Text('Share Link'),
              ),
            ),
            const SizedBox(width: NphSpacing.sm),
            Expanded(
              child: OutlinedButton(
                onPressed: _contactSupport,
                child: const Text('Support'),
              ),
            ),
          ],
        ),
      ],
    );
  }

  /// The dealer's public address, shown in full.
  ///
  /// This deliberately does not live in the settings group below. A settings
  /// row puts its value on the right of its label and ellipsises what does not
  /// fit, so on a 320dp handset a real slug renders as
  /// "naijapartshub.com/store/ladipo-auto-s…" — unreadable, uncopyable by eye,
  /// and useless to a dealer writing it on a card or reading it down the phone.
  /// Given its own full-width block the whole URL wraps and stays legible,
  /// scheme included, which is what a buyer has to type.
  Widget _storeLink(BuildContext context) {
    final hasSlug = store.slug.isNotEmpty;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(NphSpacing.md),
      decoration: BoxDecoration(
        color: NphColors.card,
        borderRadius: NphRadius.cardBorder,
        border: Border.all(color: NphColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.link, size: 16, color: NphColors.mutedForeground),
              const SizedBox(width: NphSpacing.xs),
              const Text(
                'Your store link',
                style: TextStyle(
                  fontFamily: NphFonts.body,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: NphColors.mutedForeground,
                ),
              ),
              const Spacer(),
              if (hasSlug)
                // A tap target on the link block itself, so copying does not
                // depend on finding the button pair further up the screen.
                InkWell(
                  onTap: () => _copyLink(context),
                  borderRadius: NphRadius.buttonBorder,
                  child: const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    child: Icon(Icons.copy_rounded, size: 16, color: NphColors.orange),
                  ),
                ),
            ],
          ),
          const SizedBox(height: NphSpacing.xs),
          SelectableText(
            hasSlug ? _publicUrl : 'Not assigned until your store is approved',
            style: TextStyle(
              fontFamily: NphFonts.body,
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: hasSlug ? NphColors.foreground : NphColors.mutedForeground,
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _openPublicStore() async {
    final uri = Uri.parse(_publicUrl);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _copyLink(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    await Clipboard.setData(ClipboardData(text: _publicUrl));
    messenger.showSnackBar(const SnackBar(content: Text('Store link copied.')));
  }

  /// Shares through WhatsApp rather than the OS share sheet.
  ///
  /// share_plus is not a dependency, and WhatsApp is how this market actually
  /// forwards a link — the same handoff buyers use to reach dealers.
  Future<void> _shareLink() async {
    final text = Uri.encodeComponent(
      'Find genuine parts at ${store.businessName} on Naija Parts Hub: $_publicUrl',
    );
    final uri = Uri.parse('https://wa.me/?text=$text');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _contactSupport() async {
    final text = Uri.encodeComponent(
      'Hello Naija Parts Hub, I need help with my store '
      '(${store.businessName.isEmpty ? store.storeId : store.businessName}).',
    );
    final uri = Uri.parse('https://wa.me/${Env.supportWhatsapp}?text=$text');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }
}
