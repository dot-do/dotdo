/**
 * Admin Dashboard Content
 *
 * TSX version of .do/App.mdx content.
 * Renders the admin dashboard with @mdxui/cockpit components.
 */

import * as React from 'react'
import {
  DashboardLayout,
  Sidebar,
  SidebarNav,
  NavItem,
  SidebarUser,
  DashboardContent,
  DashboardGrid,
  KPICard,
  ActivityFeed,
  AgentStatus,
  CommandPalette,
  CommandGroup,
  CommandItem,
  DataTable,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  AgentGrid,
  AgentCard,
  WorkflowDashboard,
  WorkflowList,
  WorkflowTimeline,
  AnalyticsDashboard,
  AreaChart,
  BarChart,
  LineChart,
  SettingsLayout,
  SettingsSection,
  UserProfile,
  APIKeyManager,
  IntegrationsList,
  BillingManager,
  AgentChatModal,
} from '.'

// Agent objects for template literals
const priya = { name: 'Priya', role: 'Product', avatar: 'P' }
const ralph = { name: 'Ralph', role: 'Engineering', avatar: 'R' }
const tom = { name: 'Tom', role: 'Tech Lead', avatar: 'T' }
const mark = { name: 'Mark', role: 'Marketing', avatar: 'M' }
const sally = { name: 'Sally', role: 'Sales', avatar: 'S' }
const quinn = { name: 'Quinn', role: 'QA', avatar: 'Q' }

interface AdminContentProps {
  // Stats for KPI cards
  stats: {
    activeAgents: number
    agentTrend: string | number
    runningWorkflows: number
    workflowTrend: string | number
    eventsToday: number
    eventTrend: string | number
  }
  // Activity feed items
  recentActivity: Array<{
    id: string
    type: string
    title: string
    description?: string
    timestamp: Date | string
  }>
  // Team agents
  teamAgents: Array<{
    id: string
    name: string
    status: string
    role?: string
  }>
  // Data table
  startupColumns: Array<{
    accessorKey?: string
    header: string
  }>
  startups: Array<Record<string, unknown>>
  // Workflows
  activeWorkflows: Array<{
    id: string
    name: string
    status: string
  }>
  workflowEvents: Array<{
    id: string
    type: string
    timestamp: Date | string
  }>
  // Charts
  revenueData: Array<Record<string, unknown>>
  agentUsage: Array<Record<string, unknown>>
  experimentResults: Array<Record<string, unknown>>
}

