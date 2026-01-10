/**
 * Chart Components
 *
 * Chart wrapper components for cockpit dashboards.
 * Built on Recharts with shadcn/ui styling.
 */

import * as React from 'react'
import {
  AreaChart as RechartsAreaChart,
  BarChart as RechartsBarChart,
  LineChart as RechartsLineChart,
  PieChart as RechartsPieChart,
  XAxis,
  YAxis,
  Area,
  Bar,
  Line,
  Pie,
  Cell,
  CartesianGrid,
} from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@mdxui/primitives/chart'

// ============================================================================
// Constants and Helpers
// ============================================================================

/**
 * Default theme colors using CSS variables.
 * Example hsl() values: hsl(210, 100%, 50%) for primary blue.
 */
export const DEFAULT_COLORS = [
  'var(--color-primary)',   // primary blue
  'var(--color-purple)',    // purple
  'var(--color-green)',     // green
  'var(--color-amber)',     // amber/orange
  'var(--color-red)',       // red/rose
  'var(--color-cyan)',      // cyan
]

/**
 * Helper to normalize yKey to array.
 * Handles both single key and array of keys for multi-series charts.
 */
export function normalizeYKeys<T>(yKey?: keyof T | (keyof T)[]): (keyof T)[] {
  if (!yKey) return []
  return Array.isArray(yKey) ? yKey : [yKey]
}

// ============================================================================
// Empty State Component
// ============================================================================

/**
 * Empty state component shown when chart has no data.
 */
export function ChartEmptyState({ message = 'No data available' }: { message?: string }) {
  return (
    <div className="h-full flex items-center justify-center text-muted-foreground">
      {message}
    </div>
  )
}

// ============================================================================
// Chart Types
// ============================================================================

export interface BaseChartProps<T = Record<string, unknown>> {
  data?: T[]
  xKey?: keyof T
  yKey?: keyof T | (keyof T)[]
  title?: string
  description?: string
  height?: number
  colors?: string[]
  showLegend?: boolean
  showTooltip?: boolean
  showGrid?: boolean
  animate?: boolean
}

interface AreaChartWrapperProps<T = Record<string, unknown>> extends BaseChartProps<T> {}

/**
 * AreaChart wrapper component with shadcn styling.
 */
export function AreaChart<T extends Record<string, unknown>>({
  data = [],
  xKey,
  yKey,
  title,
  description,
  height = 200,
  colors = DEFAULT_COLORS,
  showLegend = false,
  showTooltip = true,
  showGrid = true,
  animate = true,
}: AreaChartWrapperProps<T>) {
  const yKeys = normalizeYKeys(yKey)

  // Build shadcn chart config from yKeys and colors
  const chartConfig = React.useMemo(() => {
    const config: ChartConfig = {}
    yKeys.forEach((key, index) => {
      config[String(key)] = {
        label: String(key),
        color: colors[index % colors.length],
      }
    })
    return config
  }, [yKeys, colors])

  return (
    <div
      data-component="AreaChart"
      data-data-count={data.length.toString()}
      className="p-4 bg-background rounded-lg border"
    >
      {title && <h4 className="font-semibold">{title}</h4>}
      {description && (
        <p className="text-sm text-muted-foreground mb-4">{description}</p>
      )}
      <div style={{ height }}>
        {data.length === 0 ? (
          <ChartEmptyState />
        ) : (
          <ChartContainer config={chartConfig} className="h-full w-full">
            <RechartsAreaChart
              data={data}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-border" />}
              {xKey && (
                <XAxis
                  dataKey={xKey as string}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  className="text-xs fill-muted-foreground"
                />
              )}
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                className="text-xs fill-muted-foreground"
              />
              {showTooltip && (
                <ChartTooltip content={<ChartTooltipContent />} />
              )}
              {showLegend && (
                <ChartLegend content={<ChartLegendContent />} />
              )}
              {yKeys.map((key, index) => (
                <Area
                  key={String(key)}
                  type="monotone"
                  dataKey={key as string}
                  stroke={`var(--color-${String(key)})`}
                  fill={`var(--color-${String(key)})`}
                  fillOpacity={0.3}
                  isAnimationActive={animate}
                />
              ))}
            </RechartsAreaChart>
          </ChartContainer>
        )}
      </div>
    </div>
  )
}

interface BarChartWrapperProps<T = Record<string, unknown>> extends BaseChartProps<T> {
  layout?: 'horizontal' | 'vertical'
}

/**
 * BarChart wrapper component with shadcn styling.
 */
