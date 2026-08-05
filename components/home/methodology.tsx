import { RevealOnScroll } from '@/components/reveal-on-scroll'

/**
 * What it does and what it refuses, plus the gaps from the sample scan.
 *
 * Showing what could *not* be checked is a selling point rather than an
 * apology: competitors report a clean pass where they simply didn't look.
 */
const DOES = [
  'Reads security headers, cookie settings and the HTTPS certificate',
  "Checks which ports are open and what's listening, with a time limit",
  'Runs known-weakness checks, low through critical',
  'Watches traffic passively with ZAP',
  'Looks up public CVEs for versions it actually saw',
]

const REFUSES = [
  'Guess passwords or try to log in',
  'Flood the site or knock it over',
  'Run exploits or send attack payloads',
  'Let ZAP switch into attack mode',
  'Let a model invent a finding or change its rating',
]

const GAPS: { tag: string; partial?: boolean; text: string }[] = [
  {
    tag: 'Partial',
    partial: true,
    text: "The HTTPS certificate wasn't checked: this site only answers on plain HTTP, and port 443 was closed.",
  },
  {
    tag: 'Skipped',
    text: "The optional AI review didn't run: no provider key is set up.",
  },
  {
    tag: 'Skipped',
    text: 'The written summary came from the rules instead of a model.',
  },
]

export function Methodology() {
  return (
    <RevealOnScroll
      as="section"
      id="limits"
      className="section-y mx-auto max-w-[1180px] scroll-mt-20 px-6"
    >
      <div className="max-w-[var(--measure)]">
        <p className="mb-3 font-mono text-[10.5px] font-bold uppercase tracking-[0.15em] text-phos">
          Safety
        </p>
        <h2>
          Checking, <span className="text-phos">not attacking</span>.
        </h2>
        <p className="prose-measure mt-4 text-[15.5px] text-[var(--dim)]">
          VulnSight uses the same tools a security professional would, kept to what is safe to run
          on a live site. Every scan needs your say-so, government and cloud-provider domains are
          refused outright, and there&apos;s a limit on how often you can scan.
        </p>
      </div>

      <div className="mt-7 grid gap-3.5 md:grid-cols-2">
        <div className="border border-border bg-card shadow-hard backdrop-blur-md">
          <div className="flex justify-between gap-2.5 border-b border-border bg-[#03070B]/55 px-3.5 py-2.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em]">
            <span className="text-phos">What it does</span>
            <span className="text-[var(--dim-2)]">Safe</span>
          </div>
          <ul className="px-4 pb-3.5 pt-1.5">
            {DOES.map((item, i) => (
              <li
                key={item}
                className={`flex gap-2.5 py-2.5 text-[13.5px] text-[var(--dim)] ${
                  i < DOES.length - 1 ? 'border-b border-border' : ''
                }`}
              >
                <span aria-hidden="true" className="w-3 shrink-0 font-mono font-bold text-phos">
                  +
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="border border-border bg-card shadow-hard backdrop-blur-md">
          <div className="flex justify-between gap-2.5 border-b border-border bg-[#03070B]/55 px-3.5 py-2.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em]">
            <span className="text-severity-critical">What it never does</span>
            <span className="text-[var(--dim-2)]">Refused</span>
          </div>
          <ul className="px-4 pb-3.5 pt-1.5">
            {REFUSES.map((item, i) => (
              <li
                key={item}
                className={`flex gap-2.5 py-2.5 text-[13.5px] text-[var(--dim)] ${
                  i < REFUSES.length - 1 ? 'border-b border-border' : ''
                }`}
              >
                <span
                  aria-hidden="true"
                  className="w-3 shrink-0 font-mono font-bold text-severity-critical"
                >
                  &minus;
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-3.5 border border-border bg-card shadow-hard backdrop-blur-md">
        <div className="flex justify-between gap-2.5 border-b border-border bg-[#03070B]/55 px-3.5 py-2.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-[var(--dim)]">
          <span>What this scan couldn&apos;t check</span>
          <span>Reported, not hidden</span>
        </div>
        {GAPS.map((gap, i) => (
          <div
            key={gap.text}
            className={`grid grid-cols-[96px_1fr] gap-3.5 px-4 py-3 text-[13.5px] text-[var(--dim)] ${
              i > 0 ? 'border-t border-border' : ''
            }`}
          >
            <span
              className={`h-fit px-1.5 py-0.5 text-center font-mono text-[9.5px] font-bold uppercase tracking-[0.08em] ${
                gap.partial
                  ? 'bg-severity-medium text-[#03070B]'
                  : 'border border-input text-[var(--dim-2)]'
              }`}
            >
              {gap.tag}
            </span>
            <span>{gap.text}</span>
          </div>
        ))}
      </div>
    </RevealOnScroll>
  )
}
