import { RevealOnScroll } from '@/components/reveal-on-scroll'

/**
 * Proof rather than a promise: the command that ran, and one finding with the
 * tools that saw it. Both are verbatim from the sample scan.
 */
export function Evidence() {
  return (
    <RevealOnScroll
      as="section"
      className="section-y section-y-continued mx-auto max-w-[1180px] px-6"
    >
      <div className="grid gap-3.5 lg:grid-cols-[1.25fr_1fr]">
        <div className="border border-border bg-card shadow-hard backdrop-blur-md">
          <div className="flex justify-between gap-2.5 border-b border-border bg-[#03070B]/55 px-3.5 py-2.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-[var(--dim)]">
            <span>The exact command we ran</span>
            <span>Step 4</span>
          </div>
          <div className="scanlines relative bg-[rgba(4,9,14,0.85)] p-3.5">
            <pre className="whitespace-pre-wrap break-all font-mono text-[11.5px] leading-[1.95] text-[var(--dim)]">
              <span className="text-[var(--dim-2)]">$</span>{' '}
              <span className="text-foreground">nuclei</span> -u http://scanme.nmap.org/ \{'\n'}
              {'    '}-jsonl -silent -no-color \{'\n'}
              {'    '}-severity{' '}
              <span className="text-foreground">&apos;low,medium,high,critical&apos;</span> \{'\n'}
              {'    '}-timeout 8 -retries 1 \{'\n'}
              {'    '}-rate-limit <span className="text-foreground">50</span> -concurrency{' '}
              <span className="text-foreground">25</span> \{'\n'}
              {'    '}-bulk-size 25 -templates /opt/nuclei-templates{'\n'}
              {'\n'}
              <span className="text-[var(--dim-2)]"># finished in 154s of a 420s budget</span>
              {'\n'}
              <span className="text-phos">nothing was cut short</span>
            </pre>
          </div>
        </div>

        <div className="border border-border bg-card shadow-hard backdrop-blur-md">
          <div className="flex justify-between gap-2.5 border-b border-border bg-[#03070B]/55 px-3.5 py-2.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-[var(--dim)]">
            <span>Server version on show</span>
            <span>Found by 4</span>
          </div>
          <dl className="px-3.5 pb-3.5 pt-1.5">
            {[
              ['Software', 'Apache httpd 2.4.7'],
              ['Found by', 'Headers, Nmap, ZAP, NVD'],
              ['Where', 'port 80'],
              ['Known flaw', 'CVE-2021-44224 · 8.2'],
              ['Rating', 'Medium'],
            ].map(([label, value], i, arr) => (
              <div
                key={label}
                className={`flex justify-between gap-3 py-2.5 text-[13.5px] ${
                  i < arr.length - 1 ? 'border-b border-border' : ''
                }`}
              >
                <dt className="font-mono text-[9.5px] font-bold uppercase tracking-[0.09em] text-[var(--dim-2)]">
                  {label}
                </dt>
                <dd
                  className={`text-right font-semibold ${
                    label === 'Known flaw'
                      ? 'font-mono text-severity-high'
                      : label === 'Where'
                        ? 'font-mono'
                        : ''
                  }`}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </RevealOnScroll>
  )
}
