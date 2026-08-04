import 'package:hive/hive.dart';

part 'debt.g.dart';

@HiveType(typeId: 3)
class Debt extends HiveObject {
  @HiveField(0)
  String id;

  @HiveField(1)
  String shopId;

  @HiveField(2)
  String customerName;

  @HiveField(3)
  String customerPhone;

  @HiveField(4)
  double amount;

  @HiveField(5)
  String saleId;

  @HiveField(6)
  DateTime createdAt;

  @HiveField(7)
  DateTime? lastRemindedAt;

  @HiveField(8)
  bool paid;

  @HiveField(9)
  bool synced;

  Debt({
    required this.id,
    required this.shopId,
    required this.customerName,
    required this.customerPhone,
    required this.amount,
    this.saleId = '',
    DateTime? createdAt,
    this.lastRemindedAt,
    this.paid = false,
    this.synced = false,
  }) : createdAt = createdAt ?? DateTime.now();

  int get daysOwing => DateTime.now().difference(createdAt).inDays;

  Map<String, dynamic> toFirestore() => {
        'id': id,
        'shopId': shopId,
        'customerName': customerName,
        'customerPhone': customerPhone,
        'amount': amount,
        'saleId': saleId,
        'createdAt': createdAt.toIso8601String(),
        'lastRemindedAt': lastRemindedAt?.toIso8601String(),
        'paid': paid,
      };

  factory Debt.fromFirestore(Map<String, dynamic> data) => Debt(
        id: data['id'],
        shopId: data['shopId'] ?? '',
        customerName: data['customerName'] ?? '',
        customerPhone: data['customerPhone'] ?? '',
        amount: (data['amount'] ?? 0).toDouble(),
        saleId: data['saleId'] ?? '',
        createdAt: DateTime.tryParse(data['createdAt'] ?? '') ?? DateTime.now(),
        lastRemindedAt: data['lastRemindedAt'] != null
            ? DateTime.tryParse(data['lastRemindedAt'])
            : null,
        paid: data['paid'] ?? false,
        synced: true,
      );
}
