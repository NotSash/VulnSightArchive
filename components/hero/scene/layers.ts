/**
 * The static half of the scene.
 *
 * Everything here is painted exactly once, to an offscreen canvas, and then
 * blitted whole on every frame. It is the sky, the city and the street: the
 * parts that never change. Only the train, the CRT, the moon, the birds, the
 * petals, the steam, the cat and the rain are repainted per frame.
 *
 * That split is the entire performance strategy. Repainting 600 primitives
 * sixty times a second would cost real battery; blitting one bitmap and then
 * drawing about 120 live primitives does not.
 *
 * Ported from `_for-myself/hero/render-scene.py`, which is the source of truth
 * for the artwork. Constants here should match that file line for line.
 */

import { boxBlurRgba } from './blur'
import {
  ART_H,
  ART_W,
  FG_Y,
  HORIZON,
  LAMP_XS,
  POLE_XS,
  RAIL_Y,
  RAMEN_W,
  RAMEN_X,
  SIGNAL_TOWER,
  TREE_BASE,
  TREE_GAP,
  TREE_X,
  VENT_X,
  WIRE_YS,
} from './geometry'
import * as C from './palette'
import { makeRng, SCENE_SEED } from './rng'

type Ctx = CanvasRenderingContext2D

/** A lit shop window, kept so its reflection can be drawn on the wet street. */
export type ShopWindow = { x0: number; y0: number; x1: number; y1: number; tone: C.Rgb }
/** A lamp bulb, kept for the same reason. */
export type LampBulb = { x: number; y: number }

export type StaticScene = {
  shops: ShopWindow[]
  lamps: LampBulb[]
  /** Windows that flicker occasionally, chosen once so they stay consistent. */
  flickerWindows: ShopWindow[]
  /** Mast tips that blink red. */
  aviation: { x: number; y: number }[]
}

const px = (ctx: Ctx, x: number, y: number, w: number, h: number, c: C.Rgb, a = 1) => {
  ctx.fillStyle = C.rgb(c, a)
  ctx.fillRect(x, y, w, h)
}
const dot = (ctx: Ctx, x: number, y: number, c: C.Rgb, a = 1) => px(ctx, x, y, 1, 1, c, a)

/**
 * Paints the whole static scene into `base`, and every light source into
 * `glow`. The caller blurs `glow` and adds it on top; see `compositeGlow`.
 */
