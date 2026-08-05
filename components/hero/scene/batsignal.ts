/**
 * The Bat-Signal.
 *
 * A carbon-arc searchlight standing on the rooftops just left of the cherry
 * tree, throwing a beam up and to the right until it lands on the moon, which
 * carries the bat silhouette.
 *
 * Three things make it read as light rather than as a grey triangle:
 *
 * 1. **The beam widens.** A real searchlight cone diverges a few degrees. A
 *    parallel-sided beam looks like a drawn shape; a diverging one looks like
 *    light leaving a lens.
 * 2. **It fades along its length.** Air scatters the beam, so it is brightest
 *    at the lens and nearly gone by the time it reaches the sky. The gradient
 *    runs along the beam axis, not across it.
 * 3. **It flickers.** A carbon arc is an unstable electrical discharge and
 *    never sits at one brightness. Two sine waves at unrelated periods give an
 *    irregular waver without ever repeating obviously, which is the same trick
 *    the shopfront signs already use.
 *
 * The symbol is painted on the moon as a dark silhouette, not a bright one,
 * because that is how a projected gobo works: the shape is what the light is
 * blocked by. The reference image the user gave shows exactly this.
 *
 * Everything is a pure function of the clock, like the rest of the scene, so
 * the whole thing can be rewound, paused, or rendered as one still frame for
 * reduced motion.
 */

import { SIGNAL_TOWER } from './geometry'
import * as C from './palette'

type Ctx = CanvasRenderingContext2D

/**
 * Where the searchlight stands, in art pixels.
 *
 * Bolted to the roof of `SIGNAL_TOWER`, not floating at an arbitrary height.
 * The lamp was previously placed at a fixed y that happened to fall between
 * two procedural towers, so it read as dangling in mid air with nothing under
 * it. Deriving the position from the roof means the two can never drift apart:
 * move the tower and the lamp goes with it.
 *
 * The x sits right of the tower's centre so the drum overhangs slightly toward
 * the moon, the way a real searchlight is aimed out over a parapet.
 */
export const BAT_LAMP = {
  x: SIGNAL_TOWER.x + SIGNAL_TOWER.w - 9,
  // Two pixels of parapet, then the mount, then the drum sits above that.
  y: SIGNAL_TOWER.roofY - 7,
} as const

/** Pale carbon-arc white. Slightly blue, because an arc runs hot. */
const BEAM: C.Rgb = [196, 214, 238]
const LENS_HOT: C.Rgb = [236, 244, 255]
/*
 * Housing tones, matched to `SIGNAL_TOWER`'s body rather than to black.
 *
 * The first version was near-black, which made the lamp a hole punched in the
 * skyline: it read as absence, not as a machine. These are the tower's own
 * body colour, one step lighter so the silhouette separates from the roof it
 * stands on, plus a brighter top edge for the catch light. The machine now
 * looks built out of the same city as everything around it.
 */
const HOUSING: C.Rgb = [40, 51, 69]
const HOUSING_EDGE: C.Rgb = [78, 94, 120]
const HOUSING_DARK: C.Rgb = [22, 29, 42]

/**
 * Arc flicker, 0.72 to 1.
 *
 * Two sines whose periods do not divide evenly, so the pattern never visibly
 * loops, plus a rare deeper dip so it occasionally stutters the way a real arc
 * does when the carbons need trimming.
 */
function flicker(t: number): number {
  const fast = Math.sin(t * 7.3)
  const slow = Math.sin(t * 2.1 + 1.7)
  const stutter = Math.sin(t * 0.37) > 0.94 ? 0.14 * Math.sin(t * 23) : 0
  return 0.86 + 0.08 * fast + 0.06 * slow - Math.abs(stutter)
}

/** Slow hunting sway, in art pixels, applied at the far end of the beam. */
function sway(t: number): number {
  return Math.sin(t * 0.31) * 2.2 + Math.sin(t * 0.13 + 2.2) * 1.1
}

/**
 * The beam, drawn before the moon so the moon sits on top of it.
 *
 * `target` is where the beam is pointed. When the moon has been skipped
 * (very narrow viewports, see `moonX`) the caller passes null and the beam
 * simply carries on past the top of the frame, which is what a searchlight
 * with nothing to light would do anyway.
 */
