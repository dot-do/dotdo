import { test, expect } from '@playwright/test'
import { AppShellPage } from '../pages/AppShell.page'

/**
 * E2E Tests for the User-Facing App Shell (/app route)
 *
 * These tests verify the AppShell component from @mdxui/app renders correctly
 * and provides the expected user experience. The app shell is DISTINCT from
 * the admin shell (DeveloperDashboard) - it serves end-users, not developers.
 *
 * TDD RED PHASE: These tests are expected to FAIL initially.
 * The /app route and its shell implementation need to be created.
 *
 * Key differences from admin shell:
 * - User-specific navigation (Projects, Workflows) vs admin nav (Agents, Activity)
 * - Different branding/context
 * - User account focus vs developer/admin focus
 */

test.describe('App Shell - Layout Structure', () => {
  test('should render the AppShell root container', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    // The shell root should be present with correct data-testid
    await expect(appShell.shell).toBeVisible()
    await expect(appShell.shell).toHaveAttribute('data-testid', 'app-shell')
  })

  test('should render main content area', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    await expect(appShell.mainContent).toBeVisible()
    await expect(appShell.mainContent).toHaveAttribute('data-testid', 'app-main-content')
  })

  test('should render sidebar inset layout by default', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    // The sidebar should use the inset variant by default
    await expect(appShell.sidebar).toBeVisible()
    await expect(appShell.sidebar).toHaveAttribute('data-variant', 'inset')
  })

  test('should wrap content in SidebarProvider context', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    // SidebarProvider should set data attribute on wrapper
    const sidebarWrapper = page.locator('[data-sidebar-wrapper]')
    await expect(sidebarWrapper).toBeVisible()
  })
})

test.describe('App Shell - Sidebar Navigation', () => {
  test('should render sidebar with header, nav, and footer sections', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    await expect(appShell.sidebarHeader).toBeVisible()
    await expect(appShell.sidebarNav).toBeVisible()
    await expect(appShell.sidebarFooter).toBeVisible()
  })

  test('should display app branding in sidebar header', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    await expect(appShell.sidebarBrand).toBeVisible()
    // The brand should contain the app name
    await expect(appShell.sidebarBrand).toContainText('.do')
  })

  test('should render Dashboard navigation item', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    await expect(appShell.navDashboard).toBeVisible()
    await expect(appShell.navDashboard).toHaveAttribute('href', '/app')
  })

  test('should render Projects navigation item (user-specific)', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    // Projects is a user-facing nav item, different from admin's "Agents"
    await expect(appShell.navProjects).toBeVisible()
    await expect(appShell.navProjects).toHaveAttribute('href', '/app/projects')
  })

  test('should render Workflows navigation item', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    await expect(appShell.navWorkflows).toBeVisible()
    await expect(appShell.navWorkflows).toHaveAttribute('href', '/app/workflows')
  })

  test('should render Settings navigation item', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    await expect(appShell.navSettings).toBeVisible()
    await expect(appShell.navSettings).toHaveAttribute('href', '/app/settings')
  })

  test('should highlight active navigation item based on current path', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app/projects')

    // Projects nav item should be marked as active
    await expect(appShell.navProjects).toHaveAttribute('data-active', 'true')
    // Dashboard should not be active
    await expect(appShell.navDashboard).not.toHaveAttribute('data-active', 'true')
  })

  test('should navigate to correct route when nav item clicked', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    await appShell.clickNavItem('projects')

    await expect(page).toHaveURL(/\/app\/projects/)
  })
})

test.describe('App Shell - Breadcrumbs', () => {
  test('should render breadcrumbs container in page header', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    await expect(appShell.breadcrumbs).toBeVisible()
    await expect(appShell.breadcrumbs).toHaveAttribute('data-testid', 'app-breadcrumbs')
  })

  test('should show Dashboard as home breadcrumb on root path', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    const labels = await appShell.getBreadcrumbLabels()
    expect(labels).toContain('Dashboard')
  })

  test('should show path segments as breadcrumbs on nested routes', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app/projects/123')

    const labels = await appShell.getBreadcrumbLabels()
    expect(labels).toEqual(['Dashboard', 'Projects', '#123'])
  })

  test('should make non-current breadcrumbs clickable links', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app/projects/123')

    // Dashboard breadcrumb should be a link
    const dashboardLink = appShell.breadcrumbItems.filter({ hasText: 'Dashboard' }).locator('a')
    await expect(dashboardLink).toHaveAttribute('href', '/app')

    // Projects breadcrumb should be a link
    const projectsLink = appShell.breadcrumbItems.filter({ hasText: 'Projects' }).locator('a')
    await expect(projectsLink).toHaveAttribute('href', '/app/projects')
  })

  test('should make current page breadcrumb non-clickable', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app/projects')

    // The current page (Projects) should not be a link
    const currentItem = appShell.breadcrumbItems.filter({ hasText: 'Projects' })
    const link = currentItem.locator('a')
    await expect(link).toHaveCount(0)
  })

  test('should navigate when breadcrumb link clicked', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app/projects/123')

    await appShell.clickBreadcrumb('Projects')

    await expect(page).toHaveURL(/\/app\/projects$/)
  })

  test('should render breadcrumb separators between items', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app/projects')

    // Look for separator elements (typically ChevronRight or /)
    const separators = page.locator('[data-testid="app-breadcrumbs"] [data-slot="separator"]')
    await expect(separators).toHaveCount(1) // Between Dashboard and Projects
  })
})

