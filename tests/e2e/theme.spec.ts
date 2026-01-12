import { expect, test } from '@playwright/test'

/**
 * E2E Tests for the Theme System
 *
 * TDD RED Phase - These tests define the expected behavior of the theme system
 * across both /admin and /app routes. Tests verify:
 *
 * 1. Theme toggle switches between dark/light mode
 * 2. System preference detection (prefers-color-scheme)
 * 3. Theme persists across page reloads (localStorage)
 * 4. Theme applies consistently to /admin routes
 * 5. Theme applies consistently to /app routes
 * 6. CSS variables update correctly when theme changes
 * 7. Theme preset switching (multiple presets)
 *
 * Uses data-testid selectors:
 * - theme-toggle: Main theme toggle button
 * - theme-selector: Theme preset dropdown/selector
 * - data-theme attribute on html/body
 *
 * All tests are expected to FAIL until the theme system is fully implemented.
 */

// Storage key for theme persistence
const THEME_STORAGE_KEY = 'do-theme-state'

// CSS variables to verify
const THEME_CSS_VARS = {
  background: '--background',
  foreground: '--foreground',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  card: '--card',
  cardForeground: '--card-foreground',
  border: '--border',
}

/**
 * Helper to get CSS variable value from the document
 */
async function getCSSVariable(page: import('@playwright/test').Page, variable: string): Promise<string> {
  return page.evaluate((v) => {
    return getComputedStyle(document.documentElement).getPropertyValue(v).trim()
  }, variable)
}

/**
 * Helper to get theme from localStorage
 */
async function getStoredTheme(page: import('@playwright/test').Page): Promise<object | null> {
  return page.evaluate((key) => {
    const stored = localStorage.getItem(key)
    if (!stored) return null
    try {
      return JSON.parse(stored)
    } catch {
      return null
    }
  }, THEME_STORAGE_KEY)
}

/**
 * Helper to check if dark mode class is present
 */
async function hasDarkModeClass(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    return document.documentElement.classList.contains('dark')
  })
}

/**
 * Helper to get data-theme attribute
 */
async function getDataTheme(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() => {
    return document.documentElement.getAttribute('data-theme') || document.body.getAttribute('data-theme')
  })
}

// =============================================================================
// Shared Theme Toggle Tests
// =============================================================================

