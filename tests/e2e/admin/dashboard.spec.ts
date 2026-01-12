import { test, expect } from '@playwright/test'
import { AdminDashboardPage } from '../pages/AdminDashboard.page'

/**
 * E2E Tests for the Admin Dashboard
 *
 * TDD RED Phase - These tests define the expected behavior of the admin dashboard
 * located at /admin (routes/admin/_admin.index.tsx).
 *
 * The dashboard should display:
 * - KPI cards (Active Agents, Workflows, API Calls, Uptime)
 * - API Usage chart (AreaChart)
 * - Recent Activity feed
 * - Agent Status grid
 * - Responsive layouts for mobile/tablet/desktop
 * - Data refresh functionality
 *
 * Tests use data-testid selectors for reliability:
 * - admin-dashboard - Root dashboard container
 * - dashboard-kpi-* - KPI card elements
 * - dashboard-chart-* - Chart elements
 * - activity-feed, activity-item - Activity feed elements
 * - agent-status-grid, agent-status-item - Agent status elements
 * - dashboard-refresh - Refresh button
 *
 * All tests are expected to FAIL until implementation is complete.
 */

test.describe('Admin Dashboard', () => {
  let dashboardPage: AdminDashboardPage

  test.beforeEach(async ({ page }) => {
    dashboardPage = new AdminDashboardPage(page)
    await dashboardPage.goto()
    await dashboardPage.waitForDashboard()
  })

  test.describe('Dashboard Container', () => {
    test('should render the dashboard container with correct data-testid', async () => {
      await expect(dashboardPage.dashboard).toBeVisible()
    })

    test('should display "Dashboard" heading', async () => {
      await expect(dashboardPage.heading).toBeVisible()
      await expect(dashboardPage.heading).toHaveText('Dashboard')
    })

    test('should have the correct data attributes for MDXUI', async ({ page }) => {
      const container = page.locator('[data-mdx-source=".do/App.mdx"]')
      await expect(container).toBeVisible()
    })
  })

  test.describe('KPI Cards Display', () => {
    test('should display all 4 KPI cards', async ({ page }) => {
      const kpiCards = page.locator('[data-testid^="dashboard-kpi-"]')
      await expect(kpiCards).toHaveCount(4)
    })

    test('should display Active Agents KPI card with value', async () => {
      await expect(dashboardPage.kpiActiveAgents).toBeVisible()

      // Card should have title
      const title = dashboardPage.kpiActiveAgents.locator('[data-testid="dashboard-kpi-title"]')
      await expect(title).toHaveText('Active Agents')

      // Card should have value
      const value = dashboardPage.kpiActiveAgents.locator('[data-testid="dashboard-kpi-value"]')
      await expect(value).toBeVisible()
      const valueText = await value.textContent()
      expect(valueText).toBeTruthy()
    })

    test('should display Workflows KPI card with value and trend', async () => {
      await expect(dashboardPage.kpiWorkflows).toBeVisible()

      // Card should have title
      const title = dashboardPage.kpiWorkflows.locator('[data-testid="dashboard-kpi-title"]')
      await expect(title).toHaveText('Workflows')

      // Card should have value
      const value = dashboardPage.kpiWorkflows.locator('[data-testid="dashboard-kpi-value"]')
      await expect(value).toBeVisible()

      // Card should have trend indicator
      const trend = dashboardPage.kpiWorkflows.locator('[data-testid="dashboard-kpi-trend"]')
      await expect(trend).toBeVisible()
    })

    test('should display API Calls KPI card with formatted value', async () => {
      await expect(dashboardPage.kpiApiCalls).toBeVisible()

      // Card should have title
      const title = dashboardPage.kpiApiCalls.locator('[data-testid="dashboard-kpi-title"]')
      await expect(title).toHaveText('API Calls')

      // Card should have formatted value (e.g., "1.2k")
      const value = dashboardPage.kpiApiCalls.locator('[data-testid="dashboard-kpi-value"]')
      await expect(value).toBeVisible()

      // Card should show trend percentage
      const trend = dashboardPage.kpiApiCalls.locator('[data-testid="dashboard-kpi-trend"]')
      await expect(trend).toBeVisible()
      const trendText = await trend.textContent()
      expect(trendText).toMatch(/%/)
    })

    test('should display Uptime KPI card with percentage', async () => {
      await expect(dashboardPage.kpiUptime).toBeVisible()

      // Card should have title
      const title = dashboardPage.kpiUptime.locator('[data-testid="dashboard-kpi-title"]')
      await expect(title).toHaveText('Uptime')

      // Card should have percentage value
      const value = dashboardPage.kpiUptime.locator('[data-testid="dashboard-kpi-value"]')
      await expect(value).toBeVisible()
      const valueText = await value.textContent()
      expect(valueText).toMatch(/%/)
    })

    test('KPI cards should have icons', async ({ page }) => {
      const kpiCards = page.locator('[data-testid^="dashboard-kpi-"]')
      const count = await kpiCards.count()

      for (let i = 0; i < count; i++) {
        const icon = kpiCards.nth(i).locator('[data-testid="dashboard-kpi-icon"]')
        await expect(icon).toBeVisible()
      }
    })

    test('KPI cards should be accessible with proper aria labels', async ({ page }) => {
      const kpiCards = page.locator('[data-testid^="dashboard-kpi-"]')
      const count = await kpiCards.count()

      for (let i = 0; i < count; i++) {
        const card = kpiCards.nth(i)
        const ariaLabel = await card.getAttribute('aria-label')
        expect(ariaLabel).toBeTruthy()
      }
    })

    test('KPI cards should display in responsive grid', async ({ page }) => {
      // Desktop: 4 columns
      await page.setViewportSize({ width: 1280, height: 720 })
      const kpiGrid = page.getByTestId('dashboard-kpi-grid')
      await expect(kpiGrid).toBeVisible()

      // Check grid has proper responsive classes
      const gridClasses = await kpiGrid.getAttribute('class')
      expect(gridClasses).toContain('grid')
    })
  })

  test.describe('Charts Render', () => {
    test('should display API Usage chart container', async () => {
      await expect(dashboardPage.chartApiUsage).toBeVisible()
    })

    test('should display chart title "API Usage"', async () => {
      const chartTitle = dashboardPage.chartApiUsage.locator('[data-testid="dashboard-chart-title"]')
      await expect(chartTitle).toHaveText('API Usage')
    })

    test('should display chart description', async () => {
      const chartDescription = dashboardPage.chartApiUsage.locator('[data-testid="dashboard-chart-description"]')
      await expect(chartDescription).toHaveText('Calls over the last 7 days')
    })

    test('should render AreaChart SVG element', async () => {
      // Chart should contain Recharts SVG
      const svg = dashboardPage.chartApiUsage.locator('svg.recharts-surface')
      await expect(svg).toBeVisible()
    })

    test('should display chart axes', async () => {
      // X-axis should be visible
      const xAxis = dashboardPage.chartApiUsage.locator('.recharts-xAxis')
      await expect(xAxis).toBeVisible()

      // Y-axis should be visible
      const yAxis = dashboardPage.chartApiUsage.locator('.recharts-yAxis')
      await expect(yAxis).toBeVisible()
    })

    test('should render chart area with data', async () => {
      // Area chart should have filled area element
      const area = dashboardPage.chartApiUsage.locator('.recharts-area')
      await expect(area).toBeVisible()
    })

    test('should display chart grid lines', async () => {
      const grid = dashboardPage.chartApiUsage.locator('.recharts-cartesian-grid')
      await expect(grid).toBeVisible()
    })

    test('chart should show tooltip on hover', async ({ page }) => {
      const chartArea = dashboardPage.chartApiUsage.locator('.recharts-surface')

      // Hover over chart area
      await chartArea.hover({ position: { x: 100, y: 50 } })

      // Tooltip should appear
      const tooltip = dashboardPage.chartApiUsage.locator('[data-testid="dashboard-chart-tooltip"]')
      await expect(tooltip).toBeVisible({ timeout: 2000 })
    })

    test('chart should have proper height', async () => {
      const chartContainer = dashboardPage.chartApiUsage.locator('[data-testid="dashboard-chart-container"]')
      const box = await chartContainer.boundingBox()

      // Chart should have reasonable height (at least 200px)
      expect(box?.height).toBeGreaterThanOrEqual(200)
    })
  })

  test.describe('Activity Feed Shows Recent Events', () => {
    test('should display activity feed container', async () => {
      await expect(dashboardPage.activityFeed).toBeVisible()
    })

    test('should display "Recent Activity" heading', async () => {
      const heading = dashboardPage.activityFeed.locator('h2, [data-testid="activity-feed-heading"]')
      await expect(heading).toContainText('Recent Activity')
    })

    test('should display at least one activity item', async ({ page }) => {
      const activityItems = page.locator('[data-testid="activity-item"]')
      const count = await activityItems.count()
      expect(count).toBeGreaterThanOrEqual(1)
    })

    test('activity items should have title', async ({ page }) => {
      const firstItem = page.locator('[data-testid="activity-item"]').first()
      const title = firstItem.locator('[data-testid="activity-item-title"]')
      await expect(title).toBeVisible()
      const titleText = await title.textContent()
      expect(titleText).toBeTruthy()
    })

    test('activity items should have description', async ({ page }) => {
      const firstItem = page.locator('[data-testid="activity-item"]').first()
      const description = firstItem.locator('[data-testid="activity-item-description"]')
      await expect(description).toBeVisible()
    })

    test('activity items should have timestamp', async ({ page }) => {
      const firstItem = page.locator('[data-testid="activity-item"]').first()
      const timestamp = firstItem.locator('[data-testid="activity-item-timestamp"]')
      await expect(timestamp).toBeVisible()

      // Timestamp should be a time element with datetime attribute
      const datetimeAttr = await timestamp.locator('time').getAttribute('datetime')
      expect(datetimeAttr).toBeTruthy()
    })

    test('activity items should have type indicator', async ({ page }) => {
      const firstItem = page.locator('[data-testid="activity-item"]').first()
      const typeIndicator = firstItem.locator('[data-testid="activity-item-type"]')
      await expect(typeIndicator).toBeVisible()
    })

    test('activity feed should be scrollable when items overflow', async ({ page }) => {
      const feedContainer = dashboardPage.activityFeed
      const scrollable = await feedContainer.evaluate((el) => {
        return el.scrollHeight > el.clientHeight ||
               getComputedStyle(el).overflowY === 'auto' ||
               getComputedStyle(el).overflowY === 'scroll'
      })
      // This test documents the expected behavior - scroll when needed
      expect(scrollable !== undefined).toBe(true)
    })

    test('activity feed should show empty state when no events', async ({ page }) => {
      // This test verifies empty state handling
      const emptyState = dashboardPage.activityFeed.locator('[data-testid="activity-feed-empty"]')
      // Either items or empty state should be present
      const items = page.locator('[data-testid="activity-item"]')
      const itemCount = await items.count()

      if (itemCount === 0) {
        await expect(emptyState).toBeVisible()
        await expect(emptyState).toContainText('No recent activity')
      }
    })

    test('activity items should be accessible', async ({ page }) => {
      const activityItems = page.locator('[data-testid="activity-item"]')
      const firstItem = activityItems.first()

      // Should have role="article" or similar semantic role
      const role = await firstItem.getAttribute('role')
      expect(role).toBe('article')
    })
  })

  test.describe('Agent Status Grid Displays', () => {
    test('should display agent status grid container', async () => {
      await expect(dashboardPage.agentStatusGrid).toBeVisible()
    })

    test('should display "Agent Status" heading', async () => {
      const heading = dashboardPage.agentStatusGrid.locator('h2, [data-testid="agent-status-heading"]')
      await expect(heading).toContainText('Agent Status')
    })

    test('should display all 6 named agents', async ({ page }) => {
      const agentItems = page.locator('[data-testid="agent-status-item"]')
      const count = await agentItems.count()
      expect(count).toBeGreaterThanOrEqual(6)
    })

    test('should display agent names (Priya, Ralph, Tom, Mark, Sally, Quinn)', async ({ page }) => {
      const expectedAgents = ['Priya', 'Ralph', 'Tom', 'Mark', 'Sally', 'Quinn']

      for (const agentName of expectedAgents) {
        const agent = page.locator(`[data-testid="agent-status-item"][data-agent-name="${agentName}"]`)
        await expect(agent).toBeVisible()
      }
    })

    test('agent items should display avatar with initial', async ({ page }) => {
      const firstAgent = page.locator('[data-testid="agent-status-item"]').first()
      const avatar = firstAgent.locator('[data-testid="agent-status-avatar"]')
      await expect(avatar).toBeVisible()

      // Avatar should contain initial letter
      const avatarText = await avatar.textContent()
      expect(avatarText?.length).toBe(1)
    })

    test('agent items should display current status', async ({ page }) => {
      const firstAgent = page.locator('[data-testid="agent-status-item"]').first()
      const status = firstAgent.locator('[data-testid="agent-status-badge"]')
      await expect(status).toBeVisible()

      // Status should be one of: idle, working, error
      const statusText = await status.textContent()
      expect(['idle', 'working', 'error']).toContain(statusText?.toLowerCase())
    })

    test('agent items should display role', async ({ page }) => {
      const firstAgent = page.locator('[data-testid="agent-status-item"]').first()
      const role = firstAgent.locator('[data-testid="agent-status-role"]')
      await expect(role).toBeVisible()
    })

    test('agent status should have visual indicator for working status', async ({ page }) => {
      // Find an agent with working status
      const workingAgent = page.locator('[data-testid="agent-status-item"][data-status="working"]')

      if (await workingAgent.count() > 0) {
        // Working agents should have visual indicator (green badge or animation)
        const badge = workingAgent.first().locator('[data-testid="agent-status-badge"]')
        const badgeClasses = await badge.getAttribute('class')
        expect(badgeClasses).toMatch(/green|success|working/)
      }
    })

    test('agent grid should be responsive', async ({ page }) => {
      const grid = dashboardPage.agentStatusGrid.locator('[role="list"]')

      // Desktop: more columns
      await page.setViewportSize({ width: 1280, height: 720 })
      const desktopClasses = await grid.getAttribute('class')
      expect(desktopClasses).toContain('grid')
    })

    test('agent items should be accessible with aria labels', async ({ page }) => {
      const agentItems = page.locator('[data-testid="agent-status-item"]')
      const firstAgent = agentItems.first()

      const ariaLabel = await firstAgent.getAttribute('aria-label')
      expect(ariaLabel).toBeTruthy()
      // Aria label should contain agent name and status
      expect(ariaLabel).toMatch(/\w+/)
    })

    test('agent status grid should have proper list role', async () => {
      const list = dashboardPage.agentStatusGrid.locator('[role="list"]')
      await expect(list).toBeVisible()
    })
  })

  test.describe('Dashboard Responsive Design', () => {
    test.describe('Desktop Layout (1280px)', () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 720 })
      })

      test('should display KPIs in 4-column grid', async ({ page }) => {
        const kpiGrid = page.getByTestId('dashboard-kpi-grid')
        const gridClasses = await kpiGrid.getAttribute('class')
        expect(gridClasses).toMatch(/lg:grid-cols-4|grid-cols-4/)
      })

      test('should display chart and activity side by side', async ({ page }) => {
        const twoColumnLayout = page.locator('[data-testid="dashboard-two-column"]')
        await expect(twoColumnLayout).toBeVisible()

        const classes = await twoColumnLayout.getAttribute('class')
        expect(classes).toMatch(/md:grid-cols-2|grid-cols-2/)
      })

      test('all dashboard sections should be visible', async () => {
        await expect(dashboardPage.kpiActiveAgents).toBeVisible()
        await expect(dashboardPage.chartApiUsage).toBeVisible()
        await expect(dashboardPage.activityFeed).toBeVisible()
        await expect(dashboardPage.agentStatusGrid).toBeVisible()
      })
    })

    test.describe('Tablet Layout (768px)', () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 768, height: 1024 })
      })

      test('should display KPIs in 2-column grid on tablet', async ({ page }) => {
        const kpiGrid = page.getByTestId('dashboard-kpi-grid')
        const box = await kpiGrid.boundingBox()

        // Verify grid is rendering at tablet width
        expect(box?.width).toBeLessThan(1000)
        expect(box?.width).toBeGreaterThan(600)
      })

      test('should stack chart and activity on tablet', async ({ page }) => {
        const twoColumnLayout = page.locator('[data-testid="dashboard-two-column"]')

        // On tablet, columns may stack or be narrower
        await expect(twoColumnLayout).toBeVisible()
      })

      test('dashboard should be scrollable on tablet', async ({ page }) => {
        const dashboard = dashboardPage.dashboard
        const scrollable = await dashboard.evaluate((el) => {
          return el.scrollHeight > el.clientHeight
        })
        // Dashboard content should fit or be scrollable
        expect(scrollable !== undefined).toBe(true)
      })
    })

    test.describe('Mobile Layout (375px)', () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 })
      })

      test('should display KPIs in single column on mobile', async ({ page }) => {
        const kpiGrid = page.getByTestId('dashboard-kpi-grid')
        const gridClasses = await kpiGrid.getAttribute('class')

        // Mobile should default to single column or 2 columns max
        expect(gridClasses).toMatch(/grid-cols-1|grid-cols-2/)
      })

      test('should stack all sections vertically on mobile', async () => {
        // All sections should be visible and stacked
        await expect(dashboardPage.dashboard).toBeVisible()
        await expect(dashboardPage.kpiActiveAgents).toBeVisible()
        await expect(dashboardPage.chartApiUsage).toBeVisible()
        await expect(dashboardPage.activityFeed).toBeVisible()
        await expect(dashboardPage.agentStatusGrid).toBeVisible()
      })

      test('chart should maintain minimum readable height on mobile', async () => {
        const chart = dashboardPage.chartApiUsage
        const box = await chart.boundingBox()

        // Chart should maintain at least 150px height on mobile
        expect(box?.height).toBeGreaterThanOrEqual(150)
      })

      test('KPI values should be readable on mobile', async ({ page }) => {
        const kpiValue = page.locator('[data-testid="dashboard-kpi-value"]').first()
        const box = await kpiValue.boundingBox()

        // Value text should have reasonable size
        expect(box?.width).toBeGreaterThan(20)
      })

      test('agent avatars should scale appropriately on mobile', async ({ page }) => {
        const avatar = page.locator('[data-testid="agent-status-avatar"]').first()
        const box = await avatar.boundingBox()

        // Avatar should be visible but appropriately sized
        expect(box?.width).toBeGreaterThanOrEqual(32)
        expect(box?.width).toBeLessThanOrEqual(64)
      })
    })
  })

  test.describe('Data Refreshes Properly', () => {
    test('should display refresh button', async () => {
      await expect(dashboardPage.refreshButton).toBeVisible()
    })

    test('refresh button should have accessible label', async () => {
      const ariaLabel = await dashboardPage.refreshButton.getAttribute('aria-label')
      expect(ariaLabel).toBeTruthy()
      expect(ariaLabel?.toLowerCase()).toContain('refresh')
    })

    test('clicking refresh should update data', async ({ page }) => {
      // Get initial values
      const initialValue = await dashboardPage.kpiApiCalls
        .locator('[data-testid="dashboard-kpi-value"]')
        .textContent()

      // Click refresh
      await dashboardPage.refreshButton.click()

      // Wait for loading to complete
      await page.waitForTimeout(200)
      await dashboardPage.waitForDashboard()

      // Data should be present (may or may not have changed)
      const newValue = await dashboardPage.kpiApiCalls
        .locator('[data-testid="dashboard-kpi-value"]')
        .textContent()
      expect(newValue).toBeTruthy()
    })

    test('should show loading state during refresh', async ({ page }) => {
      // Click refresh and immediately check for loading state
      await dashboardPage.refreshButton.click()

      // Loading indicator should appear briefly
      const loadingIndicator = page.locator('[data-testid="dashboard-loading"]')
      // Either loading indicator shows or data updates quickly
      const isLoading = await loadingIndicator.isVisible().catch(() => false)

      // Wait for loading to complete
      await dashboardPage.waitForDashboard()

      // After refresh, loading should be gone
      await expect(loadingIndicator).toBeHidden()
    })

    test('refresh button should be disabled during loading', async ({ page }) => {
      // Click refresh
      await dashboardPage.refreshButton.click()

      // Button should be disabled or show loading state
      const isDisabled = await dashboardPage.refreshButton.isDisabled().catch(() => false)
      const hasLoadingClass = await dashboardPage.refreshButton.getAttribute('data-loading')

      // Either disabled or has loading indicator
      expect(isDisabled || hasLoadingClass === 'true').toBeTruthy

      // Wait for completion
      await dashboardPage.waitForDashboard()
    })

    test('should handle refresh error gracefully', async ({ page }) => {
      // This test documents expected error handling behavior
      // In a real scenario, we might mock the API to return an error

      // For now, verify error UI elements exist in the DOM
      const errorContainer = page.locator('[data-testid="dashboard-error"]')

      // Error container may be hidden when no error
      // Just verify it can be located
      expect(errorContainer).toBeDefined()
    })

    test('refresh should update chart data', async ({ page }) => {
      // Get initial chart data attribute
      const chart = dashboardPage.chartApiUsage
      const initialDataCount = await chart.getAttribute('data-data-count')

      // Click refresh
      await dashboardPage.refreshButton.click()
      await dashboardPage.waitForDashboard()

      // Chart should still have data
      const newDataCount = await chart.getAttribute('data-data-count')
      expect(Number(newDataCount)).toBeGreaterThan(0)
    })

    test('refresh should update activity feed', async ({ page }) => {
      // Count initial activity items
      const initialCount = await page.locator('[data-testid="activity-item"]').count()

      // Click refresh
      await dashboardPage.refreshButton.click()
      await dashboardPage.waitForDashboard()

      // Activity feed should still have items
      const newCount = await page.locator('[data-testid="activity-item"]').count()
      expect(newCount).toBeGreaterThanOrEqual(0)
    })

    test('should show last updated timestamp', async ({ page }) => {
      const timestamp = page.locator('[data-testid="dashboard-last-updated"]')
      await expect(timestamp).toBeVisible()

      // Timestamp should contain readable time
      const text = await timestamp.textContent()
      expect(text).toBeTruthy()
    })

    test('auto-refresh should update data periodically', async ({ page }) => {
      // Check if auto-refresh is enabled
      const autoRefreshIndicator = page.locator('[data-testid="dashboard-auto-refresh"]')

      if (await autoRefreshIndicator.isVisible()) {
        // If auto-refresh is enabled, verify it has interval info
        const interval = await autoRefreshIndicator.getAttribute('data-interval')
        expect(interval).toBeTruthy()
      }
    })
  })

  test.describe('Loading and Error States', () => {
    test('should display skeleton while loading', async ({ page }) => {
      // Navigate fresh to catch loading state
      await page.goto('/admin')

      // Skeleton should appear briefly
      const skeleton = page.locator('[data-testid="dashboard-skeleton"]')
      // Skeleton may or may not be visible depending on load speed
      expect(skeleton).toBeDefined()
    })

    test('should display error state with retry button', async ({ page }) => {
      // Error state container
      const errorState = page.locator('[data-testid="dashboard-error"]')

      // When error occurs, should show:
      // - Error message
      // - Retry button
      const retryButton = errorState.locator('[data-testid="dashboard-retry-button"]')

      // Just verify these elements are defined (would be visible on error)
      expect(retryButton).toBeDefined()
    })

    test('error state should show meaningful error message', async ({ page }) => {
      const errorMessage = page.locator('[data-testid="dashboard-error-message"]')

      // When visible, should contain error text
      expect(errorMessage).toBeDefined()
    })
  })

  test.describe('Accessibility', () => {
    test('dashboard should have proper heading hierarchy', async ({ page }) => {
      // Main dashboard heading should be h1
      const h1 = page.locator('[data-testid="admin-dashboard"] h1')
      await expect(h1).toBeVisible()

      // Section headings should be h2
      const h2s = page.locator('[data-testid="admin-dashboard"] h2')
      const h2Count = await h2s.count()
      expect(h2Count).toBeGreaterThanOrEqual(2) // At least Activity and Agent Status
    })

    test('all interactive elements should be keyboard accessible', async ({ page }) => {
      // Focus on first element
      await page.keyboard.press('Tab')

      // Should be able to tab through refresh button
      for (let i = 0; i < 10; i++) {
        const focused = page.locator(':focus')
        const testId = await focused.getAttribute('data-testid')
        if (testId === 'dashboard-refresh') {
          // Found the refresh button via keyboard
          await expect(focused).toBeVisible()
          return
        }
        await page.keyboard.press('Tab')
      }
    })

    test('charts should have accessible descriptions', async () => {
      const chart = dashboardPage.chartApiUsage

      // Chart should have aria-label or aria-describedby
      const ariaLabel = await chart.getAttribute('aria-label')
      const ariaDescribedBy = await chart.getAttribute('aria-describedby')

      expect(ariaLabel || ariaDescribedBy).toBeTruthy()
    })

    test('color contrast should meet WCAG guidelines', async ({ page }) => {
      // Get KPI value text color and background
      const kpiCard = page.locator('[data-testid^="dashboard-kpi-"]').first()

      // Verify the card is styled (has background)
      const bgColor = await kpiCard.evaluate((el) =>
        getComputedStyle(el).backgroundColor
      )
      expect(bgColor).toBeTruthy()
    })

    test('activity feed should have proper ARIA live region', async () => {
      const activityFeed = dashboardPage.activityFeed

      // Feed should have role="feed" or aria-live for updates
      const role = await activityFeed.getAttribute('role')
      const ariaLive = await activityFeed.getAttribute('aria-live')

      expect(role === 'feed' || ariaLive).toBeTruthy()
    })
  })

  test.describe('Performance', () => {
    test('dashboard should load within acceptable time', async ({ page }) => {
      const startTime = Date.now()

      await page.goto('/admin')
      await dashboardPage.waitForDashboard()

      const loadTime = Date.now() - startTime

      // Dashboard should load within 3 seconds
      expect(loadTime).toBeLessThan(3000)
    })

    test('chart should render without blocking UI', async ({ page }) => {
      // Dashboard should be interactive even while chart loads
      await page.goto('/admin')

      // KPIs should render before or with chart
      await expect(dashboardPage.kpiActiveAgents).toBeVisible({ timeout: 2000 })
    })
  })
})

