import { Clock, Globe, MapPin, Server, Timer } from 'lucide-react'
import { MODE_LABEL } from '@/components/results/report-header'
import type { ScanReport } from '@/types/report'

/**
 * Context for the report: which host, which scan, and what the score is made
 * of.
 *
 * The score itself, the severity split and the "what to fix first" list live in
 * <Verdict> directly above. This section deliberately shows none of those
 * again — an earlier version repeated the gauge and the distribution chart
 * verbatim, which made the page look padded and buried the one thing the
 * reader wanted. What belongs here is what the Verdict *cannot* say: the exact
 * points deducted, and the identity of the target.
 */

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

function MetaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Globe
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2.5 last:border-b-0">
      <span className="flex items-center gap-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.09em] text-[var(--dim-2)]">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </span>
      <span className="truncate text-right text-[13px] font-medium">{value}</span>
    </div>
  )
}

export function ReportOverview({ report }: { report: ScanReport }) {
  const { metadata, website, risk } = report

  return (
    <section className="space-y-5">
      <div className="grid gap-3.5 lg:grid-cols-2">
        {/* How the score was reached: the audit trail behind the gauge. */}
        <div className="border border-border bg-card shadow-hard backdrop-blur-md">
          <div className="flex items-center justify-between gap-2.5 border-b border-border bg-[#03070B]/55 px-3.5 py-2.5">
            <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-[var(--dim)]">
              How the score was reached
            </span>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.09em] text-[var(--dim-2)]">
              Starts at 100
            </span>
          </div>
          <div className="px-3.5 py-3">
            {risk.penalties.length === 0 ? (
              <p className="py-2 text-[13px] text-[var(--dim)]">
                Nothing was deducted. No confirmed findings carried a penalty.
              </p>
            ) : (
              <ul>
                {risk.penalties.map((penalty) => (
                  <li
                    key={penalty.label}
                    className="flex items-center justify-between gap-4 border-b border-border py-2.5 text-[13px] last:border-b-0"
                  >
                    <span className="text-[var(--dim)]">{penalty.label}</span>
                    <span className="tnum shrink-0 font-mono text-[12.5px] font-bold text-severity-high">
                      &minus;{penalty.points}
                    </span>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-4 border-t-2 border-border pt-2.5 text-[13px]">
                  <span className="font-semibold">Final score</span>
                  <span className="tnum shrink-0 font-mono text-[13px] font-bold">
                    {risk.score} / 100
                  </span>
                </li>
              </ul>
            )}
          </div>
        </div>

        {/* Who was scanned. */}
        <div className="border border-border bg-card shadow-hard backdrop-blur-md">
          <div className="flex items-center justify-between gap-2.5 border-b border-border bg-[#03070B]/55 px-3.5 py-2.5">
            <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-[var(--dim)]">
              The target
            </span>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.09em] text-[var(--dim-2)]">
              {MODE_LABEL[metadata.scan_mode]}
            </span>
          </div>
          <div className="px-3.5 py-1.5">
            <MetaRow icon={Globe} label="Domain" value={website.domain} />
            <MetaRow icon={MapPin} label="IP address" value={website.ip_address} />
            <MetaRow icon={Server} label="Server" value={website.server} />
            <MetaRow icon={Timer} label="Duration" value={`${metadata.duration_seconds}s`} />
            <MetaRow icon={Clock} label="Scanned" value={formatTimestamp(metadata.timestamp)} />
          </div>
        </div>
      </div>
    </section>
  )
}
