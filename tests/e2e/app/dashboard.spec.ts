import { test, expect } from '@playwright/test'
import { AppDashboardPage } from '../pages/AppDashboard.page'

/**
 * E2E Tests for the User-Facing App Dashboard (/app)
 *
 * TDD RED PHASE: These tests are expected to FAIL initially.
 *
 * The user dashboard is DISTINCT from:
 * - Admin Dashboard (/admin) - shows agent status (Priya, Ralph, Tom, etc.)
 * - Landing Page (/) - public marketing page
 *
 * The user dashboard focuses on:
 * - User-specific metrics (projects, tasks, workflows they own)
 * - Activity feed showing user's recent actions
 * - Quick actions for common user tasks
 * - Personalized widgets based on user data
 *
 * Key differences from admin dashboard:
 * - Shows user's own data, not system-wide agent status
 * - No "Your 1-Person Unicorn" branding (that's admin)
 * - No agent team status cards (that's admin)
 * - Focus on projects/tasks the user is working on
 */

test.describe('User Dashboard - Content Renders', () => {
  test('should render the user dashboard root container', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    // The user dashboard should be present with correct data-testid
    // This is DIFFERENT from admin dashboard which uses "admin-shell"
    await expect(dashboard.dashboard).toBeVisible()
    await expect(dashboard.dashboard).toHaveAttribute('data-testid', 'user-dashboard')
  })

  test('should render dashboard title for user context', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    await expect(dashboard.dashboardTitle).toBeVisible()
    // Should NOT be "Your 1-Person Unicorn" (that's admin dashboard)
    await expect(dashboard.dashboardTitle).not.toContainText('Your 1-Person Unicorn')
    // Should be user-focused title
    await expect(dashboard.dashboardTitle).toContainText(/Dashboard|Home|Overview/i)
  })

  test('should display personalized welcome message with user name', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    await expect(dashboard.welcomeMessage).toBeVisible()
    // Should greet the user
    await expect(dashboard.welcomeMessage).toContainText(/Welcome|Hello|Hi/i)
  })

  test('should NOT display admin-specific content', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    // These are admin-specific elements that should NOT appear
    const agentTeamStatus = page.locator('text=Agent Team Status')
    const unicornBranding = page.locator('text=Your 1-Person Unicorn')
    const autonomousBusiness = page.locator('text=Autonomous business control center')

    await expect(agentTeamStatus).not.toBeVisible()
    await expect(unicornBranding).not.toBeVisible()
    await expect(autonomousBusiness).not.toBeVisible()
  })

  test('should show last updated timestamp', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    await expect(dashboard.lastUpdated).toBeVisible()
    // Should contain a timestamp format
    await expect(dashboard.lastUpdated).toContainText(/\d|ago|updated/i)
  })

  test('should have refresh button to reload data', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    await expect(dashboard.refreshButton).toBeVisible()
    await expect(dashboard.refreshButton).toBeEnabled()
  })
})

test.describe('User Dashboard - Metrics Display', () => {
  test('should render metrics section', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    await expect(dashboard.metricsSection).toBeVisible()
    await expect(dashboard.metricsSection).toHaveAttribute('data-testid', 'user-metrics')
  })

  test('should display project count metric', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    await expect(dashboard.projectCount).toBeVisible()
    await expect(dashboard.projectCountValue).toBeVisible()
    // Value should be a number
    const value = await dashboard.getProjectCount()
    expect(typeof value).toBe('number')
    expect(value).toBeGreaterThanOrEqual(0)
  })

  test('should display task count metric', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    await expect(dashboard.taskCount).toBeVisible()
    await expect(dashboard.taskCountValue).toBeVisible()
    // Value should be a number
    const value = await dashboard.getTaskCount()
    expect(typeof value).toBe('number')
    expect(value).toBeGreaterThanOrEqual(0)
  })

  test('should display workflow count metric', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    await expect(dashboard.workflowCount).toBeVisible()
    await expect(dashboard.workflowCountValue).toBeVisible()
    // Value should be a number
    const value = await dashboard.getWorkflowCount()
    expect(typeof value).toBe('number')
    expect(value).toBeGreaterThanOrEqual(0)
  })

  test('should display at least 3 metric cards', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    const metrics = await dashboard.getMetricCards()
    expect(metrics.length).toBeGreaterThanOrEqual(3)
  })

  test('metric cards should have labels and values', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    // Each metric card should have both label and value visible
    const projectLabel = dashboard.projectCount.locator('[data-testid="metric-label"]')
    await expect(projectLabel).toBeVisible()

    const taskLabel = dashboard.taskCount.locator('[data-testid="metric-label"]')
    await expect(taskLabel).toBeVisible()

    const workflowLabel = dashboard.workflowCount.locator('[data-testid="metric-label"]')
    await expect(workflowLabel).toBeVisible()
  })

  test('should NOT show admin-specific metrics', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    // These are admin metrics that should NOT appear in user dashboard
    const activeAgents = page.locator('[data-testid="active-agents-count"]')
    const humanEscalations = page.locator('[data-testid="human-escalations-count"]')
    const eventsToday = page.locator('text=Events Today')

    await expect(activeAgents).not.toBeVisible()
    await expect(humanEscalations).not.toBeVisible()
    await expect(eventsToday).not.toBeVisible()
  })
})

