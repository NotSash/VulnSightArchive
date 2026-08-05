'use client'

import { Inbox } from 'lucide-react'
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { EmptyState } from '@/components/results/empty-state'
import { SEVERITY_META, SEVERITY_ORDER } from '@/lib/severity'
import type { SeverityDistribution } from '@/types/report'

export function SeverityChart({ distribution }: { distribution: SeverityDistribution }) {
  const data = SEVERITY_ORDER.map((severity) => ({
    severity,
    label: SEVERITY_META[severity].label,
    count: distribution[severity],
    fill: SEVERITY_META[severity].cssVar,
  }))

  const total = data.reduce((sum, d) => sum + d.count, 0)

  if (total === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No findings to chart"
        description="Nothing to plot yet. Findings appear here once detected."
      />
    )
  }

  // Plain-language summary read by assistive tech in place of the SVG.
  const summary = data
    .filter((d) => d.count > 0)
    .map((d) => `${d.count} ${d.label.toLowerCase()}`)
    .join(', ')

  return (
    <div>
      <p className="sr-only">
        Severity distribution across {total} findings: {summary}.
      </p>
      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 28, bottom: 0, left: 0 }}
            accessibilityLayer={false}
          >
            <XAxis type="number" hide allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="label"
              tickLine={false}
              axisLine={false}
              width={64}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
            />
            <Bar
              dataKey="count"
              radius={[0, 6, 6, 0]}
              barSize={20}
              isAnimationActive={false}
              minPointSize={2}
            >
              {data.map((entry) => (
                <Cell key={entry.severity} fill={entry.fill} />
              ))}
              <LabelList
                dataKey="count"
                position="right"
                offset={8}
                className="fill-foreground"
                style={{
                  fontSize: 12,
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 500,
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
