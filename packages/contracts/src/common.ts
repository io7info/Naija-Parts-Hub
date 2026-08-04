/**
 * Cross-surface primitives.
 *
 * Three runtimes read these types — Cloud Functions (firebase-admin),
 * Next.js (firebase/firestore web SDK), and the Flutter app (mirrored by
 * hand in Dart). Timestamps are therefore kept structural rather than bound
 * to any one SDK's Timestamp class.
 */

/** Structurally compatible with both admin and web SDK Timestamps. */
export interface Timestamp {
  seconds: number;
  nanoseconds: number;
}

/**
 * Money is stored as an integer number of kobo — never as a float.
 * ₦5,000.00 is 500000. Floating-point naira silently loses precision once
 * totals accumulate, which matters for payment reconciliation.
 */
export type Kobo = number;

export const nairaToKobo = (naira: number): Kobo => Math.round(naira * 100);
export const koboToNaira = (kobo: Kobo): number => kobo / 100;

/** Display helper: 500000 -> "₦5,000". */
export function formatKobo(kobo: Kobo, withDecimals = false): string {
  const naira = koboToNaira(kobo);
  return `₦${naira.toLocaleString('en-NG', {
    minimumFractionDigits: withDecimals ? 2 : 0,
    maximumFractionDigits: withDecimals ? 2 : 0,
  })}`;
}

/** SOW §7: the platform is automotive-only. */
export type ListingCondition = 'new' | 'used';

/** Nigerian states plus the FCT. Used for the §7 location filter. */
export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue',
  'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
  'FCT - Abuja', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina',
  'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo',
  'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
] as const;

export type NigerianState = (typeof NIGERIAN_STATES)[number];
