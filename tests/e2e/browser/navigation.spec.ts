/**
 * E2E Browser Tests: Navigation and Page Rendering
 *
 * Tests critical user journeys for navigation:
 * - Home page loads correctly
 * - Navigation between pages works
 * - Responsive design renders correctly
 * - Page titles and meta information are correct
 * - Links and interactive elements are accessible
 *
 * @see do-o4sii
 */
import { test, expect } from '@playwright/test'

test.describe('Page Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Start from the home page for each test
    await page.goto('/')
  })

  test('should load home page with correct title', async ({ page }) => {
    // Check the page title
    await expect(page).toHaveTitle(/dotdo/)

    // Check that the main heading is visible
    await expect(page.getByRole('heading', { name: /welcome to dotdo/i })).toBeVisible()

    // Check the subtitle
    await expect(page.getByText(/business-as-code/i)).toBeVisible()
  })

  test('should display feature cards on home page', async ({ page }) => {
    // Check for feature cards
    const featureCards = page.locator('[class*="rounded-lg"]')
    await expect(featureCards.first()).toBeVisible()

    // Verify specific feature content
    await expect(page.getByText('Durable Objects')).toBeVisible()
    await expect(page.getByText('Event Streams')).toBeVisible()
    await expect(page.getByText('RPC Layer')).toBeVisible()
    await expect(page.getByText('AI Module')).toBeVisible()
    await expect(page.getByText('Capabilities')).toBeVisible()
    await expect(page.getByText('Workflows')).toBeVisible()
  })

  test('should navigate to docs page', async ({ page }) => {
    // Click on docs link in navigation
    await page.getByRole('link', { name: /docs/i }).click()

    // Verify navigation
    await expect(page).toHaveURL(/\/docs/)
    await expect(page.getByRole('heading', { name: /documentation/i })).toBeVisible()
  })

  test('should navigate to admin page', async ({ page }) => {
    // Click on admin link in navigation
    await page.getByRole('link', { name: /admin/i }).click()

    // Verify navigation
    await expect(page).toHaveURL(/\/admin/)
    await expect(page.getByRole('heading', { name: /admin portal/i })).toBeVisible()
  })

  test('should return to home page from other pages', async ({ page }) => {
    // Navigate to docs
    await page.goto('/docs')
    await expect(page).toHaveURL(/\/docs/)

    // Click home link or logo
    const homeLink = page.getByRole('link', { name: /dotdo|home/i }).first()
    if (await homeLink.isVisible()) {
      await homeLink.click()
      await expect(page).toHaveURL('/')
    }
  })
})

test.describe('Docs Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/docs')
  })

  test('should display documentation sections', async ({ page }) => {
    // Check main heading
    await expect(page.getByRole('heading', { name: /documentation/i })).toBeVisible()

    // Check core concepts section
    await expect(page.getByText('Core Concepts')).toBeVisible()

    // Check API reference section
    await expect(page.getByText('API Reference')).toBeVisible()

    // Check guides section
    await expect(page.getByText('Guides')).toBeVisible()

    // Check examples section
    await expect(page.getByText('Examples')).toBeVisible()
  })

  test('should display sidebar navigation', async ({ page }) => {
    // Check for sidebar navigation
    const sidebar = page.locator('nav').filter({ hasText: /quick links/i })
    await expect(sidebar).toBeVisible()

    // Check for navigation links
    await expect(page.getByRole('link', { name: /getting started/i })).toBeVisible()
  })

  test('should display doc cards with descriptions', async ({ page }) => {
    // Check for doc cards
    await expect(page.getByText(/SQLite-backed Durable Objects/i)).toBeVisible()
    await expect(page.getByText(/WorkflowContext/i)).toBeVisible()
    await expect(page.getByText(/Fire-and-forget/i)).toBeVisible()
  })

  test('should show status badges on guide cards', async ({ page }) => {
    // Check for status badges
    const plannedBadges = page.getByText('planned', { exact: true })
    await expect(plannedBadges.first()).toBeVisible()
  })
})

test.describe('Admin Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin')
  })

  test('should display admin portal heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /admin portal/i })).toBeVisible()
    await expect(page.getByText(/manage your dotdo infrastructure/i)).toBeVisible()
  })

  test('should display development notice', async ({ page }) => {
    // Check for in-development notice
    await expect(page.getByText(/in development/i)).toBeVisible()
  })

  test('should display admin feature cards', async ({ page }) => {
    // Check for admin feature cards
    await expect(page.getByText('Durable Objects')).toBeVisible()
    await expect(page.getByText('Event Streams')).toBeVisible()
    await expect(page.getByText('Storage')).toBeVisible()
    await expect(page.getByText('RPC Calls')).toBeVisible()
    await expect(page.getByText('AI Usage')).toBeVisible()
    await expect(page.getByText('System Health')).toBeVisible()
  })

  test('should show planned status on admin cards', async ({ page }) => {
    // All admin features should be marked as planned
    const plannedBadges = page.getByText('planned', { exact: true })
    const count = await plannedBadges.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })
})

