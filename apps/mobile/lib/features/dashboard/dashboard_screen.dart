import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/env.dart';
import '../../core/errors.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../models/listing.dart';
import '../../models/store.dart';
import '../../services/listing_service.dart';
import '../../services/sync_status_service.dart';
import '../../widgets/listing_card.dart';
import '../listings/listing_form_screen.dart';
import '../listings/listings_screen.dart';
import '../plan/plan_status_screen.dart';
import '../store/store_profile_screen.dart';
import '../sync/sync_status_screen.dart';

/// The dealer dashboard — the "My Store" tab.
///
/// Every figure is derived from live Firestore state rather than stored: the
/// active and draft counts come from the dealer's own listings stream, and the
/// quota comes from `activeListingCount` on the store document, which the
/// publishListing transaction maintains.
///
/// Two tiles from the approved design are deliberately absent: "Product Views"
/// and "WhatsApp Contacts". Nothing in the data model records either, and SOW
/// §9 excludes analytics from Phase 1 — so the only way to render them would be
/// to invent numbers, which is the one kind of placeholder that must not ship
/// next to a verified badge. Their slots are filled by counts that are real.
class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key, required this.store, this.onNavigate});

  final Store store;

  /// Lets Quick Actions move the shell to another tab rather than pushing a
  /// duplicate screen on top of the nav bar.
  final ValueChanged<int>? onNavigate;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final listings = ref.watch(myListingsProvider);
    final all = listings.valueOrNull ?? const <Listing>[];
    final active = all.where((l) => l.status == ListingStatus.active).length;
    final drafts = all.where((l) => l.status == ListingStatus.draft).length;
    final archived = all.where((l) => l.status == ListingStatus.archived).length;

    return ListView(
      padding: const EdgeInsets.only(bottom: NphSpacing.xxxl),
      children: [
        _greeting(context),
        Padding(
          padding: const EdgeInsets.fromLTRB(
            NphSpacing.appPage,
            NphSpacing.lg,
            NphSpacing.appPage,
            0,
          ),
          child: _planCard(context),
        ),
        const SizedBox(height: NphSpacing.xl),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: NphSpacing.appPage),
          child: _syncBanner(context, ref),
        ),
        const SizedBox(height: NphSpacing.xl),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: NphSpacing.appPage),
          child: _stats(active: active, drafts: drafts, archived: archived, total: all.length),
        ),
        const SizedBox(height: NphSpacing.xxl),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: NphSpacing.appPage),
          child: _quickActions(context),
        ),
        const SizedBox(height: NphSpacing.xxl),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: NphSpacing.appPage),
          child: _recent(context, ref, all),
        ),
      ],
    );
  }

  // --- Greeting ------------------------------------------------------------

  Widget _greeting(BuildContext context) {
    final hour = DateTime.now().hour;
    final part = hour < 12 ? 'Good morning' : (hour < 17 ? 'Good afternoon' : 'Good evening');
    // First name only — "Good morning, Tinuoye Adeyemi" reads like a summons.
    final firstName = store.ownerName.trim().split(RegExp(r'\s+')).first;

    return Container(
      width: double.infinity,
      color: NphColors.card,
      padding: const EdgeInsets.fromLTRB(
        NphSpacing.appPage,
        NphSpacing.md,
        NphSpacing.appPage,
        0,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '$part,',
            style: const TextStyle(
              fontFamily: NphFonts.body,
              fontSize: 14,
              color: NphColors.mutedForeground,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            firstName.isEmpty ? 'there' : firstName,
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Flexible(
                child: Text(
                  store.businessName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: NphFonts.body,
                    fontSize: 14,
                    color: NphColors.mutedForeground,
                  ),
                ),
              ),
              const SizedBox(width: NphSpacing.sm),
              const NphVerifiedBadge(compact: true),
            ],
          ),
        ],
      ),
    );
  }

  // --- Plan card -----------------------------------------------------------

  Widget _planCard(BuildContext context) {
    final limit = store.activeListingLimit;
    final used = store.activeListingCount;

    return Container(
      padding: const EdgeInsets.all(NphSpacing.lg),
      decoration: const BoxDecoration(
        color: NphColors.softBlack,
        borderRadius: NphRadius.cardBorder,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.10),
                  borderRadius: NphRadius.pillBorder,
                ),
                child: Text(
                  store.subscription.isPaid
                      ? '${store.subscription.plan[0].toUpperCase()}'
                          '${store.subscription.plan.substring(1)} Plan'
                      : 'Free Plan',
                  style: const TextStyle(
                    fontFamily: NphFonts.body,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: Colors.white,
                  ),
                ),
              ),
              Text(
                '$used of $limit listings used',
                style: TextStyle(
                  fontFamily: NphFonts.body,
                  fontSize: 12,
                  color: Colors.white.withValues(alpha: 0.60),
                ),
              ),
            ],
          ),
          const SizedBox(height: NphSpacing.md),
          NphProgressBar(value: limit == 0 ? 0 : used / limit, onDark: true),
          const SizedBox(height: NphSpacing.md),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              // "on Website", not "Upgrade". Selling a subscription inside the
              // app engages App Store Guideline 3.1.1, which requires Apple's
              // in-app purchase for digital goods. ADR-001 open item #3 keeps
              // the paid upgrade on the web for exactly this reason.
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => PlanStatusScreen(store: store)),
              ),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(NphSize.buttonHeightSmall),
              ),
              child: const Text('Manage Plan on Website'),
            ),
          ),
        ],
      ),
    );
  }

  // --- Sync banner ---------------------------------------------------------

  Widget _syncBanner(BuildContext context, WidgetRef ref) {
    final sync = ref.watch(syncStatusProvider).valueOrNull;
    final state = sync?.state ?? SyncState.synced;

    final (tone, icon) = switch (state) {
      SyncState.synced => (NphTone.success, Icons.sync),
      SyncState.pending => (NphTone.warning, Icons.cloud_upload_outlined),
      SyncState.offline => (NphTone.neutral, Icons.cloud_off_outlined),
    };

    return NphBanner(
      message: sync?.label ?? 'Everything is synced',
      tone: tone,
      icon: icon,
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => const SyncStatusScreen()),
      ),
    );
  }

  // --- Stats ---------------------------------------------------------------

  Widget _stats({
    required int active,
    required int drafts,
    required int archived,
    required int total,
  }) {
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: NphSpacing.md,
      crossAxisSpacing: NphSpacing.md,
      childAspectRatio: 1.55,
      children: [
        _StatCard(icon: Icons.checklist_rtl, value: '$active', label: 'Active Listings'),
        _StatCard(icon: Icons.edit_note, value: '$drafts', label: 'Draft Listings'),
        _StatCard(icon: Icons.inventory_2_outlined, value: '$archived', label: 'Archived'),
        _StatCard(icon: Icons.widgets_outlined, value: '$total', label: 'Total Products'),
      ],
    );
  }

  // --- Quick actions -------------------------------------------------------

  Widget _quickActions(BuildContext context) {
    final actions = <(IconData, String, VoidCallback)>[
      (
        Icons.add_circle_outline,
        'Add New Listing',
        () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => ListingFormScreen(storeId: store.storeId),
              ),
            ),
      ),
      (
        Icons.checklist_rtl,
        'Manage Listings',
        () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => ListingsScreen(store: store)),
            ),
      ),
      (Icons.storefront_outlined, 'View Public Store', () => _openPublicStore(context)),
      (
        Icons.manage_accounts_outlined,
        'Edit Store Profile',
        () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => StoreProfileScreen(store: store)),
            ),
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const NphSectionHeader(title: 'Quick Actions'),
        const SizedBox(height: NphSpacing.md),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: NphSpacing.md,
          crossAxisSpacing: NphSpacing.md,
          childAspectRatio: 2.45,
          children: [
            for (final (icon, label, onTap) in actions)
              NphCard(
                onTap: onTap,
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: NphSpacing.md,
                ),
                child: Row(
                  children: [
                    Icon(icon, size: 20, color: NphColors.orange),
                    const SizedBox(width: NphSpacing.sm),
                    Expanded(
                      child: Text(
                        label,
                        style: const TextStyle(
                          fontFamily: NphFonts.body,
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          height: 1.25,
                          color: NphColors.foreground,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ],
    );
  }

  Future<void> _openPublicStore(BuildContext context) async {
    if (store.slug.isEmpty) return;
    final uri = Uri.parse('${Env.marketplaceOrigin}/store/${store.slug}');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  // --- Recent listings -----------------------------------------------------

  Widget _recent(BuildContext context, WidgetRef ref, List<Listing> all) {
    // Newest first by the only ordering the client can trust locally: the
    // dealer's own listings arrive unordered from the stream.
    final recent = [...all]
      ..sort((a, b) => b.listingId.compareTo(a.listingId));
    final top = recent.take(3).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        NphSectionHeader(
          title: 'Recent Listings',
          actionLabel: 'Manage',
          showChevron: true,
          onAction: () => Navigator.of(context).push(
            MaterialPageRoute<void>(builder: (_) => ListingsScreen(store: store)),
          ),
        ),
        const SizedBox(height: NphSpacing.md),
        if (top.isEmpty)
          NphEmptyState(
            icon: Icons.inventory_2_outlined,
            title: 'No listings yet',
            message: 'Add your first part and it appears on the marketplace once published.',
            action: FilledButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => ListingFormScreen(storeId: store.storeId),
                ),
              ),
              style: FilledButton.styleFrom(
                minimumSize: const Size(180, NphSize.buttonHeightSmall),
              ),
              child: const Text('Add Listing'),
            ),
          )
        else
          for (final listing in top)
            Padding(
              padding: const EdgeInsets.only(bottom: NphSpacing.md),
              child: NphListingListCard(
                listing: listing,
                storeName: store.businessName,
                locationLabel: [store.city, store.state]
                    .where((s) => s.isNotEmpty)
                    .join(', '),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => ListingFormScreen(
                      storeId: store.storeId,
                      existing: listing,
                    ),
                  ),
                ),
                onContact: () => _shareListing(context, ref, listing),
              ),
            ),
      ],
    );
  }

  Future<void> _shareListing(BuildContext context, WidgetRef ref, Listing listing) async {
    final messenger = ScaffoldMessenger.of(context);
    final url = '${Env.marketplaceOrigin}/parts/${listing.listingId}';
    final uri = Uri.parse('https://wa.me/?text=${Uri.encodeComponent('${listing.name} — $url')}');
    try {
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      }
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({required this.icon, required this.value, required this.label});

  final IconData icon;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return NphCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          NphIconTile(icon: icon),
          const Spacer(),
          Text(
            value,
            style: const TextStyle(
              fontFamily: NphFonts.heading,
              fontSize: 24,
              fontWeight: FontWeight.w700,
              height: 1,
              color: NphColors.foreground,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontFamily: NphFonts.body,
              fontSize: 12,
              color: NphColors.mutedForeground,
            ),
          ),
        ],
      ),
    );
  }
}
