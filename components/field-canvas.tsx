'use client'

import { useEffect, useRef } from 'react'

/**
 * The ambient background: a field of hosts being swept.
 *
 * This is the product's own metaphor rather than decoration — a scan wave
 * crosses a network of hosts, lighting each one as it passes. It runs behind
 * every page so the background is continuous while scrolling, which is what
 * stops the layout reading as a stack of separate coloured boxes.
 *
 * Care taken: DPR is capped at 2, the loop stops when the tab is hidden, and it
 * never starts at all under reduced-motion or on low-powered devices. It is
 * decorative, so it must never cost a user anything they'd notice.
 */

/** Deterministic host field, so the background is identical on every load. */
const FIELD_W = 1600
const FIELD_H = 1000

// [x, y, size] — generated once with a Poisson-ish spacing so hosts never clump.
const HOSTS: [number, number, number][] = [
  [104, 856, 1],
  [1268, 380, 2],
  [1461, 858, 1],
  [225, 260, 1],
  [1071, 60, 2],
  [640, 471, 3],
  [1560, 236, 1],
  [434, 646, 2],
  [858, 856, 1],
  [253, 484, 1],
  [1350, 604, 2],
  [55, 375, 1],
  [770, 121, 1],
  [1148, 831, 3],
  [514, 149, 2],
  [962, 596, 1],
  [1526, 476, 1],
  [151, 620, 2],
  [676, 700, 1],
  [1226, 168, 1],
  [372, 872, 2],
  [899, 340, 1],
  [1436, 62, 3],
  [61, 128, 1],
  [583, 351, 2],
  [1043, 470, 1],
  [790, 605, 1],
  [312, 60, 2],
  [1339, 350, 1],
  [485, 442, 1],
  [188, 754, 2],
  [1128, 285, 1],
  [700, 246, 3],
  [944, 745, 1],
  [1548, 690, 2],
  [401, 300, 1],
  [826, 460, 1],
  [1240, 700, 2],
  [130, 470, 1],
  [606, 862, 1],
  [1022, 190, 2],
  [468, 762, 1],
  [1451, 250, 1],
  [270, 640, 3],
  [730, 810, 2],
  [1160, 560, 1],
  [890, 120, 1],
  [340, 420, 2],
  [1520, 830, 1],
  [80, 260, 1],
  [660, 60, 2],
  [1300, 470, 1],
  [420, 180, 1],
  [980, 880, 2],
  [1400, 760, 1],
  [200, 900, 1],
  [860, 690, 2],
  [1080, 620, 1],
]

// Index pairs; each host links to its two nearest neighbours within range.
const LINKS: [number, number][] = [
  [0, 55],
  [1, 28],
  [2, 48],
  [3, 23],
  [4, 40],
  [5, 45],
  [6, 22],
  [7, 29],
  [8, 56],
  [9, 18],
  [10, 51],
  [11, 38],
  [12, 50],
  [13, 37],
  [14, 52],
  [15, 25],
  [16, 41],
  [17, 30],
  [18, 44],
  [19, 31],
  [20, 41],
  [21, 47],
  [22, 42],
  [23, 11],
  [24, 34],
  [25, 26],
  [26, 46],
  [27, 52],
  [28, 49],
  [29, 24],
  [30, 9],
  [31, 32],
  [32, 45],
  [33, 8],
  [34, 36],
  [35, 53],
  [36, 15],
  [37, 57],
  [38, 47],
  [39, 20],
  [40, 12],
  [41, 3],
  [42, 1],
  [43, 17],
  [44, 33],
  [45, 26],
  [46, 57],
  [47, 9],
  [48, 2],
  [49, 11],
  [50, 19],
  [51, 15],
  [52, 27],
  [53, 33],
  [54, 2],
  [55, 39],
  [56, 43],
  [57, 46],
  [5, 35],
  [13, 54],
  [21, 7],
  [0, 20],
  [4, 19],
  [10, 16],
  [14, 27],
  [24, 3],
  [30, 43],
  [6, 39],
  [12, 34],
  [18, 51],
  [22, 5],
]

