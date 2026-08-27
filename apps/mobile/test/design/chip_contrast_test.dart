import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:naija_parts_hub/design/theme.dart';

/// Filter chip labels must be readable in both states.
///
/// This is asserted against rendered pixels rather than against the resolved
/// TextStyle, because the bug it guards was invisible to every style-level
/// check. `ChipThemeData.labelStyle` carried no colour, the chip never wrote
/// one into the label's DefaultTextStyle, and both `RichText.text.style.color`
/// and `DefaultTextStyle.of(context).style.color` read null — exactly as they
/// do when everything is fine. The only thing that told the truth was the
/// screen: ten blank pills on the Services step of mechanic sign-up, labels
/// laid out and tappable but painted so they could not be seen.
///
/// So: paint it, and count the pixels.
void main() {
  /// The fraction of interior pixels that differ noticeably from the chip's
  /// own background.
  ///
  /// Interior only — an inset of 6 logical pixels drops the border and the
  /// rounded corners, which would otherwise register as "ink" on a chip whose
  /// label is entirely invisible.
  Future<double> inkFraction(
    WidgetTester tester, {
    required bool selected,
    required Color chipBackground,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildNphTheme(),
        home: Scaffold(
          body: Center(
            child: RepaintBoundary(
              // Keyed. `find.byType(RepaintBoundary).first` picks up an
              // ancestor boundary that spans the whole screen, against which
              // the chip's ink is a rounding error whatever its colour — the
              // measurement passes or fails for the wrong reason.
              key: const Key('chip-boundary'),
              child: FilterChip(
                label: const Text('Engine repair'),
                selected: selected,
                onSelected: (_) {},
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final boundary = tester.renderObject<RenderRepaintBoundary>(
      find.byKey(const Key('chip-boundary')),
    );

    final byteData = await tester.runAsync(() async {
      final image = await boundary.toImage();
      final data = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
      image.dispose();
      return data;
    });

    final pixels = byteData!.buffer.asUint8List();
    final width = boundary.size.width.round();
    final height = boundary.size.height.round();

    const inset = 6;
    var counted = 0;
    var ink = 0;

    for (var y = inset; y < height - inset; y++) {
      for (var x = inset; x < width - inset; x++) {
        final i = (y * width + x) * 4;
        final r = pixels[i];
        final g = pixels[i + 1];
        final b = pixels[i + 2];

        counted++;
        // Manhattan distance from the chip's own background. A label the same
        // colour as what it sits on scores zero here, which is the whole point.
        final distance = (r - (chipBackground.r * 255)).abs() +
            (g - (chipBackground.g * 255)).abs() +
            (b - (chipBackground.b * 255)).abs();
        if (distance > 90) ink++;
      }
    }

    return counted == 0 ? 0 : ink / counted;
  }

  testWidgets('an unselected chip label is visible against the chip', (tester) async {
    // Unselected chips sit on NphColors.card, which is white.
    final fraction = await inkFraction(
      tester,
      selected: false,
      chipBackground: Colors.white,
    );

    expect(
      fraction,
      greaterThan(0.02),
      reason: 'the label is painting the same colour as the chip — '
          'a mechanic sees a blank pill and cannot tell what they are choosing',
    );
  });

  testWidgets('a selected chip label is visible against the orange fill',
      (tester) async {
    final fraction = await inkFraction(
      tester,
      selected: true,
      // NphColors.orange, the selectedColor in _chipTheme.
      chipBackground: const Color(0xFFFF6A00),
    );

    expect(fraction, greaterThan(0.02),
        reason: 'the selected label has vanished into its own fill');
  });
}
