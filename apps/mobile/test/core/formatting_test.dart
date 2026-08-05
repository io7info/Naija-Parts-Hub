import 'package:flutter_test/flutter_test.dart';
import 'package:naija_parts_hub/core/formatting.dart';

void main() {
  group('formatNigerianPhone', () {
    test('groups an E.164 number the way a dealer reads it back', () {
      // The form a Firebase Auth token actually carries.
      expect(formatNigerianPhone('+2349053114741'), '+234 905 311 4741');
    });

    test('accepts the trunk-0 form Nigerians type', () {
      expect(formatNigerianPhone('09053114741'), '+234 905 311 4741');
    });

    test('accepts a bare national number', () {
      expect(formatNigerianPhone('9053114741'), '+234 905 311 4741');
    });

    test('is idempotent — formatting an already-formatted number is a no-op', () {
      // Screens re-render constantly; a format that drifted on each pass would
      // corrupt the display without anything obviously failing.
      const once = '+234 905 311 4741';
      expect(formatNigerianPhone(once), once);
    });

    test('leaves an unrecognised number alone rather than forcing the pattern', () {
      // A half-typed or foreign number mangled into 3-3-4 groups looks
      // authoritative and is wrong, which is worse than leaving it be.
      expect(formatNigerianPhone('+1 415 555 0100'), '+1 415 555 0100');
      expect(formatNigerianPhone('12345'), '12345');
    });

    test('empty stays empty rather than becoming a bare country code', () {
      expect(formatNigerianPhone(''), '');
      expect(formatNigerianPhone('   '), '');
    });
  });

  group('phoneDigits', () {
    test('strips everything wa.me and tel: reject', () {
      // wa.me refuses '+' and spaces, so the display form can never be passed
      // straight through — this is the function that stops that mistake.
      expect(phoneDigits('+234 905 311 4741'), '2349053114741');
      expect(phoneDigits('0905-311-4741'), '09053114741');
    });
  });

  group('relativeTime', () {
    test('null reads as Recently, never as the epoch', () {
      // Server timestamps are null until a write syncs. Treating that as 1970
      // would label a listing created seconds ago "55 years ago".
      expect(relativeTime(null), 'Recently');
    });

    test('describes the recent past the way a dealer would', () {
      final now = DateTime.now();
      expect(relativeTime(now), 'Today');
      expect(relativeTime(now.subtract(const Duration(days: 1))), 'Yesterday');
      expect(relativeTime(now.subtract(const Duration(days: 3))), '3 days ago');
      expect(relativeTime(now.subtract(const Duration(days: 8))), '1 week ago');
      expect(relativeTime(now.subtract(const Duration(days: 20))), '2 weeks ago');
    });

    test('singular and plural are not mixed up', () {
      final now = DateTime.now();
      expect(relativeTime(now.subtract(const Duration(days: 35))), '1 month ago');
      expect(relativeTime(now.subtract(const Duration(days: 70))), '2 months ago');
      expect(relativeTime(now.subtract(const Duration(days: 400))), '1 year ago');
    });
  });
}
