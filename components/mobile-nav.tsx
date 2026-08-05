'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

/**
 * Navigation on a phone.
 *
 * There was none. The header nav is `hidden lg:flex`, so at 390px the audit
 * measured **0 of 6 links visible**: "Why trust it", "How it works" and "What
 * it won't do" were simply unreachable on a phone, along with any way to start
 * a scan once the hero had scrolled by.
 *
 * A sheet rather than a dropdown, for two reasons. A dropdown anchored to a
 * 44px button puts its items under the thumb that just opened it, and it has
 * to guess a width; a full-width sheet gives every row the whole screen and a
 * comfortable height. And the sheet has room for the scan control, which is
 * the actual point: navigation is secondary here, but "let me scan something"
 * is the one thing the site is for.
 *
 * Deliberately not a `<dialog>`. The native element brings a top layer and its
 * own backdrop, which would sit above the fixed header and hide the close
 * button that opened it. This is a plain panel with the focus and dismissal
 * behaviour written out, which is less code than fighting the defaults.
 */

export interface NavItem {
  label: string
  href: string
}

export function MobileNav({
  items,
  className,
  children,
}: {
  items: readonly NavItem[]
  className?: string
  /**
   * Rendered at the foot of the sheet: the scan control, or a demo link.
   *
   * Given a `close` callback rather than a plain node, because whatever goes
   * in here navigates or scrolls, and a sheet still sitting open over the
   * destination is the most obvious possible bug.
   */
  children?: (close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  /*
   * Close on Escape, and give focus back to the button that opened it.
   *
   * Without the focus return, dismissing the sheet strands a keyboard user at
   * the top of the document and their next Tab starts from the beginning.
   */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  /*
   * Close when the viewport grows past the breakpoint where the real nav
   * appears. Rotating a phone to landscape can cross `lg`, and leaving an open
   * sheet over a header that now has its own visible menu is two navigations
   * at once, which is the bug Part 2 spent a session removing elsewhere.
   */
  useEffect(() => {
    if (!open) return
    const mq = window.matchMedia('(min-width: 1024px)')
    const sync = () => {
      if (mq.matches) setOpen(false)
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [open])

  /*
   * Stop the page behind the sheet from scrolling.
   *
   * Restores the previous value rather than clearing it, so this cannot
   * clobber an overflow set by something else.
   */
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  /* Move focus into the sheet when it opens, so Tab lands somewhere useful. */
  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLElement>('a, button, input')?.focus()
  }, [open])

  /*
   * The sheet is portalled to `<body>`, and it has to be.
   *
   * The hero section is `relative isolate ... overflow-hidden`, and the site
   * header is `backdrop-blur`. Each of those creates a containing block, and
   * `position: fixed` resolves against the nearest one rather than against the
   * viewport. Rendered in place, the sheet was clipped by the hero's
   * `overflow-hidden` and painted inside its stacking context, so the artwork
   * showed straight through the panel and the scrim covered nothing.
   *
   * Mounting is tracked so the first server render and the first client render
   * agree: `createPortal` cannot run during SSR, and rendering the panel on
   * the server but not on the client is a hydration mismatch.
   */
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const overlay = (
    <>
      {/*
        Scrim. Tapping anywhere off the sheet closes it, which is the gesture
        people already expect from every app they use. `aria-hidden` because
        the same dismissal is available from the button and from Escape, so it
        would only be noise in the accessibility tree.
      */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => setOpen(false)}
        className={cn(
          'fixed inset-0 top-[62px] z-40 bg-[#03070B]/70 backdrop-blur-sm transition-opacity duration-200 motion-reduce:transition-none',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      <div
        ref={panelRef}
        id={panelId}
        // Hidden from assistive tech while closed, so its links are not
        // announced or tabbable behind a sheet nobody has opened.
        inert={!open}
        className={cn(
          'fixed inset-x-0 top-[62px] z-40 max-h-[calc(100dvh-62px)] overflow-y-auto border-b border-border bg-[#070C12]/97 backdrop-blur-xl',
          'transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none',
          open ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-3 opacity-0',
        )}
      >
        <nav aria-label="Main" className="px-4 py-2">
          <ul>
            {items.map((item) => (
              <li key={item.href} className="border-b border-border/60 last:border-b-0">
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  // `min-h-14` rather than 11: a full-width row in a sheet is
                  // the one place generosity costs nothing, and 56px is the
                  // height a native list row uses.
                  className="flex min-h-14 items-center text-[15px] text-foreground transition-colors hover:text-phos"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {children ? (
          <div className="border-t border-border px-4 py-4">{children(() => setOpen(false))}</div>
        ) : null}
      </div>
    </>
  )

  return (
    <div className={cn('lg:hidden', className)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? 'Close menu' : 'Open menu'}
        // 44px square, the minimum comfortable touch target.
        className="flex size-11 items-center justify-center border border-border bg-card/60 text-foreground transition-colors hover:border-phos hover:text-phos"
      >
        {/*
          The bars become an X. Two of the three rotate onto each other and the
          middle one fades, so the control animates between its two states
          instead of swapping icon for icon.
        */}
        <span aria-hidden="true" className="relative block h-[13px] w-[18px]">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={cn(
                'absolute left-0 block h-[2px] w-full bg-current transition-all duration-200 motion-reduce:transition-none',
                i === 0 && (open ? 'top-[5.5px] rotate-45' : 'top-0'),
                i === 1 && (open ? 'top-[5.5px] opacity-0' : 'top-[5.5px]'),
                i === 2 && (open ? 'top-[5.5px] -rotate-45' : 'top-[11px]'),
              )}
            />
          ))}
        </span>
      </button>

      {mounted && createPortal(overlay, document.body)}
    </div>
  )
}
