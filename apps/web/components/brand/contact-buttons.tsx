'use client'

import { Check, Phone, Share2 } from 'lucide-react'
import { useState } from 'react'

import { toE164Digits } from '@/lib/marketplace'
import { cn } from '@/lib/utils'

/**
 * Buyer contact actions.
 *
 * SOW §1: buyers have no account and transact off-platform, so these three
 * actions are the entire conversion path. They were inert `<button>` elements
 * in the design hand-off; they are now real links.
 *
 * Anchors, not onClick handlers: `wa.me` and `tel:` work from the server-
 * rendered HTML with no JavaScript, they can be opened in a new tab, and a
 * long-press offers "copy number" — all of which a button swallows.
 */

function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

type Size = 'sm' | 'md' | 'icon'

const WHATSAPP_BASE =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-whatsapp font-semibold text-white transition-colors hover:brightness-95'
const OUTLINE_BASE =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card font-semibold text-foreground transition-colors hover:bg-muted'

function sizing(size: Size) {
  return size === 'sm' ? 'px-3 py-2 text-sm' : 'px-4 py-3 text-sm'
}

/** A dealer with no number on file cannot be contacted; say so rather than linking nowhere. */
function unavailable(className: string | undefined, base: string, size: Size, children: React.ReactNode) {
  return (
    <span
      aria-disabled="true"
      title="This dealer has not published a contact number"
      className={cn(base, size === 'icon' ? 'size-9 p-0' : sizing(size), 'cursor-not-allowed opacity-40', className)}
    >
      {children}
    </span>
  )
}

export function WhatsAppButton({
  phone,
  message,
  label = 'Chat on WhatsApp',
  className,
  size = 'md',
}: {
  phone?: string
  message?: string
  label?: string
  className?: string
  size?: Size
}) {
  const digits = toE164Digits(phone ?? '')
  const glyph = <WhatsAppGlyph className={size === 'icon' ? 'size-5' : 'size-4'} />

  if (!digits) {
    return unavailable(className, WHATSAPP_BASE, size, glyph)
  }

  // wa.me wants bare international digits — no '+', spaces or dashes.
  const href = `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`

  return (
    <a
      href={href}
      target="_blank"
      // noreferrer as well as noopener: wa.me is a third party and has no need
      // for the referring listing URL.
      rel="noopener noreferrer"
      aria-label={size === 'icon' ? 'Chat on WhatsApp' : undefined}
      className={cn(
        WHATSAPP_BASE,
        size === 'icon' ? 'size-9 p-0' : sizing(size),
        className,
      )}
    >
      {glyph}
      {size !== 'icon' && label}
    </a>
  )
}

export function CallButton({
  phone,
  label = 'Call Seller',
  className,
  size = 'md',
}: {
  phone?: string
  label?: string
  className?: string
  size?: Size
}) {
  const digits = toE164Digits(phone ?? '')
  const icon = <Phone className="size-4" />

  if (!digits) {
    return unavailable(className, OUTLINE_BASE, size, icon)
  }

  return (
    <a
      href={`tel:+${digits}`}
      aria-label={size === 'icon' ? 'Call seller' : undefined}
      className={cn(OUTLINE_BASE, size === 'icon' ? 'size-9 p-0' : sizing(size), className)}
    >
      {icon}
      {size !== 'icon' && label}
    </a>
  )
}

/**
 * Native share sheet, falling back to copying the link.
 *
 * navigator.share exists only in a secure context and mostly on mobile, and it
 * rejects when the user dismisses the sheet — which is not an error and must
 * not surface as one.
 */
export function ShareButton({
  title,
  text,
  label,
  className,
}: {
  title: string
  text?: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  async function share() {
    const url = window.location.href

    if (navigator.share) {
      try {
        await navigator.share({ title, text, url })
        return
      } catch (error) {
        // AbortError means the user closed the sheet deliberately.
        if ((error as Error)?.name === 'AbortError') return
        // Anything else falls through to the clipboard path.
      }
    }

    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard denied — nothing useful left to try, and a thrown error here
      // would be a worse outcome than a button that quietly did nothing.
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      aria-label={label ?? 'Share'}
      className={cn(
        OUTLINE_BASE,
        label ? 'px-3 py-2 text-sm' : 'size-9 p-0',
        className,
      )}
    >
      {copied ? <Check className="size-4 text-success" /> : <Share2 className="size-4" />}
      {label && (copied ? 'Link copied' : label)}
    </button>
  )
}
