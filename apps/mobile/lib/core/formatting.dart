/// Display formatting shared across screens.
///
/// Presentation only — nothing here changes what is stored. Phone numbers are
/// persisted in E.164 because that is what Firebase Auth issues and what
/// `wa.me` links require; the spacing exists purely so a dealer can read their
/// own number back.
library;

/// `+2349053114741` -> `+234 905 311 4741`.
///
/// Nigerian mobile numbers are the country code plus ten national digits, and
/// are read in 3-3-4 groups. An unspaced fourteen-character run is genuinely
/// hard to check against a SIM card, which is the actual task a dealer is doing
/// when they look at this field.
///
/// Anything that is not a recognisable Nigerian number is returned untouched
/// rather than forced into the pattern: a half-entered or foreign number
/// mangled into 3-3-4 groups looks authoritative and wrong, which is worse than
/// leaving it alone.
String formatNigerianPhone(String raw) {
  final trimmed = raw.trim();
  if (trimmed.isEmpty) return '';

  final digits = trimmed.replaceAll(RegExp(r'[^0-9]'), '');

  // Accept the three forms a dealer's number actually arrives in:
  //   2349053114741  (E.164 without +, 13 digits)
  //   09053114741    (national with trunk 0, 11 digits)
  //   9053114741     (national without trunk 0, 10 digits)
  String? national;
  if (digits.length == 13 && digits.startsWith('234')) {
    national = digits.substring(3);
  } else if (digits.length == 11 && digits.startsWith('0')) {
    national = digits.substring(1);
  } else if (digits.length == 10) {
    national = digits;
  }

  if (national == null) return trimmed;

  return '+234 ${national.substring(0, 3)} ${national.substring(3, 6)} '
      '${national.substring(6)}';
}

/// Digits only, for `wa.me` and `tel:` links.
///
/// wa.me rejects '+' and spaces, so the display form can never be passed
/// straight through — hence a separate function rather than a trim at the call
/// site, which is where that mistake gets made.
String phoneDigits(String raw) => raw.replaceAll(RegExp(r'[^0-9]'), '');

/// "3 days ago" — relative, because what a dealer judges is freshness, not the
/// calendar date. Mirrors `postedLabel` in the web app so the two surfaces
/// describe the same listing the same way.
String relativeTime(DateTime? when) {
  if (when == null) return 'Recently';

  final days = DateTime.now().difference(when).inDays;
  if (days <= 0) return 'Today';
  if (days == 1) return 'Yesterday';
  if (days < 7) return '$days days ago';
  if (days < 30) {
    final weeks = days ~/ 7;
    return weeks == 1 ? '1 week ago' : '$weeks weeks ago';
  }
  if (days < 365) {
    final months = days ~/ 30;
    return months == 1 ? '1 month ago' : '$months months ago';
  }
  final years = days ~/ 365;
  return years == 1 ? '1 year ago' : '$years years ago';
}
