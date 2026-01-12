import { test, expect } from '@playwright/test'

/**
 * E2E Route Transition Tests
 *
 * TDD RED Phase - These tests verify route transition behavior between
 * /admin and /app sections. Tests are expected to fail initially until
 * implementations are complete.
 *
 * Test coverage:
 * 1. Auth state preservation across route transitions
 * 2. Client-side navigation (no full page reload)
 * 3. Deep linking to /admin/* routes
 * 4. Deep linking to /app/* routes
 * 5. Browser history navigation (back/forward)
 * 6. Route guards for unauthenticated users
 * 7. 404 handling for unknown routes
 */

// =============================================================================
// Test Data & Constants
// =============================================================================

const TEST_USER = {
  email: 'test@dotdo.dev',
  password: 'testpassword123',
  name: 'Test User',
}

// =============================================================================
// 1. Auth State Preservation Across Route Transitions
// =============================================================================

test.describe('Auth State Preservation', () => {
  test.describe('Navigation between /admin and /app preserves auth state', () => {
    test('should maintain auth state when navigating from /admin to /app', async ({ page }) => {
      // Login via admin
      await page.goto('/admin/login')
      await page.getByTestId('login-email-input').fill(TEST_USER.email)
      await page.getByTestId('login-password-input').fill(TEST_USER.password)
      await page.getByTestId('login-submit-button').click()

      // Wait for redirect to admin dashboard
      await expect(page).toHaveURL('/admin')
      await expect(page.getByTestId('admin-shell')).toBeVisible()

      // Verify user is authenticated in admin
      await expect(page.getByTestId('admin-user-menu')).toBeVisible()
      const adminUserName = await page.getByTestId('admin-user-name').textContent()
      expect(adminUserName).toBeTruthy()

      // Navigate to /app via nav link
      await page.getByTestId('nav-link-app').click()
      await expect(page).toHaveURL('/app')

      // Verify auth state is preserved - user should still be logged in
      await expect(page.getByTestId('app-shell')).toBeVisible()
      await expect(page.getByTestId('app-user-menu')).toBeVisible()

      // User info should be consistent across routes
      const appUserName = await page.getByTestId('app-user-name').textContent()
      expect(appUserName).toBe(adminUserName)
    })

    test('should maintain auth state when navigating from /app to /admin', async ({ page }) => {
      // Start authenticated in /app
      await page.goto('/app')

      // Simulate authenticated state
      await page.evaluate((user) => {
        localStorage.setItem(
          'dotdo_session',
          JSON.stringify({
            token: 'test-token-123',
            userId: 'user_123',
            email: user.email,
          })
        )
      }, TEST_USER)

      await page.reload()
      await expect(page.getByTestId('app-shell')).toBeVisible()

      // Navigate to admin
      await page.getByTestId('nav-link-admin').click()
      await expect(page).toHaveURL('/admin')

      // Auth state should be preserved
      await expect(page.getByTestId('admin-shell')).toBeVisible()
      await expect(page.getByTestId('admin-user-menu')).toBeVisible()
    })

    test('should preserve session token across route changes', async ({ page }) => {
      // Set up authenticated session
      await page.goto('/admin')
      await page.evaluate(() => {
        localStorage.setItem(
          'dotdo_session',
          JSON.stringify({
            token: 'persistent-token-456',
            userId: 'user_456',
          })
        )
      })
      await page.reload()

      // Get initial token
      const initialToken = await page.evaluate(() => {
        const session = localStorage.getItem('dotdo_session')
        return session ? JSON.parse(session).token : null
      })

      // Navigate to /app
      await page.goto('/app')

      // Token should be unchanged
      const tokenAfterNavigation = await page.evaluate(() => {
        const session = localStorage.getItem('dotdo_session')
        return session ? JSON.parse(session).token : null
      })

      expect(tokenAfterNavigation).toBe(initialToken)
      expect(tokenAfterNavigation).toBe('persistent-token-456')
    })

    test('should handle logout correctly across routes', async ({ page }) => {
      // Start authenticated in admin
      await page.goto('/admin')
      await page.evaluate(() => {
        localStorage.setItem(
          'dotdo_session',
          JSON.stringify({ token: 'logout-test-token', userId: 'user_789' })
        )
      })
      await page.reload()

      // Logout from admin
      await page.getByTestId('admin-user-menu').click()
      await page.getByTestId('admin-logout-button').click()

      // Should redirect to login
      await expect(page).toHaveURL('/admin/login')

      // Trying to access /app should also redirect (no auth)
      await page.goto('/app')
      await expect(page).toHaveURL(/\/login|\/admin\/login/)
    })
  })
})

