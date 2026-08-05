'use client'

import { createContext, useContext, useMemo, useState } from 'react'

/**
 * Whether the scan on this page is still running.
 *
 * The header and the progress view are siblings under the page, so the header
 * had no way to know the scan had ended. It therefore offered **Stop scan** on
 * the failed screen, directly above the words "The scan stopped", and on the
 * expired screen, where it offered to stop a scan that no longer exists.
 * Pressing it opened a destructive confirmation for a no-op.
 *
 * A context rather than lifting the polling itself: the polling belongs with
 * the view that renders it, and moving it up would make the page component a
 * client component and pull the whole scan view into one file. This shares one
 * boolean and nothing else.
 *
 * Defaults to `true` so the button is present on the very first paint, before
 * any status has arrived. A scan page that opens with no way to stop the scan
 * would be worse than one that briefly offers it.
 */

interface ScanLiveState {
  live: boolean
  setLive: (value: boolean) => void
}

const ScanLiveContext = createContext<ScanLiveState | null>(null)

export function ScanLiveProvider({ children }: { children: React.ReactNode }) {
  const [live, setLive] = useState(true)
  const value = useMemo(() => ({ live, setLive }), [live])
  return <ScanLiveContext.Provider value={value}>{children}</ScanLiveContext.Provider>
}

/**
 * Read the live flag. Returns `true` outside a provider, so a header rendered
 * on its own still behaves as it did before.
 */
export function useScanLive(): ScanLiveState {
  return useContext(ScanLiveContext) ?? { live: true, setLive: () => {} }
}
