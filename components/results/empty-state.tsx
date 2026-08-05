import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type EmptyTone = 'positive' | 'neutral' | 'unavailable'

const TONE_STYLES: Record<EmptyTone, string> = {
  // "All clear" — a reassuring success state (e.g. no vulnerabilities).
  positive: 'bg-severity-low/15 text-severity-low',
  // Plain "no data to show" — calm and unremarkable.
  neutral: 'bg-muted text-muted-foreground',
  // A capability that did not run / is unavailable for this scan.
  unavailable: 'bg-muted text-muted-foreground/70',
}

/**
 * Shared empty-state primitive used across the report so "no data", "all
 * clear", and "unavailable" surfaces look and read consistently. Sizing is
 * compact by default (inline panels) and roomier when `size="lg"` for
 * full-section states like "no vulnerabilities found".
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  tone = 'neutral',
  size = 'sm',
  className,
  children,
}: {
  icon: LucideIcon
  title: string
  description?: string
  tone?: EmptyTone
  size?: 'sm' | 'lg'
  className?: string
  children?: React.ReactNode
}) {
  const lg = size === 'lg'
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 text-center',
        lg ? 'p-10' : 'px-4 py-8',
        className,
      )}
    >
      <span
        className={cn(
          'flex items-center justify-center rounded-full',
          lg ? 'size-11' : 'size-9',
          TONE_STYLES[tone],
        )}
      >
        <Icon className={lg ? 'size-5' : 'size-4'} aria-hidden="true" />
      </span>
      <h3 className={cn('font-medium text-foreground', lg ? 'text-base' : 'text-sm')}>{title}</h3>
      {description && (
        <p className="max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {children}
    </div>
  )
}
