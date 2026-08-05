import { Lamp } from '@/components/ui/lamp'
import type { ScanNote } from '@/types/report'

const STATUS_LABEL: Record<ScanNote['status'], string> = {
  unavailable: 'Not available',
  skipped: 'Not run',
  failed: 'Failed',
  partial: 'Partial coverage',
}

/**
 * Declares what the scan could *not* determine.
 *
 * A deliberate trust feature. Without it a reader cannot tell the difference
 * between "we checked and found nothing" and "we were never able to check",
 * and that ambiguity is what makes a scanner feel dishonest.
 *
 * Each gap is drawn as an unlit lamp, the same component the scan page uses.
 * By the time someone reaches this section they have already watched fifteen
 * lamps light up, so a dark one carries meaning without a caption: that check
 * never ran. It turns the section from an apology in grey text into the last
 * honest statement on the page.
 */
export function CoverageNotes({ notes }: { notes: ScanNote[] }) {
  if (notes.length === 0) return null

  return (
    <div className="border border-border bg-[#080D14]">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-[#03070B]/55 px-4 py-3">
        <h3 className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--dim)]">
          What could not be checked
        </h3>
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--dim-2)]">
          {notes.length} {notes.length === 1 ? 'lamp' : 'lamps'} never lit
        </span>
      </div>

      <p className="px-4 pt-4 text-[13.5px] leading-relaxed text-[var(--dim)]">
        These checks did not run, or did not finish, so this report makes no claim about them. Their
        absence is not evidence that the target is secure in these areas.
      </p>

      <ul className="px-4 pb-5 pt-4">
        {notes.map((note, i) => (
          <li
            key={`${note.stage}-${note.status}`}
            className={
              i > 0
                ? 'flex items-start gap-4 border-t border-border/60 py-4'
                : 'flex items-start gap-4 pb-4'
            }
          >
            <span className="mt-0.5 shrink-0">
              <Lamp state="dead" size={17} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className="text-[14px] font-semibold text-[var(--dim)]">{note.stage}</span>
                <span className="border border-border px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.09em] text-[var(--dim-2)]">
                  {STATUS_LABEL[note.status]}
                </span>
              </div>
              <p className="mt-1.5 text-pretty text-[13px] leading-relaxed text-[var(--dim-2)]">
                {note.detail}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
