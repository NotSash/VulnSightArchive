'use client'

import { AlertCircle, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import useSWR from 'swr'
import type { HealthReport } from '@/lib/scanner/health'
import { cn } from '@/lib/utils'

/**
 * Live scanner availability.
 *
 * Surfaces which integrations can actually run before a scan is started, so a
 * user understands up front why a report might be thin — rather than
 * discovering it in the coverage notes twenty minutes later.
 */

const fetcher = async (url: string): Promise<HealthReport> => {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error('health check failed')
  return res.json()
}

export function ToolStatus({ className }: { className?: string }) {
  const { data, error, isLoading } = useSWR<HealthReport>('/api/health', fetcher, {
    // Launching Chromium is expensive; this does not need to be live-polled.
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  })

  if (isLoading) {
    return (
      <div
        className={cn('flex items-center gap-2 text-xs text-muted-foreground', className)}
        role="status"
      >
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        Checking scanner availability…
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className={cn('flex items-center gap-2 text-xs text-muted-foreground', className)}>
        <AlertCircle className="size-3.5" aria-hidden="true" />
        Scanner status unavailable.
      </div>
    )
  }

  return (
    <div className={cn('rounded-xl border border-border bg-card/40 p-4', className)}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">Scanner availability</h3>
        <span className="font-mono text-xs text-muted-foreground">
          {data.ready}/{data.total} ready
        </span>
      </div>

      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {data.tools.map((tool) => (
          <li key={tool.id} className="flex items-start gap-2">
            {tool.available ? (
              <CheckCircle2
                className="mt-0.5 size-3.5 shrink-0 text-severity-low"
                aria-hidden="true"
              />
            ) : (
              <XCircle
                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60"
                aria-hidden="true"
              />
            )}
            <div className="min-w-0">
              <span
                className={cn(
                  'text-xs font-medium',
                  tool.available ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {tool.name}
                {tool.version && (
                  <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                    {tool.version}
                  </span>
                )}
              </span>
              {tool.detail && (
                <p className="truncate text-[11px] leading-snug text-muted-foreground/80">
                  {tool.detail}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {data.ready < data.total && (
        <p className="mt-3 border-t border-border/60 pt-3 text-[11px] leading-relaxed text-muted-foreground">
          Unavailable scanners are skipped and recorded in the report&apos;s coverage notes.
          VulnSight never fabricates results for a check it could not run.
        </p>
      )}
    </div>
  )
}
