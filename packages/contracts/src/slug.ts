import {
  MAX_SEARCH_TOKENS,
  RESERVED_SLUGS,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
} from './constants';

/**
 * Slug and search-token generation.
 *
 * Pure functions with no Firebase dependency, so Functions, the Next.js app,
 * and the rules test suite all derive identical values. Search tokens are
 * generated server-side only (see listing.ts) — this module is where that
 * generation lives.
 */

/** "Musa & Sons Auto Parts, Ltd." -> "musa-sons-auto-parts-ltd" */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
}

export function isReservedSlug(slug: string): boolean {
  return (RESERVED_SLUGS as readonly string[]).includes(slug);
}

export type SlugRejection = 'too-short' | 'too-long' | 'reserved' | 'invalid-characters';

export function validateSlug(slug: string): SlugRejection | null {
  if (slug.length < SLUG_MIN_LENGTH) return 'too-short';
  if (slug.length > SLUG_MAX_LENGTH) return 'too-long';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return 'invalid-characters';
  if (isReservedSlug(slug)) return 'reserved';
  return null;
}

/**
 * Candidate slugs in preference order: the base, then -2, -3, ...
 * The caller writes `storeSlugs/{slug}` inside a transaction and moves to the
 * next candidate on collision, since Firestore has no unique constraint.
 */
export function slugCandidates(base: string, attempts = 20): string[] {
  const root = slugify(base) || 'store';
  const safe = isReservedSlug(root) ? `${root}-auto` : root;
  return [safe, ...Array.from({ length: attempts - 1 }, (_, i) => `${safe}-${i + 2}`)];
}

/**
 * Prefix tokens powering SOW §7 search ("by product name or part number").
 *
 * Firestore has no full-text index, so we store every prefix of length >= 2
 * for each word and query with `array-contains`. That buys prefix matching
 * ("bra" finds "brake") but NOT typo tolerance or relevance ranking — if
 * those are needed later, this is the seam where Algolia or Typesense slots in.
 */
export function generateSearchTokens(...sources: string[]): string[] {
  const tokens = new Set<string>();

  for (const source of sources) {
    if (!source) continue;

    const words = source
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/[\s-]+/)
      .filter((w) => w.length >= 2);

    for (const word of words) {
      tokens.add(word);
      // Prefixes, capped so a long part number can't dominate the budget.
      for (let i = 2; i < Math.min(word.length, 12); i++) {
        tokens.add(word.slice(0, i));
      }
    }
  }

  // Shortest first: prefixes are the higher-recall tokens, so if the cap
  // truncates, we keep the ones that match the most queries.
  return Array.from(tokens)
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
    .slice(0, MAX_SEARCH_TOKENS);
}
