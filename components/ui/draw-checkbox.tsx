'use client'

import styled from 'styled-components'

/**
 * A checkbox whose square outline redraws itself into a tick.
 *
 * Uiverse `green-bobcat-29` by SelfMadeSystem, kept as styled-components so the
 * original CSS is preserved exactly rather than translated.
 *
 * How it works: one SVG path traces the rounded square *and* the tick, one
 * after the other. `pathLength` normalises the geometry, so animating
 * `stroke-dasharray` and `stroke-dashoffset` slides the visible window from the
 * box segment onto the tick segment. It reads as the box folding into a tick
 * rather than one shape being swapped for another.
 *
 * Two deliberate departures from the original:
 *
 * 1. **The input is visually hidden, not `display: none`.** The original
 *    removes it from the layout entirely, which also removes it from the tab
 *    order and hides it from screen readers. On the one control that gates
 *    every scan, that is not acceptable, so it keeps its box and is made
 *    transparent instead. Focus, the spacebar and announcements all still work.
 * 2. **Colour follows the product rule** rather than the original's white:
 *    amber while the confirmation is outstanding, phosphor once satisfied.
 */

/** Traces the rounded square, then the tick, as one continuous path. */
const PATH =
  'M 0 16 V 56 A 8 8 90 0 0 8 64 H 56 A 8 8 90 0 0 64 56 V 8 A 8 8 90 0 0 56 0 H 8 A 8 8 90 0 0 0 8 V 16 L 32 48 L 64 16 V 8 A 8 8 90 0 0 56 0 H 8 A 8 8 90 0 0 0 8 V 56 A 8 8 90 0 0 8 64 H 56 A 8 8 90 0 0 64 56 V 16'

const Wrapper = styled.span<{ $size: number }>`
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  width: ${(p) => p.$size}px;
  height: ${(p) => p.$size}px;

  /*
   * Visually hidden rather than display:none, so the control stays focusable
   * and announceable. It sits on top of the artwork and owns every click.
   */
  input {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  svg {
    overflow: visible;
    pointer-events: none;
  }

  /* Focus lands on the input; the ring is drawn around the artwork. */
  input:focus-visible ~ svg {
    outline: 2px solid var(--phos);
    outline-offset: 4px;
    border-radius: 3px;
  }

  .path {
    fill: none;
    stroke: var(--amber);
    stroke-width: 6;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition:
      stroke-dasharray 0.5s ease,
      stroke-dashoffset 0.5s ease,
      stroke 0.5s ease;
    stroke-dasharray: 241 9999999;
    stroke-dashoffset: 0;
  }

  input:checked ~ svg .path {
    stroke: var(--phos);
    stroke-dasharray: 70.5096664428711 9999999;
    stroke-dashoffset: -262.2723388671875;
    filter: drop-shadow(0 0 4px rgb(103 232 176 / 45%));
  }
`

export function DrawCheckbox({
  checked,
  onChange,
  size = 26,
  className,
  'aria-label': ariaLabel,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Rendered size in pixels. */
  size?: number
  className?: string
  'aria-label'?: string
}) {
  return (
    <Wrapper $size={size} className={className}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
      />
      <svg viewBox="-4 -4 72 72" width={size} height={size} aria-hidden="true">
        <path d={PATH} pathLength={575.0541381835938} className="path" />
      </svg>
    </Wrapper>
  )
}
