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

  /// Tint behind icon tiles, chips and quota strips.
  ///
  /// The design writes these as Tailwind alpha suffixes, so they are named for
  /// the suffix rather than for where they happen to be used:
  ///   `/5`  — filled OTP boxes, subtle field backgrounds
  ///   `/10` — icon tiles, quota strips, badge backgrounds
  static const orange05 = Color(0x0DFF6A00);
  static const orange10 = Color(0x1AFF6A00);
  static const orange20 = Color(0x33FF6A00);
  static const success10 = Color(0x1A168A45);
  static const warning10 = Color(0x1AD88A00);
  static const error05 = Color(0x0DC9362B);
  static const error10 = Color(0x1AC9362B);

  /// Retained for source compatibility; prefer [orange10].
  static const orangeSubtle = orange10;
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

  /// Standard horizontal page padding.
  ///
  /// The design uses two gutters: `px-6` (24) on auth and onboarding screens,
  /// `px-4` (16) on in-app screens with a bottom nav.
  static const page = 24.0;
  static const appPage = 16.0;
}

/// Corner radii, derived from the design's `--radius: 0.875rem` (14 px).
///
/// Tailwind's scale in `globals.css` is expressed as multiples of that base,
/// so these are the exact computed values rather than rounded guesses:
///   rounded-sm  = radius * 0.6 =  8.4
///   rounded-md  = radius * 0.8 = 11.2
///   rounded-lg  = radius       = 14
///   rounded-xl  = radius * 1.4 = 19.6
///   rounded-2xl = radius * 1.8 = 25.2
abstract final class NphRadius {
  static const sm = 8.4;
  static const md = 11.2;
  static const lg = 14.0;
  static const xl = 19.6;
  static const xxl = 25.2;
  static const pill = 999.0;

  /// Cards in the approved screens are `rounded-2xl`, not the 14 px base.
  static const cardBorder = BorderRadius.all(Radius.circular(xxl));

  /// Inputs and buttons are both `rounded-xl`.
  static const fieldBorder = BorderRadius.all(Radius.circular(xl));
  static const buttonBorder = BorderRadius.all(Radius.circular(xl));
  static const pillBorder = BorderRadius.all(Radius.circular(pill));
}

/// Control heights measured from the design's padding classes.
///
/// `py-3.5` + `text-sm` line-height lands at roughly 48 px, which is also the
/// Material minimum tap target — the two agree, so there is no trade-off.
abstract final class NphSize {
  static const buttonHeight = 48.0;
  static const buttonHeightCompact = 44.0;
  static const buttonHeightSmall = 40.0;
  static const fieldHeight = 44.0;
  static const otpBox = 48.0;
  static const navIcon = 20.0;
  static const fabDiameter = 56.0;
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
