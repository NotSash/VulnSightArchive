import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * The one surface on a report.
 *
 * The results page was showing two generations of work at once: the older
 * sections used the rounded shadcn `Card`, with a 12px radius and a soft ring,
 * while everything written later used a flat, hard-edged, hard-shadowed panel.
 * Side by side on one page that does not read as two styles, it reads as
 * unfinished.
 *
 * Flat won, for a reason rather than a preference. The whole product is a CRT
 * console: square lamps, square gates, a monospace grid, a hard offset shadow
 * with no blur. A soft rounded card is from a different world, and it was the
 * only thing on the page that looked like a generic dashboard template.
 *
 * `Panel` is deliberately thin. It is a surface, not a layout system, and it
 * takes `className` so a section can still choose its own grid without needing
 * a variant added here.
 */
function Panel({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="panel"
      className={cn('border border-border bg-card shadow-hard backdrop-blur-md', className)}
      {...props}
    />
  )
}

/**
 * The bar across the top of a panel.
 *
 * Named, uppercase, monospace, on a slightly darker ground: the same header
 * the scan page puts above the findings list, so a section title is
 * recognisably the same object everywhere it appears.
 */
function PanelHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="panel-header"
      className={cn(
        'flex items-center justify-between gap-3 border-b border-border bg-[#03070B]/55 px-4 py-2.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-[var(--dim)]',
        className,
      )}
      {...props}
    />
  )
}

function PanelBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="panel-body" className={cn('p-4', className)} {...props} />
}

/**
 * A small piece of labelled data: a port, a technology, a CVE identifier.
 *
 * Chips were previously drawn four different ways across the report, with
 * three different radii. One shape now, and one place to change it.
 *
 * `tone` exists only for the two reasons colour is ever allowed in this
 * product: risk severity, and agreement between scanners. Everything else is
 * neutral, so that when something does carry colour it means something.
 */
function Chip({
  className,
  tone = 'neutral',
  ...props
}: React.ComponentProps<'span'> & { tone?: 'neutral' | 'phos' | 'amber' }) {
  return (
    <span
      data-slot="chip"
      data-tone={tone}
      className={cn(
        'inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[11px] leading-5',
        tone === 'neutral' && 'border-border bg-background/60 text-[var(--dim)]',
        tone === 'phos' && 'border-phos/40 bg-phos/10 text-phos',
        tone === 'amber' && 'border-amber/40 bg-amber/10 text-amber',
        className,
      )}
      {...props}
    />
  )
}

export { Chip, Panel, PanelBody, PanelHeader }
