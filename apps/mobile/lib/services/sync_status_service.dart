import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth_service.dart';
import 'store_service.dart';

/// Visible sync status (SOW section 10).
///
/// The inherited app carried a `synced` boolean on every model and surfaced it
/// nowhere, so a dealer had no way to tell whether the day's work was safe.
/// Firestore reports the same thing natively through snapshot metadata, so
/// there is nothing to maintain by hand:
///
///   hasPendingWrites — this document holds local writes the server has not
///                      acknowledged yet
///   isFromCache      — served from the local cache rather than the server
enum SyncState {
  /// Everything written locally has been acknowledged by the server.
  synced,

  /// Local writes are queued. They replay automatically on reconnect.
  pending,

  /// Reads are being served from cache — treat as offline.
  offline,
}

class SyncSnapshot {
  const SyncSnapshot({required this.state, required this.pendingCount});

  final SyncState state;
  final int pendingCount;

  String get label => switch (state) {
        SyncState.synced => 'All changes saved',
        SyncState.pending =>
          '$pendingCount change${pendingCount == 1 ? '' : 's'} waiting to sync',
        SyncState.offline => 'Offline — changes saved on this phone',
      };
}

/// Watches the dealer's own documents and reports whether anything is unsynced.
///
/// Scoped to this store's listings plus its profile: those are the only writes
/// the app makes, so a global listener would add cost without adding signal.
class SyncStatusService {
  SyncStatusService(this._db);

  final FirebaseFirestore _db;

  Stream<SyncSnapshot> watch(String storeId) {
    final listings = _db
        .collection('listings')
        .where('storeId', isEqualTo: storeId)
        .snapshots(includeMetadataChanges: true);

    final store = _db
        .collection('stores')
        .doc(storeId)
        .snapshots(includeMetadataChanges: true);

    late final StreamController<SyncSnapshot> controller;
    QuerySnapshot<Map<String, dynamic>>? lastListings;
    DocumentSnapshot<Map<String, dynamic>>? lastStore;

    void emit() {
      final pendingDocs =
          lastListings?.docs.where((d) => d.metadata.hasPendingWrites).length ?? 0;
      final storePending = lastStore?.metadata.hasPendingWrites ?? false;
      final total = pendingDocs + (storePending ? 1 : 0);

      final fromCache =
          (lastListings?.metadata.isFromCache ?? false) && (lastStore?.metadata.isFromCache ?? false);

      controller.add(
        SyncSnapshot(
          state: total > 0
              ? SyncState.pending
              : (fromCache ? SyncState.offline : SyncState.synced),
          pendingCount: total,
        ),
      );
    }

    late final StreamSubscription<dynamic> subListings;
    late final StreamSubscription<dynamic> subStore;

    controller = StreamController<SyncSnapshot>(
      onListen: () {
        subListings = listings.listen((s) {
          lastListings = s;
          emit();
        });
        subStore = store.listen((s) {
          lastStore = s;
          emit();
        });
      },
      onCancel: () async {
        await subListings.cancel();
        await subStore.cancel();
        await controller.close();
      },
    );

    return controller.stream;
  }
}

final syncStatusServiceProvider = Provider<SyncStatusService>(
  (ref) => SyncStatusService(ref.watch(firestoreProvider)),
);

final syncStatusProvider = StreamProvider<SyncSnapshot>((ref) {
  final user = ref.watch(authStateProvider).valueOrNull;
  if (user == null) {
    return Stream.value(const SyncSnapshot(state: SyncState.synced, pendingCount: 0));
  }
  return ref.watch(syncStatusServiceProvider).watch(user.uid);
});
