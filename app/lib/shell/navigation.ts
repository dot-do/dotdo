/**
 * Navigation Configuration
 *
 * Centralized navigation configuration for both app and admin shells.
 * Extracted to allow sharing across mobile/desktop views and provide
 * a single source of truth for navigation items.
 *
 * @example
 * ```tsx
 * import { appNavItems, adminNavItems } from '~/lib/shell/navigation'
 *
 * // Use in a navigation component
 * appNavItems.map(item => (
 *   <NavLink key={item.id} to={item.url} icon={item.icon}>
 *     {item.title}
 *   </NavLink>
 * ))
 * ```
 */

import type { ComponentType } from 'react'
import {
  LayoutDashboard,
  FolderKanban,
  Workflow,
  Settings,
  BarChart3,
  Activity,
  Key,
  Users,
  CreditCard,
} from 'lucide-react'

// =============================================================================
// Types
// =============================================================================

/**
 * Navigation item configuration
 */
export interface NavItem {
  /** Unique identifier for the nav item */
  id: string
  /** Display title */
  title: string
  /** Route URL */
  url: string
  /** Lucide icon component */
  icon: ComponentType<{ className?: string }>
  /** Test ID for E2E tests */
  testId: string
  /** Whether this item should be prefetched on load */
  prefetch?: boolean
  /** Badge count (optional) */
  badge?: number
  /** Keyboard shortcut hint */
  shortcut?: string
}

/**
 * Page metadata for header/title display
 */
export interface PageMeta {
  /** Page title */
  title?: string
  /** Page description (for breadcrumbs/meta) */
  description?: string
}

/**
 * Breadcrumb label mapping for URL segments
 */
export type LabelMap = Record<string, string>

// =============================================================================
// App Navigation Configuration
// =============================================================================

/**
 * Navigation items for the user-facing app shell (/app/*)
 *
 * These are ordered by importance and frequency of use.
 * The first item (Dashboard) is the default landing page.
 *
 * ## Keyboard Shortcuts
 * All shortcuts use the `g` prefix (vim-style "go to" pattern):
 * - `g d` - Dashboard
 * - `g p` - Projects
 * - `g w` - Workflows
 * - `g s` - Settings
 *
 * @see appLabelMap for breadcrumb labels
 * @see appPageMetadata for page titles/descriptions
 */
export const appNavItems: NavItem[] = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    url: '/app',
    icon: LayoutDashboard,
    testId: 'app-nav-dashboard',
    prefetch: true,
    shortcut: 'g d',
  },
  {
    id: 'projects',
    title: 'Projects',
    url: '/app/projects',
    icon: FolderKanban,
    testId: 'app-nav-projects',
    prefetch: true,
    shortcut: 'g p',
  },
  {
    id: 'workflows',
    title: 'Workflows',
    url: '/app/workflows',
    icon: Workflow,
    testId: 'app-nav-workflows',
    shortcut: 'g w',
  },
  {
    id: 'settings',
    title: 'Settings',
    url: '/app/settings',
    icon: Settings,
    testId: 'app-nav-settings',
    shortcut: 'g s',
  },
]

/**
 * Page metadata for app routes
 *
 * Used by PageHeader to display contextual information.
 */
export const appPageMetadata: Record<string, PageMeta> = {
  '/app': { title: 'Dashboard', description: 'Overview of your account' },
  '/app/projects': { title: 'Projects', description: 'Manage your projects' },
  '/app/workflows': { title: 'Workflows', description: 'Manage your workflows' },
  '/app/settings': { title: 'Settings', description: 'Account settings' },
}

/**
 * Label mappings for app breadcrumbs
 */
export const appLabelMap: LabelMap = {
  app: 'Dashboard',
  projects: 'Projects',
  workflows: 'Workflows',
  settings: 'Settings',
}

// =============================================================================
// Admin Navigation Configuration
// =============================================================================

/**
 * Navigation items for the admin shell (/admin/*)
 *
 * These are ordered for administrative workflows:
 * overview > settings > monitoring > integrations > team > billing
 *
 * ## Keyboard Shortcuts
 * All shortcuts use the `g` prefix (vim-style "go to" pattern):
 * - `g o` - Overview (dashboard)
 * - `g s` - Settings
 * - `g r` - Requests (activity)
 * - `g k` - API Keys
 * - `g t` - Team members
 * - `g b` - Billing
 *
 * @see adminLabelMap for breadcrumb labels
 * @see adminPageMetadata for page titles/descriptions
 */
