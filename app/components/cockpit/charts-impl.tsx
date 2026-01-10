/**
 * Chart Implementation Components (Lazy Loaded)
 *
 * Internal implementation of chart components using Recharts.
 * These are lazy-loaded via React.lazy in charts.tsx for code splitting.
 *
 * @internal Do not import directly - use charts.tsx exports
 */

import * as React from 'react'
import {
  AreaChart as RechartsAreaChart,
  BarChart as RechartsBarChart,
  LineChart as RechartsLineChart,
  PieChart as RechartsPieChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Area,
  Bar,
  Line,
  Pie,
  Cell,
  CartesianGrid,
} from 'recharts'

// =============================================================================
// Theme Colors
// =============================================================================

/**
 * Default theme colors using CSS variable-compatible HSL values.
 * These colors work in both light and dark themes.
 */
export const DEFAULT_COLORS = [
  'hsl(221.2 83.2% 53.3%)', // primary blue
  'hsl(262.1 83.3% 57.8%)', // purple
  'hsl(142.1 76.2% 36.3%)', // green
  'hsl(38.3 92.8% 50.4%)',  // amber/orange
  'hsl(346.8 77.2% 49.8%)', // red/rose
  'hsl(199.4 95.5% 53.8%)', // cyan
]

// =============================================================================
// Types
// =============================================================================

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
  /** ARIA label for screen readers */
  'aria-label'?: string
}

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
  /** ARIA label for screen readers */
  'aria-label'?: string
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Normalize yKey to array for multi-series support
 */
function normalizeYKeys<T>(yKey?: keyof T | (keyof T)[]): (keyof T)[] {
  if (!yKey) return []
  return Array.isArray(yKey) ? yKey : [yKey]
}

/**
 * Empty state component for charts with no data
 */
const ChartEmptyState = React.memo(function ChartEmptyState({
  message = 'No data available',
}: {
  message?: string
}) {
  return (
    <div
      className="h-full flex items-center justify-center text-gray-500"
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  )
})

/**
 * Tooltip styles for consistent dark theme appearance
 */
const TOOLTIP_STYLE = {
  backgroundColor: '#1F2937',
  border: '1px solid #374151',
  borderRadius: '8px',
  color: '#F9FAFB',
}

// =============================================================================
// Chart Components
// =============================================================================

interface AreaChartWrapperProps<T = Record<string, unknown>> extends BaseChartProps<T> {}

/**
 * Area chart component with responsive container and theme support.
 * Memoized to prevent unnecessary re-renders.
 */
export const AreaChartImpl = React.memo(function AreaChartImpl<T extends Record<string, unknown>>({
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
  'aria-label': ariaLabel,
}: AreaChartWrapperProps<T>) {
  const yKeys = normalizeYKeys(yKey)

  // Generate accessible description
  const accessibleLabel = ariaLabel || `Area chart${title ? `: ${title}` : ''} with ${data.length} data points`

  return (
    <div
      data-component="AreaChart"
      data-data-count={data.length.toString()}
      className="p-4 bg-gray-900 rounded-lg border border-gray-800"
      role="figure"
      aria-label={accessibleLabel}
    >
      {title && <h4 className="font-semibold">{title}</h4>}
      {description && (
        <p className="text-sm text-gray-500 mb-4">{description}</p>
      )}
      <div style={{ height }} aria-hidden="true">
        {data.length === 0 ? (
          <ChartEmptyState />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <RechartsAreaChart
              data={data}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#374151" />}
              {xKey && (
                <XAxis
                  dataKey={xKey as string}
                  stroke="#9CA3AF"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
              )}
              <YAxis
                stroke="#9CA3AF"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              {showTooltip && (
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              )}
              {showLegend && <Legend />}
              {yKeys.map((key, index) => (
                <Area
                  key={String(key)}
                  type="monotone"
                  dataKey={key as string}
                  stroke={colors[index % colors.length]}
                  fill={colors[index % colors.length]}
                  fillOpacity={0.3}
                  isAnimationActive={animate}
                />
              ))}
            </RechartsAreaChart>
          </ResponsiveContainer>
        )}
      </div>
      {/* Screen reader data summary */}
      <div className="sr-only" role="status">
        {data.length > 0 && yKeys.length > 0 && (
          <span>
            Data ranges from{' '}
            {Math.min(...data.map(d => Number(d[yKeys[0]]) || 0))} to{' '}
            {Math.max(...data.map(d => Number(d[yKeys[0]]) || 0))}
          </span>
        )}
      </div>
    </div>
  )
}) as <T extends Record<string, unknown>>(props: AreaChartWrapperProps<T>) => React.ReactElement

interface BarChartWrapperProps<T = Record<string, unknown>> extends BaseChartProps<T> {
  layout?: 'horizontal' | 'vertical'
}

/**
 * Bar chart component with responsive container and theme support.
 * Memoized to prevent unnecessary re-renders.
 */
