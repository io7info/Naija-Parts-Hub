import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:naija_parts_hub/design/theme.dart';
import 'package:naija_parts_hub/features/shell/main_shell.dart';
import 'package:naija_parts_hub/models/store.dart';

import '../support/test_providers.dart';

/// Layout across screen sizes and text scales.
///
/// A RenderFlex overflow is not cosmetic here. When layout fails, the ancestor
/// subtree is left un-laid-out, hit testing throws, and Flutter drops the
/// pointer event — so the whole screen silently stops responding to touch while
/// still looking almost right. That exact failure shipped once already, from a
/// TextButton whose theme demanded infinite width.
///
/// `tester.takeException()` is the assertion that matters: an overflow is
/// reported as a caught exception, so a test that only checks `find.text` will
/// pass over a broken layout.
const _sizes = <String, Size>{
  '320dp small Android': Size(320, 640),
  '360dp common Android': Size(360, 760),
  '400dp Medium Phone': Size(400, 900),
  '600dp small tablet': Size(600, 960),
  '834dp tablet': Size(834, 1112),
};

Store _store({int activeListingCount = 8}) => Store(
      storeId: 'dealer-1',
      // Deliberately long: a short name hides the overflow this file exists to
      // catch.
      businessName: 'Ladipo Auto Spares and Heavy Equipment Parts Limited',
      ownerName: 'Tinuoye Oluwaseun Adeyemi',
      phone: '+2349053114741',
      whatsapp: '+2349053114741',
      cacNumber: 'RC-1846352',
      address: '50 Ladipo Market Road, Off Oshodi-Apapa Expressway',
      state: 'Lagos',
      city: 'Mushin',
      description: 'Genuine and quality-grade parts.',
      slug: 'ladipo-auto-spares-and-heavy-equipment',
      status: StoreStatus.approved,
      visible: true,
      activeListingCount: activeListingCount,
      subscription: const Subscription(plan: 'free', status: 'none'),
    );

Widget _app() => ProviderScope(
      overrides: commonOverrides(),
      child: MaterialApp(theme: buildNphTheme(), home: MainShell(store: _store())),
    );

void main() {
  void setSurface(WidgetTester tester, Size size, {double textScale = 1.0}) {
    final view = tester.view;
    view.devicePixelRatio = 1.0;
    view.physicalSize = size;
    tester.platformDispatcher.textScaleFactorTestValue = textScale;
  }

  tearDown(() {
    final binding = TestWidgetsFlutterBinding.ensureInitialized();
    binding.platformDispatcher.views.first
      ..resetPhysicalSize()
      ..resetDevicePixelRatio();
    binding.platformDispatcher.clearTextScaleFactorTestValue();
    WidgetController.hitTestWarningShouldBeFatal = false;
  });

  group('shell lays out cleanly at every size', () {
    for (final entry in _sizes.entries) {
      testWidgets(entry.key, (tester) async {
        setSurface(tester, entry.value);

        await tester.pumpWidget(_app());
        await tester.pumpAndSettle();

        expect(tester.takeException(), isNull,
            reason: 'layout overflowed at ${entry.value}');

        // Every tab must remain reachable, not merely present.
        for (final label in ['Home', 'Listings', 'My Store', 'Account']) {
          expect(
            find.descendant(of: find.byType(NphBottomNav), matching: find.text(label))
                .hitTestable(),
            findsOneWidget,
            reason: '$label is not tappable at ${entry.value}',
          );
        }
      });
    }
  });

  /// Opens [tab] and asserts the pane laid out cleanly.
  ///
  /// The tap is made fatal-on-miss deliberately. By default a tap that lands on
  /// a widget other than the one found is only a console warning, so this
  /// helper would go green having never switched panes at all — which is
  /// exactly what happened when the raised Add button's label outgrew its slot
  /// at 2.0x and covered its neighbours.
  Future<void> expectPaneLaysOut(WidgetTester tester, String tab, String where) async {
    await tester.pumpWidget(_app());
    await tester.pumpAndSettle();

    final target =
        find.descendant(of: find.byType(NphBottomNav), matching: find.text(tab));
    expect(target.hitTestable(), findsOneWidget,
        reason: '$tab cannot receive a tap $where');

    WidgetController.hitTestWarningShouldBeFatal = true;
    await tester.tap(target);
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull, reason: '$tab overflowed $where');
  }

  const panes = ['Listings', 'Add Listing', 'My Store', 'Account'];

  group('every pane survives the extremes', () {
    // 320dp is the narrowest Android in real use; 834dp is a tablet in portrait.
    // Both directions matter: narrow screens overflow, wide ones stretch rows
    // until a Row's children stop making sense next to each other.
    const bounds = <String, Size>{
      '320dp handset': Size(320, 640),
      '834dp tablet': Size(834, 1112),
    };

    for (final bound in bounds.entries) {
      for (final tab in panes) {
        testWidgets('$tab on a ${bound.key}', (tester) async {
          setSurface(tester, bound.value);
          await expectPaneLaysOut(tester, tab, 'on a ${bound.key}');
        });
      }
    }
  });

  group('every pane survives 2.0x text', () {
    for (final tab in panes) {
      testWidgets('$tab at 2.0x on a 360dp handset', (tester) async {
        setSurface(tester, const Size(360, 760), textScale: 2.0);
        await expectPaneLaysOut(tester, tab, 'at textScaleFactor 2.0');
      });
    }
  });

  group('large text scaling', () {
    // Android allows up to 2.0 in accessibility settings. A dealer using it is
    // exactly the dealer who cannot afford a screen that stops responding.
    for (final scale in [1.3, 1.6, 2.0]) {
      testWidgets('Home at ${scale}x on a 360dp handset', (tester) async {
        setSurface(tester, const Size(360, 760), textScale: scale);

        await tester.pumpWidget(_app());
        await tester.pumpAndSettle();

        expect(tester.takeException(), isNull,
            reason: 'Home overflowed at textScaleFactor $scale');
      });
    }

    testWidgets('bottom navigation stays tappable at 2.0x', (tester) async {
      setSurface(tester, const Size(360, 760), textScale: 2.0);

      await tester.pumpWidget(_app());
      await tester.pumpAndSettle();

      expect(
        find.descendant(of: find.byType(NphBottomNav), matching: find.text('Account'))
            .hitTestable(),
        findsOneWidget,
      );
    });
  });
}
