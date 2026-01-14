/**
 * Admin Dashboard Index Route
 *
 * Renders the main admin dashboard page displaying dotdo metrics and overview.
 * The shell UI (sidebar, header) is provided by the parent layout route (_admin.tsx).
 *
 * ## Features
 * - KPI cards showing key metrics (Active Agents, Workflows, API Calls, Uptime)
 * - API Usage chart
 * - Recent Activity feed
 * - Agent Status grid
 *
 * ## Data Source
 * Uses useDashboardMetrics hook for real-time metrics data.
 */

import { createFileRoute } from '@tanstack/react-router'
import { useAuth } from '~/src/admin/auth'
import { useDashboardMetrics, formatMetricValue } from '~/lib/hooks/use-dashboard-metrics'
import { useReducedMotion } from '~/lib/hooks/use-reduced-motion'
import {
  DashboardGrid,
  KPICard,
  ActivityFeed,
  AgentStatus,
  LazyAreaChartWrapper,
  DashboardErrorBoundary,
  KPICardSkeleton,
  ActivityFeedSkeleton,
  AgentStatusSkeleton,
  ChartSkeleton,
} from '~/components/cockpit'
import { Button } from '~/components/ui/button'

export const Route = createFileRoute('/admin/_admin/')({
  component: AdminDashboard,
})

/**
 * Loading skeleton for the dashboard
 * Uses specialized skeleton components for each section
 */
function DashboardSkeleton() {
  return (
    <div data-testid="dashboard-skeleton">
      {/* Header skeleton */}
      <div className="flex items-center justify-between mb-6">
        <div className="h-8 bg-muted rounded w-48 animate-pulse" />
        <div className="flex items-center gap-4">
          <div className="h-4 bg-muted rounded w-32 animate-pulse" />
          <div className="h-9 bg-muted rounded w-24 animate-pulse" />
        </div>
      </div>

      {/* KPI Grid skeleton */}
      <DashboardGrid cols={4} testId="dashboard-kpi-grid-skeleton">
        {[1, 2, 3, 4].map((i) => (
          <KPICardSkeleton key={i} testId={`kpi-skeleton-${i}`} />
        ))}
      </DashboardGrid>

      {/* Chart skeleton */}
      <div className="my-6">
        <ChartSkeleton
          height={200}
          title="API Usage"
          description="Calls over the last 7 days"
          testId="dashboard-chart-skeleton"
        />
      </div>

      {/* Two column layout skeleton */}
      <div className="grid md:grid-cols-2 gap-6 mt-6">
        <div>
          <div className="h-6 bg-muted rounded w-32 mb-4 animate-pulse" />
          <ActivityFeedSkeleton itemCount={3} />
        </div>
        <div>
          <div className="h-6 bg-muted rounded w-32 mb-4 animate-pulse" />
          <AgentStatusSkeleton agentCount={6} />
        </div>
      </div>
    </div>
  )
}

/**
 * Error state for the dashboard
 */
function DashboardError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div data-testid="dashboard-error" className="text-center py-12">
      <div className="text-destructive text-5xl mb-4">!</div>
      <h2 className="text-xl font-semibold text-destructive mb-2">Error loading dashboard</h2>
      <p data-testid="dashboard-error-message" className="text-muted-foreground mb-6">{error.message}</p>
      <Button data-testid="dashboard-retry-button" type="button" variant="secondary" onClick={onRetry}>
        Try Again
      </Button>
    </div>
  )
}

/**
 * Dashboard content with real metrics data
 *
 * Performance optimizations:
 * - Lazy-loaded charts with Suspense and skeleton fallback
 * - Error boundaries isolate section failures
 * - useReducedMotion for accessibility
 * - Smooth loading transitions
 */
