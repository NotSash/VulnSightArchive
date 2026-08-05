'use client'

import { useEffect, useState } from 'react'

/**
 * Tells the reader what is happening while a long step runs.
 *
 * The earlier copy here said "safe to close this tab", which was wrong: the
 * scan opens no new tab, so closing it closes the whole site. What someone
 * actually needs during a three-minute Nuclei run is reassurance that a long
 * wait is normal, and something to learn while they wait.
 *
 * Lines are keyed to the running stage and rotate slowly. Every line is a
 * plain statement of fact about what the tool is doing — no filler.
 */

const LINES: Record<string, string[]> = {
  nuclei: [
    'This is the long one. Thousands of individual checks run against the site, one at a time.',
    'Each check is a small recipe: send this request, look for that response. Nothing is attacked.',
    'Most sites match none of them. Finding nothing here is a good result, not a failed scan.',
    'Requests are rate-limited so the scan never behaves like a flood.',
  ],
  nmap: [
    'Checking which network ports answer, and what software is listening on each.',
    'Only the 3,000 most common ports are tried, with a time limit, so this stays polite.',
    'A port that answers is not automatically a problem. It is a fact to explain.',
  ],
  browser: [
    'Loading the page in a real Chromium browser, exactly as a visitor would.',
    'This catches anything added by JavaScript that a plain HTTP request would miss.',
  ],
  zap: [
    'Reading the traffic already collected. Nothing new is sent and nothing is crawled.',
    'This is a second opinion on the headers. Where two tools agree, the finding is stronger.',
  ],
  nvd: [
    'Looking up published vulnerabilities for the exact software versions found.',
    'Only versions actually observed are queried, so nothing here is guesswork.',
  ],
  default: [
    'Collecting the basics: DNS, redirects, response headers and how traffic travels.',
    'Every step records what it saw, so each finding in the report carries its evidence.',
  ],
}

function keyForStage(stage: string): keyof typeof LINES {
  const s = stage.toLowerCase()
  if (s.includes('nuclei') || s.includes('template')) return 'nuclei'
  if (s.includes('nmap') || s.includes('port')) return 'nmap'
  if (s.includes('render') || s.includes('playwright') || s.includes('browser')) return 'browser'
  if (s.includes('zap') || s.includes('passive')) return 'zap'
  if (s.includes('cve') || s.includes('nvd')) return 'nvd'
  return 'default'
}

export function StageCommentary({ stage }: { stage: string }) {
  const key = keyForStage(stage)
  const lines = LINES[key] ?? LINES.default
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)

  // Restart the rotation whenever the stage changes.
  useEffect(() => {
    setIndex(0)
    setVisible(true)
  }, [])

  useEffect(() => {
    if (lines.length <= 1) return
    const timer = setInterval(() => {
      // Fade out, swap, fade back in — a hard cut mid-sentence is jarring.
      setVisible(false)
      setTimeout(() => {
        setIndex((i) => (i + 1) % lines.length)
        setVisible(true)
      }, 260)
    }, 6000)
    return () => clearInterval(timer)
  }, [lines])

  return (
    <p
      /*
       * Deliberately not a live region.
       *
       * This text rotates every 6 seconds and says nothing a screen-reader
       * user needs: it is atmosphere for people watching the lamps. As a live
       * region it talked over the one announcement that matters, the actual
       * stage progress in `scan-progress.tsx`, and recited a new sentence
       * every 6 seconds for four minutes.
       */
      aria-hidden="true"
      className="text-[13px] leading-relaxed text-[var(--dim)] transition-opacity duration-200"
      style={{ opacity: visible ? 1 : 0 }}
    >
      {lines[index]}
    </p>
  )
}
