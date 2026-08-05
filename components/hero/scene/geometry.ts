/**
 * The scene's coordinate system and everything measured in it.
 *
 * All drawing happens on a fixed 480x270 art grid which is then scaled up to
 * the viewport. Working in a small integer grid is what keeps the pixel art
 * crisp: every rectangle lands on a whole art pixel, and the upscale is a
 * nearest-neighbour blit, so nothing is ever half-covered or blurred.
 */
export const ART_W = 480
export const ART_H = 270

/** Where the sky meets the furthest buildings. */
export const HORIZON = 196
/** Baseline of the shopfront row. */
export const FG_Y = ART_H - 46
/** Top of the elevated railway deck. */
export const RAIL_Y = ART_H - 22

/**
 * Scale anchor.
 *
 * A commuter train car is 19 art pixels tall and about 3.6 m in reality, so one
 * art pixel is roughly 0.19 m. Every object in the scene is sized from this
 * rather than eyeballed, which is why the cat is 5 px and not 15.
 *
 *   adult human       1.70 m ->  9 px
 *   shopfront storey  3.00 m -> 16 px
 *   cat incl. tail    0.75 m ->  4 px
 *   paper lantern     0.40 m ->  2 px
 */
export const METRES_PER_PX = 3.6 / 19

/**
 * Moon: preferred centre and radius.
 *
 * Far right, and lower than it first was. The original y=44 looked correct in
 * a 1440x810 window and was invisible almost everywhere else. The scene is
 * scaled to *cover* and anchored to its bottom edge, so a shorter viewport
 * crops from the top: with a browser bookmarks bar at 1568x730 the moon landed
 * at screen y=-8, entirely off the page. Measured across common shapes, y=44
 * was hidden on four of the five tested.
 *
 * This is only the preferred spot. `drawMoon` clamps it into whatever sky is
 * actually on screen, so it survives any viewport. See VISIBLE_SKY_PAD.
 *
 * The radius went 9 -> 13 when the Bat-Signal was added. At r=9 the emblem had
 * an 18px disc to live in, and a bat needs its ears, its scalloped wing edge
 * and a gap of moon around it to be recognisable; at that size those three
 * things competed for the same pixels and it read as a moth. 26px is the
 * smallest disc where all three survive.
 */
export const MOON = { x: 442, y: 76, r: 13 } as const

/**
 * Radius of the moon's outermost halo pass, in art pixels.
 *
 * The horizontal clamp has to clear the *glow*, not the disc. A moon that fits
 * with one pixel to spare still has its halo sliced into a hard vertical line,
 * which reads as a rendering fault rather than a moon. `drawMoon` keeps this
 * whole radius on screen. Kept in step with the outer pass in `drawMoon`.
 */
export const MOON_HALO_R = 30

/**
 * Space kept between the top of the viewport and the top of the moon, in CSS
 * pixels, so the disc never tucks under the fixed header or the last-train
 * clock. The clock's box ends at y=47; this clears it.
 */
export const MOON_TOP_PAD = 76

/**
 * Space kept between the right edge of the viewport and the edge of the moon's
 * halo, in CSS pixels.
 *
 * The scene is scaled to cover, so a wide short window is scaled by its height
 * and runs off both sides. `drawMoon` clamped the top edge and never the side,
 * and the moon sits 93% of the way across the grid, so it was always the first
 * thing lost: measured clipped at 1440x900 and 1280x800.
 */
export const MOON_RIGHT_PAD = 24

/**
 * The gap in the shopfront row where the cherry tree stands. Placed right of
 * centre so the canopy is not shadowed by the call-to-action button, which
 * lands mid-frame.
 */
/**
 * The tower the Bat-Signal stands on.
 *
 * Every other building in the skyline is procedural, but the searchlight needs
 * a roof at a *known* height. Standing it at an arbitrary y put it in the gap
 * between two random towers, where it read as dangling in mid air rather than
 * mounted on anything. This block is authored: fixed position, fixed roofline,
 * deliberately taller than its neighbours so the lamp has clear dark sky
 * behind it and the beam starts from somewhere believable.
 *
 * Sits at the left edge of the cherry gap, in the corridor the skyline already
 * keeps clear for the tree. That corridor is also clear of the wordmark and
 * the subheading, which matters: at x=306 the lamp landed directly behind the
 * body copy and the two fought each other.
 */
export const SIGNAL_TOWER = { x: 322, w: 24, roofY: 158 } as const

export const TREE_GAP = { x0: 336, x1: 424 } as const
export const TREE_X = (TREE_GAP.x0 + TREE_GAP.x1) / 2
export const TREE_BASE = FG_Y + 2

/** The ramen shop: left edge, and the vent the steam rises from. */
export const RAMEN_X = 196
export const RAMEN_W = 30
export const VENT_X = RAMEN_X + 22

/** The cat sits on the ramen shop roof, beside the vent. */
export const CAT_POS = { x: RAMEN_X + 6, y: FG_Y - 33 } as const

/** The CRT: middle-left, clear of the railway. */
export const CRT = { x: 96, y: FG_Y - 30, w: 29, h: 22 } as const

/** Train geometry. Three cars plus a wedge nose. */
export const TRAIN = { car: 64, gap: 3, cars: 3, height: 19 } as const
/** Total length including the nose, used to time the crossing. */
export const TRAIN_LEN = TRAIN.cars * (TRAIN.car + TRAIN.gap) + 9

/** Street lamp positions. The gap at 336..424 belongs to the tree. */
export const LAMP_XS = [40, 120, 254, 306, 462] as const
/** Utility poles carrying the overhead lines. */
export const POLE_XS = [72, 236, 452] as const
/** The three sagging catenaries. */
export const WIRE_YS = [ART_H - 112, ART_H - 106, ART_H - 99] as const
