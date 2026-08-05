import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../design/components.dart';
import '../design/tokens.dart';
import '../models/listing.dart';

/// Listing cards, transcribed from `components/brand/product-card.tsx`.
///
/// Two layouts are in use on mobile:
///   [NphListingListCard] — `flex gap-3 rounded-2xl border p-3` with a 96 px
///     thumbnail. Used by Recent Listings and the marketplace feed.
///   [NphListingRow] — the My Listings row: same frame, but carries status,
///     view count and an overflow menu instead of a contact button.

/// Shared thumbnail. Falls back to a muted tile rather than a broken image —
/// a listing with no photo is normal while a dealer is still drafting it.
class _Thumb extends StatelessWidget {
  const _Thumb({required this.url, required this.size, this.condition});

  final String url;
  final double size;
  final String? condition;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        children: [
          ClipRRect(
            borderRadius: NphRadius.fieldBorder,
            child: SizedBox(
              width: size,
              height: size,
              child: url.isEmpty
                  ? Container(
                      color: NphColors.muted,
                      alignment: Alignment.center,
                      child: const Icon(
                        Icons.image_outlined,
                        size: 22,
                        color: NphColors.mutedForeground,
                      ),
                    )
                  : CachedNetworkImage(
                      imageUrl: url,
                      fit: BoxFit.cover,
                      placeholder: (_, __) => Container(color: NphColors.muted),
                      errorWidget: (_, __, ___) => Container(
                        color: NphColors.muted,
                        alignment: Alignment.center,
                        child: const Icon(
                          Icons.broken_image_outlined,
                          size: 20,
                          color: NphColors.mutedForeground,
                        ),
                      ),
                    ),
            ),
          ),
          if (condition != null)
            Positioned(
              left: 6,
              top: 6,
              child: NphConditionBadge(condition: condition!),
            ),
        ],
      ),
    );
  }
}

/// Marketplace / Recent Listings card with a WhatsApp contact affordance.
class NphListingListCard extends StatelessWidget {
  const NphListingListCard({
    super.key,
    required this.listing,
    this.onTap,
    this.onContact,
    this.storeName,
    this.locationLabel,
    this.verified = true,
  });

  final Listing listing;
  final VoidCallback? onTap;
  final VoidCallback? onContact;
  final String? storeName;
  final String? locationLabel;
  final bool verified;

