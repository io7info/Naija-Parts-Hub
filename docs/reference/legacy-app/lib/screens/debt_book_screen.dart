import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/debt.dart';
import '../services/hive_service.dart';
import 'home_screen.dart'; // for kOrange

class DebtBookScreen extends StatefulWidget {
  final String shopId;
  const DebtBookScreen({super.key, required this.shopId});

  @override
  State<DebtBookScreen> createState() => _DebtBookScreenState();
}

class _DebtBookScreenState extends State<DebtBookScreen> {
  final _naira = NumberFormat.currency(locale: 'en_NG', symbol: '₦', decimalDigits: 0);

  Future<void> _remind(Debt debt, String shopName) async {
    final message = Uri.encodeComponent(
      'Oga ${debt.customerName}, your balance at $shopName na ${_naira.format(debt.amount)}. '
      'Abeg pay when you can. Thank you! 🙏',
    );
    final phone = debt.customerPhone.replaceAll(RegExp(r'[^0-9]'), '');
    final url = Uri.parse('https://wa.me/$phone?text=$message');

    if (await canLaunchUrl(url)) {
      await launchUrl(url, mode: LaunchMode.externalApplication);
      debt.lastRemindedAt = DateTime.now();
      debt.synced = false;
      await debt.save();
      setState(() {});
    }
  }

  Future<void> _markPaid(Debt debt) async {
    debt.paid = true;
    debt.synced = false;
    await debt.save();
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final debts = HiveService.allDebts(widget.shopId);
    final total = HiveService.totalOwed(widget.shopId);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Debt Book', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
              const SizedBox(height: 4),
              Text('Total owing: ${_naira.format(total)}',
                  style: const TextStyle(color: kOrange, fontWeight: FontWeight.w600)),
            ],
          ),
        ),
        Expanded(
          child: debts.isEmpty
              ? const Center(child: Text('No one owes you. 🎉'))
              : ListView.builder(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: debts.length,
                  itemBuilder: (context, i) {
                    final d = debts[i];
                    return Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: ListTile(
                        title: Text(d.customerName),
                        subtitle: Text('${_naira.format(d.amount)} · ${d.daysOwing} day${d.daysOwing == 1 ? '' : 's'} ago'),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            IconButton(
                              icon: const Icon(Icons.check_circle_outline, color: Colors.green),
                              tooltip: 'Mark as paid',
                              onPressed: () => _markPaid(d),
                            ),
                            ElevatedButton(
                              onPressed: () => _remind(d, 'your shop'),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFF25D366),
                                foregroundColor: Colors.white,
                                padding: const EdgeInsets.symmetric(horizontal: 10),
                              ),
                              child: const Text('Remind', style: TextStyle(fontSize: 12)),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}
