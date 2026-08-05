import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { Panel } from '@/components/ui/panel'
import { SEVERITY_META } from '@/lib/severity'
import { cn } from '@/lib/utils'
import type { OwaspCategoryMapping } from '@/types/report'

/** The full OWASP Top 10 (2021), so users see coverage even when clear. */
const OWASP_TOP_10: { id: string; name: string }[] = [
  { id: 'A01:2021', name: 'Broken Access Control' },
  { id: 'A02:2021', name: 'Cryptographic Failures' },
  { id: 'A03:2021', name: 'Injection' },
  { id: 'A04:2021', name: 'Insecure Design' },
  { id: 'A05:2021', name: 'Security Misconfiguration' },
  { id: 'A06:2021', name: 'Vulnerable and Outdated Components' },
  { id: 'A07:2021', name: 'Identification and Authentication Failures' },
  { id: 'A08:2021', name: 'Software and Data Integrity Failures' },
  { id: 'A09:2021', name: 'Security Logging and Monitoring Failures' },
  { id: 'A10:2021', name: 'Server-Side Request Forgery' },
]

export function OwaspSection({ mapping }: { mapping: OwaspCategoryMapping[] }) {
  const byId = new Map(mapping.map((m) => [m.id, m]))

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {OWASP_TOP_10.map((cat) => {
        const hit = byId.get(cat.id)
        const flagged = Boolean(hit && hit.count > 0)
        const sev = hit ? SEVERITY_META[hit.severity] : null

        return (
          <Panel
            key={cat.id}
            className={cn(
              'flex items-start gap-3 p-4',
              flagged && 'border-severity-high/40 bg-severity-high/5',
            )}
          >
            <div
              className={cn(
                'mt-0.5 flex size-8 shrink-0 items-center justify-center',
                flagged
                  ? 'bg-severity-high/15 text-severity-high'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {flagged ? (
                <ShieldAlert className="size-4" aria-hidden />
              ) : (
                <ShieldCheck className="size-4" aria-hidden />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">
                  <span className="font-mono text-muted-foreground">{cat.id}</span> {cat.name}
                </p>
              </div>
              <p
                className="mt-1 text-xs font-medium"
                style={flagged && sev ? { color: sev.cssVar } : undefined}
              >
                <span className={flagged ? '' : 'text-muted-foreground'}>
                  {flagged
                    ? `${hit?.count} finding${hit && hit.count > 1 ? 's' : ''}`
                    : 'No findings'}
                </span>
              </p>
            </div>
          </Panel>
        )
      })}
    </div>
  )
}
