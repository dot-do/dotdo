/**
 * Dashboard Components
 *
 * Grid layouts, KPI cards, activity feeds, and agent status components.
 */

import type { ReactNode } from 'react'
import * as React from 'react'

// ============================================================================
// Dashboard Grid
// ============================================================================

interface DashboardGridProps {
  cols?: number
  children: ReactNode
  testId?: string
}

export function DashboardGrid({ cols = 3, children, testId }: DashboardGridProps) {
  const gridCols: Record<number, string> = {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
    6: 'grid-cols-6',
    12: 'grid-cols-12',
  }

  return (
    <div
      data-testid={testId}
      data-component="DashboardGrid"
      data-cols={cols.toString()}
      className={`grid grid-cols-1 sm:grid-cols-2 lg:${gridCols[cols] || 'grid-cols-3'} gap-6 my-6`}
    >
      {children}
    </div>
  )
}

// ============================================================================
// KPI Card
// ============================================================================

interface KPICardProps {
  title: string
  value: string | number
  trend?: string | number
  icon?: string
  testId?: string
}

// Icon imports for KPI cards
import {
  Home,
  Rocket,
  Users,
  GitBranch,
  Activity,
  Code,
  BarChart as BarChartIcon,
  Settings,
  type LucideIcon,
} from 'lucide-react'

// Icon mapping for string to component conversion
const iconMap: Record<string, LucideIcon> = {
  Home,
  Rocket,
  Users,
  GitBranch,
  Activity,
  Code,
  BarChart: BarChartIcon,
  Settings,
}

/**
 * KPI Card component for displaying key metrics.
 * Memoized to prevent unnecessary re-renders when parent updates.
 */
export const KPICard = React.memo(function KPICard({ title, value, trend, icon, testId }: KPICardProps) {
  const IconComponent = icon ? iconMap[icon] : null

  // Determine trend direction for accessibility
  const trendDirection = typeof trend === 'number' ? (trend > 0 ? 'up' : trend < 0 ? 'down' : 'unchanged') : undefined

  return (
    <div
      data-testid={testId}
      data-component="KPICard"
      className="p-6 bg-background rounded-lg border"
      role="article"
      aria-label={`${title}: ${value}${trend !== undefined ? `, trend ${trendDirection}` : ''}`}
    >
      <div className="flex items-center justify-between mb-4">
        <span data-testid="dashboard-kpi-title" className="text-sm text-muted-foreground">{title}</span>
        {IconComponent && (
          <span data-testid="dashboard-kpi-icon" data-icon={icon} aria-hidden="true">
            <IconComponent className="w-5 h-5 text-muted-foreground" />
          </span>
        )}
      </div>
      <div data-testid="dashboard-kpi-value" data-kpi-value className="text-3xl font-bold">
        {value}
      </div>
      {trend !== undefined && (
        <div data-testid="dashboard-kpi-trend" data-kpi-trend className="text-sm text-muted-foreground mt-2">
          {typeof trend === 'number' ? (trend >= 0 ? '+' : '') + trend + '%' : trend}
        </div>
      )}
    </div>
  )
})

// ============================================================================
// Activity Feed
// ============================================================================

interface ActivityFeedWrapperProps {
  items?: Array<{
    id: string
    type: string
    title: string
    description?: string
    timestamp: Date | string
  }>
}

/**
 * Activity item component for single feed entries.
 * Memoized for performance in long lists.
 */
const ActivityItem = React.memo(function ActivityItem({
  item,
}: {
  item: ActivityFeedWrapperProps['items'][number]
}) {
  return (
    <div
      data-testid="activity-item"
      data-activity-item
      className="p-4 bg-background rounded-lg border"
      role="article"
      aria-label={`${item.title} - ${item.type}`}
    >
      <span data-testid="activity-item-type" className="inline-block px-2 py-0.5 text-xs rounded-full bg-muted text-muted-foreground mb-2">
        {item.type}
      </span>
      <div data-testid="activity-item-title" className="font-medium">{item.title}</div>
      {item.description && (
        <div data-testid="activity-item-description" className="text-sm text-muted-foreground">{item.description}</div>
      )}
      <div data-testid="activity-item-timestamp" className="text-xs text-muted-foreground mt-2">
        <time dateTime={new Date(item.timestamp).toISOString()}>
          {new Date(item.timestamp).toLocaleString()}
        </time>
      </div>
    </div>
  )
})

/**
 * Activity feed component displaying recent events.
 * Memoized to prevent unnecessary re-renders when parent updates.
 */
