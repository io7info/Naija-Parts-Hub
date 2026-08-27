'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { httpsCallable } from 'firebase/functions'
import {
  X, MapPin, Phone, FileText, Check, Ban, PauseCircle, PlayCircle,
  Store, Loader2, AlertCircle,
} from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/page-header'
import { StatusBadge } from '@/components/brand/badges'
import { cn } from '@/lib/utils'
import { functions } from '@/lib/firebase-client'
import type { AdminBusiness } from '@/lib/repositories/stores'

const filters = ['pending', 'approved', 'rejected', 'suspended'] as const
type Filter = (typeof filters)[number] | 'all'

type ReviewAction = 'approve' | 'reject' | 'suspend' | 'reactivate'

/** Plain wording for an administrator, not the stored enum. */
const IDENTITY_LABEL: Record<string, string> = {
  verified: 'Verified',
  manual_review: 'Needs manual review — names disagree',
  failed: 'Failed — identifiers not found',
  pending: 'Check in progress',
  unverified: 'Not verified',
}

/**
 * Dealers and mechanics are reviewed against different evidence — a CAC
 * number against verified BVN and NIN — so they are separated here rather
 * than mixed into one queue with a column to squint at.
 */
const TYPES = [
  { id: 'all', label: 'All types' },
  { id: 'parts_dealer', label: 'Parts Dealers' },
  { id: 'mechanic', label: 'Mechanics' },
] as const
type TypeFilter = (typeof TYPES)[number]['id']