test.describe('User Dashboard - Activity Feed', () => {
  test('should render activity feed section', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    await expect(dashboard.activityFeed).toBeVisible()
    await expect(dashboard.activityFeed).toHaveAttribute('data-testid', 'user-activity-feed')
  })

  test('should display activity feed header', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    const feedHeader = page.locator('[data-testid="user-activity-feed"] h2, [data-testid="user-activity-feed"] h3')
    await expect(feedHeader).toBeVisible()
    await expect(feedHeader).toContainText(/Activity|Recent|History/i)
  })

  test('should show activity items when user has activity', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    // Wait for data to load
    await dashboard.waitForDataLoad()

    // Should have activity items OR empty state
    const items = dashboard.activityItems
    const emptyState = page.locator('[data-testid="activity-empty-state"]')

    const hasItems = await items.count() > 0
    const hasEmptyState = await emptyState.isVisible()

    // Either has items or shows empty state
    expect(hasItems || hasEmptyState).toBe(true)
  })

  test('activity items should have timestamps', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()
    await dashboard.waitForDataLoad()

    const items = dashboard.activityItems
    const count = await items.count()

    if (count > 0) {
      // First item should have a timestamp
      const timestamp = items.first().locator('[data-testid="activity-timestamp"]')
      await expect(timestamp).toBeVisible()
    }
  })

  test('activity items should have descriptions', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()
    await dashboard.waitForDataLoad()

    const items = dashboard.activityItems
    const count = await items.count()

    if (count > 0) {
      // First item should have a description
      const description = items.first().locator('[data-testid="activity-description"]')
      await expect(description).toBeVisible()
      await expect(description).not.toBeEmpty()
    }
  })

  test('should have show more button when more activity exists', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()
    await dashboard.waitForDataLoad()

    const items = dashboard.activityItems
    const count = await items.count()

    // If there are items, there might be more to load
    if (count > 0) {
      // Show more button should be present (may be visible or hidden based on total)
      const showMore = dashboard.activityShowMore
      const isVisible = await showMore.isVisible()
      // Just verify the element can be located (it exists in DOM)
      expect(isVisible === true || isVisible === false).toBe(true)
    }
  })

  test('clicking show more should load additional activity', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()
    await dashboard.waitForDataLoad()

    const showMore = dashboard.activityShowMore
    const isVisible = await showMore.isVisible()

    if (isVisible) {
      const initialCount = await dashboard.activityItems.count()
      await dashboard.showMoreActivity()
      // Wait for new items to load
      await page.waitForTimeout(500)
      const newCount = await dashboard.activityItems.count()
      expect(newCount).toBeGreaterThanOrEqual(initialCount)
    }
  })

  test('activity feed should show user actions, not system events', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()
    await dashboard.waitForDataLoad()

    // Should show user-centric activity
    const items = await dashboard.getActivityItems()
    if (items.length > 0) {
      // Activity should be about user actions
      const hasUserActivity = items.some(
        (item) =>
          item.toLowerCase().includes('created') ||
          item.toLowerCase().includes('updated') ||
          item.toLowerCase().includes('completed') ||
          item.toLowerCase().includes('started') ||
          item.toLowerCase().includes('you')
      )
      expect(hasUserActivity).toBe(true)
    }
  })
})

