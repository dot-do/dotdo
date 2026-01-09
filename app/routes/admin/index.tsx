/**
 * Admin Dashboard Index Route
 *
 * Main dashboard page displaying metrics and overview.
 * Uses @mdxui/cockpit Shell and DashboardView components.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell, DashboardView, DashboardGrid, KPICard } from '@mdxui/cockpit'

export const Route = createFileRoute('/admin/')({
  component: AdminDashboard,
})

function AdminDashboard() {
  return (
    <Shell>
      <DashboardView
        title="Dashboard"
        period="week"
        metrics={[
          { label: 'Durable Objects', value: 1234 },
          { label: 'Requests', value: '12,345' },
          { label: 'Active Workflows', value: 56 },
          { label: 'Users', value: 789 },
        ]}
      />
    </Shell>
  )
}
