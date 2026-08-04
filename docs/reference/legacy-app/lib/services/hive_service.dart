import 'package:hive_flutter/hive_flutter.dart';
import '../models/part.dart';
import '../models/sale.dart';
import '../models/debt.dart';

/// Local offline-first database.
/// Every write goes here FIRST. FirebaseService pushes it to the shared
/// database (Firestore) afterwards, whenever a connection is available.
class HiveService {
  static const String partsBox = 'partsBox';
  static const String salesBox = 'salesBox';
  static const String debtsBox = 'debtsBox';

  static Future<void> init() async {
    await Hive.initFlutter();

    Hive.registerAdapter(PartAdapter());
    Hive.registerAdapter(SaleItemAdapter());
    Hive.registerAdapter(SaleAdapter());
    Hive.registerAdapter(DebtAdapter());

    await Hive.openBox<Part>(partsBox);
    await Hive.openBox<Sale>(salesBox);
    await Hive.openBox<Debt>(debtsBox);
  }

  static Box<Part> get parts => Hive.box<Part>(partsBox);
  static Box<Sale> get sales => Hive.box<Sale>(salesBox);
  static Box<Debt> get debts => Hive.box<Debt>(debtsBox);

  // ---------------- PARTS ----------------

  static Future<void> savePart(Part part) async {
    part.updatedAt = DateTime.now();
    await parts.put(part.id, part);
  }

  static Future<void> deletePart(String id) async => parts.delete(id);

  static List<Part> allParts(String shopId) =>
      parts.values.where((p) => p.shopId == shopId).toList();

  static List<Part> lowStockParts(String shopId) =>
      allParts(shopId).where((p) => p.isLowStock).toList();

  /// Simple fuzzy search: matches substrings and tolerates small typos
  /// (e.g. "break" still finds "brake") using a lightweight edit-distance
  /// check on top of substring matching.
  static List<Part> searchParts(String shopId, String query) {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return allParts(shopId);

    final results = <Part>[];
    for (final part in allParts(shopId)) {
      final name = part.name.toLowerCase();
      final sku = part.sku.toLowerCase();
      if (name.contains(q) || sku.contains(q)) {
        results.add(part);
        continue;
      }
      // Fuzzy fallback: check each word in the part name against the query
      for (final word in name.split(' ')) {
        if (_levenshtein(word, q) <= 2) {
          results.add(part);
          break;
        }
      }
    }
    return results;
  }

  static int _levenshtein(String a, String b) {
    if (a == b) return 0;
    if (a.isEmpty) return b.length;
    if (b.isEmpty) return a.length;

    List<int> prev = List.generate(b.length + 1, (i) => i);
    List<int> curr = List.filled(b.length + 1, 0);

    for (int i = 1; i <= a.length; i++) {
      curr[0] = i;
      for (int j = 1; j <= b.length; j++) {
        final cost = a[i - 1] == b[j - 1] ? 0 : 1;
        curr[j] = [
          curr[j - 1] + 1,
          prev[j] + 1,
          prev[j - 1] + cost,
        ].reduce((a, b) => a < b ? a : b);
      }
      prev = List.from(curr);
    }
    return prev[b.length];
  }

  // ---------------- SALES ----------------

  static Future<void> saveSale(Sale sale) async => sales.put(sale.id, sale);

  static List<Sale> allSales(String shopId) =>
      sales.values.where((s) => s.shopId == shopId).toList();

  static double todaysSales(String shopId) {
    final now = DateTime.now();
    return allSales(shopId)
        .where((s) =>
            s.date.year == now.year &&
            s.date.month == now.month &&
            s.date.day == now.day)
        .fold(0.0, (sum, s) => sum + s.total);
  }

  // ---------------- DEBTS ----------------

  static Future<void> saveDebt(Debt debt) async => debts.put(debt.id, debt);

  static List<Debt> allDebts(String shopId) => debts.values
      .where((d) => d.shopId == shopId && !d.paid)
      .toList()
    ..sort((a, b) => b.createdAt.compareTo(a.createdAt));

  static double totalOwed(String shopId) =>
      allDebts(shopId).fold(0.0, (sum, d) => sum + d.amount);

  // ---------------- UNSYNCED (for FirebaseService) ----------------

  static List<Part> unsyncedParts() =>
      parts.values.where((p) => !p.synced).toList();
  static List<Sale> unsyncedSales() =>
      sales.values.where((s) => !s.synced).toList();
  static List<Debt> unsyncedDebts() =>
      debts.values.where((d) => !d.synced).toList();
}
