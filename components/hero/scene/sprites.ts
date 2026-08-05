/**
 * The moving half of the scene.
 *
 * Everything here is repainted every frame on top of the blitted static layer.
 * The budget is roughly 120 primitives, against the ~600 the static layer needs
 * once. Each sprite takes a plain time value rather than owning its own state,
 * so the whole scene is a pure function of the clock and can be rewound,
 * paused, or rendered as a single still for reduced-motion.
 *
 * Ported from `_for-myself/hero/render-scene.py`.
 */

import { drawCrtFace } from './crt-face'
import {
  ART_H,
  ART_W,
  CAT_POS,
  CRT,
  FG_Y,
  MOON,
  MOON_HALO_R,
  RAIL_Y,
  TRAIN,
  TREE_BASE,
  TREE_GAP,
  TREE_X,
  VENT_X,
} from './geometry'
import * as C from './palette'
import type { Rng } from './rng'

type Ctx = CanvasRenderingContext2D

const px = (ctx: Ctx, x: number, y: number, w: number, h: number, c: C.Rgb, a = 1) => {
  ctx.fillStyle = C.rgb(c, a)
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
}
const dot = (ctx: Ctx, x: number, y: number, c: C.Rgb, a = 1) => px(ctx, x, y, 1, 1, c, a)
const outline = (ctx: Ctx, x: number, y: number, w: number, h: number, c: C.Rgb) => {
  ctx.strokeStyle = C.rgb(c)
  ctx.lineWidth = 1
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1)
}

/* ------------------------------------------------------------------ moon */

/**
 * Drifts vertically on a 9 second period, and stays on screen while it does.
 *
 * The moon and the CRT are the only two objects that bob, and their periods
 * (9s and 5.5s) do not divide evenly, so they never sync. If they did, or if
 * everything bobbed, the scene would look like it was breathing underwater.
 *
 * `minY` is the first art row the viewport can actually show, passed in by the
 * canvas because only it knows the scale and offset. The scene covers and is
 * anchored to its bottom edge, so a short window crops from the top and a
 * fixed moon position simply vanishes. Clamping keeps it in the sky on every
 * viewport instead of only the one it was authored in. `maxX` does the same job
 * for the right edge, which was clamped nowhere at all.
 *
 * The drift is 2.5px rather than 1.5: at the old amplitude the motion was
 * under one screen pixel on many displays, so the moon read as static.
 */