export const adminNavItems: NavItem[] = [
  {
    id: 'overview',
    title: 'Overview',
    url: '/admin',
    icon: BarChart3,
    testId: 'admin-nav-item-overview',
    prefetch: true,
    shortcut: 'g o',
  },
  {
    id: 'settings',
    title: 'Settings',
    url: '/admin/settings',
    icon: Settings,
    testId: 'admin-nav-item-settings',
    shortcut: 'g s',
  },
  {
    id: 'requests',
    title: 'Requests',
    url: '/admin/activity',
    icon: Activity,
    testId: 'admin-nav-item-requests',
    shortcut: 'g r',
  },
  {
    id: 'api-keys',
    title: 'API Keys',
    url: '/admin/integrations/api-keys',
    icon: Key,
    testId: 'admin-nav-item-api-keys',
    shortcut: 'g k',
  },
  {
    id: 'team',
    title: 'Team',
    url: '/admin/users',
    icon: Users,
    testId: 'admin-nav-item-team',
    shortcut: 'g t',
  },
  {
    id: 'billing',
    title: 'Billing',
    url: '/admin/billing',
    icon: CreditCard,
    testId: 'admin-nav-item-billing',
    shortcut: 'g b',
  },
]

/**
 * Page metadata for admin routes
 */
export const adminPageMetadata: Record<string, PageMeta> = {
  '/admin': { title: 'Overview', description: 'Admin dashboard overview' },
  '/admin/settings': { title: 'Settings', description: 'Manage your settings' },
  '/admin/activity': { title: 'Requests', description: 'View request activity' },
  '/admin/integrations/api-keys': { title: 'API Keys', description: 'Manage API keys' },
  '/admin/users': { title: 'Team', description: 'Manage team members' },
  '/admin/billing': { title: 'Billing', description: 'Billing and subscription' },
}

/**
 * Label mappings for admin breadcrumbs
 */
export const adminLabelMap: LabelMap = {
  admin: 'Admin',
  settings: 'Settings',
  activity: 'Requests',
  integrations: 'Integrations',
  'api-keys': 'API Keys',
  users: 'Team',
  billing: 'Billing',
}

// =============================================================================
// Public routes (no auth required)
// =============================================================================

/**
 * Public admin routes that don't require authentication.
 * These paths are checked by AuthGuard to skip auth validation.
 */
export const publicAdminRoutes = [
  '/admin/login',
  '/admin/signup',
  '/admin/reset-password',
]

// =============================================================================
// Route Utilities
// =============================================================================

/**
 * Check if a path matches a nav item's URL (handles exact and prefix matching)
 *
 * @param pathname - Current pathname
 * @param navUrl - Nav item URL to check against
 * @param exact - If true, only match exact path (default: false)
 * @returns Whether the path is active for this nav item
 */
export function isNavItemActive(
  pathname: string,
  navUrl: string,
  exact = false
): boolean {
  // For root routes (/app, /admin), use exact matching
  if (navUrl === '/app' || navUrl === '/admin') {
    return pathname === navUrl || pathname === `${navUrl}/`
  }

  // Otherwise, use prefix matching unless exact is specified
  if (exact) {
    return pathname === navUrl
  }

  return pathname.startsWith(navUrl)
}

/**
 * Get the critical routes that should be prefetched on shell mount
 *
 * @param items - Navigation items array
 * @returns Array of URLs to prefetch
 */
export function getPrefetchRoutes(items: NavItem[]): string[] {
  return items.filter(item => item.prefetch).map(item => item.url)
}

/**
 * Find a nav item by its ID
 *
 * @param items - Navigation items array
 * @param id - Item ID to find
 * @returns The nav item or undefined
 */
export function findNavItem(items: NavItem[], id: string): NavItem | undefined {
  return items.find(item => item.id === id)
}

/**
 * Find a nav item by its URL
 *
 * @param items - Navigation items array
 * @param url - URL to find
 * @returns The nav item or undefined
 */
export function findNavItemByUrl(items: NavItem[], url: string): NavItem | undefined {
  return items.find(item => item.url === url)
}