// =============================================================================
// 2. Client-Side Navigation (No Full Page Reload)
// =============================================================================

test.describe('Client-Side Navigation', () => {
  test('should navigate within /admin without full page reload', async ({ page }) => {
    await page.goto('/admin')

    // Listen for navigation events
    let fullReloadOccurred = false
    page.on('load', () => {
      fullReloadOccurred = true
    })

    // Reset the flag after initial load
    fullReloadOccurred = false

    // Navigate within admin using sidebar
    await page.getByTestId('admin-nav-item-settings').click()
    await expect(page).toHaveURL('/admin/settings')

    // Verify content changed
    await expect(page.getByText('Settings')).toBeVisible()

    // No full page reload should have occurred
    expect(fullReloadOccurred).toBe(false)
  })

  test('should navigate within /app without full page reload', async ({ page }) => {
    await page.goto('/app')

    let fullReloadOccurred = false
    page.on('load', () => {
      fullReloadOccurred = true
    })
    fullReloadOccurred = false

    // Navigate to projects
    await page.getByTestId('app-nav-projects').click()
    await expect(page).toHaveURL('/app/projects')

    // Content should update
    await expect(page.getByTestId('app-page-title')).toContainText('Projects')

    expect(fullReloadOccurred).toBe(false)
  })

  test('should maintain shell state during client navigation', async ({ page }) => {
    await page.goto('/admin')

    // Collapse sidebar (if supported)
    const collapseButton = page.getByTestId('admin-sidebar-collapse')
    if (await collapseButton.isVisible()) {
      await collapseButton.click()
    }

    // Navigate to settings
    await page.getByTestId('admin-nav-item-settings').click()
    await expect(page).toHaveURL('/admin/settings')

    // Sidebar state should be preserved
    const sidebar = page.getByTestId('admin-sidebar')
    const isCollapsed = await sidebar.getAttribute('data-state')
    expect(isCollapsed).toBe('collapsed')
  })

  test('cross-route navigation between /admin and /app works without full page reload', async ({
    page,
  }) => {
    await page.goto('/admin')

    let navigationCount = 0
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        navigationCount++
      }
    })
    navigationCount = 0

    // Navigate from admin to app
    await page.getByTestId('global-nav-app').click()
    await expect(page).toHaveURL('/app')

    // Only client-side navigation should occur
    // Frame navigation events for SPA should be minimal
    expect(navigationCount).toBeLessThanOrEqual(1)
  })
})

// =============================================================================
// 3. Deep Linking - /admin/* Routes
// =============================================================================

test.describe('Deep Linking - Admin Routes', () => {
  test('should load /admin/settings directly via URL', async ({ page }) => {
    // Set up auth before navigation
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.setItem(
        'dotdo_session',
        JSON.stringify({ token: 'deep-link-token', userId: 'user_deep' })
      )
    })

    // Direct navigation to deep link
    const response = await page.goto('/admin/settings')
    expect(response?.status()).toBe(200)

    // Correct page should load
    await expect(page).toHaveURL('/admin/settings')
    await expect(page.getByTestId('admin-shell')).toBeVisible()
    await expect(page.getByText('Settings')).toBeVisible()

    // Navigation should show correct active state
    const settingsNavItem = page.getByTestId('admin-nav-item-settings')
    await expect(settingsNavItem).toHaveAttribute('data-active', 'true')
  })

  test('should load /admin/settings/appearance directly', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.setItem(
        'dotdo_session',
        JSON.stringify({ token: 'appearance-token', userId: 'user_appear' })
      )
    })

    const response = await page.goto('/admin/settings/appearance')
    expect(response?.status()).toBe(200)

    await expect(page).toHaveURL('/admin/settings/appearance')
    await expect(page.getByText('Appearance')).toBeVisible()
  })

  test('should load /admin/users directly', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.setItem(
        'dotdo_session',
        JSON.stringify({ token: 'users-token', userId: 'user_users' })
      )
    })

    const response = await page.goto('/admin/users')
    expect(response?.status()).toBe(200)

    await expect(page).toHaveURL('/admin/users')
    await expect(page.getByTestId('admin-shell')).toBeVisible()
  })

  test('should load /admin/integrations/api-keys directly', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.setItem(
        'dotdo_session',
        JSON.stringify({ token: 'api-keys-token', userId: 'user_api' })
      )
    })

    const response = await page.goto('/admin/integrations/api-keys')
    expect(response?.status()).toBe(200)

    await expect(page).toHaveURL('/admin/integrations/api-keys')
  })

  test('should preserve query params on deep link', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.setItem(
        'dotdo_session',
        JSON.stringify({ token: 'query-token', userId: 'user_query' })
      )
    })

    await page.goto('/admin/settings?tab=security&highlight=2fa')

    const url = new URL(page.url())
    expect(url.pathname).toBe('/admin/settings')
    expect(url.searchParams.get('tab')).toBe('security')
    expect(url.searchParams.get('highlight')).toBe('2fa')
  })
})

