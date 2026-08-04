import { BadgeCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Condition } from '@/lib/marketplace'

export function VerifiedBadge({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-success/10 font-semibold text-success',
        compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs',
        className,
      )}
    >
      <BadgeCheck className={compact ? 'size-3' : 'size-3.5'} />
      Verified
    </span>
  )
}

export function ConditionBadge({ condition, className }: { condition: Condition; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
        condition === 'New'
          ? 'bg-orange/10 text-orange'
          : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {condition}
    </span>
  )
}

type Status = 'active' | 'draft' | 'archived' | 'pending' | 'reported' | 'removed' | 'approved' | 'rejected' | 'suspended'

const statusStyles: Record<Status, string> = {
  active: 'bg-success/10 text-success',
  approved: 'bg-success/10 text-success',
  draft: 'bg-muted text-muted-foreground',
  archived: 'bg-muted text-muted-foreground',
  pending: 'bg-warning/10 text-warning',
  reported: 'bg-warning/10 text-warning',
  removed: 'bg-error/10 text-error',
  rejected: 'bg-error/10 text-error',
  suspended: 'bg-error/10 text-error',
}

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize',
        statusStyles[status],
        className,
      )}
    >
      {status}
    </span>
  )
}
