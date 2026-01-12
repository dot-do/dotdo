import { expect, test } from '@playwright/test'
import { AdminShellPage } from '../pages/AdminShell.page'

/**
 * E2E Tests for the Admin Shell Layout
 *
 * TDD RED Phase - These tests define the expected behavior of the /admin route
 * using the @mdxui/cockpit DeveloperDashboard component.
 *
 * The admin shell should provide:
 * - Collapsible sidebar with navigation
 * - Header with branding/team switcher
 * - User menu with profile and theme toggle
 * - Responsive layout (mobile drawer, desktop sidebar)
 *
 * Tests use data-testid selectors for reliability.
 * All tests are expected to FAIL until implementation is complete.
 */

test.describe('Admin Shell Layout', () => {
  let adminPage: AdminShellPage

  test.beforeEach(async ({ page }) => {
    adminPage = new AdminShellPage(page)
    await adminPage.goto()
  })

  test.describe('Shell Structure', () => {
    test('should render the admin shell container', async () => {
      await expect(adminPage.shell).toBeVisible()
    })

    test('should render the sidebar on desktop viewport', async () => {
      await adminPage.setDesktopViewport()
      await expect(adminPage.sidebar).toBeVisible()
    })

    test('should render sidebar header area', async () => {
      await expect(adminPage.sidebarHeader).toBeVisible()
    })

    test('should render sidebar navigation area', async () => {
      await expect(adminPage.sidebarNav).toBeVisible()
    })

    test('should render sidebar footer area', async () => {
      await expect(adminPage.sidebarFooter).toBeVisible()
    })

    test('should render main content area', async () => {
      await expect(adminPage.mainContent).toBeVisible()
    })
  })

  test.describe('Branding and Logo', () => {
    test('should display the logo in sidebar header', async () => {
      await expect(adminPage.logo).toBeVisible()
    })

    test('should display brand name or text', async () => {
      await expect(adminPage.brandName).toBeVisible()
    })

    test('logo should be a clickable link to home', async ({ page }) => {
      const logoLink = adminPage.logo.locator('a, [role="link"]').first()
      // If logo is wrapped in link, it should navigate to home
      const href = await adminPage.logo.locator('a').first().getAttribute('href').catch(() => null)
      if (href) {
        expect(href).toMatch(/^\/$|^\/admin$/)
      }
    })

    test('should display .do branding', async ({ page }) => {
      // The dotdo platform uses ".do" branding
      const brandText = page.locator('text=.do').first()
      await expect(brandText).toBeVisible()
    })
  })

  test.describe('Navigation Items', () => {
    test('should display Overview/Dashboard navigation item', async () => {
      // Either "Overview" or "Dashboard" is acceptable
      const overviewNav = adminPage.navOverview.or(adminPage.navDashboard)
      await expect(overviewNav).toBeVisible()
    })

    test('should display Settings navigation item', async () => {
      await expect(adminPage.navSettings).toBeVisible()
    })

    test('should display Requests/Activity navigation item', async () => {
      await expect(adminPage.navRequests).toBeVisible()
    })

    test('should display API Keys navigation item', async () => {
      await expect(adminPage.navApiKeys).toBeVisible()
    })

    test('should display Team navigation item', async () => {
      await expect(adminPage.navTeam).toBeVisible()
    })

    test('should display Billing navigation item', async () => {
      await expect(adminPage.navBilling).toBeVisible()
    })

    test('navigation items should have icons', async ({ page }) => {
      // Nav items should contain SVG icons
      const navItems = page.locator('[data-testid^="admin-nav-item-"]')
      const count = await navItems.count()
      expect(count).toBeGreaterThan(0)

      // Check at least the first nav item has an icon
      const firstNavItem = navItems.first()
      const icon = firstNavItem.locator('svg')
      await expect(icon).toBeVisible()
    })

    test('navigation items should be accessible with proper roles', async ({ page }) => {
      const navContainer = adminPage.sidebarNav
      // Navigation should be in a nav element or have navigation role
      const navRole = await navContainer.locator('nav, [role="navigation"]').first()
      await expect(navRole).toBeVisible()
    })

    test('clicking navigation item should navigate to route', async ({ page }) => {
      await adminPage.navSettings.click()
      await expect(page).toHaveURL(/\/admin\/settings/)
    })

    test('active navigation item should be visually indicated', async ({ page }) => {
      // Navigate to settings
      await adminPage.gotoRoute('/settings')

      // Settings nav item should have active state (aria-current or active class)
      const settingsNav = adminPage.navSettings
      const ariaCurrentAttr = await settingsNav.getAttribute('aria-current')
      const dataActiveAttr = await settingsNav.getAttribute('data-active')
      const hasActiveClass = await settingsNav.evaluate((el) => el.classList.contains('active') || el.classList.contains('is-active'))

      const isActive = ariaCurrentAttr === 'page' || ariaCurrentAttr === 'true' || dataActiveAttr === 'true' || hasActiveClass
      expect(isActive).toBe(true)
    })
  })

  test.describe('Header with User Menu', () => {
    test('should display user menu trigger in sidebar footer', async () => {
      await expect(adminPage.userMenu).toBeVisible()
    })

    test('user menu should show user avatar or initials', async () => {
      await expect(adminPage.userAvatar).toBeVisible()
    })

    test('clicking user menu should open dropdown', async () => {
      await adminPage.openUserMenu()
      await expect(adminPage.userDropdown).toBeVisible()
    })

    test('user dropdown should show user name', async () => {
      await adminPage.openUserMenu()
      await expect(adminPage.userName).toBeVisible()
    })

    test('user dropdown should show user email', async () => {
      await adminPage.openUserMenu()
      await expect(adminPage.userEmail).toBeVisible()
    })

    test('user dropdown should have logout option', async () => {
      await adminPage.openUserMenu()
      await expect(adminPage.logoutButton).toBeVisible()
    })

    test('user dropdown should close on escape key', async () => {
      await adminPage.openUserMenu()
      await expect(adminPage.userDropdown).toBeVisible()
      await adminPage.closeUserMenu()
      await expect(adminPage.userDropdown).toBeHidden()
    })
  })

  test.describe('Theme Toggle', () => {
    test('should display theme toggle in user menu or sidebar', async () => {
      // Theme toggle might be directly in sidebar or in user dropdown
      const themeToggleVisible = await adminPage.themeToggle.isVisible()
      if (!themeToggleVisible) {
        // Try opening user menu to find theme toggle
        await adminPage.openUserMenu()
      }
      await expect(adminPage.themeToggle).toBeVisible()
    })

    test('clicking theme toggle should switch theme', async ({ page }) => {
      const initialTheme = await adminPage.getCurrentTheme()

      // Find and click theme toggle (may be in user dropdown)
      const themeToggleVisible = await adminPage.themeToggle.isVisible()
      if (!themeToggleVisible) {
        await adminPage.openUserMenu()
      }

      await adminPage.toggleTheme()

      // Wait for theme transition
      await page.waitForTimeout(300)

      const newTheme = await adminPage.getCurrentTheme()
      expect(newTheme).not.toBe(initialTheme)
    })

    test('theme toggle should show appropriate icon for current theme', async ({ page }) => {
      const themeToggleVisible = await adminPage.themeToggle.isVisible()
      if (!themeToggleVisible) {
        await adminPage.openUserMenu()
      }

      const currentTheme = await adminPage.getCurrentTheme()

      // Toggle should show opposite theme icon (sun for dark mode, moon for light mode)
      const sunIcon = adminPage.themeToggle.locator('[data-testid="sun-icon"], [class*="sun"], svg[class*="lucide-sun"]')
      const moonIcon = adminPage.themeToggle.locator('[data-testid="moon-icon"], [class*="moon"], svg[class*="lucide-moon"]')

      if (currentTheme === 'dark') {
        // In dark mode, should show sun icon (to switch to light)
        await expect(sunIcon.or(adminPage.themeToggle.locator('text=Light'))).toBeVisible()
      } else {
        // In light mode, should show moon icon (to switch to dark)
        await expect(moonIcon.or(adminPage.themeToggle.locator('text=Dark'))).toBeVisible()
      }
    })

    test('theme preference should persist across page reload', async ({ page }) => {
      // Get initial theme and toggle it
      const initialTheme = await adminPage.getCurrentTheme()

      const themeToggleVisible = await adminPage.themeToggle.isVisible()
      if (!themeToggleVisible) {
        await adminPage.openUserMenu()
      }
      await adminPage.toggleTheme()

      // Reload the page
      await page.reload()

      // Theme should persist
      const newTheme = await adminPage.getCurrentTheme()
      expect(newTheme).not.toBe(initialTheme)
    })
  })

  test.describe('Responsive Layout - Desktop', () => {
    test.beforeEach(async () => {
      await adminPage.setDesktopViewport()
    })

    test('should show sidebar on desktop', async () => {
      await expect(adminPage.sidebar).toBeVisible()
    })

    test('should hide mobile menu trigger on desktop', async () => {
      await expect(adminPage.mobileTrigger).toBeHidden()
    })

    test('sidebar should be collapsible to icon mode', async () => {
      // Sidebar should have collapse trigger
      await expect(adminPage.sidebarCollapseButton).toBeVisible()
    })

    test('clicking collapse should reduce sidebar width', async () => {
      const initialWidth = await adminPage.getSidebarWidth()
      expect(initialWidth).toBeGreaterThan(100) // Full width

      await adminPage.collapseSidebar()

      const collapsedWidth = await adminPage.getSidebarWidth()
      expect(collapsedWidth).toBeLessThan(initialWidth)
      expect(collapsedWidth).toBeLessThan(100) // Icon-only width
    })

    test('collapsed sidebar should still show icons', async ({ page }) => {
      await adminPage.collapseSidebar()

      // Nav items should still have visible icons
      const navIcons = page.locator('[data-testid^="admin-nav-item-"] svg')
      const count = await navIcons.count()
      expect(count).toBeGreaterThan(0)

      // At least one icon should be visible
      await expect(navIcons.first()).toBeVisible()
    })

    test('hovering collapsed sidebar should expand it', async ({ page }) => {
      await adminPage.collapseSidebar()
      expect(await adminPage.isSidebarCollapsed()).toBe(true)

      // Hover over sidebar
      await adminPage.sidebar.hover()

      // Wait for expansion animation
      await page.waitForTimeout(300)

      // Sidebar should expand on hover
      const expandedWidth = await adminPage.getSidebarWidth()
      expect(expandedWidth).toBeGreaterThan(100)
    })
  })

  test.describe('Responsive Layout - Mobile', () => {
    test.beforeEach(async () => {
      await adminPage.setMobileViewport()
    })

    test('should hide sidebar on mobile', async () => {
      await expect(adminPage.sidebar).toBeHidden()
    })

    test('should show mobile menu trigger on mobile', async () => {
      await expect(adminPage.mobileTrigger).toBeVisible()
    })

    test('clicking mobile trigger should open drawer', async () => {
      await adminPage.openMobileDrawer()
      await expect(adminPage.mobileDrawer).toBeVisible()
    })

    test('mobile drawer should contain navigation items', async ({ page }) => {
      await adminPage.openMobileDrawer()

      // Drawer should have nav items
      const drawerNavItems = page.locator('[data-testid="admin-mobile-drawer"] [data-testid^="admin-nav-item-"]')
      const count = await drawerNavItems.count()
      expect(count).toBeGreaterThan(0)
    })

    test('mobile drawer should have close button', async () => {
      await adminPage.openMobileDrawer()
      await expect(adminPage.mobileCloseButton).toBeVisible()
    })

    test('clicking close button should close drawer', async () => {
      await adminPage.openMobileDrawer()
      await expect(adminPage.mobileDrawer).toBeVisible()

      await adminPage.closeMobileDrawer()
      await expect(adminPage.mobileDrawer).toBeHidden()
    })

    test('clicking outside drawer should close it', async ({ page }) => {
      await adminPage.openMobileDrawer()
      await expect(adminPage.mobileDrawer).toBeVisible()

      // Click on overlay/backdrop
      await page.locator('[data-testid="admin-mobile-overlay"], [data-state="open"][data-testid="admin-mobile-drawer"]').click({ position: { x: 10, y: 10 }, force: true })

      await expect(adminPage.mobileDrawer).toBeHidden()
    })

    test('selecting nav item in drawer should close drawer', async ({ page }) => {
      await adminPage.openMobileDrawer()

      // Click a nav item in the drawer
      const drawerNavItem = page.locator('[data-testid="admin-mobile-drawer"] [data-testid="admin-nav-item-settings"]')
      await drawerNavItem.click()

      // Drawer should close after navigation
      await expect(adminPage.mobileDrawer).toBeHidden()

      // Should have navigated
      await expect(page).toHaveURL(/\/admin\/settings/)
    })

    test('mobile header should show branding', async ({ page }) => {
      // On mobile, branding might be in a header bar instead of sidebar
      const mobileBrand = page.locator('[data-testid="admin-mobile-header"] [data-testid="admin-logo"], [data-testid="admin-logo"]')
      await expect(mobileBrand.first()).toBeVisible()
    })
  })

  test.describe('Responsive Layout - Tablet', () => {
    test.beforeEach(async () => {
      await adminPage.setTabletViewport()
    })

    test('should display appropriate layout for tablet', async () => {
      // Tablet might show collapsed sidebar or mobile layout depending on breakpoint
      const sidebarVisible = await adminPage.sidebar.isVisible()
      const mobileMenuVisible = await adminPage.mobileTrigger.isVisible()

      // Either sidebar or mobile menu should be available
      expect(sidebarVisible || mobileMenuVisible).toBe(true)
    })

    test('content should be readable on tablet width', async () => {
      await expect(adminPage.mainContent).toBeVisible()

      // Main content should have reasonable width
      const box = await adminPage.mainContent.boundingBox()
      expect(box?.width).toBeGreaterThan(400)
    })
  })

  test.describe('Accessibility', () => {
    test('sidebar navigation should have proper aria labels', async ({ page }) => {
      const nav = adminPage.sidebarNav.locator('nav, [role="navigation"]').first()
      const ariaLabel = await nav.getAttribute('aria-label')
      expect(ariaLabel).toBeTruthy()
    })

    test('user menu should be keyboard accessible', async ({ page }) => {
      // Tab to user menu
      await page.keyboard.press('Tab')

      // Keep tabbing until we reach the user menu (limited attempts)
      for (let i = 0; i < 20; i++) {
        const focused = page.locator(':focus')
        const testId = await focused.getAttribute('data-testid')
        if (testId === 'admin-user-menu') break
        await page.keyboard.press('Tab')
      }

      // Press Enter to open
      await page.keyboard.press('Enter')

      // Dropdown should open
      await expect(adminPage.userDropdown).toBeVisible()
    })

    test('nav items should be keyboard navigable', async ({ page }) => {
      // Focus on navigation
      await adminPage.sidebarNav.focus()

      // Arrow down should move through nav items
      await page.keyboard.press('Tab')

      const focused = page.locator(':focus')
      await expect(focused).toHaveAttribute('data-testid', /admin-nav-item-/)
    })

    test('mobile drawer should trap focus when open', async ({ page }) => {
      await adminPage.setMobileViewport()
      await adminPage.openMobileDrawer()

      // Tab through elements
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')

      // Focus should stay within drawer
      const focused = page.locator(':focus')
      const isInDrawer = await adminPage.mobileDrawer.locator(':focus').count()
      expect(isInDrawer).toBeGreaterThan(0)
    })

    test('theme toggle should announce state change to screen readers', async ({ page }) => {
      const themeToggleVisible = await adminPage.themeToggle.isVisible()
      if (!themeToggleVisible) {
        await adminPage.openUserMenu()
      }

      // Theme toggle should have aria-label or accessible name
      const ariaLabel = await adminPage.themeToggle.getAttribute('aria-label')
      const accessibleName = await adminPage.themeToggle.textContent()

      expect(ariaLabel || accessibleName).toBeTruthy()
    })
  })

  test.describe('Loading States', () => {
    test('should not show loading spinner when shell is ready', async ({ page }) => {
      await adminPage.waitForShell()

      // Look for loading indicators and ensure they're gone
      const loadingSpinner = page.locator('[data-testid="admin-loading"], [role="progressbar"], .loading-spinner')
      await expect(loadingSpinner).toBeHidden()
    })

    test('navigation should be interactive after shell loads', async () => {
      await adminPage.waitForShell()

      // Nav items should be clickable
      await expect(adminPage.navSettings).toBeEnabled()
    })
  })

  test.describe('Error States', () => {
    test('should display error boundary if shell fails to load', async ({ page }) => {
      // Force an error by navigating to invalid route
      await page.goto('/admin/invalid-route-that-should-404')

      // Should either show 404 or error state, not crash
      const errorBoundary = page.locator('[data-testid="admin-error"], [data-testid="error-boundary"]')
      const notFound = page.locator('text=404, text=Not Found, text=not found')

      // Either error boundary or 404 page should be visible
      const hasError = (await errorBoundary.count()) > 0
      const hasNotFound = (await notFound.count()) > 0
      const shellStillWorks = await adminPage.shell.isVisible()

      expect(hasError || hasNotFound || shellStillWorks).toBe(true)
    })
  })
})

test.describe('Admin Shell Integration', () => {
  test('should integrate with DeveloperDashboard component from @mdxui/cockpit', async ({ page }) => {
    await page.goto('/admin')

    // The shell should use DashboardShell primitive
    const dashboardShell = page.locator('[data-testid="admin-shell"], [data-component="DashboardShell"]')
    await expect(dashboardShell).toBeVisible()
  })

  test('should support custom branding configuration', async ({ page }) => {
    await page.goto('/admin')

    // Shell should display configured branding
    const logo = page.getByTestId('admin-logo')
    await expect(logo).toBeVisible()
  })

  test('should support route configuration for navigation', async ({ page }) => {
    await page.goto('/admin')

    // Routes from config should be in navigation
    const navItems = await page.locator('[data-testid^="admin-nav-item-"]').count()
    expect(navItems).toBeGreaterThan(0)
  })
})