export function drawBatBeam(ctx: Ctx, t: number, target: { x: number; y: number } | null) {
  const { x: lx, y: ly } = BAT_LAMP
  const drift = sway(t)

  // Aim: at the moon when there is one, otherwise up and to the right on the
  // same diagonal so the composition does not change.
  const tx = (target ? target.x : lx + 116) + drift
  const ty = target ? target.y : -40

  const dx = tx - lx
  const dy = ty - ly
  const len = Math.hypot(dx, dy) || 1
  // Unit vector along the beam, and its perpendicular, so the cone can be
  // built without any trigonometry beyond this.
  const ux = dx / len
  const uy = dy / len
  const px = -uy
  const py = ux

  const f = flicker(t)
  // Divergence: a real searchlight spreads a few degrees. Half-width at the
  // lens is the aperture; at the far end it is the aperture plus the spread.
  const nearHalf = 2.2
  const farHalf = 11
  // Overshoot slightly past the target so the beam does not stop dead at the
  // moon's centre, which would look like a stick rather than a shaft of light.
  const over = 1.16

  ctx.save()
  // Light adds to what is behind it. Without this the beam darkens the sky it
  // crosses, which is the single most common way a drawn beam gives itself
  // away as a shape rather than as light.
  ctx.globalCompositeOperation = 'lighter'

  // Three nested cones: a wide soft haze, a core, and a tight hot centre.
  // Layering is what gives a beam a soft edge without needing a real blur.
  const passes: readonly [number, number, number][] = [
    [1.9, 0.055, 1],
    [1.0, 0.1, 1],
    [0.42, 0.13, 0.92],
  ]

  for (const [spread, alpha, reach] of passes) {
    const nh = nearHalf * spread
    const fh = farHalf * spread
    const ex = lx + ux * len * over * reach
    const ey = ly + uy * len * over * reach

    const grad = ctx.createLinearGradient(lx, ly, ex, ey)
    grad.addColorStop(0, C.rgb(BEAM, alpha * f))
    grad.addColorStop(0.45, C.rgb(BEAM, alpha * f * 0.55))
    grad.addColorStop(1, C.rgb(BEAM, 0))
    ctx.fillStyle = grad

    ctx.beginPath()
    ctx.moveTo(lx + px * nh, ly + py * nh)
    ctx.lineTo(ex + px * fh, ey + py * fh)
    ctx.lineTo(ex - px * fh, ey - py * fh)
    ctx.lineTo(lx - px * nh, ly - py * nh)
    ctx.closePath()
    ctx.fill()
  }

  // Bloom at the lens itself, where the light is being emitted.
  const bloom = ctx.createRadialGradient(lx, ly, 0, lx, ly, 13)
  bloom.addColorStop(0, C.rgb(LENS_HOT, 0.34 * f))
  bloom.addColorStop(1, C.rgb(LENS_HOT, 0))
  ctx.fillStyle = bloom
  ctx.beginPath()
  ctx.ellipse(lx, ly, 13, 13, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()

  drawHousing(ctx, f)
}

/**
 * The lamp itself: a drum on a rooftop mount, tilted up along the beam.
 *
 * Pixel art cannot rotate, so the tilt is suggested by stepping three short
 * rows diagonally rather than by transforming anything. At this size that
 * reads more clearly than a real rotation would, which would land on
 * half-pixels and blur the one crisp thing in the sky.
 */
function drawHousing(ctx: Ctx, f: number) {
  const { x, y } = BAT_LAMP
  const fill = (dx: number, dy: number, w: number, h: number, c: C.Rgb, a = 1) => {
    ctx.fillStyle = C.rgb(c, a)
    ctx.fillRect(Math.round(x + dx), Math.round(y + dy), w, h)
  }

  /*
   * Built from the roof up, so the machine is visibly resting on something.
   *
   * The base plate spans down to the parapet at `SIGNAL_TOWER.roofY`, which is
   * 7px below the lamp origin. Without it the drum floated: there was light
   * and a shape, but no contact with the building, and the eye reads that as
   * hovering every time.
   */
  const toRoof = SIGNAL_TOWER.roofY - y

  // Base plate sitting flat on the roof, and the pillar up to the yoke.
  fill(-6, toRoof - 2, 13, 2, HOUSING)
  fill(-6, toRoof - 2, 13, 1, HOUSING_EDGE)
  fill(-2, 2, 4, toRoof - 4, HOUSING_DARK)
  fill(-2, 2, 1, toRoof - 4, HOUSING)

  // Yoke arms the drum pivots in.
  fill(-4, 0, 2, 4, HOUSING)
  fill(3, -1, 2, 4, HOUSING)

  // Drum, stepped up and to the right along the beam axis. Pixel art cannot
  // rotate cleanly at this size, so the tilt is three stepped rows rather than
  // a transform, which would land on half pixels and blur the one crisp thing
  // in the sky.
  fill(-6, 0, 6, 4, HOUSING)
  fill(-4, -2, 6, 4, HOUSING)
  fill(-2, -4, 6, 4, HOUSING)
  // Top edge catch light, so the drum has form instead of being a blob.
  fill(-6, 0, 6, 1, HOUSING_EDGE)
  fill(-4, -2, 6, 1, HOUSING_EDGE)
  fill(-2, -4, 6, 1, HOUSING_EDGE)
  // Underside shadow, the opposite edge of the same form.
  fill(-6, 3, 4, 1, HOUSING_DARK)

  // The lens: the brightest single point in the sky half of the scene.
  fill(2, -5, 3, 3, BEAM, 0.55 + 0.35 * f)
  fill(3, -4, 1, 1, LENS_HOT, f)
}

/**
 * The Dark Knight emblem, projected on the moon.
 *
 * **Drawn as a vector, in screen space, deliberately.**
 *
 * Everything else in this scene is pixel art on a 480x270 grid that is blitted
 * up with nearest-neighbour smoothing off, so anything drawn there is blocky by
 * construction. Three attempts at a pixel bat all failed the same way: at about
 * twenty pixels across there is simply not enough room for the ears, the swept
 * wings and the scalloped underside to coexist, and the result reads as a moth
 * or a skeleton however carefully the pixels are placed.
 *
 * So this one is painted onto the *final* canvas after the upscale, at full
 * device resolution, as a filled bezier outline. It is the one intentionally
 * smooth object in the picture, and that is right rather than inconsistent: a
 * projected gobo is an optical image cast through a lens, not a physical
 * object in the city, so it has no reason to share the city's pixel grid. The
 * moon it sits on is a circle drawn with `ellipse`, not a pixel disc, for the
 * same reason.
 *
 * Silhouette, not highlight: a gobo is the shape the light is *blocked* by.
 * The alpha never reaches 1, so the craters underneath still read faintly and
 * the moon stays a moon with something cast on it rather than a sticker.
 */
export function drawBatMark(ctx: Ctx, t: number, cx: number, cy: number, moonR: number) {
  const f = flicker(t)
  // Just inside the disc, so a rim of clean moon always frames the emblem.
  const width = moonR * 1.86

  ctx.save()
  batPath(ctx, cx, cy, width)
  ctx.fillStyle = C.rgb([9, 13, 21], 0.62 + 0.3 * f)
  ctx.fill()

  // The beam spilling past the disc: a cool rim of scattered light, so the
  // moon looks lit by the searchlight rather than merely drawn over.
  ctx.globalCompositeOperation = 'lighter'
  const rim = ctx.createRadialGradient(cx, cy, moonR * 0.55, cx, cy, moonR * 1.5)
  rim.addColorStop(0, C.rgb(BEAM, 0.12 * f))
  rim.addColorStop(1, C.rgb(BEAM, 0))
  ctx.fillStyle = rim
  ctx.beginPath()
  ctx.ellipse(cx, cy, moonR * 1.5, moonR * 1.5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/**
 * The outline itself, as one closed path.
 *
 * Authored from the 2008 emblem: very wide and low, a near-flat top edge
 * sweeping out to sharp wing tips, a small notched head at the centre, and an
 * underside of two scallops per wing falling to a single tail point.
 *
 * Coordinates are normalised. `u` runs -1 to 1 across the full width and `v`
 * runs 0 to 1 from the top edge to the tail, so the shape can be restated at
 * any size without touching the numbers. Only the right half is authored; the
 * left is the same numbers negated, which makes the emblem exactly
 * symmetrical.
 *
 * The aspect ratio is the thing that most says "Batman" before any detail is
 * legible: 2.6 to 1. Earlier versions were nearer 2 to 1 and read as a
 * generic bat no matter how the wings were shaped.
 */
function batPath(ctx: Ctx, cx: number, cy: number, w: number) {
  const hw = w / 2
  const h = w / 2.6
  const X = (u: number) => cx + u * hw
  const Y = (v: number) => cy - h * 0.42 + v * h

  ctx.beginPath()
  /*
   * Head first, working right from the centre.
   *
   * In the 2008 emblem the head is a small block sitting *above* the wing
   * line, cut by two narrow slots so it reads as two upright ears with a
   * shallow V between them. Two earlier attempts failed here: running the
   * points downward produced three fangs hanging below the top edge, which is
   * the same shape inverted and reads as a mouth; giving the ears pointed tips
   * made them read as spikes; and cutting the slot all the way to the wing
   * line split the head into three separate prongs. The ears are broad
   * flat-topped blocks and the slot stops part way down, so the head stays one
   * mass with two notches in it.
   */
  ctx.moveTo(X(0), Y(0.055)) // shallow V at dead centre
  ctx.lineTo(X(0.05), Y(-0.075)) // inner ear, a broad flat-topped block
  ctx.lineTo(X(0.108), Y(-0.075))
  ctx.lineTo(X(0.124), Y(0.035)) // the single slot, cut only part way down
  ctx.lineTo(X(0.142), Y(-0.06)) // outer ear
  ctx.lineTo(X(0.196), Y(-0.055))
  ctx.lineTo(X(0.216), Y(0.195)) // shoulder, where the head meets the wing
  // The long top edge, barely curved, sweeping out to a sharp tip.
  ctx.bezierCurveTo(X(0.52), Y(0.175), X(0.78), Y(0.19), X(1.0), Y(0.235))
  // Underside, coming back in from the tip: a shallow concave sweep first.
  ctx.bezierCurveTo(X(0.86), Y(0.36), X(0.76), Y(0.4), X(0.665), Y(0.43))
  // Outer scallop.
  ctx.bezierCurveTo(X(0.6), Y(0.5), X(0.565), Y(0.62), X(0.545), Y(0.75))
  // Notch between the scallops.
  ctx.bezierCurveTo(X(0.5), Y(0.6), X(0.44), Y(0.53), X(0.365), Y(0.55))
  // Inner scallop.
  ctx.bezierCurveTo(X(0.305), Y(0.61), X(0.275), Y(0.72), X(0.26), Y(0.83))
  // Final fall to the tail point at dead centre.
  ctx.bezierCurveTo(X(0.21), Y(0.72), X(0.115), Y(0.83), X(0), Y(1.0))
  // Mirrored left half: the same numbers negated, so the emblem is exactly
  // symmetrical rather than approximately so.
  ctx.bezierCurveTo(X(-0.115), Y(0.83), X(-0.21), Y(0.72), X(-0.26), Y(0.83))
  ctx.bezierCurveTo(X(-0.275), Y(0.72), X(-0.305), Y(0.61), X(-0.365), Y(0.55))
  ctx.bezierCurveTo(X(-0.44), Y(0.53), X(-0.5), Y(0.6), X(-0.545), Y(0.75))
  ctx.bezierCurveTo(X(-0.565), Y(0.62), X(-0.6), Y(0.5), X(-0.665), Y(0.43))
  ctx.bezierCurveTo(X(-0.76), Y(0.4), X(-0.86), Y(0.36), X(-1.0), Y(0.235))
  ctx.bezierCurveTo(X(-0.78), Y(0.19), X(-0.52), Y(0.175), X(-0.216), Y(0.195))
  ctx.lineTo(X(-0.196), Y(-0.055))
  ctx.lineTo(X(-0.142), Y(-0.06))
  ctx.lineTo(X(-0.124), Y(0.035))
  ctx.lineTo(X(-0.108), Y(-0.075))
  ctx.lineTo(X(-0.05), Y(-0.075))
  ctx.closePath()
}
