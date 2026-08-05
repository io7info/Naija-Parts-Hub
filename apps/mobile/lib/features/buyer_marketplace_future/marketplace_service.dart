import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/listing.dart';
import '../../services/store_service.dart';

/// Public marketplace reads for the in-app Home and Search tabs.
///
/// Every query carries `publiclyVisible == true` — the single backend-
/// maintained boolean that stands for
/// `status == 'active' && storeApproved && storeVisible && !moderation.removed`.
/// That is not a convenience: Firestore only permits a `list` whose filters
/// prove every returned document satisfies the security rule, so a query
/// missing this filter is rejected outright rather than silently over-fetching.
///
/// See PUBLIC_LISTING_FILTER in packages/contracts/src/listing.ts.
class MarketplaceService {
  MarketplaceService(this._db);

  final FirebaseFirestore _db;

  Query<Map<String, dynamic>> get _public =>
      _db.collection('listings').where('publiclyVisible', isEqualTo: true);

  /// Newest public listings.
  ///
  /// Ordered by `createdAt` in Firestore rather than sorted client-side. The
  /// composite index (publiclyVisible, createdAt DESC) exists precisely for
  /// this; sorting after a `limit` would order an arbitrary slice and call it
  /// "newest".
  Stream<List<PublicListing>> watchRecent({int limit = 20}) => _public
      .orderBy('createdAt', descending: true)
      .limit(limit)
      .snapshots()
      .map((s) => s.docs.map(PublicListing.fromDoc).toList());

  Stream<List<PublicListing>> watchByCategory(String categoryId, {int limit = 40}) => _public
      .where('categoryId', isEqualTo: categoryId)
      .orderBy('createdAt', descending: true)
      .limit(limit)
      .snapshots()
      .map((s) => s.docs.map(PublicListing.fromDoc).toList());

  /// Prefix-token search over name, brand and part number (SOW Â§7).
  ///
  /// `searchTokens` is generated server-side by a trigger, so a dealer cannot
  /// stuff it to surface for every term. Firestore caps `array-contains` at one
  /// value per query, so this matches a single normalised token.
  Stream<List<PublicListing>> search(String term, {int limit = 40}) {
    final token = term.trim().toLowerCase();
    if (token.isEmpty) return watchRecent(limit: limit);

    return _public
        .where('searchTokens', arrayContains: token)
        .limit(limit)
        .snapshots()
        .map((s) => s.docs.map(PublicListing.fromDoc).toList());
  }

  /// Approved, visible stores for the "Verified Stores Near You" section.
  Stream<List<PublicStore>> watchStores({int limit = 20}) => _db
      .collection('stores')
      .where('status', isEqualTo: 'approved')
      .where('visible', isEqualTo: true)
      .limit(limit)
      .snapshots()
      .map((s) => s.docs.map(PublicStore.fromDoc).toList());
}

/// A listing as the marketplace sees it: the dealer fields plus the store
/// details denormalized onto the document by a trigger.
class PublicListing {
  const PublicListing({required this.listing, required this.store});

  final Listing listing;
  final PublicListingStore store;

  factory PublicListing.fromDoc(QueryDocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data();
    return PublicListing(
      listing: Listing.fromDoc(doc),
      store: PublicListingStore(
        slug: (d['storeSlug'] as String?) ?? '',
        businessName: (d['storeBusinessName'] as String?) ?? '',
        state: (d['storeState'] as String?) ?? '',
        city: (d['storeCity'] as String?) ?? '',
        phone: (d['storePhone'] as String?) ?? '',
        whatsapp: (d['storeWhatsapp'] as String?) ?? '',
      ),
    );
  }
}

class PublicListingStore {
  const PublicListingStore({
    required this.slug,
    required this.businessName,
    required this.state,
    required this.city,
    required this.phone,
    required this.whatsapp,
  });

  final String slug;
  final String businessName;
  final String state;
  final String city;
  final String phone;
  final String whatsapp;

  String get locationLabel => [city, state].where((s) => s.isNotEmpty).join(', ');
}

class PublicStore {
  const PublicStore({
    required this.storeId,
    required this.businessName,
    required this.slug,
    required this.state,
    required this.city,
    required this.activeListingCount,
  });

  final String storeId;
  final String businessName;
  final String slug;
  final String state;
  final String city;
  final int activeListingCount;

  String get locationLabel => [city, state].where((s) => s.isNotEmpty).join(', ');

  factory PublicStore.fromDoc(QueryDocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data();
    return PublicStore(
      storeId: doc.id,
      businessName: (d['businessName'] as String?) ?? '',
      slug: (d['slug'] as String?) ?? '',
      state: (d['state'] as String?) ?? '',
      city: (d['city'] as String?) ?? '',
      activeListingCount: (d['activeListingCount'] as num?)?.toInt() ?? 0,
    );
  }
}

final marketplaceServiceProvider = Provider<MarketplaceService>(
  (ref) => MarketplaceService(ref.watch(firestoreProvider)),
);

final recentListingsProvider = StreamProvider<List<PublicListing>>(
  (ref) => ref.watch(marketplaceServiceProvider).watchRecent(),
);

final verifiedStoresProvider = StreamProvider<List<PublicStore>>(
  (ref) => ref.watch(marketplaceServiceProvider).watchStores(),
);

/// Current search term, driven by the Search tab's field.
final searchTermProvider = StateProvider<String>((_) => '');

final searchResultsProvider = StreamProvider<List<PublicListing>>((ref) {
  final term = ref.watch(searchTermProvider);
  return ref.watch(marketplaceServiceProvider).search(term);
});
