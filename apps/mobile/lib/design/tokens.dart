import 'package:flutter/material.dart';

/// Naija Parts Hub design tokens.
///
/// Values transcribed from the approved design's `globals.css`, so web and
/// mobile stay literally identical rather than approximately so. Changing a
/// brand colour means changing it in both places — there is no shared runtime
/// between a Next.js app and a Flutter app.
///
/// These replace `ColorScheme.fromSeed`, which was treating the brand orange as
/// a *seed* and deriving a tonally-correct Material 3 palette from it. That is
/// why buttons rendered rust-brown instead of #ff6a00.
abstract final class NphColors {
  // Brand
  static const orange = Color(0xFFFF6A00);
  static const orangeHover = Color(0xFFE95F00);
  static const dark = Color(0xFF0B0B0B);
  static const softBlack = Color(0xFF171717);
  static const warm = Color(0xFFF7F7F4);

  // Semantic
  static const success = Color(0xFF168A45);
  static const warning = Color(0xFFD88A00);
  static const error = Color(0xFFC9362B);
  static const whatsapp = Color(0xFF25D366);

  // Surfaces and text
  static const background = Color(0xFFFFFFFF);
  static const foreground = Color(0xFF171717);
  static const card = Color(0xFFFFFFFF);
  static const muted = Color(0xFFF1F2F4);
  static const mutedForeground = Color(0xFF6B7280);
  static const border = Color(0xFFD9DCE1);

  /// Tint behind OTP boxes and selected chips — orange at low opacity, as in
  /// the approved screens.
  static const orangeSubtle = Color(0x1AFF6A00);
}

/// Spacing scale. Multiples of 4, matching the Tailwind rhythm the design uses.
abstract final class NphSpacing {
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 20.0;
  static const xxl = 24.0;
  static const xxxl = 32.0;

  /// Standard horizontal page padding on phone widths.
  static const page = 20.0;
}

/// Corner radii.
///
/// `--radius: 0.875rem` = 14 px is the design's base, used for cards and
/// inputs. Primary buttons in the approved screens are full pills, not 14 px —
/// see "Send OTP" and "Publish listing" — so [pill] is a distinct token rather
/// than a large radius that might drift.
abstract final class NphRadius {
  static const sm = 8.0;
  static const md = 11.0;
  static const lg = 14.0;
  static const xl = 20.0;
  static const pill = 999.0;

  static const cardBorder = BorderRadius.all(Radius.circular(lg));
  static const fieldBorder = BorderRadius.all(Radius.circular(md));
  static const pillBorder = BorderRadius.all(Radius.circular(pill));
}

/// Font families, bundled as assets rather than fetched at runtime.
///
/// Deliberately not `google_fonts`: that package downloads on first use, so a
/// dealer opening the app on a poor connection — the normal case in this
/// market — would see fallback type until the download completed, and no type
/// at all offline.
abstract final class NphFonts {
  static const body = 'Inter';
  static const heading = 'Manrope';
}
