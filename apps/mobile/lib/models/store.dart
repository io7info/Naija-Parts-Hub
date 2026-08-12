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

/// Days a lapsed plan keeps its listings live. Mirrors
/// SUBSCRIPTION_GRACE_DAYS in packages/contracts/src/constants.ts.
const int kSubscriptionGraceDays = 7;

class Subscription {
  const Subscription({
    required this.plan,
    required this.status,
    this.expiresAt,
    this.graceEndsAt,
  });

  final String plan; // free | monthly | yearly
  /// As last written by the backend sweep. Prefer [statusNow], which is exact.
  final String status; // none | active | grace | expired
  final DateTime? expiresAt;
  final DateTime? graceEndsAt;

  /// The status right now, derived from the dates rather than read.
  ///
  /// `status` is maintained by an hourly Cloud Function, so between a plan
  /// lapsing and the next sweep the stored value still says `active`. Deriving
  /// it here keeps the dealer's screen honest in that window — otherwise the
  /// app cheerfully reports an active plan for up to an hour after it ended,
  /// and then appears to change its mind on its own.
  ///
  /// Falls back to the stored value when the dates are missing, which is the
  /// case for stores created before those fields existed.
  String statusNow([DateTime? now]) {
    if (plan == 'free') return 'none';
    final expiry = expiresAt;
    if (expiry == null) return status;

    final at = now ?? DateTime.now();
    if (at.isBefore(expiry)) return 'active';

    final graceEnd =
        graceEndsAt ?? expiry.add(const Duration(days: kSubscriptionGraceDays));
    return at.isBefore(graceEnd) ? 'grace' : 'expired';
  }

  bool isPaid([DateTime? now]) {
    final s = statusNow(now);
    return s == 'active' || s == 'grace';
  }

  /// Lapsed but still honoured — listings stay live through the grace window.
  bool inGrace([DateTime? now]) => statusNow(now) == 'grace';

  /// Lapsed and no longer honoured. The backend has dropped this store back to
  /// the free allowance, so active listings above 10 have been unpublished.
  bool hasExpired([DateTime? now]) => statusNow(now) == 'expired';

  /// Whole days until [graceEndsAt], for the countdown a dealer in grace needs.
  int? graceDaysLeft([DateTime? now]) {
    if (statusNow(now) != 'grace') return null;
    final end = graceEndsAt ??
        expiresAt?.add(const Duration(days: kSubscriptionGraceDays));
    if (end == null) return null;
    final remaining = end.difference(now ?? DateTime.now());
    if (remaining.isNegative) return 0;
    // Ceiling, so a plan with two hours left reads as "1 day" rather than "0",
    // and exactly seven days reads as 7 rather than 8. `inHours ~/ 24 + 1`
    // looks like the same thing and is wrong on every exact boundary.
    return (remaining.inMilliseconds / Duration.millisecondsPerDay).ceil();
  }

  factory Subscription.fromMap(Map<String, dynamic>? m) => Subscription(
        plan: (m?['plan'] as String?) ?? 'free',
        status: (m?['status'] as String?) ?? 'none',
        expiresAt: (m?['expiresAt'] as Timestamp?)?.toDate(),
        graceEndsAt: (m?['graceEndsAt'] as Timestamp?)?.toDate(),
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
  int get activeListingLimit => subscription.isPaid() ? 200 : 10;

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
