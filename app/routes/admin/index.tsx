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
 * 4. **KPI Data**: Pass custom kpis/activities/agents to DashboardContent
 *
 * 5. **Auth**: Uses session from ~/src/admin/auth.ts
 */

import { createFileRoute } from '@tanstack/react-router'
import { Shell } from '~/components/ui/shell'
import { DeveloperDashboard } from '@mdxui/cockpit'
import { DashboardContent, defaultAdminData } from '~/components/cockpit/AdminContent'
import { getCurrentSession } from '~/src/admin/auth'

export const Route = createFileRoute('/admin/')({
  component: AdminDashboard,
})

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
        <DashboardContent {...defaultAdminData} />
      </Shell>
    </div>
  )
}