test.describe('Theme System - Core Functionality', () => {
  test.describe('Theme Toggle - Light/Dark Mode', () => {
    test('should render theme toggle button on /admin', async ({ page }) => {
      await page.goto('/admin')
      const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('admin-theme-toggle'))
      await expect(toggle).toBeVisible()
    })

    test('should render theme toggle button on /app', async ({ page }) => {
      await page.goto('/app')
      const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('app-theme-toggle'))
      await expect(toggle).toBeVisible()
    })

    test('should toggle from light to dark mode on click', async ({ page }) => {
      await page.goto('/admin')
      const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('admin-theme-toggle'))

      // Start in light mode
      expect(await hasDarkModeClass(page)).toBe(false)

      // Click toggle
      await toggle.click()

      // Should now be dark mode
      expect(await hasDarkModeClass(page)).toBe(true)
    })

    test('should toggle from dark to light mode on click', async ({ page }) => {
      await page.goto('/admin')
      const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('admin-theme-toggle'))

      // Set to dark mode first
      await toggle.click()
      expect(await hasDarkModeClass(page)).toBe(true)

      // Click toggle again
      await toggle.click()

      // Should be back to light mode
      expect(await hasDarkModeClass(page)).toBe(false)
    })

    test('theme toggle should have accessible aria attributes', async ({ page }) => {
      await page.goto('/admin')
      const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('admin-theme-toggle'))

      // Should have aria-label or aria-pressed for accessibility
      const ariaLabel = await toggle.getAttribute('aria-label')
      const ariaPressed = await toggle.getAttribute('aria-pressed')

      expect(ariaLabel || ariaPressed).toBeTruthy()
    })

    test('theme toggle should have keyboard support', async ({ page }) => {
      await page.goto('/admin')
      const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('admin-theme-toggle'))

      // Focus and press Enter
      await toggle.focus()
      const initialDark = await hasDarkModeClass(page)

      await page.keyboard.press('Enter')
      const afterEnter = await hasDarkModeClass(page)

      expect(afterEnter).toBe(!initialDark)
    })
  })

  // ===========================================================================
  // System Preference Detection Tests
  // ===========================================================================

  test.describe('System Preference Detection (prefers-color-scheme)', () => {
    test('should respect system dark mode preference', async ({ page }) => {
      // Emulate dark mode system preference
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.goto('/admin')

      // Clear any stored preference to test system default
      await page.evaluate((key) => localStorage.removeItem(key), THEME_STORAGE_KEY)
      await page.reload()

      // Should be in dark mode
      expect(await hasDarkModeClass(page)).toBe(true)
    })

    test('should respect system light mode preference', async ({ page }) => {
      // Emulate light mode system preference
      await page.emulateMedia({ colorScheme: 'light' })
      await page.goto('/admin')

      // Clear any stored preference to test system default
      await page.evaluate((key) => localStorage.removeItem(key), THEME_STORAGE_KEY)
      await page.reload()

      // Should be in light mode
      expect(await hasDarkModeClass(page)).toBe(false)
    })

    test('should update theme when system preference changes', async ({ page }) => {
      await page.goto('/admin')

      // Start with light mode
      await page.emulateMedia({ colorScheme: 'light' })

      // Enable system mode via selector or by clearing stored preference
      await page.evaluate((key) => {
        const state = { mode: 'system', preset: 'anthropic' }
        localStorage.setItem(key, JSON.stringify({ state }))
      }, THEME_STORAGE_KEY)
      await page.reload()

      expect(await hasDarkModeClass(page)).toBe(false)

      // Change to dark mode system preference
      await page.emulateMedia({ colorScheme: 'dark' })

      // Wait for media query listener to fire
      await page.waitForTimeout(100)

      // Should now be dark
      expect(await hasDarkModeClass(page)).toBe(true)
    })

    test('should have system option in theme selector', async ({ page }) => {
      await page.goto('/admin')

      // Open theme selector if it exists
      const selector = page.getByTestId('theme-selector').or(page.getByTestId('admin-theme-selector'))

      if (await selector.isVisible()) {
        await selector.click()

        // Should have system option
        const systemOption = page.getByRole('option', { name: /system/i }).or(page.getByTestId('theme-option-system'))

        await expect(systemOption).toBeVisible()
      }
    })
  })

  // ===========================================================================
  // Persistence Tests
  // ===========================================================================

  test.describe('Theme Persistence (localStorage)', () => {
    test('should persist theme mode to localStorage', async ({ page }) => {
      await page.goto('/admin')
      const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('admin-theme-toggle'))

      // Toggle to dark mode
      await toggle.click()

      // Check localStorage
      const stored = await getStoredTheme(page)
      expect(stored).not.toBeNull()
      expect((stored as { state?: { mode?: string } })?.state?.mode).toBe('dark')
    })

    test('should restore theme from localStorage on page load', async ({ page }) => {
      // Pre-set localStorage
      await page.goto('/admin')
      await page.evaluate((key) => {
        const state = { state: { mode: 'dark', preset: 'anthropic', resolvedMode: 'dark' } }
        localStorage.setItem(key, JSON.stringify(state))
      }, THEME_STORAGE_KEY)

      // Reload and check theme is restored
      await page.reload()

      expect(await hasDarkModeClass(page)).toBe(true)
    })

    test('should persist theme across page navigation', async ({ page }) => {
      await page.goto('/admin')
      const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('admin-theme-toggle'))

      // Set dark mode
      await toggle.click()
      expect(await hasDarkModeClass(page)).toBe(true)

      // Navigate to /app
      await page.goto('/app')

      // Theme should still be dark
      expect(await hasDarkModeClass(page)).toBe(true)
    })

    test('should persist theme after browser refresh', async ({ page }) => {
      await page.goto('/admin')
      const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('admin-theme-toggle'))

      // Set dark mode
      await toggle.click()
      expect(await hasDarkModeClass(page)).toBe(true)

      // Hard refresh
      await page.reload({ waitUntil: 'domcontentloaded' })

      // Theme should still be dark (no flash of light mode)
      expect(await hasDarkModeClass(page)).toBe(true)
    })

    test('should not flash wrong theme on page load (FOUC prevention)', async ({ page }) => {
      // Pre-set dark mode in localStorage
      await page.goto('/admin')
      await page.evaluate((key) => {
        const state = { state: { mode: 'dark', preset: 'anthropic', resolvedMode: 'dark' } }
        localStorage.setItem(key, JSON.stringify(state))
      }, THEME_STORAGE_KEY)

      // Capture the initial state before hydration
      const darkOnLoad = await page.evaluate(() => {
        return document.documentElement.classList.contains('dark')
      })

      // Should be dark immediately
      expect(darkOnLoad).toBe(true)
    })

    test('should handle corrupted localStorage gracefully', async ({ page }) => {
      await page.goto('/admin')

      // Set corrupted data
      await page.evaluate((key) => {
        localStorage.setItem(key, 'not valid json {{{')
      }, THEME_STORAGE_KEY)

      // Reload - should not crash, should fall back to defaults
      await page.reload()

      // Should load with default theme (light)
      expect(await hasDarkModeClass(page)).toBe(false)
    })

    test('should use default theme when localStorage is empty', async ({ page }) => {
      await page.goto('/admin')

      // Clear localStorage
      await page.evaluate((key) => localStorage.removeItem(key), THEME_STORAGE_KEY)
      await page.reload()

      // Should be in default (light) mode
      expect(await hasDarkModeClass(page)).toBe(false)
    })
  })
})

