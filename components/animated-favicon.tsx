'use client'

import { useEffect } from 'react'

/**
 * Animates the browser-tab icon with the same pulse as the brand mark.
 *
 * SVG favicons cannot animate: browsers deliberately freeze CSS animations and
 * SMIL inside them and render only the first frame. The reliable technique,
 * used by Gmail and Trello, is to draw each frame to a `<canvas>` and swap the
 * favicon's `href` to the resulting data URL.
 *
 * That means a timer and a DOM write per frame for something purely
 * decorative, so it is kept cheap:
 *
 * - 12fps, not 60. At 16x16 the difference is invisible and it is a fifth of
 *   the work.
 * - Paused entirely while the tab is hidden, which is most of the time and is
 *   also when nobody can see the icon.
 * - Skipped under `prefers-reduced-motion`, leaving the static icon in place.
 *
 * The original `/icon.svg` stays as the fallback for bookmarks, PWA installs,
 * and anywhere JavaScript has not run.
 */

/** The VulnSight waveform, in the 17x17 space the SVG mark uses. */
const WAVE: [number, number][] = [
  [2, 11],
  [5, 11],
  [6.6, 5.5],
  [8.5, 13.5],
  [10.2, 8.5],
  [11.6, 11],
  [15, 11],
]

/** Measured length of the polyline above, segment by segment. */
const PATH_LENGTH = 28.497

/** Visible run of the bright pulse. */
const PULSE = 9

const SIZE = 64 // Drawn large, then scaled down by the browser, so it stays crisp.

/** Stroke width, in waveform units. */
const STROKE = 1.6

/*
 * Fit the waveform to the square tile and centre it.
 *
 * The previous version cropped to a 15x11 region and derived the scale from the
 * width alone. Because the canvas is square, that left 3px of padding above the
 * trace and 20px below it, so the mark sat visibly high. Here the ink bounds
 * are measured (including the stroke, which spills half its width past the
 * path), scaled by whichever axis is tighter, and then centred on both axes.
 */
const INK = (() => {
  const half = STROKE / 2
  const xs = WAVE.map(([x]) => x)
  const ys = WAVE.map(([, y]) => y)
  return {
    minX: Math.min(...xs) - half,
    maxX: Math.max(...xs) + half,
    minY: Math.min(...ys) - half,
    maxY: Math.max(...ys) + half,
  }
})()

const INK_W = INK.maxX - INK.minX
const INK_H = INK.maxY - INK.minY

/** A little breathing room inside the tile. */
const PAD = 3

const SCALE = Math.min((SIZE - PAD * 2) / INK_W, (SIZE - PAD * 2) / INK_H)

/** Offsets that centre the scaled ink in the square. */
const OFFSET_X = (SIZE - INK_W * SCALE) / 2 - INK.minX * SCALE
const OFFSET_Y = (SIZE - INK_H * SCALE) / 2 - INK.minY * SCALE
const FPS = 12
const CYCLE_MS = 1400

export function AnimatedFavicon() {
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    /*
     * Own a dedicated icon link, and suppress any others while animating.
     *
     * Two things made the earlier version unreliable. Next injects its own
     * `<link rel="icon" href="/icon.svg">` from the metadata config, and it
     * does so *after* this effect first runs, so parking "everything except
     * the first" parked nothing and left the static SVG live alongside the
     * animated one. Which of two icon links a browser honours is not
     * specified; several prefer the SVG on a high-DPI display, so the
     * animation ran and was ignored.
     *
     * Instead: create one link that belongs to this component, keep it last in
     * the head, and neutralise the `rel` of any other icon link on every
     * frame. Neutralising rather than removing means restoring cannot race
     * with whatever else is managing the head.
     */
    const link = document.createElement('link')
    link.rel = 'icon'
    link.setAttribute('data-animated-favicon', '')
    document.head.appendChild(link)

    /** Icon links we have suppressed, so they can be put back on unmount. */
    const parked = new Map<HTMLLinkElement, string>()
    const claimFavicon = () => {
      for (const el of document.querySelectorAll<HTMLLinkElement>("link[rel~='icon']")) {
        if (el === link || parked.has(el)) continue
        parked.set(el, el.rel)
        el.rel = 'x-icon-parked'
      }
    }
    claimFavicon()

    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    function stroke(dash: number[], offset: number, alpha: number) {
      if (!ctx) return
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.strokeStyle = '#03070B'
      ctx.lineWidth = STROKE * SCALE
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.setLineDash(dash.map((d) => d * SCALE))
      ctx.lineDashOffset = offset * SCALE
      ctx.beginPath()
      WAVE.forEach(([x, y], i) => {
        const px = x * SCALE + OFFSET_X
        const py = y * SCALE + OFFSET_Y
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      })
      ctx.stroke()
      ctx.restore()
    }

    function frame(t: number) {
      if (!ctx) return
      // Phosphor square background, matching the mark.
      ctx.clearRect(0, 0, SIZE, SIZE)
      ctx.fillStyle = '#67E8B0'
      ctx.fillRect(0, 0, SIZE, SIZE)

      // The resting trace.
      stroke([], 0, 0.28)

      // The pulse, sweeping left to right, fading over the last quarter.
      const offset = PULSE + (-PATH_LENGTH - PULSE) * t
      const alpha = t <= 0.725 ? 1 : Math.max(0, 1 - (t - 0.725) / 0.275)
      stroke([PULSE, 999], offset, alpha)

      link.href = canvas.toDataURL('image/png')
      // Next injects its metadata icon after this effect first runs, so the
      // claim has to be re-asserted rather than done once at mount.
      claimFavicon()
    }

    let timer: ReturnType<typeof setInterval> | null = null
    const started = Date.now()

    function tick() {
      frame(((Date.now() - started) % CYCLE_MS) / CYCLE_MS)
    }

    function start() {
      if (timer !== null) return
      timer = setInterval(tick, 1000 / FPS)
    }

    function stop() {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    }

    function onVisibility() {
      if (document.hidden) stop()
      else start()
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      // Put the static icon back, so a client-side navigation away from the app
      // does not leave a stale frame in the tab.
      link.remove()
      // Put every suppressed icon link back, so navigating away from the app
      // leaves the static icon in charge rather than a stale frame.
      for (const [el, rel] of parked) el.rel = rel
    }
  }, [])

  return null
}