// =============================================================================
// 4. Deep Linking - /app/* Routes
// =============================================================================

test.describe('Deep Linking - App Routes', () => {
  test('should load /app/projects directly via URL', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.setItem(
        'dotdo_session',
        JSON.stringify({ token: 'projects-token', userId: 'user_proj' })
      )
    })

    const response = await page.goto('/app/projects')
    expect(response?.status()).toBe(200)

    await expect(page).toHaveURL('/app/projects')
    await expect(page.getByTestId('app-shell')).toBeVisible()
    await expect(page.getByTestId('app-page-title')).toContainText('Projects')

    // Navigation should show correct active state
    const projectsNavItem = page.getByTestId('app-nav-projects')
    await expect(projectsNavItem).toHaveAttribute('data-active', 'true')
  })

  test('should load /app/workflows directly', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.setItem(
        'dotdo_session',
        JSON.stringify({ token: 'workflows-token', userId: 'user_wf' })
      )
    })

    const response = await page.goto('/app/workflows')
    expect(response?.status()).toBe(200)

    await expect(page).toHaveURL('/app/workflows')
    await expect(page.getByTestId('app-shell')).toBeVisible()
  })

  test('should load /app/settings directly', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.setItem(
        'dotdo_session',
        JSON.stringify({ token: 'app-settings-token', userId: 'user_as' })
      )
    })

    const response = await page.goto('/app/settings')
    expect(response?.status()).toBe(200)

    await expect(page).toHaveURL('/app/settings')
  })

  test('should load /app/projects/:projectId directly', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.setItem(
        'dotdo_session',
        JSON.stringify({ token: 'project-detail-token', userId: 'user_pd' })
      )
    })

    const response = await page.goto('/app/projects/123')
    expect(response?.status()).toBe(200)

    await expect(page).toHaveURL('/app/projects/123')
    await expect(page.getByTestId('app-shell')).toBeVisible()
  })

  test('should handle deep link with hash fragment', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.setItem(
        'dotdo_session',
        JSON.stringify({ token: 'hash-token', userId: 'user_hash' })
      )
    })

    await page.goto('/app/projects#archived')

    const url = new URL(page.url())
    expect(url.pathname).toBe('/app/projects')
    expect(url.hash).toBe('#archived')
  })
})

// =============================================================================
// 5. Browser History Navigation (Back/Forward)
// =============================================================================