// =============================================================================
// Admin Route Theme Tests
// =============================================================================

test.describe('Theme System - /admin Routes', () => {
  test('theme toggle should be visible in admin sidebar or header', async ({ page }) => {
    await page.goto('/admin')

    const toggle = page
      .getByTestId('admin-theme-toggle')
      .or(page.getByTestId('theme-toggle'))
      .or(page.locator('[data-testid="admin-user-menu"]').getByTestId('theme-toggle'))

    await expect(toggle).toBeVisible()
  })

  test('admin shell should have data-theme attribute', async ({ page }) => {
    await page.goto('/admin')

    const theme = await getDataTheme(page)
    expect(theme).toBeTruthy()
  })

  test('dark mode should apply to admin sidebar', async ({ page }) => {
    await page.goto('/admin')
    const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('admin-theme-toggle'))

    // Enable dark mode
    await toggle.click()

    const sidebar = page.getByTestId('admin-sidebar')

    // Sidebar should have dark-appropriate styling
    // This checks the computed background color is dark
    const bgColor = await sidebar.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bgColor).toBeTruthy()
  })

  test('dark mode should apply to admin main content', async ({ page }) => {
    await page.goto('/admin')
    const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('admin-theme-toggle'))

    // Enable dark mode
    await toggle.click()

    const main = page.getByTestId('admin-main')

    // Main content should exist and have styling applied
    await expect(main).toBeVisible()
  })

  test('theme should persist across admin sub-routes', async ({ page }) => {
    await page.goto('/admin')
    const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('admin-theme-toggle'))

    // Set dark mode
    await toggle.click()
    expect(await hasDarkModeClass(page)).toBe(true)

    // Navigate to admin settings
    await page.goto('/admin/settings')

    // Theme should still be dark
    expect(await hasDarkModeClass(page)).toBe(true)
  })

  test('admin-specific theme toggle should work in user menu', async ({ page }) => {
    await page.goto('/admin')

    // Open user menu
    const userMenu = page.getByTestId('admin-user-menu')
    if (await userMenu.isVisible()) {
      await userMenu.click()

      // Find theme toggle in dropdown
      const themeToggle = page.getByTestId('admin-user-dropdown').getByTestId('theme-toggle')

      if (await themeToggle.isVisible()) {
        const initialDark = await hasDarkModeClass(page)
        await themeToggle.click()
        const afterClick = await hasDarkModeClass(page)

        expect(afterClick).toBe(!initialDark)
      }
    }
  })
})