export function drawMoon(ctx: Ctx, t: number, minY = 0, maxX = ART_W) {
  const pos = moonPos(t, minY, maxX)
  // No room for it clear of the canopy: see `moonX`.
  if (pos === null) return
  const { x, y } = pos

  // Halo, drawn here rather than baked into the static glow buffer, because
  // the moon's final position is not known until the viewport is measured.
  // Two soft radial passes approximate what the blurred buffer used to give.
  for (const [r, tone, alpha] of [
    [MOON_HALO_R, C.MOON_HALO_OUTER, 0.3],
    [17, C.MOON_HALO_INNER, 0.34],
  ] as const) {
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, C.rgb(tone, alpha))
    grad.addColorStop(1, C.rgb(tone, 0))
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.ellipse(x, y, r, r, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.fillStyle = C.rgb(C.MOON_FACE)
  ctx.beginPath()
  ctx.ellipse(x, y, MOON.r, MOON.r, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = C.rgb(C.MOON_CRATER)
  ctx.beginPath()
  ctx.ellipse(x - 3, y - 2, 2, 2, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(x + 3.5, y + 4, 1.5, 1.5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(x - 1, y + 6, 1, 1, 0, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * Where the moon lands, given the last visible art column, or null if it
 * cannot be shown at all.
 *
 * Three rules, in priority order.
 *
 * 1. **Prefer to clear the whole halo, not just the disc.** A moon that fits
 *    with one pixel to spare has its glow cut into a hard vertical line, which
 *    reads as a rendering fault rather than a moon.
 * 2. **Never left of the cherry tree.** Sliding it into the canopy puts a
 *    light source behind the one silhouette the scene is built around.
 * 3. **The disc itself is non-negotiable.** When rules 1 and 2 conflict, the
 *    halo yields: a moon with a slightly clipped glow is still a moon, and
 *    `maxX` already carries `MOON_RIGHT_PAD` of slack, so in practice the
 *    glow stays soft anyway. Only when even the disc cannot clear the canopy
 *    is the moon skipped entirely, which is the case on narrow and
 *    tall-portrait viewports where the scene is zoomed so far there is no sky
 *    left to put one in. Those viewports already lose the birds for the same
 *    reason, and faking a position would only move the problem somewhere more
 *    visible.
 *
 * Exported so the rule can be asserted directly, and so nothing has to
 * re-derive it from the drawing code.
 */
export function moonPos(t: number, minY = 0, maxX = ART_W): { x: number; y: number } | null {
  const x = moonX(maxX)
  if (x === null) return null
  const dy = Math.sin((t / 9) * Math.PI * 2) * 2.5
  // Never push it below the rooflines, whatever the viewport does.
  const y = Math.min(Math.max(MOON.y, minY + MOON.r), 150) + dy
  return { x, y }
}

export function moonX(maxX = ART_W): number | null {
  // No sky wide enough to hold the disc clear of the canopy.
  if (maxX - MOON.r < TREE_GAP.x1) return null
  return Math.min(MOON.x, Math.max(TREE_GAP.x1, maxX - MOON_HALO_R))
}

/* ----------------------------------------------------------------- birds */

type Bird = { x: number; y: number; size: number; speed: number; phase: number; col: C.Rgb }

/**
 * Two flocks at different depths.
 *
 * Placement is dictated by the lighting, not by composition: a dark silhouette
 * against a dark sky is nothing. The far flock crosses the moon's halo, the
 * near flock crosses the warm cloud band, and those are the only two regions of
 * this sky bright enough for a bird to register at all.
 */
export const BIRDS: Bird[] = [
  { x: 382, y: 30, size: 4, speed: 10.7, phase: 0.1, col: [6, 9, 15] },
  { x: 404, y: 40, size: 4, speed: 10.7, phase: 0.66, col: [6, 9, 15] },
  { x: 370, y: 52, size: 3, speed: 10.7, phase: 0.4, col: [6, 9, 15] },
  { x: 148, y: 150, size: 6, speed: -16, phase: 0.18, col: [16, 20, 28] },
  { x: 180, y: 140, size: 6, speed: -16, phase: 0.7, col: [16, 20, 28] },
  { x: 210, y: 154, size: 5, speed: -16, phase: 0.44, col: [16, 20, 28] },
  { x: 118, y: 160, size: 5, speed: -16, phase: 0.6, col: [16, 20, 28] },
  { x: 246, y: 146, size: 4, speed: -16, phase: 0.3, col: [16, 20, 28] },
]

export function drawBirds(ctx: Ctx, t: number) {
  for (const b of BIRDS) {
    // Wrap with a generous margin so a bird never pops in at the frame edge.
    const span = ART_W + 80
    let x = b.x + b.speed * t
    x = ((((x + 40) % span) + span) % span) - 40
    // The flap cycle differs per flock: 0.9s far, 0.7s near.
    const period = b.speed > 0 ? 0.9 : 0.7
    const flap = (Math.sin((t / period + b.phase) * Math.PI * 2) + 1) / 2
    bird(ctx, x, b.y, b.size, flap, b.col)
  }
}

function bird(ctx: Ctx, bx: number, by: number, s: number, flap: number, col: C.Rgb) {
  // A gull-wing 'M'. flap 0 = wings raised, 1 = level. Two pixels thick,
  // because a 1 px silhouette disappears at this scale.
  const up = Math.round(s * (1.7 - flap * 1.5))
  ctx.strokeStyle = C.rgb(col)
  ctx.lineWidth = 1
  for (const oy of [0, 1]) {
    ctx.beginPath()
    ctx.moveTo(bx - s * 2, by - up + oy + 0.5)
    ctx.lineTo(bx, by + oy + 0.5)
    ctx.lineTo(bx + s * 2, by - up + oy + 0.5)
    ctx.stroke()
  }
  // Drooping outer primaries: what makes it read as a bird, not a chevron.
  ctx.beginPath()
  ctx.moveTo(bx - s * 3, by - up + 2.5)
  ctx.lineTo(bx - s * 2, by - up + 0.5)
  ctx.moveTo(bx + s * 2, by - up + 0.5)
  ctx.lineTo(bx + s * 3, by - up + 2.5)
  ctx.stroke()
}

/* ----------------------------------------------------------------- train */

/**
 * The train timetable, and the clock that reads from it.
 *
 * One cycle is 30 seconds:
 *
 *   t=0   the clock shows 30 and the train starts crossing
 *   t=20  the train has left the right edge; the clock reads 10
 *   t=30  the clock hits 0, rolls back to 30, and the next train departs
 *
 * So the countdown is genuinely to the *next* departure and keeps ticking
 * while a train is on screen. The previous version showed "NOW" frozen for the
 * whole 20 second run, which made the clock look broken: the one number on the
 * page that should always be moving was the one that stopped.
 */
export const TRAIN_RUN = 20 // seconds to cross the frame
export const TRAIN_CYCLE = 30 // seconds between departures
export const TRAIN_GAP = TRAIN_CYCLE - TRAIN_RUN // 10s with no train in frame

const TRAIN_LEN_TOTAL = TRAIN.cars * (TRAIN.car + TRAIN.gap) + 9

/** Position within the current cycle, always in [0, TRAIN_CYCLE). */
function cyclePhase(t: number): number {
  return ((t % TRAIN_CYCLE) + TRAIN_CYCLE) % TRAIN_CYCLE
}

/** Left edge of the train at time `t`, or null when it is not on screen. */
export function trainX(t: number): number | null {
  const phase = cyclePhase(t)
  if (phase > TRAIN_RUN) return null
  const span = ART_W + TRAIN_LEN_TOTAL + 20
  return -TRAIN_LEN_TOTAL - 10 + (phase / TRAIN_RUN) * span
}

/**
 * Seconds until the next departure. Counts 30 down to 0 without pausing, so
 * the clock stays live while a train is crossing.
 */
export function secondsToNextTrain(t: number): number {
  return TRAIN_CYCLE - cyclePhase(t)
}

export function drawTrain(ctx: Ctx, x: number, rng: Rng) {
  const ty0 = RAIL_Y - TRAIN.height
  const ty1 = RAIL_Y - 1
  const lit: number[] = []

  for (let c = 0; c < TRAIN.cars; c++) {
    const x0 = x + c * (TRAIN.car + TRAIN.gap)
    if (x0 > ART_W || x0 + TRAIN.car < 0) continue
    px(ctx, x0, ty0, TRAIN.car, ty1 - ty0, C.TRAIN_BODY)
    px(ctx, x0, ty0, TRAIN.car, 3, C.TRAIN_ROOF)
    px(ctx, x0, ty1 - 3, TRAIN.car, 4, C.TRAIN_SKIRT)
    px(ctx, x0, ty0 + 7, TRAIN.car, 3, C.TRAIN_STRIPE)
    outline(ctx, x0, ty0, TRAIN.car + 1, ty1 - ty0 + 1, C.TRAIN_OUTLINE)
    for (let wx = x0 + 4; wx < x0 + TRAIN.car - 5; wx += 11) {
      px(ctx, wx, ty0 + 3, 8, 5, C.TRAIN_WINDOW)
      outline(ctx, wx, ty0 + 3, 8, 5, C.TRAIN_WINDOW_EDGE)
      lit.push(wx)
      // Passengers. Deterministic per window position so they do not strobe.
      if ((Math.floor(wx) * 2654435761) % 100 < 45) {
        const p0 = wx + 1 + (Math.floor(wx) % 3) * 2
        px(ctx, p0, ty0 + 4, 2, 4, C.TRAIN_PASSENGER)
      }
    }
    px(ctx, x0 + TRAIN.car / 2 - 1, ty0 + 10, 3, ty1 - 3 - (ty0 + 10), [150, 158, 168])
    for (const bg of [x0 + 9, x0 + TRAIN.car - 11]) px(ctx, bg - 4, ty1, 9, 2, [30, 38, 48])
  }

  // Wedge nose on the leading car.
  const nx = x + TRAIN.cars * (TRAIN.car + TRAIN.gap) - 3
  if (nx < ART_W && nx > -12) {
    ctx.fillStyle = C.rgb([190, 198, 210])
    ctx.beginPath()
    ctx.moveTo(nx, RAIL_Y - 19)
    ctx.lineTo(nx + 9, RAIL_Y - 15)
    ctx.lineTo(nx + 9, RAIL_Y - 1)
    ctx.lineTo(nx, RAIL_Y - 1)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = C.rgb(C.TRAIN_OUTLINE)
    ctx.stroke()
    px(ctx, nx + 3, RAIL_Y - 13, 6, 4, [24, 60, 58])
    dot(ctx, nx + 7, RAIL_Y - 6, C.TRAIN_HEADLIGHT)
    dot(ctx, nx + 7, RAIL_Y - 17, C.TRAIN_HEADLIGHT)
  }
  // Red tail light and the motion streak behind it.
  dot(ctx, x + 1, RAIL_Y - 6, C.TRAIN_TAILLIGHT)
  for (let k = 1; k < 26; k++) {
    px(ctx, x - k, RAIL_Y - 13, 1, 9, C.RAIN, (1 - k / 26) * 0.12)
  }
  // Warm spill from the lit windows onto the deck.
  for (const wx of lit) {
    for (let k = 0; k < 4; k++) {
      px(ctx, wx - 1, RAIL_Y + 1 + k, 9, 1, [255, 214, 150], (1 - k / 4) * 0.18)
    }
  }
  void rng
}

/* ------------------------------------------------------------------- CRT */

/**
 * The anchor character.
 *
 * Idle: drifts forward and back 2 px on a 5.5 second period.
 * Reaction: when the train is on screen it leans toward it and its screen
 * brightens, then settles. Idle plus reaction is the difference between a
 * moving object and a character.
 */
export function drawCrt(ctx: Ctx, t: number, watching: number) {
  const bob = Math.sin((t / 5.5) * Math.PI * 2) * 2
  const lean = watching * 2
  const x = CRT.x + Math.round(bob * 0.35 + lean)
  const y = CRT.y + Math.round(bob * 0.5)

  px(ctx, x, y, 30, 23, C.CRT_CASE)
  outline(ctx, x, y, 30, 23, C.CRT_CASE_DARK)
  px(ctx, x + 1, y + 1, 28, 1, C.CRT_CASE_LIT)
  px(ctx, x + 1, y + 1, 1, 21, [190, 198, 206])

  const screenLift = watching * 0.25
  px(ctx, x + 3, y + 4, 23, 14, C.mix(C.CRT_SCREEN, [16, 66, 58], screenLift))
  outline(ctx, x + 3, y + 4, 23, 14, [36, 46, 56])

  /*
   * The screen contents.
   *
   * Lives in `crt-face.ts` rather than here because it is a small state
   * machine on its own clock: it types a greeting, pulls a face, then sweeps
   * the heartbeat trace. This function stays responsible for the cabinet, the
   * glass and the scanlines.
   *
   * The origin passed in is the inside of the bezel, so the face code never
   * has to know where the case is.
   */
  drawCrtFace(ctx, t, { x: x + 4, y: y + 5, watching })

  /*
   * Scanlines across the screen.
   *
   * Translucent, at 0.35, and drawn after the contents so they darken the
   * phosphor rather than replace it. They used to be fully opaque, which was
   * invisible against a static waveform but erased every other row of the
   * 5px-tall characters the moment the screen learned to type: the glyphs came
   * out as detached dots. A real scanline is a gap in the beam, not paint.
   */
  for (let s = y + 5; s < y + 17; s += 2) {
    px(ctx, x + 4, s, 21, 1, [0, 0, 0], 0.35)
  }
  px(ctx, x + 2, y + 23, 26, 5, C.CRT_BASE)
  px(ctx, x + 8, y + 28, 15, 3, C.CRT_FOOT)
  dot(ctx, x + 26, y + 24, C.PHOS)
}

/* ------------------------------------------------------------------- cat */

/**
 * Five pixels wide, four tall.
 *
 * That is not a stylistic choice, it is the scale: one art pixel is 0.19 m, so
 * a house cat is 2.4 px of body and about 4 including the tail. Anything larger
 * would be a panther on a roof.
 *
 * Two things make it legible at that size. The profile does all the work: a
 * bump for the head, two ear pixels, a raised tail. And one warm rim pixel runs
 * along the back, as if the light behind is catching the fur, because roof, cat
 * and sky here are all near-black and a pure silhouette simply vanishes.
 *
 * It must be drawn after the glow composite, or the ramen shop's halo erases it.
 */
export function drawCat(ctx: Ctx, t: number) {
  const { x, y } = CAT_POS
  const d = C.CAT_DARK
  px(ctx, x, y - 1, 3, 2, d)
  dot(ctx, x + 3, y - 2, d)
  dot(ctx, x + 3, y - 3, d)
  dot(ctx, x, y + 1, d)
  dot(ctx, x + 2, y + 1, d)
  // Tail flicks on a 3.2s cycle, with a long pause at rest.
  const flick = Math.sin((t / 3.2) * Math.PI * 2)
  const tailUp = flick > 0.72 ? 1 : 0
  dot(ctx, x - 1, y - 2 - tailUp, d)
  dot(ctx, x - 1, y - 3 - tailUp, d)
  dot(ctx, x + 1, y - 1, C.CAT_RIM)
  dot(ctx, x + 2, y - 1, C.CAT_RIM)
  dot(ctx, x + 3, y - 3, C.mix(d, C.CAT_RIM, 0.55))
}

/* ----------------------------------------------------------------- steam */

/** One slow curl from the ramen vent, rising and fading on a 6 second loop. */
export function drawSteam(ctx: Ctx, t: number) {
  for (let i = 0; i < 11; i++) {
    const life = (t / 6 + i / 11) % 1
    const sx = VENT_X + 2 + Math.sin(life * 3 + i) * 4 * life
    const sy = FG_Y - 36 - life * 24
    const r = 1 + life * 2.2
    const a = (1 - life) * 0.5
    if (a < 0.04) continue
    const tone = C.mix(C.STEAM_WARM, C.STEAM_COOL, Math.min(1, life * 2))
    ctx.fillStyle = C.rgb(tone, Math.min(0.7, a * 1.5))
    ctx.beginPath()
    ctx.ellipse(sx, sy, r, r * 0.7, 0, 0, Math.PI * 2)
    ctx.fill()
  }
}

/* ---------------------------------------------------------------- sakura */

/**
 * Petals drift across the whole frame, not just under the tree, so the artwork
 * and the wordmark share a layer instead of sitting apart. Density falls off
 * with distance from the tree, and is capped hard in the centre column so a
 * petal never lands awkwardly on the headline.
 */
export type Petal = {
  x: number
  y: number
  fall: number
  drift: number
  phase: number
  tint: number
}

export function makePetals(rng: Rng, count = 46): Petal[] {
  const out: Petal[] = []
  let guard = 0
  while (out.length < count && guard++ < count * 12) {
    const x = rng.int(0, ART_W)
    const near = 1 - Math.min(1, Math.abs(x - TREE_X) / 240)
    if (!rng.chance(0.22 + near * 0.65)) continue
    out.push({
      x,
      y: rng.range(60, FG_Y + 8),
      fall: rng.range(5, 11),
      drift: rng.range(3, 9),
      phase: rng.range(0, Math.PI * 2),
      tint: rng.range(0.35, 0.95),
    })
  }
  return out
}

export function drawPetals(ctx: Ctx, petals: Petal[], t: number) {
  for (const p of petals) {
    const span = FG_Y + 14 - 50
    const y = 50 + ((((p.y - 50 + t * p.fall) % span) + span) % span)
    const x = p.x + Math.sin(t * 0.7 + p.phase) * p.drift
    dot(ctx, x, y, C.mix([50, 44, 50], C.BLOSSOM_BLUSH, p.tint))
  }
}

/** The canopy sways 1 px; the lantern swings with it. */
export function drawTreeSway(ctx: Ctx, t: number) {
  const sway = Math.sin((t / 4.5) * Math.PI * 2)
  if (Math.abs(sway) < 0.5) return
  const dx = sway > 0 ? 1 : -1
  px(ctx, TREE_X - 13 + dx, TREE_BASE - 40, 3, 4, C.LANTERN)
  dot(ctx, TREE_X - 12 + dx, TREE_BASE - 38, C.LANTERN_HOT)
}

/* ------------------------------------------------------------------ rain */

export type Drop = { x: number; y: number; len: number; speed: number }

export function makeRain(rng: Rng, count = 200): Drop[] {
  return Array.from({ length: count }, () => ({
    x: rng.int(0, ART_W),
    y: rng.range(0, ART_H),
    len: rng.pick([3, 4, 5]),
    // Nearer drops fall faster. Cheap depth.
    speed: rng.range(70, 150),
  }))
}

export function drawRain(ctx: Ctx, drops: Drop[], t: number) {
  for (const dp of drops) {
    const y = ((dp.y + t * dp.speed) % (ART_H + 20)) - 10
    for (let k = 0; k < dp.len; k++) {
      dot(ctx, dp.x + Math.floor(k / 3), y + k, C.RAIN, 0.11)
    }
  }
}

/* -------------------------------------------------------------- flickers */

/** A few shop windows flicker; aviation lights blink. Both on offset timers. */
export function drawFlickers(
  ctx: Ctx,
  windows: { x0: number; y0: number; x1: number; y1: number; tone: C.Rgb }[],
  masts: { x: number; y: number }[],
  t: number,
) {
  windows.forEach((w, i) => {
    const period = 8 + i * 3.5
    const phase = (t / period) % 1
    // A short dip, not a strobe: the window dims for a fraction of a second.
    if (phase > 0.02 && phase < 0.05) {
      px(ctx, w.x0, w.y0, w.x1 - w.x0, w.y1 - w.y0, C.mix([0, 0, 0], w.tone, 0.22))
    }
  })
  masts.forEach((m, i) => {
    const on = (t + i * 0.37) % 2 < 1
    if (on) dot(ctx, m.x, m.y, C.AVIATION)
    else dot(ctx, m.x, m.y, C.mix(C.AVIATION, [0, 0, 0], 0.65))
  })
}
