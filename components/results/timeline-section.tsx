import { CheckCircle2 } from 'lucide-react'
import { Panel } from '@/components/ui/panel'
import type { TimelineEvent } from '@/types/report'

export function TimelineSection({ timeline }: { timeline: TimelineEvent[] }) {
  if (timeline.length === 0) return null

  return (
    <Panel className="p-6">
      <ol className="relative space-y-0">
        {timeline.map((event, i) => (
          <li key={`${event.time}-${i}`} className="flex gap-4 pb-5 last:pb-0">
            <div className="flex flex-col items-center">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-severity-low/15 text-severity-low">
                <CheckCircle2 className="size-3.5" aria-hidden />
              </span>
              {i < timeline.length - 1 && (
                <span className="mt-1 w-px flex-1 bg-border" aria-hidden />
              )}
            </div>
            <div className="flex flex-1 items-baseline justify-between gap-4 pt-0.5">
              <span className="text-sm text-foreground">{event.event}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{event.time}</span>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  )
}
