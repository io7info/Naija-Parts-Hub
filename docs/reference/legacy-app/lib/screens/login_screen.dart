import 'package:flutter/material.dart';
import '../services/firebase_service.dart';
import 'home_screen.dart'; // for kOrange

class LoginScreen extends StatefulWidget {
  final void Function(String shopId, String shopName) onLoggedIn;
  const LoginScreen({super.key, required this.onLoggedIn});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phoneCtrl = TextEditingController();
  final _otpCtrl = TextEditingController();
  final _shopNameCtrl = TextEditingController();
  String? _verificationId;
  bool _loading = false;
  String? _error;

  Future<void> _sendOtp() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    await FirebaseService.sendOtp(
      _phoneCtrl.text.trim(),
      codeSent: (id) {
        setState(() {
          _verificationId = id;
          _loading = false;
        });
      },
      onError: (err) {
        setState(() {
          _error = err;
          _loading = false;
        });
      },
    );
  }

  Future<void> _confirmOtp() async {
    if (_verificationId == null) return;
    setState(() => _loading = true);
    try {
      final cred = await FirebaseService.confirmOtp(_verificationId!, _otpCtrl.text.trim());
      final shopId = cred.user!.uid;
      final shopName = _shopNameCtrl.text.trim().isEmpty
          ? 'My Shop'
          : _shopNameCtrl.text.trim();
      await FirebaseService.pullShopData(shopId);
      widget.onLoggedIn(shopId, shopName);
    } catch (e) {
      setState(() {
        _error = 'Invalid code, try again';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Image.asset('assets/logo.png', height: 80),
              const SizedBox(height: 16),
              const Text('Naija Hub Parts',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
              const Text('Operated by Lytod Motors Ltd',
                  textAlign: TextAlign.center, style: TextStyle(color: Colors.black54)),
              const SizedBox(height: 32),
              if (_verificationId == null) ...[
                TextField(
                  controller: _shopNameCtrl,
                  decoration: const InputDecoration(labelText: 'Shop Name'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _phoneCtrl,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(
                      labelText: 'Phone Number', hintText: '+234...'),
                ),
                const SizedBox(height: 20),
                ElevatedButton(
                  onPressed: _loading ? null : _sendOtp,
                  style: ElevatedButton.styleFrom(backgroundColor: kOrange, foregroundColor: Colors.white),
                  child: _loading
                      ? const CircularProgressIndicator(color: Colors.white)
                      : const Text('Send Code'),
                ),
              ] else ...[
                TextField(
                  controller: _otpCtrl,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Enter OTP Code'),
                ),
                const SizedBox(height: 20),
                ElevatedButton(
                  onPressed: _loading ? null : _confirmOtp,
                  style: ElevatedButton.styleFrom(backgroundColor: kOrange, foregroundColor: Colors.white),
                  child: _loading
                      ? const CircularProgressIndicator(color: Colors.white)
                      : const Text('Verify & Continue'),
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!, style: const TextStyle(color: Colors.red), textAlign: TextAlign.center),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