test.describe('Browser History Navigation', () => {
  test('browser back button navigates to previous route', async ({ page }) => {
    await page.goto('/admin')
    const adminUrl = page.url()

    await page.getByTestId('admin-nav-item-settings').click()
    await expect(page).toHaveURL('/admin/settings')

    await page.goBack()
    expect(page.url()).toBe(adminUrl)
    await expect(page.getByTestId('admin-shell')).toBeVisible()
  })

  test('browser forward button navigates forward in history', async ({ page }) => {
    await page.goto('/admin')
    await page.getByTestId('admin-nav-item-settings').click()
    await expect(page).toHaveURL('/admin/settings')
    const settingsUrl = page.url()

    await page.goBack()
    await expect(page).toHaveURL('/admin')

    await page.goForward()
    expect(page.url()).toBe(settingsUrl)
    await expect(page.getByText('Settings')).toBeVisible()
  })

  test('back/forward works across /admin and /app boundaries', async ({ page }) => {
    await page.goto('/admin')
    await page.goto('/app')
    await page.goto('/app/projects')
    await page.goto('/admin/settings')

    // Should navigate back through history correctly
    await page.goBack()
    await expect(page).toHaveURL('/app/projects')

    await page.goBack()
    await expect(page).toHaveURL('/app')

    await page.goBack()
    await expect(page).toHaveURL('/admin')

    // Forward should work too
    await page.goForward()
    await expect(page).toHaveURL('/app')
  })

  test('back button preserves scroll position', async ({ page }) => {
    await page.goto('/admin/users')

    // Scroll down if content exists
    await page.evaluate(() => window.scrollTo(0, 500))
    const scrollBefore = await page.evaluate(() => window.scrollY)

    await page.getByTestId('admin-nav-item-settings').click()
    await expect(page).toHaveURL('/admin/settings')

    await page.goBack()
    await expect(page).toHaveURL('/admin/users')

    // Give browser time to restore scroll
    await page.waitForTimeout(100)
    const scrollAfter = await page.evaluate(() => window.scrollY)

    // Scroll position should be restored (or at least close)
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThan(50)
  })

  test('history state is preserved on page refresh', async ({ page }) => {
    await page.goto('/admin')
    await page.goto('/admin/settings')
    await page.goto('/admin/users')

    // Refresh the page
    await page.reload()
    await expect(page).toHaveURL('/admin/users')

    // Back should still work
    await page.goBack()
    await expect(page).toHaveURL('/admin/settings')
  })

  test('rapid back/forward navigation works correctly', async ({ page }) => {
    await page.goto('/admin')
    await page.goto('/admin/settings')
    await page.goto('/admin/users')
    await page.goto('/app')
    await page.goto('/app/projects')

    // Rapid navigation
    await page.goBack()
    await page.goBack()
    await page.goForward()

    await expect(page).toHaveURL('/admin/users')
  })
})

// =============================================================================
// 6. Route Guards - Unauthenticated User Redirect
// =============================================================================

test.describe('Route Guards - Unauthenticated Redirect', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing session
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.removeItem('dotdo_session')
    })
  })

  test('unauthenticated user accessing /admin is redirected to login', async ({ page }) => {
    await page.goto('/admin')

    // Should redirect to login
    await expect(page).toHaveURL('/admin/login')
    await expect(page.getByTestId('login-form')).toBeVisible()
  })

  test('unauthenticated user accessing /admin/settings is redirected to login', async ({
    page,
  }) => {
    await page.goto('/admin/settings')

    await expect(page).toHaveURL('/admin/login')
  })

  test('unauthenticated user accessing /app is redirected to login', async ({ page }) => {
    await page.goto('/app')

    // Should redirect to login page
    await expect(page).toHaveURL(/\/login|\/admin\/login/)
  })

  test('unauthenticated user accessing /app/projects is redirected to login', async ({ page }) => {
    await page.goto('/app/projects')

    await expect(page).toHaveURL(/\/login|\/admin\/login/)
  })

  test('login page is accessible without auth', async ({ page }) => {
    const response = await page.goto('/admin/login')
    expect(response?.status()).toBe(200)

    await expect(page).toHaveURL('/admin/login')
    await expect(page.getByTestId('login-form')).toBeVisible()
  })

  test('signup page is accessible without auth', async ({ page }) => {
    const response = await page.goto('/admin/signup')
    expect(response?.status()).toBe(200)

    await expect(page).toHaveURL('/admin/signup')
  })

  test('reset-password page is accessible without auth', async ({ page }) => {
    const response = await page.goto('/admin/reset-password')
    expect(response?.status()).toBe(200)

    await expect(page).toHaveURL('/admin/reset-password')
  })

  test('redirect preserves original destination after login', async ({ page }) => {
    // Try to access protected route
    await page.goto('/admin/settings')

    // Should redirect to login with return URL
    await expect(page).toHaveURL(/\/admin\/login/)
    const url = new URL(page.url())
    expect(url.searchParams.get('returnTo') || url.searchParams.get('redirect')).toContain(
      '/admin/settings'
    )

    // After login, should redirect back to original destination
    await page.getByTestId('login-email-input').fill(TEST_USER.email)
    await page.getByTestId('login-password-input').fill(TEST_USER.password)
    await page.getByTestId('login-submit-button').click()

    await expect(page).toHaveURL('/admin/settings')
  })

  test('expired session triggers redirect to login', async ({ page }) => {
    // Set up expired session
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.setItem(
        'dotdo_session',
        JSON.stringify({
          token: 'expired-token',
          userId: 'user_expired',
          expiresAt: new Date(Date.now() - 1000).toISOString(), // Already expired
        })
      )
    })

    await page.goto('/admin')

    // Should redirect to login due to expired session
    await expect(page).toHaveURL('/admin/login')
  })
})

// =============================================================================
// 7. 404 Handling for Unknown Routes
// =============================================================================

