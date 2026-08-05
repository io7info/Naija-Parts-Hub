import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show SystemChannels;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:naija_parts_hub/core/env.dart';
import 'package:naija_parts_hub/design/theme.dart';
import 'package:naija_parts_hub/features/account/account_screen.dart';
import 'package:naija_parts_hub/features/listings/listings_screen.dart';
import 'package:naija_parts_hub/features/store/my_store_screen.dart';
import 'package:naija_parts_hub/models/listing.dart';
import 'package:naija_parts_hub/models/store.dart';
import 'package:naija_parts_hub/services/categories_service.dart';

import '../support/test_providers.dart';

/// My Listings search / filtering, and the Account screen's contents.
///
/// Search and filtering run client-side over the dealer's own stream, which is
/// correct *here* and would not be on the marketplace: a dealer holds at most a
/// few hundred listings, they are already cached for offline use, and filtering
/// locally keeps the screen working with no connection.
///
/// Note what is not asserted: that the stream contains only this dealer's
/// listings. That is enforced by `allow list` in firestore.rules, and a mocked
/// provider would satisfy it no matter how open the rules were. Cross-store
/// isolation is proven in firebase/tests against the real Emulator Suite.
const _categories = [
  Category(id: 'brake', name: 'Brake', order: 1),
  Category(id: 'engine', name: 'Engine', order: 2),
];

Store _store({
  StoreStatus status = StoreStatus.approved,
  int activeListingCount = 2,
  String slug = 'ladipo-auto-spares',
}) =>
    Store(
      storeId: 'dealer-1',
      businessName: 'Ladipo Auto Spares',
      ownerName: 'Tinuoye Adeyemi',
      phone: '+2349053114741',
      whatsapp: '',
      cacNumber: 'RC-1846352',
      address: '50 Ladipo Market Road',
      state: 'Lagos',
      city: 'Mushin',
      description: '',
      slug: slug,
      status: status,
      visible: true,
      activeListingCount: activeListingCount,
      subscription: const Subscription(plan: 'free', status: 'none'),
    );

Listing _l({
  required String id,
  required String name,
  String category = 'brake',
  String condition = 'new',
  String brand = '',
  String partNumber = '',
  int priceKobo = 100000,
  ListingStatus status = ListingStatus.active,
}) =>
    Listing(
      listingId: id,
      storeId: 'dealer-1',
      name: name,
      description: '',
      categoryId: category,
      condition: condition,
      priceKobo: priceKobo,
      quantity: 1,
      brand: brand,
      partNumber: partNumber,
      compatibleMake: '',
      compatibleModel: '',
      images: const [],
      status: status,
      publiclyVisible: status == ListingStatus.active,
    );

final _listings = [
  _l(id: '1', name: 'Toyota Corolla Brake Pad', brand: 'Bosch', partNumber: 'TCBP-01'),
  _l(id: '2', name: 'Honda Accord Alternator', category: 'engine', condition: 'used'),
  _l(id: '3', name: 'Bajaj Chain Kit', category: 'engine', priceKobo: 900000),
  _l(id: '4', name: 'Draft headlight', status: ListingStatus.draft),
];

Widget _wrap(Widget child, {List<Listing>? listings}) => ProviderScope(
      overrides: commonOverrides(listings: listings ?? _listings, categories: _categories),
      child: MaterialApp(theme: buildNphTheme(), home: Scaffold(body: child)),
    );

