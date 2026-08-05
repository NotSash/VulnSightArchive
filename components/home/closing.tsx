import Link from 'next/link'
import { RevealOnScroll } from '@/components/reveal-on-scroll'

export function Closing() {
  return (
    <RevealOnScroll
      as="section"
      className="section-y section-y-continued mx-auto max-w-[1180px] px-6 text-center"
    >
      <h2>Read a finished report before you scan anything.</h2>
      <p className="prose-measure mx-auto mt-3.5 text-[15.5px] text-[var(--dim)]">
        Everything above came from one real scan. Here&apos;s the whole thing.
      </p>
      <Link
        href="/results/sample"
        className="press mt-6 inline-flex items-center gap-3 border border-phos bg-phos px-6 py-3.5 font-mono text-[12.5px] font-bold uppercase tracking-[0.07em] text-[#03070B]"
        style={{ boxShadow: '6px 6px 0 rgba(3,7,11,.85)' }}
      >
        Open the sample report &rarr;
      </Link>
    </RevealOnScroll>
  )
}