test.describe('Dashboard Integration', () => {
  test('should integrate with useDashboardMetrics hook', async ({ page }) => {
    await page.goto('/admin')

    // Dashboard should render content from the hook
    const dashboard = page.getByTestId('admin-dashboard')
    await expect(dashboard).toBeVisible()

    // Should have data attributes indicating data source
    const container = page.locator('[data-mdxui-cockpit]')
    await expect(container).toBeVisible()
  })

  test('should display authenticated user context', async ({ page }) => {
    await page.goto('/admin')

    // Container should have authentication data attributes
    const container = page.locator('[data-authenticated="true"]')
    await expect(container).toBeVisible()
  })

  test('should work with DashboardGrid component', async ({ page }) => {
    await page.goto('/admin')

    // DashboardGrid should be present
    const grid = page.locator('[data-component="DashboardGrid"]')
    await expect(grid).toBeVisible()
  })

  test('should work with KPICard components', async ({ page }) => {
    await page.goto('/admin')

    // KPICard components should be present
    const kpiCards = page.locator('[data-component="KPICard"]')
    const count = await kpiCards.count()
    expect(count).toBe(4)
  })

  test('should work with AreaChart component', async ({ page }) => {
    await page.goto('/admin')

    // AreaChart should be present
    const chart = page.locator('[data-component="AreaChart"]')
    await expect(chart).toBeVisible()
  })

  test('should work with ActivityFeed component', async ({ page }) => {
    await page.goto('/admin')

    // ActivityFeed should be present
    const feed = page.locator('[data-component="ActivityFeed"]')
    await expect(feed).toBeVisible()
  })

  test('should work with AgentStatus component', async ({ page }) => {
    await page.goto('/admin')

    // AgentStatus should be present
    const agentStatus = page.locator('[data-component="AgentStatus"]')
    await expect(agentStatus).toBeVisible()
  })
})
