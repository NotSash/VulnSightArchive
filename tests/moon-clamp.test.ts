import { describe, expect, it } from 'vitest'
import { ART_W, MOON, MOON_HALO_R, TREE_GAP } from '@/components/hero/scene/geometry'
import { moonX } from '@/components/hero/scene/sprites'

/**
 * The moon was sliced off the right edge of the window.
 *
 * The scene is scaled to cover and anchored to its bottom edge, so a wide
 * short viewport is scaled by its height and overflows horizontally. The
 * drawing code clamped the top edge and never the side, and the moon sits
 * about 93% of the way across a 480 pixel grid, so it was always the first
 * thing lost. Measured clipped at 1440x900 (edge at pixel 1439 of 1440) and
 * at 1280x800.
 *
 * These tests pin the rule rather than the appearance: the whole halo stays
 * inside the visible art, and the moon never retreats into the cherry tree.
 */
describe('moon horizontal clamp', () => {
  it('keeps the authored position when the whole grid is visible', () => {
    expect(moonX(ART_W)).toBe(MOON.x)
  })

  it('is drawn on every viewport with room for the disc clear of the tree', () => {
    expect(moonX(TREE_GAP.x1 + MOON_HALO_R)).not.toBeNull()
    // The halo yields before the disc does: this is tighter than the halo
    // wants, and the moon is still drawn rather than dropped.
    expect(moonX(TREE_GAP.x1 + MOON.r)).toBe(TREE_GAP.x1)
  })

  it('keeps the entire halo on screen, not just the disc', () => {
    // A viewport showing only up to art column 460: the disc alone would fit,
    // the glow would be cut into a hard vertical line.
    const visibleRight = 460
    const x = moonX(visibleRight)
    expect(x).not.toBeNull()
    expect((x as number) + MOON_HALO_R).toBeLessThanOrEqual(visibleRight)
  })

  it('holds the halo inside across every width that can afford it', () => {
    for (let right = TREE_GAP.x1 + MOON_HALO_R; right <= ART_W; right += 1) {
      const x = moonX(right)
      expect(x).not.toBeNull()
      expect((x as number) + MOON_HALO_R).toBeLessThanOrEqual(right)
    }
  })

  /*
   * The two constraints conflict on narrow and tall-portrait viewports: the
   * scene is zoomed so far that no column both clears the right edge and stays
   * out of the cherry canopy. Measured off screen at 390x780, 360x640, 430x932
   * and 1024x1366. Skipping the moon is the honest answer; parking it in the
   * branches would put a light source behind the one silhouette the scene is
   * built around.
   */
  it('is skipped rather than parked in the canopy when there is no room', () => {
    expect(moonX(100)).toBeNull()
    expect(moonX(0)).toBeNull()
    // Not enough width for even the disc to clear the tree.
    expect(moonX(TREE_GAP.x1 + MOON.r - 1)).toBeNull()
  })

  it('never places the moon left of the cherry tree when it is drawn', () => {
    for (let right = 0; right <= ART_W; right += 1) {
      const x = moonX(right)
      if (x !== null) expect(x).toBeGreaterThanOrEqual(TREE_GAP.x1)
    }
  })

  it('leaves the authored position clear of the halo at full width', () => {
    // If this fails the moon is authored too close to the edge, and every
    // viewport is relying on the clamp rather than only the cropped ones.
    expect(MOON.x + MOON_HALO_R).toBeLessThanOrEqual(ART_W)
  })

  it('moves monotonically: a wider view never pushes the moon left', () => {
    let previous = 0
    for (let right = 200; right <= ART_W; right += 5) {
      const x = moonX(right)
      if (x === null) continue
      expect(x).toBeGreaterThanOrEqual(previous)
      previous = x
    }
  })
})
