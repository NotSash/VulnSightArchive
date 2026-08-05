import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

function Shimmer({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />
}

/**
 * Structural placeholder shown while the report loads. It mirrors the real
 * report layout (header, title, overview triptych, stacked sections) so the
 * transition to loaded content feels like the same page resolving rather than
 * a different screen swapping in.
 */
export function ReportSkeleton() {
  return (
    /*
     * `js-only`: without JavaScript the report never arrives, so this skeleton
     * would sit at `aria-busy="true"` forever, telling a screen reader to keep
     * waiting. The <noscript> block on the page explains the situation
     * instead. See `globals.css`.
     */
    <div className="js-only min-h-screen" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading security report…</span>

      {/* Header bar */}
      <div className="border-b border-border/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Shimmer className="h-7 w-28" />
          <div className="flex items-center gap-2">
            <Shimmer className="h-7 w-24" />
            <Shimmer className="h-7 w-20" />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[180px_1fr]">
          {/* Nav rail */}
          <div className="hidden flex-col gap-2 lg:flex" aria-hidden="true">
            {Array.from({ length: 7 }).map((_, i) => (
              <Shimmer key={i} className="h-7 w-full" />
            ))}
          </div>

          {/* Main column */}
          <div className="min-w-0 space-y-10" aria-hidden="true">
            {/* Title block */}
            <div className="space-y-3">
              <Shimmer className="h-5 w-40" />
              <Shimmer className="h-9 w-64" />
              <Shimmer className="h-4 w-48" />
            </div>

            {/* Overview triptych */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="p-6">
                  <Shimmer className="h-4 w-32" />
                  <div className="mt-6 flex flex-col items-center gap-3">
                    <Shimmer
                      className={cn('w-full', i === 0 ? 'mx-auto size-32 rounded-full' : 'h-40')}
                    />
                  </div>
                </Card>
              ))}
            </div>

            {/* Stacked sections */}
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-4">
                <Shimmer className="h-5 w-44" />
                <Card className="p-6">
                  <div className="space-y-3">
                    <Shimmer className="h-4 w-full" />
                    <Shimmer className="h-4 w-11/12" />
                    <Shimmer className="h-4 w-4/5" />
                  </div>
                </Card>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
