import { cn } from '@/lib/utils'

/**
 * A street lamp. The scan's whole visual language, in one component.
 *
 * Four states, each meaning exactly one thing:
 *
 *   idle   dull, unlit          queued, has not started
 *   live   throbbing halo       running right now
 *   done   bright, steady halo  finished and reported
 *   dead   dark, hatched        could not run at all
 *
 * Deliberately CSS shapes rather than pixel art. Pixel art is the hero's
 * language; a 20px pixel-art lamp sitting next to 14px Inter body copy would
 * read as a sticker pasted on. What carries over from the hero is the one rule
 * that matters: light is soft and has a source. No hard concentric rings.
 *
 * The `live` state gets a pulse ring as well as a brighter halo. In a row of
 * fifteen lamps a brightness difference alone is not enough to find the one
 * that is running; that was measured on the mockups, not assumed.
 */

export type LampState = 'idle' | 'live' | 'done' | 'dead'

export interface LampProps {
  state: LampState
  /** Roughly a CSS pixel width for the fixture head. Default 20. */
  size?: number
  /**
   * Staggers the throb so a row of live lamps does not pulse in lockstep,
   * which reads as a machine rather than a street.
   */
  delayMs?: number
  className?: string
}

const HEAD: Record<LampState, string> = {
  // Dull phosphor, no light cast. Present but asleep.
  idle: 'bg-[#103428] border-[#1b3f31]',
  // Brightness is animated; this is the floor it pulses from.
  live: 'bg-phos border-phos',
  done: 'bg-phos border-phos',
  // Not a lamp that is off: a lamp that is broken. Hatched so it reads as
  // deliberate rather than as a rendering failure.
  dead: 'border-[#22303e] bg-[repeating-linear-gradient(135deg,#0d141c_0px,#0d141c_2px,#141d27_2px,#141d27_4px)]',
}

export function Lamp({ state, size = 20, delayMs = 0, className }: LampProps) {
  const lit = state === 'done' || state === 'live'
  /*
   * Below 14px the housing border falls under a pixel and the halo swamps the
   * fixture, so a row of small lamps reads as a smear of green rather than as
   * distinct lights. At that size the lamp becomes a crisp pip: same colour
   * language, no glow to bleed, still legible next to 10px type.
   */
  const compact = size < 14
  return (
    <span
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size + 10, height: size * 0.72 + 10 }}
    >
      {/*
        The pulse ring, live only. Sized from the fixture so it scales with it.
        `aria-hidden` on every decorative layer: the state is announced once, by
        the label the caller puts next to the lamp, not five times by its parts.
      */}
      {state === 'live' && (
        <span
          aria-hidden="true"
          className="lamp-ring absolute rounded-full border border-phos/45"
          style={{ width: size + 16, height: size + 16, animationDelay: `${delayMs}ms` }}
        />
      )}

      {/* The housing, so the fixture reads as an object rather than a swatch. */}
      {!compact && (
        <span
          aria-hidden="true"
          className="absolute rounded-[3px] border border-[#1a2732] bg-[#080d13]"
          style={{ width: size + 6, height: size * 0.72 + 6 }}
        />
      )}

      {/* The lit element. */}
      <span
        aria-hidden="true"
        className={cn(
          'relative rounded-[2px] border',
          HEAD[state],
          state === 'live' && !compact && 'lamp-throb',
          state === 'done' && !compact && 'shadow-[0_0_10px_2px_rgba(103,232,176,0.45)]',
          compact && lit && 'shadow-[0_0_4px_rgba(103,232,176,0.5)]',
        )}
        style={{
          width: size,
          height: size * 0.72,
          animationDelay: state === 'live' ? `${delayMs}ms` : undefined,
        }}
      />

      {/* The pool of light on the ground. Only lit lamps cast one, and only at
          a size where it will not swallow the fixture. */}
      {lit && !compact && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute rounded-[50%]',
            state === 'done' ? 'opacity-100' : 'lamp-throb opacity-80',
          )}
          style={{
            width: size * 3.6,
            height: size * 1.9,
            background:
              'radial-gradient(closest-side, rgba(103,232,176,0.22), rgba(103,232,176,0))',
            animationDelay: `${delayMs}ms`,
          }}
        />
      )}
    </span>
  )
}

/**
 * The four states with their meanings, for use under a row of lamps.
 *
 * Naming them once in a key is why the lamps themselves carry no captions:
 * fifteen repeated labels crowded the row badly in the mockup.
 */
export function LampKey({ className }: { className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-9 gap-y-3', className)}>
      {(
        [
          ['idle', 'not started'],
          ['live', 'running now'],
          ['done', 'reported'],
          ['dead', 'could not run'],
        ] as const
      ).map(([state, label]) => (
        <li key={state} className="flex items-center gap-2.5">
          <Lamp state={state} size={14} />
          <span className="text-[12.5px] text-[var(--dim)]">{label}</span>
        </li>
      ))}
    </ul>
  )
}
