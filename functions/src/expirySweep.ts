import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FREE_ACTIVE_LISTING_LIMIT, type Listing, type Store } from '@nph/contracts';
import { COL, FieldValue, Timestamp, db } from './lib/admin';
import {
  fromStore,
  listingsToUnpublish,
  statusAt,
  toInstant,
  type Instant,
} from './lib/subscription';

/**
 * Nightly subscription expiry (SOW §8, "subscription-expiration handling").
 *
 * A scheduled job rather than a trigger, because expiry is the absence of an
 * event: nothing is written when a subscription lapses, so there is nothing for
 * a Firestore trigger to fire on. Entitlement checks derive status from
 * `expiresAt` and are therefore always correct on their own — but the
 * *marketplace* cannot be, because `publiclyVisible` is a stored field. Without
 * this job a lapsed dealer's 200 listings would stay on the public site
 * indefinitely.
 *
 * Two transitions, per the rules the client confirmed:
 *
 *   active -> grace    at expiresAt. Nothing else changes; listings stay live
 *                      for 7 days so a dealer who is a day late does not lose
 *                      their shelf.
 *   grace  -> expired  at graceEndsAt. The 10 most recently published listings
 *                      survive; the rest return to draft.
 *
 * Draft, not archived: drafts do not count toward the limit (SOW §5) and the
 * dealer republishes them the moment they renew. Archived reads as deleted.
 *
 * Runs at 02:00 Africa/Lagos — after midnight so a plan bought on the 1st gets
 * its full final day, and off-peak so a dealer never watches their catalogue
 * change while they are working in it.
 */

/** How many stores one run will touch. Phase 1 volumes are far below this. */
const MAX_STORES_PER_RUN = 500;

export type SweepResult = {
  movedToGrace: string[];
  expired: string[];
  unpublished: number;
};

/**
 * The sweep itself, as a plain function of the database and the current time.
 *
 * Separated from the schedule so it can be tested by calling it with a fixed
 * `now` against the emulator. Firing a real scheduled trigger in a test means
 * either waiting for a cron or reaching into the emulator's internals, and both
 * make the test about the harness rather than about expiry.
 */
export async function runExpirySweep(now: Instant = Date.now()): Promise<SweepResult> {
  const result: SweepResult = { movedToGrace: [], expired: [], unpublished: 0 };

  // Only stores that have ever paid can lapse. A `plan != 'free'` inequality
  // would need its own index; two equality reads do not, and there are exactly
  // two paid plans.
  const snapshots = await Promise.all(
    (['monthly', 'yearly'] as const).map((plan) =>
      db
        .collection(COL.stores)
        .where('subscription.plan', '==', plan)
        .limit(MAX_STORES_PER_RUN)
        .get(),
    ),
  );

  for (const doc of snapshots.flatMap((s) => s.docs)) {
    const store = doc.data() as Store;
    const sub = fromStore(store);
    const desired = statusAt(sub, now);

    if (desired === sub.status) continue; // already correct

    if (desired === 'grace') {
      await doc.ref.update({ 'subscription.status': 'grace', updatedAt: Timestamp.now() });
      result.movedToGrace.push(doc.id);
      continue;
    }

    if (desired === 'expired') {
      const unpublished = await downgradeToFree(doc.id);
      result.expired.push(doc.id);
      result.unpublished += unpublished;
    }
  }

  return result;
}

/**
 * Returns a lapsed store to the free allowance.
 *
 * The listing writes are deliberately not batched. A batch is atomic, so one
 * listing deleted between the read and the commit fails the whole thing — and
 * the store would be left marked `expired` with all 200 listings still public,
 * which is the exact opposite of what this function is for. They are
 * independent writes and a vanished document is simply skipped.
 *
 * `activeListingCount` is set from what actually remains rather than
 * decremented, because a decrement compounds any earlier drift, and this is the
 * number the publish transaction trusts to enforce the limit.
 */
async function downgradeToFree(storeId: string): Promise<number> {
  const active = await db
    .collection(COL.listings)
    .where('storeId', '==', storeId)
    .where('status', '==', 'active')
    .get();

  const ids = listingsToUnpublish(
    active.docs.map((d) => {
      const listing = d.data() as Listing;
      return {
        id: d.id,
        publishedAt: toInstant(listing.publishedAt),
        createdAt: toInstant(listing.createdAt),
      };
    }),
    FREE_ACTIVE_LISTING_LIMIT,
  );

  const results = await Promise.allSettled(
    ids.map((id) =>
      db.collection(COL.listings).doc(id).update({
        status: 'draft',
        // Set here as well as by the trigger: the trigger will recompute it
        // from the new status anyway, but leaving a window where a draft is
        // still flagged public would put unpaid stock on the marketplace for
        // however long the trigger takes.
        publiclyVisible: false,
        publishedAt: null,
        updatedAt: Timestamp.now(),
      }),
    ),
  );

  const unpublished = results.filter((r) => r.status === 'fulfilled').length;
  const skipped = results.length - unpublished;
  if (skipped > 0) {
    console.warn(`expirySweep(${storeId}): ${skipped} listing(s) could not be unpublished.`);
  }

  await db.collection(COL.stores).doc(storeId).update({
    'subscription.status': 'expired',
    activeListingCount: Math.max(0, active.size - unpublished),
    updatedAt: Timestamp.now(),
  });

  await db.collection(COL.adminActions).add({
    action: 'subscription.expired',
    targetId: storeId,
    adminId: 'system',
    reason: `Grace period ended; ${unpublished} listing(s) returned to draft.`,
    timestamp: FieldValue.serverTimestamp(),
  });

  return unpublished;
}

export const sweepExpiredSubscriptions = onSchedule(
  {
    // Hourly, not daily. Entitlement is derived from `expiresAt` and is exact
    // at every instant, so publishing is never wrong — but `publiclyVisible` is
    // a stored field, and only this job clears it. On a daily schedule a lapsed
    // dealer's stock could sit on the public marketplace for up to 24 hours
    // after their grace period ended, which is the one thing paying dealers
    // would notice and object to.
    //
    // The cost is two limited store queries per run: ~1,400 reads a month at
    // Phase 1 volumes, against a free tier of 50,000 a day.
    schedule: 'every 1 hours',
    timeZone: 'Africa/Lagos',
    // One retry: a transient Firestore error should not leave expired dealers
    // live for another hour, and the sweep is idempotent — a second run finds
    // the already-correct stores and skips them.
    retryCount: 1,
  },
  async () => {
    const result = await runExpirySweep();
    console.info(
      `expirySweep: ${result.movedToGrace.length} entered grace, ` +
        `${result.expired.length} expired, ${result.unpublished} listing(s) unpublished.`,
    );
  },
);
