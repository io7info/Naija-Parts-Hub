import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/part.dart';
import '../services/hive_service.dart';
import 'add_stock_screen.dart';
import 'sell_screen.dart';
import 'debt_book_screen.dart';

const kOrange = Color(0xFFFF6B00);

class HomeScreen extends StatefulWidget {
  final String shopId;
  final String shopName;
  const HomeScreen({super.key, required this.shopId, required this.shopName});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _navIndex = 0;
  final _searchCtrl = TextEditingController();
  List<Part> _results = [];
  final _naira = NumberFormat.currency(locale: 'en_NG', symbol: '₦', decimalDigits: 0);

  @override
  void initState() {
    super.initState();
    _runSearch('');
  }

  void _runSearch(String query) {
    setState(() {
      _results = HiveService.searchParts(widget.shopId, query);
    });
  }

  @override
  Widget build(BuildContext context) {
    final screens = [
      _buildFindPartTab(),
      AddStockScreen(shopId: widget.shopId),
      SellScreen(shopId: widget.shopId, shopName: widget.shopName),
      DebtBookScreen(shopId: widget.shopId),
    ];

    return Scaffold(
      backgroundColor: const Color(0xFFF7F7F7),
      body: SafeArea(child: screens[_navIndex]),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _navIndex,
        selectedItemColor: kOrange,
        onTap: (i) => setState(() => _navIndex = i),
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.search), label: 'Home'),
          BottomNavigationBarItem(icon: Icon(Icons.add_box), label: 'Add'),
          BottomNavigationBarItem(icon: Icon(Icons.point_of_sale), label: 'Sell'),
          BottomNavigationBarItem(icon: Icon(Icons.receipt_long), label: 'Debt Book'),
        ],
      ),
    );
  }

  Widget _buildFindPartTab() {
    final totalParts = HiveService.allParts(widget.shopId).length;
    final lowStock = HiveService.lowStockParts(widget.shopId).length;
    final todaySales = HiveService.todaysSales(widget.shopId);
    final owed = HiveService.totalOwed(widget.shopId);
    final debtCount = HiveService.allDebts(widget.shopId).length;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(widget.shopName,
            style: const TextStyle(fontSize: 13, color: Colors.black54)),
        const SizedBox(height: 8),

        // Big search bar
        TextField(
          controller: _searchCtrl,
          onChanged: _runSearch,
          decoration: InputDecoration(
            hintText: 'Search parts... e.g. "brake"',
            prefixIcon: const Icon(Icons.search),
            filled: true,
            fillColor: Colors.white,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide.none,
            ),
          ),
        ),
        const SizedBox(height: 12),

        // Debt alert bar
        if (debtCount > 0)
          GestureDetector(
            onTap: () => setState(() => _navIndex = 3),
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: kOrange.withOpacity(0.12),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: kOrange.withOpacity(0.4)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.warning_amber_rounded, color: kOrange),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '$debtCount customers owe ${_naira.format(owed)}',
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                  const Icon(Icons.chevron_right, color: kOrange),
                ],
              ),
            ),
          ),
        const SizedBox(height: 16),

        // Stock overview
        Row(
          children: [
            _statCard('Total Parts', '$totalParts', Icons.inventory_2),
            const SizedBox(width: 10),
            _statCard('Low Stock', '$lowStock', Icons.trending_down,
                highlight: lowStock > 0),
            const SizedBox(width: 10),
            _statCard("Today's Sales", _naira.format(todaySales), Icons.payments),
          ],
        ),
        const SizedBox(height: 20),

        Text('${_results.length} result${_results.length == 1 ? '' : 's'}',
            style: const TextStyle(color: Colors.black54, fontSize: 12)),
        const SizedBox(height: 8),

        ..._results.map((p) => _partTile(p)),

        if (_results.isEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 40),
            child: Center(
              child: Column(
                children: [
                  const Icon(Icons.search_off, size: 40, color: Colors.black26),
                  const SizedBox(height: 8),
                  Text(
                    _searchCtrl.text.isEmpty
                        ? 'No parts yet. Tap "Add" to get started.'
                        : 'No match. Try a different name.',
                    style: const TextStyle(color: Colors.black45),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _statCard(String label, String value, IconData icon, {bool highlight = false}) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: highlight ? Border.all(color: kOrange) : null,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 18, color: highlight ? kOrange : Colors.black45),
            const SizedBox(height: 6),
            Text(value,
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 15,
                    color: highlight ? kOrange : Colors.black87)),
            Text(label, style: const TextStyle(fontSize: 10, color: Colors.black45)),
          ],
        ),
      ),
    );
  }

  Widget _partTile(Part p) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: Colors.grey.shade200,
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Icon(Icons.build, color: Colors.black38),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(p.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                Text(p.location.isEmpty ? 'No location set' : p.location,
                    style: const TextStyle(fontSize: 12, color: Colors.black45)),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(_naira.format(p.price),
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              Text('Qty: ${p.qty}',
                  style: TextStyle(
                      fontSize: 12,
                      color: p.isLowStock ? kOrange : Colors.black45,
                      fontWeight: p.isLowStock ? FontWeight.bold : FontWeight.normal)),
            ],
          ),
        ],
      ),
    );
  }
}
