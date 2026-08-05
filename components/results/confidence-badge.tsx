import { Eye, ShieldCheck, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FindingConfidence } from '@/types/report'

/**
 * Displays how much independent support a finding has.
 *
 * This is the visible output of cross-tool correlation, and it is the single
 * most useful signal in the report: a weakness that three independent scanners
 * found is qualitatively different from one that a single template flagged.
 */

const CONFIDENCE_META: Record<
  FindingConfidence,
  { label: string; icon: typeof ShieldCheck; className: string; help: string }
> = {
  confirmed: {
    label: 'Confirmed',
    icon: ShieldCheck,
    className: 'border-severity-low/40 bg-severity-low/12 text-severity-low',
    help: 'Independently observed by two or more different tools.',
  },
  probable: {
    label: 'Probable',
    icon: Sparkles,
    className: 'border-severity-medium/40 bg-severity-medium/12 text-severity-medium',
    help: 'Detected by a single active check that returned direct evidence.',
  },
  observed: {
    label: 'Observed',
    icon: Eye,
    className: 'border-border bg-muted/60 text-muted-foreground',
    help: 'Derived from configuration. Verifiable, but not proof of exploitability.',
  },
}

export function ConfidenceBadge({
  confidence,
  sourceCount,
  className,
}: {
  confidence: FindingConfidence
  /** Number of independent observations, shown when more than one. */
  sourceCount?: number
  className?: string
}) {
  const meta = CONFIDENCE_META[confidence]
  const Icon = meta.icon
  const multiple = (sourceCount ?? 0) > 1

  return (
    <span
      title={meta.help}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 border px-2 py-0.5 text-xs font-medium',
        meta.className,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {multiple ? `Confirmed by ${sourceCount} tools` : meta.label}
    </span>
  )
}

export { CONFIDENCE_META }
