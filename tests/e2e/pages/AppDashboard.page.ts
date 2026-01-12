import type { Page, Locator } from '@playwright/test'

/**
 * Page Object Model for the User-Facing App Dashboard
 *
 * The App Dashboard is the main user landing page at /app, distinct from:
 * - Admin Dashboard (/admin) - for developers/admins with agent status
 * - Landing Page (/) - public marketing page
 *
 * The user dashboard focuses on:
 * - User-specific metrics (projects, tasks, workflows)
 * - Activity feed showing user's recent actions
 * - Quick actions for common tasks
 * - Personalized widgets based on user data
 *
 * Expected data-testid attributes:
 * - user-dashboard: Root dashboard container
 * - user-metrics: Metrics/stats section
 * - user-activity-feed: Activity feed container
 * - quick-actions: Quick action buttons panel
 * - user-widget-*: Dynamic widgets based on user data
 * - project-count: Project count metric
 * - task-count: Task count metric
 * - workflow-count: Workflow count metric
 */
export class AppDashboardPage {
  readonly page: Page

  // Root containers
  readonly dashboard: Locator
  readonly metricsSection: Locator
  readonly activityFeed: Locator
  readonly quickActionsPanel: Locator

  // Metrics cards
  readonly projectCount: Locator
  readonly taskCount: Locator
  readonly workflowCount: Locator
  readonly agentCount: Locator
  readonly apiCallsCount: Locator

  // Individual metric values and labels
  readonly projectCountValue: Locator
  readonly taskCountValue: Locator
  readonly workflowCountValue: Locator

  // Activity feed items
  readonly activityItems: Locator
  readonly activityTimestamp: Locator
  readonly activityDescription: Locator
  readonly activityShowMore: Locator

  // Quick actions
  readonly createProjectButton: Locator
  readonly createWorkflowButton: Locator
  readonly viewTasksButton: Locator
  readonly inviteTeamButton: Locator

  // User widgets (personalized sections)
  readonly recentProjectsWidget: Locator
  readonly pendingTasksWidget: Locator
  readonly activeWorkflowsWidget: Locator
  readonly notificationsWidget: Locator
  readonly onboardingWidget: Locator

  // Dashboard header
  readonly dashboardTitle: Locator
  readonly welcomeMessage: Locator
  readonly lastUpdated: Locator
  readonly refreshButton: Locator

  // Responsive elements
  readonly mobileMetricsCarousel: Locator
  readonly desktopMetricsGrid: Locator

  constructor(page: Page) {
    this.page = page

    // Root containers
    this.dashboard = page.locator('[data-testid="user-dashboard"]')
    this.metricsSection = page.locator('[data-testid="user-metrics"]')
    this.activityFeed = page.locator('[data-testid="user-activity-feed"]')
    this.quickActionsPanel = page.locator('[data-testid="quick-actions"]')

    // Metrics cards - using data-testid selectors
    this.projectCount = page.locator('[data-testid="project-count"]')
    this.taskCount = page.locator('[data-testid="task-count"]')
    this.workflowCount = page.locator('[data-testid="workflow-count"]')
    this.agentCount = page.locator('[data-testid="agent-count"]')
    this.apiCallsCount = page.locator('[data-testid="api-calls-count"]')

    // Metric values (the actual numbers)
    this.projectCountValue = page.locator('[data-testid="project-count-value"]')
    this.taskCountValue = page.locator('[data-testid="task-count-value"]')
    this.workflowCountValue = page.locator('[data-testid="workflow-count-value"]')

    // Activity feed items
    this.activityItems = page.locator('[data-testid="activity-item"]')
    this.activityTimestamp = page.locator('[data-testid="activity-timestamp"]')
    this.activityDescription = page.locator('[data-testid="activity-description"]')
    this.activityShowMore = page.locator('[data-testid="activity-show-more"]')

    // Quick actions
    this.createProjectButton = page.locator('[data-testid="quick-action-create-project"]')
    this.createWorkflowButton = page.locator('[data-testid="quick-action-create-workflow"]')
    this.viewTasksButton = page.locator('[data-testid="quick-action-view-tasks"]')
    this.inviteTeamButton = page.locator('[data-testid="quick-action-invite-team"]')

    // User widgets
    this.recentProjectsWidget = page.locator('[data-testid="user-widget-recent-projects"]')
    this.pendingTasksWidget = page.locator('[data-testid="user-widget-pending-tasks"]')
    this.activeWorkflowsWidget = page.locator('[data-testid="user-widget-active-workflows"]')
    this.notificationsWidget = page.locator('[data-testid="user-widget-notifications"]')
    this.onboardingWidget = page.locator('[data-testid="user-widget-onboarding"]')

    // Dashboard header
    this.dashboardTitle = page.locator('[data-testid="dashboard-title"]')
    this.welcomeMessage = page.locator('[data-testid="welcome-message"]')
    this.lastUpdated = page.locator('[data-testid="last-updated"]')
    this.refreshButton = page.locator('[data-testid="refresh-dashboard"]')

    // Responsive elements
    this.mobileMetricsCarousel = page.locator('[data-testid="metrics-carousel"]')
    this.desktopMetricsGrid = page.locator('[data-testid="metrics-grid"]')
  }

