import { describe, expect, it } from 'vitest'
import { BAT_LAMP } from '@/components/hero/scene/batsignal'
import { ART_H, MOON, SIGNAL_TOWER, TREE_X } from '@/components/hero/scene/geometry'

/**
 * The Bat-Signal has to keep three spatial relationships or it stops reading
 * as a searchlight pointed at the moon. These pin them so a later change to
 * the skyline cannot silently break the composition.
 */
describe('bat-signal placement', () => {
  it('stands left of the cherry tree, so the beam crosses the sky diagonally', () => {
    // Compared against the trunk rather than the gap: the tower deliberately
    // stands at the left edge of the corridor the skyline keeps clear for the
    // tree, which is also the corridor that is clear of the headline text. If
    // the lamp drifted past the trunk the beam would be near-vertical and
    // would read as a column of haze rather than a searchlight.
    expect(BAT_LAMP.x).toBeLessThan(TREE_X)
  })

  it('aims up and to the right, at the moon', () => {
    expect(MOON.x).toBeGreaterThan(BAT_LAMP.x)
    expect(MOON.y).toBeLessThan(BAT_LAMP.y)
  })

  /*
   * The lamp used to sit at an arbitrary fixed height that happened to fall
   * between two procedural towers, so it read as dangling in mid air. It is
   * now derived from `SIGNAL_TOWER`'s roof, and these pin that relationship
   * rather than the coordinate, so moving the tower moves the lamp with it.
   */
  it('stands on the signal tower roof, not in mid air', () => {
    // Just above the roofline: the mount and base plate close the gap.
    expect(BAT_LAMP.y).toBeLessThan(SIGNAL_TOWER.roofY)
    expect(SIGNAL_TOWER.roofY - BAT_LAMP.y).toBeLessThanOrEqual(10)
  })

  it('sits within the footprint of the tower holding it up', () => {
    expect(BAT_LAMP.x).toBeGreaterThanOrEqual(SIGNAL_TOWER.x)
    expect(BAT_LAMP.x).toBeLessThanOrEqual(SIGNAL_TOWER.x + SIGNAL_TOWER.w)
  })

  it('stands on a tower tall enough to clear the shopfront haze', () => {
    // Low roofs sit in the warm glow off the street, which swallowed the cool
    // lens and made the machine unreadable.
    expect(SIGNAL_TOWER.roofY).toBeLessThan(ART_H - 90)
  })

  it('throws a beam long enough to be worth drawing', () => {
    const reach = Math.hypot(MOON.x - BAT_LAMP.x, MOON.y - BAT_LAMP.y)
    expect(reach).toBeGreaterThan(120)
  })
})
