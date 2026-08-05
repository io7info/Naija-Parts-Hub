import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'tokens.dart';

/// The Naija Parts Hub theme.
///
/// Colours are set explicitly rather than derived. The previous theme used
/// `ColorScheme.fromSeed(seedColor: kOrange)`, which treats the brand colour as
/// a seed for Material 3's tonal algorithm — producing a rust-brown primary
/// instead of #ff6a00. A brand colour is a specification, not a hint.
ThemeData buildNphTheme() {
  const scheme = ColorScheme(
    brightness: Brightness.light,
    primary: NphColors.orange,
    onPrimary: Colors.white,
    secondary: NphColors.dark,
    onSecondary: Colors.white,
    error: NphColors.error,
    onError: Colors.white,
    surface: NphColors.background,
    onSurface: NphColors.foreground,
    surfaceContainerHighest: NphColors.muted,
    outline: NphColors.border,
  );

  final base = ThemeData(useMaterial3: true, colorScheme: scheme);

  return base.copyWith(
    scaffoldBackgroundColor: NphColors.background,
    textTheme: _textTheme(base.textTheme),
    appBarTheme: _appBarTheme(),
    elevatedButtonTheme: _primaryButtonTheme(),
    filledButtonTheme: _filledButtonTheme(),
    outlinedButtonTheme: _outlinedButtonTheme(),
    textButtonTheme: _textButtonTheme(),
    inputDecorationTheme: _inputTheme(),
    cardTheme: _cardTheme(),
    dividerTheme: const DividerThemeData(color: NphColors.border, thickness: 1, space: 1),
    chipTheme: _chipTheme(),
    snackBarTheme: _snackBarTheme(),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: NphColors.orange),
    bottomNavigationBarTheme: _bottomNavTheme(),
  );
}

/// Manrope for headings, Inter for everything else — as in the approved design.
TextTheme _textTheme(TextTheme base) {
  const heading = TextStyle(
    fontFamily: NphFonts.heading,
    color: NphColors.foreground,
    height: 1.2,
  );
  const body = TextStyle(
    fontFamily: NphFonts.body,
    color: NphColors.foreground,
    height: 1.45,
  );

  return base.copyWith(
    displayLarge: heading.copyWith(fontSize: 34, fontWeight: FontWeight.w800, letterSpacing: -0.5),
    displayMedium: heading.copyWith(fontSize: 30, fontWeight: FontWeight.w800, letterSpacing: -0.4),
    headlineLarge: heading.copyWith(fontSize: 28, fontWeight: FontWeight.w700, letterSpacing: -0.3),
    headlineMedium: heading.copyWith(fontSize: 24, fontWeight: FontWeight.w700, letterSpacing: -0.2),
    headlineSmall: heading.copyWith(fontSize: 20, fontWeight: FontWeight.w700),
    titleLarge: heading.copyWith(fontSize: 18, fontWeight: FontWeight.w700),
    titleMedium: heading.copyWith(fontSize: 16, fontWeight: FontWeight.w600),
    titleSmall: body.copyWith(fontSize: 14, fontWeight: FontWeight.w600),
    bodyLarge: body.copyWith(fontSize: 16),
    bodyMedium: body.copyWith(fontSize: 14),
    bodySmall: body.copyWith(fontSize: 12, color: NphColors.mutedForeground),
    labelLarge: body.copyWith(fontSize: 15, fontWeight: FontWeight.w600),
    labelMedium: body.copyWith(fontSize: 13, fontWeight: FontWeight.w600),
    labelSmall: body.copyWith(fontSize: 11, color: NphColors.mutedForeground),
  );
}

AppBarTheme _appBarTheme() => const AppBarTheme(
      backgroundColor: NphColors.background,
      foregroundColor: NphColors.foreground,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontFamily: NphFonts.heading,
        fontSize: 18,
        fontWeight: FontWeight.w700,
        color: NphColors.foreground,
      ),
      systemOverlayStyle: SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
      ),
    );