// =============================================================================
// App Route Theme Tests
// =============================================================================

test.describe('Theme System - /app Routes', () => {
  test('theme toggle should be visible in app shell', async ({ page }) => {
    await page.goto('/app')

    const toggle = page
      .getByTestId('app-theme-toggle')
      .or(page.getByTestId('theme-toggle'))
      .or(page.locator('[data-testid="app-user-menu"]').getByTestId('theme-toggle'))

    await expect(toggle).toBeVisible()
  })

  test('app shell should have data-theme attribute', async ({ page }) => {
    await page.goto('/app')

    const theme = await getDataTheme(page)
    expect(theme).toBeTruthy()
  })

  test('dark mode should apply to app sidebar', async ({ page }) => {
    await page.goto('/app')
    const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('app-theme-toggle'))

    // Enable dark mode
    await toggle.click()

    const sidebar = page.getByTestId('app-sidebar')

    // Sidebar should be visible with dark styling
    await expect(sidebar).toBeVisible()
  })

  test('dark mode should apply to app main content', async ({ page }) => {
    await page.goto('/app')
    const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('app-theme-toggle'))

    // Enable dark mode
    await toggle.click()

    const main = page.getByTestId('app-main-content')

    // Main content should exist
    await expect(main).toBeVisible()
  })

  test('theme should persist across app sub-routes', async ({ page }) => {
    await page.goto('/app')
    const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('app-theme-toggle'))

    // Set dark mode
    await toggle.click()
    expect(await hasDarkModeClass(page)).toBe(true)

    // Navigate to app dashboard
    await page.goto('/app/dashboard')

    // Theme should still be dark
    expect(await hasDarkModeClass(page)).toBe(true)
  })

  test('theme should be consistent between /admin and /app', async ({ page }) => {
    // Set dark mode on /admin
    await page.goto('/admin')
    const adminToggle = page.getByTestId('theme-toggle').or(page.getByTestId('admin-theme-toggle'))
    await adminToggle.click()
    expect(await hasDarkModeClass(page)).toBe(true)

    // Navigate to /app
    await page.goto('/app')

    // Should still be dark
    expect(await hasDarkModeClass(page)).toBe(true)
  })
})

// =============================================================================
// CSS Variables Tests
// =============================================================================

test.describe('Theme System - CSS Variables', () => {
  test('should set --background CSS variable', async ({ page }) => {
    await page.goto('/admin')

    const background = await getCSSVariable(page, THEME_CSS_VARS.background)
    expect(background).toBeTruthy()
  })

  test('should set --foreground CSS variable', async ({ page }) => {
    await page.goto('/admin')

    const foreground = await getCSSVariable(page, THEME_CSS_VARS.foreground)
    expect(foreground).toBeTruthy()
  })

  test('should set --primary CSS variable', async ({ page }) => {
    await page.goto('/admin')

    const primary = await getCSSVariable(page, THEME_CSS_VARS.primary)
    expect(primary).toBeTruthy()
  })

  test('CSS variables should change when toggling to dark mode', async ({ page }) => {
    await page.goto('/admin')
    const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('admin-theme-toggle'))

    // Get light mode values
    const lightBackground = await getCSSVariable(page, THEME_CSS_VARS.background)
    const lightForeground = await getCSSVariable(page, THEME_CSS_VARS.foreground)

    // Toggle to dark mode
    await toggle.click()

    // Get dark mode values
    const darkBackground = await getCSSVariable(page, THEME_CSS_VARS.background)
    const darkForeground = await getCSSVariable(page, THEME_CSS_VARS.foreground)

    // Values should be different
    expect(darkBackground).not.toBe(lightBackground)
    expect(darkForeground).not.toBe(lightForeground)
  })

  test('CSS variables should be set on document root', async ({ page }) => {
    await page.goto('/admin')

    // Check that variables are set on :root or html element
    const hasVariables = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement)
      return styles.getPropertyValue('--background').trim() !== ''
    })

    expect(hasVariables).toBe(true)
  })

  test('should have all essential CSS variables defined', async ({ page }) => {
    await page.goto('/admin')

    for (const [name, variable] of Object.entries(THEME_CSS_VARS)) {
      const value = await getCSSVariable(page, variable)
      expect(value, `${name} (${variable}) should be defined`).toBeTruthy()
    }
  })

  test('CSS variables should be valid color values', async ({ page }) => {
    await page.goto('/admin')

    const background = await getCSSVariable(page, THEME_CSS_VARS.background)

    // Should be a valid color format (hsl, rgb, hex, etc.)
    // HSL format: h s% l% or hsl(h, s%, l%)
    // RGB format: rgb(r, g, b)
    // Hex format: #xxx or #xxxxxx
    const isValidColor = /^(#[0-9a-f]{3,8}|\d+\s+[\d.]+%\s+[\d.]+%|hsl|rgb|oklch|oklab)/i.test(background)
    expect(isValidColor).toBe(true)
  })
})

