/**
 * DeveloperDashboard Tests (TDD RED Phase)
 *
 * These tests verify the DeveloperDashboard integration from @mdxui/cockpit.
 * Tests are expected to FAIL until implementation is complete.
 *
 * Test cases:
 * - DeveloperDashboard renders with branding
 * - Sidebar navigation works
 * - Custom routes integrate
 * - KPI cards render with data
 * - Activity feed updates
 * - Agent status displays (Priya, Ralph, Tom, Mark, Sally, Quinn)
 *
 * NOTE: These tests use file-based verification similar to other app/tests/*.test.ts
 * files because @mdxui/cockpit imports uncompiled .tsx files that cannot be resolved
 * in the test environment. The component tests verify the integration is properly
 * configured.
 *
 * @see app/components/cockpit/index.tsx - Local cockpit wrappers
 * @see app/components/cockpit/AdminContent.tsx - Admin dashboard content
 */

import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'

// ============================================================================
// Test Constants - Named Agents from dotdo
// ============================================================================

const AGENTS = ['Priya', 'Ralph', 'Tom', 'Mark', 'Sally', 'Quinn'] as const

const AGENT_ROLES = {
  Priya: 'Product',
  Ralph: 'Engineering',
  Tom: 'Tech Lead',
  Mark: 'Marketing',
  Sally: 'Sales',
  Quinn: 'QA',
} as const

// ============================================================================
// DeveloperDashboard Integration File Tests
// ============================================================================

describe('DeveloperDashboard Integration', () => {
  describe('File Structure', () => {
    it('should have cockpit components at app/components/cockpit/index.tsx', () => {
      expect(existsSync('app/components/cockpit/index.tsx')).toBe(true)
    })

    it('should have AdminContent at app/components/cockpit/AdminContent.tsx', () => {
      expect(existsSync('app/components/cockpit/AdminContent.tsx')).toBe(true)
    })

    it('should have admin route at app/routes/admin/index.tsx', () => {
      expect(existsSync('app/routes/admin/index.tsx')).toBe(true)
    })
  })

  describe('renders with branding', () => {
    it('should import DeveloperDashboard from @mdxui/cockpit', async () => {
      const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
      expect(content).toContain('@mdxui/cockpit')
    })

    it('should render brand name "dotdo" in sidebar', async () => {
      const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
      expect(content).toContain('dotdo')
    })

    it('should have branding component in sidebar header', async () => {
      const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
      expect(content).toMatch(/Sidebar/)
      expect(content).toMatch(/font-bold|brand/i)
    })

    it('should export DashboardLayout component', async () => {
      const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
      expect(content).toContain('export function DashboardLayout')
    })
  })
})

// ============================================================================
// Sidebar Navigation Tests
// ============================================================================

describe('Sidebar Navigation', () => {
  it('should have Sidebar component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function Sidebar')
  })

  it('should have SidebarNav component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function SidebarNav')
  })

  it('should have NavItem component with href prop', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function NavItem')
    expect(content).toMatch(/href.*string/)
  })

  it('should render navigation links in AdminContent', async () => {
    const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
    expect(content).toContain('NavItem')
    expect(content).toContain('href=')
  })

  it('should have Dashboard link', async () => {
    const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
    expect(content).toContain('/admin')
    expect(content).toMatch(/Dashboard/i)
  })

  it('should have Workflows link', async () => {
    const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
    expect(content).toContain('/admin/workflows')
    expect(content).toMatch(/Workflows/i)
  })

  it('should have Sandboxes link', async () => {
    const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
    expect(content).toContain('/admin/sandboxes')
    expect(content).toMatch(/Sandboxes/i)
  })

  it('should have Users link', async () => {
    const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
    expect(content).toContain('/admin/users')
    expect(content).toMatch(/Users/i)
  })

  it('should have Settings link', async () => {
    const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
    expect(content).toContain('/admin/settings')
    expect(content).toMatch(/Settings/i)
  })

  it('should have SidebarUser component for user profile', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function SidebarUser')
  })

  it('should use SidebarUser in AdminContent', async () => {
    const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
    expect(content).toContain('SidebarUser')
  })
})

