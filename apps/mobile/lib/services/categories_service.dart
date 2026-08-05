import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'store_service.dart';

/// The admin-managed listing taxonomy (SOW §9), read from Firestore.
///
/// Previously the listing form carried a hardcoded seven-item list. Firestore
/// holds eight, so `filters` existed on the marketplace and in the admin
/// console while no dealer could ever choose it — a category that could be
/// filtered by but never filled. Reading the real collection removes the
/// possibility of that drift rather than fixing this one instance of it.
///
/// `categories` is world-readable by rule (`allow read: if true`), so this
/// works before a dealer is approved and while signed out.
class Category {
  const Category({
    required this.id,
    required this.name,
    required this.order,
  });

  final String id;
  final String name;
  final int order;

  factory Category.fromDoc(QueryDocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data();
    return Category(
      id: doc.id,
      name: (d['name'] as String?) ?? doc.id,
      order: (d['order'] as num?)?.toInt() ?? 0,
    );
  }
}

class CategoriesService {
  CategoriesService(this._db);

  final FirebaseFirestore _db;

  /// Active categories in the admin's chosen order.
  ///
  /// Sorted client-side rather than with `orderBy`: combining it with the
  /// `active` filter needs a composite index, and eight documents do not
  /// justify one. Revisit if the taxonomy ever grows past a screenful.
  Stream<List<Category>> watch() => _db
      .collection('categories')
      .where('active', isEqualTo: true)
      .snapshots()
      .map((s) {
        final list = s.docs.map(Category.fromDoc).toList()
          ..sort((a, b) {
            final byOrder = a.order.compareTo(b.order);
            return byOrder != 0 ? byOrder : a.name.compareTo(b.name);
          });
        return list;
      });
}

final categoriesServiceProvider = Provider<CategoriesService>(
  (ref) => CategoriesService(ref.watch(firestoreProvider)),
);

final categoriesProvider = StreamProvider<List<Category>>(
  (ref) => ref.watch(categoriesServiceProvider).watch(),
);

/// Human label for a stored category id, for read-only display.
///
/// Falls back to the raw id rather than to an empty string: a listing whose
/// category was later deactivated should still say *something*, and the id is
/// at least recognisable.
String categoryLabel(List<Category> categories, String id) {
  if (id.isEmpty) return 'Uncategorised';
  for (final c in categories) {
    if (c.id == id) return c.name;
  }
  return id;
}
