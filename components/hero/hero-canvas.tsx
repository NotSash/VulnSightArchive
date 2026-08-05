'use client'

import { useEffect, useRef } from 'react'
import { drawBatBeam, drawBatMark } from './scene/batsignal'
import { compositeGlow } from './scene/blur'
import { ART_H, ART_W, MOON, MOON_RIGHT_PAD, MOON_TOP_PAD } from './scene/geometry'
import { paintStatic, type StaticScene } from './scene/layers'
import { makeRng, SCENE_SEED } from './scene/rng'
import {
  drawBirds,
  drawCat,
  drawCrt,
  drawFlickers,
  drawMoon,
  drawPetals,
  drawRain,
  drawSteam,
  drawTrain,
  drawTreeSway,
  makePetals,
  makeRain,
  moonPos,
  secondsToNextTrain,
  TRAIN_CYCLE,
  trainX,
} from './scene/sprites'

/**
 * The animated Japanese-night hero background.
 *
 * Three canvases, not one:
 *
 *   static  offscreen  sky, city, street. Painted once per resize.
 *   glow    offscreen  every light source. Blurred, then added into static.
 *   live    visible    train, CRT, moon, birds, petals, steam, cat, rain.
 *
 * Each frame blits `static` and then draws roughly 120 live primitives. Doing
 * it the obvious way, repainting all ~600 primitives every frame, would cost
 * real battery for no visible gain, because the city never changes.
 *
 * The glow technique matters as much as the split. Drawing halos directly with
 * concentric ellipses produced visible rings and the lamps looked like spiders.
 * All light goes into a separate black buffer, gets a Gaussian blur, and is
 * added with `globalCompositeOperation = 'lighter'`. Crisp pixel art, soft real
 * light.
 *
 * State is exposed on the element as `data-scene`, the same debugging habit as
 * `FieldCanvas`: when it looks dead, the inspector says why rather than
 * requiring a twenty second staring contest.
 */