export function FieldCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

    /*
     * Decorative work should not tax a weak device, but the first version of
     * this gate was far too eager and silently killed the background on
     * perfectly ordinary machines:
     *
     *   - `hardwareConcurrency <= 4` matches any 2-core or 4-core laptop,
     *     which is most budget hardware and every VM.
     *   - `deviceMemory <= 4` matches any 4 GB machine. Chrome also clamps
     *     the value to a coarse ladder, so 6 GB reports as 4.
     *
     * Either one alone was enough to turn the field off, with no way to tell
     * from the page that anything had been decided. The loop is a ~30fps
     * canvas paint of about 130 primitives, which is cheap; the honest bar is
     * "does the user want motion at all", not "guess at their silicon".
     * Save-Data is kept because that is an explicit user request to economise.
     */
    const nav = navigator as Navigator & {
      connection?: { saveData?: boolean }
      deviceMemory?: number
    }
    // Even "2 cores AND 2 GB" was too eager: that is exactly what headless
    // Chrome, many phones and most cloud VMs report, so capable machines were
    // still silently served a frozen frame. Only an explicit Save-Data request
    // disables the animation now; reduced-motion is handled separately.
    const lowPower = nav.connection?.saveData === true

    let width = 0
    let height = 0
    let scaleX = 1
    let scaleY = 1
    let raf: number | null = null
    let time = 0
    /* True while the wrapper is in or near the viewport. See the observer
       below: on the home page a second, heavier canvas sits above this one.
       Seeded from real geometry rather than `true`, because IntersectionObserver
       reports asynchronously: the first start() runs before it has ever fired,
       so an optimistic default meant one frame of both canvases painting. */
    const host = canvas.offsetParent as HTMLElement | null
    let onScreen = (() => {
      if (!host) return true
      const r = host.getBoundingClientRect()
      return r.top < window.innerHeight + 120 && r.bottom > -120
    })()
    let running = false
    let last = 0

    const px = (v: number) => Math.round(v)

    function resize() {
      if (!canvas || !ctx) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      scaleX = width / FIELD_W
      scaleY = height / FIELD_H
    }

    function draw() {
      if (!ctx) return
      ctx.clearRect(0, 0, width, height)

      const sweep = (time % 1) * 1.25 - 0.125
      const sweepX = sweep * width

      // Faint grid.
      ctx.strokeStyle = 'rgba(120,190,230,0.042)'
      ctx.lineWidth = 1
      const step = Math.max(46, Math.round(width / 26))
      ctx.beginPath()
      for (let x = 0; x <= width; x += step) {
        ctx.moveTo(px(x) + 0.5, 0)
        ctx.lineTo(px(x) + 0.5, height)
      }
      for (let y = 0; y <= height; y += step) {
        ctx.moveTo(0, px(y) + 0.5)
        ctx.lineTo(width, px(y) + 0.5)
      }
      ctx.stroke()

      // Links brighten as the sweep passes over their midpoint.
      for (const [a, b] of LINKS) {
        const ha = HOSTS[a]
        const hb = HOSTS[b]
        if (!ha || !hb) continue
        const ax = ha[0] * scaleX
        const ay = ha[1] * scaleY
        const bx = hb[0] * scaleX
        const by = hb[1] * scaleY
        const lit = Math.max(0, 1 - Math.abs((ax + bx) / 2 - sweepX) / (width * 0.16))
        ctx.strokeStyle = `rgba(103,232,176,${(0.018 + lit * 0.1).toFixed(3)})`
        ctx.beginPath()
        ctx.moveTo(px(ax) + 0.5, px(ay) + 0.5)
        ctx.lineTo(px(bx) + 0.5, px(by) + 0.5)
        ctx.stroke()
      }

      // The sweep itself.
      const grad = ctx.createLinearGradient(sweepX - width * 0.13, 0, sweepX + width * 0.03, 0)
      grad.addColorStop(0, 'rgba(103,232,176,0)')
      grad.addColorStop(0.75, 'rgba(103,232,176,0.045)')
      grad.addColorStop(1, 'rgba(103,232,176,0.13)')
      ctx.fillStyle = grad
      ctx.fillRect(sweepX - width * 0.13, 0, width * 0.16, height)
      ctx.fillStyle = 'rgba(103,232,176,0.15)'
      ctx.fillRect(px(sweepX), 0, 1, height)

      // Hosts: squares, pixel-snapped, flaring as the wave reaches them.
      for (const [hx, hy, size] of HOSTS) {
        const x = hx * scaleX
        const y = hy * scaleY
        const lit = Math.max(0, 1 - Math.abs((x - sweepX) / (width * 0.14)))
        const s = size + (lit > 0.55 ? 1 : 0)
        if (lit > 0.02) {
          ctx.fillStyle = `rgba(103,232,176,${(0.1 + lit * 0.55).toFixed(3)})`
          if (lit > 0.6) {
            ctx.fillStyle = `rgba(103,232,176,${(0.25 + lit * 0.5).toFixed(3)})`
            ctx.fillRect(px(x) - s - 1, px(y) - 1, s * 2 + 3, 3)
            ctx.fillRect(px(x) - 1, px(y) - s - 1, 3, s * 2 + 3)
          }
        } else {
          ctx.fillStyle = 'rgba(150,190,215,0.12)'
        }
        ctx.fillRect(px(x) - s, px(y) - s, s * 2, s * 2)
      }
    }

    // ~30fps is plenty for a slow sweep and halves the main-thread cost.
    const FRAME_MS = 33

    /*
     * Sweep speed. At the old 0.0016 a single pass took 16.5 seconds, and
     * because the wave is deliberately faint that is long enough to look like
     * nothing is happening at all: you can watch for five seconds and see no
     * change. 0.0034 puts a pass at about 7.8 seconds, which still reads as a
     * slow deliberate sweep rather than a fidget, but is clearly alive.
     */
    const SWEEP_PER_FRAME = 0.0034

    function loop(now: number) {
      if (!running) return
      if (now - last >= FRAME_MS) {
        last = now
        time += SWEEP_PER_FRAME
        draw()
      }
      raf = requestAnimationFrame(loop)
    }

    function start() {
      if (running || reduced.matches || lowPower || !onScreen) {
        /*
         * Say why, on the element itself. When this silently refused to run
         * there was nothing on the page to inspect, so the only way to tell a
         * dead loop from a working one was to stare at it for 20 seconds.
         * `dataset.field` reads `running`, `off-screen`, `reduced-motion`,
         * `save-data` or `stopped`.
         *
         * Report `off-screen` before `save-data`: on the home page this canvas
         * starts exactly at the fold, so being parked is the normal state and
         * must not look like a fault when inspected.
         */
        if (canvas) {
          canvas.dataset.field = reduced.matches
            ? 'reduced-motion'
            : !onScreen
              ? 'off-screen'
              : lowPower
                ? 'save-data'
                : 'idle'
        }
        return
      }
      running = true
      last = 0
      if (canvas) canvas.dataset.field = 'running'
      raf = requestAnimationFrame(loop)
    }

    function stop() {
      running = false
      if (canvas) canvas.dataset.field = 'stopped'
      if (raf !== null) cancelAnimationFrame(raf)
      raf = null
    }

    function onResize() {
      resize()
      draw()
    }

    /*
     * On the home page this canvas sits below a full-viewport hero that runs a
     * second, much heavier animation. Both are `fixed`, so without this gate
     * two rAF loops would paint every frame while only one of them was ever
     * visible, doubling the cost for nothing.
     *
     * The wrapper element is observed rather than the canvas itself: the canvas
     * is `fixed` and therefore always intersects the viewport, so observing it
     * would always report true. The parent is in normal flow and genuinely
     * scrolls past.
     */
    const io =
      host && typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            ([entry]) => {
              const nowOn = entry?.isIntersecting ?? true
              if (nowOn === onScreen) return
              onScreen = nowOn
              if (nowOn) start()
              else stop()
            },
            { rootMargin: '120px' },
          )
        : null

    function onVisibility() {
      if (document.hidden || !onScreen) stop()
      else start()
    }

    function onMotionChange() {
      if (reduced.matches) {
        stop()
        draw()
      } else {
        start()
      }
    }

    resize()
    draw()
    start()

    /*
     * Observed only after the first start(), and the callback ignores
     * no-op reports.
     *
     * IntersectionObserver fires once immediately on observe(). Registering it
     * before start() meant that first callback ran, then start() ran again and
     * overwrote the state; and because `onScreen` was already correct, no
     * later callback ever arrived to undo it. The canvas then sat wedged in
     * whatever state the race happened to leave, which is exactly what a
     * screenshot showed: `idle` while fully in view.
     */
    io?.observe(host as Element)

    window.addEventListener('resize', onResize, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    reduced.addEventListener('change', onMotionChange)

    return () => {
      stop()
      io?.disconnect()
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      reduced.removeEventListener('change', onMotionChange)
    }
  }, [])

  return (
    <>
      {/* Purely decorative.

          `inert`, not `tabIndex={-1}`. A <canvas> is focusable, and
          `tabIndex={-1}` only removes it from the TAB ORDER: it can still take
          focus from a click or a programmatic call. Chrome then reported
          "Blocked aria-hidden on an element because its descendant retained
          focus", because a focused element must never be hidden from
          assistive technology. `inert` removes the element from focus, hit
          testing and the accessibility tree together, which is what this
          actually needs and what the spec recommends.

          No `aria-hidden` alongside it: `inert` already hides the subtree
          from assistive technology, and pairing the two is what Biome's
          `noAriaHiddenOnFocusable` rule objects to.

          `absolute`, not `fixed`. While these were fixed they covered the
          whole viewport including the hero screen above them, so the dark
          veil greyed out the entire city and the animated field drew faint
          lines across it. Absolute keeps both inside the wrapper that owns
          them, which is also what makes the visibility observer meaningful. */}
      <canvas
        ref={ref}
        inert
        data-decorative="true"
        className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      />
      {/* Keeps the field from ever competing with the copy on top of it. */}
      <div
        aria-hidden="true"
        data-decorative="true"
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          background:
            'radial-gradient(ellipse 90% 60% at 50% -10%, rgba(103,232,176,.07), transparent 60%), linear-gradient(180deg, rgba(7,12,18,.30) 0%, rgba(7,12,18,.62) 42%, rgba(5,10,15,.86) 100%)',
        }}
      />
    </>
  )
}
