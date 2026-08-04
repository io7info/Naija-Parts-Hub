import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'dart:io' as io;
import 'package:image_picker/image_picker.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;
import 'package:uuid/uuid.dart';
import '../models/part.dart';
import '../services/hive_service.dart';
import 'home_screen.dart'; // for kOrange

class AddStockScreen extends StatefulWidget {
  final String shopId;
  const AddStockScreen({super.key, required this.shopId});

  @override
  State<AddStockScreen> createState() => _AddStockScreenState();
}

class _AddStockScreenState extends State<AddStockScreen> {
  final _picker = ImagePicker();
  final _speech = stt.SpeechToText();

  final _nameCtrl = TextEditingController();
  final _skuCtrl = TextEditingController();
  final _qtyCtrl = TextEditingController(text: '1');
  final _priceCtrl = TextEditingController();
  final _supplierCtrl = TextEditingController();
  final _locationCtrl = TextEditingController();

  String? _photoPath;
  bool _listening = false;

  Future<void> _takePhoto() async {
    final img = await _picker.pickImage(source: ImageSource.camera, imageQuality: 70);
    if (img != null) setState(() => _photoPath = img.path);
  }

  Future<void> _startVoiceInput() async {
    final available = await _speech.initialize();
    if (!available) return;

    setState(() => _listening = true);
    _speech.listen(
      onResult: (result) {
        // Expected pattern: "Bajaj brake pad 50 pieces"
        // Naive parse: last number found = quantity, rest = name.
        final text = result.recognizedWords;
        _nameCtrl.text = text;

        final match = RegExp(r'(\d+)\s*(pieces|pcs|piece)?$').firstMatch(text);
        if (match != null) {
          _qtyCtrl.text = match.group(1)!;
          _nameCtrl.text = text.replaceRange(match.start, match.end, '').trim();
        }
      },
      onSoundLevelChange: null,
    );
  }

  void _stopVoiceInput() {
    _speech.stop();
    setState(() => _listening = false);
  }

  Future<void> _saveStock() async {
    if (_nameCtrl.text.trim().isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Enter a part name first')));
      return;
    }

    final part = Part(
      id: const Uuid().v4(),
      name: _nameCtrl.text.trim(),
      sku: _skuCtrl.text.trim(),
      location: _locationCtrl.text.trim(),
      photoPath: _photoPath ?? '',
      qty: int.tryParse(_qtyCtrl.text.trim()) ?? 0,
      price: double.tryParse(_priceCtrl.text.trim()) ?? 0,
      supplier: _supplierCtrl.text.trim(),
      shopId: widget.shopId,
    );

    await HiveService.savePart(part);

    if (!mounted) return;
    final listOnMarketplace = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('List this part online?'),
        content: const Text(
            'Want to list this on 2wheelmotions.com to reach buyers in the US? (Boss plan feature)'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('No')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Yes')),
        ],
      ),
    );
    // listOnMarketplace flag would be pushed to a separate
    // `shops/{shopId}/marketplaceListings` collection by FirebaseService —
    // left as a hook for Phase 2 (see PHASE2_SPEC.md).
    debugPrint('List on marketplace: $listOnMarketplace');

    _nameCtrl.clear();
    _skuCtrl.clear();
    _qtyCtrl.text = '1';
    _priceCtrl.clear();
    _supplierCtrl.clear();
    _locationCtrl.clear();
    setState(() => _photoPath = null);

    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(const SnackBar(content: Text('Added to inventory ✅')));
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text('Add Stock', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
        const SizedBox(height: 16),

        // Big camera button
        GestureDetector(
          onTap: _takePhoto,
          child: Container(
            height: 140,
            decoration: BoxDecoration(
              color: Colors.grey.shade200,
              borderRadius: BorderRadius.circular(14),
            ),
            child: _photoPath == null
                ? const Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.camera_alt, size: 36, color: kOrange),
                        SizedBox(height: 6),
                        Text('Snap a photo'),
                      ],
                    ),
                  )
                : ClipRRect(
                    borderRadius: BorderRadius.circular(14),
                    // On web, image_picker returns a blob: URL -> use Image.network.
                    // On Android/iOS, it returns a local file path -> use Image.file.
                    child: kIsWeb
                        ? Image.network(_photoPath!, fit: BoxFit.cover)
                        : Image.file(io.File(_photoPath!), fit: BoxFit.cover),
                  ),
          ),
        ),
        const SizedBox(height: 16),

        // Voice input
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _nameCtrl,
                decoration: const InputDecoration(labelText: 'Part Name'),
              ),
            ),
            IconButton(
              icon: Icon(_listening ? Icons.mic : Icons.mic_none,
                  color: _listening ? kOrange : Colors.black54),
              onPressed: _listening ? _stopVoiceInput : _startVoiceInput,
              tooltip: 'Say the part name, e.g. "Bajaj brake pad 50 pieces"',
            ),
          ],
        ),

        TextField(
          controller: _skuCtrl,
          decoration: const InputDecoration(labelText: 'Part Number / SKU (optional)'),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _qtyCtrl,
          keyboardType: TextInputType.number,
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
          decoration: const InputDecoration(labelText: 'Quantity'),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _priceCtrl,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(labelText: 'Unit Price (₦)'),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _supplierCtrl,
          decoration: const InputDecoration(labelText: 'Supplier'),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _locationCtrl,
          decoration: const InputDecoration(labelText: 'Shelf Location e.g. "Carton 4, Shelf B"'),
        ),
        const SizedBox(height: 20),

        SizedBox(
          width: double.infinity,
          height: 50,
          child: ElevatedButton(
            onPressed: _saveStock,
            style: ElevatedButton.styleFrom(
              backgroundColor: kOrange,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            child: const Text('ADD TO INVENTORY', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ),
      ],
    );
  }
}
