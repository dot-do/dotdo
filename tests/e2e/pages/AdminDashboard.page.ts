import type { Locator, Page } from '@playwright/test'

/**
 * Page Object Model for the Admin Dashboard
 *
 * The admin dashboard displays key metrics and status information:
 * - KPI cards (Active Agents, Workflows, API Calls, Uptime)
 * - API Usage chart (AreaChart)
 * - Recent Activity feed
 * - Agent Status grid
 * - Refresh functionality
 *
 * Expected test-id structure:
 *
 * Dashboard Container:
 * - data-testid="admin-dashboard" - Root dashboard container
 * - data-testid="dashboard-heading" - Dashboard title
 *
 * KPI Cards:
 * - data-testid="dashboard-kpi-grid" - KPI cards grid container
 * - data-testid="dashboard-kpi-active-agents" - Active Agents KPI card
 * - data-testid="dashboard-kpi-workflows" - Workflows KPI card
 * - data-testid="dashboard-kpi-api-calls" - API Calls KPI card
 * - data-testid="dashboard-kpi-uptime" - Uptime KPI card
 * - data-testid="dashboard-kpi-title" - KPI card title (within each card)
 * - data-testid="dashboard-kpi-value" - KPI card value (within each card)
 * - data-testid="dashboard-kpi-trend" - KPI card trend (within each card)
 * - data-testid="dashboard-kpi-icon" - KPI card icon (within each card)
 *
 * Charts:
 * - data-testid="dashboard-chart-api-usage" - API usage chart container
 * - data-testid="dashboard-chart-title" - Chart title
 * - data-testid="dashboard-chart-description" - Chart description
 * - data-testid="dashboard-chart-container" - Chart inner container
 * - data-testid="dashboard-chart-tooltip" - Chart tooltip
 *
 * Activity Feed:
 * - data-testid="activity-feed" - Activity feed container
 * - data-testid="activity-feed-heading" - Activity feed heading
 * - data-testid="activity-item" - Individual activity item
 * - data-testid="activity-item-title" - Activity item title
 * - data-testid="activity-item-description" - Activity item description
 * - data-testid="activity-item-timestamp" - Activity item timestamp
 * - data-testid="activity-item-type" - Activity item type indicator
 * - data-testid="activity-feed-empty" - Empty state when no activity
 *
 * Agent Status:
 * - data-testid="agent-status-grid" - Agent status grid container
 * - data-testid="agent-status-heading" - Agent status heading
 * - data-testid="agent-status-item" - Individual agent status item
 * - data-testid="agent-status-avatar" - Agent avatar
 * - data-testid="agent-status-name" - Agent name
 * - data-testid="agent-status-badge" - Agent status badge
 * - data-testid="agent-status-role" - Agent role
 *
 * Data Refresh:
 * - data-testid="dashboard-refresh" - Refresh button
 * - data-testid="dashboard-loading" - Loading indicator
 * - data-testid="dashboard-last-updated" - Last updated timestamp
 * - data-testid="dashboard-auto-refresh" - Auto-refresh indicator
 *
 * Error/Loading States:
 * - data-testid="dashboard-skeleton" - Loading skeleton
 * - data-testid="dashboard-error" - Error state container
 * - data-testid="dashboard-error-message" - Error message text
 * - data-testid="dashboard-retry-button" - Retry button
 *
 * Layout:
 * - data-testid="dashboard-two-column" - Two-column layout container
 */
export class AdminDashboardPage {
  readonly page: Page

  // Dashboard container
  readonly dashboard: Locator
  readonly heading: Locator

  // KPI Cards
  readonly kpiGrid: Locator
  readonly kpiActiveAgents: Locator
  readonly kpiWorkflows: Locator
  readonly kpiApiCalls: Locator
  readonly kpiUptime: Locator

  // Charts
  readonly chartApiUsage: Locator

  // Activity Feed
  readonly activityFeed: Locator

  // Agent Status
  readonly agentStatusGrid: Locator

  // Refresh
  readonly refreshButton: Locator
  readonly loadingIndicator: Locator
  readonly lastUpdated: Locator

  // Loading/Error states
  readonly skeleton: Locator
  readonly errorContainer: Locator
  readonly retryButton: Locator

  constructor(page: Page) {
    this.page = page

    // Dashboard container locators
    this.dashboard = page.getByTestId('admin-dashboard')
    this.heading = page.getByTestId('dashboard-heading')

    // KPI card locators
    this.kpiGrid = page.getByTestId('dashboard-kpi-grid')
    this.kpiActiveAgents = page.getByTestId('dashboard-kpi-active-agents')
    this.kpiWorkflows = page.getByTestId('dashboard-kpi-workflows')
    this.kpiApiCalls = page.getByTestId('dashboard-kpi-api-calls')
    this.kpiUptime = page.getByTestId('dashboard-kpi-uptime')

    // Chart locators
    this.chartApiUsage = page.getByTestId('dashboard-chart-api-usage')

    // Activity feed locators
    this.activityFeed = page.getByTestId('activity-feed')

    // Agent status locators
    this.agentStatusGrid = page.getByTestId('agent-status-grid')

    // Refresh locators
    this.refreshButton = page.getByTestId('dashboard-refresh')
    this.loadingIndicator = page.getByTestId('dashboard-loading')
    this.lastUpdated = page.getByTestId('dashboard-last-updated')

    // Loading/Error state locators
    this.skeleton = page.getByTestId('dashboard-skeleton')
    this.errorContainer = page.getByTestId('dashboard-error')
    this.retryButton = page.getByTestId('dashboard-retry-button')
  }