export function paintStatic(base: Ctx, glow: Ctx): StaticScene {
  const rng = makeRng(SCENE_SEED)
  const shops: ShopWindow[] = []
  const lamps: LampBulb[] = []
  const aviation: { x: number; y: number }[] = []

  base.clearRect(0, 0, ART_W, ART_H)
  glow.clearRect(0, 0, ART_W, ART_H)

  // ------------------------------------------------------------------ sky
  // Deep navy at the zenith falling into a sodium haze at the horizon. That
  // warm band is the single thing that makes this read as a real city rather
  // than a black backdrop with buildings on it.
  for (let y = 0; y <= HORIZON; y++) {
    const t = y / HORIZON
    const c =
      t < 0.5
        ? C.mix(C.SKY_ZENITH, C.SKY_MID, t / 0.5)
        : t < 0.8
          ? C.mix(C.SKY_MID, C.SKY_HAZE, (t - 0.5) / 0.3)
          : C.mix(C.SKY_HAZE, C.SKY_WARM, (t - 0.8) / 0.2)
    px(base, 0, y, ART_W, 1, c)
  }

  // Stars, thinning as they approach the haze. Gaussian vertical spread keeps
  // them dense overhead and sparse near the city, which is how a real
  // light-polluted sky looks.
  for (let i = 0; i < 430; i++) {
    const x = rng.int(0, ART_W)
    const g = Math.abs(gauss(rng)) * 60
    const y = Math.floor(g)
    if (y > 145) continue
    const b = rng.pick([30, 40, 52, 66, 84])
    const fade = 1 - (y / 145) * 0.8
    dot(base, x, y, [Math.round(b * 0.88), Math.round(b * 0.95), b], fade)
  }

  /*
   * No moon halo here any more.
   *
   * It used to be baked into the glow buffer, which is painted once per resize.
   * That was fine while the moon sat at a fixed point, but the moon is now
   * clamped into whatever sky the viewport actually shows, so a baked halo
   * would stay behind and leave a bright smudge in an empty patch of sky.
   * `drawMoon` paints its own halo each frame instead.
   */

  // --------------------------------------------------------------- clouds
  // Soft banks, cool up high and warm underneath where the city lights hit
  // them. Drawn as a blurred mask so the edges are not hard pixel ellipses.
  paintClouds(base, rng)

  // --------------------------------------------------------------- ridges
  for (let x = 0; x < ART_W; x++) {
    const y =
      HORIZON -
      44 -
      Math.round(19 * Math.sin(x / 125 + 1.1) + 10 * Math.sin(x / 44) + 5 * Math.sin(x / 18))
    px(base, x, y, 1, HORIZON - y, C.RIDGE_FAR)
  }
  for (let x = 0; x < ART_W; x++) {
    const y = HORIZON - 26 - Math.round(10 * Math.sin(x / 90 + 3) + 6 * Math.sin(x / 30))
    px(base, x, y, 1, HORIZON - y, C.RIDGE_NEAR)
  }

  // The sky gradient stops at HORIZON (196) and the street starts at
  // HORIZON+16 (212). The mid towers stand in those 15 rows, but they only
  // *cover* the band where a building happens to be: the gaps between them
  // were left as raw transparent canvas, which composited to pure black and
  // read as solid dark blocks punched through the skyline. Filling the band
  // with the horizon's own haze first means a gap reads as distance, not as a
  // hole. Painted before the towers so it sits behind them.
  for (let y = HORIZON; y < HORIZON + 16; y++) {
    const t = (y - HORIZON) / 16
    px(base, 0, y, ART_W, 1, C.mix(C.SKY_WARM, C.STREET_NEAR, t))
  }

  // --------------------------------------------------------------- towers
  const tower = (
    x: number,
    w: number,
    h: number,
    bottom: number,
    body: C.Rgb,
    density: number,
    warm: C.Rgb,
  ) => {
    const top = bottom - h
    px(base, x, top, w, h, body)
    px(base, x, top, w, 1, C.mix(body, [210, 220, 235], 0.1))
    px(base, x, top, 1, h, C.mix(body, [210, 220, 235], 0.05))
    if (rng.chance(0.42)) {
      const ax = x + Math.floor(w / 2)
      const ah = rng.pick([5, 9, 14])
      px(base, ax, top - ah, 1, ah, C.mix(body, [200, 210, 225], 0.12))
      if (rng.chance(0.65)) {
        dot(base, ax, top - ah, C.AVIATION)
        glowCircle(glow, ax, top - ah, 3, [46, 10, 8])
        aviation.push({ x: ax, y: top - ah })
      }
    }
    for (let wy = top + 3; wy < bottom - 1; wy += 4) {
      for (let wx = x + 2; wx < x + w - 1; wx += 3) {
        if (!rng.chance(density)) continue
        const t = rng.pick([0.5, 0.75, 1])
        dot(base, wx, wy, C.mix(body, warm, t))
        if (t > 0.9) dot(glow, wx, wy, [40, 26, 10])
      }
    }
    return top
  }

  for (let x = -10; x < ART_W + 12; ) {
    const w = rng.pick([9, 13, 17, 21])
    let h = rng.pick([26, 38, 52, 66, 82])
    // Towers shrink toward the centre of the frame so the wordmark keeps a
    // quiet corridor to sit in.
    const cd = Math.abs(x + w / 2 - ART_W / 2) / (ART_W / 2)
    h = Math.floor(h * (0.42 + 0.58 * cd)) + 10
    tower(x, w, h, HORIZON - 6, C.TOWER_FAR, 0.13, C.WINDOW_FAR)
    x += w + rng.pick([2, 3, 4])
  }

  const signs: { x: number; y: number; h: number }[] = []
  for (let x = -14; x < ART_W + 14; ) {
    const w = rng.pick([16, 22, 28, 34])
    let h = rng.pick([34, 50, 70, 92])
    const cd = Math.abs(x + w / 2 - ART_W / 2) / (ART_W / 2)
    h = Math.floor(h * (0.38 + 0.62 * cd)) + 14
    const top = tower(x, w, h, HORIZON + 16, C.TOWER_MID, 0.17, C.WINDOW_MID)
    if (rng.chance(0.6) && h > 36) {
      const sx = x + rng.pick([1, w - 5])
      const sy = top + rng.int(4, Math.max(5, Math.floor(h / 2)))
      // Nothing vertical inside the tree's column: a signboard punching up
      // through the canopy destroys the read of the branches.
      if (!(sx > TREE_GAP.x0 - 34 && sx < TREE_GAP.x1 + 10)) {
        signs.push({ x: sx, y: sy, h: rng.int(12, Math.min(32, h - 6)) })
      }
    }
    x += w + rng.pick([3, 5, 7])
  }

  /*
   * The Bat-Signal's tower, authored rather than procedural.
   *
   * Painted after the random mid towers so it sits in front of them, and given
   * a slightly lighter body than its neighbours so the roofline is legible
   * against the buildings behind: a black box on a black box has no roof to
   * stand a searchlight on. `batsignal.ts` matches the lamp housing to these
   * exact tones so the machine reads as part of this building.
   */
  {
    const { x, w, roofY } = SIGNAL_TOWER
    const body = C.mix(C.TOWER_MID, [210, 220, 235], 0.06)
    const h = ART_H - roofY
    px(base, x, roofY, w, h, body)
    // Roof cap and lit left edge, so the top plane reads as a surface.
    px(base, x, roofY, w, 1, C.mix(body, [210, 220, 235], 0.16))
    px(base, x, roofY, 1, h, C.mix(body, [210, 220, 235], 0.09))
    // A low parapet, which is what the lamp is actually bolted behind.
    px(base, x + 2, roofY - 2, w - 4, 2, C.mix(body, [210, 220, 235], 0.1))
    px(base, x + 2, roofY - 2, w - 4, 1, C.mix(body, [210, 220, 235], 0.2))
    // Sparse windows, dimmer than the neighbours: this roof is where someone
    // works at night, not a hotel.
    for (let wy = roofY + 6; wy < ART_H - 4; wy += 5) {
      for (let wx = x + 3; wx < x + w - 2; wx += 4) {
        if (!rng.chance(0.13)) continue
        dot(base, wx, wy, C.mix(body, C.WINDOW_MID, rng.pick([0.4, 0.6])))
      }
    }
  }

  // Vertical neon signboards: the most unmistakably Japanese element in the
  // skyline. Abstract blocks, not kanji, because we cannot verify meaning and
  // getting it wrong would be embarrassing.
  for (const s of signs) {
    const tone = rng.pick(C.SIGN_TONES)
    px(base, s.x, s.y, 4, s.h, [5, 8, 13])
    // 1 px lamps on a 3 px pitch. A 2 px block on the same pitch leaves no
    // dark gap between rows, so the sign fuses into a solid white bar and
    // stops reading as a stack of illuminated characters.
    for (let k = s.y + 1; k < s.y + s.h; k += 3) px(base, s.x + 1, k, 2, 1, tone)
    px(glow, s.x - 2, s.y - 2, 8, s.h + 5, C.mix([0, 0, 0], tone, 0.22))
  }

  // ---------------------------------------------------------------- street
  for (let y = HORIZON + 16; y < ART_H; y++) {
    const t = (y - (HORIZON + 16)) / (ART_H - HORIZON - 16)
    px(base, 0, y, ART_W, 1, C.mix(C.STREET_NEAR, C.STREET_FAR, t))
  }

  // ------------------------------------------------------------ shopfronts
  for (let x = -8; x < ART_W + 10; ) {
    const w = rng.pick([28, 36, 44])
    const h = rng.pick([18, 24, 30])
    const top = FG_Y - h
    // The tree stands in a gap in this row.
    const inTreeGap = x + w > TREE_GAP.x0 && x < TREE_GAP.x1
    if (!inTreeGap) {
      px(base, x, top, w, h, C.SHOP_BODY)
      px(base, x, top, w, 1, C.SHOP_EDGE)
      px(base, x + w, top, 1, h, [3, 5, 9])
      if (rng.chance(0.8) && w > 26) {
        const x0 = x + 4
        const x1 = x + w - 5
        const y0 = top + 7
        const y1 = FG_Y - 4
        const tone = rng.pick(C.SHOP_TONES)
        px(base, x0, y0, x1 - x0, y1 - y0, C.mix([0, 0, 0], tone, 0.42))
        for (let m = x0 + 4; m < x1; m += 7)
          px(base, m, y0, 1, y1 - y0, C.mix([0, 0, 0], tone, 0.16))
        // Customers inside, as short dark verticals against the light.
        for (let i = 0, n = rng.int(0, 3); i < n; i++) {
          const pxx = rng.int(x0 + 1, Math.max(x0 + 2, x1 - 1))
          const ph = rng.int(4, 8)
          px(base, pxx, y1 - ph, 1, ph, [18, 14, 12])
        }
        if (rng.chance(0.5)) {
          const nt = rng.pick(C.NOREN_TONES)
          px(base, x0 - 1, y0, x1 - x0 + 2, 4, nt)
          for (let k = x0; k < x1; k += 5) px(base, k, y0 + 1, 1, 3, C.mix(nt, [0, 0, 0], 0.45))
        }
        px(glow, x0 - 3, y0 - 3, x1 - x0 + 6, y1 - y0 + 6, C.mix([0, 0, 0], tone, 0.34))
        shops.push({ x0, y0, x1, y1, tone })
        if (rng.chance(0.45)) {
          const lx = rng.int(x + 3, x + w - 3)
          const ly = top + 2
          px(base, lx, top, 1, 2, [20, 16, 14])
          ellipse(base, lx, ly + 2, 2, 3, C.LANTERN)
          px(base, lx - 2, ly + 2, 5, 1, [150, 60, 48])
          glowEllipse(glow, lx, ly + 2, 7, 8, [64, 20, 14])
        }
      }
    }
    x += w + rng.pick([2, 4])
  }

  paintRamenShop(base, glow, rng)
  paintTree(base, glow, rng)

  // ------------------------------------------------- wires, poles, lamps
  for (const py of WIRE_YS) {
    let prev: [number, number] | null = null
    base.strokeStyle = C.rgb(C.WIRE)
    base.lineWidth = 1
    base.beginPath()
    for (let x = -6; x < ART_W + 8; x += 2) {
      const y = py + Math.sin(((x % 160) / 160) * Math.PI) * 4.5
      if (prev) {
        base.moveTo(prev[0], prev[1] + 0.5)
        base.lineTo(x, y + 0.5)
      }
      prev = [x, y]
    }
    base.stroke()
  }
  for (const p of POLE_XS) {
    px(base, p, ART_H - 116, 1, FG_Y - (ART_H - 116), C.POLE)
    px(base, p - 8, ART_H - 108, 17, 1, C.POLE)
    px(base, p - 6, ART_H - 101, 13, 1, C.POLE)
  }

  for (const lx of LAMP_XS) {
    const lh = rng.int(34, 46)
    const ly = FG_Y - lh
    px(base, lx, ly, 1, lh, [14, 20, 29])
    px(base, lx, ly, 6, 1, [14, 20, 29])
    px(base, lx + 4, ly + 1, 3, 3, C.LAMP_BULB)
    const bx = lx + 5
    const by = ly + 2
    glowCircle(glow, bx, by, 20, [84, 52, 20])
    glowCircle(glow, bx, by, 8, [168, 110, 44])
    lamps.push({ x: bx, y: by })
    // Cone of light down to the pavement.
    for (let k = 0; k < FG_Y - by; k++) {
      const t = k / Math.max(1, FG_Y - by)
      const wd = Math.round(2 + t * 13)
      px(glow, bx - wd, by + k, wd * 2, 1, C.mix([0, 0, 0], C.LAMP_CONE, (1 - t) * 0.16))
    }
    glowEllipse(glow, bx, FG_Y + 2, 22, 7, [56, 34, 14])
  }

  // --------------------------------------------------------------- viaduct
  px(base, 0, RAIL_Y, ART_W, ART_H - RAIL_Y, [7, 11, 17])
  px(base, 0, RAIL_Y, ART_W, 3, C.VIADUCT_DECK)
  px(base, 0, RAIL_Y, ART_W, 1, C.VIADUCT_EDGE)
  for (let p = -4; p < ART_W + 10; p += 34) {
    px(base, p, RAIL_Y + 3, 8, ART_H - RAIL_Y - 3, C.VIADUCT_PILLAR)
    px(base, p, RAIL_Y + 3, 1, ART_H - RAIL_Y - 3, [16, 24, 33])
  }
  for (let k = 0; k < ART_W; k += 3) dot(base, k, RAIL_Y + 1, C.SLEEPER)

  // Reflections of every warm source on the wet pavement. Drawn last so they
  // sit over the street rather than under the shopfronts.
  for (const s of shops) {
    for (let k = 0; k < 12; k++) {
      const y = FG_Y + 1 + k
      const a = (1 - k / 12) ** 2 * 0.3
      const j = rng.pick([-1, 0, 0, 1])
      for (let x = s.x0 + j; x < s.x1 + j; x++) {
        if (rng.chance(0.7)) dot(base, x, y, s.tone, a * 0.55)
      }
    }
  }
  for (const l of lamps) {
    for (let k = 0; k < 14; k++) {
      const y = FG_Y + 1 + k
      const a = (1 - k / 14) ** 2 * 0.28
      px(base, l.x - 2, y, 5, 1, C.LAMP_LIGHT, a)
    }
  }

  // A handful of shop windows flicker occasionally. Picked deterministically
  // rather than by probability: with only ~8 lit shopfronts, a 12% chance per
  // window returned an empty list on this seed, so the feature silently did
  // nothing. Every fourth window always flickers.
  const flickerWindows = shops.filter((_, i) => i % 4 === 1).slice(0, 4)

  return { shops, lamps, flickerWindows, aviation }
}

