'use client'

import { useServerInsertedHTML } from 'next/navigation'
import { useState } from 'react'
import { ServerStyleSheet, StyleSheetManager } from 'styled-components'

/**
 * Collects styled-components CSS during server rendering and injects it into
 * the HTML document.
 *
 * Without this, styled-components only creates its styles once JavaScript runs
 * in the browser. The server sends unstyled markup, so the page visibly flashes
 * before the CSS arrives, and anything above the fold renders wrong on first
 * paint. `useServerInsertedHTML` is the App Router hook for handing collected
 * styles back to the streaming response.
 *
 * The sheet is created inside `useState` so each request gets its own instance;
 * a module-level sheet would leak styles between concurrent requests on the
 * server.
 */
export function StyledComponentsRegistry({ children }: { children: React.ReactNode }) {
  const [sheet] = useState(() => new ServerStyleSheet())

  useServerInsertedHTML(() => {
    const styles = sheet.getStyleElement()
    // Clear the tag after handing it over, or the same rules are emitted again
    // on the next flush of a streamed response.
    sheet.instance.clearTag()
    return <>{styles}</>
  })

  // On the client the sheet is unnecessary: styled-components manages its own
  // <style> tags in the document head from that point on.
  if (typeof window !== 'undefined') return <>{children}</>

  return <StyleSheetManager sheet={sheet.instance}>{children}</StyleSheetManager>
}
