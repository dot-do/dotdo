import type { Page, Locator } from '@playwright/test'

/**
 * Page Object Model for the AppShell component
 *
 * The AppShell is the user-facing application shell from @mdxui/app,
 * distinct from the admin DeveloperDashboard shell. It provides:
 * - Sidebar navigation with user-specific items (not admin/developer items)
 * - Breadcrumb navigation
 * - PageHeader with title and actions
 * - Responsive layout (collapsible sidebar on mobile)
 *
 * Expected data-testid attributes:
 * - app-shell: Root container
 * - app-sidebar: Sidebar navigation container
 * - app-sidebar-header: Sidebar header (logo/brand)
 * - app-sidebar-nav: Main navigation area
 * - app-sidebar-footer: Footer area (user menu)
 * - app-sidebar-trigger: Toggle button for sidebar
 * - app-page-header: Page header container
 * - app-breadcrumbs: Breadcrumb navigation
 * - app-main-content: Main content area
 */
export class AppShellPage {
  readonly page: Page

  // Root containers
  readonly shell: Locator
  readonly sidebar: Locator
  readonly mainContent: Locator

  // Sidebar components
  readonly sidebarHeader: Locator
  readonly sidebarNav: Locator
  readonly sidebarFooter: Locator
  readonly sidebarTrigger: Locator
  readonly sidebarBrand: Locator

  // Navigation items - user-facing (not admin)
  readonly navItems: Locator
  readonly navDashboard: Locator
  readonly navProjects: Locator
  readonly navWorkflows: Locator
  readonly navSettings: Locator

  // Page header components
  readonly pageHeader: Locator
  readonly breadcrumbs: Locator
  readonly breadcrumbItems: Locator
  readonly pageTitle: Locator
  readonly pageDescription: Locator
  readonly pageActions: Locator

  // User menu
  readonly userMenu: Locator
  readonly userAvatar: Locator
  readonly userDropdown: Locator

  constructor(page: Page) {
    this.page = page

    // Root containers - using data-testid selectors
    this.shell = page.locator('[data-testid="app-shell"]')
    this.sidebar = page.locator('[data-testid="app-sidebar"]')
    this.mainContent = page.locator('[data-testid="app-main-content"]')

    // Sidebar components
    this.sidebarHeader = page.locator('[data-testid="app-sidebar-header"]')
    this.sidebarNav = page.locator('[data-testid="app-sidebar-nav"]')
    this.sidebarFooter = page.locator('[data-testid="app-sidebar-footer"]')
    this.sidebarTrigger = page.locator('[data-testid="app-sidebar-trigger"]')
    this.sidebarBrand = page.locator('[data-testid="app-sidebar-brand"]')

    // Navigation items - user-facing paths
    this.navItems = page.locator('[data-testid="app-nav-item"]')
    this.navDashboard = page.locator('[data-testid="app-nav-dashboard"]')
    this.navProjects = page.locator('[data-testid="app-nav-projects"]')
    this.navWorkflows = page.locator('[data-testid="app-nav-workflows"]')
    this.navSettings = page.locator('[data-testid="app-nav-settings"]')

    // Page header components
    this.pageHeader = page.locator('[data-testid="app-page-header"]')
    this.breadcrumbs = page.locator('[data-testid="app-breadcrumbs"]')
    this.breadcrumbItems = page.locator('[data-testid="app-breadcrumb-item"]')
    this.pageTitle = page.locator('[data-testid="app-page-title"]')
    this.pageDescription = page.locator('[data-testid="app-page-description"]')
    this.pageActions = page.locator('[data-testid="app-page-actions"]')

    // User menu
    this.userMenu = page.locator('[data-testid="app-user-menu"]')
    this.userAvatar = page.locator('[data-testid="app-user-avatar"]')
    this.userDropdown = page.locator('[data-testid="app-user-dropdown"]')
  }

  /**
   * Navigate to the app shell root
   */
  async goto(path: string = '/app') {
    await this.page.goto(path)
  }

  /**
   * Wait for the app shell to be fully loaded
   */
  async waitForLoad() {
    await this.shell.waitFor({ state: 'visible' })
    await this.sidebar.waitFor({ state: 'visible' })
  }

  /**
   * Toggle the sidebar open/closed
   */
  async toggleSidebar() {
    await this.sidebarTrigger.click()
  }

  /**
   * Check if sidebar is expanded (not collapsed to icons)
   */
  async isSidebarExpanded(): Promise<boolean> {
    const sidebar = this.sidebar
    // When collapsed, sidebar typically has a data attribute or specific width
    const state = await sidebar.getAttribute('data-state')
    return state === 'expanded' || state === null
  }

  /**
   * Click a navigation item by its test ID suffix
   */
  async clickNavItem(item: 'dashboard' | 'projects' | 'workflows' | 'settings') {
    const navItem = this.page.locator(`[data-testid="app-nav-${item}"]`)
    await navItem.click()
  }

  /**
   * Get all breadcrumb labels as text array
   */
  async getBreadcrumbLabels(): Promise<string[]> {
    const items = this.breadcrumbItems
    const count = await items.count()
    const labels: string[] = []
    for (let i = 0; i < count; i++) {
      const text = await items.nth(i).textContent()
      if (text) labels.push(text.trim())
    }
    return labels
  }

  /**
   * Click a breadcrumb by its label text
   */
  async clickBreadcrumb(label: string) {
    const breadcrumb = this.breadcrumbItems.filter({ hasText: label })
    await breadcrumb.click()
  }

  /**
   * Open the user menu dropdown
   */
  async openUserMenu() {
    await this.userMenu.click()
    await this.userDropdown.waitFor({ state: 'visible' })
  }

  /**
   * Get the current page title
   */
  async getPageTitle(): Promise<string | null> {
    return this.pageTitle.textContent()
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
   * Check if the mobile menu button is visible
   * (indicates responsive layout is active)
   */
  async isMobileMenuVisible(): Promise<boolean> {
    return this.sidebarTrigger.isVisible()
  }

  /**
   * Get the active navigation item
   */
  async getActiveNavItem(): Promise<string | null> {
    const activeItem = this.page.locator('[data-testid="app-nav-item"][data-active="true"]')
    if (await activeItem.isVisible()) {
      return activeItem.textContent()
    }
    return null
  }
}