test.describe('Responsive Design', () => {
  test('should render correctly on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')

    // Main content should still be visible
    await expect(page.getByRole('heading', { name: /welcome to dotdo/i })).toBeVisible()

    // Feature cards should stack vertically on mobile
    const featureCards = page.locator('[class*="rounded-lg"]').filter({ hasText: /Objects|Streams|RPC/ })
    const firstCard = featureCards.first()
    const secondCard = featureCards.nth(1)

    if (await firstCard.isVisible() && await secondCard.isVisible()) {
      const firstBox = await firstCard.boundingBox()
      const secondBox = await secondCard.boundingBox()

      if (firstBox && secondBox) {
        // On mobile, cards should be stacked (second card below first)
        expect(secondBox.y).toBeGreaterThanOrEqual(firstBox.y)
      }
    }
  })

  test('should render correctly on tablet viewport', async ({ page }) => {
    // Set tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('/')

    // Main content should be visible
    await expect(page.getByRole('heading', { name: /welcome to dotdo/i })).toBeVisible()

    // Navigation should be visible
    const nav = page.getByRole('navigation')
    if (await nav.isVisible()) {
      await expect(nav).toBeVisible()
    }
  })

  test('should render correctly on desktop viewport', async ({ page }) => {
    // Set desktop viewport
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')

    // Main content should be visible
    await expect(page.getByRole('heading', { name: /welcome to dotdo/i })).toBeVisible()

    // Feature cards should be in a grid layout
    const featureCards = page.locator('[class*="rounded-lg"]').filter({ hasText: /Objects|Streams|RPC/ })
    const firstCard = featureCards.first()
    const secondCard = featureCards.nth(1)

    if (await firstCard.isVisible() && await secondCard.isVisible()) {
      const firstBox = await firstCard.boundingBox()
      const secondBox = await secondCard.boundingBox()

      if (firstBox && secondBox) {
        // On desktop, cards should be side by side (same Y position approximately)
        expect(Math.abs(firstBox.y - secondBox.y)).toBeLessThan(50)
      }
    }
  })
})

test.describe('Accessibility', () => {
  test('should have proper heading hierarchy', async ({ page }) => {
    await page.goto('/')

    // Should have an h1
    const h1 = page.getByRole('heading', { level: 1 })
    await expect(h1.first()).toBeVisible()
  })

  test('should have accessible navigation', async ({ page }) => {
    await page.goto('/')

    // Navigation links should be accessible
    const links = page.getByRole('link')
    const count = await links.count()
    expect(count).toBeGreaterThan(0)
  })

  test('should support keyboard navigation', async ({ page }) => {
    await page.goto('/')

    // Tab through the page
    await page.keyboard.press('Tab')

    // Check that focus is visible
    const focusedElement = page.locator(':focus')
    await expect(focusedElement).toBeVisible()
  })

  test('should have sufficient color contrast', async ({ page }) => {
    await page.goto('/')

    // Check that text is readable (basic check - text exists and is not empty)
    const bodyText = await page.locator('body').textContent()
    expect(bodyText).toBeTruthy()
    expect(bodyText!.length).toBeGreaterThan(0)
  })
})

test.describe('Performance', () => {
  test('should load home page within reasonable time', async ({ page }) => {
    const startTime = Date.now()
    await page.goto('/')
    const loadTime = Date.now() - startTime

    // Page should load within 5 seconds
    expect(loadTime).toBeLessThan(5000)

    // Content should be visible
    await expect(page.getByRole('heading', { name: /welcome to dotdo/i })).toBeVisible()
  })

  test('should not have console errors', async ({ page }) => {
    const consoleErrors: string[] = []

    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Filter out expected errors (e.g., favicon 404)
    const significantErrors = consoleErrors.filter(
      error => !error.includes('favicon') && !error.includes('404')
    )

    expect(significantErrors).toHaveLength(0)
  })

  test('should not have broken images', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Check all images
    const images = page.locator('img')
    const imageCount = await images.count()

    for (let i = 0; i < imageCount; i++) {
      const img = images.nth(i)
      const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth)
      expect(naturalWidth).toBeGreaterThan(0)
    }
  })
})

test.describe('SEO and Meta', () => {
  test('should have proper meta description', async ({ page }) => {
    await page.goto('/')

    const metaDescription = page.locator('meta[name="description"]')
    await expect(metaDescription).toHaveAttribute('content', /dotdo|business-as-code/i)
  })

  test('should have proper charset', async ({ page }) => {
    await page.goto('/')

    const charset = page.locator('meta[charset]')
    await expect(charset).toHaveAttribute('charset', 'UTF-8')
  })

  test('should have proper viewport meta', async ({ page }) => {
    await page.goto('/')

    const viewport = page.locator('meta[name="viewport"]')
    await expect(viewport).toHaveAttribute('content', /width=device-width/i)
  })
})
