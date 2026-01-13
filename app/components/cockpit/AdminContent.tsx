/**
 * AdminContent - Admin dashboard content components
 *
 * Provides dashboard content that can be used:
 * 1. With Shell wrapper (recommended) - just the content portion
 * 2. Standalone with full layout - includes sidebar/navigation
 *
 * ## Performance Optimizations
 *
 * This component is optimized for performance:
 * - Error boundaries isolate section failures
 * - Data is memoized to prevent unnecessary re-renders
 * - Skeleton loading states are available for async loading
 * - All child components use React.memo
 *
 * ## Usage
 *
 * With Shell (recommended):
 * ```tsx
 * <Shell>
 *   <DashboardContent {...defaultAdminData} />
 * </Shell>
 * ```
 *
 * Standalone (includes layout):
 * ```tsx
 * <AdminContent {...defaultAdminData} />
 * ```
 */

import * as React from 'react'
import { useMemo, memo, Suspense } from 'react'
import {
  DashboardLayout,
  Sidebar,
  SidebarNav,
  NavItem,
  SidebarUser,
  DashboardContent as DashboardContentWrapper,
  DashboardGrid,
  KPICard,
  ActivityFeed,
  AgentStatus,
  DashboardErrorBoundary,
  KPICardSkeleton,
  ActivityFeedSkeleton,
  AgentStatusSkeleton,
} from './index'

export interface AdminContentProps {
  kpis?: Array<{
    title: string
    value: string | number
    trend?: string | number
    icon?: string
  }>
  activities?: Array<{
    id: string
    type: string
    title: string
    description?: string
    timestamp: Date | string
  }>
  agents?: Array<{
    id: string
    name: string
    status: string
    role?: string
  }>
}

export const defaultAdminData: AdminContentProps = {
  kpis: [
    { title: 'Active Agents', value: 6, trend: 0, icon: 'Users' },
    { title: 'Workflows', value: 12, trend: 8, icon: 'Activity' },
    { title: 'API Calls', value: '1.2k', trend: 15, icon: 'Code' },
    { title: 'Uptime', value: '99.9%', icon: 'Rocket' },
  ],
  activities: [
    {
      id: '1',
      type: 'workflow',
      title: 'Deployment completed',
      description: 'Production deployment successful',
      timestamp: new Date(),
    },
    {
      id: '2',
      type: 'agent',
      title: 'Ralph completed task',
      description: 'Built feature branch',
      timestamp: new Date(Date.now() - 3600000),
    },
  ],
  agents: [
    { id: 'priya', name: 'Priya', status: 'idle', role: 'Product' },
    { id: 'ralph', name: 'Ralph', status: 'working', role: 'Engineering' },
    { id: 'tom', name: 'Tom', status: 'idle', role: 'Tech Lead' },
    { id: 'mark', name: 'Mark', status: 'idle', role: 'Marketing' },
    { id: 'sally', name: 'Sally', status: 'idle', role: 'Sales' },
    { id: 'quinn', name: 'Quinn', status: 'idle', role: 'QA' },
  ],
}

/**
 * KPI Grid Section - Memoized for performance
 * Wrapped with error boundary for isolation
 */
const KPIGridSection = memo(function KPIGridSection({
  kpis,
}: {
  kpis: AdminContentProps['kpis']
}) {
  // Memoize KPI data to prevent unnecessary re-renders
  const memoizedKpis = useMemo(() => kpis || [], [kpis])

  return (
    <DashboardGrid cols={4}>
      {memoizedKpis.map((kpi) => (
        <DashboardErrorBoundary
          key={kpi.title}
          sectionTitle={kpi.title}
          compact
        >
          <KPICard {...kpi} />
        </DashboardErrorBoundary>
      ))}
    </DashboardGrid>
  )
})

/**
 * Activity Section - Memoized for performance
 * Wrapped with error boundary for isolation
 */
const ActivitySection = memo(function ActivitySection({
  activities,
}: {
  activities: AdminContentProps['activities']
}) {
  // Memoize activities data
  const memoizedActivities = useMemo(() => activities || [], [activities])

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
      <DashboardErrorBoundary sectionTitle="Recent Activity">
        <ActivityFeed items={memoizedActivities} />
      </DashboardErrorBoundary>
    </div>
  )
})

