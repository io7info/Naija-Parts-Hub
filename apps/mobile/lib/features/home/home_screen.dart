import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/env.dart';
import '../../core/errors.dart';
import '../../core/formatting.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../models/listing.dart';
import '../../models/store.dart';
import '../../services/listing_service.dart';
import '../../services/sync_status_service.dart';
import '../../widgets/listing_card.dart';
import '../listings/listing_form_screen.dart';
import '../shell/shell_providers.dart';
import '../store/store_profile_screen.dart';
import '../sync/sync_status_screen.dart';

/// The dealer dashboard — the Home tab.
///
/// Home used to be a buyer marketplace feed. Phase 1 Flutter is dealer-only
/// (ADR-001 #5), so the first thing a dealer sees is now the state of their own
/// business: what is live, what is waiting, and how much of their allowance is
/// left. The marketplace screens are parked under
/// features/buyer_marketplace_future/.
///
/// Every figure is derived from live Firestore state rather than stored. The
/// listing counts come from the dealer's own stream; the quota comes from
/// `activeListingCount` on the store document, which the publishListing
/// transaction maintains.
///
/// "Product Views" and "WhatsApp Contacts" from the design mockup are
/// deliberately absent. Nothing records either, and SOW §9 excludes analytics
/// from Phase 1 — inventing those numbers beside a Verified badge is the one
/// kind of placeholder that must not ship. Their slots hold counts that are
/// real.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key, required this.store});

  final Store store;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final listings = ref.watch(myListingsProvider);

    return listings.when(
      loading: () => const _DashboardSkeleton(),
      error: (e, _) => NphErrorState(
        title: 'Could not load your listings',
        message: friendlyError(e),
        onRetry: () => ref.invalidate(myListingsProvider),
      ),
      data: (all) => _dashboard(context, ref, all),
    );
  }

  Widget _dashboard(BuildContext context, WidgetRef ref, List<Listing> all) {
    final active = all.where((l) => l.status == ListingStatus.active).length;
    final drafts = all.where((l) => l.status == ListingStatus.draft).length;
    final archived = all.where((l) => l.status == ListingStatus.archived).length;

    return RefreshIndicator(
      color: NphColors.orange,
      onRefresh: () async => ref.invalidate(myListingsProvider),
      child: ListView(
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
            child: _planCard(context, ref),
          ),
          const SizedBox(height: NphSpacing.xl),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: NphSpacing.appPage),
            child: _syncBanner(context, ref),
          ),
          const SizedBox(height: NphSpacing.xl),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: NphSpacing.appPage),
            child: _stats(
              active: active,
              drafts: drafts,
              archived: archived,
              total: all.length,
            ),
          ),
          const SizedBox(height: NphSpacing.xxl),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: NphSpacing.appPage),
            child: _quickActions(context, ref),
          ),
          const SizedBox(height: NphSpacing.xxl),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: NphSpacing.appPage),
            child: _recent(context, ref, all),
          ),
        ],
      ),
    );
  }

  // --- Greeting ------------------------------------------------------------

  Widget _greeting(BuildContext context) {
    final hour = DateTime.now().hour;
    final part = hour < 12
        ? 'Good morning'
        : hour < 17
            ? 'Good afternoon'
            : 'Good evening';
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
              if (store.status == StoreStatus.approved)
                const NphVerifiedBadge(compact: true)
              else
                NphStatusBadge.forStoreStatus(store.status.name),
            ],
          ),
        ],
      ),
    );
  }

  // --- Plan card -----------------------------------------------------------

  Widget _planCard(BuildContext context, WidgetRef ref) {
    final limit = store.activeListingLimit;
    final used = store.activeListingCount;
    final planName = store.subscription.isPaid
        ? '${store.subscription.plan[0].toUpperCase()}'
            '${store.subscription.plan.substring(1)} Plan'
        : 'Free Plan';

    return Semantics(
      label: '$planName. $used of $limit active listings used.',
      child: Container(
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
                    planName,
                    style: const TextStyle(
                      fontFamily: NphFonts.body,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: Colors.white,
                    ),
                  ),
                ),
                Flexible(
                  child: Text(
                    '$used of $limit active listings used',
                    textAlign: TextAlign.right,
                    style: TextStyle(
                      fontFamily: NphFonts.body,
                      fontSize: 12,
                      color: Colors.white.withValues(alpha: 0.60),
                    ),
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
                // "on Website", not "Upgrade". Selling a subscription in-app
                // engages App Store Guideline 3.1.1, which requires Apple's
                // in-app purchase for digital goods. ADR-001 open item #3 keeps
                // the paid upgrade on the web for exactly that reason.
                onPressed: _openPlansPage,
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(NphSize.buttonHeightSmall),
                ),
                child: const Text('Manage Plan on Website'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openPlansPage() async {
    final uri = Uri.parse('${Env.marketplaceOrigin}/plans');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  // --- Sync banner ---------------------------------------------------------

  /// Three states only: synced, pending, offline.
  ///
  /// There is deliberately no "sync failed" and no Retry. Firestore's offline
  /// persistence queues writes and replays them itself — there is no failure to
  /// report and nothing for a retry button to do. Individual write and upload
  /// failures are surfaced where they happen, which is where a dealer can
  /// actually act on them.
  Widget _syncBanner(BuildContext context, WidgetRef ref) {
    final sync = ref.watch(syncStatusProvider).valueOrNull;
    final state = sync?.state ?? SyncState.synced;

    final (tone, icon) = switch (state) {
      SyncState.synced => (NphTone.success, Icons.cloud_done_outlined),
      SyncState.pending => (NphTone.warning, Icons.cloud_upload_outlined),
      SyncState.offline => (NphTone.neutral, Icons.cloud_off_outlined),
    };

    return NphBanner(
      message: sync?.label ?? 'All changes saved',
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
        _StatCard(icon: Icons.check_circle_outline, value: '$active', label: 'Active Listings'),
        _StatCard(icon: Icons.edit_note, value: '$drafts', label: 'Draft Listings'),
        _StatCard(icon: Icons.inventory_2_outlined, value: '$archived', label: 'Archived Listings'),
        _StatCard(icon: Icons.widgets_outlined, value: '$total', label: 'Total Products'),
      ],
    );
  }

  // --- Quick actions -------------------------------------------------------

  Widget _quickActions(BuildContext context, WidgetRef ref) {
    final actions = <(IconData, String, VoidCallback)>[
      (
        Icons.add_circle_outline,
        'Add New Listing',
        () => goToShellTab(ref, ShellTab.addListing),
      ),
      (
        Icons.checklist_rtl,
        'Manage Listings',
        () => goToShellTab(ref, ShellTab.listings, listingsTab: ListingsTab.active),
      ),
      (Icons.storefront_outlined, 'View Public Store', _openPublicStore),
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
          childAspectRatio: 2.35,
          children: [
            for (final (icon, label, onTap) in actions)
              NphCard(
                onTap: onTap,
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: NphSpacing.md),
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

  Future<void> _openPublicStore() async {
    if (store.slug.isEmpty) return;
    final uri = Uri.parse('${Env.marketplaceOrigin}/store/${store.slug}');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  // --- Recent listings -----------------------------------------------------

  Widget _recent(BuildContext context, WidgetRef ref, List<Listing> all) {
    // Most recently *updated*, which is what a dealer is looking for after an
    // edit. sortKey falls back to now() for unsynced writes so a draft created
    // seconds ago does not sink to the bottom for want of a server timestamp.
    final recent = [...all]..sort((a, b) => b.sortKey.compareTo(a.sortKey));
    final top = recent.take(3).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        NphSectionHeader(
          title: 'Recent Listings',
          actionLabel: 'Manage',
          showChevron: true,
          onAction: () => goToShellTab(ref, ShellTab.listings),
        ),
        const SizedBox(height: NphSpacing.md),
        if (top.isEmpty)
          NphEmptyState(
            icon: Icons.inventory_2_outlined,
            title: 'No listings yet',
            message: 'Add your first part. It goes live on the marketplace as soon '
                'as you publish it.',
            action: FilledButton(
              onPressed: () => goToShellTab(ref, ShellTab.addListing),
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
              child: NphListingRow(
                listing: listing,
                updatedLabel: 'Updated ${relativeTime(listing.updatedAt)}',
                onTap: () => _edit(context, listing),
                onAction: (a) => a == 'edit'
                    ? _edit(context, listing)
                    : goToShellTab(ref, ShellTab.listings),
                compactMenu: true,
              ),
            ),
      ],
    );
  }

  void _edit(BuildContext context, Listing listing) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ListingFormScreen(storeId: store.storeId, existing: listing),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({required this.icon, required this.value, required this.label});

  final IconData icon;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '$value $label',
      child: NphCard(
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
      ),
    );
  }
}

/// Loading skeleton rather than a bare spinner.
///
/// The dashboard's shape is known before its data is, so showing that shape
/// keeps the layout from jumping when the stream arrives — and tells a dealer
/// on a slow connection that something is coming, not that nothing is there.
class _DashboardSkeleton extends StatelessWidget {
  const _DashboardSkeleton();

  @override
  Widget build(BuildContext context) {
    Widget block(double height, {double? width}) => Container(
          height: height,
          width: width,
          decoration: const BoxDecoration(
            color: NphColors.muted,
            borderRadius: NphRadius.cardBorder,
          ),
        );

    return ListView(
      padding: const EdgeInsets.all(NphSpacing.appPage),
      children: [
        block(18, width: 120),
        const SizedBox(height: NphSpacing.sm),
        block(26, width: 180),
        const SizedBox(height: NphSpacing.xl),
        block(150),
        const SizedBox(height: NphSpacing.xl),
        block(40),
        const SizedBox(height: NphSpacing.xl),
        Row(
          children: [
            Expanded(child: block(86)),
            const SizedBox(width: NphSpacing.md),
            Expanded(child: block(86)),
          ],
        ),
        const SizedBox(height: NphSpacing.md),
        Row(
          children: [
            Expanded(child: block(86)),
            const SizedBox(width: NphSpacing.md),
            Expanded(child: block(86)),
          ],
        ),
      ],
    );
  }
}