export function HeroCanvas({ onTrainCountdown }: { onTrainCountdown?: (s: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const countdownRef = useRef(onTrainCountdown)
  countdownRef.current = onTrainCountdown

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

    /*
     * Only an explicit request to economise turns the scene off.
     *
     * Every hardware heuristic tried here was wrong. `<= 4` cores caught most
     * budget laptops. `<= 2 cores AND <= 2 GB` still caught this very browser,
     * and headless Chrome reports exactly 2/2 by default, as do plenty of real
     * phones and cloud VMs. Each version silently served a frozen still to
     * people whose machines were perfectly capable, and the page gave no clue
     * why. Chrome also clamps `deviceMemory` to a coarse ladder, so the number
     * is not even a real measurement.
     *
     * Save-Data is different: the user asked. Reduced-motion is handled
     * separately, and is also the user asking. Everyone else gets the scene,
     * and the frame budget is what keeps it cheap.
     */
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } }
    const lowPower = nav.connection?.saveData === true

    const mkOffscreen = () => {
      const c = document.createElement('canvas')
      c.width = ART_W
      c.height = ART_H
      return c
    }
    const staticCv = mkOffscreen()
    const glowCv = mkOffscreen()
    const artCv = mkOffscreen() // the composed art frame, blitted up to screen

    /*
     * `willReadFrequently` on exactly the two that are read back.
     *
     * `compositeGlow` calls `getImageData` on both `staticCtx` and `glowCtx`
     * to blur the glow layer and add it to the scene. Chrome warns that
     * repeated readback from a GPU-backed canvas is slow and asks for this
     * hint, which keeps the surface in software memory instead.
     *
     * `artCtx` is deliberately NOT flagged: it is only ever drawn to and
     * blitted, never read, so it should stay on the GPU path.
     */
    const staticCtx = staticCv.getContext('2d', { willReadFrequently: true })
    const glowCtx = glowCv.getContext('2d', { willReadFrequently: true })
    const artCtx = artCv.getContext('2d')
    if (!staticCtx || !glowCtx || !artCtx) return

    let scene: StaticScene | null = null
    const rng = makeRng(SCENE_SEED)
    const petals = makePetals(rng)
    const drops = makeRain(rng)
    // Reduced motion still gets a composed frame, mid-scene, so it reads as a
    // photograph rather than an empty box.
    const STILL_T = 8

    let raf: number | null = null
    let running = false
    let last = 0
    let scale = 1
    let offX = 0
    let offY = 0
    let mobile = false
    let scrollY = 0
    /*
     * First art row the viewport can actually show.
     *
     * The scene covers and is anchored to its bottom edge, so a short window
     * crops from the top. Anything authored near the top of the grid can
     * therefore be off screen entirely: at 1568x730 with a bookmarks bar the
     * moon sat at screen y=-8. The moon is clamped below this value, plus a
     * pad that clears the fixed header and the last-train clock.
     */
    let visibleTopArt = 0
    /*
     * Last art column the viewport can actually show.
     *
     * The mirror image of `visibleTopArt`. Cover scaling on a wide short
     * window is driven by the height, so the art overflows horizontally and
     * the right of the grid is off screen. The moon lives at x=446 on a 480
     * grid, so it was sliced off at 1440x900 and 1280x800.
     */
    let visibleRightArt = ART_W
    /*
     * True while the hero is in or near the viewport.
     *
     * Without this the scene kept painting forever once scrolled past: two
     * canvas loops running for a picture nobody can see, which is the single
     * most expensive mistake available here. Seeded from real geometry because
     * IntersectionObserver reports asynchronously.
     */
    let onScreen = true

    function buildStatic() {
      if (!staticCtx || !glowCtx) return
      scene = paintStatic(staticCtx, glowCtx)
      // Blur the light buffer and add it into the static layer once, so the
      // per-frame cost is a single blit. `compositeGlow` does its own blur
      // rather than using `ctx.filter`, which Safari lacked until 17 and which
      // is a silent no-op in some engines; a filter that reports success and
      // does nothing would leave every lamp as a hard disc.
      compositeGlow(staticCtx, glowCtx, ART_W, ART_H, 3)
    }

    function resize() {
      if (!canvas) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      mobile = w < 640
      /*
       * Cover: scale so the art fills the box, anchored to the bottom edge so
       * the street and the train are never cropped away.
       *
       * On a narrow portrait screen plain cover zooms enormously (390px wide
       * against a 480px grid means the height drives the scale), which crops
       * away most of the city and leaves a wall of shopfronts. Capping the
       * scale on narrow viewports keeps the skyline and the tree in frame; the
       * strip of background it exposes at the top is plain night sky.
       */
      const cover = Math.max((w * dpr) / ART_W, (h * dpr) / ART_H)
      const widthFit = (w * dpr) / ART_W
      scale = w < 640 ? Math.min(cover, widthFit * 1.35) : cover
      offX = (w * dpr - ART_W * scale) / 2
      offY = h * dpr - ART_H * scale
      // Convert the clipped top back into art coordinates, and add the pad in
      // CSS pixels so the moon never tucks under the header chrome.
      visibleTopArt = (0 - offY) / scale + (MOON_TOP_PAD * dpr) / scale
      visibleRightArt = (w * dpr - offX) / scale - (MOON_RIGHT_PAD * dpr) / scale
      if (ctx) ctx.imageSmoothingEnabled = false
    }

    function draw(t: number) {
      if (!ctx || !artCtx || !scene) return
      artCtx.clearRect(0, 0, ART_W, ART_H)
      artCtx.drawImage(staticCv, 0, 0)

      // Parallax is scroll-driven, not mouse-driven: mouse parallax on a
      // full-page background feels cheap and is dead on touch. Layers shift by
      // a fraction of the scroll distance, in art pixels.
      const p = scrollY / Math.max(1, window.innerHeight)
      const skyShift = -p * 6

      artCtx.save()
      artCtx.translate(0, skyShift)
      // The moon is given the visible sky so it can clamp itself into it.
      // Undo the parallax shift first: the shift moves the whole sky layer, so
      // the limit has to be expressed in the same space.
      /*
       * Bat-Signal, then moon, then the symbol on it.
       *
       * Order is the whole trick. The beam is additive light and must go down
       * before the moon so the disc sits on top of it rather than being washed
       * out; the symbol goes after the moon because a projected shape is what
       * the light is blocked by, so it has to be painted onto the lit face.
       *
       * The beam is aimed at the moon's live position, drift and all, so the
       * two stay locked together as the moon bobs.
       */
      const moon = moonPos(t, visibleTopArt - skyShift, visibleRightArt)
      drawBatBeam(artCtx, t, moon)
      drawMoon(artCtx, t, visibleTopArt - skyShift, visibleRightArt)
      if (!mobile) drawBirds(artCtx, t)
      artCtx.restore()

      drawFlickers(artCtx, scene.flickerWindows, scene.aviation, t)
      drawSteam(artCtx, t)
      drawTreeSway(artCtx, t)
      drawPetals(artCtx, petals, t)

      const tx = trainX(t)
      if (tx !== null) drawTrain(artCtx, tx, rng)

      // The CRT leans toward the train while it is crossing. `watching` ramps
      // 0 -> 1 -> 0 so the turn eases instead of snapping.
      const phase = ((t % TRAIN_CYCLE) + TRAIN_CYCLE) % TRAIN_CYCLE
      const watching = tx === null ? 0 : Math.sin((phase / 20) * Math.PI)
      drawCrt(artCtx, t, watching)

      // After the glow composite, or the ramen shop halo erases it.
      drawCat(artCtx, t)
      drawRain(artCtx, drops, t)

      ctx.fillStyle = '#070c12'
      ctx.fillRect(0, 0, canvas!.width, canvas!.height)
      ctx.drawImage(artCv, offX, offY, ART_W * scale, ART_H * scale)

      /*
       * The bat emblem, drawn last and in screen space.
       *
       * Everything above is a 480x270 grid blitted up with smoothing off, so
       * anything drawn there is blocky by construction. The emblem is the one
       * object that must not be: at twenty art pixels wide there is no room
       * for ears, swept wings and a scalloped underside to coexist, and it
       * reads as a moth. Painting it here, after the upscale, gives it the
       * full device resolution and a clean curve.
       *
       * A gobo is an optical image cast through a lens, not a thing standing
       * in the city, so it has no reason to share the city's pixel grid.
       * The art-space moon position is converted to screen space with the same
       * scale and offset the blit just used, and the parallax shift is added
       * back because the moon was drawn inside a translated layer.
       */
      if (moon) {
        drawBatMark(
          ctx,
          t,
          offX + moon.x * scale,
          offY + (moon.y + skyShift) * scale,
          MOON.r * scale,
        )
      }

      countdownRef.current?.(secondsToNextTrain(t))
    }

    // 30fps. The sweep is slow and the sprites are chunky; 60 would double the
    // main-thread cost for motion nobody can see.
    const FRAME_MS = 33
    let start = 0

    function loop(now: number) {
      if (!running) return
      if (!start) start = now
      if (now - last >= FRAME_MS) {
        last = now
        draw((now - start) / 1000)
      }
      raf = requestAnimationFrame(loop)
    }

    function begin() {
      if (running) return
      if (reduced.matches || lowPower || !onScreen) {
        if (canvas) {
          canvas.dataset.scene = reduced.matches
            ? 'reduced-motion'
            : !onScreen
              ? 'off-screen'
              : 'save-data'
        }
        // Still paint one composed frame, so scrolling back up never reveals
        // an empty box waiting for the next tick.
        draw(STILL_T)
        return
      }
      running = true
      last = 0
      start = 0
      if (canvas) canvas.dataset.scene = 'running'
      raf = requestAnimationFrame(loop)
    }

    function stop() {
      running = false
      if (canvas) canvas.dataset.scene = 'stopped'
      if (raf !== null) cancelAnimationFrame(raf)
      raf = null
    }

    function onResize() {
      resize()
      draw(reduced.matches || lowPower ? STILL_T : performance.now() / 1000)
    }
    function onVisibility() {
      if (document.hidden) stop()
      else begin()
    }
    function onMotion() {
      stop()
      begin()
    }
    function onScroll() {
      scrollY = window.scrollY
    }

    buildStatic()
    resize()
    begin()

    /*
     * Registered after the first begin(), and the callback ignores no-op
     * reports. observe() fires once immediately; doing this earlier let that
     * first callback race the initial state and wedge the loop.
     */
    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            ([entry]) => {
              const nowOn = entry?.isIntersecting ?? true
              if (nowOn === onScreen) return
              onScreen = nowOn
              if (nowOn) begin()
              else stop()
            },
            { rootMargin: '100px' },
          )
        : null
    if (canvas.parentElement) io?.observe(canvas.parentElement)

    window.addEventListener('resize', onResize, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    reduced.addEventListener('change', onMotion)

    return () => {
      stop()
      io?.disconnect()
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('visibilitychange', onVisibility)
      reduced.removeEventListener('change', onMotion)
    }
  }, [])

  return (
    /*
     * `inert` rather than `tabIndex={-1}`: the latter only removes the canvas
     * from the tab order, so it could still take focus and trip Chrome's
     * "aria-hidden on an element whose descendant retained focus" error.
     * `inert` removes focusability, hit testing and the accessibility tree in
     * one, which is correct for artwork. No `aria-hidden` beside it: `inert`
     * already hides the subtree, and the pair is what Biome flags.
     */
    <canvas
      ref={ref}
      inert
      data-decorative="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  )
}
