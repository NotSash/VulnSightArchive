'use client'

/**
 * The last-train clock.
 *
 * It sits where a second "Scan a site" button used to be. Two competing calls
 * to action above the fold was redundancy, and this turns the dead space into a
 * reason to keep watching: it is a real countdown to the next train crossing
 * the scene, so when it reaches zero the train actually runs.
 *
 * The seconds are the only part that changes every tick, so they use JetBrains
 * Mono with tabular figures. Jersey 25's digits are not uniform width, and a
 * proportional countdown visibly jitters as it counts down.
 */
export function LastTrainClock({ seconds }: { seconds: number }) {
  /*
   * The countdown never stops, so there is no "NOW" state any more. It used to
   * freeze on NOW for the whole 20 second crossing, which made the one number
   * on the page that should always be moving the only one that stood still.
   *
   * `ceil` rather than `floor`, so the clock reads 30 the instant a cycle
   * begins and only shows 0 at the exact moment of departure, the way a real
   * platform display counts.
   */
  const total = Math.max(0, Math.ceil(seconds))
  const mm = Math.floor(total / 60)
    .toString()
    .padStart(2, '0')
  const ss = (total % 60).toString().padStart(2, '0')
  // The indicator lights while a train is actually in frame.
  const running = seconds > 10

  return (
    <div
      className="hidden items-center gap-2.5 border border-border bg-[#090F16]/80 px-3 py-1.5 backdrop-blur-sm md:flex"
      // Announced only when it changes state, not on every tick: a countdown
      // read aloud once a second would be unusable with a screen reader.
      aria-live="off"
    >
      <span
        aria-hidden="true"
        className={
          running
            ? 'block size-1.5 rounded-full bg-phos shadow-[0_0_6px_var(--phos)]'
            : 'block size-1.5 rounded-full border border-[#1E5641]'
        }
      />
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--dim-2)]">
        Next train
      </span>
      <span className="font-mono text-[13px] font-bold tabular-nums tracking-[0.06em] text-phos">
        {mm}:{ss}
      </span>
      <span className="text-[11px] text-[var(--dim-2)]">to Shinjuku</span>
    </div>
  )
}
