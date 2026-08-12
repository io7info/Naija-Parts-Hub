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
import '../../services/categories_service.dart';
import '../../services/listing_service.dart';
import '../../widgets/listing_card.dart';
import '../plan/plan_status_screen.dart';
import '../shell/shell_providers.dart';
import 'listing_form_screen.dart';

/// Sort orders offered on My Listings.
enum ListingSort { newest, oldest, priceHigh, priceLow, nameAZ }

/// Local filter state for the Listings pane.
///
/// Riverpod rather than State so it survives tab switches — a dealer who filters
/// to "Used brake parts", checks the dashboard and comes back should find their
/// filter intact, not reset.
final listingSearchProvider = StateProvider<String>((_) => '');
final listingCategoryFilterProvider = StateProvider<String?>((_) => null);
final listingConditionFilterProvider = StateProvider<String?>((_) => null);
final listingSortProvider = StateProvider<ListingSort>((_) => ListingSort.newest);

/// My Listings (SOW §4) — the dealer's own inventory, and nothing else.
///
/// Scoped by `myListingsProvider`, which queries `storeId == uid`. That scoping
/// is enforced by firestore.rules, not by this screen: `allow list` requires
/// either the public filter or `resource.data.storeId == request.auth.uid`, so
/// a query for another dealer's listings is rejected by the server rather than
/// filtered out here. Cross-store isolation is asserted in firebase/tests
/// against the real Emulator Suite.
///
/// Search and filtering run client-side over the dealer's own stream. That is
/// correct here and would not be on the marketplace: a dealer has at most a few
/// hundred listings, they are already loaded and cached for offline use, and
/// filtering locally keeps the whole screen working with no connection.
class ListingsScreen extends ConsumerStatefulWidget {
  const ListingsScreen({super.key, required this.store});

  final Store store;

  @override
  ConsumerState<ListingsScreen> createState() => _ListingsScreenState();
}

