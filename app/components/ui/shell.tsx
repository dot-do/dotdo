/**
 * Shell Component
 *
 * Wrapper around @mdxui/cockpit's DeveloperDashboard for admin pages.
 * Provides consistent shell UI across admin routes with full dashboard features.
 */

import { DeveloperDashboard } from '@mdxui/cockpit'
import type { ReactNode } from 'react'

// ============================================================================
// Logo Component
// ============================================================================

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
        <span className="text-white font-bold text-sm">.do</span>
      </div>
    </div>
  )
}

// ============================================================================
// Lazy Route Components (imported inline to avoid circular deps)
// ============================================================================

function WorkflowsPage() {
  return <div data-route="workflows" />
}

function SandboxesPage() {
  return <div data-route="sandboxes" />
}

function BrowsersPage() {
  return <div data-route="browsers" />
}

// ============================================================================
// Shell Props
// ============================================================================

interface ShellProps {
  children: ReactNode
}

// ============================================================================
// Shell Component
// ============================================================================

export function Shell({ children }: ShellProps) {
  return (
    <DeveloperDashboard
      branding={{ name: 'dotdo', logo: <Logo /> }}
      theme="stripe"
      customRoutes={[
        { path: '/workflows', element: <WorkflowsPage /> },
        { path: '/sandboxes', element: <SandboxesPage /> },
        { path: '/browsers', element: <BrowsersPage /> },
      ]}
    >
      {children}
    </DeveloperDashboard>
  )
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
