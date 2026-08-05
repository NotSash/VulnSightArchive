import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The 404, from Part 4 session 4D.
 *
 * There was not one. A mistyped URL got Next's stock page: white background,
 * black text, "404 This page could not be found", with no way back. It was the
 * only screen on the site that did not belong to it, and it arrived at the
 * exact moment someone was already lost.
 *
 * Verified in a browser: serves a real 404 status, 8 of 8 distinct animation
 * frames normally and 1 of 8 under reduced motion, zero overflow at 360 and
 * 390, both actions at 44px.
 */
const root = join(__dirname, '..')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const page = readFileSync(join(root, 'app/not-found.tsx'), 'utf8')
const art = readFileSync(join(root, 'components/lost-signal.tsx'), 'utf8')

describe('the page exists at all', () => {
  it('overrides the framework default', () => {
    expect(existsSync(join(root, 'app/not-found.tsx'))).toBe(true)
  })

  it('offers a way out, in both directions someone might want', () => {
    // The stock page threw the visitor out entirely: no link back, no form.
    expect(page).toContain('href="/"')
    expect(page).toContain('href="/results/sample"')
  })

  it('explains the most likely cause rather than only the symptom', () => {
    // A dead report link is the realistic way to land here, and scans expire
    // after an hour. Saying so turns a dead end into an explanation.
    expect(page).toContain('expired')
  })

  it('uses the tokens established earlier in Part 4', () => {
    expect(page).toContain('prose-measure')
    expect(page).toContain('press')
  })
})

describe('the artwork earns its place', () => {
  it('is the hero CRT with no signal, not decoration', () => {
    /*
     * The same machine the hero puts on the street, showing static and a flat
     * line instead of the heartbeat trace. A CRT with nothing to display is
     * exactly what a missing page is, and a visitor who has seen the front
     * page recognises it.
     */
    expect(art).toContain('static')
    expect(page).toContain('<LostSignal />')
  })

  it('keeps the pixel grid crisp', () => {
    expect(art).toContain("imageRendering: 'pixelated'")
  })

  it('draws scanlines translucently, over the content', () => {
    // Opaque scanlines erased the glyphs on the hero's CRT in 4A's session.
    expect(art).toContain('rgba(0,0,0,0.32)')
  })

  it('renders one still frame under reduced motion', () => {
    // A composed frame, mid-scene, so it reads as a photograph of a dead
    // screen rather than an empty box.
    expect(art).toContain('if (reduced.matches)')
    expect(art).toContain('draw(4)')
  })

  it('stops the loop when the tab is hidden', () => {
    // A canvas loop that runs forever in a background tab is the most
    // expensive mistake available here.
    expect(art).toContain('visibilitychange')
  })

  it('hides the wrapper from assistive tech, not the canvas', () => {
    /*
     * A `<canvas>` is focusable, so `aria-hidden` on it creates an element a
     * keyboard user can land on but a screen reader will not describe. Biome
     * flags this correctly. Hiding the wrapper removes the subtree instead.
     */
    expect(strip(art)).toContain('<div aria-hidden="true"')
    expect(strip(art)).not.toMatch(/<canvas[\s\S]{0,200}aria-hidden/)
  })
})
