'use client'

import { ExternalLink, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '@/components/results/empty-state'
import { SeverityBadge } from '@/components/results/severity-badge'
import { Lamp } from '@/components/ui/lamp'
import { channelsForSources, independentChannelCount } from '@/lib/scanner/channels'
import { SEVERITY_ORDER } from '@/lib/severity'
import { cn } from '@/lib/utils'
import type { Vulnerability } from '@/types/report'

/**
 * Findings, grouped by how much evidence backs them.
 *
 * Severity used to decide the order. That buried the one thing that separates
 * this product from running five scanners yourself: a finding two tools found
 * independently is worth more of your afternoon than a high-severity guess
 * only one tool made. Agreement now decides the group, severity decides the
 * order within it.
 *
 * Corroborated rows are visibly heavier: a lit edge, a brighter surface, and
 * the actual lamps that saw them. Single-tool rows are flat and quiet. Nothing
 * is hidden, and every detail that used to be in the expanded panel is still
 * there.
 *
 * Counting is by *channel*, not by raw confirmation. `header` and `cookie`
 * both firing is VulnSight agreeing with itself, not two independent tools;
 * see `lib/scanner/channels.ts`.
 */

/** Position in the shared severity order. Unknown values sort last. */
function rank(v: Vulnerability): number {
  const i = SEVERITY_ORDER.indexOf(v.severity)
  return i === -1 ? SEVERITY_ORDER.length : i
}

function sourcesOf(v: Vulnerability): string[] {
  const list = v.confirmations?.map((c) => c.source) ?? []
  return list.length > 0 ? list : [v.source]
}

/** How many independent tools saw this. The number the grouping turns on. */
function agreement(v: Vulnerability): number {
  return independentChannelCount(sourcesOf(v))
}

function MetaTag({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 border border-border bg-background/60 px-2 py-1 font-mono text-xs text-muted-foreground">
      <span className="text-muted-foreground/70">{label}</span>
      <span className="text-foreground">{value}</span>
    </span>
  )
}

function DetailBlock({ label, children }: { label: string; children: string }) {
  return (
    <div>
      <h4 className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--dim-2)]">
        {label}
      </h4>
      <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">{children}</p>
    </div>
  )
}

/**
 * One finding. Its own disclosure button rather than a shared accordion, so
 * several can be open at once and each carries its own focus ring.
 */