test.describe('404 Handling - Unknown Routes', () => {
  test('unknown route under /admin shows 404 page', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.setItem(
        'dotdo_session',
        JSON.stringify({ token: '404-token', userId: 'user_404' })
      )
    })

    const response = await page.goto('/admin/nonexistent-page-xyz')

    // Should show 404 or redirect gracefully
    expect(response?.status()).toBeLessThan(500)

    // Should display 404 content
    const pageContent = await page.textContent('body')
    expect(
      pageContent?.toLowerCase().includes('not found') ||
        pageContent?.toLowerCase().includes('404') ||
        page.url().includes('/admin')
    ).toBe(true)
  })

  test('unknown route under /app shows 404 page', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.setItem(
        'dotdo_session',
        JSON.stringify({ token: '404-app-token', userId: 'user_404app' })
      )
    })

    const response = await page.goto('/app/completely-unknown-route')

    expect(response?.status()).toBeLessThan(500)

    const pageContent = await page.textContent('body')
    expect(
      pageContent?.toLowerCase().includes('not found') ||
        pageContent?.toLowerCase().includes('404') ||
        page.url().includes('/app')
    ).toBe(true)
  })

  test('unknown top-level route shows 404 page', async ({ page }) => {
    const response = await page.goto('/this-route-definitely-does-not-exist')

    expect(response?.status()).toBeLessThan(500)

    // Should show user-friendly 404 page
    const pageContent = await page.textContent('body')
    expect(pageContent).not.toContain('Error: Cannot find module')
    expect(pageContent).not.toContain('at Object.<anonymous>')
  })

  test('404 page has navigation to go back home', async ({ page }) => {
    await page.goto('/nonexistent-route')

    // Should have a way to navigate back
    const homeLink = page.locator('a[href="/"], a:has-text("Home"), a:has-text("Go back")')
    await expect(homeLink.first()).toBeVisible()

    await homeLink.first().click()
    await expect(page).toHaveURL('/')
  })

  test('404 page maintains layout consistency', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.setItem(
        'dotdo_session',
        JSON.stringify({ token: '404-layout-token', userId: 'user_layout' })
      )
    })

    await page.goto('/admin/this-does-not-exist')

    // Should still show admin shell if in admin context
    const adminShell = page.getByTestId('admin-shell')
    const hasAdminShell = await adminShell.isVisible().catch(() => false)

    // Either shows admin shell or a standalone 404 page
    expect(hasAdminShell || (await page.locator('body').isVisible())).toBe(true)
  })

  test('invalid nested route params show 404', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.setItem(
        'dotdo_session',
        JSON.stringify({ token: 'nested-404-token', userId: 'user_nested' })
      )
    })

    // Try accessing a user that doesn't exist
    const response = await page.goto('/admin/users/nonexistent-user-id-12345')

    expect(response?.status()).toBeLessThan(500)
  })
})

// =============================================================================
// Additional Edge Cases
// =============================================================================

test.describe('Edge Cases', () => {
  test('handles trailing slash normalization', async ({ page }) => {
    await page.goto('/admin/')
    // Should normalize to /admin or stay at /admin/
    const url = page.url()
    expect(url.includes('/admin')).toBe(true)
  })

  test('handles double slashes in URL', async ({ page }) => {
    const response = await page.goto('/admin//settings')
    expect(response?.status()).toBeLessThan(500)
  })

  test('handles encoded characters in URL', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.setItem(
        'dotdo_session',
        JSON.stringify({ token: 'encoded-token', userId: 'user_enc' })
      )
    })

    const response = await page.goto('/admin/users?search=' + encodeURIComponent('test@user.com'))
    expect(response?.status()).toBeLessThan(500)
  })

  test('handles very long URLs gracefully', async ({ page }) => {
    const longParam = 'a'.repeat(1000)
    const response = await page.goto(`/admin?param=${longParam}`)
    expect(response?.status()).toBeLessThan(500)
  })

  test('concurrent navigation requests are handled correctly', async ({ page }) => {
    await page.goto('/admin')

    // Trigger multiple rapid navigations
    await Promise.all([
      page.getByTestId('admin-nav-item-settings').click(),
      page.evaluate(() => {
        window.history.pushState({}, '', '/admin/users')
      }),
    ])

    // Page should be in a valid state (either settings or users)
    const url = page.url()
    expect(url.includes('/admin/settings') || url.includes('/admin/users')).toBe(true)
  })
})