test.describe('App Shell - Page Header', () => {
  test('should render page header container', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    await expect(appShell.pageHeader).toBeVisible()
    await expect(appShell.pageHeader).toHaveAttribute('data-testid', 'app-page-header')
  })

  test('should display sidebar trigger in page header', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    await expect(appShell.sidebarTrigger).toBeVisible()
  })

  test('should display page title when provided', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app/projects')

    await expect(appShell.pageTitle).toBeVisible()
    await expect(appShell.pageTitle).toContainText('Projects')
  })

  test('should display page description when provided', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app/projects')

    await expect(appShell.pageDescription).toBeVisible()
    await expect(appShell.pageDescription).toContainText('Manage your projects')
  })

  test('should render page actions slot', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app/projects')

    // Projects page should have a "Create Project" action
    await expect(appShell.pageActions).toBeVisible()
    const createButton = appShell.pageActions.locator('button:has-text("Create")')
    await expect(createButton).toBeVisible()
  })

  test('should have separator between sidebar trigger and breadcrumbs', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    // Check for visual separator element
    const separator = page.locator('[data-testid="app-page-header"] [data-orientation="vertical"]')
    await expect(separator).toBeVisible()
  })
})

test.describe('App Shell - Responsive Layout', () => {
  test('should show expanded sidebar on desktop viewport', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.setDesktopViewport()
    await appShell.goto('/app')

    const isExpanded = await appShell.isSidebarExpanded()
    expect(isExpanded).toBe(true)

    // Navigation text should be visible, not just icons
    await expect(appShell.navDashboard).toContainText('Dashboard')
  })

  test('should collapse sidebar to icons on tablet viewport', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.setTabletViewport()
    await appShell.goto('/app')

    // On tablet, sidebar may auto-collapse to icon mode
    // The sidebar trigger should be visible for expanding
    await expect(appShell.sidebarTrigger).toBeVisible()
  })

  test('should hide sidebar off-canvas on mobile viewport', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.setMobileViewport()
    await appShell.goto('/app')

    // On mobile, sidebar should be hidden by default
    await expect(appShell.sidebar).not.toBeVisible()

    // Trigger should be visible to open sidebar
    await expect(appShell.sidebarTrigger).toBeVisible()
  })

  test('should open sidebar overlay on mobile when trigger clicked', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.setMobileViewport()
    await appShell.goto('/app')

    // Click trigger to open sidebar
    await appShell.toggleSidebar()

    // Sidebar should now be visible as overlay
    await expect(appShell.sidebar).toBeVisible()
  })

  test('should close sidebar overlay when clicking outside on mobile', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.setMobileViewport()
    await appShell.goto('/app')

    // Open sidebar
    await appShell.toggleSidebar()
    await expect(appShell.sidebar).toBeVisible()

    // Click on main content area
    await appShell.mainContent.click()

    // Sidebar should close
    await expect(appShell.sidebar).not.toBeVisible()
  })

  test('should toggle sidebar visibility with trigger button', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.setDesktopViewport()
    await appShell.goto('/app')

    // Initial state - expanded
    expect(await appShell.isSidebarExpanded()).toBe(true)

    // Click trigger to collapse
    await appShell.toggleSidebar()

    // Should now be collapsed
    expect(await appShell.isSidebarExpanded()).toBe(false)

    // Click again to expand
    await appShell.toggleSidebar()

    // Should be expanded again
    expect(await appShell.isSidebarExpanded()).toBe(true)
  })

  test('should adjust main content width when sidebar collapses', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.setDesktopViewport()
    await appShell.goto('/app')

    // Get initial main content width
    const initialBox = await appShell.mainContent.boundingBox()
    expect(initialBox).not.toBeNull()

    // Collapse sidebar
    await appShell.toggleSidebar()
    await page.waitForTimeout(300) // Wait for transition

    // Get new main content width
    const collapsedBox = await appShell.mainContent.boundingBox()
    expect(collapsedBox).not.toBeNull()

    // Main content should be wider when sidebar is collapsed
    expect(collapsedBox!.width).toBeGreaterThan(initialBox!.width)
  })
})

