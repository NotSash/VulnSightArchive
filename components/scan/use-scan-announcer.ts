'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * What a screen reader is told while a scan runs.
 *
 * A deep scan takes about four minutes, and for all of it the page said
 * nothing at all: no `aria-live`, no `role="status"`, no `role="progressbar"`.
 * Someone using a screen reader got silence and had no way to know whether the
 * scan was working, stuck, or finished.
 *
 * Two rules govern what is said.
 *
 * **Never invent a number.** The visual progress line deliberately refuses to
 * fabricate a percentage for a step whose duration nobody knows, so the spoken
 * version must not either. It says "step 12 of 15", which the server actually
 * reports, and never "80% complete".
 *
 * **Never read a backlog.** Polling runs every 1.2 seconds and the early steps
 * settle in milliseconds. Announcing each one queues a pile of stale sentences
 * that a screen reader then reads out long after the scan has moved on, so the
 * user is always hearing the past. The throttle below keeps announcements at
 * most one per `MIN_GAP_MS`, and always drops the older message rather than
 * queueing it, so what you hear is the present.
 */

/**
 * Shortest gap between two spoken updates, in milliseconds.
 *
 * Long enough that a screen reader can finish a sentence before the next one
 * replaces it, short enough that a step lasting a few seconds is still
 * mentioned. Nuclei alone runs about 90 seconds, so nothing is missed by
 * waiting a few seconds to speak.
 */
export const MIN_GAP_MS = 4000

export interface AnnouncementInput {
  /** Server-reported lifecycle: running, completed, failed. */
  status: string | undefined
  /** Human name of the step in flight, as the server named it. */
  stage: string | undefined
  /** Steps the server has actually settled: completed or skipped. */
  done: number
  /** Total steps in this mode, seeded up front so it never changes mid-scan. */
  total: number
  /** How many findings have surfaced so far. */
  findingCount: number
  /** Typical duration of this step, or null when there is nothing honest to say. */
  typical: string | null
}

/**
 * The sentence to speak for a given scan state.
 *
 * Pure, so the wording can be asserted directly in a test rather than
 * inferred from a rendered tree.
 */
export function announcementFor(input: AnnouncementInput): string {
  const { status, stage, done, total, findingCount, typical } = input

  if (status === 'completed') {
    return `Scan complete. ${countPhrase(findingCount)} found. Opening the report.`
  }
  if (status === 'failed') {
    return 'The scan stopped before it finished. Details are on the page.'
  }
  if (!stage) return 'Starting the scan.'

  const step = `Step ${Math.min(done + 1, total)} of ${total}`
  const duration = typical ? `, usually ${typical}` : ''
  const found = findingCount > 0 ? `. ${countPhrase(findingCount)} so far` : ''
  return `${step}: ${stage}${duration}${found}.`
}

function countPhrase(n: number): string {
  if (n === 0) return 'No findings'
  return n === 1 ? '1 finding' : `${n} findings`
}

/**
 * Throttled live-region text.
 *
 * Returns the string that should currently sit inside the `aria-live` element.
 * It changes at most once every `MIN_GAP_MS`, except for terminal states,
 * which are always spoken immediately: finishing or failing is exactly the
 * moment a user must not be left waiting.
 */
export function useScanAnnouncer(input: AnnouncementInput): string {
  const [spoken, setSpoken] = useState('')
  const lastAt = useRef(0)
  const pending = useRef('')

  const message = announcementFor(input)
  const terminal = input.status === 'completed' || input.status === 'failed'
  pending.current = message

  useEffect(() => {
    if (message === spoken) return

    // Terminal states jump the queue. Everything else waits its turn.
    if (terminal) {
      lastAt.current = Date.now()
      setSpoken(message)
      return
    }

    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastAt.current))
    if (wait === 0) {
      lastAt.current = Date.now()
      setSpoken(message)
      return
    }

    /*
     * Speak whatever is current when the timer fires, not what was current
     * when it was set. That is the difference between an announcement and a
     * backlog: several steps may settle inside one gap, and only the latest
     * is worth hearing.
     */
    const timer = setTimeout(() => {
      lastAt.current = Date.now()
      setSpoken(pending.current)
    }, wait)
    return () => clearTimeout(timer)
  }, [message, spoken, terminal])

  return spoken
}