export function BarChart<T extends Record<string, unknown>>({
  data = [],
  xKey,
  yKey,
  title,
  description,
  height = 200,
  colors = DEFAULT_COLORS,
  showLegend = false,
  showTooltip = true,
  showGrid = true,
  animate = true,
  layout = 'horizontal',
}: BarChartWrapperProps<T>) {
  const yKeys = normalizeYKeys(yKey)

  // Build shadcn chart config from yKeys and colors
  const chartConfig = React.useMemo(() => {
    const config: ChartConfig = {}
    yKeys.forEach((key, index) => {
      config[String(key)] = {
        label: String(key),
        color: colors[index % colors.length],
      }
    })
    return config
  }, [yKeys, colors])

  return (
    <div
      data-component="BarChart"
      data-data-count={data.length.toString()}
      className="p-4 bg-background rounded-lg border"
    >
      {title && <h4 className="font-semibold">{title}</h4>}
      {description && (
        <p className="text-sm text-muted-foreground mb-4">{description}</p>
      )}
      <div style={{ height }}>
        {data.length === 0 ? (
          <ChartEmptyState />
        ) : (
          <ChartContainer config={chartConfig} className="h-full w-full">
            <RechartsBarChart
              data={data}
              layout={layout === 'vertical' ? 'vertical' : 'horizontal'}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-border" />}
              {xKey && (
                <XAxis
                  dataKey={layout === 'vertical' ? undefined : (xKey as string)}
                  type={layout === 'vertical' ? 'number' : 'category'}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  className="text-xs fill-muted-foreground"
                />
              )}
              <YAxis
                dataKey={layout === 'vertical' ? (xKey as string) : undefined}
                type={layout === 'vertical' ? 'category' : 'number'}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                className="text-xs fill-muted-foreground"
              />
              {showTooltip && (
                <ChartTooltip content={<ChartTooltipContent />} />
              )}
              {showLegend && (
                <ChartLegend content={<ChartLegendContent />} />
              )}
              {yKeys.map((key, index) => (
                <Bar
                  key={String(key)}
                  dataKey={key as string}
                  fill={`var(--color-${String(key)})`}
                  isAnimationActive={animate}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </RechartsBarChart>
          </ChartContainer>
        )}
      </div>
    </div>
  )
}

interface LineChartWrapperProps<T = Record<string, unknown>> extends BaseChartProps<T> {
  curved?: boolean
}

/**
 * LineChart wrapper component with shadcn styling.
 */
export function LineChart<T extends Record<string, unknown>>({
  data = [],
  xKey,
  yKey,
  title,
  description,
  height = 200,
  colors = DEFAULT_COLORS,
  showLegend = false,
  showTooltip = true,
  showGrid = true,
  animate = true,
  curved = true,
}: LineChartWrapperProps<T>) {
  const yKeys = normalizeYKeys(yKey)

  // Build shadcn chart config from yKeys and colors
  const chartConfig = React.useMemo(() => {
    const config: ChartConfig = {}
    yKeys.forEach((key, index) => {
      config[String(key)] = {
        label: String(key),
        color: colors[index % colors.length],
      }
    })
    return config
  }, [yKeys, colors])

  return (
    <div
      data-component="LineChart"
      data-data-count={data.length.toString()}
      className="p-4 bg-background rounded-lg border"
    >
      {title && <h4 className="font-semibold">{title}</h4>}
      {description && (
        <p className="text-sm text-muted-foreground mb-4">{description}</p>
      )}
      <div style={{ height }}>
        {data.length === 0 ? (
          <ChartEmptyState />
        ) : (
          <ChartContainer config={chartConfig} className="h-full w-full">
            <RechartsLineChart
              data={data}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-border" />}
              {xKey && (
                <XAxis
                  dataKey={xKey as string}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  className="text-xs fill-muted-foreground"
                />
              )}
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                className="text-xs fill-muted-foreground"
              />
              {showTooltip && (
                <ChartTooltip content={<ChartTooltipContent />} />
              )}
              {showLegend && (
                <ChartLegend content={<ChartLegendContent />} />
              )}
              {yKeys.map((key, index) => (
                <Line
                  key={String(key)}
                  type={curved ? 'monotone' : 'linear'}
                  dataKey={key as string}
                  stroke={`var(--color-${String(key)})`}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={animate}
                />
              ))}
            </RechartsLineChart>
          </ChartContainer>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// PieChart with different props structure
// ============================================================================

export interface PieChartWrapperProps<T = Record<string, unknown>> {
  data?: T[]
  nameKey?: keyof T
  valueKey?: keyof T
  title?: string
  description?: string
  height?: number
  colors?: string[]
  showLegend?: boolean
  showTooltip?: boolean
  animate?: boolean
  innerRadius?: number
  outerRadius?: number
}

/**
 * PieChart wrapper component with shadcn styling.
 */
export function PieChart<T extends Record<string, unknown>>({
  data = [],
  nameKey,
  valueKey,
  title,
  description,
  height = 200,
  colors = DEFAULT_COLORS,
  showLegend = true,
  showTooltip = true,
  animate = true,
  innerRadius = 0,
  outerRadius = 80,
}: PieChartWrapperProps<T>) {
  // Build shadcn chart config from data entries
  const chartConfig = React.useMemo(() => {
    const config: ChartConfig = {}
    data.forEach((item, index) => {
      const key = nameKey ? String(item[nameKey]) : `item-${index}`
      config[key] = {
        label: key,
        color: colors[index % colors.length],
      }
    })
    return config
  }, [data, nameKey, colors])

  return (
    <div
      data-component="PieChart"
      data-data-count={data.length.toString()}
      className="p-4 bg-background rounded-lg border"
    >
      {title && <h4 className="font-semibold">{title}</h4>}
      {description && (
        <p className="text-sm text-muted-foreground mb-4">{description}</p>
      )}
      <div style={{ height }}>
        {data.length === 0 ? (
          <ChartEmptyState />
        ) : (
          <ChartContainer config={chartConfig} className="h-full w-full">
            <RechartsPieChart>
              {showTooltip && (
                <ChartTooltip content={<ChartTooltipContent />} />
              )}
              {showLegend && (
                <ChartLegend content={<ChartLegendContent />} />
              )}
              <Pie
                data={data}
                dataKey={valueKey as string}
                nameKey={nameKey as string}
                cx="50%"
                cy="50%"
                innerRadius={innerRadius}
                outerRadius={outerRadius}
                isAnimationActive={animate}
              >
                {data.map((item, index) => {
                  const key = nameKey ? String(item[nameKey]) : `item-${index}`
                  return (
                    <Cell key={`cell-${index}`} fill={`var(--color-${key})`} />
                  )
                })}
              </Pie>
            </RechartsPieChart>
          </ChartContainer>
        )}
      </div>
    </div>
  )
}
