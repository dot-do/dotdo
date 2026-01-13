/**
 * Navigation Prefetch Tests
 *
 * Tests for navigation configuration utilities that support route prefetching.
 * Tests the getPrefetchRoutes and related utilities from shell/navigation.ts
 *
 * @see /app/lib/shell/navigation.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  appNavItems,
  adminNavItems,
  getPrefetchRoutes,
  isNavItemActive,
  findNavItem,
  findNavItemByUrl,
  type NavItem,
} from '../lib/shell/navigation'

// =============================================================================
// Navigation Configuration Tests
// =============================================================================

describe('Navigation Configuration', () => {
  describe('appNavItems', () => {
    it('should have dashboard marked for prefetch', () => {
      const dashboard = appNavItems.find((item) => item.id === 'dashboard')
      expect(dashboard).toBeDefined()
      expect(dashboard?.prefetch).toBe(true)
    })

    it('should have projects marked for prefetch', () => {
      const projects = appNavItems.find((item) => item.id === 'projects')
      expect(projects).toBeDefined()
      expect(projects?.prefetch).toBe(true)
    })

    it('should have correct URLs for all nav items', () => {
      const urls = appNavItems.map((item) => item.url)
      expect(urls).toContain('/app')
      expect(urls).toContain('/app/projects')
      expect(urls).toContain('/app/workflows')
      expect(urls).toContain('/app/settings')
    })

    it('should have testIds for all nav items', () => {
      appNavItems.forEach((item) => {
        expect(item.testId).toBeDefined()
        expect(item.testId).toMatch(/^app-nav-/)
      })
    })
  })

  describe('adminNavItems', () => {
    it('should have overview marked for prefetch', () => {
      const overview = adminNavItems.find((item) => item.id === 'overview')
      expect(overview).toBeDefined()
      expect(overview?.prefetch).toBe(true)
    })

    it('should have correct URLs for critical admin routes', () => {
      const urls = adminNavItems.map((item) => item.url)
      expect(urls).toContain('/admin')
      expect(urls).toContain('/admin/settings')
      expect(urls).toContain('/admin/activity')
    })

    it('should have testIds for all nav items', () => {
      adminNavItems.forEach((item) => {
        expect(item.testId).toBeDefined()
        expect(item.testId).toMatch(/^admin-nav-item-/)
      })
    })
  })
})

// =============================================================================
// getPrefetchRoutes Tests
// =============================================================================

describe('getPrefetchRoutes', () => {
  it('should return only routes marked for prefetch', () => {
    const prefetchRoutes = getPrefetchRoutes(appNavItems)

    // Should include dashboard and projects
    expect(prefetchRoutes).toContain('/app')
    expect(prefetchRoutes).toContain('/app/projects')

    // Should not include workflows and settings (not marked for prefetch)
    expect(prefetchRoutes).not.toContain('/app/workflows')
    expect(prefetchRoutes).not.toContain('/app/settings')
  })

  it('should return empty array for items without prefetch', () => {
    const itemsWithoutPrefetch: NavItem[] = [
      {
        id: 'test1',
        title: 'Test 1',
        url: '/test1',
        icon: () => null,
        testId: 'test-1',
      },
      {
        id: 'test2',
        title: 'Test 2',
        url: '/test2',
        icon: () => null,
        testId: 'test-2',
      },
    ]

    const prefetchRoutes = getPrefetchRoutes(itemsWithoutPrefetch)
    expect(prefetchRoutes).toHaveLength(0)
  })

  it('should return correct admin prefetch routes', () => {
    const prefetchRoutes = getPrefetchRoutes(adminNavItems)

    expect(prefetchRoutes).toContain('/admin')
    // Only routes with prefetch: true should be included
    expect(prefetchRoutes.length).toBeGreaterThanOrEqual(1)
  })

  it('should preserve route order based on nav item order', () => {
    const customItems: NavItem[] = [
      {
        id: 'first',
        title: 'First',
        url: '/first',
        icon: () => null,
        testId: 'first',
        prefetch: true,
      },
      {
        id: 'second',
        title: 'Second',
        url: '/second',
        icon: () => null,
        testId: 'second',
        prefetch: true,
      },
      {
        id: 'third',
        title: 'Third',
        url: '/third',
        icon: () => null,
        testId: 'third',
        prefetch: true,
      },
    ]

    const prefetchRoutes = getPrefetchRoutes(customItems)
    expect(prefetchRoutes).toEqual(['/first', '/second', '/third'])
  })
})

// =============================================================================
// isNavItemActive Tests
// =============================================================================

describe('isNavItemActive', () => {
  it('should match exact root route', () => {
    expect(isNavItemActive('/app', '/app')).toBe(true)
    expect(isNavItemActive('/app/', '/app')).toBe(true)
  })

  it('should not match child routes for root', () => {
    expect(isNavItemActive('/app/projects', '/app')).toBe(false)
    expect(isNavItemActive('/app/settings', '/app')).toBe(false)
  })

  it('should match admin root exactly', () => {
    expect(isNavItemActive('/admin', '/admin')).toBe(true)
    expect(isNavItemActive('/admin/', '/admin')).toBe(true)
    expect(isNavItemActive('/admin/users', '/admin')).toBe(false)
  })

  it('should match child routes with prefix', () => {
    expect(isNavItemActive('/app/projects', '/app/projects')).toBe(true)
    expect(isNavItemActive('/app/projects/123', '/app/projects')).toBe(true)
    expect(isNavItemActive('/app/projects/123/edit', '/app/projects')).toBe(true)
  })

  it('should not match unrelated routes', () => {
    expect(isNavItemActive('/app/workflows', '/app/projects')).toBe(false)
    expect(isNavItemActive('/admin/settings', '/app/settings')).toBe(false)
  })

  it('should support exact matching mode', () => {
    expect(isNavItemActive('/app/projects', '/app/projects', true)).toBe(true)
    expect(isNavItemActive('/app/projects/123', '/app/projects', true)).toBe(false)
  })
})

// =============================================================================
// findNavItem Tests
// =============================================================================

describe('findNavItem', () => {
  it('should find item by id', () => {
    const item = findNavItem(appNavItems, 'dashboard')
    expect(item).toBeDefined()
    expect(item?.title).toBe('Dashboard')
  })

  it('should return undefined for non-existent id', () => {
    const item = findNavItem(appNavItems, 'non-existent')
    expect(item).toBeUndefined()
  })
})

// =============================================================================
// findNavItemByUrl Tests
// =============================================================================

describe('findNavItemByUrl', () => {
  it('should find item by url', () => {
    const item = findNavItemByUrl(appNavItems, '/app')
    expect(item).toBeDefined()
    expect(item?.id).toBe('dashboard')
  })

  it('should return undefined for non-existent url', () => {
    const item = findNavItemByUrl(appNavItems, '/non-existent')
    expect(item).toBeUndefined()
  })
})

// =============================================================================
// Prefetch Strategy Tests
// =============================================================================

describe('Prefetch Strategy', () => {
  it('should have high priority routes (prefetch: true) for critical pages', () => {
    // Critical app routes should be prefetched
    const criticalAppRoutes = ['/app', '/app/projects']
    const appPrefetchRoutes = getPrefetchRoutes(appNavItems)

    criticalAppRoutes.forEach((route) => {
      expect(appPrefetchRoutes).toContain(route)
    })
  })

  it('should not prefetch all routes to avoid unnecessary network usage', () => {
    const appPrefetchRoutes = getPrefetchRoutes(appNavItems)
    const adminPrefetchRoutes = getPrefetchRoutes(adminNavItems)

    // Should not prefetch all routes
    expect(appPrefetchRoutes.length).toBeLessThan(appNavItems.length)
    expect(adminPrefetchRoutes.length).toBeLessThanOrEqual(adminNavItems.length)
  })

  it('should include keyboard shortcuts for quick navigation', () => {
    const dashboardItem = findNavItem(appNavItems, 'dashboard')
    expect(dashboardItem?.shortcut).toBe('g d')

    const projectsItem = findNavItem(appNavItems, 'projects')
    expect(projectsItem?.shortcut).toBe('g p')
  })
})
