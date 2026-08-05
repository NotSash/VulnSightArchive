/**
 * What the little CRT is showing.
 *
 * The set already has a computer sitting on the street with a heartbeat trace
 * on it, and the cat watches it. This gives the screen something to *say*: it
 * types a greeting, pulls a face, and then falls back to the waveform, on a
 * loop. Nothing here is decoration for its own sake; the machine is the
 * product's mascot, so it behaves like a small terminal that is pleased to see
 * you.
 *
 * Three constraints shaped every decision below.
 *
 * 1. **The screen is 23x14 art pixels.** That is roughly 69x42 on a 1440px
 *    display. A 3x5 font fits five characters across with one pixel of
 *    letter-spacing and one to spare, which is exactly why the greeting is
 *    HELLO and not something longer.
 * 2. **It is a phosphor CRT, not an LCD.** Characters do not appear instantly;
 *    they strike, over-bright, and settle. The cursor blinks on a hard square
 *    wave because that is what a real terminal does.
 * 3. **It is a pure function of the clock**, like every other sprite in this
 *    scene, so the whole thing can be rewound, paused, or rendered as a single
 *    still for reduced motion.
 */

import * as C from './palette'

type Ctx = CanvasRenderingContext2D

/**
 * A 3x5 pixel font, only the glyphs actually used.
 *
 * Hand-plotted rather than generated: at five pixels tall there is exactly one
 * sensible way to draw each of these, and a real font rasterised this small
 * loses the crossbars.
 */
const GLYPHS: Record<string, readonly string[]> = {
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  E: ['###', '#..', '##.', '#..', '###'],
  L: ['#..', '#..', '#..', '#..', '###'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
}

const GREETING = 'HELLO'

/**
 * The loop, in seconds.
 *
 * Deliberately not a round number and deliberately co-prime with the moon's
 * 9 second drift and the CRT's own 5.5 second bob, so the three never sync up
 * and the scene never looks like it is breathing in time with itself.
 */
const CYCLE = 17

/* Phase boundaries within the cycle. */
const TYPE_START = 0.6
const TYPE_PER_CHAR = 0.42
const TYPE_END = TYPE_START + GREETING.length * TYPE_PER_CHAR // ~2.7
const HOLD_END = TYPE_END + 1.8 // ~4.5
const FACE_END = HOLD_END + 5.5 // ~10

/**
 * The face, drawn on the 21x12 usable area inside the bezel.
 *
 * Two eyes and a wide smile, sized to fill the screen rather than sit politely
 * in the middle: a small face on a big screen reads as a typo, a big one reads
 * as a character.
 */
const EYE_L = 4
const EYE_R = 13
/*
 * Vertical placement, in rows of the 13-row usable glass.
 *
 * The face sat too low: the smile's bottom row landed on row 12, the very last
 * row of the screen, so it read as resting on the bezel rather than sitting in
 * the picture. Everything moves up, and the eyes move less than the mouth so
 * the gap between them opens rather than the pair simply sliding.
 *
 *   rows 0-1   clear
 *   rows 2-4   eyes
 *   row  5     clear
 *   rows 6-10  mouth
 *   rows 11-12 clear
 *
 * Two rows of margin top and bottom, which is what makes it look placed
 * rather than crammed.
 */
const EYE_Y = 1

export interface CrtFaceOptions {
  /** Screen origin in art pixels: the inside of the bezel. */
  x: number
  y: number
  /** 0 to 1, how much the CRT is turned toward the passing train. */
  watching: number
}

/**
 * Paint the screen contents. Returns nothing; the caller has already drawn the
 * bezel, the glass and the scanlines.
 */
export function drawCrtFace(ctx: Ctx, t: number, opts: CrtFaceOptions) {
  const { x, y, watching } = opts
  const phase = ((t % CYCLE) + CYCLE) % CYCLE

  if (phase < HOLD_END) {
    drawGreeting(ctx, x, y, phase)
  } else if (phase < FACE_END) {
    drawFace(ctx, x, y, phase, watching)
  } else {
    drawTrace(ctx, x, y, phase - FACE_END)
  }
}

/** A single pixel of phosphor, with an optional over-bright strike. */
function lit(ctx: Ctx, x: number, y: number, strike = 0) {
  ctx.fillStyle = C.rgb(C.mix(C.PHOS, [255, 255, 255], strike))
  ctx.fillRect(Math.round(x), Math.round(y), 1, 1)
}

function drawGreeting(ctx: Ctx, x: number, y: number, phase: number) {
  const typed = Math.max(
    0,
    Math.min(GREETING.length, Math.floor((phase - TYPE_START) / TYPE_PER_CHAR)),
  )

  for (let i = 0; i < typed; i++) {
    const glyph = GLYPHS[GREETING[i]]
    if (!glyph) continue
    /*
     * The strike.
     *
     * A phosphor character is briefly brighter than its settled state as the
     * beam first paints it. Only the newest character gets this, and only for
     * a fraction of its dwell time, so the line reads as being typed rather
     * than as having appeared.
     */
    const age = phase - TYPE_START - i * TYPE_PER_CHAR
    const strike = i === typed - 1 ? Math.max(0, 1 - age / 0.18) : 0

    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (glyph[row][col] === '#') lit(ctx, x + 1 + i * 4 + col, y + 4 + row, strike)
      }
    }
  }

  /*
   * The cursor: a hard 2Hz square wave, not a fade.
   *
   * It sits after the last typed character while typing, and keeps blinking
   * through the hold so the machine reads as waiting rather than finished.
   */
  if (Math.floor(phase * 2) % 2 === 0) {
    const cx = x + 1 + typed * 4
    if (cx < x + 21) for (let row = 0; row < 5; row++) lit(ctx, cx, y + 4 + row)
  }
}

