/**
 * Deterministic pseudo-random numbers for the hero scene.
 *
 * The city must be identical on every load and must never reshuffle when the
 * window is resized. `Math.random()` would give a different skyline each time
 * the layers are repainted, which reads as the page glitching rather than as
 * variety. Everything positional in the scene is drawn from one of these,
 * seeded with a constant.
 *
 * mulberry32: 32-bit state, one multiply-xorshift round. Fast, no dependencies,
 * and good enough for placing windows and stars. It is not for anything that
 * needs to be unguessable, and nothing here is.
 */
export type Rng = {
  /** Float in [0, 1). */
  next(): number
  /** Integer in [min, max). */
  int(min: number, max: number): number
  /** Float in [min, max). */
  range(min: number, max: number): number
  /** Uniformly picks one element. */
  pick<T>(items: readonly T[]): T
  /** True with probability p. */
  chance(p: number): boolean
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0

  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    int: (min, max) => Math.floor(next() * (max - min)) + min,
    range: (min, max) => next() * (max - min) + min,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T,
    chance: (p) => next() < p,
  }
}

/**
 * The one seed the whole scene is built from. Changing it redraws the entire
 * city: a different skyline, different lit windows, different stars. It is
 * pinned so the artwork matches `_for-myself/hero/hero-scene.png`.
 */
export const SCENE_SEED = 20260803
