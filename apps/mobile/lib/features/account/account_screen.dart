import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/env.dart';
import '../../core/errors.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../models/store.dart';
import '../../services/auth_service.dart';
import '../../services/listing_service.dart';
import '../listings/listings_screen.dart';
import '../notifications/notifications_screen.dart';
import '../plan/plan_status_screen.dart';
import '../store/store_profile_screen.dart';
import '../sync/sync_status_screen.dart';

/// Account settings.
///
/// "Saved parts" from the design mockup is absent: favourites are not in the
/// SOW and nothing persists them, so the row would lead nowhere.
///
/// Delete account is present and prominent because Apple Guideline 5.1.1(v)
/// and Google Play both require in-app account deletion for any app with
/// registration. It was flagged during review as a hard store-rejection risk
/// and added to Phase 1 scope; the `deleteAccount` callable backs it.
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
              label: 'Store profile',
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => StoreProfileScreen(store: store),
                ),
              ),
            ),
            NphSettingsRow(
              icon: Icons.checklist_rtl,
              label: 'My listings',
              value: '${store.activeListingCount} active',
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => ListingsScreen(store: store)),
              ),
            ),
            NphSettingsRow(
              icon: Icons.workspace_premium_outlined,
              label: 'Plan & usage',
              value: store.subscription.isPaid ? 'Paid' : 'Free',
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => PlanStatusScreen(store: store)),
              ),
            ),
            NphSettingsRow(
              icon: Icons.sync,
              label: 'Sync status',
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const SyncStatusScreen()),
              ),
            ),
            NphSettingsRow(
              icon: Icons.notifications_none,
              label: 'Notifications',
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const NotificationsScreen()),
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
              label: 'Help centre',
              onTap: () => _open('${Env.marketplaceOrigin}/contact'),
            ),
            NphSettingsRow(
              icon: Icons.description_outlined,
              label: 'Terms of service',
              onTap: () => _open('${Env.marketplaceOrigin}/terms'),
            ),
            NphSettingsRow(
              icon: Icons.privacy_tip_outlined,
              label: 'Privacy policy',
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
              label: 'Log out',
              onTap: () => _confirmSignOut(context, ref),
            ),
            NphSettingsRow(
              icon: Icons.delete_outline,
              label: 'Delete account',
              tone: NphColors.error,
              onTap: () => _confirmDelete(context, ref),
            ),
          ],
        ),

        const SizedBox(height: NphSpacing.xxl),
        const Text(
          'Naija Parts Hub by Lytod Motors Ltd · RC 1207675',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontFamily: NphFonts.body,
            fontSize: 12,
            color: NphColors.mutedForeground,
          ),
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
        const SizedBox(height: NphSpacing.xxxl),
      ],
    );
  }

  Widget _identity(BuildContext context) {
    return NphCard(
      child: Row(
        children: [
          NphInitialsAvatar(name: store.businessName, size: 56),
          const SizedBox(width: NphSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        store.businessName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                    const SizedBox(width: 4),
                    if (store.status == StoreStatus.approved)
                      const Icon(Icons.verified, size: 16, color: NphColors.orange),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  store.phone,
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
    if (ok == true) await ref.read(authServiceProvider).signOut();
  }

  /// Required by Apple Guideline 5.1.1(v) and Google Play.
  ///
  /// Typed confirmation rather than a single tap: this deletes every listing,
  /// its images, the store record, the slug reservation and the auth user, and
  /// none of it is recoverable.
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
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'This permanently removes your store, every listing and all photos. '
                'It cannot be undone.\n\nType DELETE to confirm.',
                style: TextStyle(fontFamily: NphFonts.body, fontSize: 14, height: 1.45),
              ),
              const SizedBox(height: NphSpacing.lg),
              TextField(
                controller: controller,
                autofocus: true,
                textCapitalization: TextCapitalization.characters,
                decoration: const InputDecoration(hintText: 'DELETE'),
                onChanged: (_) => setInner(() {}),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              style: TextButton.styleFrom(foregroundColor: NphColors.mutedForeground),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: controller.text.trim() == 'DELETE'
                  ? () => Navigator.of(ctx).pop(true)
                  : null,
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
