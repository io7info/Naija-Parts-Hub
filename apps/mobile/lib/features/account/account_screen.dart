import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/env.dart';
import '../../core/errors.dart';
import '../../core/formatting.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../models/store.dart';
import '../../services/auth_service.dart';
import '../../services/listing_service.dart';
import '../plan/plan_status_screen.dart';
import '../shell/shell_providers.dart';
import '../store/store_profile_screen.dart';
import '../sync/sync_status_screen.dart';

/// Account settings.
///
/// Two rows from the design mockup are deliberately absent:
///
///   Saved parts   — favourites are not in the SOW and nothing persists them.
///   Notifications — SOW "Not Included in Phase 1" excludes push, SMS and
///                   WhatsApp automation, so nothing is ever written. A row
///                   leading to a permanently empty screen teaches a dealer
///                   that menu items here do not work.
///
/// Delete account is prominent because Apple Guideline 5.1.1(v) and Google Play
/// both require in-app account deletion for any app with registration. It was
/// flagged during review as a hard store-rejection risk and added to Phase 1.
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key, required this.store});

  final Store store;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListView(
      padding: const EdgeInsets.all(NphSpacing.appPage),
      children: [
        _identity(context),
        const SizedBox(height: NphSpacing.xxl),

        NphSettingsGroup(
          title: 'My store',
          children: [
            NphSettingsRow(
              icon: Icons.storefront_outlined,
              label: 'Store Profile',
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => StoreProfileScreen(store: store)),
              ),
            ),
            NphSettingsRow(
              icon: Icons.inventory_2_outlined,
              label: 'My Listings',
              value: '${store.activeListingCount} active',
              onTap: () => goToShellTab(ref, ShellTab.listings),
            ),
            NphSettingsRow(
              icon: Icons.workspace_premium_outlined,
              label: 'Plan & Usage',
              value: store.subscription.isPaid ? 'Paid' : 'Free',
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => PlanStatusScreen(store: store)),
              ),
            ),
            NphSettingsRow(
              icon: Icons.sync,
              label: 'Sync Status',
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const SyncStatusScreen()),
              ),
            ),
          ],
        ),
        const SizedBox(height: NphSpacing.xl),

        NphSettingsGroup(
          title: 'Support & legal',
          children: [
            NphSettingsRow(
              icon: Icons.help_outline,
              label: 'Help Centre',
              onTap: _contactSupport,
            ),
            NphSettingsRow(
              icon: Icons.chat_outlined,
              label: 'Contact Support',
              onTap: _contactSupport,
            ),
            NphSettingsRow(
              icon: Icons.description_outlined,
              label: 'Terms of Service',
              onTap: () => _open('${Env.marketplaceOrigin}/terms'),
            ),
            NphSettingsRow(
              icon: Icons.privacy_tip_outlined,
              label: 'Privacy Policy',
              onTap: () => _open('${Env.marketplaceOrigin}/privacy'),
            ),
          ],
        ),
        const SizedBox(height: NphSpacing.xl),

        NphSettingsGroup(
          title: 'Account',
          children: [
            NphSettingsRow(
              icon: Icons.logout,
              label: 'Log Out',
              onTap: () => _confirmSignOut(context, ref),
            ),
            NphSettingsRow(
              icon: Icons.delete_outline,
              label: 'Delete Account',
              tone: NphColors.error,
              onTap: () => _confirmDelete(context, ref),
            ),
          ],
        ),

        const SizedBox(height: NphSpacing.xxl),
        const _Footer(),
        const SizedBox(height: NphSpacing.xxxl),
      ],
    );
  }

  Widget _identity(BuildContext context) {
    return NphCard(
      child: Row(
        children: [
          NphInitialsAvatar(name: store.ownerName.isEmpty ? store.businessName : store.ownerName),
          const SizedBox(width: NphSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  store.ownerName.isEmpty ? 'Dealer' : store.ownerName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 2),
                Text(
                  store.businessName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: NphFonts.body,
                    fontSize: 13,
                    color: NphColors.mutedForeground,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  formatNigerianPhone(store.phone),
                  style: const TextStyle(
                    fontFamily: NphFonts.body,
                    fontSize: 12,
                    color: NphColors.mutedForeground,
                  ),
                ),
                const SizedBox(height: 6),
                if (store.status == StoreStatus.approved)
                  const NphStatusBadge(
                    label: 'Verified dealer',
                    tone: NphTone.success,
                    icon: Icons.verified_outlined,
                  )
                else
                  NphStatusBadge.forStoreStatus(store.status.name),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _open(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _contactSupport() async {
    final text = Uri.encodeComponent(
      'Hello Naija Parts Hub, I need help with my dealer account '
      '(${store.businessName.isEmpty ? store.storeId : store.businessName}).',
    );
    final uri = Uri.parse('https://wa.me/${Env.supportWhatsapp}?text=$text');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _confirmSignOut(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: NphColors.card,
        shape: const RoundedRectangleBorder(borderRadius: NphRadius.cardBorder),
        title: const Text('Log out?'),
        content: const Text(
          'Your listings stay on this phone and sync when you sign back in.',
          style: TextStyle(fontFamily: NphFonts.body, fontSize: 14, height: 1.45),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            style: TextButton.styleFrom(foregroundColor: NphColors.mutedForeground),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Log out'),
          ),
        ],
      ),
    );
    if (ok != true) return;

    // Reset shell state before the auth stream tears the shell down, so a
    // different dealer signing in on this device does not inherit the last
    // one's tab and filters.
    goToShellTab(ref, ShellTab.home);
    await ref.read(authServiceProvider).signOut();
  }

  /// Two-step, typed confirmation. Required by Apple 5.1.1(v) and Google Play.
  ///
  /// The dialog states exactly what is destroyed before asking, because a
  /// dealer cannot get any of it back: every listing, every photo, the store
  /// record and the store URL — which means any link a buyer has saved.
  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final controller = TextEditingController();
    final messenger = ScaffoldMessenger.of(context);

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setInner) => AlertDialog(
          backgroundColor: NphColors.card,
          shape: const RoundedRectangleBorder(borderRadius: NphRadius.cardBorder),
          title: const Text('Delete your account?'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'This permanently deletes:\n\n'
                  '  • your store "${store.businessName}"\n'
                  '  • all ${store.activeListingCount} active listings and every draft\n'
                  '  • all product photos\n'
                  '  • your store link naijapartshub.ng/store/${store.slug}\n\n'
                  'It cannot be undone, and the store link cannot be reissued.',
                  style: const TextStyle(
                    fontFamily: NphFonts.body,
                    fontSize: 14,
                    height: 1.5,
                  ),
                ),
                const SizedBox(height: NphSpacing.lg),
                const Text(
                  'Type DELETE to confirm.',
                  style: TextStyle(
                    fontFamily: NphFonts.body,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: NphSpacing.sm),
                TextField(
                  controller: controller,
                  autofocus: true,
                  textCapitalization: TextCapitalization.characters,
                  decoration: const InputDecoration(hintText: 'DELETE'),
                  onChanged: (_) => setInner(() {}),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              style: TextButton.styleFrom(foregroundColor: NphColors.mutedForeground),
              child: const Text('Cancel'),
            ),
            TextButton(
              // Stays disabled until the word matches — the guard is the typing,
              // not the tapping.
              onPressed:
                  controller.text.trim() == 'DELETE' ? () => Navigator.of(ctx).pop(true) : null,
              style: TextButton.styleFrom(foregroundColor: NphColors.error),
              child: const Text('Delete account'),
            ),
          ],
        ),
      ),
    );

    controller.dispose();
    if (ok != true) return;

    try {
      await ref.read(listingServiceProvider).deleteAccount();
      // Deleting the auth user invalidates the token, so the auth stream emits
      // null and the gate returns to sign-in on its own.
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
  }
}

class _Footer extends StatelessWidget {
  const _Footer();

  @override
  Widget build(BuildContext context) {
    const muted = TextStyle(
      fontFamily: NphFonts.body,
      fontSize: 12,
      height: 1.5,
      color: NphColors.mutedForeground,
    );

    return Column(
      children: [
        const Text('Naija Parts Hub', textAlign: TextAlign.center, style: muted),
        const Text(
          'Operated by Lytod Motors Ltd · RC 1207675',
          textAlign: TextAlign.center,
          style: muted,
        ),
        const SizedBox(height: 4),
        const Text(
          'v1.0.0',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontFamily: NphFonts.body,
            fontSize: 11,
            color: NphColors.mutedForeground,
          ),
        ),
        // Which backend this build talks to is useful in development and is
        // information a release build has no business publishing.
        if (kDebugMode) ...[
          const SizedBox(height: NphSpacing.sm),
          Text(
            Env.describe,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontFamily: NphFonts.body,
              fontSize: 10,
              color: NphColors.warning,
            ),
          ),
        ],
      ],
    );
  }
}