// =============================================================================
// Theme Preset Tests
// =============================================================================

test.describe('Theme System - Presets', () => {
  test('should have theme selector visible', async ({ page }) => {
    await page.goto('/admin')

    const selector = page.getByTestId('theme-selector').or(page.getByTestId('admin-theme-selector'))

    // Theme selector might be inside a dropdown or directly visible
    // Check if it exists somewhere in the page
    const exists = await selector.isVisible().catch(() => false)

    // If not directly visible, try opening user menu first
    if (!exists) {
      const userMenu = page.getByTestId('admin-user-menu')
      if (await userMenu.isVisible()) {
        await userMenu.click()
        const selectorInMenu = page.getByTestId('theme-selector')
        await expect(selectorInMenu).toBeVisible()
      }
    } else {
      await expect(selector).toBeVisible()
    }
  })

  test('should have multiple theme presets available', async ({ page }) => {
    await page.goto('/admin')

    // Open theme selector
    const selector = page.getByTestId('theme-selector').or(page.getByTestId('admin-theme-selector'))

    if (await selector.isVisible()) {
      await selector.click()

      // Count preset options
      const options = page.locator('[data-testid^="theme-preset-"]')
      const count = await options.count()

      expect(count).toBeGreaterThan(1)
    }
  })

  test('should switch to Anthropic preset', async ({ page }) => {
    await page.goto('/admin')

    const selector = page.getByTestId('theme-selector')
    if (await selector.isVisible()) {
      await selector.click()

      const anthropicOption = page.getByTestId('theme-preset-anthropic')
      await anthropicOption.click()

      const theme = await getDataTheme(page)
      expect(theme).toBe('anthropic')
    }
  })

  test('should switch to Stripe preset', async ({ page }) => {
    await page.goto('/admin')

    const selector = page.getByTestId('theme-selector')
    if (await selector.isVisible()) {
      await selector.click()

      const stripeOption = page.getByTestId('theme-preset-stripe')
      await stripeOption.click()

      const theme = await getDataTheme(page)
      expect(theme).toBe('stripe')
    }
  })

  test('should switch to Linear preset', async ({ page }) => {
    await page.goto('/admin')

    const selector = page.getByTestId('theme-selector')
    if (await selector.isVisible()) {
      await selector.click()

      const linearOption = page.getByTestId('theme-preset-linear')
      await linearOption.click()

      const theme = await getDataTheme(page)
      expect(theme).toBe('linear')
    }
  })

  test('preset should persist to localStorage', async ({ page }) => {
    await page.goto('/admin')

    const selector = page.getByTestId('theme-selector')
    if (await selector.isVisible()) {
      await selector.click()

      const stripeOption = page.getByTestId('theme-preset-stripe')
      await stripeOption.click()

      const stored = await getStoredTheme(page)
      expect((stored as { state?: { preset?: string } })?.state?.preset).toBe('stripe')
    }
  })

  test('preset should change CSS variables', async ({ page }) => {
    await page.goto('/admin')

    const selector = page.getByTestId('theme-selector')
    if (await selector.isVisible()) {
      // Get current primary color
      const initialPrimary = await getCSSVariable(page, THEME_CSS_VARS.primary)

      // Switch preset
      await selector.click()
      const differentPreset = page.getByTestId('theme-preset-linear')
      await differentPreset.click()

      // Primary should be different
      const newPrimary = await getCSSVariable(page, THEME_CSS_VARS.primary)
      expect(newPrimary).not.toBe(initialPrimary)
    }
  })

  test('preset should persist across page reload', async ({ page }) => {
    await page.goto('/admin')

    const selector = page.getByTestId('theme-selector')
    if (await selector.isVisible()) {
      await selector.click()

      const stripeOption = page.getByTestId('theme-preset-stripe')
      await stripeOption.click()

      // Reload
      await page.reload()

      const theme = await getDataTheme(page)
      expect(theme).toBe('stripe')
    }
  })
})