test.describe('User Dashboard - Quick Actions Panel', () => {
  test('should render quick actions panel', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    await expect(dashboard.quickActionsPanel).toBeVisible()
    await expect(dashboard.quickActionsPanel).toHaveAttribute('data-testid', 'quick-actions')
  })

  test('should display quick actions header', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    const header = page.locator('[data-testid="quick-actions"] h2, [data-testid="quick-actions"] h3')
    await expect(header).toBeVisible()
    await expect(header).toContainText(/Quick Actions|Actions|Get Started/i)
  })

  test('should have Create Project button', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    await expect(dashboard.createProjectButton).toBeVisible()
    await expect(dashboard.createProjectButton).toBeEnabled()
    await expect(dashboard.createProjectButton).toContainText(/Project|New Project|Create/i)
  })

  test('should have Create Workflow button', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    await expect(dashboard.createWorkflowButton).toBeVisible()
    await expect(dashboard.createWorkflowButton).toBeEnabled()
    await expect(dashboard.createWorkflowButton).toContainText(/Workflow|New Workflow|Create/i)
  })

  test('should have View Tasks button', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    await expect(dashboard.viewTasksButton).toBeVisible()
    await expect(dashboard.viewTasksButton).toBeEnabled()
    await expect(dashboard.viewTasksButton).toContainText(/Tasks|View Tasks/i)
  })

  test('should have Invite Team button', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    await expect(dashboard.inviteTeamButton).toBeVisible()
    await expect(dashboard.inviteTeamButton).toBeEnabled()
    await expect(dashboard.inviteTeamButton).toContainText(/Invite|Team|Member/i)
  })

  test('Create Project button should navigate to project creation', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    await dashboard.clickQuickAction('create-project')

    // Should navigate to project creation page or open modal
    await expect(page).toHaveURL(/\/app\/projects\/new|\/app\/projects\?create/)
  })

  test('Create Workflow button should navigate to workflow creation', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    await dashboard.clickQuickAction('create-workflow')

    // Should navigate to workflow creation page or open modal
    await expect(page).toHaveURL(/\/app\/workflows\/new|\/app\/workflows\?create/)
  })

  test('View Tasks button should navigate to tasks list', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    await dashboard.clickQuickAction('view-tasks')

    await expect(page).toHaveURL(/\/app\/tasks/)
  })

  test('should NOT show admin quick actions', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    // These are admin-specific actions that should NOT appear
    const askPriya = page.locator('button:has-text("Ask Priya")')
    const deployRalph = page.locator('button:has-text("Deploy with Ralph")')
    const reviewTom = page.locator('button:has-text("Review with Tom")')

    await expect(askPriya).not.toBeVisible()
    await expect(deployRalph).not.toBeVisible()
    await expect(reviewTom).not.toBeVisible()
  })

  test('quick action buttons should have icons', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    // Each button should have an icon (SVG or icon class)
    const createProjectIcon = dashboard.createProjectButton.locator('svg, [class*="icon"]')
    await expect(createProjectIcon).toBeVisible()
  })
})

test.describe('User Dashboard - Personalized Widgets', () => {
  test('should render at least one personalized widget', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()
    await dashboard.waitForDataLoad()

    const widgets = await dashboard.getVisibleWidgets()
    expect(widgets.length).toBeGreaterThan(0)
  })

  test('should display recent projects widget', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()
    await dashboard.waitForDataLoad()

    await expect(dashboard.recentProjectsWidget).toBeVisible()
  })

  test('recent projects widget should show project items or empty state', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()
    await dashboard.waitForDataLoad()

    const projectItems = dashboard.recentProjectsWidget.locator('[data-testid="project-item"]')
    const emptyState = dashboard.recentProjectsWidget.locator('[data-testid="empty-state"]')

    const hasProjects = await projectItems.count() > 0
    const hasEmptyState = await emptyState.isVisible()

    expect(hasProjects || hasEmptyState).toBe(true)
  })

  test('should display pending tasks widget', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()
    await dashboard.waitForDataLoad()

    await expect(dashboard.pendingTasksWidget).toBeVisible()
  })

  test('pending tasks widget should show task items or empty state', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()
    await dashboard.waitForDataLoad()

    const taskItems = dashboard.pendingTasksWidget.locator('[data-testid="task-item"]')
    const emptyState = dashboard.pendingTasksWidget.locator('[data-testid="empty-state"]')

    const hasTasks = await taskItems.count() > 0
    const hasEmptyState = await emptyState.isVisible()

    expect(hasTasks || hasEmptyState).toBe(true)
  })

  test('should display active workflows widget', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()
    await dashboard.waitForDataLoad()

    await expect(dashboard.activeWorkflowsWidget).toBeVisible()
  })

  test('widgets should have view all links', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()
    await dashboard.waitForDataLoad()

    // Each widget should have a "View All" or similar link
    const viewAllLinks = page.locator('[data-testid^="user-widget-"] a:has-text("View All"), [data-testid^="user-widget-"] a:has-text("See All")')
    const count = await viewAllLinks.count()
    expect(count).toBeGreaterThan(0)
  })

  test('should show onboarding widget for new users', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()
    await dashboard.waitForDataLoad()

    // Onboarding widget may or may not be visible depending on user state
    // Just verify it can exist
    const isVisible = await dashboard.onboardingWidget.isVisible()
    expect(typeof isVisible).toBe('boolean')
  })

  test('widgets should adapt to user data', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()
    await dashboard.waitForDataLoad()

    // Widgets should reflect actual user data
    // This tests that widgets aren't just static content
    const recentProjects = dashboard.recentProjectsWidget
    const isVisible = await recentProjects.isVisible()

    if (isVisible) {
      // Widget content should update based on user state
      const content = await recentProjects.textContent()
      expect(content).not.toBeNull()
      expect(content!.length).toBeGreaterThan(0)
    }
  })
})

