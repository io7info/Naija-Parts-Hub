import type { InitializePaymentRequest, PaymentAnalytics } from '@nph/contracts';

/**
 * What a GA4 identifier may look like.
 *
 * Stock gtag.js generates a client id as two dotted integers
 * ('1234567890.1234567890') and a session id as a Unix timestamp, which is
 * what this project produces today. Matching only that exact shape was the
 * first version of this check, and it was a mistake: Google documents
 * `client_id` as an opaque string, and a custom implementation, a server-side
 * tagging setup or a future format change would all produce something valid
 * that we would reject.
 *
 * The failure mode of being too strict is invisible. Every id becomes null,
 * attribution silently stops, and the gap is unrecoverable because these
 * values exist only in the browser at checkout. Being slightly permissive
 * costs nothing by comparison: the point of validation here is to bound what
 * reaches storage, not to re-derive Google's format.
 *
 * So: a bounded run of the characters Google's identifiers actually use. No
 * whitespace, no quotes, no angle brackets, no control characters — nothing
 * that could be awkward in a document admins read in the payments dashboard —
 * and never longer than 64, comfortably above both the ~21 characters gtag
 * produces and the 36 of a UUID.
 */
const GA_IDENTIFIER = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Validates the GA4 identifiers a dealer's browser sent at checkout.
 *
 * Client-supplied and therefore untrusted, but harmless by construction: these
 * are reporting identifiers with no authority. Nothing reads them to decide
 * access, entitlement, plan or amount, so a forged value corrupts one row of
 * the client's analytics and nothing else. They are validated anyway, because
 * an unbounded client-controlled string reaching a stored document is how
 * small problems become large ones later.
 *
 * Anything not matching exactly becomes null — the same result as absence.
 * Null is the expected case for the roughly one dealer in four running a
 * content blocker, and it is the signal that a later server-side `purchase`
 * must not be reported for this payment at all. A Measurement Protocol event
 * without a real client id does not produce an unattributed conversion; it
 * fabricates a new user and a new session. See docs/ANALYTICS.md.
 */
export function gaAttribution(
  input: InitializePaymentRequest['analytics'],
): Pick<PaymentAnalytics, 'clientId' | 'sessionId'> {
  const clientId = input?.clientId;
  const sessionId = input?.sessionId;

  return {
    clientId: typeof clientId === 'string' && GA_IDENTIFIER.test(clientId) ? clientId : null,
    sessionId: typeof sessionId === 'string' && GA_IDENTIFIER.test(sessionId) ? sessionId : null,
  };
}
