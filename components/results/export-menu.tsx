'use client'

import { FileJson, FileText, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { ScanReport } from '@/types/report'

/**
 * Export actions for a completed report.
 *
 * These were a dropdown, which put a floating panel above a page full of
 * stacking contexts — the report's own cards painted over it, so the JSON
 * option was unreachable. There are only ever two exports, so the menu was
 * removed entirely: two plain buttons cannot be occluded, and they cost one
 * fewer click. Fewer moving parts is also fewer things to get wrong.
 *
 * - PDF: the server-generated report from the API route.
 * - JSON: the canonical report contract, serialised client-side.
 */
export function ExportMenu({ report }: { report: ScanReport }) {
  const [busy, setBusy] = useState(false)
  const baseName = `vulnsight-${report.website.domain || report.scan_id}`

  async function handlePdf() {
    setBusy(true)
    try {
      const res = await fetch(`/api/report/${report.scan_id}/pdf`)
      if (!res.ok) throw new Error(`PDF export failed (${res.status})`)
      const blob = await res.blob()
      triggerDownload(URL.createObjectURL(blob), `${baseName}.pdf`, true)
      toast.success('PDF downloaded')
    } catch {
      toast.error("The PDF couldn't be generated. Try again in a moment.")
    } finally {
      setBusy(false)
    }
  }

  function handleJson() {
    try {
      const blob = new Blob([JSON.stringify(report, null, 2)], {
        type: 'application/json',
      })
      triggerDownload(URL.createObjectURL(blob), `${baseName}.json`, true)
      toast.success('JSON downloaded')
    } catch {
      toast.error("The JSON couldn't be prepared.")
    }
  }

  return (
    <div className="flex items-center gap-2 print:hidden">
      <ExportButton
        onClick={handlePdf}
        disabled={busy}
        icon={
          busy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <FileText className="size-3.5" aria-hidden="true" />
          )
        }
        label={busy ? 'Preparing…' : 'PDF'}
        primary
      />
      <ExportButton
        onClick={handleJson}
        icon={<FileJson className="size-3.5" aria-hidden="true" />}
        label="JSON"
      />
    </div>
  )
}

function ExportButton({
  onClick,
  icon,
  label,
  primary,
  disabled,
}: {
  onClick: () => void
  icon: React.ReactNode
  label: string
  primary?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        /*
         * `min-h-11` is 44px, the minimum comfortable touch target on both
         * iOS and Android. These were 35px tall, which is fine for a mouse
         * and a genuine miss-target on a phone. `flex-1` lets the three
         * actions share the width evenly on a narrow screen and is released
         * at `sm`, where they sit at their natural size.
         */
        'press inline-flex min-h-11 flex-1 items-center justify-center gap-2 border px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.07em] transition-colors sm:flex-none',
        primary
          ? 'border-phos bg-phos text-[#03070B] shadow-hard-sm hover:bg-[#7DF0BF]'
          : 'border-input bg-secondary hover:border-phos hover:text-phos',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function triggerDownload(url: string, filename: string, revoke = false) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  if (revoke) setTimeout(() => URL.revokeObjectURL(url), 2000)
}