/**
 * Agent Status Section - Memoized for performance
 * Wrapped with error boundary for isolation
 */
const AgentSection = memo(function AgentSection({
  agents,
}: {
  agents: AdminContentProps['agents']
}) {
  // Memoize agents data
  const memoizedAgents = useMemo(() => agents || [], [agents])

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Agent Status</h2>
      <DashboardErrorBoundary sectionTitle="Agent Status">
        <AgentStatus agents={memoizedAgents} />
      </DashboardErrorBoundary>
    </div>
  )
})

/**
 * DashboardContent - Content-only component for use with Shell
 *
 * Renders just the dashboard content (KPIs, activity feed, agent status)
 * without the sidebar/navigation. Use this when wrapping with Shell.
 *
 * Performance optimizations:
 * - Error boundaries isolate section failures
 * - Data is memoized to prevent unnecessary re-renders
 * - Each section is wrapped in memo() for render optimization
 */
export const DashboardContent = memo(function DashboardContent({
  kpis = defaultAdminData.kpis,
  activities = defaultAdminData.activities,
  agents = defaultAdminData.agents,
}: AdminContentProps) {
  return (
    <>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      <KPIGridSection kpis={kpis} />

      <div className="grid md:grid-cols-2 gap-6 mt-6">
        <ActivitySection activities={activities} />
        <AgentSection agents={agents} />
      </div>
    </>
  )
})

/**
 * AdminContent - Full dashboard with layout (standalone use)
 *
 * Includes the complete dashboard layout with sidebar and navigation.
 * Use this when NOT wrapping with Shell.
 *
 * @deprecated Prefer using DashboardContent with Shell wrapper
 */
export const AdminContent = memo(function AdminContent({
  kpis = defaultAdminData.kpis,
  activities = defaultAdminData.activities,
  agents = defaultAdminData.agents,
}: AdminContentProps) {
  return (
    <DashboardLayout>
      <Sidebar>
        <div className="p-4 border-b border-gray-800">
          <span className="text-xl font-bold">dotdo</span>
        </div>
        <SidebarNav>
          <NavItem href="/admin" icon="Home">Dashboard</NavItem>
          <NavItem href="/admin/workflows" icon="Activity">Workflows</NavItem>
          <NavItem href="/admin/sandboxes" icon="Code">Sandboxes</NavItem>
          <NavItem href="/admin/browsers" icon="Rocket">Browsers</NavItem>
          <NavItem href="/admin/users" icon="Users">Users</NavItem>
          <NavItem href="/admin/settings" icon="Settings">Settings</NavItem>
        </SidebarNav>
        <SidebarUser />
      </Sidebar>
      <DashboardContentWrapper>
        <DashboardContent kpis={kpis} activities={activities} agents={agents} />
      </DashboardContentWrapper>
    </DashboardLayout>
  )
})

/**
 * DashboardContentWithSkeleton - Dashboard content with loading state support
 *
 * Use this when you need to show loading skeletons while data is being fetched.
 *
 * @example
 * ```tsx
 * <DashboardContentWithSkeleton
 *   isLoading={isLoading}
 *   kpis={data?.kpis}
 *   activities={data?.activities}
 *   agents={data?.agents}
 * />
 * ```
 */
export const DashboardContentWithSkeleton = memo(function DashboardContentWithSkeleton({
  isLoading = false,
  kpis,
  activities,
  agents,
}: AdminContentProps & { isLoading?: boolean }) {
  if (isLoading) {
    return (
      <>
        <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
        <DashboardGrid cols={4}>
          {[1, 2, 3, 4].map((i) => (
            <KPICardSkeleton key={i} />
          ))}
        </DashboardGrid>
        <div className="grid md:grid-cols-2 gap-6 mt-6">
          <div>
            <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
            <ActivityFeedSkeleton itemCount={3} />
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-4">Agent Status</h2>
            <AgentStatusSkeleton agentCount={6} />
          </div>
        </div>
      </>
    )
  }

  return (
    <DashboardContent
      kpis={kpis}
      activities={activities}
      agents={agents}
    />
  )
})
