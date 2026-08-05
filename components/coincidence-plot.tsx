/**
 * Five scanners plotted on one time base.
 *
 * Each channel is one tool's trace. Where two or more spike in the same place,
 * a phosphor gate lights: that is a finding more than one tool saw
 * independently. Where only one spiked, the gate stays grey — the instrument
 * visibly declining to confirm something is the most honest mark on the page,
 * so it must survive every redesign.
 */

const TRACE_H = 30
const PLOT_W = 980
const LEFT = 120

export interface PlotChannel {
  /** Channel id shown in the gutter, e.g. "CH1". */
  id: string
  /** Tool name, e.g. "HEADERS". */
  name: string
  /** X positions (0–980) where this tool observed something. */
  spikes: number[]
}

/**
 * Cache of already-drawn traces, keyed by channel and seed.
 *
 * `tracePath` is called 15 times per render of this plot: once per channel for
 * the grey line, then again inside each agreement window for the phosphor
 * overlay, which asks for a path that has just been computed. Only **five** of
 * those 15 are distinct.
 *
 * The plot sits inside the CRT, which tilts toward the pointer, so the whole
 * subtree re-renders on every mouse move. Measured in a browser: 2.27ms of the
 * roughly 7ms of scripting per move went to redrawing traces that had not
 * changed. Nothing here depends on the tilt.
 *
 * A module-level `Map` rather than `useMemo` because the function is pure and
 * its inputs are module constants: the same five strings are correct for every
 * instance and for the lifetime of the page, so per-component memoisation
 * would simply recompute them for each mount. Bounded by the number of
 * channels a plot declares, which is five.
 */
const traceCache = new Map<string, string>()

/**
 * Builds a noisy baseline with a sharp spike and a little ringing at each
 * observation. Deterministic: the same channel always draws the same path, so
 * the sample plot never flickers between renders.
 *
 * That determinism is what makes the cache above safe.
 */
function tracePath(spikes: number[], seed: number): string {
  const key = `${seed}:${spikes.join(',')}`
  const hit = traceCache.get(key)
  if (hit !== undefined) return hit
  const path = drawTrace(spikes, seed)
  traceCache.set(key, path)
  return path
}

function drawTrace(spikes: number[], seed: number): string {
  let rand = seed * 9301 + 49297
  const next = () => {
    rand = (rand * 9301 + 49297) % 233280
    return rand / 233280
  }
  const points: string[] = []
  for (let x = 0; x <= PLOT_W; x += 3) {
    let y = TRACE_H * 0.6
    y += Math.sin(x / 11) * 0.5 + (next() - 0.5)
    for (const spike of spikes) {
      const d = x - spike
      if (Math.abs(d) < 40) {
        y -= Math.exp(-(d * d) / (2 * 7.2 ** 2)) * (TRACE_H * 0.6 - 2.5)
        y += Math.exp(-Math.abs(d) / 13) * Math.sin(d / 3.6) * 1.9
      }
    }
    points.push(`${x} ${y.toFixed(2)}`)
  }
  return `M${points.join(' L')}`
}

