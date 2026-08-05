import {
  Camera,
  CheckCircle2,
  ClipboardList,
  Layers,
  Lock,
  Network,
  Server,
  XCircle,
} from 'lucide-react'
import Image from 'next/image'
import { EmptyState } from '@/components/results/empty-state'
import { Chip, Panel } from '@/components/ui/panel'
import { SEVERITY_META } from '@/lib/severity'
import type { ScanReport } from '@/types/report'

function StatusDot({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 className="size-4 text-severity-low" aria-hidden />
  ) : (
    <XCircle className="size-4 text-severity-high" aria-hidden />
  )
}

function PanelHeader({ icon: Icon, title }: { icon: typeof Server; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-border/60 px-5 py-3">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
    </div>
  )
}

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground/90">{value}</dd>
    </div>
  )
}

export function TechnicalDetailsSection({ report }: { report: ScanReport }) {
  const { technologies, ssl, security_headers, open_ports, reachability, evidence } = report

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {report.website.screenshot && (
        <Panel className="lg:col-span-2">
          <PanelHeader icon={Camera} title="Browser screenshot" />
          <div className="bg-muted/30 p-5">
            <Image
              src={report.website.screenshot}
              alt={`Screenshot of ${report.website.domain}`}
              width={1365}
              height={768}
              unoptimized
              className="max-h-[520px] w-full border border-border object-contain"
            />
          </div>
        </Panel>
      )}

      {/* Technologies */}
      <Panel>
        <PanelHeader icon={Layers} title="Detected technologies" />
        <div className="p-5">
          {technologies.length === 0 ? (
            <EmptyState
              icon={Layers}
              tone="unavailable"
              title="No technologies fingerprinted"
              description="The fingerprinting stage did not identify any technologies for this target."
            />
          ) : (
            <ul className="flex flex-wrap gap-2">
              {technologies.map((t) => (
                <li key={`${t.name}-${t.version ?? ''}-${t.source ?? ''}`}>
                  <Chip title={t.evidence ?? t.source ?? undefined}>
                    <span className="font-medium text-foreground">{t.name}</span>
                    {t.version && (
                      <span className="font-mono text-muted-foreground">{t.version}</span>
                    )}
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t.category}
                    </span>
                  </Chip>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      {/* SSL / TLS */}
      <Panel>
        <PanelHeader icon={Lock} title="SSL / TLS certificate" />
        {ssl.available === false ? (
          <EmptyState
            icon={Lock}
            tone="unavailable"
            title="Certificate not inspected"
            description="No TLS handshake was completed for this target, so no certificate details were collected. This is not a finding about the certificate itself."
          />
        ) : (
          <dl className="divide-y divide-border/60 px-5">
            <div className="flex items-center justify-between py-2.5 text-sm">
              <dt className="text-muted-foreground">Certificate valid</dt>
              <dd className="flex items-center gap-1.5 text-foreground">
                <StatusDot ok={ssl.valid} />
                {ssl.valid ? 'Valid' : 'Invalid'}
              </dd>
            </div>
            <div className="flex items-center justify-between py-2.5 text-sm">
              <dt className="text-muted-foreground">Grade</dt>
              <dd className="font-mono text-foreground">{ssl.grade}</dd>
            </div>
            <div className="flex items-center justify-between py-2.5 text-sm">
              <dt className="text-muted-foreground">TLS version</dt>
              <dd className="font-mono text-xs text-foreground">{ssl.tls_version}</dd>
            </div>
            <div className="flex items-center justify-between py-2.5 text-sm">
              <dt className="text-muted-foreground">Issuer</dt>
              <dd className="max-w-[55%] truncate text-right text-foreground">{ssl.issuer}</dd>
            </div>
            <div className="flex items-center justify-between py-2.5 text-sm">
              <dt className="text-muted-foreground">Expires</dt>
              <dd className="text-right text-foreground">
                {ssl.expires}
                <span className="ml-1.5 text-muted-foreground">({ssl.days_remaining}d)</span>
              </dd>
            </div>
          </dl>
        )}
      </Panel>

      {/* Security headers */}
      <Panel>
        <PanelHeader icon={Server} title="Security headers" />
        <ul className="divide-y divide-border/60 px-5">
          {security_headers.map((h) => (
            <li key={h.name} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="flex items-center gap-2">
                <StatusDot ok={h.present} />
                <span className="font-mono text-xs text-foreground">{h.name}</span>
              </span>
              <span className="max-w-[45%] truncate text-right text-xs text-muted-foreground">
                {h.present ? (h.value ?? 'set') : 'missing'}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      {/* Port reachability */}
      <Panel>
        <PanelHeader icon={Network} title="Open ports and services" />
        <div className="px-5">
          {open_ports.length === 0 ? (
            <EmptyState
              icon={Network}
              tone={reachability && reachability.length > 0 ? 'positive' : 'unavailable'}
              title={
                reachability && reachability.length > 0
                  ? 'No open ports confirmed'
                  : 'No port data collected'
              }
              description={
                reachability && reachability.length > 0
                  ? 'No listening service was confirmed on the ports that were checked.'
                  : 'Quick scans skip TCP reachability and Nmap enumeration.'
              }
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {open_ports.map((p) => (
                <li
                  key={`${p.port}-${p.protocol}`}
                  className="grid grid-cols-[70px_1fr_auto] items-center gap-3 py-2.5 text-sm"
                >
                  <span className="font-mono text-xs text-foreground">
                    {p.port}/{p.protocol}
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {p.service}
                    {[p.product, p.version].filter(Boolean).length > 0 && (
                      <span className="ml-1 text-xs text-foreground/80">
                        {[p.product, p.version].filter(Boolean).join(' ')}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground/80">{p.state}</span>
                    <span
                      className={`size-2 rounded-full ${SEVERITY_META[p.risk].bg}`}
                      title={`${SEVERITY_META[p.risk].label} risk`}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      {reachability && reachability.length > 0 && (
        <Panel>
          <PanelHeader icon={Network} title="Web port reachability" />
          <div className="px-5">
            <p className="pt-3 text-xs leading-relaxed text-muted-foreground">
              Direct TCP connection results for the standard web ports. A closed or filtered port is
              a connectivity observation, not a finding.
            </p>
            <ul className="mt-2 divide-y divide-border/60">
              {reachability.map((p) => (
                <li
                  key={`reach-${p.port}-${p.protocol}`}
                  className="flex items-center justify-between gap-3 py-2.5 text-sm"
                >
                  <span className="font-mono text-xs text-foreground">
                    {p.port}/{p.protocol}
                  </span>
                  <span className="text-muted-foreground">{p.service}</span>
                  <span
                    className={
                      p.state === 'open'
                        ? 'text-xs font-medium text-severity-low'
                        : 'text-xs text-muted-foreground/80'
                    }
                  >
                    {p.state}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      )}

      <Panel className="lg:col-span-2">
        <PanelHeader icon={ClipboardList} title="Tool evidence" />
        <dl className="divide-y divide-border/60 px-5 py-2">
          <EvidenceRow
            label="Browser"
            value={
              evidence?.browser?.available
                ? 'Playwright screenshot and rendered DOM collected'
                : (evidence?.browser?.reason ?? 'Not collected')
            }
          />
          <EvidenceRow
            label="Nmap"
            value={
              evidence?.nmap?.available
                ? `${evidence.nmap.ports.length} open port(s) parsed from XML`
                : (evidence?.nmap?.reason ?? 'Not run')
            }
          />
          <EvidenceRow
            label="Nuclei"
            value={
              evidence?.nuclei?.available
                ? `${evidence.nuclei.results.length} template result(s)`
                : (evidence?.nuclei?.reason ?? 'Not run')
            }
          />
          <EvidenceRow
            label="OWASP ZAP"
            value={
              evidence?.zap?.available
                ? `${evidence.zap.alerts.length} passive alert(s)`
                : (evidence?.zap?.reason ?? 'Not run')
            }
          />
          <EvidenceRow
            label="NVD"
            value={
              evidence?.cve?.available
                ? `${evidence.cve.cves.length} matching CVE(s), ${evidence.cve.queried_components.length} component(s) queried`
                : (evidence?.cve?.reason ?? 'Not run')
            }
          />
        </dl>
      </Panel>
    </div>
  )
}
