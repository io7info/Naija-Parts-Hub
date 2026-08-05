import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/listing.dart';
import 'auth_service.dart';
import 'store_service.dart';

/// Raised when publishing is refused because the store is at its limit.
/// Carries the numbers so the UI can show them without a second round trip.
class ListingLimitReached implements Exception {
  const ListingLimitReached({
    required this.activeListingCount,
    required this.limit,
    required this.upgradeUrl,
    required this.isFairUse,
  });

  final int activeListingCount;
  final int limit;
  final String upgradeUrl;
  final bool isFairUse;

  @override
  String toString() => 'Limit reached: $activeListingCount/$limit';
}

class StoreNotApproved implements Exception {
  const StoreNotApproved(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Publishing was attempted without a usable connection.
///
/// Publishing is deliberately online-only. The active-listing limit can only be
/// enforced by the server-side transaction, so an optimistic local publish would
/// let a dealer exceed the free tier simply by turning data off — and the write
/// would then be rejected on reconnect, making the listing appear and vanish.
///
/// Everything else in the app stays offline-capable: drafts, edits and image
/// selection all queue normally. Only the publish step requires connectivity.
class PublishRequiresConnection implements Exception {
  const PublishRequiresConnection();

  static const message = 'Internet connection required to publish. '
      'Your listing is saved as a draft and you can publish it once you are back online.';

  @override
  String toString() => message;
}

/// Listing CRUD (SOW section 4) and publishing (§5).
///
/// Drafts are plain client writes — offline-capable, no transaction needed.
/// Publishing is a callable, because `status: 'active'` is denied to clients
/// and the limit check has to be transactional.
class ListingService {
  ListingService(this._db, this._functions);

  final FirebaseFirestore _db;
  final FirebaseFunctions _functions;

  CollectionReference<Map<String, dynamic>> get _col => _db.collection('listings');

  /// Reserves a listing id before the document exists.
  ///
  /// `doc()` generates the id client-side, so photos can be uploaded to the
  /// listing's *final* Storage path before anything is written to Firestore.
  ///
  /// The previous flow uploaded every new listing's photos to the literal path
  /// `stores/{uid}/listings/drafts/`, shared by every draft that dealer ever
  /// started. Two consequences: nothing tied an object back to a listing, and
  /// `deleteListing`'s cleanup could only remove objects still referenced by a
  /// saved document — so every abandoned form leaked its uploads permanently.
  String newListingId() => _col.doc().id;

  Stream<List<Listing>> watchMine(String storeId) => _col
      .where('storeId', isEqualTo: storeId)
      .snapshots(includeMetadataChanges: true)
      .map((s) => s.docs.map(Listing.fromDoc).toList());

  /// Creates a draft. Written directly rather than through a callable so it
  /// works offline — Firestore queues the write and replays it on reconnect.
  ///
  /// `status: 'draft'` is mandatory: the rules reject any other value on
  /// create, which is what stops a client publishing without the limit check.
  Future<String> createDraft({
    required String storeId,
    /// Pass the id reserved by [newListingId] so the document lands where its
    /// already-uploaded photos are. Omit only when there are no images.
    String? listingId,
    required String name,
    required String categoryId,
    required String condition,
    required int priceKobo,
    required int quantity,
    String description = '',
    String brand = '',
    String partNumber = '',
    String compatibleMake = '',
    String compatibleModel = '',
    List<ListingImage> images = const [],
  }) async {
    final doc = listingId == null ? _col.doc() : _col.doc(listingId);
    final payload = <String, dynamic>{
      'storeId': storeId,
      'status': 'draft',
      'name': name,
      'description': description,
      'categoryId': categoryId,
      'condition': condition,
      'priceKobo': priceKobo,
      'quantity': quantity,
      'brand': brand,
      'partNumber': partNumber,
      'compatibleMake': compatibleMake,
      'compatibleModel': compatibleModel,
      'images': images.map((i) => i.toMap()).toList(),
      'updatedAt': FieldValue.serverTimestamp(),
    };

    // Deliberately not awaited to the server. With offline persistence the
    // returned future completes only once the server acknowledges, so awaiting
    // it would hang the UI whenever the dealer is offline — the exact case this
    // app is built for. The local write applies immediately and the snapshot
    // stream reflects it with hasPendingWrites set.
    unawaited(doc.set(payload));
    return doc.id;
  }

  Future<void> updateDraft(String listingId, Map<String, dynamic> patch) {
    return _col.doc(listingId).update({
      ...patch,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  /// Publishes via the transactional callable (SOW §5).
  ///
  /// Requires connectivity by design — the limit cannot be enforced offline,
  /// and allowing an optimistic local publish would let a dealer exceed the
  /// free tier simply by turning off data.
  Future<({int activeListingCount, int limit})> publish(String listingId) async {
    try {
      final result = await _functions
          .httpsCallable('publishListing')
          .call<Map<String, dynamic>>({'listingId': listingId});
      final d = result.data;
      return (
        activeListingCount: (d['activeListingCount'] as num).toInt(),
        limit: (d['limit'] as num).toInt(),
      );
    } on FirebaseFunctionsException catch (e) {
      // Connectivity failures surface as transport-level codes with no details
      // payload, because the call never reached the function.
      if (_isConnectivityFailure(e)) {
        throw const PublishRequiresConnection();
      }

      final details = e.details is Map ? Map<String, dynamic>.from(e.details as Map) : null;
      final code = details?['code'] as String?;

      if (code == 'LIMIT_REACHED' || code == 'FAIR_USE_LIMIT_REACHED') {
        throw ListingLimitReached(
          activeListingCount: (details?['activeListingCount'] as num?)?.toInt() ?? 0,
          limit: (details?['limit'] as num?)?.toInt() ?? 0,
          upgradeUrl: (details?['upgradeUrl'] as String?) ?? '',
          isFairUse: code == 'FAIR_USE_LIMIT_REACHED',
        );
      }
      if (code == 'STORE_NOT_APPROVED' || code == 'STORE_SUSPENDED') {
        throw StoreNotApproved(e.message ?? 'Store not approved');
      }
      rethrow;
    }
  }

  /// Distinguishes "could not reach the server" from "the server said no".
  ///
  /// A callable that never completes its round trip reports a transport code
  /// and carries no details payload. Treating these as generic failures would
  /// show a dealer a raw Firebase error where the real message is simply that
  /// they are offline.
  static bool _isConnectivityFailure(FirebaseFunctionsException e) {
    const transportCodes = {'unavailable', 'deadline-exceeded', 'internal', 'unknown'};
    if (!transportCodes.contains(e.code)) return false;
    // A genuine server-side failure attaches our ErrorCode in details.
    return e.details == null;
  }

  Future<void> unpublish(String listingId) async {
    try {
      await _functions.httpsCallable('unpublishListing').call({'listingId': listingId});
    } on FirebaseFunctionsException catch (e) {
      if (_isConnectivityFailure(e)) throw const PublishRequiresConnection();
      rethrow;
    }
  }

  Future<void> delete(String listingId) async {
    try {
      await _functions.httpsCallable('deleteListing').call({'listingId': listingId});
    } on FirebaseFunctionsException catch (e) {
      if (_isConnectivityFailure(e)) throw const PublishRequiresConnection();
      rethrow;
    }
  }

  /// Permanent account deletion (Apple Guideline 5.1.1(v) / Google Play).
  ///
  /// Server-side the callable removes every listing, its Storage objects, the
  /// store document, the slug reservation and finally the auth user — in that
  /// order, because revoking the user first would invalidate the token making
  /// the call.
  ///
  /// The typed 'DELETE' confirmation is re-checked on the server; the dialog is
  /// a courtesy, not the guard.
  Future<void> deleteAccount() async {
    try {
      await _functions.httpsCallable('deleteAccount').call({'confirmation': 'DELETE'});
    } on FirebaseFunctionsException catch (e) {
      if (_isConnectivityFailure(e)) throw const PublishRequiresConnection();
      rethrow;
    }
  }
}

final listingServiceProvider = Provider<ListingService>(
  (ref) => ListingService(ref.watch(firestoreProvider), ref.watch(functionsProvider)),
);

final myListingsProvider = StreamProvider<List<Listing>>((ref) {
  final user = ref.watch(authStateProvider).valueOrNull;
  if (user == null) return Stream.value(const []);
  return ref.watch(listingServiceProvider).watchMine(user.uid);
});