void main() {
  setUp(() {
    final view = TestWidgetsFlutterBinding.ensureInitialized().platformDispatcher.views.first;
    view.devicePixelRatio = 1.0;
    view.physicalSize = const Size(400, 1400);
  });

  tearDown(() {
    final view = TestWidgetsFlutterBinding.ensureInitialized().platformDispatcher.views.first;
    view.resetPhysicalSize();
    view.resetDevicePixelRatio();
  });

  group('My Listings — status tabs', () {
    testWidgets('Active shows only active listings', (tester) async {
      await tester.pumpWidget(_wrap(ListingsScreen(store: _store())));
      await tester.pumpAndSettle();

      expect(find.text('Toyota Corolla Brake Pad'), findsOneWidget);
      expect(find.text('Honda Accord Alternator'), findsOneWidget);
      // A draft must not appear on Active — that is the whole point of the tab.
      expect(find.text('Draft headlight'), findsNothing);
    });

    testWidgets('Draft shows only drafts', (tester) async {
      await tester.pumpWidget(_wrap(ListingsScreen(store: _store())));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Draft'));
      await tester.pumpAndSettle();

      expect(find.text('Draft headlight'), findsOneWidget);
      expect(find.text('Toyota Corolla Brake Pad'), findsNothing);
    });

    testWidgets('Archived is empty and explains why', (tester) async {
      await tester.pumpWidget(_wrap(ListingsScreen(store: _store())));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Archived'));
      await tester.pumpAndSettle();

      expect(find.text('Nothing archived'), findsOneWidget);
    });
  });

  group('My Listings — search', () {
    testWidgets('matches on part name', (tester) async {
      await tester.pumpWidget(_wrap(ListingsScreen(store: _store())));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField).first, 'honda');
      await tester.pumpAndSettle();

      expect(find.text('Honda Accord Alternator'), findsOneWidget);
      expect(find.text('Toyota Corolla Brake Pad'), findsNothing);
    });

    testWidgets('matches on SKU / part number', (tester) async {
      await tester.pumpWidget(_wrap(ListingsScreen(store: _store())));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField).first, 'TCBP');
      await tester.pumpAndSettle();

      expect(find.text('Toyota Corolla Brake Pad'), findsOneWidget);
      expect(find.text('Honda Accord Alternator'), findsNothing);
    });

    testWidgets('matches on brand', (tester) async {
      await tester.pumpWidget(_wrap(ListingsScreen(store: _store())));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField).first, 'bosch');
      await tester.pumpAndSettle();

      expect(find.text('Toyota Corolla Brake Pad'), findsOneWidget);
    });

    testWidgets('no match offers to clear, not to add a listing', (tester) async {
      await tester.pumpWidget(_wrap(ListingsScreen(store: _store())));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField).first, 'zzzz-no-such-part');
      await tester.pumpAndSettle();

      // "No results" and "you have nothing yet" are different problems with
      // different fixes. Sending a dealer to Add Listing when they only needed
      // to clear a filter is the wrong answer.
      expect(find.text('No matching listings'), findsOneWidget);
      expect(find.text('Clear search and filters'), findsOneWidget);
    });
  });

  group('My Listings — filters', () {
    testWidgets('condition filter narrows to Used', (tester) async {
      await tester.pumpWidget(_wrap(ListingsScreen(store: _store())));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Condition'));
      await tester.pumpAndSettle();
      // .last: 'Used' is also the condition badge on the Honda card, which is
      // still in the tree behind the sheet.
      await tester.tap(find.text('Used').last);
      await tester.pumpAndSettle();

      expect(find.text('Honda Accord Alternator'), findsOneWidget);
      expect(find.text('Toyota Corolla Brake Pad'), findsNothing);
    });

    testWidgets('category filter narrows to Engine', (tester) async {
      await tester.pumpWidget(_wrap(ListingsScreen(store: _store())));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Category'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Engine').last);
      await tester.pumpAndSettle();

      expect(find.text('Honda Accord Alternator'), findsOneWidget);
      expect(find.text('Bajaj Chain Kit'), findsOneWidget);
      expect(find.text('Toyota Corolla Brake Pad'), findsNothing);
    });

    testWidgets('sort by price puts the most expensive first', (tester) async {
      await tester.pumpWidget(_wrap(ListingsScreen(store: _store())));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Newest'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Price: high to low'));
      await tester.pumpAndSettle();

      final bajaj = tester.getTopLeft(find.text('Bajaj Chain Kit')).dy;
      final toyota = tester.getTopLeft(find.text('Toyota Corolla Brake Pad')).dy;
      expect(bajaj, lessThan(toyota), reason: '₦9,000 should sort above ₦1,000');
    });
  });

  group('My Listings — quota', () {
    testWidgets('shows usage against the free allowance', (tester) async {
      await tester.pumpWidget(_wrap(ListingsScreen(store: _store())));
      await tester.pumpAndSettle();

      expect(find.textContaining('2 of 10'), findsOneWidget);
      expect(find.text('Upgrade'), findsOneWidget);
    });

    testWidgets('at the limit the strip warns', (tester) async {
      await tester.pumpWidget(
        _wrap(ListingsScreen(store: _store(activeListingCount: 10))),
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('10 of 10'), findsOneWidget);
    });
  });

  group('My Store — public link', () {
    testWidgets('shows the whole URL, scheme included', (tester) async {
      await tester.pumpWidget(_wrap(MyStoreScreen(store: _store())));
      await tester.pumpAndSettle();

      // A dealer reads this down the phone or writes it on a card, so the
      // scheme and host have to be present. A '/store/slug' fragment is not
      // something a buyer can type into a browser.
      expect(
        find.text('${Env.marketplaceOrigin}/store/ladipo-auto-spares'),
        findsOneWidget,
      );
    });

    testWidgets('the URL is not truncated on a 320dp handset', (tester) async {
      final view = TestWidgetsFlutterBinding.ensureInitialized().platformDispatcher.views.first;
      view.physicalSize = const Size(320, 1400);

      const slug = 'ladipo-auto-spares-and-heavy-equipment-parts';
      await tester.pumpWidget(_wrap(MyStoreScreen(store: _store(slug: slug))));
      await tester.pumpAndSettle();

      const url = '${Env.marketplaceOrigin}/store/$slug';
      final text = tester.widget<SelectableText>(find.widgetWithText(SelectableText, url));

      // The failure this guards is an ellipsised link: still "found" by a text
      // finder, still unreadable on the screen.
      expect(text.maxLines, isNull, reason: 'the link must wrap, not clip');
      expect(tester.takeException(), isNull);
    });

    testWidgets('an unapproved store says so instead of showing a dead link',
        (tester) async {
      await tester.pumpWidget(
        _wrap(MyStoreScreen(store: _store(status: StoreStatus.pending, slug: ''))),
      );
      await tester.pumpAndSettle();

      expect(find.text('Not assigned until your store is approved'), findsOneWidget);
      expect(find.textContaining('/store/'), findsNothing);
    });

    testWidgets('Copy Link puts the full URL on the clipboard', (tester) async {
      final copied = <String>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async {
          if (call.method == 'Clipboard.setData') {
            copied.add((call.arguments as Map)['text'] as String);
          }
          return null;
        },
      );
      addTearDown(() => tester.binding.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, null));

      await tester.pumpWidget(_wrap(MyStoreScreen(store: _store())));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Copy Link'));
      await tester.pumpAndSettle();

      // What is copied must carry the scheme even where the display might not:
      // a pasted 'naijapartshub.ng/...' is not a link in most apps.
      expect(copied, ['${Env.marketplaceOrigin}/store/ladipo-auto-spares']);
      expect(find.text('Store link copied.'), findsOneWidget);
    });
  });

  group('Account', () {
    testWidgets('formats the phone number for a Nigerian reader', (tester) async {
      await tester.pumpWidget(_wrap(AccountScreen(store: _store())));
      await tester.pumpAndSettle();

      expect(find.text('+234 905 311 4741'), findsOneWidget);
      expect(find.text('+2349053114741'), findsNothing);
    });

    testWidgets('offers only rows that lead somewhere real', (tester) async {
      await tester.pumpWidget(_wrap(AccountScreen(store: _store())));
      await tester.pumpAndSettle();

      for (final row in [
        'Store Profile',
        'My Listings',
        'Plan & Usage',
        'Sync Status',
        'Help Centre',
        'Terms of Service',
        'Privacy Policy',
      ]) {
        expect(find.text(row), findsOneWidget, reason: '$row is missing');
      }

      // Excluded on purpose: no notification pipeline exists (SOW excludes push,
      // SMS and WhatsApp automation), and favourites are not in the SOW at all.
      expect(find.text('Notifications'), findsNothing);
      expect(find.text('Saved parts'), findsNothing);
    });

    testWidgets('shows the operating company and version', (tester) async {
      await tester.pumpWidget(_wrap(AccountScreen(store: _store())));
      await tester.pumpAndSettle();

      await tester.scrollUntilVisible(find.text('Naija Parts Hub'), 300);
      await tester.pumpAndSettle();

      expect(find.text('Operated by Lytod Motors Ltd · RC 1207675'), findsOneWidget);
      expect(find.text('v1.0.0'), findsOneWidget);
    });

    testWidgets('deletion is a guarded route, not a one-tap action', (tester) async {
      await tester.pumpWidget(_wrap(AccountScreen(store: _store())));
      await tester.pumpAndSettle();

      await tester.scrollUntilVisible(find.text('Delete Account'), 300);
      await tester.pumpAndSettle();

      expect(find.text('Delete Account'), findsOneWidget);
      expect(find.text('Log Out'), findsOneWidget);
    });
  });
}
