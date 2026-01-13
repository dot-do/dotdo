/**
 * App MDX Content Renderer
 *
 * Renders App.mdx content for the consumer dashboard.
 * This can be used as an alternative to the built-in dashboard components.
 *
 * @example Using in a route
 * ```tsx
 * import { AppMdxContent } from '~/lib/mdx/app-content'
 *
 * function Dashboard() {
 *   return <AppMdxContent />
 * }
 * ```
 */

'use client'

import { getAppPage } from '../source'
import browserCollections from 'fumadocs-mdx:collections/browser'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import React, { Suspense } from 'react'

// Import dashboard MDX components (these should be defined elsewhere)
// For now, we'll use placeholder components
const dashboardComponents = {
  // Layout
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <div className="dashboard-layout">{children}</div>
  ),
  Sidebar: ({ children }: { children: React.ReactNode }) => (
    <aside className="dashboard-sidebar">{children}</aside>
  ),
  SidebarNav: ({ children }: { children: React.ReactNode }) => (
    <nav className="sidebar-nav">{children}</nav>
  ),
  NavItem: ({ href, icon, children }: { href: string; icon: string; children: React.ReactNode }) => (
    <a href={href} className="nav-item flex items-center gap-2 p-2 hover:bg-muted rounded">
      <span className="icon">{icon}</span>
      <span>{children}</span>
    </a>
  ),
  SidebarUser: () => <div className="sidebar-user" />,
  DashboardContent: ({ children }: { children: React.ReactNode }) => (
    <main className="dashboard-content flex-1 p-6">{children}</main>
  ),
  DashboardGrid: ({ cols = 3, children }: { cols?: number; children: React.ReactNode }) => (
    <div className={`grid grid-cols-1 md:grid-cols-${cols} gap-4`}>{children}</div>
  ),
  KPICard: ({ title, value, trend, icon }: { title: string; value: number; trend?: number; icon: string }) => (
    <div className="kpi-card p-4 bg-card rounded-lg border">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-sm">{title}</span>
        <span className="icon">{icon}</span>
      </div>
      <div className="mt-2">
        <span className="text-2xl font-bold">{value}</span>
        {trend !== undefined && (
          <span className={`ml-2 text-sm ${trend > 0 ? 'text-green-500' : 'text-red-500'}`}>
            {trend > 0 ? '+' : ''}{trend}%
          </span>
        )}
      </div>
    </div>
  ),
  ActivityFeed: ({ items }: { items?: unknown[] }) => (
    <div className="activity-feed space-y-2">
      {/* Activity items would be rendered here */}
      <p className="text-muted-foreground text-sm">No recent activity</p>
    </div>
  ),
  AgentStatus: ({ agents, children }: { agents?: unknown[]; children?: React.ReactNode }) => (
    <div className="agent-status">
      {children}
      {/* Agent status would be rendered here */}
    </div>
  ),
  CommandPalette: ({ children }: { children: React.ReactNode }) => (
    <div className="command-palette">{children}</div>
  ),
  CommandGroup: ({ heading, children }: { heading: string; children: React.ReactNode }) => (
    <div className="command-group">
      <h4 className="text-sm font-medium text-muted-foreground mb-2">{heading}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  ),
  CommandItem: ({ onSelect, children }: { onSelect?: () => void; children: React.ReactNode }) => (
    <button onClick={onSelect} className="command-item w-full text-left p-2 hover:bg-muted rounded text-sm">
      {children}
    </button>
  ),
  // Data display
  DataTable: ({ columns, data, searchable, sortable, pagination, children }: {
    columns?: unknown[];
    data?: unknown[];
    searchable?: boolean;
    sortable?: boolean;
    pagination?: boolean;
    children?: React.ReactNode
  }) => (
    <div className="data-table">
      {children}
      {/* Table would be rendered here */}
    </div>
  ),
  // Tabs
  Tabs: ({ defaultValue, children }: { defaultValue?: string; children: React.ReactNode }) => (
    <div className="tabs">{children}</div>
  ),
  TabsList: ({ children }: { children: React.ReactNode }) => (
    <div className="tabs-list flex gap-2 border-b mb-4">{children}</div>
  ),
  TabsTrigger: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <button className="tabs-trigger px-3 py-2 text-sm hover:text-foreground">{children}</button>
  ),
  TabsContent: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <div className="tabs-content">{children}</div>
  ),
  // Cards
  AgentGrid: ({ children }: { children: React.ReactNode }) => (
    <div className="agent-grid grid grid-cols-2 md:grid-cols-3 gap-4">{children}</div>
  ),
  AgentCard: ({ agent, status }: { agent: unknown; status: string }) => (
    <div className="agent-card p-4 bg-card rounded-lg border">
      <span className="status text-xs">{status}</span>
    </div>
  ),
  // Workflow
  WorkflowDashboard: ({ children }: { children: React.ReactNode }) => (
    <div className="workflow-dashboard">{children}</div>
  ),
  WorkflowList: ({ workflows }: { workflows?: unknown[] }) => (
    <div className="workflow-list">No workflows</div>
  ),
  WorkflowTimeline: ({ events }: { events?: unknown[] }) => (
    <div className="workflow-timeline">No events</div>
  ),
  // Analytics
  AnalyticsDashboard: ({ children }: { children: React.ReactNode }) => (
    <div className="analytics-dashboard grid gap-4">{children}</div>
  ),
  AreaChart: ({ data, title, description }: { data?: unknown[]; title: string; description: string }) => (
    <div className="area-chart p-4 bg-card rounded-lg border">
      <h3 className="font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  ),
  BarChart: ({ data, title, description }: { data?: unknown[]; title: string; description: string }) => (
    <div className="bar-chart p-4 bg-card rounded-lg border">
      <h3 className="font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  ),
  LineChart: ({ data, title, description }: { data?: unknown[]; title: string; description: string }) => (
    <div className="line-chart p-4 bg-card rounded-lg border">
      <h3 className="font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  ),
  // Settings
  SettingsLayout: ({ children }: { children: React.ReactNode }) => (
    <div className="settings-layout space-y-6">{children}</div>
  ),
  SettingsSection: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="settings-section">
      <h2 className="text-lg font-medium mb-4">{title}</h2>
      {children}
    </section>
  ),
  UserProfile: () => <div className="user-profile">User profile settings</div>,
  APIKeyManager: () => <div className="api-key-manager">API key management</div>,
  IntegrationsList: () => <div className="integrations-list">Integrations</div>,
  BillingManager: () => <div className="billing-manager">Billing settings</div>,
}

// Create client loader for App MDX if available
const appClientLoader = browserCollections.appContent?.createClientLoader({
  component(
    { toc, frontmatter, default: MDX },
    props: { className?: string },
  ) {
    return (
      <article className={props.className}>
        <MDX
          components={{
            ...defaultMdxComponents,
            ...dashboardComponents,
          }}
        />
      </article>
    )
  },
})

/**
 * Props for AppMdxContent component
 */
export interface AppMdxContentProps {
  /** Additional CSS classes */
  className?: string
  /** Fallback content when App.mdx is not available */
  fallback?: React.ReactNode
}

/**
 * Get App.mdx page data server-side
 */
export async function loadAppMdxData() {
  try {
    const page = getAppPage()
    if (page) {
      return {
        path: page.path,
        frontmatter: page.data,
        hasMdx: true,
      }
    }
  } catch {
    // App.mdx not found
  }
  return {
    path: '',
    frontmatter: {
      title: 'dotdo Dashboard',
      description: 'Your autonomous business control center',
    },
    hasMdx: false,
  }
}

/**
 * Render App.mdx content with dashboard components
 */
export function AppMdxContent({ className, fallback }: AppMdxContentProps) {
  const [data, setData] = React.useState<{ path: string; hasMdx: boolean } | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    loadAppMdxData().then((result) => {
      setData(result)
      setLoading(false)
    })
  }, [])

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-muted rounded w-1/3 mb-4" />
        <div className="h-4 bg-muted rounded w-2/3 mb-2" />
        <div className="h-4 bg-muted rounded w-1/2" />
      </div>
    )
  }

  if (!data?.hasMdx || !appClientLoader) {
    return fallback ? <>{fallback}</> : (
      <div className="text-center py-12">
        <h2 className="text-xl font-medium">Dashboard</h2>
        <p className="text-muted-foreground mt-2">
          Create an App.mdx file to customize your dashboard.
        </p>
      </div>
    )
  }

  return (
    <Suspense fallback={<div className="animate-pulse">Loading...</div>}>
      {appClientLoader.useContent(data.path, {
        className: className || 'app-mdx-content',
      })}
    </Suspense>
  )
}

export default AppMdxContent
