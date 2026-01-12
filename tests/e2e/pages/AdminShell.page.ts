import type { Locator, Page } from '@playwright/test'

/**
 * Page Object Model for the Admin Shell
 *
 * The admin shell uses @mdxui/cockpit DeveloperDashboard component which provides:
 * - DashboardShell with collapsible sidebar
 * - Navigation with customizable routes
 * - User menu with theme toggle
 * - Team/organization switcher in header
 * - Responsive mobile drawer
 *
 * Expected test-id structure:
 * - data-testid="admin-shell" - Root container
 * - data-testid="admin-sidebar" - Desktop sidebar
 * - data-testid="admin-sidebar-header" - Sidebar header (logo/branding)
 * - data-testid="admin-sidebar-nav" - Navigation container
 * - data-testid="admin-sidebar-footer" - Sidebar footer (user menu)
 * - data-testid="admin-mobile-trigger" - Mobile menu trigger button
 * - data-testid="admin-mobile-drawer" - Mobile navigation drawer
 * - data-testid="admin-header" - Main content header
 * - data-testid="admin-main" - Main content area
 * - data-testid="admin-logo" - Brand logo
 * - data-testid="admin-user-menu" - User menu trigger
 * - data-testid="admin-user-dropdown" - User dropdown menu
 * - data-testid="admin-theme-toggle" - Theme toggle button
 * - data-testid="admin-nav-item-{name}" - Individual nav items
 */
export class AdminShellPage {
  readonly page: Page

  // Shell structure
  readonly shell: Locator
  readonly sidebar: Locator
  readonly sidebarHeader: Locator
  readonly sidebarNav: Locator
  readonly sidebarFooter: Locator
  readonly mainContent: Locator
  readonly header: Locator

  // Branding
  readonly logo: Locator
  readonly brandName: Locator

  // Navigation
  readonly navDashboard: Locator
  readonly navSettings: Locator
  readonly navRequests: Locator
  readonly navApiKeys: Locator
  readonly navTeam: Locator
  readonly navBilling: Locator
  readonly navOverview: Locator

  // User menu
  readonly userMenu: Locator
  readonly userDropdown: Locator
  readonly userAvatar: Locator
  readonly userName: Locator
  readonly userEmail: Locator
  readonly logoutButton: Locator

  // Theme
  readonly themeToggle: Locator

  // Mobile
  readonly mobileTrigger: Locator
  readonly mobileDrawer: Locator
  readonly mobileCloseButton: Locator

  // Sidebar collapse
  readonly sidebarCollapseButton: Locator

  constructor(page: Page) {
    this.page = page

    // Shell structure locators
    this.shell = page.getByTestId('admin-shell')
    this.sidebar = page.getByTestId('admin-sidebar')
    this.sidebarHeader = page.getByTestId('admin-sidebar-header')
    this.sidebarNav = page.getByTestId('admin-sidebar-nav')
    this.sidebarFooter = page.getByTestId('admin-sidebar-footer')
    this.mainContent = page.getByTestId('admin-main')
    this.header = page.getByTestId('admin-header')

    // Branding locators
    this.logo = page.getByTestId('admin-logo')
    this.brandName = page.getByTestId('admin-brand-name')

    // Navigation locators - using both testid and accessible role patterns
    this.navDashboard = page.getByTestId('admin-nav-item-dashboard')
    this.navSettings = page.getByTestId('admin-nav-item-settings')
    this.navRequests = page.getByTestId('admin-nav-item-requests')
    this.navApiKeys = page.getByTestId('admin-nav-item-api-keys')
    this.navTeam = page.getByTestId('admin-nav-item-team')
    this.navBilling = page.getByTestId('admin-nav-item-billing')
    this.navOverview = page.getByTestId('admin-nav-item-overview')

    // User menu locators
    this.userMenu = page.getByTestId('admin-user-menu')
    this.userDropdown = page.getByTestId('admin-user-dropdown')
    this.userAvatar = page.getByTestId('admin-user-avatar')
    this.userName = page.getByTestId('admin-user-name')
    this.userEmail = page.getByTestId('admin-user-email')
    this.logoutButton = page.getByTestId('admin-logout-button')

    // Theme locators
    this.themeToggle = page.getByTestId('admin-theme-toggle')

    // Mobile locators
    this.mobileTrigger = page.getByTestId('admin-mobile-trigger')
    this.mobileDrawer = page.getByTestId('admin-mobile-drawer')
    this.mobileCloseButton = page.getByTestId('admin-mobile-close')

    // Sidebar collapse
    this.sidebarCollapseButton = page.getByTestId('admin-sidebar-collapse')
  }

