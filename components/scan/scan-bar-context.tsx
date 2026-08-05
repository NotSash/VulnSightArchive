'use client'

import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { ScanMode } from '@/types/report'

/**
 * One source of truth for starting a scan.
 *
 * The hero form and the header form are two views of the same state: typing in
 * either updates both, and only one is ever visible at a time. That is what
 * keeps the promise that no control on the page can lie — the thing in front of
 * you is always the thing that works.
 */

export interface ScanBarState {
  url: string
  setUrl: (value: string) => void
  mode: ScanMode
  setMode: (value: ScanMode) => void
  authorised: boolean
  setAuthorised: (value: boolean) => void
  submitting: boolean
  /** Null when the scan can start; otherwise why it cannot. */
  blockedReason: 'no-target' | 'not-authorised' | null
  /** Label for the primary button, which always names its own blocker. */
  buttonLabel: string
  /**
   * Class describing how the primary button should look right now.
   *
   * Derived here rather than at each button, so the hero control and the
   * docked header control can never drift apart. See the `.btn-*` block in
   * `globals.css` for what each state means.
   */
  buttonTone: string
  submit: () => Promise<void>
  /** True briefly after a blocked press, to highlight the authorisation box. */
  nudgeAuth: boolean
  /** Flags the authorisation box as the thing standing in the way. */
  requestAuth: () => void
  /** Registers the hero form so the header knows when to take over. */
  heroRef: React.RefObject<HTMLFormElement | null>
  /** True once the hero form has scrolled out of view. */
  docked: boolean
  setDocked: (value: boolean) => void
  focusHero: () => void
}

const ScanBarContext = createContext<ScanBarState | null>(null)

export function ScanBarProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<ScanMode>('comprehensive')
  const [authorised, setAuthorised] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [docked, setDocked] = useState(false)
  const heroRef = useRef<HTMLFormElement | null>(null)

  const blockedReason: ScanBarState['blockedReason'] = !url.trim()
    ? 'no-target'
    : !authorised
      ? 'not-authorised'
      : null

  /*
   * The blocked labels name the action that unblocks them, not the state.
   * "Confirm first" told the user nothing: they had no idea what to confirm,
   * and the checkbox was far enough down the page to be off screen. "Tick the
   * box below" says what to do and where.
   */
  const buttonLabel = submitting
    ? 'Starting…'
    : blockedReason === 'no-target'
      ? 'Enter a site'
      : blockedReason === 'not-authorised'
        ? 'Tick the box below'
        : 'Start scan'

  /*
   * Ready is the page accent; the two waiting states are colour-coded to their
   * own blocker; only work in flight gets the dead hatch, where it is honest.
   */
  const buttonTone = submitting
    ? 'btn-blocked'
    : blockedReason === 'no-target'
      ? 'btn-waiting'
      : blockedReason === 'not-authorised'
        ? 'btn-needs-auth'
        : 'press bg-phos text-[#03070B] hover:bg-[#7DF0BF]'

  /** Draws attention to the authorisation box after a blocked press. */
  const [nudgeAuth, setNudgeAuth] = useState(false)

  const focusHero = useCallback(() => {
    const form = heroRef.current
    if (!form) return
    const input = form.querySelector<HTMLInputElement>('input[type="text"]')
    form.scrollIntoView({ block: 'center', behavior: 'smooth' })
    /*
     * Focus after the scroll settles, not during it.
     *
     * Focusing an off-screen input makes the browser jump to it, which fights
     * the smooth scroll already in flight; some engines resolve that by
     * cancelling the scroll, others by dropping the focus. Measured on a
     * phone: the input arrived on screen but was not focused, so the keyboard
     * never opened and the visitor had to tap the field themselves.
     *
     * `preventScroll` because by this point the element is already where it
     * should be, and a second scroll would undo the eased one.
     */
    if (!input) return
    const settle = window.setTimeout(() => input.focus({ preventScroll: true }), 420)
    return () => window.clearTimeout(settle)
  }, [])

  /*
   * Called when someone presses a button that cannot act yet. Rather than doing
   * nothing, scroll the blocker into view and flash it, so the reason is
   * visible instead of merely stated.
   */
  const requestAuth = useCallback(() => {
    const form = heroRef.current
    form?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setNudgeAuth(true)
    setTimeout(() => setNudgeAuth(false), 1600)
  }, [])

  const submit = useCallback(async () => {
    if (blockedReason || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The API expects `scan_mode`, not `mode`.
        body: JSON.stringify({ url: url.trim(), scan_mode: mode, authorized: true }),
      })
      const data = (await res.json()) as { scan_id?: string; error?: string }

      if (!res.ok || !data.scan_id) {
        // Say what actually went wrong; never a generic failure.
        toast.error(data.error ?? 'The scan could not be started.')
        return
      }
      router.push(`/scan/${data.scan_id}`)
    } catch {
      toast.error('Could not reach the server. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }, [blockedReason, submitting, url, mode, router])

  const value = useMemo<ScanBarState>(
    () => ({
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
      nudgeAuth,
      requestAuth,
      submit,
      heroRef,
      docked,
      setDocked,
      focusHero,
    }),
    [
      url,
      mode,
      authorised,
      submitting,
      blockedReason,
      buttonLabel,
      buttonTone,
      nudgeAuth,
      requestAuth,
      submit,
      docked,
      focusHero,
    ],
  )

  return <ScanBarContext.Provider value={value}>{children}</ScanBarContext.Provider>
}

export function useScanBar(): ScanBarState {
  const ctx = useContext(ScanBarContext)
  if (!ctx) throw new Error('useScanBar must be used inside <ScanBarProvider>')
  return ctx
}
