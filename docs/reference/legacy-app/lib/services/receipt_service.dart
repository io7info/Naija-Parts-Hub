import 'dart:io';
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:path_provider/path_provider.dart';
import 'package:printing/printing.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/sale.dart';

class ReceiptService {
  static final _dateFmt = DateFormat('dd MMM yyyy, h:mm a');
  static final _naira = NumberFormat.currency(locale: 'en_NG', symbol: '₦', decimalDigits: 0);

  /// Plain-text receipt, formatted for WhatsApp (asterisks = bold on WhatsApp).
  static String generateText(Sale sale) {
    final items = sale.items
        .map((e) => '${e.name} x${e.qty} — ${_naira.format(e.lineTotal)}')
        .join('\n');

    final balanceLine = sale.balanceOwed > 0
        ? '${_naira.format(sale.balanceOwed)}'
        : 'None — Fully Paid';

    return '''
*${sale.shopName}*
_via Naija Hub Parts · Operated by Lytod Motors Ltd (RC 1207675)_

🧾 Receipt: ${sale.id}
📅 Date: ${_dateFmt.format(sale.date)}

*Items:*
$items

*TOTAL: ${_naira.format(sale.total)}*
Paid: ${sale.paymentMethod}

Warranty: 14 Days from date of purchase
Balance owed: $balanceLine

Thank you for your business! 🔧
''';
  }

  /// Opens WhatsApp directly to the customer's number with the receipt
  /// pre-filled, using the wa.me deep link (works on Android, iOS, and Web).
  static Future<void> sendViaWhatsApp(Sale sale) async {
    final phone = sale.customerPhone.replaceAll(RegExp(r'[^0-9]'), '');
    final text = Uri.encodeComponent(generateText(sale));
    final url = Uri.parse('https://wa.me/$phone?text=$text');

    if (await canLaunchUrl(url)) {
      await launchUrl(url, mode: LaunchMode.externalApplication);
    } else {
      throw Exception('Could not open WhatsApp');
    }
  }

  /// Generates a PDF receipt (for printing on a Bluetooth receipt printer
  /// or sharing as a file) and returns the saved file.
  static Future<File> generatePdf(Sale sale) async {
    final doc = pw.Document();

    doc.addPage(
      pw.Page(
        pageFormat: PdfPageFormat.roll80, // 80mm thermal receipt width
        build: (context) => pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            pw.Center(
              child: pw.Text(sale.shopName,
                  style: pw.TextStyle(fontSize: 14, fontWeight: pw.FontWeight.bold)),
            ),
            pw.Center(
              child: pw.Text('via Naija Hub Parts',
                  style: const pw.TextStyle(fontSize: 8)),
            ),
            pw.Center(
              child: pw.Text('Operated by Lytod Motors Ltd | RC 1207675',
                  style: const pw.TextStyle(fontSize: 8)),
            ),
            pw.Divider(),
            pw.Text('Receipt: ${sale.id}', style: const pw.TextStyle(fontSize: 9)),
            pw.Text('Date: ${_dateFmt.format(sale.date)}',
                style: const pw.TextStyle(fontSize: 9)),
            pw.Divider(),
            ...sale.items.map(
              (item) => pw.Row(
                mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                children: [
                  pw.Text('${item.name} x${item.qty}',
                      style: const pw.TextStyle(fontSize: 9)),
                  pw.Text(_naira.format(item.lineTotal),
                      style: const pw.TextStyle(fontSize: 9)),
                ],
              ),
            ),
            pw.Divider(),
            pw.Row(
              mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
              children: [
                pw.Text('TOTAL',
                    style: pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold)),
                pw.Text(_naira.format(sale.total),
                    style: pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold)),
              ],
            ),
            pw.SizedBox(height: 8),
            pw.Text('Warranty: 14 Days', style: const pw.TextStyle(fontSize: 8)),
            pw.SizedBox(height: 4),
            pw.Center(
              child: pw.Text('Thank you for your business!',
                  style: const pw.TextStyle(fontSize: 8)),
            ),
          ],
        ),
      ),
    );

    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/receipt_${sale.id}.pdf');
    await file.writeAsBytes(await doc.save());
    return file;
  }

  /// Sends the receipt straight to a connected Bluetooth/USB thermal
  /// printer via the system print dialog.
  static Future<void> printReceipt(Sale sale) async {
    final file = await generatePdf(sale);
    await Printing.layoutPdf(onLayout: (_) => file.readAsBytes());
  }

  /// Shares the PDF receipt through the OS share sheet (WhatsApp, email, etc).
  static Future<void> sharePdf(Sale sale) async {
    final file = await generatePdf(sale);
    await Share.shareXFiles([XFile(file.path)], text: 'Your receipt from ${sale.shopName}');
  }
}
