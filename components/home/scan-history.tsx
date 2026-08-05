'use client'

import { Clock, X } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useScanBar } from '@/components/scan/scan-bar-context'
import {
  clearHistory,
  forgetScan,
  readHistory,
  relativeTime,
  type ScanHistoryEntry,
} from '@/lib/scan-history'
import { cn } from '@/lib/utils'

/**
 * Past scans, behind a single button.
 *
 * An inline list would grow without limit and eventually wreck the hero, so
 * history lives in a panel that is opened deliberately. Each entry is checked
 * against the server before its "Open report" link appears: reports expire
 * after an hour, and a link that 404s is exactly the kind of lying control the
 * rest of this interface avoids.
 */
export function ScanHistory() {
  const { setUrl, focusHero } = useScanBar()
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<ScanHistoryEntry[]>([])
  const [alive, setAlive] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setEntries(readHistory())
  }, [])

  // Verify only what is on screen, and only when the panel is actually open.
  useEffect(() => {
    if (!open || entries.length === 0) return
    let cancelled = false
    Promise.all(
      entries.map(async (entry) => {
        try {
          const res = await fetch(`/api/report/${entry.scanId}`, { method: 'HEAD' })
          return [entry.scanId, res.ok] as const
        } catch {
          return [entry.scanId, false] as const
        }
      }),
    ).then((pairs) => {
      if (!cancelled) setAlive(Object.fromEntries(pairs))
    })
    return () => {
      cancelled = true
    }
  }, [open, entries])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const rescan = useCallback(
    (url: string) => {
      setOpen(false)
      setUrl(url)
      focusHero()
    },
    [setUrl, focusHero],
  )

  if (entries.length === 0) return null

  const latest = entries[0]

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-border bg-card p-3.5 backdrop-blur-md">
        <div className="min-w-0">
          <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.11em] text-[var(--dim-2)]">
            Last scan &middot; {relativeTime(latest.at)}
          </div>
          <div className="mt-1 truncate font-mono text-[15px] font-bold">
            {latest.url}
            <span className="tnum ml-2 text-[13px] font-normal text-[var(--dim)]">
              scored {latest.score}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex shrink-0 items-center gap-2 border border-input bg-secondary px-3 py-1.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.06em] transition-colors hover:border-phos hover:text-phos"
        >
          <Clock className="size-3.5" aria-hidden="true" />
          All {entries.length} scan{entries.length === 1 ? '' : 's'}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-[100]">
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close scan history"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-[#03070B]/70 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Your past scans"
            className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-border bg-[#080F16] shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border bg-[#03070B]/55 px-4 py-3">
              <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.11em] text-[var(--dim)]">
                Your past scans &middot; {entries.length}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="grid size-7 place-items-center border border-input transition-colors hover:border-phos hover:text-phos"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </div>

            <ul className="flex-1 overflow-y-auto">
              {entries.map((entry) => {
                const available = alive[entry.scanId]
                return (
                  <li key={entry.scanId} className="border-b border-border px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-[14px] font-bold">{entry.url}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[9.5px] uppercase tracking-[0.08em] text-[var(--dim-2)]">
                          <span>{relativeTime(entry.at)}</span>
                          <span aria-hidden="true">&middot;</span>
                          <span className="tnum">scored {entry.score}</span>
                          <span aria-hidden="true">&middot;</span>
                          <span className="tnum">{entry.findings} findings</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove ${entry.url} from history`}
                        onClick={() => {
                          forgetScan(entry.scanId)
                          setEntries(readHistory())
                        }}
                        className="shrink-0 text-[var(--dim-2)] transition-colors hover:text-severity-critical"
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </button>
                    </div>

                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {available === undefined ? (
                        <span className="font-mono text-[10px] text-[var(--dim-2)]">checking…</span>
                      ) : available ? (
                        <Link
                          href={`/results/${entry.scanId}`}
                          onClick={() => setOpen(false)}
                          className={cn(
                            'press border border-phos bg-phos px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-[#03070B]',
                          )}
                        >
                          Open report
                        </Link>
                      ) : (
                        <span className="border border-input px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--dim-2)]">
                          Report expired
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => rescan(entry.url)}
                        className="border border-input bg-secondary px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.06em] transition-colors hover:border-phos hover:text-phos"
                      >
                        Scan again
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>

            <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
              <p className="text-[11px] leading-snug text-[var(--dim-2)]">
                Kept in this browser only. Reports are held for an hour.
              </p>
              <button
                type="button"
                onClick={() => {
                  clearHistory()
                  setEntries([])
                  setOpen(false)
                }}
                className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--dim-2)] transition-colors hover:text-severity-critical"
              >
                Clear all
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
