import { SEVERITY_META } from '@/lib/severity'
import { cn } from '@/lib/utils'
import type { Severity } from '@/types/report'

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const meta = SEVERITY_META[severity]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 border px-2.5 py-0.5 text-xs font-medium',
        meta.chip,
        className,
      )}
    >
      {/* The dot stays round on purpose: it reads as a lamp, which is the
          page's language for a signal, not as a container. */}
      <span className={cn('size-1.5 rounded-full', meta.bg)} />
      {meta.label}
    </span>
  )
}