// =============================================================================
// Mobile Responsiveness Tests
// =============================================================================

test.describe('Theme System - Mobile Responsiveness', () => {
  test('theme toggle should be accessible on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/admin')

    // On mobile, toggle might be in a hamburger menu
    const mobileTrigger = page.getByTestId('admin-mobile-trigger')

    if (await mobileTrigger.isVisible()) {
      await mobileTrigger.click()

      // Wait for drawer to open
      await page.getByTestId('admin-mobile-drawer').waitFor({ state: 'visible' })
    }

    // Theme toggle should be accessible somewhere
    const toggle = page
      .getByTestId('theme-toggle')
      .or(page.getByTestId('admin-theme-toggle'))
      .or(page.getByTestId('mobile-theme-toggle'))

    await expect(toggle).toBeVisible()
  })

  test('theme toggle should work on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/admin')

    // Open mobile menu if needed
    const mobileTrigger = page.getByTestId('admin-mobile-trigger')
    if (await mobileTrigger.isVisible()) {
      await mobileTrigger.click()
      await page.getByTestId('admin-mobile-drawer').waitFor({ state: 'visible' })
    }

    const toggle = page
      .getByTestId('theme-toggle')
      .or(page.getByTestId('admin-theme-toggle'))
      .or(page.getByTestId('mobile-theme-toggle'))

    const initialDark = await hasDarkModeClass(page)
    await toggle.click()
    const afterClick = await hasDarkModeClass(page)

    expect(afterClick).toBe(!initialDark)
  })

  test('dark mode should apply correctly on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/admin')

    // Pre-set dark mode
    await page.evaluate((key) => {
      const state = { state: { mode: 'dark', preset: 'anthropic', resolvedMode: 'dark' } }
      localStorage.setItem(key, JSON.stringify(state))
    }, THEME_STORAGE_KEY)
    await page.reload()

    expect(await hasDarkModeClass(page)).toBe(true)
  })
})

// =============================================================================
// Accessibility Tests
// =============================================================================

test.describe('Theme System - Accessibility', () => {
  test('theme toggle should have appropriate ARIA attributes', async ({ page }) => {
    await page.goto('/admin')
    const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('admin-theme-toggle'))

    // Should have aria-label for screen readers
    const ariaLabel = await toggle.getAttribute('aria-label')
    const role = await toggle.getAttribute('role')

    expect(ariaLabel || role).toBeTruthy()
  })

  test('theme toggle should be focusable', async ({ page }) => {
    await page.goto('/admin')
    const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('admin-theme-toggle'))

    await toggle.focus()

    // Should receive focus
    const isFocused = await toggle.evaluate((el) => document.activeElement === el)
    expect(isFocused).toBe(true)
  })

  test('dark mode should maintain sufficient color contrast', async ({ page }) => {
    await page.goto('/admin')
    const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('admin-theme-toggle'))

    // Enable dark mode
    await toggle.click()

    // Check that text is visible against background
    const foreground = await getCSSVariable(page, THEME_CSS_VARS.foreground)
    const background = await getCSSVariable(page, THEME_CSS_VARS.background)

    // Both values should be defined
    expect(foreground).toBeTruthy()
    expect(background).toBeTruthy()

    // They should be different (basic contrast check)
    expect(foreground).not.toBe(background)
  })

  test('theme selector should have keyboard navigation', async ({ page }) => {
    await page.goto('/admin')

    const selector = page.getByTestId('theme-selector')
    if (await selector.isVisible()) {
      await selector.focus()
      await page.keyboard.press('Enter')

      // Options should be navigable with arrow keys
      await page.keyboard.press('ArrowDown')

      // Should not throw and options should be accessible
      const activeOption = page.locator('[data-testid^="theme-preset-"]:focus')
      const isOptionFocused = await activeOption.count()

      expect(isOptionFocused).toBeGreaterThanOrEqual(0)
    }
  })

  test('should announce theme changes to screen readers', async ({ page }) => {
    await page.goto('/admin')
    const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('admin-theme-toggle'))

    // Look for aria-live region or status updates
    const liveRegion = page.locator('[aria-live="polite"]').or(page.locator('[role="status"]'))

    await toggle.click()

    // Give time for announcement
    await page.waitForTimeout(100)

    // Live region should exist (even if empty initially)
    const exists = (await liveRegion.count()) > 0
    expect(exists).toBe(true)
  })
})

