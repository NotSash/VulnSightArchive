import type { RiskCategory, Severity } from '@/types/report'

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info']

interface SeverityMeta {
  label: string
  /**
   * Short form, for places where the full word will not fit.
   *
   * The scan page renders severity in a four-column tally where "Critical" and
   * "Medium" wrap onto two lines. It used to keep its own private map to solve
   * that, which is how the site ended up saying "Med" on one page and "Medium"
   * on another for the same finding. One table, two spellings, chosen by fit.
   */
  abbrev: string
  /** Tailwind text color class bound to the functional severity token. */
  text: string
  /** Tailwind background color class. */
  bg: string
  /** Subtle tinted surface + border for badges and chips. */
  chip: string
  /** Raw CSS variable reference for charts. */
  cssVar: string
}

export const SEVERITY_META: Record<Severity, SeverityMeta> = {
  critical: {
    label: 'Critical',
    abbrev: 'Crit',
    text: 'text-severity-critical',
    bg: 'bg-severity-critical',
    chip: 'bg-severity-critical/12 text-severity-critical border-severity-critical/30',
    cssVar: 'var(--severity-critical)',
  },
  high: {
    label: 'High',
    abbrev: 'High',
    text: 'text-severity-high',
    bg: 'bg-severity-high',
    chip: 'bg-severity-high/12 text-severity-high border-severity-high/30',
    cssVar: 'var(--severity-high)',
  },
  medium: {
    label: 'Medium',
    abbrev: 'Med',
    text: 'text-severity-medium',
    bg: 'bg-severity-medium',
    chip: 'bg-severity-medium/12 text-severity-medium border-severity-medium/30',
    cssVar: 'var(--severity-medium)',
  },
  low: {
    label: 'Low',
    abbrev: 'Low',
    text: 'text-severity-low',
    bg: 'bg-severity-low',
    chip: 'bg-severity-low/12 text-severity-low border-severity-low/30',
    cssVar: 'var(--severity-low)',
  },
  info: {
    label: 'Info',
    abbrev: 'Info',
    text: 'text-severity-info',
    bg: 'bg-severity-info',
    // Not `text-severity-info`: grey on a wash of the same grey measured
    // 4.01:1. See `--severity-info-ink` in `globals.css`.
    chip: 'bg-severity-info/12 text-[var(--severity-info-ink)] border-severity-info/30',
    cssVar: 'var(--severity-info)',
  },
}

export function riskCategoryMeta(category: RiskCategory) {
  switch (category) {
    case 'Safe':
      return { text: 'text-severity-low', cssVar: 'var(--severity-low)' }
    case 'Moderate':
      return { text: 'text-severity-medium', cssVar: 'var(--severity-medium)' }
    case 'High':
      return { text: 'text-severity-high', cssVar: 'var(--severity-high)' }
    case 'Critical':
      return {
        text: 'text-severity-critical',
        cssVar: 'var(--severity-critical)',
      }
  }
}

export function categoryForScore(score: number): RiskCategory {
  if (score >= 80) return 'Safe'
  if (score >= 60) return 'Moderate'
  if (score >= 40) return 'High'
  return 'Critical'
}