  @override
  Widget build(BuildContext context) {
    return NphCard(
      onTap: onTap,
      padding: const EdgeInsets.all(NphSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Thumb(
            url: listing.images.isEmpty ? '' : listing.images.first.displayUrl,
            size: 96,
            condition: listing.condition,
          ),
          const SizedBox(width: NphSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  listing.name.isEmpty ? '(untitled)' : listing.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: NphFonts.body,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    height: 1.3,
                    color: NphColors.foreground,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  listing.priceLabel,
                  style: const TextStyle(
                    fontFamily: NphFonts.heading,
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: NphColors.orange,
                  ),
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        storeName ?? '',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontFamily: NphFonts.body,
                          fontSize: 12,
                          color: NphColors.mutedForeground,
                        ),
                      ),
                    ),
                    if (verified && (storeName ?? '').isNotEmpty) ...[
                      const SizedBox(width: 4),
                      const NphVerifiedBadge(compact: true),
                    ],
                  ],
                ),
                const SizedBox(height: NphSpacing.sm),
                Row(
                  children: [
                    Expanded(
                      child: Row(
                        children: [
                          const Icon(
                            Icons.location_on_outlined,
                            size: 12,
                            color: NphColors.mutedForeground,
                          ),
                          const SizedBox(width: 2),
                          Expanded(
                            child: Text(
                              locationLabel ?? '',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontFamily: NphFonts.body,
                                fontSize: 12,
                                color: NphColors.mutedForeground,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (onContact != null)
                      InkWell(
                        onTap: onContact,
                        borderRadius: NphRadius.pillBorder,
                        child: Container(
                          width: 34,
                          height: 34,
                          decoration: const BoxDecoration(
                            color: NphColors.whatsapp,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.chat, size: 17, color: Colors.white),
                        ),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// My Listings row — image, name, price, condition, category, status, last
/// updated, pending-sync marker and an overflow menu (SOW §4).
class NphListingRow extends StatelessWidget {
  const NphListingRow({
    super.key,
    required this.listing,
    required this.onAction,
    this.onTap,
    this.updatedLabel,
    this.categoryLabel,
    this.compactMenu = false,
  });

  final Listing listing;

  /// Receives one of: edit · publish · unpublish · delete · share · view.
  final ValueChanged<String> onAction;
  final VoidCallback? onTap;
  final String? updatedLabel;

  /// Human category name. The document stores an id, and showing `engine` where
  /// the rest of the app says "Engine" reads like a bug.
  final String? categoryLabel;

  /// Trims the menu to Edit only — used on the dashboard, where the full set of
  /// lifecycle actions belongs on My Listings rather than on a summary card.
  final bool compactMenu;

  @override
  Widget build(BuildContext context) {
    final isActive = listing.status == ListingStatus.active;
    final isArchived = listing.status == ListingStatus.archived;

    return Semantics(
      // One spoken sentence rather than eight disconnected fragments.
      label: '${listing.name}, ${listing.priceLabel}, '
          '${listing.condition}, ${listing.displayStatus}'
          '${updatedLabel == null ? '' : ', $updatedLabel'}',
      child: NphCard(
        onTap: onTap,
        padding: const EdgeInsets.all(NphSpacing.md),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _Thumb(url: listing.images.isEmpty ? '' : listing.images.first.displayUrl, size: 80),
            const SizedBox(width: NphSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    listing.name.isEmpty ? '(untitled)' : listing.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontFamily: NphFonts.body,
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      height: 1.3,
                      color: NphColors.foreground,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    listing.priceLabel,
                    style: const TextStyle(
                      fontFamily: NphFonts.heading,
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: NphColors.orange,
                    ),
                  ),
                  const SizedBox(height: 6),
                  // Wrap, not Row: at three chips on a narrow handset with large
                  // text these overflow, and a RenderFlex error is not something
                  // a dealer should ever be shown.
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      if (listing.removed)
                        const NphStatusBadge(label: 'Removed', tone: NphTone.error)
                      else
                        NphStatusBadge.forListingStatus(listing.status.name),
                      NphConditionBadge(condition: listing.condition),
                      if (categoryLabel != null && categoryLabel!.isNotEmpty)
                        Text(
                          categoryLabel!,
                          style: const TextStyle(
                            fontFamily: NphFonts.body,
                            fontSize: 12,
                            color: NphColors.mutedForeground,
                          ),
                        ),
                      if (listing.hasPendingWrites)
                        const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.cloud_upload_outlined,
                              size: 13,
                              color: NphColors.warning,
                            ),
                            SizedBox(width: 2),
                            Text(
                              'Waiting to sync',
                              style: TextStyle(
                                fontFamily: NphFonts.body,
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                                color: NphColors.warning,
                              ),
                            ),
                          ],
                        ),
                    ],
                  ),
                  if (updatedLabel != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      updatedLabel!,
                      style: const TextStyle(
                        fontFamily: NphFonts.body,
                        fontSize: 12,
                        color: NphColors.mutedForeground,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            PopupMenuButton<String>(
              onSelected: onAction,
              tooltip: 'Listing actions',
              icon: const Icon(Icons.more_vert, size: 20, color: NphColors.mutedForeground),
              shape: const RoundedRectangleBorder(borderRadius: NphRadius.fieldBorder),
              itemBuilder: (_) => compactMenu
                  ? const [PopupMenuItem(value: 'edit', child: Text('Edit'))]
                  : [
                      const PopupMenuItem(value: 'edit', child: Text('Edit')),
                      // A removed listing cannot be republished by the dealer —
                      // publishListing refuses it — so offering Publish would be
                      // an action that always fails.
                      if (!listing.removed)
                        if (isActive)
                          const PopupMenuItem(value: 'unpublish', child: Text('Unpublish'))
                        else
                          PopupMenuItem(
                            value: 'publish',
                            child: Text(isArchived ? 'Republish' : 'Publish'),
                          ),
                      if (isActive) ...[
                        const PopupMenuItem(value: 'view', child: Text('View public page')),
                        const PopupMenuItem(value: 'share', child: Text('Share link')),
                      ],
                      const PopupMenuItem(
                        value: 'delete',
                        child: Text('Delete', style: TextStyle(color: NphColors.error)),
                      ),
                    ],
            ),
          ],
        ),
      ),
    );
  }
}
