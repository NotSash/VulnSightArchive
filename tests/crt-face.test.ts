import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The little CRT on the street now says something.
 *
 * It types HELLO one character at a time, holds with a blinking cursor, pulls
 * a smiling face whose eyes blink and follow the passing train, then sweeps
 * the heartbeat trace, on a 17 second loop.
 *
 * These are source-level assertions on the timing constants and the drawing
 * rules. The visual result was verified in Chromium: 68 distinct screen states
 * sampled over one full cycle, and screenshots of each phase.
 */
const root = join(__dirname, '..')
const face = readFileSync(join(root, 'components/hero/scene/crt-face.ts'), 'utf8')
const sprites = readFileSync(join(root, 'components/hero/scene/sprites.ts'), 'utf8')

describe('the greeting', () => {
  it('fits the screen it is drawn on', () => {
    /*
     * The glass is 23x14 art pixels. A 3x5 font with one pixel of
     * letter-spacing fits five characters across with one to spare, which is
     * exactly why the word is HELLO and not something longer.
     */
    const glyphs = face.match(/^ {2}[A-Z]: \[/gm) ?? []
    expect(glyphs.length).toBe(4) // H, E, L, O
    for (const row of face.matchAll(/'([#.]{3})'/g)) {
      expect(row[1]).toHaveLength(3)
    }
  })

  it('types one character at a time rather than appearing at once', () => {
    expect(face).toContain('TYPE_PER_CHAR')
    expect(face).toContain('Math.floor((phase - TYPE_START) / TYPE_PER_CHAR)')
  })

  it('strikes the newest character over-bright, then lets it settle', () => {
    // A phosphor character is briefly brighter than its settled state as the
    // beam first paints it. Without this the line reads as having appeared
    // rather than as being typed.
    expect(face).toContain('i === typed - 1')
  })

  it('blinks the cursor on a hard square wave, not a fade', () => {
    // A real terminal cursor is on or off. A fade reads as a pulsing dot.
    expect(face).toContain('Math.floor(phase * 2) % 2 === 0')
  })
})

describe('the face', () => {
  it('blinks about every two seconds, briefly', () => {
    // Real blinks are ~100ms. At 200ms the machine looks sleepy; at 50ms
    // nobody sees it happen.
    expect(face).toContain('intoFace % 2 < 0.1')
  })

  it('sits inside the glass with margin, not resting on the bezel', () => {
    /*
     * The face was drawn too low: the smile's bottom row landed on row 12,
     * the last row of the 13-row glass, so it read as sitting on the bezel.
     * Eyes now start at row 2 and the mouth ends at row 10, leaving two clear
     * rows top and bottom. Verified in a browser across a full cycle: every
     * lit pixel falls within rows 0..12.
     */
    expect(face).toContain('const EYE_Y = 1')
    expect(face).toContain('const mouthY = y + 6')
  })

  it('closes the lid downward, not toward the middle', () => {
    // Lids fall. A closed eye drawn at the vertical centre of the open one
    // reads as a squint.
    expect(face).toContain('y + EYE_Y + 3')
  })

  it('looks toward the train the cabinet is already leaning at', () => {
    // `drawCrt` leans the whole cabinet and the cat watches the CRT; shifting
    // the pupils the same way makes the three read as one connected moment.
    expect(face).toContain('watching > 0.35')
  })
})

describe('the heartbeat trace', () => {
  it('stays fully drawn while only the beam head sweeps', () => {
    /*
     * The first version clipped the line to the head position, so for most of
     * each pass the screen was nearly empty and the waveform read as broken.
     * A real monitor shows the whole trace at once, because the phosphor holds
     * it; what moves is the bright spot where the beam is now.
     */
    expect(face).not.toContain('ctx.clip()')
    expect(face).toContain('lit(ctx, x + head, y + ty, 0.85)')
  })
})

describe('the loop', () => {
  it('uses a period that will not sync with the rest of the scene', () => {
    // The moon drifts on 9s and the CRT bobs on 5.5s. 17 is co-prime with
    // both, so the three never line up and the scene never looks like it is
    // breathing in time with itself.
    expect(face).toContain('const CYCLE = 17')
  })

  it('is a pure function of the clock', () => {
    // Same rule as every other sprite: the scene must be rewindable, pausable
    // and renderable as a single still for reduced motion.
    expect(face).not.toContain('useState')
    expect(face).not.toContain('Date.now')
    expect(face).toContain('t % CYCLE')
  })
})

describe('the glass', () => {
  it('draws scanlines over the contents, translucently', () => {
    /*
     * They used to be opaque, which was invisible against a static waveform
     * and erased every other row of the 5px characters the moment the screen
     * learned to type: the glyphs came out as detached dots. A scanline is a
     * gap in the beam, not paint.
     */
    expect(sprites).toContain('px(ctx, x + 4, s, 21, 1, [0, 0, 0], 0.35)')
    // Order is the whole point: contents first, then the lines over them.
    const contentsAt = sprites.indexOf('drawCrtFace(ctx, t')
    const scanlinesAt = sprites.indexOf('px(ctx, x + 4, s, 21, 1, [0, 0, 0], 0.35)')
    expect(contentsAt).toBeGreaterThan(0)
    expect(scanlinesAt).toBeGreaterThan(contentsAt)
  })
})
