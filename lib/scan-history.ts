/**
 * Local record of scans this browser has run.
 *
 * Reports live server-side with a one-hour TTL, so this is only a list of
 * pointers — every entry is verified against the server before it is offered
 * as a link. Kept in localStorage rather than an account because sign-in is
 * deliberately deferred.
 *
 * Superseded by real persistence in a later stage; the shape is intentionally
 * close to what a `scans` table row will look like.
 */

const KEY = 'vulnsight:scans'
const MAX = 25

export interface ScanHistoryEntry {
  scanId: string
  url: string
  score: number
  /** Milliseconds since the epoch. */
  at: number
  mode: string
  findings: number
}

export function readHistory(): ScanHistoryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (e): e is ScanHistoryEntry =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as ScanHistoryEntry).scanId === 'string' &&
          typeof (e as ScanHistoryEntry).at === 'number',
      )
      .sort((a, b) => b.at - a.at)
  } catch {
    return []
  }
}

export function recordScan(entry: ScanHistoryEntry): void {
  if (typeof window === 'undefined') return
  try {
    const existing = readHistory().filter((e) => e.scanId !== entry.scanId)
    const next = [entry, ...existing].slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage can be unavailable (private mode, quota). Not worth surfacing.
  }
}

export function forgetScan(scanId: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(readHistory().filter((e) => e.scanId !== scanId)))
  } catch {
    // Ignore.
  }
}

export function clearHistory(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Ignore.
  }
}

export function relativeTime(at: number): string {
  const mins = Math.round((Date.now() - at) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
