/**
 * Admin Dashboard Index Route
 *
 * Renders .do/App.mdx content with @mdxui/cockpit DeveloperDashboard.
 * This provides the main dashboard page displaying dotdo metrics and overview.
 *
 * Uses the Shell component which wraps DeveloperDashboard with:
 * - branding: { name: 'dotdo', logo: <Logo /> }
 * - theme: 'stripe'
 * - customRoutes: workflows, sandboxes, browsers
 *
 * ## Customization Points
 *
 * 1. **Branding**: Edit Shell component in ~/components/ui/shell.tsx
 *    - logo: Custom React component
 *    - name: Brand name displayed in sidebar
 *
 * 2. **Theme**: Shell supports 'stripe' | 'vercel' | 'default' themes
 *
 * 3. **Custom Routes**: Add routes in Shell's customRoutes prop
 *
 * 4. **KPI Data**: Uses useDashboardMetrics hook for real-time data
 *
 * 5. **Auth**: Uses session from ~/src/admin/auth.ts
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell } from '~/components/ui/shell'
import { DeveloperDashboard } from '@mdxui/cockpit'
import { DashboardContent, defaultAdminData } from '~/components/cockpit/AdminContent'
import { getCurrentSession } from '~/src/admin/auth'
import { useDashboardMetrics, formatMetricValue } from '~/lib/hooks/use-dashboard-metrics'
import {
  DashboardGrid,
  KPICard,
  ActivityFeed,
  AgentStatus,
  AreaChart,
} from '~/components/cockpit'

export const Route = createFileRoute('/admin/')({
  component: AdminDashboard,
})

/**
 * Loading skeleton for the dashboard
 */
function DashboardSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-8 bg-gray-800 rounded w-48 mb-6" />
      <div className="grid grid-cols-4 gap-6 mb-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-32 bg-gray-800 rounded-lg" />
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="h-64 bg-gray-800 rounded-lg" />
        <div className="h-64 bg-gray-800 rounded-lg" />
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
      <div className="text-red-400 text-5xl mb-4">!</div>
      <h2 className="text-xl font-semibold text-red-400 mb-2">Error loading dashboard</h2>
      <p className="text-gray-500 mb-6">{error.message}</p>
      <button
        onClick={onRetry}
        className="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700"
      >
        Try Again
      </button>
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
  // Auth state - uses session management from admin auth module
  const session = getCurrentSession()

  return (
    <div
      data-mdx-source=".do/App.mdx"
      data-mdxui-cockpit
      data-mdx-runtime
      data-authenticated={session ? 'true' : 'false'}
      className="min-h-screen bg-gray-950 text-white"
    >
      <Shell>
        <DashboardWithMetrics />
      </Shell>
    </div>
  )
}
