import 'package:flutter/material.dart';

import '../../design/tokens.dart';
import '../../design/widgets.dart';

/// Shown while auth state and the store document are still resolving.
///
/// Replaces a bare CircularProgressIndicator. On a cold start over a slow
/// connection this can be on screen for a couple of seconds, so it is branded
/// rather than blank — a dealer should see the app starting, not a white void.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: NphColors.dark,
      body: SafeArea(
        child: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              NphLogo(size: 88, variant: NphLogoVariant.dark),
              SizedBox(height: NphSpacing.xxl),
              Text(
                'Naija Parts Hub',
                style: TextStyle(
                  fontFamily: NphFonts.heading,
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  color: Colors.white,
                  letterSpacing: -0.3,
                ),
              ),
              SizedBox(height: NphSpacing.xs),
              Text(
                'Dealer',
                style: TextStyle(
                  fontFamily: NphFonts.body,
                  fontSize: 14,
                  color: Colors.white54,
                ),
              ),
              SizedBox(height: NphSpacing.xxxl),
              SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2, color: NphColors.orange),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Footer used on the unauthenticated screens.
class NphLegalFooter extends StatelessWidget {
  const NphLegalFooter({super.key});

  @override
  Widget build(BuildContext context) {
    return Text.rich(
      const TextSpan(
        text: 'By continuing, you agree to the ',
        children: [
          TextSpan(
            text: 'Terms',
            style: TextStyle(color: NphColors.orange, fontWeight: FontWeight.w600),
          ),
          TextSpan(text: ' and '),
          TextSpan(
            text: 'Privacy Policy',
            style: TextStyle(color: NphColors.orange, fontWeight: FontWeight.w600),
          ),
          TextSpan(text: '.'),
        ],
      ),
      textAlign: TextAlign.center,
      style: Theme.of(context).textTheme.bodySmall,
    );
  }
}
