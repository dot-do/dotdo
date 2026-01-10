/**
 * Cockpit MDX Components
 *
 * Components for rendering .do/App.mdx with @mdxui/cockpit.
 * These wrap the base cockpit components with proper data attributes for testing.
 */

import type { ReactNode } from 'react'
import * as React from 'react'
import {
  DashboardGrid as BaseDashboardGrid,
  KPICard as BaseKPICard,
  ActivityFeed as BaseActivityFeed,
  DataTable as BaseDataTable,
  CommandPalette as BaseCommandPalette,
  AreaChart as BaseAreaChart,
  BarChart as BaseBarChart,
  LineChart as BaseLineChart,
  UserProfile as BaseUserProfile,
  APIKeyManager as BaseAPIKeyManager,
} from '@mdxui/cockpit'
import type {
  KPICardProps as BaseKPICardProps,
  ActivityFeedProps as BaseActivityFeedProps,
  DataTableProps as BaseDataTableProps,
  AreaChartProps as BaseAreaChartProps,
  BarChartProps as BaseBarChartProps,
  LineChartProps as BaseLineChartProps,
} from '@mdxui/cockpit'
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

// ============================================================================
// Dashboard Layout Components
// ============================================================================

interface DashboardLayoutProps {
  children: ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div data-component="DashboardLayout" className="flex min-h-screen">
      {children}
    </div>
  )
}

interface SidebarProps {
  children: ReactNode
}

export function Sidebar({ children }: SidebarProps) {
  return (
    <aside
      data-component="Sidebar"
      className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col"
    >
      {children}
    </aside>
  )
}

interface SidebarNavProps {
  children: ReactNode
}

export function SidebarNav({ children }: SidebarNavProps) {
  return (
    <nav data-component="SidebarNav" className="flex-1 p-4 space-y-1">
      {children}
    </nav>
  )
}

interface NavItemProps {
  href: string
  icon?: string
  children: ReactNode
}

export function NavItem({ href, icon, children }: NavItemProps) {
  const IconComponent = icon ? iconMap[icon] : null

  return (
    <div data-component="NavItem">
      <a
        href={href}
        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-800 transition"
      >
        {IconComponent && (
          <span data-icon={icon}>
            <IconComponent className="w-5 h-5" />
          </span>
        )}
        <span>{children}</span>
      </a>
    </div>
  )
}

export function SidebarUser() {
  return (
    <div data-component="SidebarUser" className="p-4 border-t border-gray-800">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm font-bold">
          U
        </div>
        <div>
          <div className="text-sm font-medium">User</div>
          <div className="text-xs text-gray-500">user@dotdo.dev</div>
        </div>
      </div>
    </div>
  )
}

interface DashboardContentProps {
  children: ReactNode
}

export function DashboardContent({ children }: DashboardContentProps) {
  return (
    <main data-component="DashboardContent" className="flex-1 p-8 overflow-auto">
      {children}
    </main>
  )
}

// ============================================================================
// Grid and KPI Components
// ============================================================================

interface DashboardGridProps {
  cols?: number
  children: ReactNode
}

export function DashboardGrid({ cols = 3, children }: DashboardGridProps) {
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
      data-component="DashboardGrid"
      data-cols={cols.toString()}
      className={`grid ${gridCols[cols] || 'grid-cols-3'} gap-6 my-6`}
    >
      {children}
    </div>
  )
}

interface KPICardProps {
  title: string
  value: string | number
  trend?: string | number
  icon?: string
}

export function KPICard({ title, value, trend, icon }: KPICardProps) {
  const IconComponent = icon ? iconMap[icon] : null

  return (
    <div
      data-component="KPICard"
      className="p-6 bg-gray-900 rounded-lg border border-gray-800"
    >
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-gray-500">{title}</span>
        {IconComponent && (
          <span data-icon={icon}>
            <IconComponent className="w-5 h-5 text-gray-500" />
          </span>
        )}
      </div>
      <div data-kpi-value className="text-3xl font-bold">
        {value}
      </div>
      {trend !== undefined && (
        <div data-kpi-trend className="text-sm text-gray-500 mt-2">
          {typeof trend === 'number' ? (trend >= 0 ? '+' : '') + trend + '%' : trend}
        </div>
      )}
    </div>
  )
}

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

