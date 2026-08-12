import 'package:flutter_test/flutter_test.dart';
import 'package:naija_parts_hub/models/store.dart';

/// Subscription state as the dealer app computes it.
///
/// The stored `status` field is maintained by an hourly Cloud Function, so it
/// is only ever as fresh as the last sweep. Everything here derives the answer
/// from `expiresAt` and `graceEndsAt` instead, which is what keeps the app from
/// reporting an active plan for an hour after it ended and then appearing to
/// change its mind on its own.
///
/// Mirrors functions/src/lib/subscription.ts. Two implementations of one rule is
/// a real risk — Dart cannot import TypeScript — so the boundaries are asserted
/// on both sides with the same numbers.
void main() {
  final expiry = DateTime.utc(2026, 9, 1);
  final graceEnd = expiry.add(const Duration(days: 7));

  Subscription paid({String plan = 'monthly', String status = 'active'}) => Subscription(
        plan: plan,
        status: status,
        expiresAt: expiry,
        graceEndsAt: graceEnd,
      );

  group('a free store', () {
    test('is never anything but none', () {
      const free = Subscription(plan: 'free', status: 'none');
      expect(free.statusNow(DateTime.utc(2030)), 'none');
      expect(free.isPaid(DateTime.utc(2030)), isFalse);
    });
  });

  group('an active plan', () {
    test('is active up to the last instant', () {
      expect(paid().statusNow(expiry.subtract(const Duration(milliseconds: 1))), 'active');
    });

    test('entitles the paid listing limit', () {
      final store = _store(paid());
      expect(store.activeListingLimit, 200);
    });
  });

  group('the grace window', () {
    test('begins exactly at expiry', () {
      expect(paid().statusNow(expiry), 'grace');
    });

    test('still counts as paid — listings must not come down', () {
      // The whole purpose of grace. A dealer whose payment slips on a Friday
      // keeps their shelf over the weekend.
      final sub = paid();
      expect(sub.isPaid(expiry.add(const Duration(days: 3))), isTrue);
      expect(_store(sub).activeListingLimit, 200);
    });

    test('lasts to the last instant', () {
      expect(
        paid().statusNow(graceEnd.subtract(const Duration(milliseconds: 1))),
        'grace',
      );
    });

    test('counts whole days remaining, rounded up', () {
      // Hours left must never read as "0 days" — that reads as already over.
      expect(paid().graceDaysLeft(graceEnd.subtract(const Duration(hours: 2))), 1);
      expect(paid().graceDaysLeft(expiry), 7);
    });

    test('has no countdown outside the window', () {
      expect(paid().graceDaysLeft(expiry.subtract(const Duration(days: 1))), isNull);
      expect(paid().graceDaysLeft(graceEnd), isNull);
    });
  });

  group('expiry', () {
    test('begins exactly when grace ends', () {
      expect(paid().statusNow(graceEnd), 'expired');
    });

    test('drops the store back to the free allowance', () {
      // Asserted on the subscription rather than through Store.activeListingLimit,
      // which is a getter with no clock parameter and therefore always answers
      // for "now". That is right for the app — the only moment a screen ever
      // renders is now — but it cannot be evaluated at a chosen instant.
      expect(paid().isPaid(graceEnd), isFalse);
      expect(_store(paid(plan: 'free', status: 'none')).activeListingLimit, 10);
    });
  });

  group('a stale stored status', () {
    test('is ignored in favour of the dates', () {
      // The exact window this exists for: the plan lapsed, the hourly sweep has
      // not run, and the document still says 'active'.
      final stale = paid(status: 'active');
      expect(stale.statusNow(graceEnd.add(const Duration(hours: 1))), 'expired');
      expect(stale.isPaid(graceEnd.add(const Duration(hours: 1))), isFalse);
    });

    test('is trusted only when there are no dates to derive from', () {
      // Stores created before these fields existed. Falling back is right;
      // reporting 'none' for a dealer who has paid would not be.
      const legacy = Subscription(plan: 'monthly', status: 'active');
      expect(legacy.statusNow(DateTime.utc(2030)), 'active');
    });
  });

  group('a missing graceEndsAt', () {
    test('falls back to the seven days the contract specifies', () {
      final noGrace = Subscription(plan: 'monthly', status: 'active', expiresAt: expiry);
      expect(noGrace.statusNow(expiry.add(const Duration(days: 6))), 'grace');
      expect(noGrace.statusNow(expiry.add(const Duration(days: 7))), 'expired');
    });
  });
}

/// A store carrying [sub], for the limit assertions.
Store _store(Subscription sub) => Store(
      storeId: 'dealer-1',
      businessName: 'Ladipo Auto Spares',
      ownerName: 'Tinuoye Adeyemi',
      phone: '+2349053114741',
      whatsapp: '',
      cacNumber: 'RC-1',
      address: 'x',
      state: 'Lagos',
      city: 'Mushin',
      description: '',
      slug: 'ladipo',
      status: StoreStatus.approved,
      visible: true,
      activeListingCount: 0,
      subscription: sub,
    );
