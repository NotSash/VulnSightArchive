import { FieldCanvas } from '@/components/field-canvas'
import { HeroScreen } from '@/components/hero/hero-screen'
import { Closing } from '@/components/home/closing'
import { Evidence } from '@/components/home/evidence'
import { Hero } from '@/components/home/hero'
import { Methodology } from '@/components/home/methodology'
import { Pipeline } from '@/components/home/pipeline'
import { Triage } from '@/components/home/triage'
import { ScanBarProvider } from '@/components/scan/scan-bar-context'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'

export default function HomePage() {
  return (
    <ScanBarProvider>
      {/*
        Two halves.

        The first screen exists to make someone stop and look: a full viewport
        of animated pixel art with the name, one line, and one button. It holds
        no working controls at all.

        Everything below `#start` is the site as it was. Putting the artwork
        behind the working page would have buried it under dense copy, and
        putting a scan form on top of the artwork would have made both worse.
      */}
      <HeroScreen />

      {/* `relative` makes this the containing block for the field canvas, and
          `overflow-hidden` stops it painting outside. Both matter: while the
          canvas was fixed it covered the hero too, and its veil greyed out the
          whole city. */}
      <div id="start" className="relative overflow-hidden">
        {/* The calm field background belongs to the working half only. */}
        <FieldCanvas />
        <div className="relative z-[2] flex min-h-dvh flex-col">
          <SiteHeader />
          {/*
            The header is `fixed`, so it is out of flow and occupies no space.
            This spacer stands in its place, otherwise the first section would
            slide up under the bar once it reveals. It matches the header's
            62px height exactly. See the comment in `site-header.tsx` for why
            the header cannot simply be `sticky`.
          */}
          <div aria-hidden="true" className="h-[62px] shrink-0" />
          <main className="flex-1">
            <Hero />
            <div className="mx-auto max-w-[1180px] px-6">
              <hr className="rule-fade" />
            </div>
            <Triage />
            <div className="mx-auto max-w-[1180px] px-6">
              <hr className="rule-fade" />
            </div>
            <Pipeline />
            <Evidence />
            <div className="mx-auto max-w-[1180px] px-6">
              <hr className="rule-fade" />
            </div>
            <Methodology />
            <div className="mx-auto max-w-[1180px] px-6">
              <hr className="rule-fade" />
            </div>
            <Closing />
          </main>
          <SiteFooter />
        </div>
      </div>
    </ScanBarProvider>
  )
}