/// Primary actions are `rounded-xl` (19.6 px) at roughly 48 px tall.
///
/// An earlier version of this file rendered them as full pills, citing the
/// approved screens. That was wrong, and the comment is what kept it wrong.
/// Counting every orange button in the design pack: eleven of twelve are
/// `rounded-xl ... py-3.5`, and the single `rounded-full` one is the floating
/// action button on My Listings, which is a FAB and correctly round. Even
/// "Verify and Continue" — named in the old comment as evidence for pills — is
/// literally `rounded-xl bg-orange py-3.5`.
///
/// Type is `text-sm font-semibold`: 14 px at w600, not 16 px at w700.
ButtonStyle _buttonStyle({
  required Color background,
  required Color foreground,
  Color? pressed,
  BorderSide? side,
}) =>
    ButtonStyle(
      backgroundColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.disabled)) {
          // The design disables with opacity, not a different colour, so the
          // control keeps its shape and the change reads as "not yet" rather
          // than as a separate style.
          return background.withValues(alpha: 0.50);
        }
        if (states.contains(WidgetState.pressed)) return pressed ?? background;
        return background;
      }),
      foregroundColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.disabled)) {
          return foreground.withValues(alpha: 0.60);
        }
        return foreground;
      }),
      overlayColor: const WidgetStatePropertyAll(Colors.transparent),
      elevation: const WidgetStatePropertyAll(0),
      // Size.fromHeight leaves width at double.infinity, which is the standard
      // idiom for "fill the parent" and is what the design wants for primary
      // CTAs — they are always full-width blocks.
      //
      // The constraint that comes with it: a button styled this way must never
      // be a bare child of a Row, which hands down an unbounded width. It will
      // demand infinite width, layout will fail, and the un-laid-out ancestor
      // makes hit testing throw — killing touch across the whole screen rather
      // than just breaking one button. Wrap it in Expanded or Flexible, or give
      // it an explicit minimumSize via styleFrom.
      minimumSize: const WidgetStatePropertyAll(Size.fromHeight(NphSize.buttonHeight)),
      padding: const WidgetStatePropertyAll(
        EdgeInsets.symmetric(horizontal: NphSpacing.lg),
      ),
      shape: WidgetStatePropertyAll(
        RoundedRectangleBorder(borderRadius: NphRadius.buttonBorder, side: side ?? BorderSide.none),
      ),
      textStyle: const WidgetStatePropertyAll(
        TextStyle(fontFamily: NphFonts.body, fontSize: 14, fontWeight: FontWeight.w600),
      ),
    );

ElevatedButtonThemeData _primaryButtonTheme() => ElevatedButtonThemeData(
      style: _buttonStyle(
        background: NphColors.orange,
        foreground: Colors.white,
        pressed: NphColors.orangeHover,
      ),
    );

FilledButtonThemeData _filledButtonTheme() => FilledButtonThemeData(
      style: _buttonStyle(
        background: NphColors.orange,
        foreground: Colors.white,
        pressed: NphColors.orangeHover,
      ),
    );

/// Secondary action: bordered, card-coloured, same geometry as primary.
OutlinedButtonThemeData _outlinedButtonTheme() => OutlinedButtonThemeData(
      style: _buttonStyle(
        background: NphColors.card,
        foreground: NphColors.foreground,
        pressed: NphColors.muted,
        side: const BorderSide(color: NphColors.border),
      ),
    );

/// Tertiary action — orange text, no background, no border. The design uses it
/// for "Resend Code", "Sign In" and "Register a New Store".
///
/// minimumSize is `Size(48, 40)`, NOT `Size.fromHeight(40)`.
///
/// `Size.fromHeight` leaves width at **double.infinity**, which reads as "fill
/// the parent" only where the parent hands down a bounded width. A TextButton
/// is an inline control — the moment one sits in a Row beside other children it
/// demands infinite width and layout fails with
///
///   BoxConstraints forces an infinite width.
///
/// That is not a local failure: the ancestor subtree is left un-laid-out, so
/// hit testing throws, the pointer event is dropped, and the *entire screen*
/// stops responding to touch while still looking fine. 48x40 keeps a
/// comfortable tap target without constraining width at all.
TextButtonThemeData _textButtonTheme() => const TextButtonThemeData(
      style: ButtonStyle(
        foregroundColor: WidgetStatePropertyAll(NphColors.orange),
        overlayColor: WidgetStatePropertyAll(Colors.transparent),
        minimumSize: WidgetStatePropertyAll(Size(48, 40)),
        textStyle: WidgetStatePropertyAll(
          TextStyle(fontFamily: NphFonts.body, fontSize: 14, fontWeight: FontWeight.w600),
        ),
      ),
    );

