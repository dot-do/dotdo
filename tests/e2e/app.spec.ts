import { test, expect } from '@playwright/test'

/**
 * E2E tests for the main app loading
 *
 * These tests verify that the app loads correctly at the root URL
 * and returns expected status codes and content.
 */

test.describe('App Loading', () => {
  test('should load the app at root URL', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)
  })

  test('should have a valid HTML document structure', async ({ page }) => {
    await page.goto('/')

    // Verify basic HTML structure exists
    const html = await page.locator('html')
    await expect(html).toBeVisible()

    const body = await page.locator('body')
    await expect(body).toBeVisible()
  })

  test('should have a page title', async ({ page }) => {
    await page.goto('/')

    // Expect the page to have a title (not empty)
    const title = await page.title()
    expect(title).toBeTruthy()
    expect(title.length).toBeGreaterThan(0)
  })

  test('should not have any console errors on load', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    await page.goto('/')

    // Wait a moment for any async console errors
    await page.waitForTimeout(500)

    expect(errors).toHaveLength(0)
  })

  test('should have valid viewport meta tag for responsive design', async ({ page }) => {
    await page.goto('/')

    const viewport = await page.locator('meta[name="viewport"]')
    await expect(viewport).toHaveAttribute('content', /width=device-width/)
  })
})