function drawFace(ctx: Ctx, x: number, y: number, phase: number, watching: number) {
  /*
   * The blink.
   *
   * Every two seconds, for a tenth of a second. Real blinks are about 100ms
   * and people notice a slow one immediately: at 200ms the machine looks
   * sleepy, at 50ms nobody sees it happen at all.
   */
  const intoFace = phase - HOLD_END
  const blinking = intoFace % 2 < 0.1

  /*
   * The eyes track the train.
   *
   * `drawCrt` already leans the whole cabinet toward a passing train, and the
   * cat already watches the CRT. Shifting the pupils the same way costs one
   * pixel and makes the three of them read as one connected moment rather
   * than three unrelated animations.
   */
  const look = watching > 0.35 ? 1 : 0

  for (const ex of [EYE_L, EYE_R]) {
    if (blinking) {
      // A closed eye is a line, and it sits at the *bottom* of where the eye
      // was: lids fall, they do not shrink toward the middle.
      lit(ctx, x + ex + look, y + EYE_Y + 3)
      lit(ctx, x + ex + look + 1, y + EYE_Y + 3)
    } else {
      for (let dy = 0; dy < 3; dy++) {
        lit(ctx, x + ex + look, y + EYE_Y + 1 + dy)
        lit(ctx, x + ex + look + 1, y + EYE_Y + 1 + dy)
      }
    }
  }

  // A wide smile: corners lifted, flat across the bottom. Drawn as three
  // steps per side so the curve reads at this size without antialiasing.
  const mouthY = y + 6
  lit(ctx, x + 3, mouthY)
  lit(ctx, x + 3, mouthY + 1)
  lit(ctx, x + 4, mouthY + 2)
  lit(ctx, x + 5, mouthY + 3)
  for (let mx = 6; mx <= 14; mx++) lit(ctx, x + mx, mouthY + 4)
  lit(ctx, x + 15, mouthY + 3)
  lit(ctx, x + 16, mouthY + 2)
  lit(ctx, x + 17, mouthY + 1)
  lit(ctx, x + 17, mouthY)
}

/**
 * The heartbeat trace, which is what this screen showed before it learned to
 * talk. Kept because it is the brand mark, and because a terminal that only
 * ever pulls faces is a toy rather than an instrument.
 *
 * It now sweeps: the trace is revealed left to right on each pass, the way a
 * real monitor draws.
 */
function drawTrace(ctx: Ctx, x: number, y: number, into: number) {
  const pts: readonly [number, number][] = [
    [1, 7],
    [4, 7],
    [5, 3],
    [8, 11],
    [11, 5],
    [13, 7],
    [20, 7],
  ]

  /*
   * The trace is always fully drawn; only the beam head sweeps.
   *
   * The first version clipped the line to the head position, so for most of
   * each pass the screen was almost empty and the waveform read as broken
   * rather than as being drawn. A real monitor shows the whole trace at once,
   * because the phosphor holds it; what moves is the bright spot where the
   * beam is right now.
   */
  ctx.strokeStyle = C.rgb(C.PHOS)
  ctx.lineWidth = 1
  ctx.beginPath()
  pts.forEach(([dx, dy], i) => {
    const px = x + dx + 0.5
    const py = y + dy + 0.5
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  })
  ctx.stroke()

  // The beam head, brighter than the trail it leaves, on a 1.9 second pass.
  const head = 1 + ((into / 1.9) % 1) * 19
  let ty = 7
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    if (head >= x0 && head <= x1) {
      ty = y0 + ((y1 - y0) * (head - x0)) / Math.max(0.001, x1 - x0)
      break
    }
  }
  lit(ctx, x + head, y + ty, 0.85)
}