  /**
   * Navigate to the admin dashboard
   */
  async goto() {
    await this.page.goto('/admin')
  }

  /**
   * Wait for the dashboard to be fully loaded (not showing skeleton)
   */
  async waitForDashboard() {
    // Wait for either dashboard or error to be visible
    await Promise.race([
      this.dashboard.waitFor({ state: 'visible', timeout: 10000 }),
      this.errorContainer.waitFor({ state: 'visible', timeout: 10000 }),
    ]).catch(() => {
      // If neither appears, continue anyway
    })

    // Wait for skeleton to be hidden (if present)
    await this.skeleton.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {
      // Skeleton may not be present
    })
  }

  /**
   * Wait for loading indicator to disappear
   */
  async waitForLoadingComplete() {
    await this.loadingIndicator.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {
      // Loading may not be visible
    })
  }

  /**
   * Click the refresh button and wait for update
   */
  async refresh() {
    await this.refreshButton.click()
    await this.waitForLoadingComplete()
    await this.waitForDashboard()
  }

  /**
   * Get the value of a specific KPI card
   */
  async getKpiValue(kpiLocator: Locator): Promise<string> {
    const valueElement = kpiLocator.locator('[data-testid="dashboard-kpi-value"]')
    return (await valueElement.textContent()) || ''
  }

  /**
   * Get all activity items
   */
  async getActivityItems(): Promise<Locator[]> {
    const items = this.page.locator('[data-testid="activity-item"]')
    const count = await items.count()
    const locators: Locator[] = []
    for (let i = 0; i < count; i++) {
      locators.push(items.nth(i))
    }
    return locators
  }

  /**
   * Get all agent status items
   */
  async getAgentStatusItems(): Promise<Locator[]> {
    const items = this.page.locator('[data-testid="agent-status-item"]')
    const count = await items.count()
    const locators: Locator[] = []
    for (let i = 0; i < count; i++) {
      locators.push(items.nth(i))
    }
    return locators
  }

  /**
   * Get a specific agent by name
   */
  getAgentByName(name: string): Locator {
    return this.page.locator(`[data-testid="agent-status-item"][data-agent-name="${name}"]`)
  }

  /**
   * Get all agents with a specific status
   */
  getAgentsByStatus(status: 'idle' | 'working' | 'error'): Locator {
    return this.page.locator(`[data-testid="agent-status-item"][data-status="${status}"]`)
  }

  /**
   * Check if the dashboard is in error state
   */
  async isInErrorState(): Promise<boolean> {
    return this.errorContainer.isVisible()
  }

  /**
   * Check if the dashboard is loading
   */
  async isLoading(): Promise<boolean> {
    const skeletonVisible = await this.skeleton.isVisible().catch(() => false)
    const loadingVisible = await this.loadingIndicator.isVisible().catch(() => false)
    return skeletonVisible || loadingVisible
  }

  /**
   * Retry after error
   */
  async retryAfterError() {
    if (await this.isInErrorState()) {
      await this.retryButton.click()
      await this.waitForDashboard()
    }
  }

  /**
   * Get the last updated time text
   */
  async getLastUpdatedText(): Promise<string> {
    return (await this.lastUpdated.textContent()) || ''
  }

  /**
   * Set viewport to mobile size
   */
  async setMobileViewport() {
    await this.page.setViewportSize({ width: 375, height: 667 })
  }

  /**
   * Set viewport to tablet size
   */
  async setTabletViewport() {
    await this.page.setViewportSize({ width: 768, height: 1024 })
  }

  /**
   * Set viewport to desktop size
   */
  async setDesktopViewport() {
    await this.page.setViewportSize({ width: 1280, height: 720 })
  }

  /**
   * Get the number of KPI cards displayed
   */
  async getKpiCardCount(): Promise<number> {
    const cards = this.page.locator('[data-testid^="dashboard-kpi-"]')
    return cards.count()
  }

  /**
   * Check if chart has rendered (has SVG)
   */
  async isChartRendered(): Promise<boolean> {
    const svg = this.chartApiUsage.locator('svg.recharts-surface')
    return svg.isVisible()
  }

  /**
   * Hover over chart to show tooltip
   */
  async hoverChart(position: { x: number; y: number }) {
    const chartArea = this.chartApiUsage.locator('.recharts-surface')
    await chartArea.hover({ position })
  }

  /**
   * Get chart tooltip locator
   */
  getChartTooltip(): Locator {
    return this.chartApiUsage.locator('[data-testid="dashboard-chart-tooltip"]')
  }
}
