import { Lamp } from '@/components/ui/lamp'
import { independentChannelCount } from '@/lib/scanner/channels'
import { cn } from '@/lib/utils'
import type { ScanReport, Severity } from '@/types/report'

/**
 * The answer, before the evidence.
 *
 * Someone opening a report wants to know two things immediately: how bad is
 * it, and what should I do first. Everything else — the tables, the raw output,
 * the CVE list — is there to justify this block, not to precede it.
 *
 * The three named fixes are chosen deterministically: findings that more than
 * one tool observed, ordered by severity. Never an AI's opinion.
 */

const SEV_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info']

const SEV_BAR: Record<Severity, string> = {
  critical: 'bg-severity-critical',
  high: 'bg-severity-high',
  medium: 'bg-severity-medium',
  low: 'bg-severity-low',
  info: 'bg-severity-info',
}

/** 270° arc, radius 54, centred in a 128 box. */
const ARC = 'M25.82 102.18 A54 54 0 1 1 102.18 102.18'
const ARC_LENGTH = 254.47

function scoreColour(score: number): string {
  if (score >= 80) return 'var(--phos)'
  if (score >= 60) return 'var(--severity-low)'
  if (score >= 40) return 'var(--severity-high)'
  return 'var(--severity-critical)'
}

export function Verdict({ report }: { report: ScanReport }) {
  const { risk, severity_distribution: dist, vulnerabilities } = report

  /*
   * The three findings worth an afternoon.
   *
   * Ordered by independent agreement first, severity second. Sorting by
   * severity alone put a high-severity guess one tool made above a medium four
   * tools corroborated, which inverts the product's central claim on the most
   * prominent panel of the report.
   *
   * Agreement is counted in *channels*, not raw confirmations: `header` and
   * `cookie` both firing is VulnSight agreeing with itself, not two
   * independent tools. See `lib/scanner/channels.ts`.
   */
  const agreementOf = (v: (typeof vulnerabilities)[number]) =>
    independentChannelCount(
      v.confirmations?.length ? v.confirmations.map((c) => c.source) : [v.source],
    )

  const confirmed = vulnerabilities.filter((v) => agreementOf(v) >= 2)
  const priority = [...(confirmed.length > 0 ? confirmed : vulnerabilities)]
    .sort((a, b) => {
      const byAgreement = agreementOf(b) - agreementOf(a)
      if (byAgreement !== 0) return byAgreement
      return SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity)
    })
    .slice(0, 3)

  const total = vulnerabilities.length
  const colour = scoreColour(risk.score)
  const dashOffset = ARC_LENGTH - (ARC_LENGTH * Math.min(100, Math.max(0, risk.score))) / 100

  const bars = SEV_ORDER.map((sev) => ({ sev, count: dist[sev] })).filter((b) => b.count > 0)

  return (
    <div className="sheen-once grid border border-border bg-card shadow-hard backdrop-blur-md md:grid-cols-[200px_1fr]">
      <div className="flex flex-col items-center justify-center border-b border-border p-6 text-center md:border-b-0 md:border-r">
        <div className="relative size-32">
          <svg
            viewBox="0 0 128 128"
            className="size-32"
            role="img"
            aria-label={`Risk score ${risk.score} out of 100, rated ${risk.category}`}
          >
            <path
              d={ARC}
              fill="none"
              stroke="rgba(160,205,235,.13)"
              strokeWidth="9"
              strokeLinecap="round"
            />
            <path
              d={ARC}
              fill="none"
              stroke={colour}
              strokeWidth="9"
              strokeLinecap="round"
              style={{
                strokeDasharray: ARC_LENGTH,
                strokeDashoffset: ARC_LENGTH,
                animation: `score-fill var(--dur-score) var(--ease) .25s forwards`,
                // Custom property consumed by the keyframe below.
                ['--score-offset' as string]: String(dashOffset),
                filter: `drop-shadow(0 0 7px color-mix(in srgb, ${colour} 50%, transparent))`,
              }}
            />
          </svg>
          {/*
            The score uses the mono face, not the display face: pixel digits are
            not uniform width, so an animating or changing number would jitter.
          */}
          <div className="pointer-events-none absolute inset-0 z-[2] flex flex-col items-center justify-center">
            <b className="tnum font-mono text-[41px] font-bold leading-none tracking-tight">
              {risk.score}
            </b>
            <span
              className="mt-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.11em]"
              style={{ color: colour }}
            >
              {risk.category}
            </span>
          </div>
        </div>
        <p className="mt-3 font-mono text-[9.5px] uppercase tracking-[0.09em] text-[var(--dim-2)]">
          Risk score
        </p>
      </div>

      <div className="p-6">
        {total === 0 ? (
          <>
            <h2 className="mb-1.5 font-display text-[19px] leading-none">Nothing to fix here.</h2>
            <p className="prose-measure text-sm text-[var(--dim)]">
              No weaknesses were found. Check what couldn&apos;t be examined below before treating
              this as a clean bill of health, because a scan can only report on what it was able to
              reach.
            </p>
          </>
        ) : (
          <>
            <h2 className="mb-1.5 font-display text-[19px] leading-none">
              {priority.length === 1
                ? 'Start with this one.'
                : `Start with these ${priority.length}.`}
            </h2>
            <p className="prose-measure text-sm text-[var(--dim)]">
              {total} {total === 1 ? 'thing was' : 'things were'} found.{' '}
              {confirmed.length > 0 ? (
                <>
                  <b className="font-semibold text-foreground">{confirmed.length}</b> of them were
                  seen by more than one scanner, so those are worth your time today:
                </>
              ) : (
                <>No two tools agreed on the same thing, so treat these as leads:</>
              )}
            </p>

            {/*
              The uncorroborated case, drawn rather than merely stated.

              This branch had never once been rendered: every sample and every
              real scan used for design happened to have at least one finding
              two tools agreed on. It was a sentence in a paragraph, which is
              the weakest possible treatment of the single most important
              caveat this product can offer.

              An unlit lamp says it in the language the page already teaches:
              a lamp that reported is bright, and this one never lit. No
              colour, because nothing here is a risk level and nothing here is
              agreement, and those are the only two things allowed to carry
              chroma.
            */}
            {confirmed.length === 0 && (
              <div className="mt-4 flex items-start gap-3 border border-border bg-[#03070B]/45 p-3.5">
                <Lamp state="idle" size={20} className="mt-px shrink-0" />
                <p className="text-[13px] leading-[1.6] text-[var(--dim)]">
                  Nothing was corroborated. Each of these was reported by a single tool, so any one
                  of them could be a false positive. That is not the same as being wrong, it just
                  means nothing here has been checked twice.
                </p>
              </div>
            )}
            <ol className="mt-3 space-y-1.5">
              {priority.map((finding) => (
                <li key={finding.id} className="flex items-center gap-2.5 text-sm">
                  <i
                    aria-hidden="true"
                    className={cn('h-4 w-1 shrink-0', SEV_BAR[finding.severity])}
                  />
                  <span className="font-medium">{finding.title}</span>
                  {(finding.confirmations?.length ?? 0) > 1 && (
                    <span className="shrink-0 font-mono text-[9.5px] font-bold uppercase tracking-[0.06em] text-phos">
                      {finding.confirmations?.length} tools
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}

        {bars.length > 0 && (
          <>
            <div className="mt-5 flex h-1.5 gap-0.5">
              {bars.map(({ sev, count }) => (
                <i
                  key={sev}
                  className={cn('block', SEV_BAR[sev])}
                  style={{ flex: count }}
                  aria-hidden="true"
                />
              ))}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-4 font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--dim-2)]">
              {SEV_ORDER.map((sev) => (
                <span key={sev} className="flex items-center gap-1.5">
                  <i className={cn('block size-2', SEV_BAR[sev])} aria-hidden="true" />
                  {dist[sev]} {sev}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
