'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { useScanBar } from '@/components/scan/scan-bar-context'
import { DrawCheckbox } from '@/components/ui/draw-checkbox'
import { DEMO_BANNER_BODY, DEMO_BANNER_TITLE, isDemoMode } from '@/lib/demo-mode'
import { cn } from '@/lib/utils'
import type { ScanMode } from '@/types/report'

/**
 * The one place a scan starts.
 *
 * Depth wording is deliberate: only the deepest mode runs Nuclei and ZAP, so
 * only it has enough independent tools to mark a finding "confirmed". Hiding
 * that would quietly undersell the product's whole differentiator, so the
 * picker says it plainly.
 */
const MODES: { value: ScanMode; label: string; blurb: string; time: string }[] = [
  {
    value: 'quick',
    label: 'Surface',
    blurb: 'Headers, certificate, and how the page really renders',
    time: '~30 sec',
  },
  {
    value: 'standard',
    label: 'Standard',
    blurb: 'Adds cookies, open ports, and known CVEs',
    time: '~2 min',
  },
  {
    value: 'comprehensive',
    label: 'Deep',
    blurb: 'Adds weakness templates and passive traffic analysis',
    time: '~4 min',
  },
]

const EXAMPLES = ['scanme.nmap.org', 'example.com']

export function ScanForm() {
  const {
    url,
    setUrl,
    mode,
    setMode,
    authorised,
    setAuthorised,
    submitting,
    blockedReason,
    buttonLabel,
    buttonTone,
    submit,
    heroRef,
    setDocked,
    nudgeAuth,
    requestAuth,
    focusHero,
  } = useScanBar()

  const authRef = useRef<HTMLDivElement>(null)
  const demo = isDemoMode()

  /*
   * The header form appears only once this one has left the viewport, so the
   * page never shows two competing controls for the same action.
   */
  useEffect(() => {
    const form = heroRef.current
    if (!form || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setDocked(!entry.isIntersecting), {
      rootMargin: '-70px 0px 0px 0px',
    })
    observer.observe(form)
    return () => observer.disconnect()
  }, [heroRef, setDocked])

  /*
   * On a preview deployment the form is replaced, not disabled.
   *
   * A greyed-out field still invites a click and still implies the feature is
   * one step away. Replacing it states the situation once, plainly, and offers
   * the thing the visitor actually wants: a finished report. The seeded sample
   * is real output from a real scan, so nothing here is a mock-up.
   *
   * `heroRef` is still attached, because the header's docking behaviour
   * observes it and would otherwise never fire on this page.
   */
  if (demo) {
    return (
      <div ref={heroRef as unknown as React.RefObject<HTMLDivElement>} className="mt-8 max-w-xl">
        <div className="border border-amber/50 bg-amber/[0.07] p-4">
          <p className="font-mono text-[9.5px] font-bold uppercase tracking-[0.13em] text-amber">
            {DEMO_BANNER_TITLE}
          </p>
          <p className="mt-2 text-[13.5px] leading-relaxed text-foreground">{DEMO_BANNER_BODY}</p>
          <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--dim)]">
            VulnSight drives nmap, nuclei, ZAP and a real browser, and a deep scan holds a CPU for
            about four minutes. That needs a server, not a preview host.
          </p>
          <Link
            href="/results/sample"
            className="press mt-4 inline-flex items-center gap-2 bg-phos px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.07em] text-[#03070B] transition-colors hover:bg-[#7DF0BF]"
          >
            Open the sample report
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
        </div>
      </div>
    )
  }

  return (
    <form
      ref={heroRef}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      className="mt-8 max-w-xl"
    >
      {/*
        The 1px padding is what makes the animated border visible: the children
        below paint an opaque surface, so only that 1px rim of the rotating
        gradient behind them ever shows.
      */}
      <div className="scan-field flex p-px shadow-hard">
        <span
          aria-hidden="true"
          className="flex items-center bg-[#050A10] px-3 font-mono text-sm text-phos"
        >
          &gt;
        </span>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="yoursite.com"
          aria-label="Address of the site to scan"
          spellCheck={false}
          autoComplete="url"
          /*
           * 16px on a phone, not 15.
           *
           * iOS Safari zooms the whole page in when a field smaller than 16px
           * receives focus, and it does not zoom back out. One pixel short, on
           * the primary control of the entire product: every iPhone visitor
           * began their first scan by fighting the zoom. The desktop size is
           * kept from `sm` up, where no such behaviour exists.
           */
          className="min-w-0 flex-1 bg-[#050A10] px-3 py-3.5 font-mono text-[16px] text-foreground outline-none placeholder:text-[var(--dim-2)] lg:text-[15px]"
        />
        {/*
          Not `disabled`: a disabled button swallows the click, so pressing it
          when blocked did nothing at all. It stays pressable and resolves its
          own blocker instead: an empty address focuses the field, a missing
          tick scrolls to the box and flashes it.
        */}
        <button
          type="submit"
          aria-disabled={blockedReason !== null || submitting}
          onClick={(e) => {
            if (blockedReason === 'not-authorised') {
              e.preventDefault()
              requestAuth()
            } else if (blockedReason === 'no-target') {
              e.preventDefault()
              focusHero()
            }
          }}
          className={cn(
            'relative whitespace-nowrap px-5 font-mono text-xs font-bold uppercase tracking-[0.07em] transition-colors',
            buttonTone,
          )}
        >
          <span className="relative z-10">{buttonLabel}</span>
        </button>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10.5px] tracking-[0.04em] text-[var(--dim-2)]">
          Try one:
        </span>
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setUrl(example)}
            className="inline-flex min-h-11 items-center border border-border bg-card px-3 font-mono text-[12.5px] text-[var(--dim)] transition-colors hover:border-phos hover:bg-phos/10 hover:text-phos lg:min-h-0 lg:px-2.5 lg:py-1 lg:text-[11px]"
          >
            {example}
          </button>
        ))}
      </div>

      <fieldset className="mt-5">
        <legend className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--dim-2)]">
          How deep should it look?
        </legend>
        <div className="mt-2.5 grid gap-1.5 sm:grid-cols-3">
          {MODES.map((option) => {
            const selected = mode === option.value
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setMode(option.value)}
                className={cn(
                  /*
                   * `active:scale` rather than `.press`: three of these sit
                   * side by side, and three hard offset shadows in a row reads
                   * as clutter. A depress is the right gesture for a panel you
                   * are choosing between, where a key-travel is right for a
                   * button you are firing.
                   *
                   * On touch this is the only feedback there is, since there
                   * is no hover to fall back on.
                   */
                  'press-soft border p-2.5 text-left transition-colors',
                  /*
                   * Hover has to be visible, not merely present.
                   *
                   * This was `hover:border-input`, which reads like a hover
                   * state and is not one: `--input` and `--border` resolve
                   * close enough that nothing perceptibly changes, and the
                   * selected option had no hover rule at all. Measured on all
                   * three: no change to border, background or colour. So the
                   * control that chooses how deep the scan goes gave no sign
                   * it could be clicked.
                   *
                   * Unselected lifts toward the accent, which is the same
                   * language the rest of the page uses for "this is
                   * pressable". Selected brightens its own fill rather than
                   * changing hue, so hovering the current choice cannot be
                   * mistaken for selecting a different one.
                   */
                  selected
                    ? 'border-phos bg-phos/10 hover:bg-phos/20'
                    : 'border-border bg-card hover:border-phos/50 hover:bg-phos/[0.06]',
                )}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      'font-display text-base leading-none',
                      selected ? 'text-phos' : 'text-foreground',
                    )}
                  >
                    {option.label}
                  </span>
                  {/* `--dim` rather than `--dim-2`: the selected option is
                      washed with phosphor, and the dimmer grey fell to
                      3.92:1 on it. */}
                  <span className="tnum font-mono text-[9.5px] text-[var(--dim)]">
                    {option.time}
                  </span>
                </span>
                <span className="mt-1.5 block text-[11.5px] leading-snug text-[var(--dim)]">
                  {option.blurb}
                </span>
              </button>
            )
          })}
        </div>
        {mode !== 'comprehensive' && (
          <p className="mt-2 text-[11.5px] leading-snug text-[var(--dim-2)]">
            Only <span className="text-[var(--dim)]">Deep</span> runs enough separate tools to
            cross-check findings, so nothing will be marked as confirmed by more than one scanner.
          </p>
        )}
      </fieldset>

      {/*
        Nothing runs until this is ticked, and it is easy to skip past as fine
        print, so it is presented as a required step: a solid panel, an amber
        marker while outstanding, and a large hit area. It settles to phosphor
        once satisfied so the form visibly reads as ready.
      */}
      {/*
        A plain container, not a <label>: DrawCheckbox owns a real input with
        its own aria-label and hit area. Wrapping it in a label that also points
        at it would make a direct click toggle twice and cancel itself out.
      */}
      <div
        ref={authRef}
        className={cn(
          'mt-4 flex max-w-[44em] cursor-pointer items-start gap-3 border p-3 transition-colors',
          authorised
            ? 'border-phos/45 bg-phos/[0.07]'
            : 'border-amber/55 bg-amber/[0.07] hover:bg-amber/[0.12]',
          nudgeAuth && 'auth-nudge',
        )}
      >
        <DrawCheckbox
          checked={authorised}
          onChange={setAuthorised}
          aria-label="I own this site, or I have written permission to test it"
          className="mt-px"
        />
        <span className="text-[13.5px] leading-snug">
          <span
            className={cn(
              'mb-1 block font-mono text-[9.5px] font-bold uppercase tracking-[0.11em]',
              authorised ? 'text-phos' : 'text-amber',
            )}
          >
            {authorised ? 'Confirmed' : 'Required before scanning'}
          </span>
          <span className={authorised ? 'text-[var(--dim)]' : 'text-foreground'}>
            I own this site, or I have written permission to test it.
          </span>{' '}
          <span className="text-[var(--dim-2)]">Every scan is logged.</span>
        </span>
      </div>
    </form>
  )
}
