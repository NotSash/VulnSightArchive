import type { Metadata, Viewport } from 'next'
import { Inter, Jersey_25, JetBrains_Mono } from 'next/font/google'
import { AnimatedFavicon } from '@/components/animated-favicon'
import { StyledComponentsRegistry } from '@/components/styled-registry'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import './globals.css'

/*
 * Three faces, each with one job.
 *
 * Jersey 25 is the display face. It ships a single weight (400) — asking for
 * anything heavier makes the browser synthesise a fake bold, which smears a
 * pixel font. Never set font-weight above 400 on it.
 *
 * Numbers that change at runtime must NOT use Jersey 25: its digits are not
 * uniform width (317–488 units), so a score animating 0→50 would visibly
 * jitter. Those use JetBrains Mono with tabular-nums instead.
 */
const display = Jersey_25({
  variable: '--font-display',
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
})

const sans = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
})

const mono = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  // Short, because this is what a browser tab has room for.
  title: {
    default: 'VulnSight',
    template: '%s · VulnSight',
  },
  description:
    'Five security scanners read your site the way an attacker would. VulnSight only calls something a problem when more than one of them finds it, so you get a short list worth acting on.',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#070C12',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      /*
        The inline script below adds a `js` class to this element before React
        hydrates, so the className in the DOM no longer matches the one the
        server rendered and React logs a mismatch. This attribute silences that
        for <html>'s own attributes only; children are still checked normally.
        It is the same mechanism every dark-mode-without-flash implementation
        relies on.
      */
      suppressHydrationWarning
      className={`dark ${display.variable} ${sans.variable} ${mono.variable} bg-background`}
    >
      <head>
        {/*
          Marks the document as JavaScript-capable before first paint.

          Any CSS that hides something so JavaScript can reveal it must be
          gated on this class, or the thing stays hidden forever for readers
          without JS. The coincidence plot hit exactly that: its traces were
          `opacity: 0` waiting on an IntersectionObserver that never ran.

          Inline and synchronous on purpose. A deferred script would run after
          the first paint, so the element would flash visible and then hide,
          which is worse than either state on its own.
        */}
        {/*
          Written as a child rather than via `dangerouslySetInnerHTML`. React
          renders a string child of <script> verbatim, so the result is
          identical, and it avoids reaching for an escape hatch named after the
          risk it carries. There is no interpolation and no user input here,
          but the safer spelling costs nothing.
        */}
        <script>{"document.documentElement.classList.add('js')"}</script>
      </head>
      <body className="font-sans antialiased">
        <StyledComponentsRegistry>
          {/* Pulses the tab icon to match the brand mark. Falls back to the
              static /icon.svg when JavaScript is off or motion is reduced. */}
          <AnimatedFavicon />
          <TooltipProvider delay={150}>{children}</TooltipProvider>
          <Toaster position="top-center" />
        </StyledComponentsRegistry>
      </body>
    </html>
  )
}
