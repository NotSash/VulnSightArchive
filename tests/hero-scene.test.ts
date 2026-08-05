import { describe, expect, it } from 'vitest'
import { boxBlurRgb } from '@/components/hero/scene/blur'
import {
  ART_H,
  ART_W,
  CAT_POS,
  FG_Y,
  HORIZON,
  METRES_PER_PX,
  MOON,
  MOON_TOP_PAD,
  RAIL_Y,
} from '@/components/hero/scene/geometry'
import { mix, PHOS, SHOP_TONES, SIGN_TONES } from '@/components/hero/scene/palette'
import { makeRng, SCENE_SEED } from '@/components/hero/scene/rng'
import { secondsToNextTrain, TRAIN_CYCLE, trainX } from '@/components/hero/scene/sprites'

/**
 * These lock in the things that broke while building the scene. Every case
 * below is a bug that actually shipped into a render and had to be found by
 * looking at pixels, because none of them are type errors and none of them
 * throw.
 */

describe('scene rng', () => {
  it('is deterministic, so the city never reshuffles on resize', () => {
    const a = Array.from({ length: 40 }, () => makeRng(SCENE_SEED).next())
    const b = Array.from({ length: 40 }, () => makeRng(SCENE_SEED).next())
    expect(a).toEqual(b)
  })

  it('produces the same sequence from the same instance every run', () => {
    const first = makeRng(SCENE_SEED)
    const second = makeRng(SCENE_SEED)
    const seqA = Array.from({ length: 200 }, () => first.next())
    const seqB = Array.from({ length: 200 }, () => second.next())
    expect(seqA).toEqual(seqB)
  })

  it('stays inside its stated ranges', () => {
    const rng = makeRng(7)
    for (let i = 0; i < 500; i++) {
      const f = rng.next()
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThan(1)
      const n = rng.int(3, 9)
      expect(n).toBeGreaterThanOrEqual(3)
      expect(n).toBeLessThan(9)
    }
  })

  it('never returns undefined from pick', () => {
    const rng = makeRng(11)
    for (let i = 0; i < 200; i++) expect(rng.pick([1, 2, 3])).toBeDefined()
  })
})

describe('scene geometry', () => {
  /**
   * The band between the sky and the street was left unpainted, so the gaps
   * between mid towers composited to pure black and read as solid dark blocks
   * punched through the skyline. The layer painter now fills it; this asserts
   * the band it has to cover is real and non-empty.
   */
  it('leaves a band between the sky and the street that must be filled', () => {
    expect(HORIZON).toBeLessThan(HORIZON + 16)
    expect(HORIZON + 16).toBeLessThan(FG_Y)
    expect(FG_Y).toBeLessThan(RAIL_Y)
    expect(RAIL_Y).toBeLessThan(ART_H)
  })

  it('keeps the cat on the ramen roof, above the shopfront baseline', () => {
    expect(CAT_POS.y).toBeLessThan(FG_Y)
    expect(CAT_POS.x).toBeGreaterThan(0)
    expect(CAT_POS.x).toBeLessThan(ART_W)
  })

  /**
   * The cat is 5x4 px because of the scale anchor, not because it looked right.
   * If this ratio is ever changed, the cat becomes a panther on a roof.
   */
  it('derives object sizes from the train-car scale anchor', () => {
    expect(METRES_PER_PX).toBeCloseTo(0.19, 2)
    const catWithTail = 0.75 / METRES_PER_PX
    expect(Math.round(catWithTail)).toBe(4)
    const human = 1.7 / METRES_PER_PX
    expect(Math.round(human)).toBe(9)
  })
})

