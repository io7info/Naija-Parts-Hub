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

/// Primary actions are full pills in the approved screens — "Send OTP",
/// "Verify and Continue", "Publish listing" — not the 14 px card radius.
ButtonStyle _pillStyle({
  required Color background,
  required Color foreground,
  BorderSide? side,
}) =>
    ButtonStyle(
      backgroundColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.disabled)) return background.withValues(alpha: 0.45);
        if (states.contains(WidgetState.pressed)) return NphColors.orangeHover;
        return background;
      }),
      foregroundColor: WidgetStatePropertyAll(foreground),
      overlayColor: const WidgetStatePropertyAll(Colors.transparent),
      elevation: const WidgetStatePropertyAll(0),
      minimumSize: const WidgetStatePropertyAll(Size.fromHeight(54)),
      shape: WidgetStatePropertyAll(
        RoundedRectangleBorder(borderRadius: NphRadius.pillBorder, side: side ?? BorderSide.none),
      ),
      textStyle: const WidgetStatePropertyAll(
        TextStyle(fontFamily: NphFonts.body, fontSize: 16, fontWeight: FontWeight.w700),
      ),
    );

ElevatedButtonThemeData _primaryButtonTheme() => ElevatedButtonThemeData(
      style: _pillStyle(background: NphColors.orange, foreground: Colors.white),
    );

FilledButtonThemeData _filledButtonTheme() => FilledButtonThemeData(
      style: _pillStyle(background: NphColors.orange, foreground: Colors.white),
    );

OutlinedButtonThemeData _outlinedButtonTheme() => OutlinedButtonThemeData(
      style: _pillStyle(
        background: Colors.transparent,
        foreground: NphColors.foreground,
        side: const BorderSide(color: NphColors.border),
      ).copyWith(
        backgroundColor: const WidgetStatePropertyAll(Colors.transparent),
      ),
    );

TextButtonThemeData _textButtonTheme() => const TextButtonThemeData(
      style: ButtonStyle(
        foregroundColor: WidgetStatePropertyAll(NphColors.orange),
        overlayColor: WidgetStatePropertyAll(Colors.transparent),
        textStyle: WidgetStatePropertyAll(
          TextStyle(fontFamily: NphFonts.body, fontSize: 15, fontWeight: FontWeight.w700),
        ),
      ),
    );

/// Fields are 11 px-radius outlined boxes on white, with a muted placeholder —
/// matching the phone-number and part-name inputs in the approved screens.
InputDecorationTheme _inputTheme() {
  OutlineInputBorder border(Color color, [double width = 1]) => OutlineInputBorder(
        borderRadius: NphRadius.fieldBorder,
        borderSide: BorderSide(color: color, width: width),
      );

  return InputDecorationTheme(
    filled: true,
    fillColor: NphColors.background,
    contentPadding: const EdgeInsets.symmetric(
      horizontal: NphSpacing.lg,
      vertical: NphSpacing.lg,
    ),
    border: border(NphColors.border),
    enabledBorder: border(NphColors.border),
    focusedBorder: border(NphColors.orange, 1.5),
    errorBorder: border(NphColors.error),
    focusedErrorBorder: border(NphColors.error, 1.5),
    disabledBorder: border(NphColors.border.withValues(alpha: 0.5)),
    hintStyle: const TextStyle(
      fontFamily: NphFonts.body,
      fontSize: 15,
      color: NphColors.mutedForeground,
    ),
    // The design labels fields ABOVE the box rather than floating inside, so
    // floating labels are disabled and screens render their own label text.
    floatingLabelBehavior: FloatingLabelBehavior.never,
    labelStyle: const TextStyle(
      fontFamily: NphFonts.body,
      fontSize: 15,
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

ChipThemeData _chipTheme() => const ChipThemeData(
      backgroundColor: NphColors.muted,
      selectedColor: NphColors.orange,
      labelStyle: TextStyle(
        fontFamily: NphFonts.body,
        fontSize: 13,
        fontWeight: FontWeight.w600,
      ),
      side: BorderSide(color: NphColors.border),
      shape: RoundedRectangleBorder(borderRadius: NphRadius.pillBorder),
      padding: EdgeInsets.symmetric(horizontal: NphSpacing.md, vertical: NphSpacing.sm),
    );

SnackBarThemeData _snackBarTheme() => const SnackBarThemeData(
      backgroundColor: NphColors.softBlack,
      contentTextStyle: TextStyle(
        fontFamily: NphFonts.body,
        fontSize: 14,
        color: Colors.white,
      ),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: NphRadius.cardBorder),
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
