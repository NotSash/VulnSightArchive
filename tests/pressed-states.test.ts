import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Pressed states, from Part 4 session 4C.
 *
 * Verified against the production stylesheet by holding the mouse down and
 * reading computed styles: a `.press` key travels 3px and its shadow goes to
 * none; a `.press.shadow-hard` key travels and its 4px shadow also goes to
 * none; a `.press-soft` panel scales to 0.985. Under reduced motion the key
 * still travels (instantly) and the panel does not scale at all.
 */
const root = join(__dirname, '..')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const css = strip(readFileSync(join(root, 'app/globals.css'), 'utf8'))
const form = readFileSync(join(root, 'components/scan/scan-form.tsx'), 'utf8')
const crt = readFileSync(join(root, 'components/crt-console.tsx'), 'utf8')

describe('4C-1: press had nothing to collapse', () => {
  it('carries its own shadow rather than assuming one', () => {
    /*
     * Only 2 of 27 uses of `press` also had `shadow-hard`. On the other 25 the
     * button slid 3px down and right with nothing underneath, which reads as
     * falling off its position rather than being pressed. The travel and the
     * shadow are one gesture and have to ship together.
     */
    expect(css).toMatch(/\.press\s*\{[^}]*box-shadow:\s*3px 3px/)
  })

  it('collapses the larger shadow too', () => {
    /*
     * `.press.shadow-hard` is two classes and outranks `.press:active`, so the
     * larger buttons travelled but kept their shadow. Measured before the fix:
     * `active sh=4px 4px` when it should have been none.
     */
    expect(css).toContain('.press.shadow-hard:active')
  })

  it('does not ease the shadow', () => {
    // A key going down is instant. Easing it feels spongy, and this interface
    // is meant to feel like hardware.
    expect(css).toMatch(/\.press\s*\{[^}]*transition:\s*transform/)
  })
})

describe('4C-2: controls with no pressed state', () => {
  it('gives the depth picker a depress', () => {
    /*
     * Three options sit side by side, so three hard offset shadows would read
     * as clutter. A depress suits something you choose between; a key-travel
     * suits something you fire. On touch this is the only feedback there is.
     */
    expect(form).toContain('press-soft')
    expect(css).toContain('.press-soft:active')
    expect(css).toContain('transform: scale(0.985)')
  })

  it('does not use an arbitrary scale variant, which emits nothing here', () => {
    /*
     * The first attempt was `active:scale-[0.985]`. Measured `transform: none`
     * while held down: the arbitrary value with a variant was never emitted.
     * Same family as the `motion-safe:` failure in 4A.
     */
    expect(strip(form)).not.toContain('active:scale-[')
  })

  it('gives the sample-report link a key travel', () => {
    // A real call to action, so it gets the key rather than the depress.
    expect(crt).toContain('press inline-flex min-h-11')
  })
})

describe('reduced motion', () => {
  it('drops the panel scale and the easing, but keeps the key travel', () => {
    // The travel is the feedback; removing it would leave the button inert.
    // Removing only the easing makes it instant, which is what reduced motion
    // asks for.
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.press\s*\{\s*transition:\s*none/)
    expect(css).toMatch(/\.press-soft:active\s*\{\s*transform:\s*none/)
  })
})
