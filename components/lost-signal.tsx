'use client'

import { useEffect, useRef } from 'react'

/**
 * A dead CRT, for the page that does not exist.
 *
 * The 404 was Next's stock white slab: the only screen on the site that did
 * not belong to it, arriving at the exact moment someone is already lost.
 *
 * This is the same machine that sits on the street in the hero, drawn at the
 * same 3x pixel scale, but the tube has lost its signal. It shows static and a
 * flat scan line rather than the heartbeat trace, because a CRT with nothing
 * to display is exactly what a missing page is.
 *
 * Pixel art earns its place here for two reasons. The hero already established
 * this machine as the product's mascot, so a visitor who has seen the front
 * page recognises it. And a 404 is the one screen where a little warmth is
 * worth more than efficiency: nobody is trying to get work done on it.
 *
 * Deliberately canvas rather than a static image: the static has to move, and
 * an animated GIF at this scale would be both larger and blurrier than the
 * eighty lines that draw it.
 */

const W = 96
const H = 78
const SCALE = 3

export function LostSignal() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let raf: number | null = null
    let running = false

    const px = (x: number, y: number, w: number, h: number, fill: string) => {
      ctx.fillStyle = fill
      ctx.fillRect(x, y, w, h)
    }

    /**
     * One frame. `t` is seconds, so the whole thing stays a pure function of
     * the clock like every other sprite in this project.
     */
    function draw(t: number) {
      if (!ctx) return
      ctx.clearRect(0, 0, W, H)

      const bob = Math.round(Math.sin(t * 0.9) * 1.5)
      const x = 8
      const y = 6 + bob

      // Case, with the lit top edge and left rail the hero's CRT uses.
      px(x, y, 80, 58, '#a6b0ba')
      px(x + 1, y + 1, 78, 1, '#c6ced6')
      px(x + 1, y + 1, 1, 56, '#bec6ce')
      ctx.strokeStyle = '#303a44'
      ctx.lineWidth = 1
      ctx.strokeRect(x + 0.5, y + 0.5, 79, 57)

      // Glass.
      const gx = x + 7
      const gy = y + 7
      const gw = 66
      const gh = 40
      px(gx, gy, gw, gh, '#0a2c28')

      /*
       * Static.
       *
       * Seeded from the frame number rather than `Math.random`, so the noise
       * is reproducible: the same `t` always paints the same frame, which is
       * what lets reduced motion render one still and stop.
       */
      const seed = Math.floor(t * 12)
      let n = seed * 9301 + 49297
      const rand = () => {
        n = (n * 9301 + 49297) % 233280
        return n / 233280
      }
      for (let i = 0; i < 190; i++) {
        const sx = gx + Math.floor(rand() * gw)
        const sy = gy + Math.floor(rand() * gh)
        const v = rand()
        px(sx, sy, 1, 1, v > 0.82 ? '#67e8b0' : v > 0.5 ? '#1d5a4c' : '#113a34')
      }

      /*
       * The flat line: a tube with no signal. It is the heartbeat trace from
       * the hero with the heartbeat taken out, which is the whole joke.
       */
      const midY = gy + Math.floor(gh / 2)
      px(gx + 3, midY, gw - 6, 1, '#67e8b0')

      /*
       * A roll bar drifting down the glass, the way an untuned CRT rolls.
       * Slow, because a fast one reads as a glitch effect rather than a
       * machine that has lost its input.
       */
      const roll = gy + Math.floor(((t * 9) % (gh + 14)) - 7)
      if (roll > gy && roll < gy + gh - 2) {
        px(gx, roll, gw, 2, 'rgba(103,232,176,0.10)')
      }

      // Scanlines, translucent and over the content. Opaque ones erased the
      // glyphs on the hero's CRT; same rule applies here.
      for (let s = gy + 1; s < gy + gh; s += 2) {
        px(gx, s, gw, 1, 'rgba(0,0,0,0.32)')
      }

      // Bezel inner edge, then the stand.
      ctx.strokeStyle = '#242e38'
      ctx.strokeRect(gx - 0.5, gy - 0.5, gw + 1, gh + 1)
      px(x + 6, y + 58, 68, 8, '#8b95a0')
      px(x + 24, y + 66, 32, 5, '#79838e')

      // The power lamp, dark. The machine is on; it simply has nothing to
      // show, which is a different state from being off.
      px(x + 70, y + 51, 2, 2, '#7a2a2a')
    }

    let start = 0
    function loop(now: number) {
      if (!running) return
      if (!start) start = now
      draw((now - start) / 1000)
      raf = requestAnimationFrame(loop)
    }

    function begin() {
      if (reduced.matches) {
        // One composed frame, mid-scene, so it reads as a photograph of a dead
        // screen rather than an empty box.
        draw(4)
        return
      }
      if (running) return
      running = true
      raf = requestAnimationFrame(loop)
    }

    function stop() {
      running = false
      if (raf !== null) cancelAnimationFrame(raf)
      raf = null
    }

    begin()
    const onChange = () => {
      stop()
      start = 0
      begin()
    }
    reduced.addEventListener('change', onChange)

    // Stop when the tab is hidden: nobody is watching a 404 in a background
    // tab, and a canvas loop that runs forever is the most expensive mistake
    // available here.
    const onVisibility = () => (document.hidden ? stop() : onChange())
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      reduced.removeEventListener('change', onChange)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    /*
     * The wrapper carries `aria-hidden`, not the canvas.
     *
     * A `<canvas>` is focusable, so hiding it directly creates an element that
     * a keyboard user can land on but a screen reader will not describe.
     * Biome flags this correctly (`noAriaHiddenOnFocusable`). Hiding the
     * wrapper removes the whole subtree from the accessibility tree instead,
     * which is what was meant: the heading and body text carry the meaning,
     * and a canvas of static has nothing to announce.
     */
    <div aria-hidden="true" className="pointer-events-none select-none">
      <canvas
        ref={ref}
        width={W}
        height={H}
        /* `pixelated` or the upscale blurs every edge the art depends on. */
        style={{ width: W * SCALE, height: H * SCALE, imageRendering: 'pixelated' }}
        className="mx-auto block"
      />
    </div>
  )
}