/// Fields are `rounded-xl` outlined boxes on white with a muted placeholder,
/// padded `px-3 py-2.5` — matching the phone-number and part-name inputs.
InputDecorationTheme _inputTheme() {
  OutlineInputBorder border(Color color, [double width = 1]) => OutlineInputBorder(
        borderRadius: NphRadius.fieldBorder,
        borderSide: BorderSide(color: color, width: width),
      );

  return InputDecorationTheme(
    filled: true,
    fillColor: NphColors.card,
    contentPadding: const EdgeInsets.symmetric(
      horizontal: NphSpacing.md,
      vertical: NphSpacing.md,
    ),
    border: border(NphColors.border),
    enabledBorder: border(NphColors.border),
    focusedBorder: border(NphColors.orange, 1.5),
    errorBorder: border(NphColors.error),
    focusedErrorBorder: border(NphColors.error, 1.5),
    disabledBorder: border(NphColors.border.withValues(alpha: 0.5)),
    hintStyle: const TextStyle(
      fontFamily: NphFonts.body,
      fontSize: 14,
      color: NphColors.mutedForeground,
    ),
    // The design labels fields ABOVE the box rather than floating inside, so
    // floating labels are disabled and screens render their own label text.
    floatingLabelBehavior: FloatingLabelBehavior.never,
    labelStyle: const TextStyle(
      fontFamily: NphFonts.body,
      fontSize: 14,
      color: NphColors.mutedForeground,
    ),
    errorStyle: const TextStyle(
      fontFamily: NphFonts.body,
      fontSize: 12,
      color: NphColors.error,
    ),
  );
}

CardThemeData _cardTheme() => const CardThemeData(
      color: NphColors.card,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: NphRadius.cardBorder,
        side: BorderSide(color: NphColors.border),
      ),
    );

/// Filter chips are pills — `rounded-full border px-3 py-1.5 text-xs`. Pills
/// are correct *here*; they are not correct for buttons. See _buttonStyle.
ChipThemeData _chipTheme() => const ChipThemeData(
      backgroundColor: NphColors.card,
      selectedColor: NphColors.orange,
      labelStyle: TextStyle(
        fontFamily: NphFonts.body,
        fontSize: 12,
        fontWeight: FontWeight.w600,
      ),
      side: BorderSide(color: NphColors.border),
      shape: RoundedRectangleBorder(borderRadius: NphRadius.pillBorder),
      padding: EdgeInsets.symmetric(horizontal: NphSpacing.md, vertical: 6),
    );

SnackBarThemeData _snackBarTheme() => const SnackBarThemeData(
      backgroundColor: NphColors.softBlack,
      contentTextStyle: TextStyle(
        fontFamily: NphFonts.body,
        fontSize: 14,
        color: Colors.white,
      ),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: NphRadius.fieldBorder),
    );

BottomNavigationBarThemeData _bottomNavTheme() => const BottomNavigationBarThemeData(
      backgroundColor: NphColors.background,
      selectedItemColor: NphColors.orange,
      unselectedItemColor: NphColors.mutedForeground,
      type: BottomNavigationBarType.fixed,
      elevation: 0,
      showUnselectedLabels: true,
      selectedLabelStyle: TextStyle(fontFamily: NphFonts.body, fontSize: 11, fontWeight: FontWeight.w600),
      unselectedLabelStyle: TextStyle(fontFamily: NphFonts.body, fontSize: 11),
    );