  /**
   * Navigate to the user dashboard
   */
  async goto() {
    await this.page.goto('/app')
  }

  /**
   * Wait for the dashboard to be fully loaded
   */
  async waitForLoad() {
    await this.dashboard.waitFor({ state: 'visible' })
    // Wait for metrics to load (may have loading skeleton)
    await this.metricsSection.waitFor({ state: 'visible' })
  }

  /**
   * Get the project count metric value
   */
  async getProjectCount(): Promise<number> {
    const text = await this.projectCountValue.textContent()
    return parseInt(text || '0', 10)
  }

  /**
   * Get the task count metric value
   */
  async getTaskCount(): Promise<number> {
    const text = await this.taskCountValue.textContent()
    return parseInt(text || '0', 10)
  }

  /**
   * Get the workflow count metric value
   */
  async getWorkflowCount(): Promise<number> {
    const text = await this.workflowCountValue.textContent()
    return parseInt(text || '0', 10)
  }

  /**
   * Get all activity feed items as text
   */
  async getActivityItems(): Promise<string[]> {
    const items = this.activityItems
    const count = await items.count()
    const texts: string[] = []
    for (let i = 0; i < count; i++) {
      const text = await items.nth(i).textContent()
      if (text) texts.push(text.trim())
    }
    return texts
  }

  /**
   * Click show more on activity feed
   */
  async showMoreActivity() {
    await this.activityShowMore.click()
  }

  /**
   * Click a quick action button
   */
  async clickQuickAction(action: 'create-project' | 'create-workflow' | 'view-tasks' | 'invite-team') {
    const actionLocator = this.page.locator(`[data-testid="quick-action-${action}"]`)
    await actionLocator.click()
  }

  /**
   * Refresh the dashboard data
   */
  async refresh() {
    await this.refreshButton.click()
  }

  /**
   * Get the welcome message text
   */
  async getWelcomeMessage(): Promise<string | null> {
    return this.welcomeMessage.textContent()
  }

  /**
   * Check if a specific widget is visible
   */
  async isWidgetVisible(widgetName: string): Promise<boolean> {
    const widget = this.page.locator(`[data-testid="user-widget-${widgetName}"]`)
    return widget.isVisible()
  }

  /**
   * Get all visible widget names
   */
  async getVisibleWidgets(): Promise<string[]> {
    const widgets = this.page.locator('[data-testid^="user-widget-"]')
    const count = await widgets.count()
    const names: string[] = []
    for (let i = 0; i < count; i++) {
      const testId = await widgets.nth(i).getAttribute('data-testid')
      if (testId) {
        const name = testId.replace('user-widget-', '')
        names.push(name)
      }
    }
    return names
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
   * Check if mobile layout is active (carousel instead of grid)
   */
  async isMobileLayout(): Promise<boolean> {
    const carousel = await this.mobileMetricsCarousel.isVisible()
    const grid = await this.desktopMetricsGrid.isVisible()
    return carousel && !grid
  }

  /**
   * Check if desktop layout is active (grid instead of carousel)
   */
  async isDesktopLayout(): Promise<boolean> {
    const carousel = await this.mobileMetricsCarousel.isVisible()
    const grid = await this.desktopMetricsGrid.isVisible()
    return grid && !carousel
  }

  /**
   * Get all metric cards
   */
  async getMetricCards(): Promise<{ name: string; value: string }[]> {
    const cards = this.page.locator('[data-testid$="-count"]')
    const count = await cards.count()
    const metrics: { name: string; value: string }[] = []

    for (let i = 0; i < count; i++) {
      const testId = await cards.nth(i).getAttribute('data-testid')
      const valueLocator = this.page.locator(`[data-testid="${testId}-value"]`)
      const value = await valueLocator.textContent() ?? '0'
      if (testId) {
        const name = testId.replace('-count', '')
        metrics.push({ name, value })
      }
    }
    return metrics
  }

  /**
   * Check if dashboard is showing loading state
   */
  async isLoading(): Promise<boolean> {
    const skeleton = this.page.locator('[data-testid="dashboard-skeleton"]')
    return skeleton.isVisible()
  }

  /**
   * Wait for dashboard data to finish loading
   */
  async waitForDataLoad() {
    // Wait for skeleton to disappear
    const skeleton = this.page.locator('[data-testid="dashboard-skeleton"]')
    await skeleton.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {
      // Skeleton might not exist if data loads quickly
    })
    // Ensure metrics have values
    await this.metricsSection.waitFor({ state: 'visible' })
  }
}
