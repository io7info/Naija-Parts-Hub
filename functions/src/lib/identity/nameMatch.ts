/**
 * How closely a submitted name matches the government record.
 *
 * WHY NOT EXACT COMPARISON
 *
 * Nigerian identity records disagree with what people type, constantly and
 * innocently:
 *
 *   - name order differs — "Adeoye Rafiu Sanusi" against "Rafiu Sanusi Adeoye"
 *   - middle names are dropped on one side and not the other
 *   - a married name appears on one record and not the other
 *   - NIMC records carry transliterations and the odd typo
 *   - people type "Mohammed" where the record says "Muhammad"
 *
 * Exact matching would reject most honest mechanics while catching no fraud
 * worth the name — someone impersonating another person has that person's
 * documents and would type their name correctly.
 *
 * SO: token-set overlap, order-independent, measured against the SHORTER name.
 *
 * Measuring against the shorter set is the important detail. "Rafiu Adeoye"
 * against "Rafiu Sanusi Adeoye" is two of two tokens matched — a dropped
 * middle name scores 1.0 rather than 0.67, because dropping one is normal and
 * proves nothing. Substituting one, which does matter, still fails: "Rafiu
 * Bello" against "Rafiu Sanusi Adeoye" scores 0.5.
 *
 * A score below IDENTITY_NAME_MATCH_THRESHOLD sends the application to
 * `manual_review` rather than rejecting it. An administrator looking at the
 * two names can resolve in seconds what no threshold can.
 */

/**
 * Reduces a name to comparable tokens.
 *
 * Strips diacritics (Nigerian records are inconsistent about them), drops
 * punctuation and honorifics, and discards single characters — a middle
 * initial carries no signal and would otherwise count as a whole token,
 * distorting a two-token name.
 */
export function nameTokens(raw: string): string[] {
  const HONORIFICS = new Set(['mr', 'mrs', 'miss', 'ms', 'dr', 'engr', 'alhaji', 'alhaja', 'chief', 'prof']);

  return (raw ?? '')
    .normalize('NFD')
    // Combining marks, so "Adéyemí" and "Adeyemi" are the same word.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !HONORIFICS.has(t));
}

/**
 * 0 to 1. The proportion of the shorter name's tokens present in the longer.
 *
 * Returns 0 when either side has no usable tokens: an empty comparison is not
 * a match, and returning 1 for "no data on both sides" would let a provider
 * that returned no name at all silently pass verification.
 */
export function nameMatchScore(submitted: string, verified: string): number {
  const a = nameTokens(submitted);
  const b = nameTokens(verified);
  if (a.length === 0 || b.length === 0) return 0;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const pool = new Set(longer);
  const matched = shorter.filter((t) => pool.has(t)).length;

  return matched / shorter.length;
}
