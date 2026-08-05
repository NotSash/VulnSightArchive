/**
 * Which display channel a finding's `source` belongs to.
 *
 * The scanner emits thirteen distinct source names. The interface shows six
 * channels, because a reader does not care that a cookie check and a header
 * check are different modules; they care which independent tool saw something.
 *
 * Without this map the redesign would have attributed findings to channels
 * that do not exist, or dropped them silently. Both are unacceptable in a
 * product whose entire claim is that it never invents or hides data, so an
 * unrecognised source falls back to `OTHER` and is still shown.
 *
 * `tests/channels.test.ts` asserts that every source string used anywhere in
 * `lib/scanner/` has a mapping here. Adding an analyzer without updating this
 * file fails the suite rather than quietly disappearing from the UI.
 */

/** The channels the interface displays, in the order they appear on screen. */
export const CHANNELS = ['HEADERS', 'BROWSER', 'NMAP', 'NUCLEI', 'ZAP', 'NVD', 'OTHER'] as const

export type Channel = (typeof CHANNELS)[number]

/**
 * Source to channel.
 *
 * HEADERS is deliberately broad: it covers everything VulnSight inspects
 * itself from the HTTP response, rather than by driving an external binary.
 * The other five are each one independent tool, which is what the phrase
 * "five scanners" on the marketing copy refers to.
 */
const SOURCE_TO_CHANNEL: Record<string, Channel> = {
  // VulnSight's own response analysis.
  header: 'HEADERS',
  cookie: 'HEADERS',
  transport: 'HEADERS',
  ssl: 'HEADERS',
  html: 'HEADERS',
  dns: 'HEADERS',
  exposure: 'HEADERS',

  // A real Chromium render.
  browser: 'BROWSER',
  'browser-dom': 'BROWSER',

  // External tools, one channel each.
  nmap: 'NMAP',
  nuclei: 'NUCLEI',
  'zap-passive': 'ZAP',
  nvd: 'NVD',
}

/** Every source name this module knows about. Used by the guard test. */
export const KNOWN_SOURCES = Object.keys(SOURCE_TO_CHANNEL)

/**
 * Maps a source to its channel.
 *
 * Unknown sources return `OTHER` rather than throwing or returning null: a
 * finding must never vanish from the interface because a mapping was
 * forgotten. The test is what catches the omission; this is the safety net.
 */
export function channelForSource(source: string): Channel {
  return SOURCE_TO_CHANNEL[source.trim().toLowerCase()] ?? 'OTHER'
}

/**
 * Which channels observed a finding, de-duplicated and in display order.
 *
 * Two sources in the same channel are one channel, not two. That matters:
 * `header` and `cookie` both firing is VulnSight agreeing with itself, and
 * counting it as two independent tools would inflate the confirmation count
 * and undermine the one number the product is built on.
 */
export function channelsForSources(sources: readonly string[]): Channel[] {
  const seen = new Set<Channel>()
  for (const source of sources) seen.add(channelForSource(source))
  return CHANNELS.filter((channel) => seen.has(channel))
}

/**
 * How many *independent* channels back a finding.
 *
 * This is the number the interface renders as "N tools agree", and it is
 * deliberately derived from channels rather than raw confirmations, for the
 * reason above.
 */
export function independentChannelCount(sources: readonly string[]): number {
  return channelsForSources(sources).length
}

/* -------------------------------------------------------------- stages */

/**
 * Which channel a pipeline stage reports into.
 *
 * The scan page lights a lamp per stage; when a finding streams in, the lamp
 * that produced it should be the one that brightens. Stage names come from
 * `STAGES` in `lib/scanner/run.ts` and are matched exactly, so a rename there
 * is caught by the test rather than silently unlinking a lamp.
 */
const STAGE_TO_CHANNEL: Record<string, Channel> = {
  'Resolving DNS': 'HEADERS',
  'Fetching site over HTTP': 'HEADERS',
  'Analyzing security headers': 'HEADERS',
  'Inspecting TLS certificate': 'HEADERS',
  'Fingerprinting technologies': 'HEADERS',
  'Analyzing cookies and transport': 'HEADERS',
  'Checking port reachability': 'HEADERS',
  'Collecting DNS records': 'HEADERS',
  'Probing for exposed files': 'HEADERS',
  'Rendering page (Playwright)': 'BROWSER',
  'Enumerating ports (Nmap)': 'NMAP',
  'Template scanning (Nuclei)': 'NUCLEI',
  'Passive analysis (OWASP ZAP)': 'ZAP',
  'CVE enrichment (NVD)': 'NVD',
  'Scoring and assembling report': 'OTHER',
}

export function channelForStage(stage: string): Channel {
  return STAGE_TO_CHANNEL[stage] ?? 'OTHER'
}

export const KNOWN_STAGES = Object.keys(STAGE_TO_CHANNEL)

/**
 * Stages that are the only contributor to their channel.
 *
 * Nine of the fifteen stages report into HEADERS, so an observation count can
 * only be attributed honestly to the stages that own a channel outright.
 * Showing the channel total under each of the nine would print the same number
 * nine times and badly overstate what any one check found.
 *
 * Derived from `STAGE_TO_CHANNEL` rather than hardcoded. A stage rename used to
 * require editing a duplicate list in the scan page, and
 * nothing would have caught it drifting out of sync.
 */
export function stagesOwningTheirChannel(): Set<string> {
  const perChannel = new Map<Channel, string[]>()
  for (const [stage, channel] of Object.entries(STAGE_TO_CHANNEL)) {
    const list = perChannel.get(channel) ?? []
    list.push(stage)
    perChannel.set(channel, list)
  }
  const sole = new Set<string>()
  for (const [channel, stages] of perChannel) {
    // OTHER is a fallback bucket, not a real tool, so it never owns anything.
    if (channel === 'OTHER') continue
    if (stages.length === 1 && stages[0]) sole.add(stages[0])
  }
  return sole
}
