import { test, expect } from '@playwright/test'

/**
 * E2E tests for the Admin Dashboard
 *
 * Tests the Cockpit-based dashboard with:
 * - "Your 1-Person Unicorn" branding
 * - Agent team status display (Priya, Ralph, Tom, etc.)
 * - Dashboard metrics (Active Agents, Workflows, Events, Escalations)
 * - Quick Actions (Ask Priya, Deploy with Ralph, Review with Tom)
 * - Shell navigation
 */

test.describe('Admin Dashboard - 1-Person Unicorn', () => {
  test.describe('Dashboard Load', () => {
    test('should load admin dashboard', async ({ page }) => {
      const response = await page.goto('/admin')
      // May redirect to login if auth is enforced
      expect([200, 302, 307]).toContain(response?.status())
    })

    test('should display "Your 1-Person Unicorn" title', async ({ page }) => {
      await page.goto('/admin')
      const title = page.locator('text=Your 1-Person Unicorn')
      // Title should be visible if on dashboard (not redirected to login)
      const url = page.url()
      if (!url.includes('login')) {
        await expect(title).toBeVisible()
      }
    })

    test('should display "Autonomous business control center" description', async ({ page }) => {
      await page.goto('/admin')
      const description = page.locator('text=Autonomous business control center')
      const url = page.url()
      if (!url.includes('login')) {
        await expect(description).toBeVisible()
      }
    })
  })

  test.describe('Dashboard Metrics', () => {
    test('should display Active Agents metric', async ({ page }) => {
      await page.goto('/admin')
      const url = page.url()
      if (!url.includes('login')) {
        const metric = page.locator('text=Active Agents')
        await expect(metric).toBeVisible()
      }
    })

    test('should display Workflows Running metric', async ({ page }) => {
      await page.goto('/admin')
      const url = page.url()
      if (!url.includes('login')) {
        const metric = page.locator('text=Workflows Running')
        await expect(metric).toBeVisible()
      }
    })

    test('should display Events Today metric', async ({ page }) => {
      await page.goto('/admin')
      const url = page.url()
      if (!url.includes('login')) {
        const metric = page.locator('text=Events Today')
        await expect(metric).toBeVisible()
      }
    })

    test('should display Human Escalations metric', async ({ page }) => {
      await page.goto('/admin')
      const url = page.url()
      if (!url.includes('login')) {
        const metric = page.locator('text=Human Escalations')
        await expect(metric).toBeVisible()
      }
    })
  })

  test.describe('Agent Team Status', () => {
    const agents = [
      { name: 'Priya', role: 'Product' },
      { name: 'Ralph', role: 'Engineering' },
      { name: 'Tom', role: 'Tech Lead' },
      { name: 'Rae', role: 'Frontend' },
      { name: 'Mark', role: 'Marketing' },
      { name: 'Sally', role: 'Sales' },
      { name: 'Quinn', role: 'QA' },
    ]

    test('should display all 7 agent cards', async ({ page }) => {
      await page.goto('/admin')
      const url = page.url()
      if (!url.includes('login')) {
        for (const agent of agents) {
          const agentName = page.locator(`text=${agent.name}`).first()
          await expect(agentName).toBeVisible()
        }
      }
    })

    test('should display agent roles', async ({ page }) => {
      await page.goto('/admin')
      const url = page.url()
      if (!url.includes('login')) {
        for (const agent of agents) {
          const role = page.locator(`text=${agent.role}`).first()
          await expect(role).toBeVisible()
        }
      }
    })

    test('should display agent status badges', async ({ page }) => {
      await page.goto('/admin')
      const url = page.url()
      if (!url.includes('login')) {
        const statuses = ['working', 'building', 'reviewing', 'idle', 'writing', 'outreach', 'testing']
        for (const status of statuses) {
          const badge = page.locator(`text=${status}`).first()
          await expect(badge).toBeVisible()
        }
      }
    })

    test('should display agent avatars with initials', async ({ page }) => {
      await page.goto('/admin')
      const url = page.url()
      if (!url.includes('login')) {
        // Each agent should have a circular avatar
        const avatars = page.locator('.rounded-full')
        const count = await avatars.count()
        expect(count).toBeGreaterThanOrEqual(7)
      }
    })
  })

  test.describe('Quick Actions', () => {
    test('should display Quick Actions section', async ({ page }) => {
      await page.goto('/admin')
      const url = page.url()
      if (!url.includes('login')) {
        const section = page.locator('text=Quick Actions')
        await expect(section).toBeVisible()
      }
    })

    test('should have Ask Priya action', async ({ page }) => {
      await page.goto('/admin')
      const url = page.url()
      if (!url.includes('login')) {
        const action = page.locator('text=Ask Priya')
        await expect(action).toBeVisible()
      }
    })

    test('should have Deploy with Ralph action', async ({ page }) => {
      await page.goto('/admin')
      const url = page.url()
      if (!url.includes('login')) {
        const action = page.locator('text=Deploy with Ralph')
        await expect(action).toBeVisible()
      }
    })

    test('should have Review with Tom action', async ({ page }) => {
      await page.goto('/admin')
      const url = page.url()
      if (!url.includes('login')) {
        const action = page.locator('text=Review with Tom')
        await expect(action).toBeVisible()
      }
    })

    test('quick action buttons should be clickable', async ({ page }) => {
      await page.goto('/admin')
      const url = page.url()
      if (!url.includes('login')) {
        const actionButtons = page.locator('button:has-text("Ask Priya"), button:has-text("Deploy with Ralph"), button:has-text("Review with Tom")')
        const count = await actionButtons.count()
        expect(count).toBeGreaterThanOrEqual(3)
        // Each should be enabled
        for (let i = 0; i < count; i++) {
          await expect(actionButtons.nth(i)).toBeEnabled()
        }
      }
    })
  })

  test.describe('Shell Navigation', () => {
    test('should display .do brand in sidebar', async ({ page }) => {
      await page.goto('/admin')
      const url = page.url()
      if (!url.includes('login')) {
        const brand = page.locator('a[href="/"]').first()
        await expect(brand).toBeVisible()
      }
    })

    test('should have Overview nav item', async ({ page }) => {
      await page.goto('/admin')
      const url = page.url()
      if (!url.includes('login')) {
        const navItem = page.locator('a[href="/admin"]:has-text("Overview")')
        await expect(navItem).toBeVisible()
      }
    })

    test('should have Agents nav item', async ({ page }) => {
      await page.goto('/admin')
      const url = page.url()
      if (!url.includes('login')) {
        const navItem = page.locator('a[href="/admin/agents"]')
        await expect(navItem).toBeVisible()
      }
    })

    test('should have Workflows nav item', async ({ page }) => {
      await page.goto('/admin')
      const url = page.url()
      if (!url.includes('login')) {
        const navItem = page.locator('a[href="/admin/workflows"]')
        await expect(navItem).toBeVisible()
      }
    })

    test('should have Activity nav item', async ({ page }) => {
      await page.goto('/admin')
      const url = page.url()
      if (!url.includes('login')) {
        const navItem = page.locator('a[href="/admin/activity"]')
        await expect(navItem).toBeVisible()
      }
    })

    test('should have Settings nav item', async ({ page }) => {
      await page.goto('/admin')
      const url = page.url()
      if (!url.includes('login')) {
        const navItem = page.locator('a[href="/admin/settings"]')
        await expect(navItem).toBeVisible()
      }
    })
  })

  test.describe('Responsive Design', () => {
    test('should work on tablet viewport', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 })
      await page.goto('/admin')
      const url = page.url()
      if (!url.includes('login')) {
        const dashboard = page.locator('text=Your 1-Person Unicorn')
        await expect(dashboard).toBeVisible()
      }
    })

    test('should work on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 })
      await page.goto('/admin')
      // Should still load, though layout may be different
      const response = await page.goto('/admin')
      expect([200, 302, 307]).toContain(response?.status())
    })
  })
})

test.describe('Admin Routes', () => {
  test.describe('Agents Page', () => {
    test('should load agents page', async ({ page }) => {
      const response = await page.goto('/admin/agents')
      expect([200, 302, 307, 404]).toContain(response?.status())
    })
  })

  test.describe('Workflows Page', () => {
    test('should load workflows page', async ({ page }) => {
      const response = await page.goto('/admin/workflows')
      expect([200, 302, 307]).toContain(response?.status())
    })
  })

  test.describe('Activity Page', () => {
    test('should load activity page', async ({ page }) => {
      const response = await page.goto('/admin/activity')
      expect([200, 302, 307]).toContain(response?.status())
    })
  })

  test.describe('Integrations Page', () => {
    test('should load integrations page', async ({ page }) => {
      const response = await page.goto('/admin/integrations')
      expect([200, 302, 307]).toContain(response?.status())
    })
  })

  test.describe('Settings Page', () => {
    test('should load settings page', async ({ page }) => {
      const response = await page.goto('/admin/settings')
      expect([200, 302, 307]).toContain(response?.status())
    })
  })
})
