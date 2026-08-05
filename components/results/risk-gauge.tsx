'use client'

import { PolarAngleAxis, RadialBar, RadialBarChart } from 'recharts'
import { riskCategoryMeta } from '@/lib/severity'
import type { RiskScore } from '@/types/report'

export function RiskGauge({ risk }: { risk: RiskScore }) {
  const meta = riskCategoryMeta(risk.category)
  const data = [{ name: 'risk', value: risk.score, fill: meta.cssVar }]

  return (
    <div
      role="img"
      aria-label={`Overall risk score ${risk.score} out of 100, rated ${risk.category}.`}
      className="relative mx-auto flex size-44 items-center justify-center"
    >
      {/* Decorative chart; the value is announced via the wrapper's role/label. */}
      <div aria-hidden="true">
        <RadialBarChart
          width={176}
          height={176}
          cx="50%"
          cy="50%"
          innerRadius="78%"
          outerRadius="100%"
          barSize={12}
          data={data}
          startAngle={90}
          endAngle={-270}
          accessibilityLayer={false}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar
            background={{ fill: 'var(--muted)' }}
            dataKey="value"
            cornerRadius={8}
            angleAxisId={0}
            isAnimationActive={false}
          />
        </RadialBarChart>
      </div>
      <div
        aria-hidden="true"
        className="absolute inset-0 flex flex-col items-center justify-center"
      >
        <span className="font-mono text-4xl font-semibold tabular-nums text-foreground">
          {risk.score}
        </span>
        <span className="text-xs text-muted-foreground">out of 100</span>
        <span className={`mt-1 text-sm font-medium ${meta.text}`}>{risk.category}</span>
      </div>
    </div>
  )
}