// ============================================================================
// Custom Routes Integration Tests
// ============================================================================

describe('Custom Routes Integration', () => {
  it('should have admin index route', async () => {
    expect(existsSync('app/routes/admin/index.tsx')).toBe(true)
    const content = await readFile('app/routes/admin/index.tsx', 'utf-8')
    expect(content).toContain('@mdxui/cockpit')
  })

  it('should have admin login route', async () => {
    expect(existsSync('app/routes/admin/login.tsx')).toBe(true)
    const content = await readFile('app/routes/admin/login.tsx', 'utf-8')
    expect(content).toContain('@mdxui/cockpit')
  })

  it('should import Shell or DeveloperDashboard from @mdxui/cockpit', async () => {
    const content = await readFile('app/routes/admin/index.tsx', 'utf-8')
    expect(content).toMatch(/Shell|DeveloperDashboard|DashboardLayout/)
  })

  it('should export Route constant for TanStack Router', async () => {
    const content = await readFile('app/routes/admin/index.tsx', 'utf-8')
    expect(content).toContain('export const Route')
  })

  it('should use createFileRoute', async () => {
    const content = await readFile('app/routes/admin/index.tsx', 'utf-8')
    expect(content).toContain('createFileRoute')
  })
})

// ============================================================================
// KPI Cards Tests
// ============================================================================

describe('KPI Cards', () => {
  it('should have KPICard component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function KPICard')
  })

  it('should have DashboardGrid component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function DashboardGrid')
  })

  it('should accept title prop in KPICard', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/KPICard.*title.*string|title.*KPICard/)
  })

  it('should accept value prop in KPICard', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/KPICard.*value|value.*KPICard/)
  })

  it('should accept trend prop in KPICard', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/trend/)
  })

  it('should render KPI cards with default data in AdminContent', async () => {
    const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
    expect(content).toContain('KPICard')
  })

  it('should have default KPI data with Active Agents', async () => {
    const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
    expect(content).toContain('Active Agents')
  })

  it('should have default KPI data with Workflows', async () => {
    const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
    expect(content).toContain('Workflows')
  })

  it('should have default KPI data with API Calls', async () => {
    const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
    expect(content).toContain('API Calls')
  })

  it('should have default KPI data with Uptime', async () => {
    const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
    expect(content).toContain('Uptime')
  })

  it('should display data-kpi-value attribute', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('data-kpi-value')
  })

  it('should display data-kpi-trend attribute for trend indicator', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('data-kpi-trend')
  })
})

// ============================================================================
// Activity Feed Tests
// ============================================================================

describe('Activity Feed', () => {
  it('should have ActivityFeed component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function ActivityFeed')
  })

  it('should accept items prop as array', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/ActivityFeed.*items.*Array|items.*ActivityFeed/)
  })

  it('should render activity items with title', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/item\.title/)
  })

  it('should render activity items with description', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/item\.description/)
  })

  it('should render activity items with timestamp', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/item\.timestamp|timestamp/)
  })

  it('should use ActivityFeed in AdminContent', async () => {
    const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
    expect(content).toContain('ActivityFeed')
  })

  it('should have default activity data', async () => {
    const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
    expect(content).toContain('activities')
  })

  it('should show empty state when no activities', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/No recent activity|empty|length.*0/)
  })

  it('should have data-activity-item attribute', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('data-activity-item')
  })

  it('should have data-items-count attribute', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('data-items-count')
  })
})

// ============================================================================
// Agent Status Display Tests
// ============================================================================