class _ListingsScreenState extends ConsumerState<ListingsScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 3, vsync: this)
    ..addListener(_syncTabToProvider);
  final _searchCtrl = TextEditingController();

  void _syncTabToProvider() {
    if (_tabs.indexIsChanging) return;
    final next = ListingsTab.values[_tabs.index];
    if (ref.read(listingsTabProvider) != next) {
      ref.read(listingsTabProvider.notifier).state = next;
    }
  }

  @override
  void dispose() {
    _tabs.removeListener(_syncTabToProvider);
    _tabs.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Add Listing lands the dealer on a specific status tab after saving.
    // Driving the controller from the provider is what makes that work without
    // this pane being rebuilt.
    ref.listen<ListingsTab>(listingsTabProvider, (_, next) {
      if (_tabs.index != next.index) _tabs.animateTo(next.index);
    });

    final listings = ref.watch(myListingsProvider);
    final categories = ref.watch(categoriesProvider).valueOrNull ?? const <Category>[];

    return LayoutBuilder(
      builder: (context, constraints) => Column(
        children: [
          // Capped and scrollable, not a plain Padding. The title, search
          // field, filter chips and quota strip are all unflexed, so at a 2.0x
          // system font they together demand more than a 760px handset has —
          // and the Expanded body below cannot give back space it never had.
          // The result was a 56px overflow, which leaves the subtree
          // un-laid-out and makes the pane stop responding to touch.
          //
          // A ConstrainedBox rather than Flexible: two flex children would
          // split the free space evenly, so the list would lose half the screen
          // at every text size. This caps the header instead, and at ordinary
          // sizes it is well under the cap and never scrolls — nothing changes
          // for the usual case.
          ConstrainedBox(
            constraints: BoxConstraints(maxHeight: constraints.maxHeight * 0.55),
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(
                NphSpacing.appPage,
                NphSpacing.md,
                NphSpacing.appPage,
                NphSpacing.sm,
              ),
              child: Column(
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text('My Listings',
                            style: Theme.of(context).textTheme.titleLarge),
                      ),
                      TextButton.icon(
                        onPressed: () => goToShellTab(ref, ShellTab.addListing),
                        icon: const Icon(Icons.add, size: 18),
                        label: const Text('Add'),
                      ),
                    ],
                  ),
                  const SizedBox(height: NphSpacing.sm),
                  _searchField(),
                  const SizedBox(height: NphSpacing.sm),
                  _filterRow(categories),
                  const SizedBox(height: NphSpacing.sm),
                  _quotaStrip(widget.store),
                ],
              ),
            ),
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
              fontWeight: FontWeight.w700,
            ),
            unselectedLabelStyle: const TextStyle(
              fontFamily: NphFonts.body,
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
            tabs: const [Tab(text: 'Active'), Tab(text: 'Draft'), Tab(text: 'Archived')],
          ),
          Expanded(
            child: listings.when(
              loading: () => const NphLoading(),
              error: (e, _) => NphErrorState(
                title: 'Could not load listings',
                message: friendlyError(e),
                onRetry: () => ref.invalidate(myListingsProvider),
              ),
              data: (items) => TabBarView(
                controller: _tabs,
                children: [
                  _tabView(items, ListingStatus.active, categories),
                  _tabView(items, ListingStatus.draft, categories),
                  _tabView(items, ListingStatus.archived, categories),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _searchField() {
    return TextField(
      controller: _searchCtrl,
      onChanged: (v) => ref.read(listingSearchProvider.notifier).state = v,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        isDense: true,
        hintText: 'Search your listings by name, SKU or brand',
        prefixIcon: const Icon(Icons.search, size: 18, color: NphColors.mutedForeground),
        suffixIcon: _searchCtrl.text.isEmpty
            ? null
            : IconButton(
                icon: const Icon(Icons.close, size: 18),
                color: NphColors.mutedForeground,
                tooltip: 'Clear search',
                onPressed: () {
                  _searchCtrl.clear();
                  ref.read(listingSearchProvider.notifier).state = '';
                  setState(() {});
                },
              ),
      ),
    );
  }

  Widget _filterRow(List<Category> categories) {
    final category = ref.watch(listingCategoryFilterProvider);
    final condition = ref.watch(listingConditionFilterProvider);
    final sort = ref.watch(listingSortProvider);
    final hasFilters = category != null || condition != null || sort != ListingSort.newest;

    return SizedBox(
      height: 34,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          NphFilterChip(
            label: switch (sort) {
              ListingSort.newest => 'Newest',
              ListingSort.oldest => 'Oldest',
              ListingSort.priceHigh => 'Price: high',
              ListingSort.priceLow => 'Price: low',
              ListingSort.nameAZ => 'Name A–Z',
            },
            active: sort != ListingSort.newest,
            onTap: _pickSort,
          ),
          const SizedBox(width: 6),
          NphFilterChip(
            label: condition == null
                ? 'Condition'
                : (condition == 'new' ? 'New' : 'Used'),
            active: condition != null,
            onTap: _pickCondition,
          ),
          const SizedBox(width: 6),
          NphFilterChip(
            label: category == null ? 'Category' : categoryLabel(categories, category),
            active: category != null,
            onTap: () => _pickCategory(categories),
          ),
          if (hasFilters) ...[
            const SizedBox(width: 6),
            NphFilterChip(
              label: 'Clear',
              onTap: () {
                ref.read(listingCategoryFilterProvider.notifier).state = null;
                ref.read(listingConditionFilterProvider.notifier).state = null;
                ref.read(listingSortProvider.notifier).state = ListingSort.newest;
              },
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _pickSort() async {
    final picked = await _sheet<ListingSort>(
      title: 'Sort by',
      options: const {
        ListingSort.newest: 'Newest first',
        ListingSort.oldest: 'Oldest first',
        ListingSort.priceHigh: 'Price: high to low',
        ListingSort.priceLow: 'Price: low to high',
        ListingSort.nameAZ: 'Name: A to Z',
      },
      current: ref.read(listingSortProvider),
    );
    if (picked != null) ref.read(listingSortProvider.notifier).state = picked;
  }

  Future<void> _pickCondition() async {
    final picked = await _sheet<String?>(
      title: 'Condition',
      options: const {null: 'Any condition', 'new': 'New', 'used': 'Used'},
      current: ref.read(listingConditionFilterProvider),
    );
    ref.read(listingConditionFilterProvider.notifier).state = picked;
  }

  Future<void> _pickCategory(List<Category> categories) async {
    final options = <String?, String>{null: 'All categories'};
    for (final c in categories) {
      options[c.id] = c.name;
    }
    final picked = await _sheet<String?>(
      title: 'Category',
      options: options,
      current: ref.read(listingCategoryFilterProvider),
    );
    ref.read(listingCategoryFilterProvider.notifier).state = picked;
  }

  Future<T?> _sheet<T>({
    required String title,
    required Map<T, String> options,
    required T current,
  }) {
    return showModalBottomSheet<T>(
      context: context,
      backgroundColor: NphColors.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(NphRadius.xxl)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                NphSpacing.xxl,
                NphSpacing.xl,
                NphSpacing.xxl,
                NphSpacing.sm,
              ),
              child: Text(title, style: Theme.of(ctx).textTheme.titleLarge),
            ),
            for (final entry in options.entries)
              ListTile(
                title: Text(
                  entry.value,
                  style: TextStyle(
                    fontFamily: NphFonts.body,
                    fontSize: 14,
                    fontWeight: entry.key == current ? FontWeight.w700 : FontWeight.w500,
                    color: entry.key == current ? NphColors.orange : NphColors.foreground,
                  ),
                ),
                trailing: entry.key == current
                    ? const Icon(Icons.check, size: 18, color: NphColors.orange)
                    : null,
                onTap: () => Navigator.of(ctx).pop(entry.key),
              ),
            const SizedBox(height: NphSpacing.sm),
          ],
        ),
      ),
    );
  }

  /// `rounded-xl bg-orange/10` strip with an inline upgrade link.
  Widget _quotaStrip(Store store) {
    final used = store.activeListingCount;
    final limit = store.activeListingLimit;
    final atLimit = used >= limit;

    return NphBanner(
      message: '$used of $limit ${store.subscription.isPaid() ? '' : 'free '}listings used',
      tone: atLimit ? NphTone.warning : NphTone.brand,
      icon: atLimit ? Icons.warning_amber_rounded : Icons.inventory_2_outlined,
      trailing: store.subscription.isPaid()
          ? null
          : InkWell(
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => PlanStatusScreen(store: store)),
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
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
            ),
    );
  }

  /// Applies search, filters and sort to one status bucket.
  List<Listing> _visible(List<Listing> all, ListingStatus status, List<Category> categories) {
    final term = ref.watch(listingSearchProvider).trim().toLowerCase();
    final category = ref.watch(listingCategoryFilterProvider);
    final condition = ref.watch(listingConditionFilterProvider);
    final sort = ref.watch(listingSortProvider);

    final rows = all.where((l) {
      if (l.status != status) return false;
      if (category != null && l.categoryId != category) return false;
      if (condition != null && l.condition != condition) return false;
      if (term.isEmpty) return true;
      // Name, SKU/part number and brand — the three things a dealer actually
      // remembers about their own stock.
      return '${l.name} ${l.partNumber} ${l.brand} ${l.compatibleMake} '
              '${l.compatibleModel}'
          .toLowerCase()
          .contains(term);
    }).toList();

    rows.sort((a, b) => switch (sort) {
          ListingSort.newest => b.sortKey.compareTo(a.sortKey),
          ListingSort.oldest => a.sortKey.compareTo(b.sortKey),
          ListingSort.priceHigh => b.priceKobo.compareTo(a.priceKobo),
          ListingSort.priceLow => a.priceKobo.compareTo(b.priceKobo),
          ListingSort.nameAZ => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
        });

    return rows;
  }

  Widget _tabView(List<Listing> all, ListingStatus status, List<Category> categories) {
    final rows = _visible(all, status, categories);
    final searching = ref.watch(listingSearchProvider).trim().isNotEmpty ||
        ref.watch(listingCategoryFilterProvider) != null ||
        ref.watch(listingConditionFilterProvider) != null;

    if (rows.isEmpty) {
      // "No results for your filter" and "you have nothing here yet" are
      // different problems with different fixes. Showing the same empty state
      // for both sends a dealer to Add Listing when they only needed to clear a
      // filter.
      if (searching) {
        return NphEmptyState(
          icon: Icons.search_off,
          title: 'No matching listings',
          message: 'Nothing in ${_statusLabel(status)} matches your search and filters.',
          action: OutlinedButton(
            onPressed: () {
              _searchCtrl.clear();
              ref.read(listingSearchProvider.notifier).state = '';
              ref.read(listingCategoryFilterProvider.notifier).state = null;
              ref.read(listingConditionFilterProvider.notifier).state = null;
              setState(() {});
            },
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(200, NphSize.buttonHeightSmall),
            ),
            child: const Text('Clear search and filters'),
          ),
        );
      }

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
          ListingStatus.archived =>
            'Listings you unpublish are kept here, and can be published again.',
        },
        action: status == ListingStatus.archived
            ? null
            : FilledButton(
                onPressed: () => goToShellTab(ref, ShellTab.addListing),
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
        NphSpacing.xxxl,
      ),
      itemCount: rows.length,
      separatorBuilder: (_, __) => const SizedBox(height: NphSpacing.md),
      itemBuilder: (_, i) => NphListingRow(
        listing: rows[i],
        categoryLabel: categoryLabel(categories, rows[i].categoryId),
        updatedLabel: 'Updated ${relativeTime(rows[i].updatedAt)}',
        onTap: () => _edit(rows[i]),
        onAction: (action) => _handle(action, rows[i]),
      ),
    );
  }

  String _statusLabel(ListingStatus s) => switch (s) {
        ListingStatus.active => 'Active',
        ListingStatus.draft => 'Draft',
        ListingStatus.archived => 'Archived',
      };

  void _edit(Listing listing) {
    // Edit stays a pushed route: it is scoped to one listing and must not
    // displace the Add Listing pane's in-progress form.
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
    if (action == 'delete' && !await _confirmDelete(listing)) return;

    try {
      switch (action) {
        case 'publish':
          await service.publish(listing.listingId);
          messenger.showSnackBar(const SnackBar(content: Text('Listing published.')));
          ref.read(listingsTabProvider.notifier).state = ListingsTab.active;
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
      if (mounted) showListingLimitSheet(context, ref, widget.store, e);
    } on StoreNotApproved catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
    }
  }

  Future<bool> _confirmDelete(Listing listing) async {
    // Deletion removes the Storage images too and cannot be undone, so it gets
    // an explicit confirmation rather than a menu tap.
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
}