export const ActivityFeed = React.memo(function ActivityFeed({ items = [] }: ActivityFeedWrapperProps) {
  return (
    <div
      data-component="ActivityFeed"
      data-items-count={items.length.toString()}
      className="space-y-4"
      role="feed"
      aria-label="Recent activity feed"
    >
      {items.map((item) => (
        <ActivityItem key={item.id} item={item} />
      ))}
      {items.length === 0 && (
        <div data-testid="activity-feed-empty" className="text-muted-foreground text-center py-4" role="status">
          No recent activity
        </div>
      )}
    </div>
  )
})

// ============================================================================
// Agent Status
// ============================================================================

interface AgentStatusProps {
  agents?: Array<{
    id: string
    name: string
    status: string
    role?: string
  }>
  children?: ReactNode
}

/**
 * Single agent status item component.
 * Memoized for performance in agent grids.
 */
const AgentStatusItem = React.memo(function AgentStatusItem({
  agent,
}: {
  agent: AgentStatusProps['agents'][number]
}) {
  // Determine status style
  const statusStyles = {
    idle: 'bg-muted text-muted-foreground',
    working: 'bg-green-900/50 text-green-400',
    error: 'bg-red-900/50 text-red-400',
  }
  const statusClass = statusStyles[agent.status as keyof typeof statusStyles] || statusStyles.idle

  return (
    <div
      data-testid="agent-status-item"
      data-agent-name={agent.name}
      data-status={agent.status}
      className="text-center p-3 bg-card rounded-lg"
      role="listitem"
      aria-label={`${agent.name}: ${agent.status}${agent.role ? `, ${agent.role}` : ''}`}
    >
      <div
        data-testid="agent-status-avatar"
        className="w-10 h-10 mx-auto mb-2 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm font-bold"
        aria-hidden="true"
      >
        {agent.name[0]}
      </div>
      <div data-testid="agent-status-name" className="font-medium text-sm">{agent.name}</div>
      {agent.role && (
        <div data-testid="agent-status-role" className="text-xs text-muted-foreground">{agent.role}</div>
      )}
      <div className="mt-1">
        <span data-testid="agent-status-badge" className={`inline-block px-2 py-0.5 text-xs rounded-full ${statusClass}`}>
          {agent.status}
        </span>
      </div>
    </div>
  )
})

/**
 * Agent status grid component displaying all agents.
 * Memoized to prevent unnecessary re-renders when parent updates.
 */
