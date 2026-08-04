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
import '../../widgets/listing_card.dart';
import '../plan/plan_status_screen.dart';
import 'listing_form_screen.dart';

/// My Listings (SOW §4) — Active / Draft / Archived, with the quota strip and
/// the row overflow menu from the approved design.
///
/// The tabs map onto ListingStatus rather than onto three separate queries: the
/// dealer's listings already arrive as one stream (`storeId == uid`), so
/// splitting them locally costs nothing and keeps every tab live at once.
class ListingsScreen extends ConsumerStatefulWidget {
  const ListingsScreen({super.key, required this.store});

  final Store store;

  @override
  ConsumerState<ListingsScreen> createState() => _ListingsScreenState();
}

class _ListingsScreenState extends ConsumerState<ListingsScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 3, vsync: this);

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final listings = ref.watch(myListingsProvider);
    final store = widget.store;

    return Scaffold(
      backgroundColor: NphColors.background,
      appBar: AppBar(
        title: const Text('My Listings'),
        leading: NphIconButton(
          icon: Icons.arrow_back,
          tooltip: 'Back',
          onPressed: () => Navigator.of(context).maybePop(),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _addListing,
        backgroundColor: NphColors.orange,
        foregroundColor: Colors.white,
        elevation: 4,
        icon: const Icon(Icons.add_circle_outline, size: 20),
        label: const Text(
          'Add Listing',
          style: TextStyle(
            fontFamily: NphFonts.body,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                NphSpacing.appPage,
                0,
                NphSpacing.appPage,
                NphSpacing.sm,
              ),
              child: _quotaStrip(store),
            ),
            TabBar(
              controller: _tabs,
              labelColor: NphColors.orange,
              unselectedLabelColor: NphColors.mutedForeground,
              indicatorColor: NphColors.orange,
              indicatorWeight: 2,
              dividerColor: NphColors.border,
              labelStyle: const TextStyle(
                fontFamily: NphFonts.body,
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
              unselectedLabelStyle: const TextStyle(
                fontFamily: NphFonts.body,
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
              tabs: const [
                Tab(text: 'Active'),
                Tab(text: 'Draft'),
                Tab(text: 'Archived'),
              ],
            ),
            Expanded(
              child: listings.when(
                loading: () => const NphLoading(),
                error: (e, _) => NphErrorState(
                  title: 'Could not load listings',
                  message: friendlyError(e),
                ),
                data: (items) => TabBarView(
                  controller: _tabs,
                  children: [
                    _tab(items, ListingStatus.active),
                    _tab(items, ListingStatus.draft),
                    _tab(items, ListingStatus.archived),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// `rounded-xl bg-orange/10 px-3.5 py-2 text-xs font-semibold text-orange`
  /// with an inline upgrade link.
  Widget _quotaStrip(Store store) {
    final used = store.activeListingCount;
    final limit = store.activeListingLimit;
    final atLimit = used >= limit;

    return NphBanner(
      message: '$used of $limit ${store.subscription.isPaid ? '' : 'free '}listings used',
      tone: atLimit ? NphTone.warning : NphTone.brand,
      icon: atLimit ? Icons.warning_amber_rounded : Icons.inventory_2_outlined,
      trailing: store.subscription.isPaid
          ? null
          : InkWell(
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => PlanStatusScreen(store: store)),
              ),
              child: Text(
                'Upgrade',
                style: TextStyle(
                  fontFamily: NphFonts.body,
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  decoration: TextDecoration.underline,
                  color: atLimit ? NphColors.warning : NphColors.orange,
                ),
              ),
            ),
    );
  }

  Widget _tab(List<Listing> all, ListingStatus status) {
    final rows = all.where((l) => l.status == status).toList()
      ..sort((a, b) => b.listingId.compareTo(a.listingId));

    if (rows.isEmpty) {
      return NphEmptyState(
        icon: switch (status) {
          ListingStatus.active => Icons.storefront_outlined,
          ListingStatus.draft => Icons.edit_note,
          ListingStatus.archived => Icons.inventory_2_outlined,
        },
        title: switch (status) {
          ListingStatus.active => 'No active listings',
          ListingStatus.draft => 'No drafts',
          ListingStatus.archived => 'Nothing archived',
        },
        message: switch (status) {
          ListingStatus.active =>
            'Publish a draft and it appears on the marketplace straight away.',
          ListingStatus.draft => 'Drafts are private and do not count toward your limit.',
          ListingStatus.archived => 'Unpublished listings are kept here and can be republished.',
        },
        action: status == ListingStatus.archived
            ? null
            : FilledButton(
                onPressed: _addListing,
                style: FilledButton.styleFrom(
                  minimumSize: const Size(180, NphSize.buttonHeightSmall),
                ),
                child: const Text('Add Listing'),
              ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(
        NphSpacing.appPage,
        NphSpacing.lg,
        NphSpacing.appPage,
        96, // clears the FAB
      ),
      itemCount: rows.length,
      separatorBuilder: (_, __) => const SizedBox(height: NphSpacing.md),
      itemBuilder: (_, i) => NphListingRow(
        listing: rows[i],
        onTap: () => _edit(rows[i]),
        onAction: (action) => _handle(action, rows[i]),
      ),
    );
  }

  void _addListing() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ListingFormScreen(storeId: widget.store.storeId),
      ),
    );
  }

  void _edit(Listing listing) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ListingFormScreen(
          storeId: widget.store.storeId,
          existing: listing,
        ),
      ),
    );
  }

  Future<void> _handle(String action, Listing listing) async {
    final messenger = ScaffoldMessenger.of(context);
    final service = ref.read(listingServiceProvider);

    if (action == 'edit') {
      _edit(listing);
      return;
    }
    if (action == 'share' || action == 'view') {
      final url = '${Env.marketplaceOrigin}/parts/${listing.listingId}';
      final uri = action == 'share'
          ? Uri.parse('https://wa.me/?text=${Uri.encodeComponent('${listing.name} — $url')}')
          : Uri.parse(url);
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      }
      return;
    }
    if (action == 'delete') {
      final confirmed = await _confirmDelete(listing);
      if (!confirmed) return;
    }

    try {
      switch (action) {
        case 'publish':
          await service.publish(listing.listingId);
          messenger.showSnackBar(const SnackBar(content: Text('Listing published.')));
        case 'unpublish':
          await service.unpublish(listing.listingId);
          messenger.showSnackBar(const SnackBar(content: Text('Listing unpublished.')));
        case 'delete':
          await service.delete(listing.listingId);
          messenger.showSnackBar(const SnackBar(content: Text('Listing deleted.')));
      }
    } on PublishRequiresConnection {
      messenger.showSnackBar(
        const SnackBar(
          content: Text(PublishRequiresConnection.message),
          duration: Duration(seconds: 5),
        ),
      );
    } on ListingLimitReached catch (e) {
      if (!mounted) return;
      _showLimitSheet(e);
    } on StoreNotApproved catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
  }

  Future<bool> _confirmDelete(Listing listing) async {
    // Deletion also removes the Storage images and cannot be undone, so it
    // gets an explicit confirmation rather than a menu tap.
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: NphColors.card,
        shape: const RoundedRectangleBorder(borderRadius: NphRadius.cardBorder),
        title: const Text('Delete this listing?'),
        content: Text(
          '"${listing.name}" and its photos will be permanently removed. '
          'This cannot be undone.',
          style: const TextStyle(fontFamily: NphFonts.body, fontSize: 14, height: 1.45),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            style: TextButton.styleFrom(foregroundColor: NphColors.mutedForeground),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: TextButton.styleFrom(foregroundColor: NphColors.error),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  /// The upgrade prompt SOW §5 asks for when the 11th publish is refused.
  void _showLimitSheet(ListingLimitReached e) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: NphColors.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(NphRadius.xxl)),
      ),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(NphSpacing.xxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const NphIconTile(
              icon: Icons.workspace_premium_outlined,
              size: NphIconTileSize.success,
            ),
            const SizedBox(height: NphSpacing.lg),
            Text(
              e.isFairUse
                  ? 'Fair-use limit reached'
                  : "You've reached your free listing limit",
              textAlign: TextAlign.center,
              style: Theme.of(ctx).textTheme.titleLarge,
            ),
            const SizedBox(height: NphSpacing.sm),
            Text(
              e.isFairUse
                  ? 'Your plan allows ${e.limit} active listings. Unpublish one to '
                      'publish another.'
                  : 'Your free plan allows ${e.limit} active listings. Upgrade on the '
                      'website to list more, or unpublish one to free a slot.',
              textAlign: TextAlign.center,
              style: Theme.of(ctx)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: NphColors.mutedForeground),
            ),
            const SizedBox(height: NphSpacing.xxl),
            if (!e.isFairUse)
              FilledButton(
                onPressed: () {
                  Navigator.of(ctx).pop();
                  Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => PlanStatusScreen(store: widget.store),
                    ),
                  );
                },
                child: const Text('See plans'),
              ),
            const SizedBox(height: NphSpacing.sm),
            OutlinedButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Not now'),
            ),
          ],
        ),
      ),
    );
  }
}