function DashboardWithMetrics() {
  const { metrics, isLoading, error, refresh } = useDashboardMetrics()
  const prefersReducedMotion = useReducedMotion()

  if (isLoading && !metrics) {
    return <DashboardSkeleton />
  }

  if (error) {
    return <DashboardError error={error} onRetry={refresh} />
  }

  if (!metrics) {
    return <DashboardSkeleton />
  }

  // Convert metrics to KPI card format
  const kpis = [
    {
      title: 'Active Agents',
      value: metrics.activeAgents,
      trend: 0,
      icon: 'Users',
      testId: 'dashboard-kpi-active-agents',
    },
    {
      title: 'Workflows',
      value: metrics.totalWorkflows,
      trend: 8,
      icon: 'Activity',
      testId: 'dashboard-kpi-workflows',
    },
    {
      title: 'API Calls',
      value: formatMetricValue(metrics.apiCalls.today),
      trend: metrics.apiCalls.trend,
      icon: 'Code',
      testId: 'dashboard-kpi-api-calls',
    },
    {
      title: 'Uptime',
      value: `${metrics.uptime.percentage}%`,
      icon: 'Rocket',
      testId: 'dashboard-kpi-uptime',
    },
  ]

  // Format last updated time
  const lastUpdatedText = new Date().toLocaleTimeString()

  // Animation class based on reduced motion preference
  const animationClass = prefersReducedMotion ? '' : 'transition-opacity duration-200'

  return (
    <>
      {/* Loading indicator during refresh - respects reduced motion */}
      <div
        data-testid="dashboard-loading"
        className={`fixed top-0 left-0 right-0 h-1 bg-primary z-50 ${animationClass} ${
          isLoading ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ display: isLoading ? 'block' : 'none' }}
        aria-hidden={!isLoading}
        role="progressbar"
        aria-label="Loading dashboard data"
      />

      <div className="flex items-center justify-between mb-6">
        <h1 data-testid="dashboard-heading" className="text-2xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-4">
          <span data-testid="dashboard-last-updated" className="text-sm text-muted-foreground">
            Last updated: {lastUpdatedText}
          </span>
          <Button
            data-testid="dashboard-refresh"
            type="button"
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={isLoading}
            data-loading={isLoading ? 'true' : 'false'}
            aria-label="Refresh dashboard"
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </div>

      {/* KPI Cards with error boundaries for isolation */}
      <DashboardGrid cols={4} testId="dashboard-kpi-grid">
        {kpis.map((kpi) => (
          <DashboardErrorBoundary
            key={kpi.title}
            sectionTitle={kpi.title}
            compact
          >
            <KPICard {...kpi} />
          </DashboardErrorBoundary>
        ))}
      </DashboardGrid>

      {/* Lazy-loaded API Usage Chart with error boundary */}
      <div className="my-6">
        <DashboardErrorBoundary sectionTitle="API Usage Chart">
          <LazyAreaChartWrapper
            data={metrics.chartData.apiUsage}
            xKey="date"
            yKey="calls"
            title="API Usage"
            description="Calls over the last 7 days"
            height={200}
            testId="dashboard-chart-api-usage"
            animate={!prefersReducedMotion}
          />
        </DashboardErrorBoundary>
      </div>

      <div data-testid="dashboard-two-column" className="grid md:grid-cols-2 gap-6 mt-6">
        {/* Activity Feed with error boundary */}
        <div data-testid="activity-feed">
          <h2 data-testid="activity-feed-heading" className="text-lg font-semibold mb-4">Recent Activity</h2>
          <DashboardErrorBoundary sectionTitle="Recent Activity">
            <ActivityFeed items={metrics.recentActivity} />
          </DashboardErrorBoundary>
        </div>

        {/* Agent Status with error boundary */}
        <div data-testid="agent-status-grid">
          <h2 data-testid="agent-status-heading" className="text-lg font-semibold mb-4">Agent Status</h2>
          <DashboardErrorBoundary sectionTitle="Agent Status">
            <AgentStatus agents={metrics.agentStatuses} />
          </DashboardErrorBoundary>
        </div>
      </div>
    </>
  )
}

function AdminDashboard() {
  // Auth state - uses useAuth hook from admin auth module
  const { user, isAuthenticated } = useAuth()

  return (
    <div
      data-testid="admin-dashboard"
      data-mdx-source=".do/App.mdx"
      data-mdxui-cockpit
      data-mdx-runtime
      data-authenticated={isAuthenticated ? 'true' : 'false'}
      data-user-id={user?.id}
      data-user-email={user?.email}
    >
      <DashboardWithMetrics />
    </div>
  )
}
