import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';
import '../models/part.dart';
import '../models/sale.dart';
import '../models/debt.dart';
import '../services/hive_service.dart';
import '../services/receipt_service.dart';
import 'home_screen.dart'; // for kOrange

class SellScreen extends StatefulWidget {
  final String shopId;
  final String shopName;
  const SellScreen({super.key, required this.shopId, required this.shopName});

  @override
  State<SellScreen> createState() => _SellScreenState();
}

class _SellScreenState extends State<SellScreen> {
  final List<SaleItem> _cart = [];
  final _searchCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  List<Part> _searchResults = [];
  String _paymentMethod = 'Cash';
  final _naira = NumberFormat.currency(locale: 'en_NG', symbol: '₦', decimalDigits: 0);

  double get _cartTotal => _cart.fold(0.0, (sum, i) => sum + i.lineTotal);

  void _search(String q) {
    setState(() {
      _searchResults = q.isEmpty ? [] : HiveService.searchParts(widget.shopId, q);
    });
  }

  void _addToCart(Part part) {
    setState(() {
      final existing = _cart.where((i) => i.partId == part.id).toList();
      if (existing.isNotEmpty) {
        existing.first.qty += 1;
      } else {
        _cart.add(SaleItem(partId: part.id, name: part.name, qty: 1, price: part.price));
      }
      _searchCtrl.clear();
      _searchResults = [];
    });
  }

  void _removeFromCart(SaleItem item) => setState(() => _cart.remove(item));

  Future<void> _completeSale({bool markAsOwing = false}) async {
    if (_cart.isEmpty) return;

    final sale = Sale(
      id: const Uuid().v4(),
      shopId: widget.shopId,
      shopName: widget.shopName,
      items: List.from(_cart),
      customerPhone: _phoneCtrl.text.trim(),
      total: _cartTotal,
      paymentMethod: markAsOwing ? 'Owing' : _paymentMethod,
      balanceOwed: markAsOwing ? _cartTotal : 0,
    );
    await HiveService.saveSale(sale);

    // Deduct quantity from stock
    for (final item in sale.items) {
      final part = HiveService.parts.get(item.partId);
      if (part != null) {
        part.qty = (part.qty - item.qty).clamp(0, 1 << 30);
        part.synced = false;
        await part.save();
      }
    }

    // Add to debt book if owing
    if (markAsOwing) {
      final debt = Debt(
        id: const Uuid().v4(),
        shopId: widget.shopId,
        customerName: _phoneCtrl.text.trim().isEmpty ? 'Customer' : _phoneCtrl.text.trim(),
        customerPhone: _phoneCtrl.text.trim(),
        amount: _cartTotal,
        saleId: sale.id,
      );
      await HiveService.saveDebt(debt);
    }

    if (!mounted) return;
    setState(() {
      _cart.clear();
      _phoneCtrl.clear();
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(markAsOwing ? 'Sale saved — added to Debt Book' : 'Sale completed ✅')),
    );
  }

  Future<void> _sendWhatsAppReceipt() async {
    if (_cart.isEmpty) return;
    if (_phoneCtrl.text.trim().isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Enter customer WhatsApp number first')));
      return;
    }

    final sale = Sale(
      id: const Uuid().v4(),
      shopId: widget.shopId,
      shopName: widget.shopName,
      items: List.from(_cart),
      customerPhone: _phoneCtrl.text.trim(),
      total: _cartTotal,
      paymentMethod: _paymentMethod,
    );

    try {
      await ReceiptService.sendViaWhatsApp(sale);
      await _completeSale();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Could not open WhatsApp: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              const Align(
                alignment: Alignment.centerLeft,
                child: Text('Sell', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _searchCtrl,
                onChanged: _search,
                decoration: InputDecoration(
                  hintText: 'Scan barcode or type part name',
                  prefixIcon: const Icon(Icons.qr_code_scanner),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
              ..._searchResults.map((p) => ListTile(
                    title: Text(p.name),
                    subtitle: Text('${_naira.format(p.price)} · Qty available: ${p.qty}'),
                    onTap: () => _addToCart(p),
                  )),
            ],
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            children: _cart
                .map((item) => Card(
                      child: ListTile(
                        title: Text(item.name),
                        subtitle: Text('x${item.qty} = ${_naira.format(item.lineTotal)}'),
                        trailing: IconButton(
                          icon: const Icon(Icons.close, size: 18),
                          onPressed: () => _removeFromCart(item),
                        ),
                      ),
                    ))
                .toList(),
          ),
        ),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            boxShadow: [BoxShadow(color: Colors.black12, blurRadius: 8, offset: const Offset(0, -2))],
          ),
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('TOTAL', style: TextStyle(fontWeight: FontWeight.bold)),
                  Text(_naira.format(_cartTotal),
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                ],
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _phoneCtrl,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: 'Customer Phone / WhatsApp'),
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                height: 46,
                child: ElevatedButton.icon(
                  onPressed: _sendWhatsAppReceipt,
                  icon: const Icon(Icons.chat),
                  label: const Text('SEND WHATSAPP RECEIPT'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF25D366),
                    foregroundColor: Colors.white,
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => _completeSale(),
                      child: const Text('Complete Sale (Cash/Transfer)'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => _completeSale(markAsOwing: true),
                      style: OutlinedButton.styleFrom(foregroundColor: kOrange),
                      child: const Text('Mark as Owing'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}