export function AdminContent({
  stats,
  recentActivity,
  teamAgents,
  startupColumns,
  startups,
  activeWorkflows,
  workflowEvents,
  revenueData,
  agentUsage,
  experimentResults,
}: AdminContentProps) {
  const [activeAgent, setActiveAgent] = React.useState<string | null>(null)

  // Template literal functions for agent commands
  const priyaFn = () => setActiveAgent('priya')
  const ralphFn = () => setActiveAgent('ralph')
  const tomFn = () => setActiveAgent('tom')

  return (
    <>
      {/* Main Dashboard Layout */}
      <DashboardLayout>
        <Sidebar>
          <SidebarNav>
            <NavItem href="/admin" icon="Home">
              Overview
            </NavItem>
            <NavItem href="/admin/startups" icon="Rocket">
              Startups
            </NavItem>
            <NavItem href="/admin/agents" icon="Users">
              Agents
            </NavItem>
            <NavItem href="/admin/workflows" icon="GitBranch">
              Workflows
            </NavItem>
            <NavItem href="/admin/events" icon="Activity">
              Events
            </NavItem>
            <NavItem href="/admin/functions" icon="Code">
              Functions
            </NavItem>
            <NavItem href="/admin/analytics" icon="BarChart">
              Analytics
            </NavItem>
            <NavItem href="/admin/settings" icon="Settings">
              Settings
            </NavItem>
          </SidebarNav>
          <SidebarUser />
        </Sidebar>

        <DashboardContent>
          {/* Main Heading - from MDX: # dotdo Dashboard */}
          <h1 className="text-4xl font-bold mb-8">dotdo Dashboard</h1>

          {/* Welcome Section */}
          <h2 className="text-2xl font-semibold mb-2">Welcome to dotdo</h2>
          <p className="text-gray-400 mb-6">
            Your autonomous business control center.
          </p>

          {/* KPI Cards Grid */}
          <DashboardGrid cols={3}>
            <KPICard
              title="Active Agents"
              value={stats.activeAgents}
              trend={stats.agentTrend}
              icon="Users"
            />
            <KPICard
              title="Workflows Running"
              value={stats.runningWorkflows}
              trend={stats.workflowTrend}
              icon="GitBranch"
            />
            <KPICard
              title="Events Today"
              value={stats.eventsToday}
              trend={stats.eventTrend}
              icon="Activity"
            />
          </DashboardGrid>

          {/* Recent Activity */}
          <h3 className="text-xl font-semibold mt-8 mb-4">Recent Activity</h3>
          <ActivityFeed items={recentActivity} />

          {/* Your Team */}
          <h3 className="text-xl font-semibold mt-8 mb-4">Your Team</h3>
          <AgentStatus agents={teamAgents}>
            Monitor your AI agents in real-time. See what Priya, Ralph, Tom, and
            the team are working on.
          </AgentStatus>

          {/* Quick Actions */}
          <h3 className="text-xl font-semibold mt-8 mb-4">Quick Actions</h3>
          <CommandPalette>
            <CommandGroup heading="Agents">
              <CommandItem onSelect={priyaFn}>
                Ask Priya for product direction
              </CommandItem>
              <CommandItem onSelect={ralphFn}>
                Have Ralph start building
              </CommandItem>
              <CommandItem onSelect={tomFn}>
                Request code review from Tom
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading="Workflows">
              <CommandItem>Create new workflow</CommandItem>
              <CommandItem>View running workflows</CommandItem>
              <CommandItem>Check event log</CommandItem>
            </CommandGroup>
          </CommandPalette>

          <hr className="my-8 border-gray-800" />

          {/* Startup Management */}
          <h2 className="text-2xl font-semibold mb-4">Startup Management</h2>
          <DataTable
            columns={startupColumns}
            data={startups}
            searchable
            sortable
            pagination
          >
            Manage all your startups from one place. Track hypotheses,
            experiments, and metrics.
          </DataTable>

          <hr className="my-8 border-gray-800" />

          {/* Agent Configuration */}
          <h2 className="text-2xl font-semibold mb-4">Agent Configuration</h2>
          <Tabs defaultValue="active">
            <TabsList>
              <TabsTrigger value="active">Active Agents</TabsTrigger>
              <TabsTrigger value="available">Available</TabsTrigger>
              <TabsTrigger value="custom">Custom</TabsTrigger>
            </TabsList>
            <TabsContent value="active">
              <AgentGrid>
                <AgentCard agent={priya} status="working" />
                <AgentCard agent={ralph} status="idle" />
                <AgentCard agent={tom} status="reviewing" />
                <AgentCard agent={mark} status="idle" />
                <AgentCard agent={sally} status="outreach" />
                <AgentCard agent={quinn} status="testing" />
              </AgentGrid>
            </TabsContent>
            <TabsContent value="available">
              <div className="p-4 text-gray-400">
                Additional agents available from agents.do
              </div>
            </TabsContent>
            <TabsContent value="custom">
              <div className="p-4 text-gray-400">
                Create custom agents for your specific domain
              </div>
            </TabsContent>
          </Tabs>

          <hr className="my-8 border-gray-800" />

          {/* Workflow Monitor */}
          <h2 className="text-2xl font-semibold mb-4">Workflow Monitor</h2>
          <WorkflowDashboard>
            <WorkflowList workflows={activeWorkflows} />
            <WorkflowTimeline events={workflowEvents} />
          </WorkflowDashboard>

          <hr className="my-8 border-gray-800" />

          {/* Analytics */}
          <h2 className="text-2xl font-semibold mb-4">Analytics</h2>
          <AnalyticsDashboard>
            <AreaChart
              data={revenueData}
              title="Revenue"
              description="Monthly recurring revenue over time"
            />
            <BarChart
              data={agentUsage}
              title="Agent Usage"
              description="Tasks completed by each agent"
            />
            <LineChart
              data={experimentResults}
              title="Experiment Results"
              description="Conversion rates across variants"
            />
          </AnalyticsDashboard>

          <hr className="my-8 border-gray-800" />

          {/* Settings */}
          <h2 className="text-2xl font-semibold mb-4">Settings</h2>
          <SettingsLayout>
            <SettingsSection title="Profile">
              <UserProfile />
            </SettingsSection>
            <SettingsSection title="API Keys">
              <APIKeyManager />
            </SettingsSection>
            <SettingsSection title="Integrations">
              <IntegrationsList />
            </SettingsSection>
            <SettingsSection title="Billing">
              <BillingManager />
            </SettingsSection>
          </SettingsLayout>
        </DashboardContent>
      </DashboardLayout>

      {/* Agent Chat Modal */}
      <AgentChatModal
        agent={activeAgent || ''}
        isOpen={activeAgent !== null}
        onClose={() => setActiveAgent(null)}
      />
    </>
  )
}