describe('train schedule', () => {
  it('is off screen for the whole gap and on screen for the whole run', () => {
    expect(trainX(0)).not.toBeNull()
    expect(trainX(19)).not.toBeNull()
    expect(trainX(23)).toBeNull()
    expect(trainX(29)).toBeNull()
  })

  it('moves strictly left to right during a run', () => {
    const a = trainX(2)
    const b = trainX(10)
    const c = trainX(18)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(c).not.toBeNull()
    expect(a as number).toBeLessThan(b as number)
    expect(b as number).toBeLessThan(c as number)
  })

  it('starts fully off the left edge and ends fully off the right', () => {
    expect(trainX(0) as number).toBeLessThan(0)
    expect(trainX(20) as number).toBeGreaterThan(ART_W - 1)
  })

  it('loops cleanly, so the seam is never visible', () => {
    expect(trainX(1)).toBeCloseTo(trainX(1 + TRAIN_CYCLE) as number, 6)
  })

  /**
   * The timetable the user specified: a 30 second cycle, the train departing at
   * 0 and clearing the frame at 20, so the clock reads 10 as it leaves.
   *
   * The clock must keep ticking while the train is on screen. The first
   * version froze it on "NOW" for the whole 20 second crossing, which made the
   * one number on the page that should always be moving the only one that
   * stopped.
   */
  it('counts a full 30 down to 0 without pausing', () => {
    expect(secondsToNextTrain(0)).toBeCloseTo(30, 5)
    expect(secondsToNextTrain(5)).toBeCloseTo(25, 5)
    // The train leaves the frame here, and the clock is mid-count, not frozen.
    expect(secondsToNextTrain(20)).toBeCloseTo(10, 5)
    expect(secondsToNextTrain(29)).toBeCloseTo(1, 5)
  })

  it('departs exactly when the clock rolls over', () => {
    expect(secondsToNextTrain(30)).toBeCloseTo(30, 5)
    expect(trainX(30.01)).not.toBeNull()
    expect(trainX(29.99)).toBeNull()
  })

  it('never reports more than one cycle', () => {
    for (let t = 0; t < 120; t += 0.31) {
      expect(secondsToNextTrain(t)).toBeLessThanOrEqual(TRAIN_CYCLE)
    }
  })

  it('never reports a negative countdown', () => {
    for (let t = 0; t < 200; t += 0.37) {
      expect(secondsToNextTrain(t)).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('moon placement', () => {
  /**
   * The scene covers and is anchored to its bottom edge, so a short viewport
   * crops from the top. The moon was authored at y=44, which looked right in a
   * 1440x810 window and was off screen almost everywhere else: measured at
   * screen y=-8 on a 1568x730 window with a bookmarks bar, and worse on a
   * 1920x740 one. It is now placed lower and clamped at runtime.
   */
  it('sits low enough to survive a cropped viewport', () => {
    expect(MOON.y).toBeGreaterThanOrEqual(70)
  })

  it('sits far right, clear of the centre column where the wordmark goes', () => {
    expect(MOON.x).toBeGreaterThan(ART_W * 0.9)
  })

  it('stays clear of the rooflines', () => {
    expect(MOON.y + MOON.r).toBeLessThan(HORIZON - 30)
  })

  it('reserves enough top padding to clear the header and the clock', () => {
    // The last-train clock's box ends at y=47 in CSS pixels.
    expect(MOON_TOP_PAD).toBeGreaterThan(47)
  })
})

describe('palette discipline', () => {
  /**
   * Chroma appears for exactly two reasons in this product: risk severity, or
   * agreement between scanners. The scenery may therefore never use phosphor.
   * A green shopfront or a green neon sign would quietly break that rule.
   */
  it('keeps phosphor out of the scenery palettes', () => {
    for (const tone of [...SHOP_TONES, ...SIGN_TONES]) {
      expect(tone).not.toEqual(PHOS)
      // Nothing in the city may be green-dominant.
      const [r, g, b] = tone
      expect(g).toBeLessThanOrEqual(Math.max(r, b) + 8)
    }
  })

  it('mixes without drifting out of range', () => {
    expect(mix([0, 0, 0], [255, 255, 255], 0.5)).toEqual([128, 128, 128])
    expect(mix([0, 0, 0], [255, 255, 255], -5)).toEqual([0, 0, 0])
    expect(mix([0, 0, 0], [255, 255, 255], 9)).toEqual([255, 255, 255])
  })
})

describe('glow blur', () => {
  /**
   * `ctx.filter = 'blur()'` is a silent no-op in some engines and was
   * unsupported in Safari before 17: it reports success and does nothing, so
   * every lamp renders as a hard disc. The hand-written blur exists for that
   * reason, and this proves it actually spreads light.
   */
  it('spreads a bright point outward', () => {
    const w = 41
    const h = 41
    const data = new Uint8ClampedArray(w * h * 4)
    const centre = (20 * w + 20) * 4
    data[centre] = 255
    data[centre + 1] = 255
    data[centre + 2] = 255
    boxBlurRgb(data, w, h, 3)
    const at = (x: number, y: number) => data[(y * w + x) * 4] ?? 0
    expect(at(20, 20)).toBeGreaterThan(0)
    // Light must have reached neighbours that were pure black before.
    expect(at(23, 20)).toBeGreaterThan(0)
    expect(at(20, 24)).toBeGreaterThan(0)
    // And it must fall off with distance rather than forming a flat plateau.
    expect(at(21, 20)).toBeGreaterThanOrEqual(at(24, 20))
  })

  it('conserves roughly the total light it was given', () => {
    const w = 61
    const h = 61
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < 4; i++) {
      const p = ((30 + i) * w + 30) * 4
      data[p] = 200
    }
    const before = data.reduce((s, v, i) => (i % 4 === 0 ? s + v : s), 0)
    boxBlurRgb(data, w, h, 3)
    const after = data.reduce((s, v, i) => (i % 4 === 0 ? s + v : s), 0)
    // Box blur quantises to integers, so allow generous slack; the point is
    // that light is neither destroyed nor multiplied.
    expect(after).toBeGreaterThan(before * 0.6)
    expect(after).toBeLessThan(before * 1.4)
  })

  it('does nothing at radius zero rather than corrupting the buffer', () => {
    const data = new Uint8ClampedArray(16 * 16 * 4).fill(77)
    const copy = data.slice()
    boxBlurRgb(data, 16, 16, 0)
    expect(data).toEqual(copy)
  })
})