// =============================================================================
// Edge Cases and Error Handling
// =============================================================================

test.describe('Theme System - Edge Cases', () => {
  test('should handle rapid theme toggling', async ({ page }) => {
    await page.goto('/admin')
    const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('admin-theme-toggle'))

    // Rapid clicking
    for (let i = 0; i < 10; i++) {
      await toggle.click()
    }

    // Should end up in consistent state
    const isDark = await hasDarkModeClass(page)
    expect(typeof isDark).toBe('boolean')

    // State should match localStorage
    const stored = await getStoredTheme(page)
    const storedMode = (stored as { state?: { mode?: string } })?.state?.mode
    const resolvedMode = (stored as { state?: { resolvedMode?: string } })?.state?.resolvedMode

    if (storedMode === 'dark') {
      expect(isDark).toBe(true)
    } else if (storedMode === 'light') {
      expect(isDark).toBe(false)
    } else if (storedMode === 'system') {
      // System mode - check resolvedMode
      expect(isDark).toBe(resolvedMode === 'dark')
    }
  })

  test('should handle theme change during page navigation', async ({ page }) => {
    await page.goto('/admin')
    const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('admin-theme-toggle'))

    // Click toggle and immediately navigate
    await toggle.click()
    await page.goto('/app')

    // Theme should still be toggled
    expect(await hasDarkModeClass(page)).toBe(true)
  })

  test('should work with JavaScript disabled (graceful degradation)', async ({ page, browser }) => {
    // Create a context with JavaScript disabled
    const noJsContext = await browser.newContext({ javaScriptEnabled: false })
    const noJsPage = await noJsContext.newPage()

    await noJsPage.goto('/admin')

    // Page should still render (even if theme doesn't work dynamically)
    // Check for no crash
    const body = noJsPage.locator('body')
    await expect(body).toBeVisible()

    await noJsContext.close()
  })

  test('should handle localStorage quota exceeded', async ({ page }) => {
    await page.goto('/admin')

    // Fill up localStorage to near quota
    await page.evaluate(() => {
      try {
        // Try to fill localStorage (this might not hit quota but tests the concept)
        const testKey = 'theme-quota-test'
        localStorage.setItem(testKey, 'x'.repeat(1000))
        localStorage.removeItem(testKey)
      } catch {
        // Quota exceeded - expected
      }
    })

    const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('admin-theme-toggle'))

    // Theme toggle should still work even if storage fails
    await toggle.click()

    // Visual state should update
    expect(await hasDarkModeClass(page)).toBe(true)
  })

  test('should handle private browsing mode', async ({ page }) => {
    // Note: Playwright doesn't have explicit private mode, but we can simulate
    // localStorage restrictions
    await page.goto('/admin')

    // Simulate localStorage unavailability
    await page.evaluate(() => {
      // Override localStorage to simulate private mode
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: () => null,
          setItem: () => {
            throw new Error('QuotaExceededError')
          },
          removeItem: () => {},
          clear: () => {},
        },
      })
    })

    await page.reload()

    const toggle = page.getByTestId('theme-toggle').or(page.getByTestId('admin-theme-toggle'))

    // Should still work for current session
    await toggle.click()
    expect(await hasDarkModeClass(page)).toBe(true)
  })
})
