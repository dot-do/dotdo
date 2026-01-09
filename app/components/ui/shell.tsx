/**
 * Shell Component
 *
 * Wrapper around @mdxui/cockpit's DashboardLayout for admin pages.
 * Provides consistent shell UI across admin routes.
 */

import { DashboardLayout as BaseDashboardLayout } from '@mdxui/cockpit'
import type { ReactNode } from 'react'

interface ShellProps {
  children: ReactNode
}

function DashboardLayout({ children }: ShellProps) {
  return <BaseDashboardLayout />
}

export function Shell({ children }: ShellProps) {
  return <DashboardLayout>{children}</DashboardLayout>
}

// Re-export components from @mdxui/cockpit
export {
  ActivityFeed,
  APIKeyManager,
  DashboardGrid as DashboardView,
  DataTable,
  KPICard,
  SettingsPage,
  UserProfile,
} from '@mdxui/cockpit'
