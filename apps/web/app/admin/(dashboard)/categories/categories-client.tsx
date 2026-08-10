'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { Loader2, AlertCircle, Plus, Check, X, Pencil } from 'lucide-react'
import { AdminPageHeader } from '@/components/admin/page-header'
import { functions } from '@/lib/firebase-client'
import { cn } from '@/lib/utils'

/**
 * Category management — SOW §9.
 *
 * Every write goes through `adminManageCategory`, which re-verifies the
 * super_admin claim, records the change in `adminActions`, and counts the
 * listings that depend on a category before letting it be switched off. The
 * rules do permit an admin to write this collection directly, so the callable
 * is not about permission — it is about the audit trail and that count existing
 * on the server rather than being a courtesy check in this file.
 *
 * There is no delete button, and that is deliberate rather than unfinished. A
 * category id is copied onto every listing that selects it, and this collection
 * is the only place its display name lives: delete the document and those
 * listings show a bare id, disappear from any filtered view, and cannot be
 * repaired from their own contents. Deactivating removes it from the dealer's
 * picker and the marketplace nav, leaves existing listings working, and can be
 * undone.
 */
export type AdminCategory = {
  id: string
  name: string
  order: number
  active: boolean
  /** Listings referencing this category, and how many of those are published. */
  total: number
  live: number
}

/** Mirrors the callable's ID_PATTERN so the refusal happens before the call. */
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function CategoriesClient({ categories }: { categories: AdminCategory[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftOrder, setDraftOrder] = useState('')
  const [adding, setAdding] = useState(false)
  const [newId, setNewId] = useState('')
  const [newName, setNewName] = useState('')

  async function call(payload: Record<string, unknown>, busyKey: string) {
    setBusyId(busyKey)
    setError(null)
    try {
      await httpsCallable(functions, 'adminManageCategory')(payload)
      // Re-run the server component so the rows reflect what was written,
      // including the usage counts, rather than an optimistic guess.
      router.refresh()
      return true
    } catch (e) {
      const message = (e as { message?: string })?.message
      setError(message || 'Could not save that change.')
      return false
    } finally {
      setBusyId(null)
    }
  }

  async function create() {
    const id = newId.trim().toLowerCase()
    if (!ID_PATTERN.test(id)) {
      setError('An id may contain only lowercase letters, numbers and hyphens.')
      return
    }
    if (!newName.trim()) {
      setError('Give the category a display name.')
      return
    }
    // Appended, not inserted: order is a small integer an administrator can
    // edit afterwards, and guessing a position here would reshuffle the nav.
    const order = Math.max(0, ...categories.map((c) => c.order)) + 1
    if (await call({ action: 'create', categoryId: id, name: newName.trim(), order }, 'new')) {
      setAdding(false)
      setNewId('')
      setNewName('')
    }
  }

  async function saveEdit(category: AdminCategory) {
    const order = Number(draftOrder)
    if (!draftName.trim()) {
      setError('A category needs a display name.')
      return
    }
    if (!Number.isFinite(order)) {
      setError('Order must be a number.')
      return
    }
    if (
      await call(
        { action: 'update', categoryId: category.id, name: draftName.trim(), order },
        category.id,
      )
    ) {
      setEditingId(null)
    }
  }

  const sorted = [...categories].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))

  return (
    <div>
      <AdminPageHeader
        title="Categories"
        subtitle="The taxonomy dealers file parts under and buyers browse by"
        action={
          <button
            type="button"
            onClick={() => {
              setAdding((v) => !v)
              setError(null)
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-orange px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-hover"
          >
            <Plus className="size-4" />
            Add category
          </button>
        }
      />

      <div className="p-5 sm:p-8">
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {adding && (
          <div className="mb-6 rounded-2xl border border-border bg-card p-4">
            <h2 className="font-heading text-sm font-semibold text-foreground">New category</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              The id is written onto every listing that uses it and can never be changed. The name
              can be edited at any time.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Id</span>
                <input
                  value={newId}
                  onChange={(e) => setNewId(e.target.value)}
                  placeholder="e.g. cooling"
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-orange"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Display name</span>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Cooling"
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-orange"
                />
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={create}
                disabled={busyId === 'new'}
                className="inline-flex items-center gap-2 rounded-xl bg-orange px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busyId === 'new' && <Loader2 className="size-4 animate-spin" />}
                Create
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 font-semibold">Id</th>
                <th className="px-4 py-3 font-semibold">Order</th>
                <th className="px-4 py-3 font-semibold">Listings</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const editing = editingId === c.id
                const busy = busyId === c.id
                return (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      {editing ? (
                        <input
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-orange"
                        />
                      ) : (
                        <span className="font-medium text-foreground">{c.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c.id}</td>
                    <td className="px-4 py-3">
                      {editing ? (
                        <input
                          value={draftOrder}
                          onChange={(e) => setDraftOrder(e.target.value.replace(/\D/g, ''))}
                          inputMode="numeric"
                          className="w-16 rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-orange"
                        />
                      ) : (
                        <span className="text-muted-foreground">{c.order}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {c.total === 0 ? '—' : `${c.total} (${c.live} live)`}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                          c.active
                            ? 'bg-success/10 text-success'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {c.active ? 'Active' : 'Hidden'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                        {editing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => saveEdit(c)}
                              disabled={busy}
                              aria-label={`Save ${c.name}`}
                              className="inline-flex size-8 items-center justify-center rounded-lg text-success hover:bg-muted"
                            >
                              <Check className="size-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              aria-label="Cancel"
                              className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
                            >
                              <X className="size-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(c.id)
                                setDraftName(c.name)
                                setDraftOrder(String(c.order))
                                setError(null)
                              }}
                              aria-label={`Edit ${c.name}`}
                              className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
                            >
                              <Pencil className="size-4" />
                            </button>
                            <button
                              type="button"
                              disabled={busy || (c.active && c.live > 0)}
                              // Disabled rather than hidden while listings
                              // depend on it: the button is where an
                              // administrator looks, and the title says why it
                              // will not move. The callable refuses regardless.
                              title={
                                c.active && c.live > 0
                                  ? `${c.live} published listing${c.live === 1 ? '' : 's'} still use this category`
                                  : undefined
                              }
                              onClick={() =>
                                call(
                                  { action: 'setActive', categoryId: c.id, active: !c.active },
                                  c.id,
                                )
                              }
                              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {c.active ? 'Hide' : 'Show'}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {sorted.length === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            No categories yet. Dealers cannot create a listing until at least one exists.
          </p>
        )}
      </div>
    </div>
  )
}