describe('Agent Status Display', () => {
  it('should have AgentStatus component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function AgentStatus')
  })

  it('should accept agents prop as array', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/AgentStatus.*agents.*Array|agents.*AgentStatus/)
  })

  it('should use AgentStatus in AdminContent', async () => {
    const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
    expect(content).toContain('AgentStatus')
  })

  it('should have data-agents-count attribute', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('data-agents-count')
  })

  describe('Named Agents', () => {
    it('should display Priya agent', async () => {
      const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
      expect(content).toContain('Priya')
    })

    it('should display Ralph agent', async () => {
      const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
      expect(content).toContain('Ralph')
    })

    it('should display Tom agent', async () => {
      const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
      expect(content).toContain('Tom')
    })

    it('should display Mark agent', async () => {
      const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
      expect(content).toContain('Mark')
    })

    it('should display Sally agent', async () => {
      const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
      expect(content).toContain('Sally')
    })

    it('should display Quinn agent', async () => {
      const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
      expect(content).toContain('Quinn')
    })

    it('should have 6 agents defined', async () => {
      const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
      // All 6 agents should be present
      for (const agent of AGENTS) {
        expect(content).toContain(agent)
      }
    })
  })

  describe('Agent Roles', () => {
    it('should have Priya as Product agent', async () => {
      const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
      expect(content).toContain('Product')
    })

    it('should have Ralph as Engineering agent', async () => {
      const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
      expect(content).toContain('Engineering')
    })

    it('should have Tom as Tech Lead agent', async () => {
      const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
      expect(content).toContain('Tech Lead')
    })

    it('should have Mark as Marketing agent', async () => {
      const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
      expect(content).toContain('Marketing')
    })

    it('should have Sally as Sales agent', async () => {
      const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
      expect(content).toContain('Sales')
    })

    it('should have Quinn as QA agent', async () => {
      const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
      expect(content).toContain('QA')
    })
  })

  describe('Agent Status States', () => {
    it('should support idle status', async () => {
      const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
      expect(content).toContain('idle')
    })

    it('should support working status', async () => {
      const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
      expect(content).toContain('working')
    })

    it('should display agent status in UI', async () => {
      const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
      expect(content).toMatch(/agent\.status/)
    })

    it('should display agent name in UI', async () => {
      const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
      expect(content).toMatch(/agent\.name/)
    })
  })
})

// ============================================================================
// DataTable Component Tests
// ============================================================================

describe('DataTable Component', () => {
  it('should have DataTable component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function DataTable')
  })

  it('should accept columns prop', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/DataTable.*columns|columns.*DataTable/)
  })

  it('should accept data prop', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/DataTable.*data|data.*DataTable/)
  })

  it('should support searchable prop', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('searchable')
  })

  it('should support pagination prop', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('pagination')
  })

  it('should render table headers', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/<th|thead/)
  })

  it('should render table body', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/<td|tbody/)
  })
})

// ============================================================================
// Chart Components Tests
// ============================================================================

describe('Chart Components', () => {
  it('should have AreaChart component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function AreaChart')
  })

  it('should have BarChart component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function BarChart')
  })

  it('should have LineChart component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function LineChart')
  })

  it('should accept data prop in charts', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    // Charts should accept data array
    expect(content).toMatch(/Chart.*data.*Array|data.*Chart/)
  })

  it('should have data-data-count attribute', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('data-data-count')
  })
})

// ============================================================================
// Command Palette Tests
// ============================================================================

describe('Command Palette', () => {
  it('should have CommandPalette component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function CommandPalette')
  })

  it('should have CommandGroup component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function CommandGroup')
  })

  it('should have CommandItem component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function CommandItem')
  })

  it('should accept onSelect handler in CommandItem', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/CommandItem.*onSelect|onSelect.*CommandItem/)
  })
})

// ============================================================================
// Settings Components Tests
// ============================================================================

describe('Settings Components', () => {
  it('should have SettingsLayout component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function SettingsLayout')
  })

  it('should have SettingsSection component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function SettingsSection')
  })

  it('should have UserProfile component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function UserProfile')
  })

  it('should have APIKeyManager component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function APIKeyManager')
  })
})

// ============================================================================
// Tabs Components Tests
// ============================================================================

