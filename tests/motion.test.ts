import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Motion choreography, from Part 4 session 4A.
 *
 * Before: six easing curves in use, three of them near-identical expo-outs
 * differing in the third decimal; three stagger classes defined and used zero
 * times; no entrance on home at all; and the whole results page fading in as
 * one slab.
 *
 * Verified against the production stylesheet: `animate-rise` resolves to 340ms
 * on `cubic-bezier(0.16, 1, 0.3, 1)`, a stagger index of 3 gives exactly 120ms
 * of delay, and both are `animation: none` under reduced motion.
 */
const root = join(__dirname, '..')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const css = strip(readFileSync(join(root, 'app/globals.css'), 'utf8'))
const reveal = strip(readFileSync(join(root, 'components/reveal-on-scroll.tsx'), 'utf8'))
const sources = [
  'components/coincidence-plot.tsx',
  'components/crt-console.tsx',
  'components/results/verdict.tsx',
  'components/scan/scan-progress.tsx',
].map((f) => [f, readFileSync(join(root, f), 'utf8')] as const)

describe('4A-1: one easing curve', () => {
  it('defines the tokens once', () => {
    expect(css).toContain('--ease: cubic-bezier(0.16, 1, 0.3, 1)')
    expect(css).toContain('--ease-soft: cubic-bezier(0.33, 1, 0.68, 1)')
  })

  it('leaves no hard-coded curve anywhere else', () => {
    // Six curves became two tokens. Only the definitions may name a bezier.
    const beziers = css.match(/cubic-bezier\([^)]*\)/g) ?? []
    expect(beziers.length).toBe(2)
    for (const [file, src] of sources) {
      expect(strip(src), file).not.toContain('cubic-bezier')
    }
  })

  it('defines a duration scale rather than ad-hoc values', () => {
    for (const t of ['--dur-fast:', '--dur-base:', '--dur-slow:', '--stagger:']) {
      expect(css).toContain(t)
    }
  })
})

describe('4A-2: the stagger was dead', () => {
  it('replaces the three unused classes with one index-driven rule', () => {
    /*
     * `.animate-rise-1/-2/-3` carried baked-in delays and were used zero
     * times. Reading the index from a custom property lets a parent stagger
     * any number of children, so a list that grows does not silently stop
     * staggering at item four.
     */
    expect(css).toContain('calc(var(--i, 0) * var(--stagger))')
    expect(css).not.toContain('.animate-rise-1')
    expect(css).not.toContain('.animate-rise-3')
  })
})

describe('4A-3: entrances', () => {
  it('reveals rather than hides', () => {
    /*
     * The element is visible by default and the animation only moves it toward
     * its resting state. Starting at `opacity: 0` and waiting for JavaScript
     * is the exact bug Part 1 spent a session fixing: with scripts off the
     * content is simply gone. Worst case here is a missing flourish.
     */
    expect(reveal).toContain("cn(seen && 'animate-rise', className)")
    expect(reveal).not.toContain('opacity-0')
  })

  it('fires once and disconnects', () => {
    expect(reveal).toContain('observer.disconnect()')
  })

  it('does not rely on motion-safe, which this setup never emits', () => {
    /*
     * The first attempt used `motion-safe:animate-rise`. The class was applied
     * to the element, the CSS existed, and nothing happened: the variant is
     * not emitted here, so it matched no rule at all. Caught by measuring
     * `animationName` rather than trusting the class list.
     */
    expect(reveal).not.toContain('motion-safe:')
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.animate-rise,/)
  })
})