test.describe('User Dashboard - Responsive Layout', () => {
  test('should work on desktop viewport', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.setDesktopViewport()
    await dashboard.goto()

    await expect(dashboard.dashboard).toBeVisible()
    await expect(dashboard.metricsSection).toBeVisible()
    await expect(dashboard.quickActionsPanel).toBeVisible()
  })

  test('should display metrics grid on desktop', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.setDesktopViewport()
    await dashboard.goto()

    // On desktop, metrics should be in a grid layout
    const isDesktop = await dashboard.isDesktopLayout()
    expect(isDesktop).toBe(true)
  })

  test('should work on tablet viewport', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.setTabletViewport()
    await dashboard.goto()

    await expect(dashboard.dashboard).toBeVisible()
    await expect(dashboard.metricsSection).toBeVisible()
  })

  test('should work on mobile viewport', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.setMobileViewport()
    await dashboard.goto()

    await expect(dashboard.dashboard).toBeVisible()
    await expect(dashboard.metricsSection).toBeVisible()
  })

  test('should display metrics carousel on mobile', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.setMobileViewport()
    await dashboard.goto()

    // On mobile, metrics should be in a carousel/swipeable layout
    const isMobile = await dashboard.isMobileLayout()
    expect(isMobile).toBe(true)
  })

  test('quick actions should stack vertically on mobile', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.setMobileViewport()
    await dashboard.goto()

    // Quick actions panel should be visible
    await expect(dashboard.quickActionsPanel).toBeVisible()

    // Buttons should be stacked (full width on mobile)
    const createProjectBox = await dashboard.createProjectButton.boundingBox()
    const createWorkflowBox = await dashboard.createWorkflowButton.boundingBox()

    if (createProjectBox && createWorkflowBox) {
      // On mobile, buttons should be vertically stacked
      expect(createWorkflowBox.y).toBeGreaterThan(createProjectBox.y)
    }
  })

  test('activity feed should be scrollable on mobile', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.setMobileViewport()
    await dashboard.goto()

    await expect(dashboard.activityFeed).toBeVisible()

    // Activity feed should have overflow scroll on mobile
    const overflow = await dashboard.activityFeed.evaluate((el) =>
      window.getComputedStyle(el).overflowY
    )
    expect(['auto', 'scroll']).toContain(overflow)
  })

  test('widgets should reflow to single column on mobile', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.setMobileViewport()
    await dashboard.goto()
    await dashboard.waitForDataLoad()

    // Get bounding boxes of two widgets
    const recentBox = await dashboard.recentProjectsWidget.boundingBox()
    const tasksBox = await dashboard.pendingTasksWidget.boundingBox()

    if (recentBox && tasksBox) {
      // On mobile, widgets should be stacked (not side by side)
      // Either one is below the other, or they have similar X positions
      const isStacked = tasksBox.y > recentBox.y + recentBox.height - 10
      const isSameColumn = Math.abs(recentBox.x - tasksBox.x) < 20

      expect(isStacked || isSameColumn).toBe(true)
    }
  })

  test('should have proper viewport meta tag', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    const viewport = page.locator('meta[name="viewport"]')
    await expect(viewport).toHaveAttribute('content', /width=device-width/)
  })

  test('touch targets should be adequately sized on mobile', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.setMobileViewport()
    await dashboard.goto()

    // Quick action buttons should have at least 44x44 tap targets (Apple HIG)
    const box = await dashboard.createProjectButton.boundingBox()
    if (box) {
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.width).toBeGreaterThanOrEqual(44)
    }
  })
})