describe('Tabs Components', () => {
  it('should have Tabs component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function Tabs')
  })

  it('should have TabsList component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function TabsList')
  })

  it('should have TabsTrigger component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function TabsTrigger')
  })

  it('should have TabsContent component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function TabsContent')
  })

  it('should support defaultValue prop in Tabs', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/Tabs.*defaultValue|defaultValue.*Tabs/)
  })
})

// ============================================================================
// Workflow Components Tests
// ============================================================================

describe('Workflow Components', () => {
  it('should have WorkflowDashboard component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function WorkflowDashboard')
  })

  it('should have WorkflowList component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function WorkflowList')
  })

  it('should have WorkflowTimeline component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function WorkflowTimeline')
  })

  it('should accept workflows prop in WorkflowList', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/WorkflowList.*workflows|workflows.*WorkflowList/)
  })
})

// ============================================================================
// Agent Grid Components Tests
// ============================================================================

describe('Agent Grid Components', () => {
  it('should have AgentGrid component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function AgentGrid')
  })

  it('should have AgentCard component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function AgentCard')
  })

  it('should accept agent prop in AgentCard', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/AgentCard.*agent|agent.*AgentCard/)
  })

  it('should accept status prop in AgentCard', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/AgentCard.*status|status.*AgentCard/)
  })
})

// ============================================================================
// Analytics Dashboard Tests
// ============================================================================

describe('Analytics Dashboard', () => {
  it('should have AnalyticsDashboard component', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('export function AnalyticsDashboard')
  })

  it('should use grid layout', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/AnalyticsDashboard.*grid|grid.*AnalyticsDashboard/)
  })
})

// ============================================================================
// Data Attributes for Testing
// ============================================================================

describe('Data Attributes for Testing', () => {
  it('should have data-component attribute on DashboardLayout', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('data-component="DashboardLayout"')
  })

  it('should have data-component attribute on Sidebar', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('data-component="Sidebar"')
  })

  it('should have data-component attribute on SidebarNav', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('data-component="SidebarNav"')
  })

  it('should have data-component attribute on NavItem', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('data-component="NavItem"')
  })

  it('should have data-component attribute on DashboardContent', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('data-component="DashboardContent"')
  })

  it('should have data-component attribute on KPICard', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('data-component="KPICard"')
  })

  it('should have data-component attribute on ActivityFeed', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('data-component="ActivityFeed"')
  })

  it('should have data-component attribute on AgentStatus', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('data-component="AgentStatus"')
  })

  it('should have data-component attribute on DataTable', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('data-component="DataTable"')
  })

  it('should have data-component attribute on Tabs', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toContain('data-component="Tabs"')
  })
})

// ============================================================================
// Type Exports Tests
// ============================================================================

describe('Type Exports', () => {
  it('should export AdminContentProps interface', async () => {
    const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
    expect(content).toContain('export interface AdminContentProps')
  })

  it('should export defaultAdminData', async () => {
    const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
    expect(content).toContain('export const defaultAdminData')
  })

  it('should export AdminContent function', async () => {
    const content = await readFile('app/components/cockpit/AdminContent.tsx', 'utf-8')
    expect(content).toContain('export function AdminContent')
  })
})

// ============================================================================
// Accessibility Tests
// ============================================================================

describe('Accessibility', () => {
  it('should use semantic nav element in Sidebar', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/<nav/)
  })

  it('should use semantic main element for content', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/<main/)
  })

  it('should use semantic aside element for sidebar', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/<aside/)
  })

  it('should use semantic table elements in DataTable', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/<table/)
    expect(content).toMatch(/<thead/)
    expect(content).toMatch(/<tbody/)
  })

  it('should use anchor tags for navigation', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/<a\s+href/)
  })

  it('should use button tags for interactive elements', async () => {
    const content = await readFile('app/components/cockpit/index.tsx', 'utf-8')
    expect(content).toMatch(/<button/)
  })
})
