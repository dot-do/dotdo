/**
 * Admin Dashboard Index Route
 *
 * Renders .do/App.mdx content with @mdxui/cockpit components.
 * This provides the main dashboard page displaying dotdo metrics and overview.
 */

import { createFileRoute } from '@tanstack/react-router'
import { AdminContent, defaultAdminData } from '~/components/cockpit/AdminContent'

export const Route = createFileRoute('/admin/')({
  component: AdminDashboard,
})

function AdminDashboard() {
  return (
    <div
      data-mdx-source=".do/App.mdx"
      data-mdxui-cockpit
      data-mdx-runtime
      className="min-h-screen bg-gray-950 text-white"
    >
      <AdminContent {...defaultAdminData} />
    </div>
  )
}
