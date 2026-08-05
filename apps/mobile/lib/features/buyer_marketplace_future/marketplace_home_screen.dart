import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/env.dart';
import '../../core/errors.dart';
import '../../design/components.dart';
import '../../design/tokens.dart';
import '../../models/store.dart';
import 'marketplace_service.dart';
import '../../widgets/listing_card.dart';

/// The marketplace Home tab â€” where an approved dealer lands after sign-in.
///
/// Reads the public `listings` collection with `publiclyVisible == true`, the
/// same filter the website uses and the same one the security rule requires.
/// A dealer therefore sees exactly what a buyer sees, including their own live
/// stock, which is the quickest honest answer to "is my part actually up?".
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key, required this.store});

  final Store store;

  /// Icons chosen to match the design's Popular Categories grid.
  static const _categories = <(String, IconData, String)>[
    ('Car Parts', Icons.directions_car_filled_outlined, 'engine'),
    ('Motorcycle Parts', Icons.two_wheeler_outlined, 'motorcycle'),
    ('Truck & Trailer', Icons.local_shipping_outlined, 'truck'),
    ('Tractor & Farm', Icons.agriculture_outlined, 'tractor'),
    ('Heavy Equipment', Icons.precision_manufacturing_outlined, 'heavy'),
    ('Electrical Parts', Icons.bolt_outlined, 'electrical'),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final recent = ref.watch(recentListingsProvider);
    final stores = ref.watch(verifiedStoresProvider);

    return RefreshIndicator(
      color: NphColors.orange,
      onRefresh: () async {
        ref.invalidate(recentListingsProvider);
        ref.invalidate(verifiedStoresProvider);
      },
      child: ListView(
        padding: const EdgeInsets.only(bottom: NphSpacing.xxxl),
        children: [
          _featured(context, recent),
          const SizedBox(height: NphSpacing.xxl),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: NphSpacing.appPage),
            child: NphSectionHeader(
              title: 'Popular Categories',
              actionLabel: 'View all',
              onAction: () {},
            ),
          ),
          const SizedBox(height: NphSpacing.md),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: NphSpacing.appPage),
            child: _categoryGrid(context),
          ),
          const SizedBox(height: NphSpacing.xxl),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: NphSpacing.appPage),
            child: NphSectionHeader(
              title: 'Recently Added',
              actionLabel: 'See all',
              onAction: () {},
            ),
          ),
          const SizedBox(height: NphSpacing.md),
          _recentList(context, ref, recent),
          const SizedBox(height: NphSpacing.xxl),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: NphSpacing.appPage),
            child: NphSectionHeader(
              title: 'Verified Stores Near You',
              actionLabel: 'See all',
              onAction: () {},
            ),
          ),
          const SizedBox(height: NphSpacing.md),
          _storeList(stores),
        ],
      ),
    );
  }

  // --- Featured carousel ---------------------------------------------------

  Widget _featured(BuildContext context, AsyncValue<List<PublicListing>> recent) {
    final items = (recent.valueOrNull ?? const <PublicListing>[]).take(4).toList();

    if (items.isEmpty) {
      return Container(
        height: 200,
        margin: const EdgeInsets.symmetric(horizontal: NphSpacing.appPage),
        decoration: const BoxDecoration(
          color: NphColors.muted,
          borderRadius: NphRadius.cardBorder,
        ),
        alignment: Alignment.center,
        child: recent.isLoading
            ? const NphLoading()
            : const Text(
                'No live listings yet',
                style: TextStyle(
                  fontFamily: NphFonts.body,
                  fontSize: 13,
                  color: NphColors.mutedForeground,
                ),
              ),
      );
    }

    return _FeaturedCarousel(items: items);
  }

  // --- Categories ----------------------------------------------------------

  Widget _categoryGrid(BuildContext context) {
    return GridView.count(
      crossAxisCount: 3,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: NphSpacing.md,
      crossAxisSpacing: NphSpacing.md,
      // Loosened from 0.95 to clear the enlarged icon tile. At three columns a
      // card is ~118 dp wide, and 58 tile + 8 gap + two label lines + padding
      // needs ~125 dp of height â€” "Heavy Equipment" and "Motorcycle Parts" both
      // wrap, so the two-line case is the one that has to fit, not the one-line
      // case.
      childAspectRatio: 0.86,
      children: [
        for (final (label, icon, _) in _categories)
          NphCard(
            onTap: () {},
            padding: const EdgeInsets.all(NphSpacing.md),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                NphIconTile(icon: icon, size: NphIconTileSize.category),
                const SizedBox(height: NphSpacing.sm),
                Text(
                  label,
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  style: const TextStyle(
                    fontFamily: NphFonts.body,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    height: 1.2,
                    color: NphColors.foreground,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  // --- Recently added ------------------------------------------------------

  Widget _recentList(
    BuildContext context,
    WidgetRef ref,
    AsyncValue<List<PublicListing>> recent,
  ) {
    return recent.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: NphSpacing.xxl),
        child: NphLoading(),
      ),
      error: (e, _) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: NphSpacing.appPage),
        child: NphNotice(message: friendlyError(e)),
      ),
      data: (items) {
        if (items.isEmpty) {
          return const NphEmptyState(
            icon: Icons.inventory_2_outlined,
            title: 'Nothing listed yet',
            message: 'Published parts from verified dealers will appear here.',
          );
        }
        return Column(
          children: [
            for (final item in items.take(6))
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  NphSpacing.appPage,
                  0,
                  NphSpacing.appPage,
                  NphSpacing.md,
                ),
                child: NphListingListCard(
                  listing: item.listing,
                  storeName: item.store.businessName,
                  locationLabel: item.store.locationLabel,
                  onTap: () => _openListing(item),
                  onContact: () => _contact(item),
                ),
              ),
          ],
        );
      },
    );
  }

  Future<void> _openListing(PublicListing item) async {
    final uri = Uri.parse('${Env.marketplaceOrigin}/parts/${item.listing.listingId}');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  /// wa.me handoff â€” the same buyer-to-dealer path the website uses. Payment,
  /// negotiation and delivery all happen off-platform in Phase 1.
  Future<void> _contact(PublicListing item) async {
    final number = (item.store.whatsapp.isNotEmpty ? item.store.whatsapp : item.store.phone)
        .replaceAll(RegExp(r'[^0-9]'), '');
    if (number.isEmpty) return;

    final text = Uri.encodeComponent(
      'Hello ${item.store.businessName}, is "${item.listing.name}" still available?',
    );
    final uri = Uri.parse('https://wa.me/$number?text=$text');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  // --- Verified stores -----------------------------------------------------

  Widget _storeList(AsyncValue<List<PublicStore>> stores) {
    return stores.when(
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox.shrink(),
      data: (items) {
        if (items.isEmpty) return const SizedBox.shrink();
        return Column(
          children: [
            for (final s in items.take(5))
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  NphSpacing.appPage,
                  0,
                  NphSpacing.appPage,
                  NphSpacing.md,
                ),
                child: NphCard(
                  padding: const EdgeInsets.all(NphSpacing.md),
                  onTap: () async {
                    final uri = Uri.parse('${Env.marketplaceOrigin}/store/${s.slug}');
                    if (await canLaunchUrl(uri)) {
                      await launchUrl(uri, mode: LaunchMode.externalApplication);
                    }
                  },
                  child: Row(
                    children: [
                      NphInitialsAvatar(name: s.businessName, size: 48),
                      const SizedBox(width: NphSpacing.md),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Flexible(
                                  child: Text(
                                    s.businessName,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontFamily: NphFonts.body,
                                      fontSize: 14,
                                      fontWeight: FontWeight.w600,
                                      color: NphColors.foreground,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 6),
                                const NphVerifiedBadge(compact: true),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Row(
                              children: [
                                const Icon(
                                  Icons.location_on_outlined,
                                  size: 12,
                                  color: NphColors.mutedForeground,
                                ),
                                const SizedBox(width: 2),
                                Text(
                                  s.locationLabel,
                                  style: const TextStyle(
                                    fontFamily: NphFonts.body,
                                    fontSize: 12,
                                    color: NphColors.mutedForeground,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 2),
                            Row(
                              children: [
                                const Icon(
                                  Icons.storefront_outlined,
                                  size: 12,
                                  color: NphColors.mutedForeground,
                                ),
                                const SizedBox(width: 2),
                                Text(
                                  '${s.activeListingCount} active listings',
                                  style: const TextStyle(
                                    fontFamily: NphFonts.body,
                                    fontSize: 12,
                                    color: NphColors.mutedForeground,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

/// Full-bleed hero carousel with a dark scrim so overlaid text stays legible
/// over any photo, plus the dot indicator from the design.
class _FeaturedCarousel extends StatefulWidget {
  const _FeaturedCarousel({required this.items});

  final List<PublicListing> items;

  @override
  State<_FeaturedCarousel> createState() => _FeaturedCarouselState();
}

class _FeaturedCarouselState extends State<_FeaturedCarousel> {
  final _controller = PageController();
  int _page = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 300,
      child: Stack(
        children: [
          PageView.builder(
            controller: _controller,
            onPageChanged: (i) => setState(() => _page = i),
            itemCount: widget.items.length,
            itemBuilder: (_, i) => _slide(widget.items[i]),
          ),
          // Dots sit ON the image rather than in a strip beneath it. The
          // approved design places them below, but that leaves a band of white
          // between the hero and Popular Categories which reads as a gap rather
          // than as part of the hero.
          //
          // Tappable, not decorative: each dot jumps to its slide, so a dealer
          // can reach the fourth item without swiping three times.
          Positioned(
            left: 0,
            right: 0,
            bottom: NphSpacing.md,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var i = 0; i < widget.items.length; i++)
                  GestureDetector(
                    onTap: () => _controller.animateToPage(
                      i,
                      duration: const Duration(milliseconds: 260),
                      curve: Curves.easeOut,
                    ),
                    // Transparent padding widens the 6 px dot to a real tap
                    // target without changing how it looks.
                    behavior: HitTestBehavior.opaque,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 8),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 180),
                        width: i == _page ? 20 : 6,
                        height: 6,
                        decoration: BoxDecoration(
                          // Inactive dots are white-on-scrim, not the light
                          // border grey â€” that colour is invisible against a
                          // photograph.
                          color: i == _page
                              ? NphColors.orange
                              : Colors.white.withValues(alpha: 0.45),
                          borderRadius: NphRadius.pillBorder,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _slide(PublicListing item) {
    final url = item.listing.images.isEmpty ? '' : item.listing.images.first.displayUrl;

    return Stack(
      fit: StackFit.expand,
      children: [
        if (url.isEmpty)
          Container(color: NphColors.muted)
        else
          CachedNetworkImage(
            imageUrl: url,
            fit: BoxFit.cover,
            placeholder: (_, __) => Container(color: NphColors.muted),
            errorWidget: (_, __, ___) => Container(color: NphColors.muted),
          ),
        // `bg-gradient-to-t from-black/85 via-black/45 to-transparent` over the
        // lower three fifths.
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          height: 180,
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.bottomCenter,
                end: Alignment.topCenter,
                colors: [
                  Colors.black.withValues(alpha: 0.85),
                  Colors.black.withValues(alpha: 0.45),
                  Colors.transparent,
                ],
              ),
            ),
          ),
        ),
        Positioned(
          left: NphSpacing.md,
          top: NphSpacing.md,
          child: NphConditionBadge(condition: item.listing.condition),
        ),
        Positioned(
          left: NphSpacing.lg,
          right: NphSpacing.lg,
          // Clears the pagination dots, which now overlay the image bottom.
          bottom: 38,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                item.listing.name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontFamily: NphFonts.body,
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  height: 1.3,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                item.listing.priceLabel,
                style: const TextStyle(
                  fontFamily: NphFonts.heading,
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: NphColors.orange,
                ),
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  Flexible(
                    child: Text(
                      item.store.businessName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontFamily: NphFonts.body,
                        fontSize: 12,
                        color: Colors.white.withValues(alpha: 0.75),
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  const NphVerifiedBadge(compact: true),
                ],
              ),
              const SizedBox(height: 4),
              Row(
                children: [
                  Icon(
                    Icons.location_on_outlined,
                    size: 12,
                    color: Colors.white.withValues(alpha: 0.60),
                  ),
                  const SizedBox(width: 2),
                  Text(
                    item.store.locationLabel,
                    style: TextStyle(
                      fontFamily: NphFonts.body,
                      fontSize: 12,
                      color: Colors.white.withValues(alpha: 0.60),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}
