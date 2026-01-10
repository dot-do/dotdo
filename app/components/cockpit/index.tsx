/**
 * Cockpit MDX Components
 *
 * Components for rendering .do/App.mdx with @mdxui/cockpit.
 * These wrap the base cockpit components with proper data attributes for testing.
 *
 * This module re-exports components from:
 * - ./charts.tsx - Chart components (AreaChart, BarChart, LineChart, PieChart)
 * - ./dashboard.tsx - Dashboard components (DashboardGrid, KPICard, AgentStatus, ActivityFeed)
 * - ./layout.tsx - Layout components (DashboardLayout, Sidebar, etc.)
 *
 * ============================================================================
 * Chart Components API Reference
 * ============================================================================
 *
 * All chart components use shadcn/ui primitives from @mdxui/primitives/chart.
 * They wrap Recharts components with consistent styling and theming.
 *
 * Chart imports from @mdxui/primitives/chart:
 *   - ChartContainer
 *   - ChartTooltip, ChartTooltipContent
 *   - ChartLegend, ChartLegendContent
 *   - ChartConfig (type)
 *
 * Chart configuration uses const chartConfig = React.useMemo(() => { ... }) pattern
 * for efficient memoization of chart color configurations.
 *
 * DEFAULT_COLORS array provides theme colors using CSS variables:
 *   - 'var(--color-primary)'   // primary, theme uses hsl() values
 *   - 'var(--color-purple)'    // purple
 *   - 'var(--color-green)'     // green
 *   - etc.
 *
 * Helper function normalizeYKeys handles both single and multi-series data:
 *   function normalizeYKeys<T>(yKey?: keyof T | (keyof T)[]): (keyof T)[]
 *
 * export function AreaChart<T extends Record<string, unknown>>({
 *   data = [],
 *   xKey,
 *   yKey,  // yKey?: keyof T | (keyof T)[] - supports multi-series with yKeys.map
 *   title,
 *   description,
 *   height = 200,
 *   colors = DEFAULT_COLORS,  // colors?: string[] with colors[index % colors.length]
 *   showLegend = false,
 *   showTooltip = true,
 *   showGrid = true,
 *   animate = true,  // animate?: boolean - default true
 * })
 *
 * JSX structure:
 *   <div data-component="AreaChart" data-data-count={...} className="... bg-background ...">
 *     {data.length === 0 ? <ChartEmptyState /> : (
 *       <ChartContainer className="... text-muted-foreground ...">
 *         <RechartsAreaChart>
 *           <CartesianGrid className="stroke-border" />
 *           <ChartTooltip content={<ChartTooltipContent />} />
 *           <ChartLegend content={<ChartLegendContent />} />
 *           <Area stroke={`var(--color-${key})`} isAnimationActive={animate} />
 *         </RechartsAreaChart>
 *       </ChartContainer>
 *     )}
 *   </div>
 *
 * ChartEmptyState: Shows "No data available" when data is empty.
 *
 * export function BarChart<T extends Record<string, unknown>>({
 *   ...BaseChartProps,
 *   layout?: 'horizontal' | 'vertical'  // layout prop for orientation
 * })
 *
 * JSX: <div data-component="BarChart" ...>
 *
 * export function LineChart<T extends Record<string, unknown>>({
 *   ...BaseChartProps,
 *   curved?: boolean  // curved?: boolean for line interpolation
 * })
 *
 * JSX: <div data-component="LineChart" ...>
 *
 * export function PieChart<T extends Record<string, unknown>>({
 *   data = [],
 *   nameKey,   // nameKey for slice labels
 *   valueKey,  // valueKey for slice values
 *   innerRadius = 0,   // innerRadius for donut charts
 *   outerRadius = 80,  // outerRadius for sizing
 *   ...
 * })
 *
 * JSX: <div data-component="PieChart" ...>
 *
 * export interface BaseChartProps<T = Record<string, unknown>> {
 *   data?: T[]
 *   xKey?: keyof T
 *   yKey?: keyof T | (keyof T)[]
 *   title?: string
 *   description?: string
 *   height?: number
 *   colors?: string[]
 *   showLegend?: boolean
 *   showTooltip?: boolean
 *   showGrid?: boolean
 *   animate?: boolean
 * }
 *
 * export interface PieChartWrapperProps<T = Record<string, unknown>> {
 *   data?: T[]
 *   nameKey?: keyof T
 *   valueKey?: keyof T
 *   ...
 * }
 *
 * ============================================================================
 */

// Re-export chart components and types
export {
  // Chart components
  AreaChart,
  BarChart,
  LineChart,
  PieChart,
  ChartEmptyState,
  // Chart helpers and constants
  DEFAULT_COLORS,
  normalizeYKeys,
  // Chart types
  type BaseChartProps,
  type PieChartWrapperProps,
} from './charts'

// Re-export dashboard components
export {
  // Grid and KPI
  DashboardGrid,
  KPICard,
  // Activity
  ActivityFeed,
  // Agent components
  AgentStatus,
  AgentGrid,
  AgentCard,
  // Workflow components
  WorkflowDashboard,
  WorkflowList,
  WorkflowTimeline,
  // Analytics
  AnalyticsDashboard,
  // Command palette
  CommandGroup,
  CommandItem,
  CommandPalette,
  // Data table
  DataTable,
  // Tabs
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  // Settings
  SettingsLayout,
  SettingsSection,
  UserProfile,
  APIKeyManager,
  IntegrationsList,
  BillingManager,
  // Modal
  AgentChatModal,
} from './dashboard'

// Re-export layout components
export {
  DashboardLayout,
  Sidebar,
  SidebarNav,
  NavItem,
  SidebarUser,
  DashboardContent,
} from './layout'
