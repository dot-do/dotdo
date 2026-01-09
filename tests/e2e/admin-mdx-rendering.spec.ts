import { test, expect } from '@playwright/test'

/**
 * E2E tests for /admin rendering .do/App.mdx with @mdxui/cockpit
 *
 * RED PHASE: These tests are expected to FAIL until the MDX rendering is wired up.
 *
 * The /admin route should:
 * 1. Render content from .do/App.mdx (not static React components)
 * 2. Use @mdxui/cockpit components (DashboardLayout, Sidebar, KPICard, DataTable)
 * 3. Support custom MDX components (AgentStatus, CommandPalette, WorkflowDashboard)
 * 4. Pass dynamic data to MDX (stats, recentActivity, teamAgents)
 *
 * Content structure from .do/App.mdx:
 * - DashboardLayout with Sidebar navigation
 * - "dotdo Dashboard" heading
 * - KPICards: Active Agents, Workflows Running, Events Today
 * - AgentStatus with team members (Priya, Ralph, Tom, etc.)
 * - CommandPalette with Quick Actions
 * - DataTable for Startup Management
 * - WorkflowDashboard for Workflow Monitor
 * - AnalyticsDashboard with charts
 * - SettingsLayout with sections
 */

test.describe('Admin MDX Rendering from .do/App.mdx', () => {
  test.describe('MDX Source Verification', () => {
    test('should render content from .do/App.mdx file', async ({ page }) => {
      await page.goto('/admin')
      // The page should have a data attribute indicating MDX source
      const mdxIndicator = page.locator('[data-mdx-source=".do/App.mdx"]')
      await expect(mdxIndicator).toBeAttached()
    })

    test('should have @mdxui/cockpit provider in component tree', async ({ page }) => {
      await page.goto('/admin')
      // MDX cockpit provider should be present
      const provider = page.locator('[data-mdxui-cockpit]')
      await expect(provider).toBeAttached()
    })

    test('should use MDX runtime for rendering', async ({ page }) => {
      await page.goto('/admin')
      // Check for MDX runtime hydration marker
      const mdxRoot = page.locator('[data-mdx-runtime]')
      await expect(mdxRoot).toBeAttached()
    })
  })

  test.describe('DashboardLayout from @mdxui/cockpit', () => {
    test('should render DashboardLayout component', async ({ page }) => {
      await page.goto('/admin')
      const layout = page.locator('[data-component="DashboardLayout"]')
      await expect(layout).toBeVisible()
    })

    test('should have "dotdo Dashboard" as main heading from MDX', async ({ page }) => {
      await page.goto('/admin')
      // This comes directly from .do/App.mdx: # dotdo Dashboard
      const heading = page.locator('h1:has-text("dotdo Dashboard")')
      await expect(heading).toBeVisible()
    })

    test('should render "Welcome to dotdo" section from MDX', async ({ page }) => {
      await page.goto('/admin')
      // From MDX: ## Welcome to dotdo
      const welcomeHeading = page.locator('h2:has-text("Welcome to dotdo")')
      await expect(welcomeHeading).toBeVisible()
    })

    test('should render "Your autonomous business control center" text', async ({ page }) => {
      await page.goto('/admin')
      // From MDX: Your autonomous business control center.
      const description = page.locator('text=Your autonomous business control center')
      await expect(description).toBeVisible()
    })
  })

  test.describe('Sidebar from @mdxui/cockpit', () => {
    test('should render Sidebar component', async ({ page }) => {
      await page.goto('/admin')
      const sidebar = page.locator('[data-component="Sidebar"]')
      await expect(sidebar).toBeVisible()
    })

    test('should render SidebarNav with navigation items', async ({ page }) => {
      await page.goto('/admin')
      const sidebarNav = page.locator('[data-component="SidebarNav"]')
      await expect(sidebarNav).toBeVisible()
    })

    test('should have Overview NavItem linking to /admin', async ({ page }) => {
      await page.goto('/admin')
      const navItem = page.locator('[data-component="NavItem"] a[href="/admin"]:has-text("Overview")')
      await expect(navItem).toBeVisible()
    })

    test('should have Startups NavItem linking to /admin/startups', async ({ page }) => {
      await page.goto('/admin')
      // From MDX: <NavItem href="/admin/startups" icon="Rocket">Startups</NavItem>
      const navItem = page.locator('a[href="/admin/startups"]:has-text("Startups")')
      await expect(navItem).toBeVisible()
    })

    test('should have Agents NavItem linking to /admin/agents', async ({ page }) => {
      await page.goto('/admin')
      const navItem = page.locator('a[href="/admin/agents"]:has-text("Agents")')
      await expect(navItem).toBeVisible()
    })

    test('should have Workflows NavItem with GitBranch icon', async ({ page }) => {
      await page.goto('/admin')
      const navItem = page.locator('a[href="/admin/workflows"]:has-text("Workflows")')
      await expect(navItem).toBeVisible()
      // Should have GitBranch icon
      const icon = navItem.locator('[data-icon="GitBranch"], svg')
      await expect(icon).toBeVisible()
    })

    test('should have Events NavItem linking to /admin/events', async ({ page }) => {
      await page.goto('/admin')
      const navItem = page.locator('a[href="/admin/events"]:has-text("Events")')
      await expect(navItem).toBeVisible()
    })

    test('should have Functions NavItem linking to /admin/functions', async ({ page }) => {
      await page.goto('/admin')
      const navItem = page.locator('a[href="/admin/functions"]:has-text("Functions")')
      await expect(navItem).toBeVisible()
    })

    test('should have Analytics NavItem linking to /admin/analytics', async ({ page }) => {
      await page.goto('/admin')
      const navItem = page.locator('a[href="/admin/analytics"]:has-text("Analytics")')
      await expect(navItem).toBeVisible()
    })

    test('should have Settings NavItem linking to /admin/settings', async ({ page }) => {
      await page.goto('/admin')
      const navItem = page.locator('a[href="/admin/settings"]:has-text("Settings")')
      await expect(navItem).toBeVisible()
    })

    test('should render SidebarUser component', async ({ page }) => {
      await page.goto('/admin')
      const sidebarUser = page.locator('[data-component="SidebarUser"]')
      await expect(sidebarUser).toBeVisible()
    })
  })

  test.describe('KPICard Components from @mdxui/cockpit', () => {
    test('should render DashboardGrid with 3 columns', async ({ page }) => {
      await page.goto('/admin')
      const grid = page.locator('[data-component="DashboardGrid"]')
      await expect(grid).toBeVisible()
      // Should have cols={3} attribute or equivalent class
      await expect(grid).toHaveAttribute('data-cols', '3')
    })

    test('should render Active Agents KPICard', async ({ page }) => {
      await page.goto('/admin')
      const kpiCard = page.locator('[data-component="KPICard"]:has-text("Active Agents")')
      await expect(kpiCard).toBeVisible()
    })

    test('should render Active Agents with Users icon', async ({ page }) => {
      await page.goto('/admin')
      const kpiCard = page.locator('[data-component="KPICard"]:has-text("Active Agents")')
      const icon = kpiCard.locator('[data-icon="Users"], svg')
      await expect(icon).toBeVisible()
    })

    test('should render Active Agents with dynamic value from stats.activeAgents', async ({ page }) => {
      await page.goto('/admin')
      const kpiCard = page.locator('[data-component="KPICard"]:has-text("Active Agents")')
      // Value should be a number (from stats.activeAgents)
      const value = kpiCard.locator('[data-kpi-value]')
      await expect(value).toBeVisible()
      const text = await value.textContent()
      expect(text).toMatch(/\d+/)
    })

    test('should render Active Agents with trend indicator', async ({ page }) => {
      await page.goto('/admin')
      const kpiCard = page.locator('[data-component="KPICard"]:has-text("Active Agents")')
      const trend = kpiCard.locator('[data-kpi-trend]')
      await expect(trend).toBeVisible()
    })

    test('should render Workflows Running KPICard', async ({ page }) => {
      await page.goto('/admin')
      const kpiCard = page.locator('[data-component="KPICard"]:has-text("Workflows Running")')
      await expect(kpiCard).toBeVisible()
    })

    test('should render Workflows Running with GitBranch icon', async ({ page }) => {
      await page.goto('/admin')
      const kpiCard = page.locator('[data-component="KPICard"]:has-text("Workflows Running")')
      const icon = kpiCard.locator('[data-icon="GitBranch"], svg')
      await expect(icon).toBeVisible()
    })

    test('should render Events Today KPICard', async ({ page }) => {
      await page.goto('/admin')
      const kpiCard = page.locator('[data-component="KPICard"]:has-text("Events Today")')
      await expect(kpiCard).toBeVisible()
    })

    test('should render Events Today with Activity icon', async ({ page }) => {
      await page.goto('/admin')
      const kpiCard = page.locator('[data-component="KPICard"]:has-text("Events Today")')
      const icon = kpiCard.locator('[data-icon="Activity"], svg')
      await expect(icon).toBeVisible()
    })
  })

  test.describe('ActivityFeed Component', () => {
    test('should render Recent Activity section heading', async ({ page }) => {
      await page.goto('/admin')
      // From MDX: ### Recent Activity
      const heading = page.locator('h3:has-text("Recent Activity")')
      await expect(heading).toBeVisible()
    })

    test('should render ActivityFeed component with items', async ({ page }) => {
      await page.goto('/admin')
      const activityFeed = page.locator('[data-component="ActivityFeed"]')
      await expect(activityFeed).toBeVisible()
    })

    test('should display activity items from recentActivity data', async ({ page }) => {
      await page.goto('/admin')
      const activityItems = page.locator('[data-component="ActivityFeed"] [data-activity-item]')
      const count = await activityItems.count()
      expect(count).toBeGreaterThan(0)
    })
  })

  test.describe('AgentStatus Component', () => {
    test('should render Your Team section heading', async ({ page }) => {
      await page.goto('/admin')
      // From MDX: ### Your Team
      const heading = page.locator('h3:has-text("Your Team")')
      await expect(heading).toBeVisible()
    })

    test('should render AgentStatus component', async ({ page }) => {
      await page.goto('/admin')
      const agentStatus = page.locator('[data-component="AgentStatus"]')
      await expect(agentStatus).toBeVisible()
    })

    test('should display description text about team monitoring', async ({ page }) => {
      await page.goto('/admin')
      // From MDX: Monitor your AI agents in real-time. See what Priya, Ralph, Tom, and the team are working on.
      const description = page.locator('text=Monitor your AI agents in real-time')
      await expect(description).toBeVisible()
    })

    test('should mention Priya in team description', async ({ page }) => {
      await page.goto('/admin')
      const agentStatus = page.locator('[data-component="AgentStatus"]')
      await expect(agentStatus).toContainText('Priya')
    })

    test('should mention Ralph in team description', async ({ page }) => {
      await page.goto('/admin')
      const agentStatus = page.locator('[data-component="AgentStatus"]')
      await expect(agentStatus).toContainText('Ralph')
    })

    test('should mention Tom in team description', async ({ page }) => {
      await page.goto('/admin')
      const agentStatus = page.locator('[data-component="AgentStatus"]')
      await expect(agentStatus).toContainText('Tom')
    })

    test('should receive agents data from teamAgents prop', async ({ page }) => {
      await page.goto('/admin')
      const agentStatus = page.locator('[data-component="AgentStatus"]')
      await expect(agentStatus).toHaveAttribute('data-agents-count')
    })
  })

  test.describe('CommandPalette Component', () => {
    test('should render Quick Actions section heading', async ({ page }) => {
      await page.goto('/admin')
      // From MDX: ### Quick Actions
      const heading = page.locator('h3:has-text("Quick Actions")')
      await expect(heading).toBeVisible()
    })

    test('should render CommandPalette component', async ({ page }) => {
      await page.goto('/admin')
      const commandPalette = page.locator('[data-component="CommandPalette"]')
      await expect(commandPalette).toBeVisible()
    })

    test('should render Agents CommandGroup', async ({ page }) => {
      await page.goto('/admin')
      const agentsGroup = page.locator('[data-component="CommandGroup"]:has-text("Agents")')
      await expect(agentsGroup).toBeVisible()
    })

    test('should have "Ask Priya for product direction" command', async ({ page }) => {
      await page.goto('/admin')
      const command = page.locator('[data-component="CommandItem"]:has-text("Ask Priya for product direction")')
      await expect(command).toBeVisible()
    })

    test('should have "Have Ralph start building" command', async ({ page }) => {
      await page.goto('/admin')
      const command = page.locator('[data-component="CommandItem"]:has-text("Have Ralph start building")')
      await expect(command).toBeVisible()
    })

    test('should have "Request code review from Tom" command', async ({ page }) => {
      await page.goto('/admin')
      const command = page.locator('[data-component="CommandItem"]:has-text("Request code review from Tom")')
      await expect(command).toBeVisible()
    })

    test('should render Workflows CommandGroup', async ({ page }) => {
      await page.goto('/admin')
      const workflowsGroup = page.locator('[data-component="CommandGroup"]:has-text("Workflows")')
      await expect(workflowsGroup).toBeVisible()
    })

    test('should have "Create new workflow" command', async ({ page }) => {
      await page.goto('/admin')
      const command = page.locator('[data-component="CommandItem"]:has-text("Create new workflow")')
      await expect(command).toBeVisible()
    })

    test('should have "View running workflows" command', async ({ page }) => {
      await page.goto('/admin')
      const command = page.locator('[data-component="CommandItem"]:has-text("View running workflows")')
      await expect(command).toBeVisible()
    })

    test('should have "Check event log" command', async ({ page }) => {
      await page.goto('/admin')
      const command = page.locator('[data-component="CommandItem"]:has-text("Check event log")')
      await expect(command).toBeVisible()
    })

    test('should execute priya template literal on Ask Priya click', async ({ page }) => {
      await page.goto('/admin')
      const command = page.locator('[data-component="CommandItem"]:has-text("Ask Priya")')
      await command.click()
      // Should trigger priya`what should we build next?`
      const modal = page.locator('[data-agent-chat="priya"]')
      await expect(modal).toBeVisible()
    })
  })

  test.describe('DataTable for Startup Management', () => {
    test('should render Startup Management section heading', async ({ page }) => {
      await page.goto('/admin')
      // From MDX: ## Startup Management
      const heading = page.locator('h2:has-text("Startup Management")')
      await expect(heading).toBeVisible()
    })

    test('should render DataTable component', async ({ page }) => {
      await page.goto('/admin')
      const dataTable = page.locator('[data-component="DataTable"]')
      await expect(dataTable).toBeVisible()
    })

    test('should render DataTable with searchable prop', async ({ page }) => {
      await page.goto('/admin')
      const searchInput = page.locator('[data-component="DataTable"] input[type="search"], [data-component="DataTable"] [data-search]')
      await expect(searchInput).toBeVisible()
    })

    test('should render DataTable with sortable columns', async ({ page }) => {
      await page.goto('/admin')
      const sortableHeaders = page.locator('[data-component="DataTable"] th[data-sortable]')
      const count = await sortableHeaders.count()
      expect(count).toBeGreaterThan(0)
    })

    test('should render DataTable with pagination', async ({ page }) => {
      await page.goto('/admin')
      const pagination = page.locator('[data-component="DataTable"] [data-pagination]')
      await expect(pagination).toBeVisible()
    })

    test('should display DataTable description text', async ({ page }) => {
      await page.goto('/admin')
      // From MDX: Manage all your startups from one place. Track hypotheses, experiments, and metrics.
      const description = page.locator('text=Manage all your startups from one place')
      await expect(description).toBeVisible()
    })
  })

  test.describe('Agent Configuration with Tabs', () => {
    test('should render Agent Configuration section heading', async ({ page }) => {
      await page.goto('/admin')
      // From MDX: ## Agent Configuration
      const heading = page.locator('h2:has-text("Agent Configuration")')
      await expect(heading).toBeVisible()
    })

    test('should render Tabs component with defaultValue="active"', async ({ page }) => {
      await page.goto('/admin')
      const tabs = page.locator('[data-component="Tabs"]')
      await expect(tabs).toBeVisible()
      // Active tab should be selected by default
      const activeTab = page.locator('[data-state="active"]:has-text("Active Agents")')
      await expect(activeTab).toBeVisible()
    })

    test('should have Active Agents tab trigger', async ({ page }) => {
      await page.goto('/admin')
      const tabTrigger = page.locator('[data-component="TabsTrigger"]:has-text("Active Agents")')
      await expect(tabTrigger).toBeVisible()
    })

    test('should have Available tab trigger', async ({ page }) => {
      await page.goto('/admin')
      const tabTrigger = page.locator('[data-component="TabsTrigger"]:has-text("Available")')
      await expect(tabTrigger).toBeVisible()
    })

    test('should have Custom tab trigger', async ({ page }) => {
      await page.goto('/admin')
      const tabTrigger = page.locator('[data-component="TabsTrigger"]:has-text("Custom")')
      await expect(tabTrigger).toBeVisible()
    })

    test('should render AgentGrid in Active Agents tab', async ({ page }) => {
      await page.goto('/admin')
      const agentGrid = page.locator('[data-component="AgentGrid"]')
      await expect(agentGrid).toBeVisible()
    })

    test('should render AgentCard for Priya with status "working"', async ({ page }) => {
      await page.goto('/admin')
      const agentCard = page.locator('[data-component="AgentCard"]:has-text("Priya")')
      await expect(agentCard).toBeVisible()
      await expect(agentCard).toHaveAttribute('data-status', 'working')
    })

    test('should render AgentCard for Ralph with status "idle"', async ({ page }) => {
      await page.goto('/admin')
      const agentCard = page.locator('[data-component="AgentCard"]:has-text("Ralph")')
      await expect(agentCard).toBeVisible()
      await expect(agentCard).toHaveAttribute('data-status', 'idle')
    })

    test('should render AgentCard for Tom with status "reviewing"', async ({ page }) => {
      await page.goto('/admin')
      const agentCard = page.locator('[data-component="AgentCard"]:has-text("Tom")')
      await expect(agentCard).toBeVisible()
      await expect(agentCard).toHaveAttribute('data-status', 'reviewing')
    })

    test('should render AgentCard for Mark', async ({ page }) => {
      await page.goto('/admin')
      const agentCard = page.locator('[data-component="AgentCard"]:has-text("Mark")')
      await expect(agentCard).toBeVisible()
    })

    test('should render AgentCard for Sally with status "outreach"', async ({ page }) => {
      await page.goto('/admin')
      const agentCard = page.locator('[data-component="AgentCard"]:has-text("Sally")')
      await expect(agentCard).toBeVisible()
      await expect(agentCard).toHaveAttribute('data-status', 'outreach')
    })

    test('should render AgentCard for Quinn with status "testing"', async ({ page }) => {
      await page.goto('/admin')
      const agentCard = page.locator('[data-component="AgentCard"]:has-text("Quinn")')
      await expect(agentCard).toBeVisible()
      await expect(agentCard).toHaveAttribute('data-status', 'testing')
    })

    test('should switch to Available tab and show content', async ({ page }) => {
      await page.goto('/admin')
      const availableTab = page.locator('[data-component="TabsTrigger"]:has-text("Available")')
      await availableTab.click()
      const content = page.locator('text=Additional agents available from agents.do')
      await expect(content).toBeVisible()
    })

    test('should switch to Custom tab and show content', async ({ page }) => {
      await page.goto('/admin')
      const customTab = page.locator('[data-component="TabsTrigger"]:has-text("Custom")')
      await customTab.click()
      const content = page.locator('text=Create custom agents for your specific domain')
      await expect(content).toBeVisible()
    })
  })

  test.describe('WorkflowDashboard Component', () => {
    test('should render Workflow Monitor section heading', async ({ page }) => {
      await page.goto('/admin')
      // From MDX: ## Workflow Monitor
      const heading = page.locator('h2:has-text("Workflow Monitor")')
      await expect(heading).toBeVisible()
    })

    test('should render WorkflowDashboard component', async ({ page }) => {
      await page.goto('/admin')
      const workflowDashboard = page.locator('[data-component="WorkflowDashboard"]')
      await expect(workflowDashboard).toBeVisible()
    })

    test('should render WorkflowList with workflows', async ({ page }) => {
      await page.goto('/admin')
      const workflowList = page.locator('[data-component="WorkflowList"]')
      await expect(workflowList).toBeVisible()
    })

    test('should render WorkflowTimeline with events', async ({ page }) => {
      await page.goto('/admin')
      const workflowTimeline = page.locator('[data-component="WorkflowTimeline"]')
      await expect(workflowTimeline).toBeVisible()
    })
  })

  test.describe('AnalyticsDashboard Component', () => {
    test('should render Analytics section heading', async ({ page }) => {
      await page.goto('/admin')
      // From MDX: ## Analytics
      const heading = page.locator('h2:has-text("Analytics")')
      await expect(heading).toBeVisible()
    })

    test('should render AnalyticsDashboard component', async ({ page }) => {
      await page.goto('/admin')
      const analyticsDashboard = page.locator('[data-component="AnalyticsDashboard"]')
      await expect(analyticsDashboard).toBeVisible()
    })

    test('should render Revenue AreaChart', async ({ page }) => {
      await page.goto('/admin')
      const areaChart = page.locator('[data-component="AreaChart"]:has-text("Revenue")')
      await expect(areaChart).toBeVisible()
    })

    test('should render Agent Usage BarChart', async ({ page }) => {
      await page.goto('/admin')
      const barChart = page.locator('[data-component="BarChart"]:has-text("Agent Usage")')
      await expect(barChart).toBeVisible()
    })

    test('should render Experiment Results LineChart', async ({ page }) => {
      await page.goto('/admin')
      const lineChart = page.locator('[data-component="LineChart"]:has-text("Experiment Results")')
      await expect(lineChart).toBeVisible()
    })
  })

  test.describe('SettingsLayout Component', () => {
    test('should render Settings section heading', async ({ page }) => {
      await page.goto('/admin')
      // From MDX: ## Settings
      const heading = page.locator('h2:has-text("Settings")')
      await expect(heading).toBeVisible()
    })

    test('should render SettingsLayout component', async ({ page }) => {
      await page.goto('/admin')
      const settingsLayout = page.locator('[data-component="SettingsLayout"]')
      await expect(settingsLayout).toBeVisible()
    })

    test('should render Profile SettingsSection', async ({ page }) => {
      await page.goto('/admin')
      const section = page.locator('[data-component="SettingsSection"]:has-text("Profile")')
      await expect(section).toBeVisible()
    })

    test('should render UserProfile component in Profile section', async ({ page }) => {
      await page.goto('/admin')
      const userProfile = page.locator('[data-component="UserProfile"]')
      await expect(userProfile).toBeVisible()
    })

    test('should render API Keys SettingsSection', async ({ page }) => {
      await page.goto('/admin')
      const section = page.locator('[data-component="SettingsSection"]:has-text("API Keys")')
      await expect(section).toBeVisible()
    })

    test('should render APIKeyManager component', async ({ page }) => {
      await page.goto('/admin')
      const apiKeyManager = page.locator('[data-component="APIKeyManager"]')
      await expect(apiKeyManager).toBeVisible()
    })

    test('should render Integrations SettingsSection', async ({ page }) => {
      await page.goto('/admin')
      const section = page.locator('[data-component="SettingsSection"]:has-text("Integrations")')
      await expect(section).toBeVisible()
    })

    test('should render IntegrationsList component', async ({ page }) => {
      await page.goto('/admin')
      const integrationsList = page.locator('[data-component="IntegrationsList"]')
      await expect(integrationsList).toBeVisible()
    })

    test('should render Billing SettingsSection', async ({ page }) => {
      await page.goto('/admin')
      const section = page.locator('[data-component="SettingsSection"]:has-text("Billing")')
      await expect(section).toBeVisible()
    })

    test('should render BillingManager component', async ({ page }) => {
      await page.goto('/admin')
      const billingManager = page.locator('[data-component="BillingManager"]')
      await expect(billingManager).toBeVisible()
    })
  })

  test.describe('MDX Content Separators', () => {
    test('should render horizontal rules between sections', async ({ page }) => {
      await page.goto('/admin')
      // From MDX: --- separators between sections
      const hrElements = page.locator('[data-component="DashboardContent"] hr')
      const count = await hrElements.count()
      // There are 5 --- separators in the MDX
      expect(count).toBeGreaterThanOrEqual(5)
    })
  })

  test.describe('Dynamic Data Injection', () => {
    test('should inject stats object to KPICards', async ({ page }) => {
      await page.goto('/admin')
      // Verify stats data is injected
      const activeAgentsValue = page.locator('[data-component="KPICard"]:has-text("Active Agents") [data-kpi-value]')
      const text = await activeAgentsValue.textContent()
      // Should be a number, not "stats.activeAgents" literal
      expect(text).not.toContain('stats.')
      expect(text).toMatch(/\d+/)
    })

    test('should inject recentActivity to ActivityFeed', async ({ page }) => {
      await page.goto('/admin')
      const activityFeed = page.locator('[data-component="ActivityFeed"]')
      // Should have data-items-count indicating injected data
      await expect(activityFeed).toHaveAttribute('data-items-count')
    })

    test('should inject teamAgents to AgentStatus', async ({ page }) => {
      await page.goto('/admin')
      const agentStatus = page.locator('[data-component="AgentStatus"]')
      // Should have data-agents-count indicating injected data
      await expect(agentStatus).toHaveAttribute('data-agents-count')
    })

    test('should inject startupColumns and startups to DataTable', async ({ page }) => {
      await page.goto('/admin')
      const dataTable = page.locator('[data-component="DataTable"]')
      // Should have column headers from startupColumns
      const headers = dataTable.locator('th')
      const count = await headers.count()
      expect(count).toBeGreaterThan(0)
    })

    test('should inject activeWorkflows to WorkflowList', async ({ page }) => {
      await page.goto('/admin')
      const workflowList = page.locator('[data-component="WorkflowList"]')
      await expect(workflowList).toHaveAttribute('data-workflows-count')
    })

    test('should inject workflowEvents to WorkflowTimeline', async ({ page }) => {
      await page.goto('/admin')
      const workflowTimeline = page.locator('[data-component="WorkflowTimeline"]')
      await expect(workflowTimeline).toHaveAttribute('data-events-count')
    })

    test('should inject revenueData to AreaChart', async ({ page }) => {
      await page.goto('/admin')
      const areaChart = page.locator('[data-component="AreaChart"]:has-text("Revenue")')
      await expect(areaChart).toHaveAttribute('data-data-count')
    })

    test('should inject agentUsage to BarChart', async ({ page }) => {
      await page.goto('/admin')
      const barChart = page.locator('[data-component="BarChart"]:has-text("Agent Usage")')
      await expect(barChart).toHaveAttribute('data-data-count')
    })

    test('should inject experimentResults to LineChart', async ({ page }) => {
      await page.goto('/admin')
      const lineChart = page.locator('[data-component="LineChart"]:has-text("Experiment Results")')
      await expect(lineChart).toHaveAttribute('data-data-count')
    })
  })

  test.describe('Agent Template Literals', () => {
    test('should support priya template literal syntax', async ({ page }) => {
      await page.goto('/admin')
      // CommandItem has onSelect={() => priya`what should we build next?`}
      const priyaCommand = page.locator('[data-component="CommandItem"]:has-text("Ask Priya")')
      await expect(priyaCommand).toHaveAttribute('data-agent', 'priya')
    })

    test('should support ralph template literal syntax', async ({ page }) => {
      await page.goto('/admin')
      // CommandItem has onSelect={() => ralph`build the next feature`}
      const ralphCommand = page.locator('[data-component="CommandItem"]:has-text("Ralph")')
      await expect(ralphCommand).toHaveAttribute('data-agent', 'ralph')
    })

    test('should support tom template literal syntax', async ({ page }) => {
      await page.goto('/admin')
      // CommandItem has onSelect={() => tom`review recent changes`}
      const tomCommand = page.locator('[data-component="CommandItem"]:has-text("Tom")')
      await expect(tomCommand).toHaveAttribute('data-agent', 'tom')
    })
  })
})
