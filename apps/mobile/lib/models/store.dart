import 'package:cloud_firestore/cloud_firestore.dart';

/// Dart mirror of `packages/contracts/src/store.ts`.
///
/// Kept in sync by hand — Dart cannot import the TypeScript contract. Any
/// change there must be reflected here. Only the fields the dealer app reads
/// are modelled; the rest stay untouched on the document.
enum StoreStatus {
  pending,
  approved,
  rejected,
  suspended;

  static StoreStatus parse(String? raw) => switch (raw) {
        'approved' => StoreStatus.approved,
        'rejected' => StoreStatus.rejected,
        'suspended' => StoreStatus.suspended,
        _ => StoreStatus.pending,
      };

  bool get canPublish => this == StoreStatus.approved;
}

class Subscription {
  const Subscription({required this.plan, required this.status, this.expiresAt});

  final String plan; // free | monthly | yearly
  final String status; // none | active | grace | expired
  final DateTime? expiresAt;

  bool get isPaid => plan != 'free' && (status == 'active' || status == 'grace');

  factory Subscription.fromMap(Map<String, dynamic>? m) => Subscription(
        plan: (m?['plan'] as String?) ?? 'free',
        status: (m?['status'] as String?) ?? 'none',
        expiresAt: (m?['expiresAt'] as Timestamp?)?.toDate(),
      );
}

class Store {
  const Store({
    required this.storeId,
    required this.businessName,
    required this.ownerName,
    required this.phone,
    required this.whatsapp,
    required this.cacNumber,
    required this.address,
    required this.state,
    required this.city,
    required this.description,
    required this.slug,
    required this.status,
    required this.visible,
    required this.activeListingCount,
    required this.subscription,
    this.email = '',
    this.landmark = '',
    this.automotiveCategory = '',
    this.rejectionReason,
  });

  final String storeId;
  final String businessName;
  final String ownerName;
  final String phone;
  final String whatsapp;
  final String cacNumber;
  final String address;
  final String state;
  final String city;
  final String description;

  /// From the client-approved registration design rather than the SOW §2 field
  /// list. Default to '' on read: stores registered before these existed have
  /// no such key, and a missing field must not break the dealer app.
  final String email;
  final String landmark;
  final String automotiveCategory;

  // Backend-controlled — read-only here by design (ADR-001 #4).
  final String slug;
  final StoreStatus status;
  final bool visible;
  final int activeListingCount;
  final Subscription subscription;
  final String? rejectionReason;

  /// Mirrors activeLimitFor() in functions/src/publishListing.ts.
  /// Display only — the authoritative check happens in the transaction.
  int get activeListingLimit => subscription.isPaid ? 200 : 10;

  bool get atListingLimit => activeListingCount >= activeListingLimit;

  factory Store.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? <String, dynamic>{};
    return Store(
      storeId: doc.id,
      businessName: (d['businessName'] as String?) ?? '',
      ownerName: (d['ownerName'] as String?) ?? '',
      phone: (d['phone'] as String?) ?? '',
      whatsapp: (d['whatsapp'] as String?) ?? '',
      cacNumber: (d['cacNumber'] as String?) ?? '',
      address: (d['address'] as String?) ?? '',
      state: (d['state'] as String?) ?? '',
      city: (d['city'] as String?) ?? '',
      description: (d['description'] as String?) ?? '',
      email: (d['email'] as String?) ?? '',
      landmark: (d['landmark'] as String?) ?? '',
      automotiveCategory: (d['automotiveCategory'] as String?) ?? '',
      slug: (d['slug'] as String?) ?? '',
      status: StoreStatus.parse(d['status'] as String?),
      visible: (d['visible'] as bool?) ?? false,
      activeListingCount: (d['activeListingCount'] as num?)?.toInt() ?? 0,
      subscription: Subscription.fromMap(d['subscription'] as Map<String, dynamic>?),
      rejectionReason: d['rejectionReason'] as String?,
    );
  }
}