export const AgentStatus = React.memo(function AgentStatus({ agents = [], children }: AgentStatusProps) {
  return (
    <div
      data-component="AgentStatus"
      data-agents-count={agents.length.toString()}
      className="p-6 bg-background rounded-lg border"
      role="region"
      aria-label="Agent status"
    >
      {children && <div className="text-muted-foreground mb-4">{children}</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4" role="list">
        {agents.map((agent) => (
          <AgentStatusItem key={agent.id} agent={agent} />
        ))}
      </div>
    </div>
  )
})

// ============================================================================
// Agent Grid and Card
// ============================================================================

interface AgentGridProps {
  children: ReactNode
}

/**
 * Agent grid container component.
 * Memoized to prevent unnecessary re-renders.
 */
export const AgentGrid = React.memo(function AgentGrid({ children }: AgentGridProps) {
  return (
    <div
      data-component="AgentGrid"
      className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4"
      role="list"
      aria-label="Agent grid"
    >
      {children}
    </div>
  )
})

interface AgentCardProps {
  agent?: {
    name: string
    role?: string
    avatar?: string
  }
  status?: string
}

/**
 * Agent card component for individual agent display.
 * Memoized to prevent unnecessary re-renders.
 */
export const AgentCard = React.memo(function AgentCard({ agent, status }: AgentCardProps) {
  const name = agent?.name || 'Agent'

  return (
    <div
      data-component="AgentCard"
      data-status={status}
      className="text-center p-4 bg-background rounded-lg border"
      role="listitem"
      aria-label={`${name}${agent?.role ? `, ${agent.role}` : ''}${status ? `, status: ${status}` : ''}`}
    >
      <div
        className="w-12 h-12 mx-auto mb-3 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xl font-bold"
        aria-hidden="true"
      >
        {agent?.avatar || name[0]}
      </div>
      <div className="font-semibold">{name}</div>
      {agent?.role && <div className="text-xs text-muted-foreground">{agent.role}</div>}
      {status && (
        <div className="mt-2">
          <span
            className={`inline-block px-2 py-0.5 text-xs rounded-full ${
              status === 'idle'
                ? 'bg-muted text-muted-foreground'
                : 'bg-green-900/50 text-green-400'
            }`}
          >
            {status}
          </span>
        </div>
      )}
    </div>
  )
})

// ============================================================================
// Workflow Dashboard Components
// ============================================================================

interface WorkflowDashboardProps {
  children: ReactNode
}

export function WorkflowDashboard({ children }: WorkflowDashboardProps) {
  return (
    <div
      data-component="WorkflowDashboard"
      className="grid md:grid-cols-2 gap-6"
    >
      {children}
    </div>
  )
}

interface WorkflowListProps {
  workflows?: Array<{
    id: string
    name: string
    status: string
  }>
}

export function WorkflowList({ workflows = [] }: WorkflowListProps) {
  return (
    <div
      data-component="WorkflowList"
      data-workflows-count={workflows.length.toString()}
      className="p-4 bg-background rounded-lg border"
    >
      <h4 className="font-semibold mb-4">Active Workflows</h4>
      <div className="space-y-2">
        {workflows.map((wf) => (
          <div
            key={wf.id}
            className="flex justify-between items-center p-2 bg-muted rounded"
          >
            <span>{wf.name}</span>
            <span className="text-xs text-muted-foreground">{wf.status}</span>
          </div>
        ))}
        {workflows.length === 0 && (
          <div className="text-muted-foreground text-center py-4">
            No active workflows
          </div>
        )}
      </div>
    </div>
  )
}

interface WorkflowTimelineProps {
  events?: Array<{
    id: string
    type: string
    timestamp: Date | string
  }>
}

export function WorkflowTimeline({ events = [] }: WorkflowTimelineProps) {
  return (
    <div
      data-component="WorkflowTimeline"
      data-events-count={events.length.toString()}
      className="p-4 bg-background rounded-lg border"
    >
      <h4 className="font-semibold mb-4">Timeline</h4>
      <div className="space-y-2">
        {events.map((event) => (
          <div key={event.id} className="flex gap-3 items-start">
            <div className="w-2 h-2 mt-2 rounded-full bg-blue-500" />
            <div>
              <div className="text-sm">{event.type}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(event.timestamp).toLocaleString()}
              </div>
            </div>
          </div>
        ))}
        {events.length === 0 && (
          <div className="text-muted-foreground text-center py-4">No events</div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Analytics Dashboard
// ============================================================================

interface AnalyticsDashboardProps {
  children: ReactNode
}

// AnalyticsDashboard uses grid layout for responsive dashboard display
export function AnalyticsDashboard({ children }: AnalyticsDashboardProps) {
  return (
    <div
      data-component="AnalyticsDashboard"
      className="grid md:grid-cols-2 lg:grid-cols-3 gap-6"
    >
      {children}
    </div>
  )
}

// ============================================================================
// Command Palette
// ============================================================================

interface CommandGroupWrapperProps {
  heading: string
  children: ReactNode
}

export function CommandGroup({ heading, children }: CommandGroupWrapperProps) {
  return (
    <div data-component="CommandGroup" className="mb-4">
      <div className="text-sm font-semibold text-muted-foreground mb-2 px-2">
        {heading}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

interface CommandItemWrapperProps {
  onSelect?: () => void
  children: ReactNode
}

// Helper to extract agent name from onSelect function
function getAgentFromOnSelect(onSelect?: () => void): string | null {
  if (!onSelect) return null
  const str = onSelect.toString()
  const match = str.match(/(\w+)`/)
  return match ? match[1] : null
}

export function CommandItem({ onSelect, children }: CommandItemWrapperProps) {
  const agent = getAgentFromOnSelect(onSelect)

  return (
    <button
      data-component="CommandItem"
      data-agent={agent || undefined}
      onClick={onSelect}
      className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted transition"
    >
      {children}
    </button>
  )
}

interface CommandPaletteWrapperProps {
  children: ReactNode
}

export function CommandPalette({ children }: CommandPaletteWrapperProps) {
  return (
    <div
      data-component="CommandPalette"
      className="p-4 bg-background rounded-lg border"
    >
      {children}
    </div>
  )
}

// ============================================================================
// Data Table
// ============================================================================

// DataTable component accepts columns and data props
interface DataTableWrapperProps<TData = any, TValue = any> {
  columns?: Array<{
    accessorKey?: string
    header: string | (() => ReactNode)
    cell?: (info: { row: { original: TData } }) => ReactNode
  }>
  data?: TData[]
  searchable?: boolean
  sortable?: boolean
  pagination?: boolean
  children?: ReactNode
}

export function DataTable<TData = any>({
  columns = [],
  data = [],
  searchable,
  sortable,
  pagination,
  children,
}: DataTableWrapperProps<TData>) {
  return (
    <div data-component="DataTable" className="space-y-4">
      {children && <div className="text-muted-foreground mb-4">{children}</div>}
      {searchable && (
        <div data-search className="mb-4">
          <input
            type="search"
            placeholder="Search..."
            className="w-full px-4 py-2 bg-muted border rounded-lg"
          />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-muted">
              {columns.map((col, i) => (
                <th
                  key={i}
                  data-sortable={sortable ? 'true' : undefined}
                  className="p-3 text-left border"
                >
                  {typeof col.header === 'function' ? col.header() : col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, rowIdx) => (
              <tr key={rowIdx} className="hover:bg-muted/50">
                {columns.map((col, colIdx) => (
                  <td key={colIdx} className="p-3 border">
                    {col.cell
                      ? col.cell({ row: { original: row } })
                      : col.accessorKey
                        ? String((row as Record<string, unknown>)[col.accessorKey] ?? '')
                        : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination && (
        <div data-pagination className="flex justify-between items-center mt-4">
          <div className="text-sm text-muted-foreground">
            Showing {data.length} results
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-1 bg-muted rounded">Previous</button>
            <button className="px-3 py-1 bg-muted rounded">Next</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Tabs Components
// ============================================================================

interface TabsProps {
  defaultValue?: string
  children: ReactNode
}

interface TabsContextValue {
  value: string
  setValue: (value: string) => void
}

const TabsContext = React.createContext<TabsContextValue | null>(null)

export function Tabs({ defaultValue = '', children }: TabsProps) {
  const [value, setValue] = React.useState(defaultValue)

  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <div data-component="Tabs" className="space-y-4">
        {children}
      </div>
    </TabsContext.Provider>
  )
}

interface TabsListProps {
  children: ReactNode
}

export function TabsList({ children }: TabsListProps) {
  return (
    <div
      data-component="TabsList"
      className="flex gap-2 border-b border pb-2"
    >
      {children}
    </div>
  )
}

interface TabsTriggerProps {
  value: string
  children: ReactNode
}

export function TabsTrigger({ value, children }: TabsTriggerProps) {
  const ctx = React.useContext(TabsContext)
  const isActive = ctx?.value === value

  return (
    <button
      data-component="TabsTrigger"
      data-state={isActive ? 'active' : 'inactive'}
      onClick={() => ctx?.setValue(value)}
      className={`px-4 py-2 rounded-lg transition ${
        isActive ? 'bg-muted text-white' : 'text-muted-foreground hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

interface TabsContentProps {
  value: string
  children: ReactNode
}

export function TabsContent({ value, children }: TabsContentProps) {
  const ctx = React.useContext(TabsContext)
  if (ctx?.value !== value) return null

  return (
    <div data-component="TabsContent" data-value={value}>
      {children}
    </div>
  )
}

// ============================================================================
// Settings Components
// ============================================================================

interface SettingsLayoutProps {
  children: ReactNode
}

export function SettingsLayout({ children }: SettingsLayoutProps) {
  return (
    <div data-component="SettingsLayout" className="space-y-6">
      {children}
    </div>
  )
}

interface SettingsSectionProps {
  title: string
  children: ReactNode
}

export function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <div
      data-component="SettingsSection"
      className="p-6 bg-background rounded-lg border"
    >
      <h4 className="font-semibold mb-4">{title}</h4>
      {children}
    </div>
  )
}

export function UserProfile() {
  return (
    <div data-component="UserProfile" className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-2xl font-bold">
          U
        </div>
        <div>
          <div className="font-semibold">User Name</div>
          <div className="text-sm text-muted-foreground">user@dotdo.dev</div>
        </div>
      </div>
    </div>
  )
}

export function APIKeyManager() {
  return (
    <div data-component="APIKeyManager" className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="text-muted-foreground">No API keys configured</span>
        <button className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition">
          Create Key
        </button>
      </div>
    </div>
  )
}

export function IntegrationsList() {
  return (
    <div data-component="IntegrationsList" className="space-y-4">
      <div className="text-muted-foreground text-center py-4">
        No integrations configured
      </div>
    </div>
  )
}

export function BillingManager() {
  return (
    <div data-component="BillingManager" className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <div className="font-semibold">Free Plan</div>
          <div className="text-sm text-muted-foreground">Upgrade for more features</div>
        </div>
        <button className="px-4 py-2 bg-muted rounded-lg hover:bg-muted/80 transition">
          Upgrade
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// Agent Chat Modal (for template literal actions)
// ============================================================================

interface AgentChatModalProps {
  agent: string
  isOpen: boolean
  onClose: () => void
}

export function AgentChatModal({ agent, isOpen, onClose }: AgentChatModalProps) {
  if (!isOpen) return null

  return (
    <div
      data-agent-chat={agent}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-lg border p-6 max-w-lg w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold">Chat with {agent}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            X
          </button>
        </div>
        <div className="text-muted-foreground">Starting conversation with {agent}...</div>
      </div>
    </div>
  )
}