// ------------------------------------------------------------------ clouds
function paintClouds(base: Ctx, rng: ReturnType<typeof makeRng>) {
  // Built on a separate alpha mask and blurred, so the puffs merge into banks
  // instead of reading as a row of hard ellipses.
  const mask = document.createElement('canvas')
  mask.width = ART_W
  mask.height = ART_H
  // `willReadFrequently`: this mask exists to be read back with
  // `getImageData` below, and Chrome warns that a GPU-backed canvas makes
  // repeated readback slow. The hint asks for a software canvas instead,
  // which is the faster path when reading is the whole point.
  const m = mask.getContext('2d', { willReadFrequently: true })
  if (!m) return
  m.fillStyle = '#fff'
  const banks: [number, number, number, number][] = [
    [64, 52, 1.6, 0.55],
    [292, 26, 1.2, 0.38],
    [178, 86, 2.0, 0.62],
    [444, 78, 1.5, 0.5],
    [24, 112, 1.8, 0.55],
    [356, 120, 2.1, 0.6],
    [238, 140, 1.7, 0.5],
    [120, 150, 1.5, 0.45],
    [430, 158, 1.6, 0.5],
  ]
  for (const [cx, cy, scale, dens] of banks) {
    const n = Math.floor(9 * scale)
    m.globalAlpha = dens
    for (let i = 0; i < n; i++) {
      const x = cx + (i - n / 2) * 6.5 * scale + rng.int(-3, 4)
      const y = cy + Math.sin(i * 1.1) * 2.6 * scale + rng.int(-2, 3)
      const r = rng.int(6, 13) * scale * 0.62
      m.beginPath()
      m.ellipse(x, y, r, r * 0.62, 0, 0, Math.PI * 2)
      m.fill()
    }
  }
  m.globalAlpha = 1
  // `ctx.filter` is not usable here: unsupported in Safari before 17 and a
  // silent no-op in node-canvas, so the puffs would stay hard ellipses.
  const data = m.getImageData(0, 0, ART_W, HORIZON)
  boxBlurRgba(data.data, ART_W, HORIZON, 2)
  const img = base.getImageData(0, 0, ART_W, HORIZON)
  for (let y = 0; y < HORIZON; y++) {
    for (let x = 0; x < ART_W; x++) {
      const i = (y * ART_W + x) * 4
      const a = (data.data[i + 3] ?? 0) / 255
      if (a < 0.02) continue
      const low = Math.min(1, Math.max(0, (y - 60) / 130))
      const tone = C.mix(C.CLOUD_HIGH, C.CLOUD_LOW, low)
      const k = a * 0.75
      img.data[i] = Math.round((img.data[i] ?? 0) + (tone[0] - (img.data[i] ?? 0)) * k)
      img.data[i + 1] = Math.round((img.data[i + 1] ?? 0) + (tone[1] - (img.data[i + 1] ?? 0)) * k)
      img.data[i + 2] = Math.round((img.data[i + 2] ?? 0) + (tone[2] - (img.data[i + 2] ?? 0)) * k)
    }
  }
  base.putImageData(img, 0, 0)
}