export const BarChartImpl = React.memo(function BarChartImpl<T extends Record<string, unknown>>({
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
  'aria-label': ariaLabel,
}: BarChartWrapperProps<T>) {
  const yKeys = normalizeYKeys(yKey)

  const accessibleLabel = ariaLabel || `Bar chart${title ? `: ${title}` : ''} with ${data.length} data points`

  return (
    <div
      data-component="BarChart"
      data-data-count={data.length.toString()}
      className="p-4 bg-gray-900 rounded-lg border border-gray-800"
      role="figure"
      aria-label={accessibleLabel}
    >
      {title && <h4 className="font-semibold">{title}</h4>}
      {description && (
        <p className="text-sm text-gray-500 mb-4">{description}</p>
      )}
      <div style={{ height }} aria-hidden="true">
        {data.length === 0 ? (
          <ChartEmptyState />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <RechartsBarChart
              data={data}
              layout={layout === 'vertical' ? 'vertical' : 'horizontal'}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#374151" />}
              {xKey && (
                <XAxis
                  dataKey={layout === 'vertical' ? undefined : (xKey as string)}
                  type={layout === 'vertical' ? 'number' : 'category'}
                  stroke="#9CA3AF"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
              )}
              <YAxis
                dataKey={layout === 'vertical' ? (xKey as string) : undefined}
                type={layout === 'vertical' ? 'category' : 'number'}
                stroke="#9CA3AF"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              {showTooltip && (
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              )}
              {showLegend && <Legend />}
              {yKeys.map((key, index) => (
                <Bar
                  key={String(key)}
                  dataKey={key as string}
                  fill={colors[index % colors.length]}
                  isAnimationActive={animate}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </RechartsBarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}) as <T extends Record<string, unknown>>(props: BarChartWrapperProps<T>) => React.ReactElement

interface LineChartWrapperProps<T = Record<string, unknown>> extends BaseChartProps<T> {
  curved?: boolean
}

/**
 * Line chart component with responsive container and theme support.
 * Memoized to prevent unnecessary re-renders.
 */
export const LineChartImpl = React.memo(function LineChartImpl<T extends Record<string, unknown>>({
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
  'aria-label': ariaLabel,
}: LineChartWrapperProps<T>) {
  const yKeys = normalizeYKeys(yKey)

  const accessibleLabel = ariaLabel || `Line chart${title ? `: ${title}` : ''} with ${data.length} data points`

  return (
    <div
      data-component="LineChart"
      data-data-count={data.length.toString()}
      className="p-4 bg-gray-900 rounded-lg border border-gray-800"
      role="figure"
      aria-label={accessibleLabel}
    >
      {title && <h4 className="font-semibold">{title}</h4>}
      {description && (
        <p className="text-sm text-gray-500 mb-4">{description}</p>
      )}
      <div style={{ height }} aria-hidden="true">
        {data.length === 0 ? (
          <ChartEmptyState />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <RechartsLineChart
              data={data}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#374151" />}
              {xKey && (
                <XAxis
                  dataKey={xKey as string}
                  stroke="#9CA3AF"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
              )}
              <YAxis
                stroke="#9CA3AF"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              {showTooltip && (
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              )}
              {showLegend && <Legend />}
              {yKeys.map((key, index) => (
                <Line
                  key={String(key)}
                  type={curved ? 'monotone' : 'linear'}
                  dataKey={key as string}
                  stroke={colors[index % colors.length]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={animate}
                />
              ))}
            </RechartsLineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}) as <T extends Record<string, unknown>>(props: LineChartWrapperProps<T>) => React.ReactElement

/**
 * Pie chart component with responsive container and theme support.
 * Memoized to prevent unnecessary re-renders.
 */
export const PieChartImpl = React.memo(function PieChartImpl<T extends Record<string, unknown>>({
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
  'aria-label': ariaLabel,
}: PieChartWrapperProps<T>) {
  const accessibleLabel = ariaLabel || `Pie chart${title ? `: ${title}` : ''} with ${data.length} segments`

  return (
    <div
      data-component="PieChart"
      data-data-count={data.length.toString()}
      className="p-4 bg-gray-900 rounded-lg border border-gray-800"
      role="figure"
      aria-label={accessibleLabel}
    >
      {title && <h4 className="font-semibold">{title}</h4>}
      {description && (
        <p className="text-sm text-gray-500 mb-4">{description}</p>
      )}
      <div style={{ height }} aria-hidden="true">
        {data.length === 0 ? (
          <ChartEmptyState />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <RechartsPieChart>
              {showTooltip && (
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              )}
              {showLegend && <Legend />}
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
                {data.map((entry, index) => (
                  <Cell
                    key={nameKey ? String(entry[nameKey]) : `cell-${index}`}
                    fill={colors[index % colors.length]}
                  />
                ))}
              </Pie>
            </RechartsPieChart>
          </ResponsiveContainer>
        )}
      </div>
      {/* Screen reader data summary */}
      <div className="sr-only" role="status">
        {data.length > 0 && nameKey && valueKey && (
          <ul>
            {data.map((entry, index) => (
              <li key={nameKey ? String(entry[nameKey]) : index}>
                {String(entry[nameKey])}: {String(entry[valueKey])}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}) as <T extends Record<string, unknown>>(props: PieChartWrapperProps<T>) => React.ReactElement
