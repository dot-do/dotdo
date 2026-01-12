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

export const Route = createFileRoute('/admin/')({
  component: AdminDashboard,
})

/**
 * Loading skeleton for the dashboard
 */
function DashboardSkeleton() {
  return (
    <div className="animate-pulse">
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
    <div className="text-center py-12">
      <div className="text-destructive text-5xl mb-4">!</div>
      <h2 className="text-xl font-semibold text-destructive mb-2">Error loading dashboard</h2>
      <p className="text-muted-foreground mb-6">{error.message}</p>
      <Button type="button" variant="secondary" onClick={onRetry}>
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

  if (isLoading) {
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
    },
    {
      title: 'Workflows',
      value: metrics.totalWorkflows,
      trend: 8,
      icon: 'Activity',
    },
    {
      title: 'API Calls',
      value: formatMetricValue(metrics.apiCalls.today),
      trend: metrics.apiCalls.trend,
      icon: 'Code',
    },
    {
      title: 'Uptime',
      value: `${metrics.uptime.percentage}%`,
      icon: 'Rocket',
    },
  ]

  return (
    <>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      <DashboardGrid cols={4}>
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
        />
      </div>

      <div className="grid md:grid-cols-2 gap-6 mt-6">
        <div>
          <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
          <ActivityFeed items={metrics.recentActivity} />
        </div>
        <div>
          <h2 className="text-lg font-semibold mb-4">Agent Status</h2>
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