export function VerificationClient({ businesses }: { businesses: AdminBusiness[] }) {
  const [filter, setFilter] = useState<Filter>('pending')
  const [type, setType] = useState<TypeFilter>('all')
  const [selected, setSelected] = useState<AdminBusiness | null>(null)

  const rows = businesses
    .filter((b) => (filter === 'all' ? true : b.status === filter))
    .filter((b) => (type === 'all' ? true : b.businessType === type))

  return (
    <div>
      <AdminPageHeader
        title="Business Verification"
        subtitle="Review and approve dealer applications"
      />

      <div className="p-5 sm:p-8">
        <div className="flex flex-wrap gap-2">
          {(['all', ...filters] as Filter[]).map((f) => {
            const count =
              f === 'all' ? businesses.length : businesses.filter((b) => b.status === f).length
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold capitalize transition-colors',
                  filter === f
                    ? 'border-orange bg-orange text-white'
                    : 'border-border bg-card text-foreground hover:border-orange/40',
                )}
              >
                {f}
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[10px]',
                    filter === f ? 'bg-white/20' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {TYPES.map((t) => {
            const count =
              t.id === 'all'
                ? businesses.length
                : businesses.filter((b) => b.businessType === t.id).length
            return (
              <button
                key={t.id}
                onClick={() => setType(t.id)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                  type === t.id
                    ? 'bg-foreground text-white'
                    : 'border border-border bg-card text-foreground hover:border-orange/40',
                )}
              >
                {t.label}
                <span
                  className={cn(
                    'ml-2 rounded-full px-1.5 py-0.5 text-[10px]',
                    type === t.id ? 'bg-white/20' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        <div className="mt-5 overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border bg-warm text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Business Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">CAC / Identity</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-semibold text-foreground">{b.name}</td>
                  <td className="px-4 py-3">
                    <TypeBadge type={b.businessType} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{b.owner}</td>
                  <td className="px-4 py-3 text-xs">
                    {/* One column, because the two are the same thing: the
                        evidence this business is who it claims to be. A
                        dealer proves it with a CAC number, a mechanic with a
                        verified identity. */}
                    {b.businessType === 'mechanic' ? (
                      <IdentityBadge identity={b.identity} />
                    ) : (
                      <span className="font-mono text-muted-foreground">{b.cac}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{b.phone}</td>
                  <td className="px-4 py-3 text-muted-foreground">{b.location}</td>
                  <td className="px-4 py-3 text-muted-foreground">{b.submitted}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setSelected(b)}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-orange/40"
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                    {businesses.length === 0
                      ? 'No dealers have registered yet.'
                      : `No businesses in this category.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && <DetailDrawer business={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function DetailDrawer({
  business,
  onClose,
}: {
  business: AdminBusiness
  onClose: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<ReviewAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reasonFor, setReasonFor] = useState<'reject' | 'suspend' | null>(null)
  const [reason, setReason] = useState('')

  /**
   * All state changes go through the adminReviewStore callable, never a direct
   * write. status, visible, approvedAt and reviewedBy are backend-controlled —
   * the Firestore rules refuse client writes to them, and the callable
   * re-checks the super_admin claim server-side. The browser being signed in as
   * an admin is not, by itself, authorisation.
   */
  async function review(action: ReviewAction) {
    if ((action === 'reject' || action === 'suspend') && !reason.trim()) {
      setReasonFor(action)
      setError('A reason is required — the dealer is shown this text.')
      return
    }

    setBusy(action)
    setError(null)
    try {
      await httpsCallable(functions, 'adminReviewStore')({
        storeId: business.id,
        action,
        reason: reason.trim() || undefined,
      })
      onClose()
      // Re-runs the server component so the table reflects the new status.
      router.refresh()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message.replace(/^FirebaseError:\s*/, ''))
    } finally {
      setBusy(null)
    }
  }

  const isPending = business.status === 'pending'
  const isApproved = business.status === 'approved'
  const isSuspended = business.status === 'suspended'
  const isRejected = business.status === 'rejected'

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-y-auto bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-heading text-lg font-semibold text-foreground">Business Details</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-8 items-center justify-center rounded-full hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-heading text-lg font-semibold text-foreground">{business.name}</h3>
              <p className="text-sm text-muted-foreground">
                {business.activeListingCount} active listing
                {business.activeListingCount === 1 ? '' : 's'}
              </p>
            </div>
            <StatusBadge status={business.status} />
          </div>

          {business.rejectionReason && (
            <p className="rounded-xl border border-error/30 bg-error/5 p-3 text-sm text-error">
              {business.rejectionReason}
            </p>
          )}

          <Section title="Business Information">
            <Row label="Type" value={business.businessType === 'mechanic' ? 'Auto Mechanic' : 'Parts Dealer'} />
            <Row label="Owner / Contact" value={business.owner} />
            <Row
              label="CAC Registration"
              // Optional for mechanics — most independent workshops are not
              // incorporated, and they prove identity with BVN and NIN instead.
              value={business.cac && business.cac !== '—' ? business.cac : business.businessType === 'mechanic' ? 'Not provided (optional)' : '—'}
              mono
            />
            <Row
              label="Description"
              value={business.description || 'No description provided'}
            />
          </Section>

          <Section title="Contact Information">
            <IconRow icon={Phone} value={business.phone} />
            {business.whatsapp && <IconRow icon={Phone} value={`${business.whatsapp} (WhatsApp)`} />}
            <IconRow icon={MapPin} value={business.address} />
          </Section>

          {business.businessType === 'mechanic' && (
            <Section title="Services">
              <Row
                label="Advertised"
                value={business.services.length > 0 ? business.services.join(', ') : 'None selected'}
              />
              <Row label="Workshop photos" value={String(business.photoCount)} />
            </Section>
          )}

          {business.businessType === 'mechanic' && (
            <Section title="Identity Verification">
              {/*
                The evidence an approval rests on. adminReviewStore refuses to
                approve a mechanic who is not 'verified', so this is what makes
                that refusal legible rather than a mysterious error.

                Only the last four digits appear. The full numbers were never
                stored — they existed inside one Cloud Function for the length
                of one provider call — and the fingerprints are for duplicate
                detection, not for reading.
              */}
              {business.identity ? (
                <>
                  <Row label="Status" value={IDENTITY_LABEL[business.identity.status] ?? business.identity.status} />
                  <Row label="BVN" value={business.identity.bvnLast4 ? `••••••• ${business.identity.bvnLast4}` : 'Not submitted'} mono />
                  <Row label="NIN" value={business.identity.ninLast4 ? `••••••• ${business.identity.ninLast4}` : 'Not submitted'} mono />
                  {/* The comparison an administrator resolving a manual review
                      actually has to make: does the government record agree
                      with the name on the application? */}
                  <Row label="Name on record" value={business.identity.verifiedName ?? '—'} />
                  <Row
                    label="Name match"
                    value={
                      business.identity.nameMatch === null
                        ? '—'
                        : business.identity.nameMatch
                          ? 'Matches submitted name'
                          : 'Does NOT match — compare above'
                    }
                  />
                  <Row label="Verified at" value={business.identity.verifiedAt} />
                  <Row label="Attempts" value={String(business.identity.attempts)} />
                  {business.identity.reverificationRequired && (
                    <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                      This mechanic was verified using a fingerprint key that has since been
                      withdrawn. They must verify again before they can be approved — this is a
                      platform action, not a failure on their part.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No identity check has been completed. This mechanic cannot be approved yet.
                </p>
              )}
            </Section>
          )}

          <Section title="Store">
            <IconRow
              icon={Store}
              value={
                business.slug
                  ? `/${business.businessType === 'mechanic' ? 'mechanic' : 'store'}/${business.slug}`
                  : 'No slug'
              }
            />
            <IconRow icon={FileText} value={`Submitted ${business.submitted}`} />
          </Section>

        </div>

        {/*
          The action buttons and everything they produce live together in this
          footer.

          The reason box and the error used to sit at the end of the scrollable
          body while the buttons were pinned here. On a mechanic — whose drawer
          carries a whole extra Identity Verification section — that put both
          below the fold: an administrator pressed Approve on an unverified
          mechanic, the callable refused as designed, and the screen did
          nothing visible. Pressing Reject was worse; the reason box it was
          waiting on was equally out of sight, so the button simply looked
          broken. Feedback has to appear where the control is.
        */}
        <div className="sticky bottom-0 space-y-2 border-t border-border bg-card p-4">
          {reasonFor && (
            <div className="space-y-2 pb-1">
              <label className="block text-sm font-medium text-foreground">
                Reason for {reasonFor} — shown to the dealer
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                autoFocus
                placeholder="e.g. CAC number could not be verified"
                className="w-full rounded-xl border border-border bg-background p-3 text-sm outline-none focus:border-orange"
              />
            </div>
          )}

          {error && (
            <p className="flex gap-2 rounded-xl border border-error/30 bg-error/5 p-3 text-sm text-error">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </p>
          )}

          {(isPending || isRejected) && (
            <div className="flex gap-2">
              <ActionButton
                tone="success"
                icon={Check}
                label="Approve"
                busy={busy === 'approve'}
                disabled={busy !== null}
                onClick={() => review('approve')}
              />
              {isPending && (
                <ActionButton
                  tone="error"
                  icon={Ban}
                  label="Reject"
                  busy={busy === 'reject'}
                  disabled={busy !== null}
                  onClick={() => (reasonFor === 'reject' ? review('reject') : setReasonFor('reject'))}
                />
              )}
            </div>
          )}

          {isApproved && (
            <ActionButton
              tone="error"
              icon={PauseCircle}
              label="Suspend business"
              busy={busy === 'suspend'}
              disabled={busy !== null}
              full
              onClick={() => (reasonFor === 'suspend' ? review('suspend') : setReasonFor('suspend'))}
            />
          )}

          {isSuspended && (
            <ActionButton
              tone="success"
              icon={PlayCircle}
              label="Reactivate business"
              busy={busy === 'reactivate'}
              disabled={busy !== null}
              full
              onClick={() => review('reactivate')}
            />
          )}

          <p className="pt-1 text-center text-[11px] text-muted-foreground">
            Suspending hides the store and all its listings. Nothing is deleted.
          </p>
        </div>
      </div>
    </div>
  )
}

function ActionButton({
  tone, icon: Icon, label, onClick, busy, disabled, full,
}: {
  tone: 'success' | 'error'
  icon: typeof Check
  label: string
  onClick: () => void
  busy: boolean
  disabled: boolean
  full?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-50',
        tone === 'success' ? 'bg-success' : 'bg-error',
        full ? 'w-full' : 'flex-1',
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
      {label}
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      <div className="space-y-2 rounded-xl border border-border bg-warm p-3">{children}</div>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn('text-right text-foreground', mono && 'font-mono text-xs')}>{value}</span>
    </div>
  )
}

function IconRow({ icon: Icon, value }: { icon: typeof Phone; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-foreground">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="break-all">{value}</span>
    </div>
  )
}

/** Which intake this application came through. */
function TypeBadge({ type }: { type: AdminBusiness['businessType'] }) {
  const mechanic = type === 'mechanic'
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold',
        mechanic ? 'bg-blue-50 text-blue-700' : 'bg-orange/10 text-orange',
      )}
    >
      {mechanic ? 'Mechanic' : 'Parts Dealer'}
    </span>
  )
}

/**
 * BVN/NIN verification state for a mechanic.
 *
 * Not decoration: `adminReviewStore` refuses to approve a mechanic whose
 * status is not 'verified', so this explains a button that would otherwise
 * fail with an error the administrator could not act on.
 *
 * Shows the status, and on hover the last four digits of each identifier.
 * The full numbers were never stored, the fingerprints are meaningless here,
 * and neither belongs in a list view.
 */
function IdentityBadge({ identity }: { identity: AdminBusiness['identity'] }) {
  if (!identity) {
    return <span className="text-muted-foreground">Not started</span>
  }

  const tone: Record<string, string> = {
    verified: 'bg-success/10 text-success',
    manual_review: 'bg-amber-50 text-amber-700',
    failed: 'bg-destructive/10 text-destructive',
    pending: 'bg-muted text-muted-foreground',
    unverified: 'bg-muted text-muted-foreground',
  }

  const label: Record<string, string> = {
    verified: 'ID verified',
    manual_review: 'Needs review',
    failed: 'ID failed',
    pending: 'Checking…',
    unverified: identity.reverificationRequired ? 'Re-verify required' : 'Not verified',
  }

  return (
    <span
      title={
        identity.bvnLast4 || identity.ninLast4
          ? `BVN ••••${identity.bvnLast4 ?? '––'} · NIN ••••${identity.ninLast4 ?? '––'}`
          : 'No identity check completed'
      }
      className={cn(
        'inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold',
        tone[identity.status] ?? 'bg-muted text-muted-foreground',
      )}
    >
      {label[identity.status] ?? identity.status}
    </span>
  )
}
