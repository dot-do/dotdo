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
import {
  DashboardGrid,
  KPICard,
  ActivityFeed,
  AgentStatus,
  AreaChart,
} from '~/components/cockpit'
import { Button } from '~/components/ui/button'

export const Route = createFileRoute('/admin/_admin/')({
  component: AdminDashboard,
})

/**
 * Loading skeleton for the dashboard
 */
function DashboardSkeleton() {
  return (
    <div data-testid="dashboard-skeleton" className="animate-pulse">
      <div className="h-8 bg-muted rounded w-48 mb-6" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-32 bg-muted rounded-lg" />
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="h-64 bg-muted rounded-lg" />
        <div className="h-64 bg-muted rounded-lg" />
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
 */
function DashboardWithMetrics() {
  const { metrics, isLoading, error, refresh } = useDashboardMetrics()

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

  return (
    <>
      {/* Loading indicator during refresh */}
      <div
        data-testid="dashboard-loading"
        className={`fixed top-0 left-0 right-0 h-1 bg-primary transition-opacity duration-200 ${
          isLoading ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ display: isLoading ? 'block' : 'none' }}
        aria-hidden={!isLoading}
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

      <DashboardGrid cols={4} testId="dashboard-kpi-grid">
        {kpis.map((kpi) => (
          <KPICard key={kpi.title} {...kpi} />
        ))}
      </DashboardGrid>

      {/* API Usage Chart */}
      <div className="my-6">
        <AreaChart
          data={metrics.chartData.apiUsage}
          title="API Usage"
          description="Calls over the last 7 days"
          testId="dashboard-chart-api-usage"
        />
      </div>

      <div data-testid="dashboard-two-column" className="grid md:grid-cols-2 gap-6 mt-6">
        <div data-testid="activity-feed">
          <h2 data-testid="activity-feed-heading" className="text-lg font-semibold mb-4">Recent Activity</h2>
          <ActivityFeed items={metrics.recentActivity} />
        </div>
        <div data-testid="agent-status-grid">
          <h2 data-testid="agent-status-heading" className="text-lg font-semibold mb-4">Agent Status</h2>
          <AgentStatus agents={metrics.agentStatuses} />
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