function FindingRow({ vuln, confirmed }: { vuln: Vulnerability; confirmed: boolean }) {
  const [open, setOpen] = useState(false)
  const channels = channelsForSources(sourcesOf(vuln))
  const n = channels.length
  const panelId = `finding-${vuln.id}`

  return (
    <li
      className={cn(
        'border transition-colors',
        confirmed
          ? 'border-phos/30 bg-[#0F1723] hover:border-phos/55'
          : 'border-border bg-card hover:border-input',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        /*
         * A row is the primary interaction on the whole report: it expands to
         * show the evidence behind a finding. It had a focus ring and nothing
         * for the pointer, so fifteen expandable rows looked identical to
         * static text until clicked.
         *
         * A background lift rather than a colour change, because colour on
         * this page means severity or agreement and must not be spent on
         * pointer feedback.
         */
        className="group flex w-full items-center gap-3 px-3.5 py-3.5 text-left outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-phos focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {/* The lit edge. Present only when more than one tool agreed, so the
            page cannot make a weak finding look strong. */}
        <span
          aria-hidden="true"
          className={cn(
            '-ml-3.5 mr-0.5 h-9 w-[3px] shrink-0',
            confirmed ? 'bg-phos' : 'bg-transparent',
          )}
        />
        <SeverityBadge severity={vuln.severity} />
        <span
          className={cn(
            'flex-1 text-[14.5px] leading-snug',
            confirmed ? 'font-semibold text-foreground' : 'text-[var(--dim)]',
          )}
        >
          {vuln.title}
        </span>

        {/* The lamps that saw it. The same component as the scan page, so the
            reader has already learned what a lit lamp means. */}
        {confirmed ? (
          <span className="hidden shrink-0 items-center gap-1.5 md:flex">
            {channels.map((c) => (
              <Lamp key={c} state="done" size={11} />
            ))}
            <span className="ml-1.5 font-mono text-[10px] font-bold tracking-[0.08em] text-phos">
              {n} TOOLS
            </span>
          </span>
        ) : (
          <span className="hidden shrink-0 font-mono text-[10px] font-bold tracking-[0.08em] text-[var(--dim-2)] md:inline">
            SEEN ONCE
          </span>
        )}

        {vuln.cvss_score !== null && (
          <span className="hidden shrink-0 font-mono text-xs text-muted-foreground lg:inline">
            CVSS {vuln.cvss_score.toFixed(1)}
          </span>
        )}
        <span
          aria-hidden="true"
          className={cn(
            'shrink-0 font-mono text-[11px] text-[var(--dim-2)] transition-transform',
            open && 'rotate-90',
          )}
        >
          &gt;
        </span>
      </button>

      {open && (
        <div id={panelId} className="space-y-5 border-t border-border px-3.5 pb-5 pt-4">
          <div className="flex flex-wrap gap-2">
            {vuln.cvss_score !== null && (
              <MetaTag label="CVSS" value={vuln.cvss_score.toFixed(1)} />
            )}
            {vuln.cwe_id && <MetaTag label="CWE" value={vuln.cwe_id} />}
            {vuln.cve_id && <MetaTag label="CVE" value={vuln.cve_id} />}
            <MetaTag label="Source" value={vuln.source} />
          </div>

          {vuln.confirmations && vuln.confirmations.length > 1 && (
            <div className="border border-phos/25 bg-phos/[0.05] p-4">
              <h4 className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-phos">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                Corroborated by {n} independent {n === 1 ? 'tool' : 'tools'}
              </h4>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Each tool below detected this on its own. Independent agreement is stronger evidence
                than any single detection.
              </p>
              <ul className="mt-3 space-y-2">
                {vuln.confirmations.map((confirmation) => (
                  <li
                    key={`${confirmation.source}-${confirmation.raw_title}`}
                    className="flex flex-col gap-0.5 border-l-2 border-phos/30 pl-3"
                  >
                    <span className="font-mono text-[11px] uppercase tracking-wide text-phos">
                      {confirmation.source}
                    </span>
                    <span className="text-sm text-foreground/90">{confirmation.raw_title}</span>
                    {confirmation.evidence && (
                      <code className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                        {confirmation.evidence}
                      </code>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <DetailBlock label="Description">{vuln.description}</DetailBlock>
          <DetailBlock label="Impact">{vuln.impact}</DetailBlock>
          <DetailBlock label="Recommendation">{vuln.recommendation}</DetailBlock>
          {vuln.evidence && <DetailBlock label="Evidence">{vuln.evidence}</DetailBlock>}

          {vuln.owasp_category && (
            <div>
              <h4 className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--dim-2)]">
                OWASP category
              </h4>
              <p className="mt-1.5 text-sm text-foreground/90">{vuln.owasp_category}</p>
            </div>
          )}

          {vuln.references.length > 0 && (
            <div>
              <h4 className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--dim-2)]">
                References
              </h4>
              <ul className="mt-1.5 space-y-1">
                {vuln.references.map((ref) => (
                  <li key={ref}>
                    <a
                      href={ref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 break-all text-sm text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-phos"
                    >
                      <ExternalLink className="size-3.5 shrink-0" />
                      {ref}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

/** Heading above each group. Says the rule, not just the count. */
function GroupHeading({ label, count, lit }: { label: string; count: number; lit: boolean }) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      <h3
        className={cn(
          'font-mono text-[10px] font-bold uppercase tracking-[0.14em]',
          lit ? 'text-phos' : 'text-[var(--dim-2)]',
        )}
      >
        {label}
      </h3>
      <span className="tnum font-mono text-[10px] font-bold text-[var(--dim-2)]">{count}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  )
}

export function VulnerabilitiesSection({ vulnerabilities }: { vulnerabilities: Vulnerability[] }) {
  /*
   * Long lists are truncated rather than rendered whole. A scan of a busy site
   * can return sixty findings, and putting all of them in the DOM at once
   * makes the page crawl on a phone for rows nobody has scrolled to yet.
   */
  const [showAllSingle, setShowAllSingle] = useState(false)

  if (vulnerabilities.length === 0) {
    /*
     * Nothing found, said precisely.
     *
     * The old copy read "The passive assessment did not surface any findings.
     * Continue to follow security best practices and re-scan periodically."
     * Three things were wrong with it. A deep scan runs nmap, nuclei and ZAP,
     * none of which are passive. "Follow security best practices" is exactly
     * the generic filler this product exists to avoid. And it sat directly
     * above a Security headers panel listing six headers as **missing**, so
     * the page claimed nothing was found while showing things that were.
     *
     * The distinction that resolves it: a *finding* is something a tool
     * asserted is a problem. An observation about how the site is configured
     * is not automatically one. Saying so plainly, and pointing at the section
     * that holds those observations, is both accurate and more useful than
     * advice nobody asked for.
     */
    return (
      <div className="border border-border bg-card">
        <EmptyState
          icon={ShieldCheck}
          tone="positive"
          size="lg"
          title="No findings"
          description="Every tool ran and none of them reported a weakness. Configuration details are still listed under Technical details below, and anything a tool could not examine is listed under Scan coverage."
        />
      </div>
    )
  }

  const sorted = [...vulnerabilities].sort((a, b) => rank(a) - rank(b))
  const confirmed = sorted.filter((v) => agreement(v) >= 2)
  const single = sorted.filter((v) => agreement(v) < 2)

  const SINGLE_LIMIT = 10
  const visibleSingle = showAllSingle ? single : single.slice(0, SINGLE_LIMIT)
  const hidden = single.length - visibleSingle.length

  return (
    <div className="space-y-9">
      {confirmed.length > 0 ? (
        <section>
          <GroupHeading label="More than one tool agreed" count={confirmed.length} lit />
          <ul className="space-y-2">
            {confirmed.map((vuln) => (
              <FindingRow key={vuln.id} vuln={vuln} confirmed />
            ))}
          </ul>
        </section>
      ) : (
        /*
         * An empty headed section reads as a rendering fault. When nothing was
         * corroborated, say so plainly: it is a real and useful result, not an
         * absence to be papered over.
         */
        <section>
          <GroupHeading label="More than one tool agreed" count={0} lit={false} />
          <p className="border border-border bg-card px-4 py-5 text-[13.5px] leading-relaxed text-[var(--dim)]">
            Nothing was corroborated by a second tool on this scan. Treat everything below as a lead
            to verify rather than a confirmed problem.
          </p>
        </section>
      )}

      {single.length > 0 && (
        <section>
          <GroupHeading label="Seen by one tool" count={single.length} lit={false} />
          <ul className="space-y-1.5">
            {visibleSingle.map((vuln) => (
              <FindingRow key={vuln.id} vuln={vuln} confirmed={false} />
            ))}
          </ul>
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setShowAllSingle(true)}
              className="press mt-3 inline-flex min-h-11 w-full items-center justify-center border border-border bg-card px-4 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--dim)] outline-none transition-colors hover:border-input hover:text-foreground focus-visible:ring-2 focus-visible:ring-phos"
            >
              Show {hidden} more
            </button>
          )}
        </section>
      )}
    </div>
  )
}
