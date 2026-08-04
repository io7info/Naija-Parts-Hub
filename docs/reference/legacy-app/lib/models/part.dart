import 'package:hive/hive.dart';

part 'part.g.dart';

@HiveType(typeId: 0)
class Part extends HiveObject {
  @HiveField(0)
  String id;

  @HiveField(1)
  String name;

  @HiveField(2)
  String sku;

  @HiveField(3)
  String location; // e.g. "Carton 4, Shelf B"

  @HiveField(4)
  String photoPath;

  @HiveField(5)
  int qty;

  @HiveField(6)
  double price;

  @HiveField(7)
  String supplier;

  @HiveField(8)
  String shopId;

  @HiveField(9)
  DateTime createdAt;

  @HiveField(10)
  DateTime updatedAt;

  @HiveField(11)
  bool synced; // false = not yet pushed to Firestore

  @HiveField(12)
  int lowStockThreshold;

  Part({
    required this.id,
    required this.name,
    this.sku = '',
    this.location = '',
    this.photoPath = '',
    this.qty = 0,
    this.price = 0,
    this.supplier = '',
    required this.shopId,
    DateTime? createdAt,
    DateTime? updatedAt,
    this.synced = false,
    this.lowStockThreshold = 5,
  })  : createdAt = createdAt ?? DateTime.now(),
        updatedAt = updatedAt ?? DateTime.now();

  bool get isLowStock => qty <= lowStockThreshold;

  Map<String, dynamic> toFirestore() => {
        'id': id,
        'name': name,
        'sku': sku,
        'location': location,
        'photoPath': photoPath,
        'qty': qty,
        'price': price,
        'supplier': supplier,
        'shopId': shopId,
        'createdAt': createdAt.toIso8601String(),
        'updatedAt': updatedAt.toIso8601String(),
        'lowStockThreshold': lowStockThreshold,
      };

  factory Part.fromFirestore(Map<String, dynamic> data) => Part(
        id: data['id'],
        name: data['name'] ?? '',
        sku: data['sku'] ?? '',
        location: data['location'] ?? '',
        photoPath: data['photoPath'] ?? '',
        qty: data['qty'] ?? 0,
        price: (data['price'] ?? 0).toDouble(),
        supplier: data['supplier'] ?? '',
        shopId: data['shopId'] ?? '',
        createdAt: DateTime.tryParse(data['createdAt'] ?? '') ?? DateTime.now(),
        updatedAt: DateTime.tryParse(data['updatedAt'] ?? '') ?? DateTime.now(),
        synced: true,
        lowStockThreshold: data['lowStockThreshold'] ?? 5,
      );
}