/// The upgrade prompt SOW §5 requires when an 11th publish is refused.
///
/// Wording is the client's: the dealer's existing products stay live, and the
/// plan is managed on the website. No Paystack, no card fields, no WebView —
/// see PlanStatusScreen for why.
void showListingLimitSheet(
  BuildContext context,
  WidgetRef ref,
  Store store,
  ListingLimitReached e,
) {
  showModalBottomSheet<void>(
    context: context,
    backgroundColor: NphColors.card,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(NphRadius.xxl)),
    ),
    builder: (ctx) => SafeArea(
      child: Padding(
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
                  ? 'You Have Reached Your Plan Limit'
                  : 'You Have Used Your ${e.limit} Free Listings',
              textAlign: TextAlign.center,
              style: Theme.of(ctx).textTheme.titleLarge,
            ),
            const SizedBox(height: NphSpacing.sm),
            Text(
              e.isFairUse
                  ? 'Your existing products remain active. Unpublish a listing to '
                      'free a slot.'
                  : 'Your existing products remain active. To publish more listings, '
                      'manage your Naija Parts Hub plan on the website.',
              textAlign: TextAlign.center,
              style: Theme.of(ctx)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: NphColors.mutedForeground),
            ),
            const SizedBox(height: NphSpacing.xxl),
            if (!e.isFairUse)
              FilledButton(
                onPressed: () async {
                  Navigator.of(ctx).pop();
                  final uri = Uri.parse(Env.upgradeUrl);
                  if (await canLaunchUrl(uri)) {
                    await launchUrl(uri, mode: LaunchMode.externalApplication);
                  }
                },
                child: const Text('Manage Plan on Website'),
              ),
            const SizedBox(height: NphSpacing.sm),
            OutlinedButton(
              onPressed: () {
                Navigator.of(ctx).pop();
                goToShellTab(ref, ShellTab.listings, listingsTab: ListingsTab.active);
              },
              child: const Text('Manage Existing Listings'),
            ),
            const SizedBox(height: NphSpacing.sm),
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              style: TextButton.styleFrom(foregroundColor: NphColors.mutedForeground),
              child: const Text('Not now'),
            ),
          ],
        ),
      ),
    ),
  );
}
