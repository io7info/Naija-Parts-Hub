import 'package:hive/hive.dart';

part 'sale.g.dart';

@HiveType(typeId: 1)
class SaleItem {
  @HiveField(0)
  String partId;

  @HiveField(1)
  String name;

  @HiveField(2)
  int qty;

  @HiveField(3)
  double price;

  SaleItem({
    required this.partId,
    required this.name,
    required this.qty,
    required this.price,
  });

  double get lineTotal => qty * price;

  Map<String, dynamic> toMap() => {
        'partId': partId,
        'name': name,
        'qty': qty,
        'price': price,
      };

  factory SaleItem.fromMap(Map<String, dynamic> map) => SaleItem(
        partId: map['partId'] ?? '',
        name: map['name'] ?? '',
        qty: map['qty'] ?? 0,
        price: (map['price'] ?? 0).toDouble(),
      );
}

@HiveType(typeId: 2)
class Sale extends HiveObject {
  @HiveField(0)
  String id;

  @HiveField(1)
  String shopId;

  @HiveField(2)
  String shopName;

  @HiveField(3)
  List<SaleItem> items;

  @HiveField(4)
  String customerPhone;

  @HiveField(5)
  double total;

  @HiveField(6)
  String paymentMethod; // Cash / Transfer / Owing

  @HiveField(7)
  double balanceOwed;

  @HiveField(8)
  DateTime date;

  @HiveField(9)
  bool synced;

  Sale({
    required this.id,
    required this.shopId,
    required this.shopName,
    required this.items,
    this.customerPhone = '',
    required this.total,
    this.paymentMethod = 'Cash',
    this.balanceOwed = 0,
    DateTime? date,
    this.synced = false,
  }) : date = date ?? DateTime.now();

  Map<String, dynamic> toFirestore() => {
        'id': id,
        'shopId': shopId,
        'shopName': shopName,
        'items': items.map((e) => e.toMap()).toList(),
        'customerPhone': customerPhone,
        'total': total,
        'paymentMethod': paymentMethod,
        'balanceOwed': balanceOwed,
        'date': date.toIso8601String(),
      };

  factory Sale.fromFirestore(Map<String, dynamic> data) => Sale(
        id: data['id'],
        shopId: data['shopId'] ?? '',
        shopName: data['shopName'] ?? '',
        items: (data['items'] as List<dynamic>? ?? [])
            .map((e) => SaleItem.fromMap(Map<String, dynamic>.from(e)))
            .toList(),
        customerPhone: data['customerPhone'] ?? '',
        total: (data['total'] ?? 0).toDouble(),
        paymentMethod: data['paymentMethod'] ?? 'Cash',
        balanceOwed: (data['balanceOwed'] ?? 0).toDouble(),
        date: DateTime.tryParse(data['date'] ?? '') ?? DateTime.now(),
        synced: true,
      );
}