// -------------------------------------------------------------- ramen shop
function paintRamenShop(base: Ctx, glow: Ctx, rng: ReturnType<typeof makeRng>) {
  const x = RAMEN_X
  px(base, x, FG_Y - 31, RAMEN_W, 31, [7, 10, 16])
  px(base, x + 3, FG_Y - 22, 24, 18, C.mix([0, 0, 0], C.RAMEN_GLOW, 0.5))
  px(base, x + 2, FG_Y - 24, 26, 3, C.RAMEN_NOREN)
  for (let k = x + 2; k < x + 28; k += 4) px(base, k, FG_Y - 23, 1, 2, [120, 38, 34])
  for (let i = 0; i < 3; i++) {
    const cxx = rng.int(x + 5, x + 25)
    px(base, cxx, FG_Y - 10, 1, 6, [20, 14, 12])
  }
  px(glow, x, FG_Y - 27, RAMEN_W, 26, C.mix([0, 0, 0], C.RAMEN_GLOW, 0.38))
  // The vent the steam curls out of.
  px(base, VENT_X, FG_Y - 35, 4, 4, [16, 22, 30])
}

// -------------------------------------------------------- cherry blossom
function paintTree(base: Ctx, glow: Ctx, rng: ReturnType<typeof makeRng>) {
  // Trunk: half-width falls 2.6 -> 0.6 px, so it is 5 px at the root and one
  // at the crown, and the centreline sweeps about 7 px with a sine. A straight
  // constant-width trunk reads as a drawn line, not a tree.
  for (let i = 0; i < 35; i++) {
    const t = i / 34
    const y = TREE_BASE - Math.floor(t * 34)
    const lean = Math.sin(t * 1.9) * 6.5 - t * 2
    const wdt = 0.6 + 2 * (1 - t) ** 1.35
    const cx = TREE_X + lean
    px(base, Math.round(cx - wdt), y, Math.max(1, Math.round(wdt * 2)), 1, C.BARK)
    dot(base, Math.round(cx - wdt), y, C.BARK_RIM)
    if (t < 0.25 && i % 3 === 0) {
      dot(base, Math.round(cx - wdt - 1), y, [20, 16, 19])
      dot(base, Math.round(cx + wdt + 1), y, [20, 16, 19])
    }
  }
  const topX = TREE_X + Math.sin(1.9) * 6.5 - 2
  const topY = TREE_BASE - 34

  // Limbs fork and curve as they go; real branches are not straight rays.
  const tips: [number, number][] = []
  const limb = (x0: number, y0: number, ang: number, len: number, wdt: number, depth = 0) => {
    const steps = Math.max(3, Math.floor(len))
    let px0 = x0
    let py0 = y0
    for (let i = 0; i < steps; i++) {
      const t = (i + 1) / steps
      const a = ang + Math.sin(t * 2.2 + depth) * 0.3
      const nx = px0 + Math.cos(a)
      const ny = py0 + Math.sin(a)
      const w = Math.max(0, wdt * (1 - t))
      if (w >= 1) {
        base.strokeStyle = C.rgb(C.BRANCH)
        base.lineWidth = Math.max(1, Math.round(w))
        base.beginPath()
        base.moveTo(px0, py0)
        base.lineTo(nx, ny)
        base.stroke()
      } else {
        dot(base, Math.round(nx), Math.round(ny), C.BARK)
      }
      px0 = nx
      py0 = ny
    }
    if (depth < 2 && len > 5) {
      limb(px0, py0, ang - 0.55, len * 0.55, wdt * 0.55, depth + 1)
      limb(px0, py0, ang + 0.45, len * 0.5, wdt * 0.55, depth + 1)
    }
    tips.push([px0, py0])
  }
  for (const [a, l, w] of [
    [-2.6, 16, 1.9],
    [-0.58, 15, 1.9],
    [-1.62, 14, 1.8],
    [-2.15, 11, 1.5],
    [-1.02, 12, 1.5],
  ] as const) {
    limb(topX, topY, a, l, w)
  }

  // Canopy: ten small separated clusters with holes punched through. One solid
  // mass renders as a cauliflower, which the first attempt proved.
  const clusters: [number, number, number, number][] = [
    [TREE_X - 2, TREE_BASE - 55, 12, 7],
    [TREE_X - 15, TREE_BASE - 49, 9, 6],
    [TREE_X + 14, TREE_BASE - 48, 9, 6],
    [TREE_X - 7, TREE_BASE - 61, 8, 5],
    [TREE_X + 8, TREE_BASE - 60, 8, 5],
    [TREE_X - 21, TREE_BASE - 42, 7, 5],
    [TREE_X + 21, TREE_BASE - 41, 7, 5],
    [TREE_X + 1, TREE_BASE - 45, 8, 5],
    [TREE_X - 11, TREE_BASE - 38, 6, 4],
    [TREE_X + 12, TREE_BASE - 37, 6, 4],
  ]
  for (const [cx, cy, rx, ry] of clusters) {
    const n = Math.floor(rx * ry * 3)
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2)
      const rr = rng.next() ** 0.45
      const x = Math.round(cx + Math.cos(a) * rx * rr)
      const y = Math.round(cy + Math.sin(a) * ry * rr)
      if (x < 0 || x >= ART_W || y < 0 || y >= ART_H) continue
      if (rng.chance(0.14)) continue // gaps, so sky shows through
      const up = (y - (cy - ry)) / (2 * ry)
      let col = C.mix(C.BLOSSOM_SHADE, C.BLOSSOM_BLUSH, 0.18 + up * 0.62)
      if (rng.chance(0.26)) col = C.mix(col, C.BLOSSOM, 0.65)
      dot(base, x, y, col)
    }
  }
  for (const [tx, ty] of tips) dot(base, Math.round(tx), Math.round(ty), [30, 24, 27])
  glowEllipse(glow, TREE_X, TREE_BASE - 51, 30, 22, [20, 15, 17])

  // Hanami lantern: about 0.4 m, so 2 px wide and 3 tall at this scale.
  px(base, TREE_X - 12, TREE_BASE - 44, 1, 4, [26, 22, 20])
  px(base, TREE_X - 13, TREE_BASE - 40, 3, 4, C.LANTERN)
  dot(base, TREE_X - 12, TREE_BASE - 38, C.LANTERN_HOT)
  glowEllipse(glow, TREE_X - 12, TREE_BASE - 38, 8, 9, [70, 24, 16])

  px(base, TREE_X - 13, TREE_BASE - 2, 26, 5, [16, 20, 26])
  for (let i = 0; i < 30; i++) {
    const x = rng.int(TREE_X - 40, TREE_X + 42)
    dot(base, x, FG_Y + rng.int(0, 5), C.mix([22, 24, 30], C.BLOSSOM_BLUSH, rng.range(0.2, 0.6)))
  }
}

// ------------------------------------------------------------------ helpers
function gauss(rng: ReturnType<typeof makeRng>) {
  // Box-Muller. Only used for the star field's vertical spread.
  const u = Math.max(1e-9, rng.next())
  const v = rng.next()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function ellipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, c: C.Rgb, a = 1) {
  ctx.fillStyle = C.rgb(c, a)
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
}

function glowCircle(ctx: Ctx, cx: number, cy: number, r: number, c: C.Rgb) {
  ellipse(ctx, cx, cy, r, r, c)
}
function glowEllipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, c: C.Rgb) {
  ellipse(ctx, cx, cy, rx, ry, c)
}
