import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';
import 'package:naija_parts_hub/models/listing.dart';
import 'package:naija_parts_hub/services/categories_service.dart';
import 'package:naija_parts_hub/services/image_upload_service.dart';
import 'package:naija_parts_hub/services/listing_service.dart';
import 'package:naija_parts_hub/services/sync_status_service.dart';

/// Shared provider overrides for widget tests.
///
/// Every screen in this app reaches Firebase through a Riverpod provider, and
/// `FirebaseFirestore.instance` throws in a test binding. Overriding the
/// service layer — rather than faking Firestore itself — keeps these tests
/// about presentation, which is the only thing they can honestly prove:
/// authorisation and cross-store isolation are properties of firestore.rules
/// and are asserted in firebase/tests against the real Emulator Suite.
class MockListingService extends Mock implements ListingService {}

class MockImageUploadService extends Mock implements ImageUploadService {}

/// The listing form reserves its id in `initState` via `newListingId()`, so
/// this override is required by anything that builds it — including MainShell,
/// which always builds the Add Listing pane even when another tab is showing.
MockListingService listingServiceDouble({String listingId = 'listing-test'}) {
  final mock = MockListingService();
  when(() => mock.newListingId()).thenReturn(listingId);
  return mock;
}

/// Also resolved in the form's `initState`, so it is captured before the widget
/// can be disposed — the orphan cleanup runs in `dispose()`, where `ref` is
/// already dead.
MockImageUploadService uploadServiceDouble() {
  final mock = MockImageUploadService();
  when(() => mock.deleteAt(any())).thenAnswer((_) async {});
  return mock;
}

/// The overrides nearly every widget test needs.
///
/// Pass [listings] to populate My Listings and the dashboard counts, and
/// [categories] where the form's category picker matters.
List<Override> commonOverrides({
  List<Listing> listings = const [],
  List<Category> categories = const [],
  SyncState sync = SyncState.synced,
  int pendingCount = 0,
  ListingService? listingService,
  ImageUploadService? uploadService,
}) {
  return [
    listingServiceProvider.overrideWithValue(listingService ?? listingServiceDouble()),
    imageUploadServiceProvider.overrideWithValue(uploadService ?? uploadServiceDouble()),
    myListingsProvider.overrideWith((ref) => Stream.value(listings)),
    categoriesProvider.overrideWith((ref) => Stream.value(categories)),
    syncStatusProvider.overrideWith(
      (ref) => Stream.value(SyncSnapshot(state: sync, pendingCount: pendingCount)),
    ),
  ];
}
