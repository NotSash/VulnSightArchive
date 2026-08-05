'use client'

import Link from 'next/link'
import { BrandLogo } from '@/components/brand-logo'
import { MobileNav } from '@/components/mobile-nav'
import { useScanBar } from '@/components/scan/scan-bar-context'
import { useHeaderReveal } from '@/components/use-header-reveal'
import { isDemoMode } from '@/lib/demo-mode'
import { cn } from '@/lib/utils'

const NAV = [
  { label: 'Why trust it', href: '/#triage' },
  { label: 'How it works', href: '/#how' },
  { label: "What it won't do", href: '/#limits' },
]

/**
 * The site header.
 *
 * It carries nothing pressable until the hero form scrolls away; then the
 * *real* input slides in, sharing its state. A header button that merely
 * jumped you back to a form elsewhere on the page would be a control that
 * promises an action it cannot perform.
 *
 * **Why this is `fixed` and not `sticky`.**
 *
 * The home page puts the artwork screen first and the working page second,
 * inside a wrapper that begins below the fold. A `sticky` element only pins
 * once its own scroll container reaches the top, so on the way down this bar
 * travelled *with* the page and appeared as a second, floating navigation bar
 * halfway through the hero artwork, while the hero's own bar was still on
 * screen above it. Two identical logos and two identical menus, neither
 * attached to anything.
 *
 * `fixed` takes it out of flow entirely, so it is positioned against the
 * viewport rather than its container and can never drift into the middle of
 * the page. Being out of flow, it no longer occupies space, so the page needs
 * `--header-h` of padding where it used to sit: see `usesFixedOffset`.
 *
 * It is then hidden until the artwork has actually gone, so exactly one bar is
 * visible at any scroll position. See `useHeaderReveal`.
 */
export function SiteHeader() {
  const {
    url,
    setUrl,
    blockedReason,
    buttonLabel,
    buttonTone,
    submit,
    submitting,
    docked,
    requestAuth,
    focusHero,
  } = useScanBar()

  const revealed = useHeaderReveal()

  return (
    <header
      data-site-header=""
      data-revealed={revealed}
      /*
       * Hidden, and inert, until the hero artwork has scrolled away.
       *
       * `-translate-y-full` slides it up out of view rather than unmounting it,
       * so the docked scan input keeps its state and the bar can glide back
       * down instead of snapping into existence. `invisible` removes it from
       * the accessibility tree and from hit testing while it is parked, so a
       * keyboard user cannot tab into a header they cannot see.
       */
      className={cn(
        'fixed inset-x-0 top-0 z-50 border-b border-border bg-[#070C12]/85 backdrop-blur-xl',
        'transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none',
        revealed ? 'translate-y-0 opacity-100' : 'invisible -translate-y-full opacity-0',
      )}
    >
      {/*
        Chrome widens past 1536px; reading columns do not.
        
        Every container on the site was capped at 1180px, so on a 2560px
        display the logo sat 690px in from the edge of the window with nothing
        beside it, and the bar read as marooned rather than as the top of the
        page. A header is chrome, not prose: it has no measure to protect and
        it belongs to the window it spans.
        
        Still bounded at 1600px rather than full width, because on a 3440px
        ultrawide the logo and the actions would end up so far apart they stop
        reading as one object. The body columns keep their 1180px cap, since a
        long line of prose is genuinely harder to read.
      */}
      <div className="mx-auto flex h-[62px] max-w-[1180px] items-center gap-4 px-4 sm:px-6 2xl:max-w-[1600px] 2xl:px-10">
        <Link
          href="/"
          aria-label="VulnSight home"
          // 44px of hit area without moving the mark: the negative margin
          // cancels the padding that creates the target.
          className="-m-2 flex min-h-11 shrink-0 items-center p-2"
        >
          <BrandLogo />
        </Link>

        <nav className="ml-2 hidden items-center gap-0.5 lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="border border-transparent px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--dim)] transition-colors hover:border-border hover:bg-card hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <span className="flex-1" />

        {/*
          Navigation on a phone, where the row above is `hidden lg:flex` and
          the docked form below is `hidden ... lg:flex`, so without this a
          narrow viewport has no menu and no way to start a scan after the
          hero has scrolled away. The sheet carries both.
        */}
        <MobileNav items={NAV}>
          {(close) =>
            isDemoMode() ? (
              <Link
                href="/results/sample"
                onClick={close}
                className="press flex min-h-12 items-center justify-center gap-2 bg-phos px-4 font-mono text-[12px] font-bold uppercase tracking-[0.07em] text-[#03070B] transition-colors hover:bg-[#7DF0BF]"
              >
                Open the sample report
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => {
                  close()
                  focusHero()
                }}
                className="press flex min-h-12 w-full items-center justify-center gap-2 bg-phos px-4 font-mono text-[12px] font-bold uppercase tracking-[0.07em] text-[#03070B] transition-colors hover:bg-[#7DF0BF]"
              >
                Scan a site
              </button>
            )
          }
        </MobileNav>

        {/*
          In demo mode the docked bar becomes a link to the sample report.
          Leaving a working input here would defeat the point of replacing the
          hero form: the header control docks in as soon as the hero scrolls
          away, so a visitor would meet a live-looking scan box a screen later.
        */}
        {isDemoMode() ? (
          <Link
            href="/results/sample"
            className="press hidden items-center gap-2 bg-phos px-3.5 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-[#03070B] transition-colors hover:bg-[#7DF0BF] lg:inline-flex"
          >
            Sample report
            <svg
              aria-hidden="true"
              width="13"
              height="9"
              viewBox="0 0 13 9"
              fill="none"
              className="-rotate-90"
            >
              <path d="M1 1.5 6.5 7 12 1.5" stroke="currentColor" strokeWidth="2.2" />
            </svg>
          </Link>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (blockedReason === 'not-authorised') {
                // Send them to the checkbox and flash it, rather than failing
                // silently or merely stating the problem.
                requestAuth()
                return
              }
              if (blockedReason === 'no-target') {
                // Nothing to scan yet: put the cursor where the answer goes.
                focusHero()
                return
              }
              void submit()
            }}
            aria-hidden={!docked}
            className={cn(
              'hidden items-center transition-all duration-200 lg:flex',
              docked
                ? 'pointer-events-auto translate-y-0 opacity-100'
                : 'pointer-events-none -translate-y-2 opacity-0',
            )}
          >
            {/* Same treatment as the hero field, so the docked bar is recognisably
              the same control rather than a plainer copy of it. */}
            <span className="scan-field flex p-px">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="yoursite.com"
                aria-label="Address of the site to scan"
                spellCheck={false}
                tabIndex={docked ? 0 : -1}
                // 16px minimum or iOS Safari zooms the page on focus. This bar
                // is `lg:flex` today, but the rule travels with the control.
                className="w-[200px] bg-[#050A10] px-2.5 py-2 font-mono text-[16px] text-foreground outline-none placeholder:text-[var(--dim-2)] lg:text-[12.5px]"
              />
              <button
                type="submit"
                tabIndex={docked ? 0 : -1}
                aria-disabled={blockedReason !== null || submitting}
                className={cn(
                  'relative whitespace-nowrap px-3.5 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.07em] transition-colors',
                  buttonTone,
                )}
              >
                <span className="relative z-10">
                  {blockedReason === 'not-authorised' ? 'Tick the box below' : buttonLabel}
                </span>
              </button>
            </span>
          </form>
        )}
      </div>
    </header>
  )
}
