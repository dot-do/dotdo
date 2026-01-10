/**
 * Chart Components with Lazy Loading
 *
 * Lazy-loaded chart components from the cockpit module for use in UI.
 * Uses React.lazy/Suspense for code splitting to reduce initial bundle size.
 *
 * Features:
 * - Code splitting (Recharts loaded on demand)
 * - Responsive (uses ResponsiveContainer)
 * - Theme-aware (uses HSL colors compatible with CSS variables)
 * - Animated (respects prefers-reduced-motion via animate prop)
 * - Empty state handling
 * - Multi-series support (yKey can be array)
 * - Accessible (aria-labels, screen reader support)
 *
 * @example
 * ```tsx
 * import { AreaChart, BarChart, LineChart, PieChart } from './charts'
 *
 * // Area chart with single series
 * <AreaChart
 *   data={[{ month: 'Jan', sales: 100 }, { month: 'Feb', sales: 200 }]}
 *   xKey="month"
 *   yKey="sales"
 *   title="Monthly Sales"
 * />
 *
 * // Bar chart with multiple series
 * <BarChart
 *   data={data}
 *   xKey="date"
 *   yKey={['revenue', 'expenses']}
 *   showLegend
 * />
 *
 * // Pie chart
 * <PieChart
 *   data={[{ name: 'A', value: 40 }, { name: 'B', value: 60 }]}
 *   nameKey="name"
 *   valueKey="value"
 * />
 * ```
 */

import * as React from 'react'

// =============================================================================
// Types (re-exported for consumers)
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
// Loading Fallback
// =============================================================================

/**
 * Skeleton loading state for charts during lazy load
 */
const ChartSkeleton = React.memo(function ChartSkeleton({
  height = 200,
}: {
  height?: number
}) {
  return (
    <div
      className="p-4 bg-gray-900 rounded-lg border border-gray-800 animate-pulse"
      style={{ height: height + 64 }} // Account for title/padding
      role="status"
      aria-label="Loading chart"
    >
      <div className="h-4 bg-gray-800 rounded w-32 mb-4" />
      <div className="h-full bg-gray-800 rounded" style={{ height }} />
    </div>
  )
})

// =============================================================================
// Lazy-loaded Chart Components
// =============================================================================

/**
 * Lazy load the chart implementations to enable code splitting.
 * Recharts is a large library (~150KB), so deferring its load improves
 * initial page load performance.
 */
const LazyCharts = React.lazy(() =>
  import('../cockpit/charts-impl').then(module => ({
    default: {
      AreaChart: module.AreaChartImpl,
      BarChart: module.BarChartImpl,
      LineChart: module.LineChartImpl,
      PieChart: module.PieChartImpl,
    },
  }))
)

// =============================================================================
// Wrapper Components with Suspense
// =============================================================================

/**
 * Area chart with lazy loading and Suspense boundary.
 */
export function AreaChart<T extends Record<string, unknown>>(
  props: BaseChartProps<T>
): React.ReactElement {
  return (
    <React.Suspense fallback={<ChartSkeleton height={props.height} />}>
      <LazyAreaChartInner {...props} />
    </React.Suspense>
  )
}

const LazyAreaChartInner = React.memo(function LazyAreaChartInner<T extends Record<string, unknown>>(
  props: BaseChartProps<T>
) {
  const [Charts, setCharts] = React.useState<{
    AreaChart: React.ComponentType<BaseChartProps<T>>
  } | null>(null)

  React.useEffect(() => {
    import('../cockpit/charts-impl').then(module => {
      setCharts({ AreaChart: module.AreaChartImpl as React.ComponentType<BaseChartProps<T>> })
    })
  }, [])

  if (!Charts) return <ChartSkeleton height={props.height} />
  return <Charts.AreaChart {...props} />
}) as <T extends Record<string, unknown>>(props: BaseChartProps<T>) => React.ReactElement

/**
 * Bar chart with lazy loading and Suspense boundary.
 */
export function BarChart<T extends Record<string, unknown>>(
  props: BaseChartProps<T> & { layout?: 'horizontal' | 'vertical' }
): React.ReactElement {
  return (
    <React.Suspense fallback={<ChartSkeleton height={props.height} />}>
      <LazyBarChartInner {...props} />
    </React.Suspense>
  )
}

const LazyBarChartInner = React.memo(function LazyBarChartInner<T extends Record<string, unknown>>(
  props: BaseChartProps<T> & { layout?: 'horizontal' | 'vertical' }
) {
  const [Charts, setCharts] = React.useState<{
    BarChart: React.ComponentType<BaseChartProps<T> & { layout?: 'horizontal' | 'vertical' }>
  } | null>(null)

  React.useEffect(() => {
    import('../cockpit/charts-impl').then(module => {
      setCharts({
        BarChart: module.BarChartImpl as React.ComponentType<
          BaseChartProps<T> & { layout?: 'horizontal' | 'vertical' }
        >,
      })
    })
  }, [])

  if (!Charts) return <ChartSkeleton height={props.height} />
  return <Charts.BarChart {...props} />
}) as <T extends Record<string, unknown>>(
  props: BaseChartProps<T> & { layout?: 'horizontal' | 'vertical' }
) => React.ReactElement

/**
 * Line chart with lazy loading and Suspense boundary.
 */
export function LineChart<T extends Record<string, unknown>>(
  props: BaseChartProps<T> & { curved?: boolean }
): React.ReactElement {
  return (
    <React.Suspense fallback={<ChartSkeleton height={props.height} />}>
      <LazyLineChartInner {...props} />
    </React.Suspense>
  )
}

const LazyLineChartInner = React.memo(function LazyLineChartInner<T extends Record<string, unknown>>(
  props: BaseChartProps<T> & { curved?: boolean }
) {
  const [Charts, setCharts] = React.useState<{
    LineChart: React.ComponentType<BaseChartProps<T> & { curved?: boolean }>
  } | null>(null)

  React.useEffect(() => {
    import('../cockpit/charts-impl').then(module => {
      setCharts({
        LineChart: module.LineChartImpl as React.ComponentType<BaseChartProps<T> & { curved?: boolean }>,
      })
    })
  }, [])

  if (!Charts) return <ChartSkeleton height={props.height} />
  return <Charts.LineChart {...props} />
}) as <T extends Record<string, unknown>>(
  props: BaseChartProps<T> & { curved?: boolean }
) => React.ReactElement

/**
 * Pie chart with lazy loading and Suspense boundary.
 */
export function PieChart<T extends Record<string, unknown>>(
  props: PieChartWrapperProps<T>
): React.ReactElement {
  return (
    <React.Suspense fallback={<ChartSkeleton height={props.height} />}>
      <LazyPieChartInner {...props} />
    </React.Suspense>
  )
}

const LazyPieChartInner = React.memo(function LazyPieChartInner<T extends Record<string, unknown>>(
  props: PieChartWrapperProps<T>
) {
  const [Charts, setCharts] = React.useState<{
    PieChart: React.ComponentType<PieChartWrapperProps<T>>
  } | null>(null)

  React.useEffect(() => {
    import('../cockpit/charts-impl').then(module => {
      setCharts({ PieChart: module.PieChartImpl as React.ComponentType<PieChartWrapperProps<T>> })
    })
  }, [])

  if (!Charts) return <ChartSkeleton height={props.height} />
  return <Charts.PieChart {...props} />
}) as <T extends Record<string, unknown>>(props: PieChartWrapperProps<T>) => React.ReactElement