export function ActivityFeed({ items = [] }: ActivityFeedWrapperProps) {
  return (
    <div
      data-component="ActivityFeed"
      data-items-count={items.length.toString()}
      className="space-y-4"
    >
      {items.map((item) => (
        <div
          key={item.id}
          data-activity-item
          className="p-4 bg-gray-900 rounded-lg border border-gray-800"
        >
          <div className="font-medium">{item.title}</div>
          {item.description && (
            <div className="text-sm text-gray-500">{item.description}</div>
          )}
          <div className="text-xs text-gray-600 mt-2">
            {new Date(item.timestamp).toLocaleString()}
          </div>
        </div>
      ))}
      {items.length === 0 && (
        <div className="text-gray-500 text-center py-4">No recent activity</div>
      )}
    </div>
  )
}

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

export function AgentStatus({ agents = [], children }: AgentStatusProps) {
  return (
    <div
      data-component="AgentStatus"
      data-agents-count={agents.length.toString()}
      className="p-6 bg-gray-900 rounded-lg border border-gray-800"
    >
      {children && <div className="text-gray-400 mb-4">{children}</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="text-center p-3 bg-gray-800 rounded-lg"
          >
            <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm font-bold">
              {agent.name[0]}
            </div>
            <div className="font-medium text-sm">{agent.name}</div>
            <div className="text-xs text-gray-500">{agent.status}</div>
          </div>
        ))}
      </div>
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
      <div className="text-sm font-semibold text-gray-500 mb-2 px-2">
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
      className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-800 transition"
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
      className="p-4 bg-gray-900 rounded-lg border border-gray-800"
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
      {children && <div className="text-gray-400 mb-4">{children}</div>}
      {searchable && (
        <div data-search className="mb-4">
          <input
            type="search"
            placeholder="Search..."
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg"
          />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-800">
              {columns.map((col, i) => (
                <th
                  key={i}
                  data-sortable={sortable ? 'true' : undefined}
                  className="p-3 text-left border border-gray-700"
                >
                  {typeof col.header === 'function' ? col.header() : col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, rowIdx) => (
              <tr key={rowIdx} className="hover:bg-gray-800/50">
                {columns.map((col, colIdx) => (
                  <td key={colIdx} className="p-3 border border-gray-700">
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
          <div className="text-sm text-gray-500">
            Showing {data.length} results
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-1 bg-gray-800 rounded">Previous</button>
            <button className="px-3 py-1 bg-gray-800 rounded">Next</button>
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
      className="flex gap-2 border-b border-gray-800 pb-2"
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
        isActive ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-white'
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
// Agent Grid and Card
// ============================================================================

interface AgentGridProps {
  children: ReactNode
}

export function AgentGrid({ children }: AgentGridProps) {
  return (
    <div
      data-component="AgentGrid"
      className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4"
    >
      {children}
    </div>
  )
}

interface AgentCardProps {
  agent?: {
    name: string
    role?: string
    avatar?: string
  }
  status?: string
}

export function AgentCard({ agent, status }: AgentCardProps) {
  const name = agent?.name || 'Agent'

  return (
    <div
      data-component="AgentCard"
      data-status={status}
      className="text-center p-4 bg-gray-900 rounded-lg border border-gray-800"
    >
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xl font-bold">
        {agent?.avatar || name[0]}
      </div>
      <div className="font-semibold">{name}</div>
      {agent?.role && <div className="text-xs text-gray-500">{agent.role}</div>}
      {status && (
        <div className="mt-2">
          <span
            className={`inline-block px-2 py-0.5 text-xs rounded-full ${
              status === 'idle'
                ? 'bg-gray-700 text-gray-400'
                : 'bg-green-900/50 text-green-400'
            }`}
          >
            {status}
          </span>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Workflow Dashboard
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
      className="p-4 bg-gray-900 rounded-lg border border-gray-800"
    >
      <h4 className="font-semibold mb-4">Active Workflows</h4>
      <div className="space-y-2">
        {workflows.map((wf) => (
          <div
            key={wf.id}
            className="flex justify-between items-center p-2 bg-gray-800 rounded"
          >
            <span>{wf.name}</span>
            <span className="text-xs text-gray-500">{wf.status}</span>
          </div>
        ))}
        {workflows.length === 0 && (
          <div className="text-gray-500 text-center py-4">
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
      className="p-4 bg-gray-900 rounded-lg border border-gray-800"
    >
      <h4 className="font-semibold mb-4">Timeline</h4>
      <div className="space-y-2">
        {events.map((event) => (
          <div key={event.id} className="flex gap-3 items-start">
            <div className="w-2 h-2 mt-2 rounded-full bg-blue-500" />
            <div>
              <div className="text-sm">{event.type}</div>
              <div className="text-xs text-gray-500">
                {new Date(event.timestamp).toLocaleString()}
              </div>
            </div>
          </div>
        ))}
        {events.length === 0 && (
          <div className="text-gray-500 text-center py-4">No events</div>
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

interface AreaChartWrapperProps {
  data?: Array<Record<string, any>>
  title?: string
  description?: string
}

export function AreaChart({
  data = [],
  title,
  description,
}: AreaChartWrapperProps) {
  return (
    <div
      data-component="AreaChart"
      data-data-count={data.length.toString()}
      className="p-4 bg-gray-900 rounded-lg border border-gray-800"
    >
      {title && <h4 className="font-semibold">{title}</h4>}
      {description && (
        <p className="text-sm text-gray-500 mb-4">{description}</p>
      )}
      <div className="h-48 flex items-center justify-center text-gray-600">
        [Area Chart - {data.length} data points]
      </div>
    </div>
  )
}

interface BarChartWrapperProps {
  data?: Array<Record<string, any>>
  title?: string
  description?: string
}

export function BarChart({
  data = [],
  title,
  description,
}: BarChartWrapperProps) {
  return (
    <div
      data-component="BarChart"
      data-data-count={data.length.toString()}
      className="p-4 bg-gray-900 rounded-lg border border-gray-800"
    >
      {title && <h4 className="font-semibold">{title}</h4>}
      {description && (
        <p className="text-sm text-gray-500 mb-4">{description}</p>
      )}
      <div className="h-48 flex items-center justify-center text-gray-600">
        [Bar Chart - {data.length} data points]
      </div>
    </div>
  )
}

interface LineChartWrapperProps {
  data?: Array<Record<string, any>>
  title?: string
  description?: string
}

export function LineChart({
  data = [],
  title,
  description,
}: LineChartWrapperProps) {
  return (
    <div
      data-component="LineChart"
      data-data-count={data.length.toString()}
      className="p-4 bg-gray-900 rounded-lg border border-gray-800"
    >
      {title && <h4 className="font-semibold">{title}</h4>}
      {description && (
        <p className="text-sm text-gray-500 mb-4">{description}</p>
      )}
      <div className="h-48 flex items-center justify-center text-gray-600">
        [Line Chart - {data.length} data points]
      </div>
    </div>
  )
}

// ============================================================================
// Settings Layout
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
      className="p-6 bg-gray-900 rounded-lg border border-gray-800"
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
          <div className="text-sm text-gray-500">user@dotdo.dev</div>
        </div>
      </div>
    </div>
  )
}

export function APIKeyManager() {
  return (
    <div data-component="APIKeyManager" className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="text-gray-500">No API keys configured</span>
        <button className="px-4 py-2 bg-blue-600 rounded-lg hover:bg-blue-500 transition">
          Create Key
        </button>
      </div>
    </div>
  )
}

export function IntegrationsList() {
  return (
    <div data-component="IntegrationsList" className="space-y-4">
      <div className="text-gray-500 text-center py-4">
        No integrations configured
      </div>
    </div>
  )
}

function BillingManager() {
  return (
    <div data-component="BillingManager" className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <div className="font-semibold">Free Plan</div>
          <div className="text-sm text-gray-500">Upgrade for more features</div>
        </div>
        <button className="px-4 py-2 bg-gray-800 rounded-lg hover:bg-gray-700 transition">
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

function AgentChatModal({ agent, isOpen, onClose }: AgentChatModalProps) {
  if (!isOpen) return null

  return (
    <div
      data-agent-chat={agent}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 rounded-lg border border-gray-800 p-6 max-w-lg w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold">Chat with {agent}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            X
          </button>
        </div>
        <div className="text-gray-400">Starting conversation with {agent}...</div>
      </div>
    </div>
  )
}

// All components already exported via `export function` declarations above
// BillingManager and AgentChatModal are private functions exported in the block below
export { BillingManager, AgentChatModal }
