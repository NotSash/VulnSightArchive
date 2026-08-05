import { CrtConsole } from '@/components/crt-console'
import { ScanHistory } from '@/components/home/scan-history'
import { ScanForm } from '@/components/scan/scan-form'

export function Hero() {
  return (
    <section className="mx-auto max-w-[1180px] px-6 pb-9 pt-14">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(300px,0.85fr)_1.15fr]">
        <div>
          <h1 className="text-[clamp(34px,4.1vw,52px)] leading-[1.14]">
            See what your site is <span className="text-phos">telling</span> the internet.
          </h1>
          <p className="mt-5 max-w-[31em] text-base leading-[1.68] text-[var(--dim)]">
            Five security scanners read your site the way an attacker would. VulnSight only calls
            something a problem when{' '}
            <b className="font-semibold text-foreground">more than one of them finds it</b>, so you
            get a short list worth acting on, not a wall of maybes.
          </p>

          <ScanForm />
          <ScanHistory />
        </div>

        <CrtConsole />
      </div>
    </section>
  )
}
