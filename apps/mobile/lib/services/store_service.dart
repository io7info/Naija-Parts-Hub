import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/firebase_bootstrap.dart';
import '../models/store.dart';
import 'auth_service.dart';

/// Store registration and profile reads (SOW sections 2 and 3).
class StoreService {
  StoreService(this._db, this._functions);

  final FirebaseFirestore _db;
  final FirebaseFunctions _functions;

  DocumentReference<Map<String, dynamic>> _ref(String storeId) =>
      _db.collection('stores').doc(storeId);

  /// Live store profile. `includeMetadataChanges` is required for the sync
  /// indicator — without it, the snapshot that flips hasPendingWrites back to
  /// false after the server acknowledges never reaches the UI.
  Stream<Store?> watch(String storeId) => _ref(storeId)
      .snapshots(includeMetadataChanges: true)
      .map((doc) => doc.exists ? Store.fromDoc(doc) : null);

  /// Registration goes through a callable, not a client write: the slug must be
  /// reserved atomically, and every backend-controlled field (status, visible,
  /// subscription) is denied to clients by the security rules.
  Future<({String storeId, String slug})> register({
    required String businessName,
    required String ownerName,
    required String phone,
    required String whatsapp,
    required String cacNumber,
    required String address,
    required String state,
    required String city,
    required String description,
  }) async {
    final callable = _functions.httpsCallable('registerStore');
    final result = await callable.call<Map<String, dynamic>>({
      'businessName': businessName,
      'ownerName': ownerName,
      'phone': phone,
      'whatsapp': whatsapp,
      'cacNumber': cacNumber,
      'address': address,
      'state': state,
      'city': city,
      'description': description,
      'acceptedTerms': true,
    });
    final data = result.data;
    return (storeId: data['storeId'] as String, slug: data['slug'] as String);
  }

  Future<void> updateProfile(String storeId, Map<String, dynamic> patch) {
    // Only dealer-writable fields reach here; rules reject anything else.
    return _ref(storeId).update({
      ...patch,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }
}

final firestoreProvider = Provider<FirebaseFirestore>((_) => FirebaseFirestore.instance);

/// The instance the emulator was wired on — never resolved independently here.
///
/// Calling `FirebaseFunctions.instanceFor(...)` at each call site risks using a
/// different object from the one `useFunctionsEmulator` was applied to, which
/// sends callables to the real Google Cloud endpoint instead of the emulator.
final functionsProvider = Provider<FirebaseFunctions>((_) => appFunctions);

final storeServiceProvider = Provider<StoreService>(
  (ref) => StoreService(ref.watch(firestoreProvider), ref.watch(functionsProvider)),
);

/// The signed-in dealer's store, or null if they haven't registered yet.
/// This is what the auth gate routes on.
final myStoreProvider = StreamProvider<Store?>((ref) {
  final user = ref.watch(authStateProvider).valueOrNull;
  if (user == null) return Stream.value(null);
  return ref.watch(storeServiceProvider).watch(user.uid);
});
