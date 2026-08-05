/**
 * The light pipeline: blur the glow buffer, then add it to the scene.
 *
 * Two things here were found by rendering, not by reasoning, and both would
 * have shipped as "the lamps look like spiders".
 *
 * 1. `ctx.filter = 'blur(3.4px)'` is one line and looks correct. It is a silent
 *    no-op in node-canvas, and Safari only shipped canvas `filter` in 17.0. The
 *    property reads back as the string you set, so nothing warns you: earlier
 *    Safari would simply render hard-edged discs. Hence the hand-written blur.
 *
 * 2. Glow shapes are drawn opaque. Once several overlap, the buffer's alpha
 *    channel is 255 nearly everywhere, so blurring alpha and using it as the
 *    falloff produced a flat wash rather than halos. The fix is to ignore alpha
 *    entirely and blur *brightness*: a glow buffer is an additive light map, so
 *    its RGB values already encode intensity and black already means no light.
 *
 * Three box passes converge on a Gaussian closely enough to be
 * indistinguishable at this scale, and the cost is paid once per resize.
 */

/** Blurs RGB in place, ignoring alpha. Alpha is meaningless in a light map. */
export function boxBlurRgb(data: Uint8ClampedArray, w: number, h: number, radius: number) {
  if (radius < 1) return
  const tmp = new Uint8ClampedArray(data.length)
  for (let pass = 0; pass < 3; pass++) {
    blurH(data, tmp, w, h, radius)
    blurV(tmp, data, w, h, radius)
  }
}

/** Blurs the alpha channel too. Used for the cloud mask, where alpha is shape. */
export function boxBlurRgba(data: Uint8ClampedArray, w: number, h: number, radius: number) {
  if (radius < 1) return
  const tmp = new Uint8ClampedArray(data.length)
  for (let pass = 0; pass < 3; pass++) {
    blurH(data, tmp, w, h, radius, true)
    blurV(tmp, data, w, h, radius, true)
  }
}

function blurH(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  r: number,
  withAlpha = false,
) {
  const span = r * 2 + 1
  for (let y = 0; y < h; y++) {
    const row = y * w * 4
    let a0 = 0
    let a1 = 0
    let a2 = 0
    let a3 = 0
    for (let i = -r; i <= r; i++) {
      const x = i < 0 ? 0 : i >= w ? w - 1 : i
      const p = row + x * 4
      a0 += src[p] ?? 0
      a1 += src[p + 1] ?? 0
      a2 += src[p + 2] ?? 0
      if (withAlpha) a3 += src[p + 3] ?? 0
    }
    for (let x = 0; x < w; x++) {
      const p = row + x * 4
      dst[p] = a0 / span
      dst[p + 1] = a1 / span
      dst[p + 2] = a2 / span
      dst[p + 3] = withAlpha ? a3 / span : 255
      const po = row + (x - r < 0 ? 0 : x - r) * 4
      const pi = row + (x + r + 1 >= w ? w - 1 : x + r + 1) * 4
      a0 += (src[pi] ?? 0) - (src[po] ?? 0)
      a1 += (src[pi + 1] ?? 0) - (src[po + 1] ?? 0)
      a2 += (src[pi + 2] ?? 0) - (src[po + 2] ?? 0)
      if (withAlpha) a3 += (src[pi + 3] ?? 0) - (src[po + 3] ?? 0)
    }
  }
}

function blurV(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  r: number,
  withAlpha = false,
) {
  const span = r * 2 + 1
  for (let x = 0; x < w; x++) {
    const col = x * 4
    let a0 = 0
    let a1 = 0
    let a2 = 0
    let a3 = 0
    for (let i = -r; i <= r; i++) {
      const y = i < 0 ? 0 : i >= h ? h - 1 : i
      const p = col + y * w * 4
      a0 += src[p] ?? 0
      a1 += src[p + 1] ?? 0
      a2 += src[p + 2] ?? 0
      if (withAlpha) a3 += src[p + 3] ?? 0
    }
    for (let y = 0; y < h; y++) {
      const p = col + y * w * 4
      dst[p] = a0 / span
      dst[p + 1] = a1 / span
      dst[p + 2] = a2 / span
      dst[p + 3] = withAlpha ? a3 / span : 255
      const po = col + (y - r < 0 ? 0 : y - r) * w * 4
      const pi = col + (y + r + 1 >= h ? h - 1 : y + r + 1) * w * 4
      a0 += (src[pi] ?? 0) - (src[po] ?? 0)
      a1 += (src[pi + 1] ?? 0) - (src[po + 1] ?? 0)
      a2 += (src[pi + 2] ?? 0) - (src[po + 2] ?? 0)
      if (withAlpha) a3 += (src[pi + 3] ?? 0) - (src[po + 3] ?? 0)
    }
  }
}

/**
 * Blurs the light map and adds it into `target`.
 *
 * Straight additive: `out = base + light`. No alpha weighting, for the reason
 * in the header. `gain` scales the whole light layer, which is the single knob
 * for "the scene is too bright" or "too dim".
 */
export function compositeGlow(
  target: CanvasRenderingContext2D,
  glow: CanvasRenderingContext2D,
  w: number,
  h: number,
  radius = 3,
  gain = 1,
) {
  const g = glow.getImageData(0, 0, w, h)
  boxBlurRgb(g.data, w, h, radius)
  const base = target.getImageData(0, 0, w, h)
  const bd = base.data
  const gd = g.data
  for (let i = 0; i < bd.length; i += 4) {
    const r = (gd[i] ?? 0) * gain
    const gg = (gd[i + 1] ?? 0) * gain
    const b = (gd[i + 2] ?? 0) * gain
    if (r < 1 && gg < 1 && b < 1) continue
    bd[i] = Math.min(255, (bd[i] ?? 0) + r)
    bd[i + 1] = Math.min(255, (bd[i + 1] ?? 0) + gg)
    bd[i + 2] = Math.min(255, (bd[i + 2] ?? 0) + b)
  }
  target.putImageData(base, 0, 0)
}
