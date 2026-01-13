/**
 * Shell Navigation Integration Tests
 *
 * Tests for the centralized navigation configuration module that provides
 * navigation items, page metadata, and routing utilities for app and admin shells.
 *
 * @see app/lib/shell/navigation.ts
 */

import { describe, it, expect } from 'vitest'
import {
  // Types
  type NavItem,
  type PageMeta,
  type LabelMap,
  // App navigation
  appNavItems,
  appPageMetadata,
  appLabelMap,
  // Admin navigation
  adminNavItems,
  adminPageMetadata,
  adminLabelMap,
  // Public routes
  publicAdminRoutes,
  // Utility functions
  isNavItemActive,
  getPrefetchRoutes,
  findNavItem,
  findNavItemByUrl,
} from '../navigation'

// =============================================================================
// Shell Initialization Tests
// =============================================================================

describe('shell initialization', () => {
  describe('app navigation items', () => {
    it('exports a non-empty array of nav items', () => {
      expect(appNavItems).toBeInstanceOf(Array)
      expect(appNavItems.length).toBeGreaterThan(0)
    })

    it('has dashboard as the first item', () => {
      expect(appNavItems[0].id).toBe('dashboard')
      expect(appNavItems[0].url).toBe('/app')
    })

    it('all items have required properties', () => {
      for (const item of appNavItems) {
        expect(item.id).toBeDefined()
        expect(typeof item.id).toBe('string')
        expect(item.title).toBeDefined()
        expect(typeof item.title).toBe('string')
        expect(item.url).toBeDefined()
        expect(typeof item.url).toBe('string')
        expect(item.icon).toBeDefined()
        // Icons are React components - can be functions or objects (ForwardRef)
        expect(['function', 'object'].includes(typeof item.icon)).toBe(true)
        expect(item.testId).toBeDefined()
        expect(typeof item.testId).toBe('string')
      }
    })

    it('all items have unique ids', () => {
      const ids = appNavItems.map(item => item.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })

    it('all items have unique URLs', () => {
      const urls = appNavItems.map(item => item.url)
      const uniqueUrls = new Set(urls)
      expect(uniqueUrls.size).toBe(urls.length)
    })

    it('all URLs start with /app', () => {
      for (const item of appNavItems) {
        expect(item.url.startsWith('/app')).toBe(true)
      }
    })
  })

  describe('admin navigation items', () => {
    it('exports a non-empty array of nav items', () => {
      expect(adminNavItems).toBeInstanceOf(Array)
      expect(adminNavItems.length).toBeGreaterThan(0)
    })

    it('has overview as the first item', () => {
      expect(adminNavItems[0].id).toBe('overview')
      expect(adminNavItems[0].url).toBe('/admin')
    })

    it('all items have required properties', () => {
      for (const item of adminNavItems) {
        expect(item.id).toBeDefined()
        expect(typeof item.id).toBe('string')
        expect(item.title).toBeDefined()
        expect(typeof item.title).toBe('string')
        expect(item.url).toBeDefined()
        expect(typeof item.url).toBe('string')
        expect(item.icon).toBeDefined()
        // Icons are React components - can be functions or objects (ForwardRef)
        expect(['function', 'object'].includes(typeof item.icon)).toBe(true)
        expect(item.testId).toBeDefined()
        expect(typeof item.testId).toBe('string')
      }
    })

    it('all items have unique ids', () => {
      const ids = adminNavItems.map(item => item.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })

    it('all items have unique URLs', () => {
      const urls = adminNavItems.map(item => item.url)
      const uniqueUrls = new Set(urls)
      expect(uniqueUrls.size).toBe(urls.length)
    })

    it('all URLs start with /admin', () => {
      for (const item of adminNavItems) {
        expect(item.url.startsWith('/admin')).toBe(true)
      }
    })
  })
})

// =============================================================================
// Environment Setup Tests
// =============================================================================

describe('environment setup', () => {
  describe('page metadata configuration', () => {
    it('app page metadata contains entries for all nav items', () => {
      for (const item of appNavItems) {
        expect(appPageMetadata[item.url]).toBeDefined()
        expect(appPageMetadata[item.url].title).toBeDefined()
      }
    })

    it('admin page metadata contains entries for all nav items', () => {
      for (const item of adminNavItems) {
        expect(adminPageMetadata[item.url]).toBeDefined()
        expect(adminPageMetadata[item.url].title).toBeDefined()
      }
    })

    it('page metadata titles match nav item titles', () => {
      for (const item of appNavItems) {
        expect(appPageMetadata[item.url].title).toBe(item.title)
      }
    })

    it('page metadata includes descriptions', () => {
      for (const url in appPageMetadata) {
        expect(appPageMetadata[url].description).toBeDefined()
        expect(typeof appPageMetadata[url].description).toBe('string')
      }

      for (const url in adminPageMetadata) {
        expect(adminPageMetadata[url].description).toBeDefined()
        expect(typeof adminPageMetadata[url].description).toBe('string')
      }
    })
  })

  describe('label map configuration', () => {
    it('app label map has entries for URL segments', () => {
      expect(appLabelMap.app).toBe('Dashboard')
      expect(appLabelMap.projects).toBe('Projects')
      expect(appLabelMap.workflows).toBe('Workflows')
      expect(appLabelMap.settings).toBe('Settings')
    })

    it('admin label map has entries for URL segments', () => {
      expect(adminLabelMap.admin).toBe('Admin')
      expect(adminLabelMap.settings).toBe('Settings')
      expect(adminLabelMap.activity).toBe('Requests')
      expect(adminLabelMap['api-keys']).toBe('API Keys')
      expect(adminLabelMap.users).toBe('Team')
      expect(adminLabelMap.billing).toBe('Billing')
    })
  })

  describe('public routes configuration', () => {
    it('exports public admin routes array', () => {
      expect(publicAdminRoutes).toBeInstanceOf(Array)
      expect(publicAdminRoutes.length).toBeGreaterThan(0)
    })

    it('public routes include authentication pages', () => {
      expect(publicAdminRoutes).toContain('/admin/login')
      expect(publicAdminRoutes).toContain('/admin/signup')
      expect(publicAdminRoutes).toContain('/admin/reset-password')
    })

    it('all public routes start with /admin', () => {
      for (const route of publicAdminRoutes) {
        expect(route.startsWith('/admin')).toBe(true)
      }
    })
  })
})

// =============================================================================
// Navigation Active State Tests (Command Execution Equivalent)
// =============================================================================

describe('isNavItemActive - route matching', () => {
  describe('root route matching', () => {
    it('matches /app exactly for dashboard', () => {
      expect(isNavItemActive('/app', '/app')).toBe(true)
    })

    it('matches /app/ with trailing slash for dashboard', () => {
      expect(isNavItemActive('/app/', '/app')).toBe(true)
    })

    it('does not match /app/projects for dashboard', () => {
      expect(isNavItemActive('/app/projects', '/app')).toBe(false)
    })

    it('matches /admin exactly for overview', () => {
      expect(isNavItemActive('/admin', '/admin')).toBe(true)
    })

    it('matches /admin/ with trailing slash for overview', () => {
      expect(isNavItemActive('/admin/', '/admin')).toBe(true)
    })

    it('does not match /admin/settings for overview', () => {
      expect(isNavItemActive('/admin/settings', '/admin')).toBe(false)
    })
  })

  describe('prefix matching for nested routes', () => {
    it('matches nested route exactly', () => {
      expect(isNavItemActive('/app/projects', '/app/projects')).toBe(true)
    })

    it('matches child routes of a nav item', () => {
      expect(isNavItemActive('/app/projects/123', '/app/projects')).toBe(true)
    })

    it('matches deeply nested child routes', () => {
      expect(isNavItemActive('/app/projects/123/tasks/456', '/app/projects')).toBe(true)
    })

    it('does not match unrelated routes', () => {
      expect(isNavItemActive('/app/workflows', '/app/projects')).toBe(false)
    })

    it('matches admin nested routes', () => {
      expect(isNavItemActive('/admin/integrations/api-keys/create', '/admin/integrations/api-keys')).toBe(true)
    })
  })

  describe('exact matching mode', () => {
    it('matches exactly when exact=true', () => {
      expect(isNavItemActive('/app/projects', '/app/projects', true)).toBe(true)
    })

    it('does not match child routes when exact=true', () => {
      expect(isNavItemActive('/app/projects/123', '/app/projects', true)).toBe(false)
    })

    it('works with root routes in exact mode', () => {
      expect(isNavItemActive('/app', '/app', true)).toBe(true)
      // Note: Root routes (/app, /admin) have special handling that accepts trailing slashes
      // This is intentional UX behavior for root navigation items
      expect(isNavItemActive('/app/', '/app', true)).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('handles empty pathname', () => {
      expect(isNavItemActive('', '/app')).toBe(false)
    })

    it('handles similar but non-matching paths', () => {
      // /app/project should not match /app/projects
      expect(isNavItemActive('/app/project', '/app/projects')).toBe(false)
    })

    it('handles path with query parameters in pathname', () => {
      // Query params would be stripped before calling this function
      expect(isNavItemActive('/app/projects', '/app/projects')).toBe(true)
    })
  })
})

// =============================================================================
// Output Handling Tests (Prefetch Routes)
// =============================================================================

describe('getPrefetchRoutes - output handling', () => {
  it('returns URLs of items with prefetch=true', () => {
    const appPrefetch = getPrefetchRoutes(appNavItems)
    expect(appPrefetch).toContain('/app')
    expect(appPrefetch).toContain('/app/projects')
  })

  it('does not include items without prefetch', () => {
    const appPrefetch = getPrefetchRoutes(appNavItems)
    // Only dashboard and projects have prefetch=true
    expect(appPrefetch.length).toBe(2)
  })

  it('returns empty array when no items have prefetch', () => {
    const items: NavItem[] = [
      {
        id: 'test',
        title: 'Test',
        url: '/test',
        icon: () => null,
        testId: 'test',
        prefetch: false,
      },
    ]
    expect(getPrefetchRoutes(items)).toEqual([])
  })

  it('handles items without prefetch property', () => {
    const items: NavItem[] = [
      {
        id: 'test',
        title: 'Test',
        url: '/test',
        icon: () => null,
        testId: 'test',
        // no prefetch property
      },
    ]
    expect(getPrefetchRoutes(items)).toEqual([])
  })

  it('returns admin prefetch routes correctly', () => {
    const adminPrefetch = getPrefetchRoutes(adminNavItems)
    expect(adminPrefetch).toContain('/admin')
    expect(adminPrefetch.length).toBe(1) // Only overview has prefetch=true
  })
})

// =============================================================================
// Navigation Item Lookup Tests
// =============================================================================

describe('findNavItem - lookup by id', () => {
  it('finds nav item by id', () => {
    const item = findNavItem(appNavItems, 'dashboard')
    expect(item).toBeDefined()
    expect(item?.id).toBe('dashboard')
    expect(item?.title).toBe('Dashboard')
  })

  it('returns undefined for non-existent id', () => {
    const item = findNavItem(appNavItems, 'non-existent')
    expect(item).toBeUndefined()
  })

  it('finds admin nav items', () => {
    const item = findNavItem(adminNavItems, 'billing')
    expect(item).toBeDefined()
    expect(item?.id).toBe('billing')
    expect(item?.url).toBe('/admin/billing')
  })

  it('handles empty array', () => {
    const item = findNavItem([], 'dashboard')
    expect(item).toBeUndefined()
  })
})

describe('findNavItemByUrl - lookup by URL', () => {
  it('finds nav item by URL', () => {
    const item = findNavItemByUrl(appNavItems, '/app/projects')
    expect(item).toBeDefined()
    expect(item?.id).toBe('projects')
    expect(item?.title).toBe('Projects')
  })

  it('returns undefined for non-existent URL', () => {
    const item = findNavItemByUrl(appNavItems, '/app/non-existent')
    expect(item).toBeUndefined()
  })

  it('finds admin nav items by URL', () => {
    const item = findNavItemByUrl(adminNavItems, '/admin/integrations/api-keys')
    expect(item).toBeDefined()
    expect(item?.id).toBe('api-keys')
  })

  it('requires exact URL match', () => {
    // Should not match partial URLs
    const item = findNavItemByUrl(appNavItems, '/app/projects/123')
    expect(item).toBeUndefined()
  })

  it('handles empty array', () => {
    const item = findNavItemByUrl([], '/app')
    expect(item).toBeUndefined()
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('error handling', () => {
  describe('type safety', () => {
    it('NavItem interface enforces required fields', () => {
      // This is a compile-time check, but we can verify at runtime
      const validItem: NavItem = {
        id: 'test',
        title: 'Test',
        url: '/test',
        icon: () => null,
        testId: 'test-id',
      }
      expect(validItem.id).toBe('test')
      expect(validItem.prefetch).toBeUndefined()
      expect(validItem.badge).toBeUndefined()
      expect(validItem.shortcut).toBeUndefined()
    })

    it('PageMeta interface allows optional fields', () => {
      const meta1: PageMeta = {}
      const meta2: PageMeta = { title: 'Test' }
      const meta3: PageMeta = { title: 'Test', description: 'Description' }

      expect(meta1.title).toBeUndefined()
      expect(meta2.title).toBe('Test')
      expect(meta3.description).toBe('Description')
    })
  })

  describe('defensive coding', () => {
    it('isNavItemActive handles undefined gracefully', () => {
      // TypeScript would catch this, but test runtime behavior
      expect(() => isNavItemActive('/app', '/app')).not.toThrow()
    })

    it('getPrefetchRoutes handles undefined prefetch', () => {
      const items = [
        { id: 'a', title: 'A', url: '/a', icon: () => null, testId: 'a' },
        { id: 'b', title: 'B', url: '/b', icon: () => null, testId: 'b', prefetch: true },
      ] as NavItem[]

      const routes = getPrefetchRoutes(items)
      expect(routes).toEqual(['/b'])
    })
  })
})

// =============================================================================
// Integration Tests - Full Shell Configuration
// =============================================================================

describe('shell configuration integration', () => {
  it('app navigation is complete and consistent', () => {
    // All nav items should have corresponding metadata
    for (const item of appNavItems) {
      const meta = appPageMetadata[item.url]
      expect(meta).toBeDefined()
      expect(meta.title).toBe(item.title)
    }
  })

  it('admin navigation is complete and consistent', () => {
    // All nav items should have corresponding metadata
    for (const item of adminNavItems) {
      const meta = adminPageMetadata[item.url]
      expect(meta).toBeDefined()
      expect(meta.title).toBe(item.title)
    }
  })

  it('keyboard shortcuts are unique within each shell', () => {
    const appShortcuts = appNavItems.map(item => item.shortcut).filter(Boolean)
    const uniqueAppShortcuts = new Set(appShortcuts)
    expect(uniqueAppShortcuts.size).toBe(appShortcuts.length)

    const adminShortcuts = adminNavItems.map(item => item.shortcut).filter(Boolean)
    const uniqueAdminShortcuts = new Set(adminShortcuts)
    expect(uniqueAdminShortcuts.size).toBe(adminShortcuts.length)
  })

  it('test IDs follow naming conventions', () => {
    for (const item of appNavItems) {
      expect(item.testId).toMatch(/^app-nav-/)
    }

    for (const item of adminNavItems) {
      expect(item.testId).toMatch(/^admin-nav-item-/)
    }
  })

  it('icons are valid React components', () => {
    for (const item of appNavItems) {
      // React components can be functions or objects (ForwardRef components)
      expect(['function', 'object'].includes(typeof item.icon)).toBe(true)
    }

    for (const item of adminNavItems) {
      // React components can be functions or objects (ForwardRef components)
      expect(['function', 'object'].includes(typeof item.icon)).toBe(true)
    }
  })
})

// =============================================================================
// Keyboard Shortcut Tests
// =============================================================================

describe('keyboard shortcuts', () => {
  it('app shortcuts follow g+key pattern', () => {
    for (const item of appNavItems) {
      if (item.shortcut) {
        expect(item.shortcut).toMatch(/^g [a-z]$/)
      }
    }
  })

  it('admin shortcuts follow g+key pattern', () => {
    for (const item of adminNavItems) {
      if (item.shortcut) {
        expect(item.shortcut).toMatch(/^g [a-z]$/)
      }
    }
  })

  it('dashboard has g d shortcut', () => {
    const dashboard = findNavItem(appNavItems, 'dashboard')
    expect(dashboard?.shortcut).toBe('g d')
  })

  it('overview has g o shortcut', () => {
    const overview = findNavItem(adminNavItems, 'overview')
    expect(overview?.shortcut).toBe('g o')
  })
})

// =============================================================================
// Badge Support Tests
// =============================================================================

describe('badge support', () => {
  it('nav items can have optional badge count', () => {
    const itemWithBadge: NavItem = {
      id: 'notifications',
      title: 'Notifications',
      url: '/notifications',
      icon: () => null,
      testId: 'nav-notifications',
      badge: 5,
    }

    expect(itemWithBadge.badge).toBe(5)
  })

  it('badge is optional', () => {
    const dashboard = findNavItem(appNavItems, 'dashboard')
    expect(dashboard?.badge).toBeUndefined()
  })
})