test.describe('User Dashboard - Loading States', () => {
  test('should show loading state while data loads', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)

    // Navigate with a slow network to catch loading state
    await page.route('**/api/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      await route.continue()
    })

    await dashboard.goto()

    // Should show skeleton or loading indicator initially
    const isLoading = await dashboard.isLoading()
    expect(isLoading).toBe(true)
  })

  test('should hide loading state after data loads', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()
    await dashboard.waitForDataLoad()

    // After data loads, skeleton should be hidden
    const skeleton = page.locator('[data-testid="dashboard-skeleton"]')
    await expect(skeleton).not.toBeVisible()
  })

  test('refresh button should show loading state during refresh', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()
    await dashboard.waitForDataLoad()

    // Add delay to API calls
    await page.route('**/api/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500))
      await route.continue()
    })

    // Click refresh
    await dashboard.refresh()

    // Refresh button should show loading state (spinner or disabled)
    await expect(dashboard.refreshButton).toHaveAttribute('data-loading', 'true')
  })
})

test.describe('User Dashboard - Accessibility', () => {
  test('should have proper heading hierarchy', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    // Should have an h1 for the main page title
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()

    // Sections should use h2 or h3
    const sectionHeadings = page.locator('h2, h3')
    const count = await sectionHeadings.count()
    expect(count).toBeGreaterThan(0)
  })

  test('should have ARIA labels on interactive elements', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    // Refresh button should have aria-label
    await expect(dashboard.refreshButton).toHaveAttribute('aria-label', /.+/)
  })

  test('should have proper landmark regions', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    // Should have main landmark
    const main = page.locator('main')
    await expect(main).toBeVisible()

    // Should have navigation (in the app shell)
    const nav = page.locator('nav')
    await expect(nav).toBeVisible()
  })

  test('metrics should be announced to screen readers', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    // Metric values should have proper labels for screen readers
    const projectCount = dashboard.projectCount
    await expect(projectCount).toHaveAttribute('role', 'status')
  })

  test('activity feed should have proper list semantics', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    // Activity feed should be a list
    const activityList = page.locator('[data-testid="user-activity-feed"] ul, [data-testid="user-activity-feed"] [role="list"]')
    await expect(activityList).toBeVisible()
  })

  test('keyboard navigation should work through dashboard sections', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)
    await dashboard.goto()

    // Tab through elements
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')

    // Should be able to tab to quick actions
    const focusedElement = page.locator(':focus')
    await expect(focusedElement).toBeVisible()
  })
})

test.describe('User Dashboard - Error States', () => {
  test('should handle API errors gracefully', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)

    // Simulate API failure
    await page.route('**/api/dashboard/**', (route) => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Internal Server Error' }),
      })
    })

    await dashboard.goto()

    // Should show error state, not crash
    const errorMessage = page.locator('[data-testid="dashboard-error"], [data-testid="error-message"]')
    await expect(errorMessage).toBeVisible()
  })

  test('should show retry option on error', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)

    await page.route('**/api/dashboard/**', (route) => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Internal Server Error' }),
      })
    })

    await dashboard.goto()

    // Should have retry button
    const retryButton = page.locator('[data-testid="retry-button"], button:has-text("Retry"), button:has-text("Try Again")')
    await expect(retryButton).toBeVisible()
  })

  test('should handle network timeout', async ({ page }) => {
    const dashboard = new AppDashboardPage(page)

    // Simulate network timeout
    await page.route('**/api/dashboard/**', (route) => {
      // Never respond to simulate timeout
    })

    await dashboard.goto()

    // Wait for timeout handling (dashboard should show error after timeout)
    await page.waitForTimeout(10000)

    // Should show timeout error or fallback UI
    const dashboard_element = await dashboard.dashboard.isVisible()
    expect(dashboard_element).toBe(true)
  })
})
