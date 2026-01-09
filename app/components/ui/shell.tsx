/**
 * Shell Component
 *
 * Wrapper around @mdxui/cockpit's DashboardLayout for admin pages.
 * Provides consistent shell UI across admin routes.
 */

import { DashboardLayout } from '@mdxui/cockpit'
import type { ReactNode } from 'react'

interface ShellProps {
  children: ReactNode
}

export function Shell({ children }: ShellProps) {
  return <DashboardLayout>{children}</DashboardLayout>
}

// Re-export components from @mdxui/cockpit
export {
  DashboardGrid as DashboardView,
  DataTable,
  APIKeyManager,
  SettingsPage,
  UserProfile,
  KPICard,
  ActivityFeed,
} from '@mdxui/cockpit'