  /**
   * Navigate to the admin shell root
   */
  async goto() {
    await this.page.goto('/admin')
  }

  /**
   * Navigate to a specific admin route
   */
  async gotoRoute(route: string) {
    const path = route.startsWith('/') ? route : `/${route}`
    await this.page.goto(`/admin${path}`)
  }

  /**
   * Check if we're on the admin shell (not redirected to login)
   */
  async isOnAdminShell(): Promise<boolean> {
    const url = this.page.url()
    return url.includes('/admin') && !url.includes('/login')
  }

  /**
   * Wait for the shell to be fully loaded
   */
  async waitForShell() {
    await this.shell.waitFor({ state: 'visible' })
  }

  /**
   * Open the user dropdown menu
   */
  async openUserMenu() {
    await this.userMenu.click()
    await this.userDropdown.waitFor({ state: 'visible' })
  }

  /**
   * Close the user dropdown menu by clicking outside
   */
  async closeUserMenu() {
    await this.page.keyboard.press('Escape')
  }

  /**
   * Toggle theme via user menu
   */
  async toggleTheme() {
    await this.themeToggle.click()
  }

  /**
   * Get current theme from document or data attribute
   */
  async getCurrentTheme(): Promise<'light' | 'dark'> {
    const theme = await this.page.evaluate(() => {
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    })
    return theme
  }

  /**
   * Open mobile navigation drawer
   */
  async openMobileDrawer() {
    await this.mobileTrigger.click()
    await this.mobileDrawer.waitFor({ state: 'visible' })
  }

  /**
   * Close mobile navigation drawer
   */
  async closeMobileDrawer() {
    await this.mobileCloseButton.click()
    await this.mobileDrawer.waitFor({ state: 'hidden' })
  }

  /**
   * Check if mobile view (drawer trigger visible)
   */
  async isMobileView(): Promise<boolean> {
    return this.mobileTrigger.isVisible()
  }

  /**
   * Check if desktop view (sidebar visible)
   */
  async isDesktopView(): Promise<boolean> {
    return this.sidebar.isVisible()
  }

  /**
   * Collapse the sidebar (desktop only)
   */
  async collapseSidebar() {
    await this.sidebarCollapseButton.click()
  }

  /**
   * Navigate using sidebar item
   */
  async navigateTo(navItem: Locator) {
    await navItem.click()
  }

  /**
   * Get all visible navigation items
   */
  async getVisibleNavItems(): Promise<string[]> {
    const items = this.page.locator('[data-testid^="admin-nav-item-"]')
    const count = await items.count()
    const labels: string[] = []
    for (let i = 0; i < count; i++) {
      const text = await items.nth(i).textContent()
      if (text) labels.push(text.trim())
    }
    return labels
  }

  /**
   * Set viewport to mobile size
   */
  async setMobileViewport() {
    await this.page.setViewportSize({ width: 375, height: 667 })
  }

  /**
   * Set viewport to tablet size
   */
  async setTabletViewport() {
    await this.page.setViewportSize({ width: 768, height: 1024 })
  }

  /**
   * Set viewport to desktop size
   */
  async setDesktopViewport() {
    await this.page.setViewportSize({ width: 1280, height: 720 })
  }

  /**
   * Get the sidebar width (for collapse state testing)
   */
  async getSidebarWidth(): Promise<number> {
    const box = await this.sidebar.boundingBox()
    return box?.width ?? 0
  }

  /**
   * Check if sidebar is collapsed (icon-only mode)
   */
  async isSidebarCollapsed(): Promise<boolean> {
    const width = await this.getSidebarWidth()
    // Collapsed sidebar is typically around 48-64px
    return width < 100
  }
}