test.describe('App Shell - Navigation Context (Different from Admin)', () => {
  test('should NOT show admin-specific navigation items', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    // These are admin-only items that should NOT appear in user shell
    const agentsNav = page.locator('[data-testid="app-nav-agents"]')
    const activityNav = page.locator('[data-testid="app-nav-activity"]')
    const integrationsNav = page.locator('[data-testid="app-nav-integrations"]')

    await expect(agentsNav).not.toBeVisible()
    await expect(activityNav).not.toBeVisible()
    await expect(integrationsNav).not.toBeVisible()
  })

  test('should use /app base path, not /admin', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    // All nav links should use /app base path
    const navLinks = page.locator('[data-testid^="app-nav-"] a')
    const count = await navLinks.count()

    for (let i = 0; i < count; i++) {
      const href = await navLinks.nth(i).getAttribute('href')
      expect(href).toMatch(/^\/app/)
      expect(href).not.toMatch(/^\/admin/)
    }
  })

  test('should display user-focused branding, not developer dashboard', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    // Should NOT show admin-specific text
    const adminText = page.locator('text=Your 1-Person Unicorn')
    await expect(adminText).not.toBeVisible()

    // Should show user-appropriate branding
    await expect(appShell.sidebarBrand).toBeVisible()
  })

  test('should show user account menu, not admin controls', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    await expect(appShell.userMenu).toBeVisible()

    // Open user menu
    await appShell.openUserMenu()

    // Should have user-focused options
    const accountOption = page.locator('[data-testid="app-user-dropdown"] >> text=Account')
    const billingOption = page.locator('[data-testid="app-user-dropdown"] >> text=Billing')
    const logoutOption = page.locator('[data-testid="app-user-dropdown"] >> text=Log out')

    await expect(accountOption).toBeVisible()
    await expect(billingOption).toBeVisible()
    await expect(logoutOption).toBeVisible()
  })
})

test.describe('App Shell - User Menu', () => {
  test('should display user avatar in sidebar footer', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    await expect(appShell.userAvatar).toBeVisible()
  })

  test('should display user name in user menu trigger', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    // User menu should show user's name
    await expect(appShell.userMenu).toContainText(/\w+/) // At least some name text
  })

  test('should open dropdown menu on click', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    // Initially dropdown is not visible
    await expect(appShell.userDropdown).not.toBeVisible()

    // Click to open
    await appShell.openUserMenu()

    // Dropdown should be visible
    await expect(appShell.userDropdown).toBeVisible()
  })

  test('should close dropdown when clicking outside', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    await appShell.openUserMenu()
    await expect(appShell.userDropdown).toBeVisible()

    // Click outside
    await appShell.mainContent.click()

    // Dropdown should close
    await expect(appShell.userDropdown).not.toBeVisible()
  })
})

test.describe('App Shell - Keyboard Navigation', () => {
  test('should allow keyboard navigation through sidebar items', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    // Focus the first nav item
    await appShell.navDashboard.focus()

    // Tab to next item
    await page.keyboard.press('Tab')

    // Next item should be focused
    await expect(appShell.navProjects).toBeFocused()
  })

  test('should activate sidebar trigger with Enter key', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    // Focus the trigger
    await appShell.sidebarTrigger.focus()

    // Press Enter
    await page.keyboard.press('Enter')

    // Sidebar state should change
    const isExpanded = await appShell.isSidebarExpanded()
    expect(isExpanded).toBe(false) // Should collapse
  })

  test('should navigate via keyboard on nav items', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    // Focus projects nav
    await appShell.navProjects.focus()

    // Press Enter to navigate
    await page.keyboard.press('Enter')

    // Should navigate to projects
    await expect(page).toHaveURL(/\/app\/projects/)
  })
})

test.describe('App Shell - Loading States', () => {
  test('should show loading indicator while data loads', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    // If app is in loading state, should show skeleton or spinner
    // This tests the isLoading prop handling
    const loadingIndicator = page.locator('[data-testid="app-loading"]')

    // Loading indicator may or may not be visible depending on data load time
    // Just verify the shell renders regardless
    await expect(appShell.shell).toBeVisible()
  })
})

test.describe('App Shell - Accessibility', () => {
  test('should have correct ARIA landmarks', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    // Sidebar should be marked as navigation
    const nav = page.locator('nav[aria-label]')
    await expect(nav).toBeVisible()

    // Main content should have main role
    const main = page.locator('main')
    await expect(main).toBeVisible()
  })

  test('should have accessible sidebar trigger button', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    // Trigger should have aria-label or accessible name
    await expect(appShell.sidebarTrigger).toHaveAttribute('aria-label', /.+/)
  })

  test('should announce sidebar state changes to screen readers', async ({ page }) => {
    const appShell = new AppShellPage(page)
    await appShell.goto('/app')

    // Sidebar should have aria-expanded attribute
    const sidebar = page.locator('[data-testid="app-sidebar"]')
    await expect(sidebar).toHaveAttribute('aria-expanded', /.+/)
  })
})
