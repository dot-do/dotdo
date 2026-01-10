/**
 * AdminContent - Admin dashboard content components
 *
 * Provides dashboard content that can be used:
 * 1. With Shell wrapper (recommended) - just the content portion
 * 2. Standalone with full layout - includes sidebar/navigation
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
 * DashboardContent - Content-only component for use with Shell
 *
 * Renders just the dashboard content (KPIs, activity feed, agent status)
 * without the sidebar/navigation. Use this when wrapping with Shell.
 */
export function DashboardContent({
  kpis = defaultAdminData.kpis,
  activities = defaultAdminData.activities,
  agents = defaultAdminData.agents,
}: AdminContentProps) {
  return (
    <>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      <DashboardGrid cols={4}>
        {kpis?.map((kpi) => (
          <KPICard key={kpi.title} {...kpi} />
        ))}
      </DashboardGrid>

      <div className="grid md:grid-cols-2 gap-6 mt-6">
        <div>
          <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
          <ActivityFeed items={activities} />
        </div>
        <div>
          <h2 className="text-lg font-semibold mb-4">Agent Status</h2>
          <AgentStatus agents={agents} />
        </div>
      </div>
    </>
  )
}

/**
 * AdminContent - Full dashboard with layout (standalone use)
 *
 * Includes the complete dashboard layout with sidebar and navigation.
 * Use this when NOT wrapping with Shell.
 *
 * @deprecated Prefer using DashboardContent with Shell wrapper
 */
export function AdminContent({
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
}
