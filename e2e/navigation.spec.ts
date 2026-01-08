import { test, expect } from '@playwright/test'

/**
 * E2E tests for basic navigation
 *
 * These tests verify that navigation between pages works correctly
 * and that the routing system is functioning as expected.
 */

test.describe('Basic Navigation', () => {
  test('should navigate from root to root without errors', async ({ page }) => {
    await page.goto('/')

    // Clicking on home link should stay on home
    const homeLink = page.locator('a[href="/"]').first()
    if (await homeLink.isVisible()) {
      await homeLink.click()
      await expect(page).toHaveURL('/')
    }
  })

  test('should handle browser back navigation', async ({ page }) => {
    await page.goto('/')
    const initialUrl = page.url()

    // Navigate somewhere else if possible, then back
    await page.goto('/api/health')
    await page.goBack()

    expect(page.url()).toBe(initialUrl)
  })

  test('should handle browser forward navigation', async ({ page }) => {
    await page.goto('/')
    await page.goto('/api/health')
    const secondUrl = page.url()

    await page.goBack()
    await page.goForward()

    expect(page.url()).toBe(secondUrl)
  })

  test('should handle refresh on root page', async ({ page }) => {
    await page.goto('/')
    const initialUrl = page.url()

    await page.reload()

    expect(page.url()).toBe(initialUrl)
  })
})

test.describe('Route Handling', () => {
  test('should return 200 for known routes', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)
  })

  test('should handle 404 pages gracefully', async ({ page }) => {
    const response = await page.goto('/nonexistent-page-xyz123')

    // Should either show 404 or redirect to a valid page
    // (depends on SPA configuration)
    expect(response?.status()).toBeLessThan(500)
  })

  test('should not show raw error stack traces to users', async ({ page }) => {
    await page.goto('/nonexistent-page-xyz123')

    // The page should not contain raw error stack traces
    const bodyText = await page.textContent('body')
    expect(bodyText).not.toContain('at Object.<anonymous>')
    expect(bodyText).not.toContain('node_modules')
    expect(bodyText).not.toContain('Error: Cannot find module')
  })
})

test.describe('Deep Linking', () => {
  test('should load directly to /api/health', async ({ page }) => {
    const response = await page.goto('/api/health')
    expect(response?.status()).toBe(200)
  })

  test('should preserve query parameters on navigation', async ({ page }) => {
    await page.goto('/?test=value&foo=bar')

    const url = new URL(page.url())
    expect(url.searchParams.get('test')).toBe('value')
    expect(url.searchParams.get('foo')).toBe('bar')
  })

  test('should handle hash fragments', async ({ page }) => {
    await page.goto('/#section')

    const url = new URL(page.url())
    expect(url.hash).toBe('#section')
  })
})

test.describe('Link Behavior', () => {
  test('should have accessible links', async ({ page }) => {
    await page.goto('/')

    // All links should have href attributes
    const links = page.locator('a[href]')
    const count = await links.count()

    for (let i = 0; i < count; i++) {
      const link = links.nth(i)
      const href = await link.getAttribute('href')
      expect(href).toBeTruthy()
    }
  })

  test('should not have broken internal links', async ({ page }) => {
    await page.goto('/')

    // Get all internal links
    const internalLinks = page.locator('a[href^="/"]')
    const count = await internalLinks.count()

    // Test first 5 internal links to avoid long test times
    const linksToTest = Math.min(count, 5)

    for (let i = 0; i < linksToTest; i++) {
      const link = internalLinks.nth(i)
      const href = await link.getAttribute('href')

      if (href) {
        const response = await page.goto(href)
        expect(response?.status()).toBeLessThan(500)
        await page.goto('/') // Go back to home for next iteration
      }
    }
  })
})