// Default data for the dashboard
export const defaultAdminData: AdminContentProps = {
  stats: {
    activeAgents: 7,
    agentTrend: '+12%',
    runningWorkflows: 12,
    workflowTrend: '+3',
    eventsToday: 1248,
    eventTrend: '+15%',
  },
  recentActivity: [
    {
      id: '1',
      type: 'agent',
      title: 'Priya completed product spec',
      description: 'MVP specification for new feature',
      timestamp: new Date(),
    },
    {
      id: '2',
      type: 'workflow',
      title: 'Deployment workflow completed',
      description: 'Production deployment successful',
      timestamp: new Date(Date.now() - 3600000),
    },
    {
      id: '3',
      type: 'event',
      title: 'New customer signup',
      description: 'Customer.signup event processed',
      timestamp: new Date(Date.now() - 7200000),
    },
  ],
  teamAgents: [
    { id: '1', name: 'Priya', status: 'working', role: 'Product' },
    { id: '2', name: 'Ralph', status: 'idle', role: 'Engineering' },
    { id: '3', name: 'Tom', status: 'reviewing', role: 'Tech Lead' },
    { id: '4', name: 'Mark', status: 'writing', role: 'Marketing' },
    { id: '5', name: 'Sally', status: 'outreach', role: 'Sales' },
    { id: '6', name: 'Quinn', status: 'testing', role: 'QA' },
  ],
  startupColumns: [
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'status', header: 'Status' },
    { accessorKey: 'hypothesis', header: 'Hypothesis' },
    { accessorKey: 'experiments', header: 'Experiments' },
    { accessorKey: 'metrics', header: 'Metrics' },
  ],
  startups: [
    {
      name: 'MyStartup',
      status: 'Active',
      hypothesis: 'PMF for B2B SaaS',
      experiments: 3,
      metrics: 'HUNCH: 72%',
    },
    {
      name: 'AcmeInc',
      status: 'Testing',
      hypothesis: 'Marketplace model',
      experiments: 5,
      metrics: 'HUNCH: 58%',
    },
  ],
  activeWorkflows: [
    { id: '1', name: 'Customer Onboarding', status: 'running' },
    { id: '2', name: 'Daily Standup', status: 'scheduled' },
    { id: '3', name: 'Code Review', status: 'running' },
  ],
  workflowEvents: [
    { id: '1', type: 'workflow.started', timestamp: new Date() },
    {
      id: '2',
      type: 'task.completed',
      timestamp: new Date(Date.now() - 1800000),
    },
    { id: '3', type: 'agent.assigned', timestamp: new Date(Date.now() - 3600000) },
  ],
  revenueData: [
    { month: 'Jan', revenue: 4000 },
    { month: 'Feb', revenue: 5200 },
    { month: 'Mar', revenue: 6100 },
    { month: 'Apr', revenue: 7800 },
    { month: 'May', revenue: 9200 },
    { month: 'Jun', revenue: 11500 },
  ],
  agentUsage: [
    { agent: 'Priya', tasks: 45 },
    { agent: 'Ralph', tasks: 128 },
    { agent: 'Tom', tasks: 67 },
    { agent: 'Mark', tasks: 34 },
    { agent: 'Sally', tasks: 89 },
    { agent: 'Quinn', tasks: 56 },
  ],
  experimentResults: [
    { variant: 'Control', conversion: 3.2 },
    { variant: 'A', conversion: 4.1 },
    { variant: 'B', conversion: 3.8 },
    { variant: 'C', conversion: 5.2 },
  ],
}
