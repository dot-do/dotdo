/**
 * Navigation Configuration
 *
 * Centralized navigation configuration for the app shell.
 * Extracted from routes/app/_app.tsx for better maintainability.
 *
 * ## Exports
 * - navItems: Navigation menu items with icons and test IDs
 * - pageMetadata: Page titles and descriptions by route
 * - labelMap: Breadcrumb label mappings
 * - generateBreadcrumbs: Generate breadcrumbs from pathname
 * - prefetchConfig: Route prefetching configuration
 * - drawerVariants: Framer motion variants for mobile drawer
 * - DRAWER_ANIMATION_DURATION: Animation duration constant
 */

import type { ComponentType } from 'react'
import {
  LayoutDashboard,
  FolderKanban,
  Workflow,
  Settings,
} from 'lucide-react'

// =============================================================================
// Types
// =============================================================================

export interface NavItem {
  title: string
  url: string
  icon: ComponentType<{ className?: string }>
  testId: string
}

export interface BreadcrumbItemData {
  label: string
  href?: string
}

export interface PageMeta {
  title: string
  description: string
}

// =============================================================================
// Navigation Items
// =============================================================================

export const navItems: NavItem[] = [
  { title: 'Dashboard', url: '/app', icon: LayoutDashboard, testId: 'app-nav-dashboard' },
  { title: 'Projects', url: '/app/projects', icon: FolderKanban, testId: 'app-nav-projects' },
  { title: 'Workflows', url: '/app/workflows', icon: Workflow, testId: 'app-nav-workflows' },
  { title: 'Settings', url: '/app/settings', icon: Settings, testId: 'app-nav-settings' },
]

// =============================================================================
// Page Metadata
// =============================================================================

export const pageMetadata: Record<string, PageMeta> = {
  '/app': { title: 'Dashboard', description: 'Overview of your account' },
  '/app/projects': { title: 'Projects', description: 'Manage your projects' },
  '/app/workflows': { title: 'Workflows', description: 'Manage your workflows' },
  '/app/settings': { title: 'Settings', description: 'Account settings' },
  '/app/tasks': { title: 'Tasks', description: 'Manage your tasks' },
}

// =============================================================================
// Breadcrumb Configuration
// =============================================================================

export const labelMap: Record<string, string> = {
  app: 'Dashboard',
  projects: 'Projects',
  workflows: 'Workflows',
  settings: 'Settings',
  tasks: 'Tasks',
}

/**
 * Generate breadcrumb items from a pathname
 */
export function generateBreadcrumbs(pathname: string): BreadcrumbItemData[] {
  const segments = pathname.split('/').filter(Boolean)
  const items: BreadcrumbItemData[] = []
  let currentPath = ''

  segments.forEach((segment, index) => {
    currentPath = `${currentPath}/${segment}`
    const isLast = index === segments.length - 1

    // Get label from mappings or format the segment
    let label = labelMap[segment]
    if (!label) {
      // Check if it's a numeric ID
      if (/^\d+$/.test(segment)) {
        label = `#${segment}`
      } else {
        // Capitalize and replace dashes with spaces
        label = segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ')
      }
    }

    // For /app root, always label as Dashboard
    if (segment === 'app' && index === 0) {
      items.push({
        label: 'Dashboard',
        href: isLast ? undefined : '/app',
      })
    } else {
      items.push({
        label,
        href: isLast ? undefined : currentPath,
      })
    }
  })

  return items
}

// =============================================================================
// Route Prefetching Configuration
// =============================================================================

export interface PrefetchConfig {
  /** Enable prefetching on hover intent */
  intent: boolean
  /** Delay before prefetching on hover (ms) */
  hoverDelay: number
  /** Enable prefetching on focus */
  focus: boolean
}

export const prefetchConfig: PrefetchConfig = {
  intent: true,
  hoverDelay: 100,
  focus: true,
}

// =============================================================================
// Mobile Drawer Animation Configuration
// =============================================================================

/** Animation duration for mobile drawer (ms) */
export const DRAWER_ANIMATION_DURATION = 200

/** Framer motion variants for mobile drawer */
export const drawerVariants = {
  open: {
    x: 0,
    opacity: 1,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 30,
      duration: DRAWER_ANIMATION_DURATION / 1000,
    },
  },
  closed: {
    x: '-100%',
    opacity: 0,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 30,
      duration: DRAWER_ANIMATION_DURATION / 1000,
    },
  },
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if a nav item is active based on current path
 */
export function isNavItemActive(itemUrl: string, currentPath: string): boolean {
  if (itemUrl === '/app') {
    return currentPath === '/app'
  }
  return currentPath === itemUrl || currentPath.startsWith(`${itemUrl}/`)
}

/**
 * Get page metadata for a given pathname
 */
export function getPageMeta(pathname: string): PageMeta | undefined {
  return pageMetadata[pathname]
}
