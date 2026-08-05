import { RevealOnScroll } from '@/components/reveal-on-scroll'
import { cn } from '@/lib/utils'

/**
 * The argument for the product.
 *
 * Every free scanner hands you a wall of maybes. The one thing VulnSight can
 * show that nobody else can is which findings more than one independent tool
 * saw — so this section is framed as the question a reader actually has
 * ("which do I fix first?") rather than as an abstract claim about correlation.
 *
 * The data is the real output of the scan on the console above.
 */

const TOOLS = ['Headers', 'Nmap', 'Nuclei', 'ZAP', 'NVD'] as const

interface Row {
  title: string
  severity: 'high' | 'medium'
  seenBy: (typeof TOOLS)[number][]
}

/*
 * The verdict is a rank, not a yes/no.
 *
 * A binary "confirmed / not confirmed" throws away information the scan really
 * has: four tools agreeing is stronger evidence than two, and a high-severity
 * issue two tools saw outranks a medium two tools saw. Priority combines both,
 * which is exactly how a human triages.
 */
function verdictFor(row: Row): { label: string; tone: 'urgent' | 'strong' | 'likely' | 'single' } {
  const agreement = row.seenBy.length
  if (agreement >= 3) return { label: 'Do this first', tone: 'urgent' }
  if (agreement === 2 && row.severity === 'high') return { label: 'Do this first', tone: 'urgent' }
  if (agreement === 2) return { label: 'Worth fixing', tone: 'strong' }
  if (row.severity === 'high') return { label: 'Verify, then fix', tone: 'likely' }
  return { label: 'One source', tone: 'single' }
}

const TONE: Record<string, string> = {
  urgent: 'bg-phos text-[#03070B]',
  strong: 'border border-phos/50 bg-phos/12 text-phos',
  likely: 'border border-severity-medium/50 bg-severity-medium/10 text-severity-medium',
  single: 'border border-input text-[var(--dim-2)]',
}

const ROWS: Row[] = [
  { title: 'No Content-Security-Policy', severity: 'high', seenBy: ['Headers', 'ZAP'] },
  { title: 'Page can be framed by other sites', severity: 'medium', seenBy: ['Headers', 'ZAP'] },
  {
    title: 'Server version on show: Apache 2.4.7',
    severity: 'medium',
    seenBy: ['Headers', 'Nmap', 'ZAP', 'NVD'],
  },
  {
    title: 'Browsers allowed to guess file types',
    severity: 'medium',
    seenBy: ['Headers', 'ZAP'],
  },
  { title: 'Traffic sent unencrypted', severity: 'high', seenBy: ['Headers'] },
]

const RULES = [
  {
    title: 'Rules run first',
    body: 'Matching happens on a fixed list, not a model. The same scan always produces the same result.',
  },
  {
    title: "AI can't change a rating",
    body: 'Severity comes from scoring you can audit. A model may explain a finding or order the fixes;',
    negative: 'it cannot re-rate one.',
  },
  {
    title: 'No evidence, no merge',
    body: 'Two findings are only combined when both carry the tool output that proves them.',
  },
]

export function Triage() {
  return (
    <RevealOnScroll
      as="section"
      id="triage"
      className="section-y mx-auto max-w-[1180px] scroll-mt-20 px-6"
    >
      <div className="max-w-[var(--measure)]">
        <p className="mb-3 font-mono text-[10.5px] font-bold uppercase tracking-[0.15em] text-phos">
          The problem with scanners
        </p>
        <h2>
          You&apos;ve got five reports.{' '}
          <span className="text-phos">Which one do you fix first?</span>
        </h2>
        <p className="prose-measure mt-4 text-[15.5px] text-[var(--dim)]">
          Run five scanners yourself and you get five separate lists that overlap, disagree and
          repeat each other. VulnSight lines them up side by side. Anything{' '}
          <b className="font-semibold text-foreground">two or more tools found independently</b>{' '}
          goes to the top, and that&apos;s where your afternoon should go.
        </p>
      </div>

      {/*
        No plot here.

        This section used to open with a second coincidence plot, ~180px below
        the one already on the CRT console in the hero. Same five channels,
        same argument, twice. The console version won because it is a better
        object; its data and highlighting were improved instead, and this
        duplicate was deleted.
      */}
      <div className="mt-9 overflow-x-auto border border-border bg-card shadow-hard backdrop-blur-md">
        <table className="w-full min-w-[680px] border-collapse text-left">
          <thead>
            <tr className="bg-[#03070B]/50">
              <th className="px-4 py-3 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-[var(--dim-2)]">
                What was found
              </th>
              {TOOLS.map((tool) => (
                <th
                  key={tool}
                  className="w-[60px] px-2.5 py-3 text-center font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-[var(--dim-2)]"
                >
                  {tool}
                </th>
              ))}
              <th className="w-[112px] px-2.5 py-3 text-center font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-[var(--dim-2)]">
                Priority
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const verdict = verdictFor(row)
              return (
                <tr key={row.title} className="row-scan border-t border-border hover:bg-secondary">
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2.5 text-sm">
                      <i
                        aria-hidden="true"
                        className={cn(
                          'h-[17px] w-1 shrink-0',
                          row.severity === 'high' ? 'bg-severity-high' : 'bg-severity-medium',
                        )}
                      />
                      {row.title}
                    </span>
                  </td>
                  {TOOLS.map((tool) => {
                    const hit = row.seenBy.includes(tool)
                    return (
                      <td key={tool} className="px-2.5 py-3 text-center">
                        <span className="sr-only">
                          {hit ? `${tool} found this` : `${tool} did not find this`}
                        </span>
                        {hit ? (
                          <i
                            aria-hidden="true"
                            className="inline-block size-2.5 bg-phos"
                            style={{ boxShadow: '0 0 6px rgba(103,232,176,.5)' }}
                          />
                        ) : (
                          <i
                            aria-hidden="true"
                            className="inline-block h-px w-2.5 bg-[var(--dim-2)] align-middle opacity-60"
                          />
                        )}
                      </td>
                    )
                  })}
                  <td className="px-2.5 py-3 text-center">
                    <span
                      className={cn(
                        'inline-block whitespace-nowrap px-1.5 py-0.5 font-mono text-[9.5px] font-bold tracking-[0.06em]',
                        TONE[verdict.tone],
                      )}
                    >
                      {verdict.label}
                    </span>
                    <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--dim-2)]">
                      {row.seenBy.length} of {TOOLS.length} agree
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="border-t border-border bg-[#03070B]/35 px-4 py-3 font-mono text-[10px] tracking-[0.06em] text-[var(--dim-2)]">
          Real output from the sample scan in the console above.{' '}
          <b className="text-phos">19 raw observations</b> became{' '}
          <b className="text-phos">15 findings</b>, <b className="text-phos">4 corroborated</b>.
        </p>
      </div>

      <div className="mt-3.5 grid gap-3.5 md:grid-cols-3">
        {RULES.map((rule) => (
          <div
            key={rule.title}
            className="lift border border-border bg-card p-4.5 shadow-hard backdrop-blur-md"
            style={{ padding: 18 }}
          >
            <h3 className="mb-2.5 font-display text-base leading-none">{rule.title}</h3>
            <p className="text-[13.5px] leading-[1.62] text-[var(--dim)]">
              {rule.body}
              {rule.negative && (
                <>
                  {' '}
                  <span className="font-semibold text-severity-critical">{rule.negative}</span>
                </>
              )}
            </p>
          </div>
        ))}
      </div>
    </RevealOnScroll>
  )
}
