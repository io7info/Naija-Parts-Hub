import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../design/widgets.dart';
import '../../models/listing.dart';
import '../../models/store.dart';
import '../../services/auth_service.dart';
import '../../services/listing_service.dart';
import '../../widgets/sync_status_banner.dart';
import 'listing_form_screen.dart';

/// Dealer's own inventory (SOW section 4).
///
/// FUNCTIONAL SCAFFOLD — no final styling.
class ListingsScreen extends ConsumerWidget {
  const ListingsScreen({super.key, required this.store});

  final Store store;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final listings = ref.watch(myListingsProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(store.businessName.isEmpty ? 'My listings' : store.businessName),
        actions: [
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(authServiceProvider).signOut(),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => ListingFormScreen(storeId: store.storeId),
          ),
        ),
        icon: const Icon(Icons.add),
        label: const Text('Add listing'),
      ),
      body: SafeArea(
        child: Column(
          children: [
            const SyncStatusBanner(),
            _QuotaBar(store: store),
            Expanded(
              child: listings.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (e, _) => NphErrorState(
                  title: 'Could not load listings',
                  message: friendlyError(e),
                ),
                data: (items) {
                  if (items.isEmpty) {
                    return const Center(
                      child: Text('No listings yet. Tap "Add listing" to start.'),
                    );
                  }
                  return ListView.builder(
                    itemCount: items.length,
                    itemBuilder: (_, i) => _ListingTile(listing: items[i]),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Free-tier usage against the 10-listing limit (SOW §5).
/// Display only — the authoritative check is the publishListing transaction.
class _QuotaBar extends StatelessWidget {
  const _QuotaBar({required this.store});

  final Store store;

  @override
  Widget build(BuildContext context) {
    final atLimit = store.atListingLimit;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      color: atLimit ? Colors.orange.shade50 : Colors.grey.shade100,
      child: Row(
        children: [
          Icon(
            atLimit ? Icons.warning_amber_rounded : Icons.inventory_2_outlined,
            size: 18,
            color: atLimit ? Colors.orange.shade800 : Colors.black54,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              '${store.activeListingCount} of ${store.activeListingLimit} '
              'active listings${store.subscription.isPaid ? '' : ' (free plan)'}',
              style: const TextStyle(fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}

class _ListingTile extends ConsumerWidget {
  const _ListingTile({required this.listing});

  final Listing listing;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final service = ref.read(listingServiceProvider);

    return ListTile(
      leading: listing.images.isEmpty
          ? const CircleAvatar(child: Icon(Icons.build))
          : CircleAvatar(backgroundImage: NetworkImage(listing.images.first.url)),
      title: Text(listing.name.isEmpty ? '(untitled)' : listing.name),
      subtitle: Row(
        children: [
          Text('${listing.priceLabel} · ${listing.status.label}'),
          if (listing.hasPendingWrites) ...[
            const SizedBox(width: 6),
            const Icon(Icons.cloud_upload_outlined, size: 13, color: Colors.orange),
          ],
        ],
      ),
      trailing: PopupMenuButton<String>(
        onSelected: (action) async {
          final messenger = ScaffoldMessenger.of(context);
          try {
            switch (action) {
              case 'publish':
                await service.publish(listing.listingId);
              case 'unpublish':
                await service.unpublish(listing.listingId);
              case 'delete':
                await service.delete(listing.listingId);
            }
          } on PublishRequiresConnection {
            messenger.showSnackBar(
              const SnackBar(
                content: Text(PublishRequiresConnection.message),
                duration: Duration(seconds: 5),
              ),
            );
          } on ListingLimitReached catch (e) {
            messenger.showSnackBar(
              SnackBar(
                content: Text(
                  e.isFairUse
                      ? 'Fair-use limit of ${e.limit} active listings reached.'
                      : 'Free plan allows ${e.limit}. Upgrade at ${e.upgradeUrl}.',
                ),
              ),
            );
          } on StoreNotApproved catch (e) {
            messenger.showSnackBar(SnackBar(content: Text(e.message)));
          } catch (e) {
            messenger.showSnackBar(SnackBar(content: Text(friendlyError(e))));
          }
        },
        itemBuilder: (_) => [
          if (listing.status != ListingStatus.active)
            const PopupMenuItem(value: 'publish', child: Text('Publish')),
          if (listing.status == ListingStatus.active)
            const PopupMenuItem(value: 'unpublish', child: Text('Unpublish')),
          const PopupMenuItem(value: 'delete', child: Text('Delete')),
        ],
      ),
    );
  }
}