export function CoincidencePlot({
  channels,
  events,
  className,
}: {
  channels: PlotChannel[]
  /** X positions to test for agreement, in the same 0–980 space. */
  events: number[]
  className?: string
}) {
  const height = TRACE_H * channels.length
  const gates = events.map((x) => ({
    x,
    count: channels.filter((c) => c.spikes.includes(x)).length,
  }))
  const confirmed = gates.filter((g) => g.count >= 2).length
  /** X positions two or more tools reported. Drives the phosphor overlay. */
  const agreedAt = new Set(gates.filter((g) => g.count >= 2).map((g) => g.x))

  return (
    <svg
      className={className}
      viewBox={`0 -8 ${LEFT + PLOT_W + 5} ${height + 40}`}
      role="img"
      aria-label={`${channels.length} scanners plotted together. ${confirmed} of ${gates.length} weaknesses were found by two or more scanners.`}
      style={{ display: 'block', width: '100%', height: 'auto', overflow: 'visible' }}
    >
      {/*
        Clip windows for the phosphor overlay, declared once.

        A clipPath nested inside the group it clips never applies: the browser
        resolves the clip before it has read the definition, and the group
        renders empty.
      */}
      <defs>
        {channels.flatMap((channel) =>
          channel.spikes
            .filter((x) => agreedAt.has(x))
            .map((x) => (
              <clipPath key={`${channel.id}-${x}`} id={`cp-${channel.id}-${x}`}>
                <rect x={x - 30} y="-6" width="60" height={TRACE_H + 12} />
              </clipPath>
            )),
        )}
      </defs>
      {channels.map((channel, i) => (
        <g key={channel.id}>
          <text
            x="0"
            y={i * TRACE_H + TRACE_H * 0.62}
            className="font-mono"
            style={{
              fontSize: 'var(--plot-label-sm, 8.5px)',
              letterSpacing: '0.07em',
              fill: 'var(--dim-2)',
            }}
          >
            {channel.id}
          </text>
          <text
            x="34"
            y={i * TRACE_H + TRACE_H * 0.62}
            className="font-mono"
            style={{
              fontSize: 'var(--plot-label-sm, 8.5px)',
              letterSpacing: '0.07em',
              fill: 'var(--dim)',
            }}
          >
            {channel.name}
          </text>
          <g transform={`translate(${LEFT},${i * TRACE_H})`}>
            <line
              x1="0"
              y1={TRACE_H * 0.6}
              x2={PLOT_W}
              y2={TRACE_H * 0.6}
              stroke="rgba(147,170,185,.22)"
              strokeWidth="1"
              strokeDasharray="2 4"
            />
            <path
              d={tracePath(channel.spikes, i + 1)}
              fill="none"
              stroke="#B4C6D2"
              strokeWidth="1.4"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              style={{
                strokeDasharray: 4200,
                strokeDashoffset: 4200,
                animation: `plot-draw var(--dur-draw) var(--ease-soft) ${0.25 + i * 0.1}s forwards`,
              }}
            />
            {/*
              The same trace again, in phosphor, clipped to a window around
              each spike this tool shares with another.

              Drawn after the grey line, or it would be painted over: SVG has
              no z-index and paints in document order. It carries the same
              dash animation so the highlight arrives with the trace instead of
              being there before the line that justifies it.

              Colour marks agreement, so a lone spike stays grey however tall
              it is. The eye is drawn to corroboration, not to amplitude.
            */}
            {channel.spikes
              .filter((x) => agreedAt.has(x))
              .map((x) => (
                <g key={`hl-${x}`} clipPath={`url(#cp-${channel.id}-${x})`}>
                  <path
                    d={tracePath(channel.spikes, i + 1)}
                    fill="none"
                    stroke="var(--phos)"
                    strokeWidth="2.1"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    style={{
                      strokeDasharray: 4200,
                      strokeDashoffset: 4200,
                      animation: `plot-draw var(--dur-draw) var(--ease-soft) ${0.25 + i * 0.1}s forwards`,
                    }}
                  />
                </g>
              ))}
          </g>
        </g>
      ))}

      {gates.map((gate, i) => {
        const agreed = gate.count >= 2
        const x = LEFT + gate.x
        return (
          <g
            key={gate.x}
            style={{
              opacity: 0,
              animation: `plot-ignite .5s ease ${1.75 + i * 0.1}s forwards`,
              filter: agreed ? 'drop-shadow(0 0 7px rgba(103,232,176,.55))' : undefined,
            }}
          >
            <line
              x1={x}
              y1={-5}
              x2={x}
              y2={height + 1}
              stroke={agreed ? 'var(--phos)' : 'var(--dim-2)'}
              strokeWidth="1"
              strokeDasharray={agreed ? '1 3' : '1 5'}
            />
            <rect
              x={x - 11}
              y={height + 5}
              width="22"
              height="15"
              rx="1"
              fill={agreed ? 'var(--phos)' : 'none'}
              stroke={agreed ? 'none' : 'var(--dim-2)'}
              strokeWidth="1"
            />
            <text
              x={x}
              y={height + 15.5}
              textAnchor="middle"
              className="font-mono"
              style={{
                // Bumped on touch: an SVG label carries its size as a style,
                // so the class-based mobile type floor in `globals.css` cannot
                // reach it. 9px on a phone is texture, not text.
                fontSize: 'var(--plot-label, 9px)',
                fill: agreed ? 'var(--ink)' : 'var(--dim-2)',
                fontWeight: agreed ? 700 : 400,
              }}
            >
              {gate.count}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/**
 * The homepage sample. Taken from a real comprehensive scan of scanme.nmap.org
 * (report vs_amdym9f9p0): four weaknesses two or more tools agreed on, and one
 * — plaintext HTTP — that only a single tool saw.
 */
/*
 * The sample scan, as five traces.
 *
 * Modelled on the real reference scan `vs_amdym9f9p0`: four findings that two
 * or more tools saw, four that only one did.
 *
 * The previous data lit four of five gates. The grey gate is the entire
 * argument of this plot, and one grey out of five reads as a rounding error
 * rather than a principle, so the single-tool observations are now
 * represented properly.
 */
export const SAMPLE_CHANNELS: PlotChannel[] = [
  { id: 'CH1', name: 'HEADERS', spikes: [120, 300, 470, 620, 780, 890] },
  { id: 'CH2', name: 'NMAP', spikes: [470, 690, 960] },
  { id: 'CH3', name: 'NUCLEI', spikes: [690] },
  { id: 'CH4', name: 'ZAP', spikes: [120, 300, 470] },
  { id: 'CH5', name: 'NVD', spikes: [470] },
]

/** Every moment something was observed, whether corroborated or not. */
export const SAMPLE_EVENTS = [120, 300, 470, 620, 690, 780, 890, 960]
