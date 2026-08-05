/**
 * Every colour in the hero scene, named once.
 *
 * The product's colour rule survives contact with this artwork only because of
 * how this file is split. The city is amber, sodium, lantern red and bone.
 * Phosphor green appears for exactly one reason: it is the scan. It is on the
 * CRT's screen, the call to action, and nothing else in the scenery. A green
 * shopfront or a green neon sign would quietly break the rule that chroma means
 * either risk severity or scanner agreement.
 *
 * Values are `[r, g, b]` so they can be blended arithmetically without parsing
 * strings on every frame.
 */
export type Rgb = readonly [number, number, number]

export const rgb = (c: Rgb, alpha = 1) =>
  alpha >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${alpha})`

/** Linear blend. `t` is clamped, so callers need not. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = t < 0 ? 0 : t > 1 ? 1 : t
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ]
}

// ---------------------------------------------------------------- sky
export const SKY_ZENITH: Rgb = [6, 10, 18]
export const SKY_MID: Rgb = [12, 20, 33]
/** Light pollution. This warm band is what makes it read as a real city. */
export const SKY_HAZE: Rgb = [40, 40, 52]
export const SKY_WARM: Rgb = [82, 60, 50]

export const MOON_FACE: Rgb = [208, 214, 226]
export const MOON_CRATER: Rgb = [186, 194, 209]
export const MOON_HALO_OUTER: Rgb = [34, 38, 50]
export const MOON_HALO_INNER: Rgb = [76, 82, 98]

export const CLOUD_HIGH: Rgb = [44, 52, 70]
/** Low cloud catches the sodium glow from below. */
export const CLOUD_LOW: Rgb = [122, 88, 68]

// ------------------------------------------------------------- terrain
export const RIDGE_FAR: Rgb = [15, 21, 33]
export const RIDGE_NEAR: Rgb = [12, 17, 28]

export const TOWER_FAR: Rgb = [16, 23, 35]
export const TOWER_MID: Rgb = [10, 15, 24]
export const WINDOW_FAR: Rgb = [214, 148, 80]
export const WINDOW_MID: Rgb = [255, 180, 92]
/** Aviation warning lights on the tallest masts. */
export const AVIATION: Rgb = [236, 92, 80]

export const SIGN_TONES: readonly Rgb[] = [
  [255, 190, 110],
  [255, 146, 92],
  [232, 228, 220],
  [255, 208, 140],
  [240, 120, 110],
]

// -------------------------------------------------------------- street
export const STREET_NEAR: Rgb = [10, 15, 23]
export const STREET_FAR: Rgb = [5, 8, 13]

export const SHOP_BODY: Rgb = [6, 9, 15]
export const SHOP_EDGE: Rgb = [14, 20, 29]
export const SHOP_TONES: readonly Rgb[] = [
  [255, 186, 104],
  [255, 158, 86],
  [244, 210, 152],
  [255, 140, 96],
]
/** Noren, the split curtain hung across a shop doorway. */
export const NOREN_TONES: readonly Rgb[] = [
  [196, 74, 66],
  [38, 58, 96],
  [28, 32, 40],
]
export const LANTERN: Rgb = [236, 108, 84]
export const LANTERN_HOT: Rgb = [255, 168, 132]

export const LAMP_BULB: Rgb = [255, 226, 172]
export const LAMP_LIGHT: Rgb = [255, 190, 110]
export const LAMP_CONE: Rgb = [180, 120, 50]

export const WIRE: Rgb = [9, 14, 21]
export const POLE: Rgb = [11, 17, 25]

// ----------------------------------------------------------- ramen shop
export const RAMEN_GLOW: Rgb = [255, 168, 92]
export const RAMEN_NOREN: Rgb = [188, 66, 58]
export const STEAM_WARM: Rgb = [196, 168, 132]
export const STEAM_COOL: Rgb = [150, 156, 168]

// ----------------------------------------------------------------- tree
export const BARK: Rgb = [24, 19, 22]
export const BARK_RIM: Rgb = [40, 33, 36]
export const BRANCH: Rgb = [26, 21, 24]
/**
 * Sakura at night. NOT pink.
 *
 * Under sodium street light a pale blossom reads bone white with a faint warm
 * blush; candy pink would be both untrue and a saturated hue competing with
 * severity colour. This is the one place the artwork could have broken the
 * palette rule, and this is how it does not.
 */
export const BLOSSOM: Rgb = [238, 228, 230]
export const BLOSSOM_BLUSH: Rgb = [226, 190, 194]
export const BLOSSOM_SHADE: Rgb = [44, 38, 44]

// ------------------------------------------------------------------ cat
export const CAT_DARK: Rgb = [10, 13, 19]
/** One warm pixel along the back. Without it the cat is invisible. */
export const CAT_RIM: Rgb = [168, 132, 84]

// ---------------------------------------------------------------- rail
export const VIADUCT_DECK: Rgb = [22, 31, 43]
export const VIADUCT_EDGE: Rgb = [28, 40, 52]
export const VIADUCT_PILLAR: Rgb = [12, 18, 26]
export const SLEEPER: Rgb = [24, 34, 46]

export const TRAIN_BODY: Rgb = [168, 176, 188]
export const TRAIN_ROOF: Rgb = [206, 214, 224]
export const TRAIN_SKIRT: Rgb = [120, 128, 138]
/**
 * The livery stripe. Deliberately a desaturated teal, not phosphor: it must
 * read as paint on a train, never as a scan signal.
 */
export const TRAIN_STRIPE: Rgb = [86, 176, 140]
export const TRAIN_OUTLINE: Rgb = [44, 54, 64]
export const TRAIN_WINDOW: Rgb = [255, 222, 158]
export const TRAIN_WINDOW_EDGE: Rgb = [92, 78, 52]
export const TRAIN_PASSENGER: Rgb = [120, 88, 44]
export const TRAIN_HEADLIGHT: Rgb = [255, 248, 220]
export const TRAIN_TAILLIGHT: Rgb = [240, 80, 70]

// ------------------------------------------------------------------ CRT
export const CRT_CASE: Rgb = [166, 176, 186]
export const CRT_CASE_LIT: Rgb = [198, 206, 214]
export const CRT_CASE_DARK: Rgb = [48, 58, 68]
export const CRT_SCREEN: Rgb = [10, 44, 40]
export const CRT_BASE: Rgb = [140, 150, 162]
export const CRT_FOOT: Rgb = [112, 122, 134]

/** The scan. The only saturated green in the scene. */
export const PHOS: Rgb = [103, 232, 176]

// --------------------------------------------------------------- weather
export const RAIN: Rgb = [150, 180, 210]
export const VIGNETTE: Rgb = [3, 6, 10]
export const TOP_VEIL: Rgb = [4, 7, 12]
