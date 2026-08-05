import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:intl/intl.dart';

import '../core/env.dart';

/// Dart mirror of `packages/contracts/src/listing.ts`.
///
/// Money is an integer number of kobo, never a double. The inherited code used
/// `double` for prices and debt balances; floating-point naira loses precision
/// once totals accumulate, which matters for payment reconciliation.
enum ListingStatus {
  draft,
  active,
  archived;

  static ListingStatus parse(String? raw) => switch (raw) {
        'active' => ListingStatus.active,
        'archived' => ListingStatus.archived,
        _ => ListingStatus.draft,
      };

  String get label => switch (this) {
        ListingStatus.draft => 'Draft',
        ListingStatus.active => 'Published',
        ListingStatus.archived => 'Unpublished',
      };
}

class ListingImage {
  const ListingImage({
    required this.path,
    required this.url,
    this.width = 0,
    this.height = 0,
    this.sizeBytes = 0,
  });

  final String path;
  final String url;
  final int width;
  final int height;
  final int sizeBytes;

  /// The address to actually load on this device.
  ///
  /// Against the Emulator Suite the stored URL names the host's loopback, which
  /// resolves to the handset itself on an Android emulator. Resolved per client
  /// rather than rewritten in Firestore, because the web app needs the original
  /// form. See Env.resolveStorageUrl.
  String get displayUrl => Env.resolveStorageUrl(url);

  Map<String, dynamic> toMap() => {
        'path': path,
        'url': url,
        'width': width,
        'height': height,
        'sizeBytes': sizeBytes,
      };

  factory ListingImage.fromMap(Map<String, dynamic> m) => ListingImage(
        path: (m['path'] as String?) ?? '',
        url: (m['url'] as String?) ?? '',
        width: (m['width'] as num?)?.toInt() ?? 0,
        height: (m['height'] as num?)?.toInt() ?? 0,
        sizeBytes: (m['sizeBytes'] as num?)?.toInt() ?? 0,
      );
}

class Listing {
  const Listing({
    required this.listingId,
    required this.storeId,
    required this.name,
    required this.description,
    required this.categoryId,
    required this.condition,
    required this.priceKobo,
    required this.quantity,
    required this.brand,
    required this.partNumber,
    required this.compatibleMake,
    required this.compatibleModel,
    required this.images,
    required this.status,
    required this.publiclyVisible,
    this.hasPendingWrites = false,
  });

  final String listingId;
  final String storeId;
  final String name;
  final String description;
  final String categoryId;
  final String condition; // new | used
  final int priceKobo;
  final int quantity;
  final String brand;
  final String partNumber;
  final String compatibleMake;
  final String compatibleModel;
  final List<ListingImage> images;

  // Backend-controlled.
  final ListingStatus status;
  final bool publiclyVisible;

  /// True while this document is a local-only write not yet acknowledged by
  /// the server. Comes from Firestore snapshot metadata and drives the sync
  /// indicator (SOW section 10, "visible sync status").
  final bool hasPendingWrites;

  /// Grouped naira, e.g. 4500000 kobo -> "₦45,000".
  ///
  /// The approved design renders thousands separators throughout ("₦28,500"),
  /// and at Nigerian parts prices an ungrouped "₦980000" is genuinely hard to
  /// read at a glance — the digit count is what a buyer scans, not the value.
  ///
  /// Kobo are dropped rather than shown as ".00": every price in the seed data
  /// and every price the listing form produces is a whole naira amount, so two
  /// zero decimals on each card would be noise. Money is still stored and
  /// compared as integer kobo; this is presentation only.
  String get priceLabel => '₦${_naira.format(priceKobo / 100)}';

  static final _naira = NumberFormat.decimalPattern('en_NG');

  /// The dealer-writable subset. Security rules reject anything else, so this
  /// is deliberately the only map the client ever sends.
  Map<String, dynamic> toDealerMap() => {
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

  factory Listing.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? <String, dynamic>{};
    return Listing(
      listingId: doc.id,
      storeId: (d['storeId'] as String?) ?? '',
      name: (d['name'] as String?) ?? '',
      description: (d['description'] as String?) ?? '',
      categoryId: (d['categoryId'] as String?) ?? '',
      condition: (d['condition'] as String?) ?? 'new',
      priceKobo: (d['priceKobo'] as num?)?.toInt() ?? 0,
      quantity: (d['quantity'] as num?)?.toInt() ?? 0,
      brand: (d['brand'] as String?) ?? '',
      partNumber: (d['partNumber'] as String?) ?? '',
      compatibleMake: (d['compatibleMake'] as String?) ?? '',
      compatibleModel: (d['compatibleModel'] as String?) ?? '',
      images: ((d['images'] as List<dynamic>?) ?? [])
          .map((e) => ListingImage.fromMap(Map<String, dynamic>.from(e as Map)))
          .toList(),
      status: ListingStatus.parse(d['status'] as String?),
      publiclyVisible: (d['publiclyVisible'] as bool?) ?? false,
      hasPendingWrites: doc.metadata.hasPendingWrites,
    );
  }
}
