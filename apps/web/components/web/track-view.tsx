'use client'

import { useEffect, useRef } from 'react'
import { track, type EventParams, type MarketplaceEvent } from '@/lib/analytics'

/**
 * Fires one event when a server-rendered page mounts.
 *
 * Listing and store pages are Server Components — they read Firestore through
 * the Admin SDK and must stay that way — so they cannot call `track` directly.
 * Rendering this alongside their content keeps the page server-rendered while
 * still reporting the view, and confines the client boundary to a component
 * that renders nothing.
 *
 * The ref guard covers React's development-mode double effect invocation,
 * which would otherwise report every listing view twice while testing locally
 * and make the numbers untrustworthy exactly when someone is checking them.
 * A real navigation to another listing unmounts and remounts this, so genuine
 * views are still counted individually.
 */
export function TrackView({
  event,
  params,
}: {
  event: MarketplaceEvent
  params?: EventParams
}) {
  const sent = useRef(false)

  useEffect(() => {
    if (sent.current) return
    sent.current = true
    track(event, params)
    // Intentionally mount-only. `params` is a fresh object literal on every
    // render, so including it would re-fire the event on any parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
