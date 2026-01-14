/**
 * Lazy-Loaded Chart Components
 *
 * Performance-optimized chart components using React.lazy and Suspense.
 * Charts are heavy due to Recharts dependencies, so lazy loading them
 * significantly improves initial page load performance.
 *
 * Features:
 * - React.lazy for code splitting charts
 * - Suspense boundaries with skeleton fallbacks
 * - Animated skeleton loading states
 * - Graceful error handling
 */

import * as React from 'react'
import { Suspense, lazy, memo } from 'react'
import type { BaseChartProps, PieChartWrapperProps } from './charts'

// =============================================================================
// Skeleton Components
// =============================================================================

interface ChartSkeletonProps {
  height?: number
  title?: string
  description?: string
  testId?: string
}

/**
 * Animated skeleton for chart loading states.
 * Matches the visual structure of actual chart components.
 */
export const ChartSkeleton = memo(function ChartSkeleton({
  height = 200,
  title,
  description,
  testId,
}: ChartSkeletonProps) {
  return (
    <div
      data-testid={testId ? `${testId}-skeleton` : 'chart-skeleton'}
      data-component="ChartSkeleton"
      className="p-4 bg-background rounded-lg border animate-pulse"
      role="progressbar"
      aria-label="Loading chart..."
      aria-busy="true"
    >
      {title && (
        <div className="h-5 bg-muted rounded w-32 mb-2" />
      )}
      {description && (
        <div className="h-4 bg-muted rounded w-48 mb-4 opacity-75" />
      )}
      <div
        className="bg-muted rounded-md relative overflow-hidden"
        style={{ height }}
      >
        {/* Shimmer effect */}
        <div
          className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent"
          style={{
            animation: 'shimmer 2s infinite',
          }}
        />
        {/* Chart grid lines placeholder */}
        <div className="absolute inset-4 flex flex-col justify-between opacity-30">
          <div className="h-px bg-muted-foreground/20" />
          <div className="h-px bg-muted-foreground/20" />
          <div className="h-px bg-muted-foreground/20" />
          <div className="h-px bg-muted-foreground/20" />
        </div>
      </div>
    </div>
  )
})

/**
 * Skeleton for KPI cards during loading.
 */
export const KPICardSkeleton = memo(function KPICardSkeleton({
  testId,
}: {
  testId?: string
}) {
  return (
    <div
      data-testid={testId ? `${testId}-skeleton` : 'kpi-skeleton'}
      className="p-6 bg-background rounded-lg border animate-pulse"
      role="progressbar"
      aria-label="Loading metric..."
      aria-busy="true"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="h-4 bg-muted rounded w-24" />
        <div className="h-5 w-5 bg-muted rounded" />
      </div>
      <div className="h-8 bg-muted rounded w-20 mb-2" />
      <div className="h-4 bg-muted rounded w-16 opacity-75" />
    </div>
  )
})

/**
 * Skeleton for activity feed items.
 */
export const ActivityFeedSkeleton = memo(function ActivityFeedSkeleton({
  itemCount = 3,
}: {
  itemCount?: number
}) {
  return (
    <div
      data-testid="activity-feed-skeleton"
      className="space-y-4 animate-pulse"
      role="progressbar"
      aria-label="Loading activity feed..."
      aria-busy="true"
    >
      {Array.from({ length: itemCount }).map((_, i) => (
        <div key={i} className="p-4 bg-background rounded-lg border">
          <div className="h-4 bg-muted rounded w-16 mb-2" />
          <div className="h-5 bg-muted rounded w-48 mb-1" />
          <div className="h-4 bg-muted rounded w-32 opacity-75" />
          <div className="h-3 bg-muted rounded w-24 mt-2 opacity-50" />
        </div>
      ))}
    </div>
  )
})

/**
 * Skeleton for agent status grid.
 */
export const AgentStatusSkeleton = memo(function AgentStatusSkeleton({
  agentCount = 6,
}: {
  agentCount?: number
}) {
  return (
    <div
      data-testid="agent-status-skeleton"
      className="p-6 bg-background rounded-lg border animate-pulse"
      role="progressbar"
      aria-label="Loading agent status..."
      aria-busy="true"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: agentCount }).map((_, i) => (
          <div key={i} className="text-center p-3 bg-card rounded-lg">
            <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-muted" />
            <div className="h-4 bg-muted rounded w-16 mx-auto mb-1" />
            <div className="h-3 bg-muted rounded w-12 mx-auto opacity-75" />
            <div className="h-5 bg-muted rounded-full w-12 mx-auto mt-1" />
          </div>
        ))}
      </div>
    </div>
  )
})

// =============================================================================
// Lazy-Loaded Chart Components
// =============================================================================

// Lazy load the actual chart implementations
const LazyAreaChart = lazy(() =>
  import('./charts').then((mod) => ({ default: mod.AreaChart }))
)

const LazyBarChart = lazy(() =>
  import('./charts').then((mod) => ({ default: mod.BarChart }))
)

const LazyLineChart = lazy(() =>
  import('./charts').then((mod) => ({ default: mod.LineChart }))
)

const LazyPieChart = lazy(() =>
  import('./charts').then((mod) => ({ default: mod.PieChart }))
)

// =============================================================================
// Wrapped Chart Components with Suspense
// =============================================================================

/**
 * Lazy-loaded AreaChart with Suspense boundary.
 * Shows skeleton during load, falls back gracefully on error.
 */
export function LazyAreaChartWrapper<T extends Record<string, unknown>>(
  props: BaseChartProps<T>
) {
  return (
    <Suspense
      fallback={
        <ChartSkeleton
          height={props.height}
          title={props.title}
          description={props.description}
          testId={props.testId}
        />
      }
    >
      <LazyAreaChart {...props} />
    </Suspense>
  )
}

/**
 * Lazy-loaded BarChart with Suspense boundary.
 */
export function LazyBarChartWrapper<T extends Record<string, unknown>>(
  props: BaseChartProps<T> & { layout?: 'horizontal' | 'vertical' }
) {
  return (
    <Suspense
      fallback={
        <ChartSkeleton
          height={props.height}
          title={props.title}
          description={props.description}
          testId={props.testId}
        />
      }
    >
      <LazyBarChart {...props} />
    </Suspense>
  )
}

/**
 * Lazy-loaded LineChart with Suspense boundary.
 */
export function LazyLineChartWrapper<T extends Record<string, unknown>>(
  props: BaseChartProps<T> & { curved?: boolean }
) {
  return (
    <Suspense
      fallback={
        <ChartSkeleton
          height={props.height}
          title={props.title}
          description={props.description}
          testId={props.testId}
        />
      }
    >
      <LazyLineChart {...props} />
    </Suspense>
  )
}

/**
 * Lazy-loaded PieChart with Suspense boundary.
 */
export function LazyPieChartWrapper<T extends Record<string, unknown>>(
  props: PieChartWrapperProps<T>
) {
  return (
    <Suspense
      fallback={
        <ChartSkeleton
          height={props.height}
          title={props.title}
          description={props.description}
        />
      }
    >
      <LazyPieChart {...props} />
    </Suspense>
  )
}

// =============================================================================
// CSS Keyframes (add to global CSS or use CSS-in-JS)
// =============================================================================

// The shimmer animation is defined in the component using inline styles.
// For better performance, add this to your global CSS:
//
// @keyframes shimmer {
//   0% { transform: translateX(-100%); }
//   100% { transform: translateX(100%); }
// }
