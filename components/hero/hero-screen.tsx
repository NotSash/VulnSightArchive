'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'
import { BrandLogo } from '@/components/brand-logo'
import { MobileNav } from '@/components/mobile-nav'
import { HeroCanvas } from './hero-canvas'
import { LastTrainClock } from './last-train-clock'

const NAV = [
  { label: 'Why trust it', href: '#triage' },
  { label: 'How it works', href: '#how' },
  { label: "What it won't do", href: '#limits' },
]

/**
 * The full-viewport opening screen.
 *
 * Its only job is to make someone stop and look. The working part of the site
 * begins immediately below it, unchanged. That split is what lets the artwork
 * be ambitious: it never has to share a screen with a form, and the form never
 * has to compete with a city.
 *
 * The button does NOT start a scan. It scrolls to the real scan bar. Two live
 * calls to action above the fold was the redundancy this replaced, and a button
 * that merely looks like the thing below it would be a control promising an
 * action it cannot perform.
 *
 * All copy is real DOM, never painted into the canvas, so it stays selectable,
 * translatable, searchable and visible to a screen reader.
 */
export function HeroScreen() {
  const [countdown, setCountdown] = useState(0)

  const goToScan = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById('start')
    if (!target) return // let the plain #start anchor do its job
    e.preventDefault()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    // Move focus as well as the viewport. Scrolling alone leaves a keyboard
    // user's focus stranded up here, so the next Tab would jump back.
    target.setAttribute('tabindex', '-1')
    target.focus({ preventScroll: true })
  }, [])

  return (
    <section
      aria-label="VulnSight"
      data-hero-screen=""
      className="relative isolate flex min-h-[600px] w-full flex-col overflow-hidden"
    >
      <HeroCanvas onTrainCountdown={setCountdown} />

      {/* A soft column of shade behind the copy. The scene is busiest exactly
          where the words sit, and without this the trust line and the scroll
          cue land on lit shopfronts and become unreadable. */}
      <div
        aria-hidden="true"
        data-decorative="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 54% 66% at 50% 36%, rgba(4,8,13,.62) 0%, rgba(4,8,13,.34) 48%, rgba(4,8,13,0) 74%)',
        }}
      />
      {/* Keeps the top bar legible against whatever sky is behind it. */}
      <div
        aria-hidden="true"
        data-decorative="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-28"
        style={{ background: 'linear-gradient(180deg,rgba(4,7,12,.92),rgba(4,7,12,0))' }}
      />

      {/* This bar is not sticky. The real SiteHeader lives below the fold and
          takes over once this has scrolled away, so only one is ever visible. */}
      <div
        data-hero-chrome=""
        className="relative z-10 mx-auto flex h-[62px] w-full max-w-[1180px] items-center gap-4 px-6 2xl:max-w-[1600px] 2xl:px-10"
      >
        <Link
          href="/"
          aria-label="VulnSight home"
          // 44px of hit area, without shifting the mark: the negative margin
          // cancels the padding that creates the target.
          className="-m-2 flex min-h-11 shrink-0 items-center p-2"
        >
          <BrandLogo />
        </Link>
        <nav className="ml-2 hidden items-center gap-0.5 lg:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="border border-transparent px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--dim)] transition-colors hover:border-border hover:bg-card/70 hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <LastTrainClock seconds={countdown} />
          {/*
            The hero's own bar needs the menu too. It is the first thing a
            phone visitor sees, and until the artwork scrolls away the real
            header is deliberately parked off screen, so without this there is
            no navigation at all above the fold.
          */}
          <MobileNav items={NAV}>
            {(close) => (
              /* biome-ignore lint/a11y/useValidAnchor: genuine in-page
                navigation, same as the hero's main call to action below. The
                href is a real fragment, so it works with JavaScript disabled
                and can be opened in a new tab; the handler only upgrades it to
                a smooth scroll and moves focus. */
              <a
                href="#start"
                onClick={(e) => {
                  close()
                  goToScan(e)
                }}
                className="press flex min-h-12 items-center justify-center gap-2 bg-phos px-4 font-mono text-[12px] font-bold uppercase tracking-[0.07em] text-[#03070B] transition-colors hover:bg-[#7DF0BF]"
              >
                Scan a site
              </a>
            )}
          </MobileNav>
        </div>
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.42em] text-phos sm:text-[13px]">
          Five scanners. One verdict.
        </p>

        <h1 className="mt-5 text-[clamp(56px,13vw,150px)] leading-[0.92] tracking-[0.01em] text-foreground [text-shadow:0_4px_0_rgba(2,8,14,0.55)]">
          VulnSight
        </h1>
        {/* The underline is filled to 62%, the way a scan in progress reads. */}
        <div aria-hidden="true" className="mt-1.5 h-1 w-[min(72vw,620px)] bg-[#103428]">
          <div className="h-full w-[62%] bg-phos" />
        </div>

        <p className="mt-7 max-w-[34em] text-[15px] leading-[1.62] text-[var(--dim)] sm:text-[19px]">
          Point it at your site. It only calls something a problem when more than one scanner
          agrees.
        </p>

        {/* biome-ignore lint/a11y/useValidAnchor: this is genuine in-page
            navigation. The href is a real fragment, so it works with
            JavaScript disabled and can be opened in a new tab; the handler
            only upgrades it to a smooth scroll and moves focus. A <button>
            would lose the no-JS fallback for the hero's only call to action. */}
        <a
          href="#start"
          onClick={goToScan}
          className="press mt-9 inline-flex items-center gap-3 bg-phos px-9 py-4 text-[17px] font-semibold text-[#03070B] shadow-[0_5px_0_#062419] transition-colors hover:bg-[#7DF0BF] sm:text-[19px]"
        >
          See how it works
          <svg
            aria-hidden="true"
            width="13"
            height="9"
            viewBox="0 0 13 9"
            fill="none"
            className="translate-y-px"
          >
            <path d="M1 1.5 6.5 7 12 1.5" stroke="currentColor" strokeWidth="2.2" />
          </svg>
        </a>

        {/* Sat directly on the lit shopfront row and was unreadable. It now
            carries its own dark plate rather than relying on the page scrim,
            which cannot be made heavier without dimming the whole city. */}
        <p className="mt-7 rounded-full bg-[#04080D]/70 px-4 py-1.5 font-mono text-[10.5px] tracking-[0.08em] text-[var(--dim)] backdrop-blur-[2px] sm:text-[12px]">
          no signup · nothing installed · scans your own site only
        </p>
      </div>

      <div
        aria-hidden="true"
        data-hero-chrome=""
        className="relative z-10 flex flex-col items-center gap-2 pb-7"
      >
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.4em] text-[var(--dim-2)]">
          Scroll
        </span>
        <svg
          aria-hidden="true"
          focusable="false"
          width="20"
          height="22"
          viewBox="0 0 20 22"
          fill="none"
          className="scroll-cue"
        >
          <path d="M2 2 10 9 18 2" stroke="var(--phos)" strokeWidth="2" opacity="0.95" />
          <path d="M2 8 10 15 18 8" stroke="var(--phos)" strokeWidth="2" opacity="0.5" />
          <path d="M2 14 10 21 18 14" stroke="var(--phos)" strokeWidth="2" opacity="0.25" />
        </svg>
      </div>
    </section>
  )
}
