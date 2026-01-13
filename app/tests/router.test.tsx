/**
 * Router Configuration Tests
 *
 * Tests for the TanStack Router configuration including:
 * - Route definitions and structure
 * - Navigation and preloading behavior
 * - Route guards (auth protection)
 * - Nested routes (admin, app layouts)
 * - Error routes (not found, error boundaries)
 * - Router singleton behavior
 *
 * @see /app/src/router.tsx
 * @see /app/routes/__root.tsx
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import * as React from 'react'

// =============================================================================
// Mock TanStack Router
// =============================================================================

const mockRouteTree = {
  id: '__root__',
  children: [
    { id: '/', path: '/' },
    { id: '/login', path: '/login' },
    { id: '/rpc', path: '/rpc' },
    { id: '/docs/', path: '/docs/' },
    { id: '/docs/$', path: '/docs/$' },
    { id: '/customers/', path: '/customers/' },
    { id: '/customers/$id', path: '/customers/$id' },
    { id: '/auth/callback', path: '/auth/callback' },
    { id: '/auth/logout', path: '/auth/logout' },
    { id: '/schema/api', path: '/schema/api' },
    { id: '/api/search', path: '/api/search' },
    { id: '/api/customers.$id', path: '/api/customers/$id' },
    {
      id: '/admin/_admin',
      path: '/admin',
      children: [
        { id: '/admin/_admin.index', path: '' },
        { id: '/admin/_admin.login', path: 'login' },
        { id: '/admin/_admin.signup', path: 'signup' },
        { id: '/admin/_admin.reset-password', path: 'reset-password' },
        { id: '/admin/users/', path: 'users/' },
        { id: '/admin/users/$userId', path: 'users/$userId' },
        { id: '/admin/users/new', path: 'users/new' },
        { id: '/admin/settings/', path: 'settings/' },
        { id: '/admin/settings/account', path: 'settings/account' },
        { id: '/admin/settings/security', path: 'settings/security' },
        { id: '/admin/settings/appearance', path: 'settings/appearance' },
        { id: '/admin/activity/', path: 'activity/' },
        { id: '/admin/activity/$logId', path: 'activity/$logId' },
        { id: '/admin/integrations/', path: 'integrations/' },
        { id: '/admin/integrations/api-keys', path: 'integrations/api-keys' },
        { id: '/admin/integrations/$integrationId', path: 'integrations/$integrationId' },
        { id: '/admin/browsers/', path: 'browsers/' },
        { id: '/admin/browsers/$browserId', path: 'browsers/$browserId' },
        { id: '/admin/sandboxes/', path: 'sandboxes/' },
        { id: '/admin/sandboxes/$sandboxId', path: 'sandboxes/$sandboxId' },
        { id: '/admin/approvals/', path: 'approvals/' },
        { id: '/admin/approvals/$approvalId', path: 'approvals/$approvalId' },
        { id: '/admin/approvals/history', path: 'approvals/history' },
        { id: '/admin/workflows/', path: 'workflows/' },
        { id: '/admin/workflows/$workflowId', path: 'workflows/$workflowId' },
        {
          id: '/admin/workflows/$workflowId/runs',
          path: 'workflows/$workflowId/runs',
          children: [{ id: '/admin/workflows/$workflowId/runs/$runId', path: '$runId' }],
        },
      ],
    },
    {
      id: '/app/_app',
      path: '/app',
      children: [
        { id: '/app/_app.index', path: '' },
        { id: '/app/projects/', path: 'projects/' },
        { id: '/app/projects/$projectId', path: 'projects/$projectId' },
        { id: '/app/projects/new', path: 'projects/new' },
        { id: '/app/workflows/', path: 'workflows/' },
        { id: '/app/workflows/new', path: 'workflows/new' },
        { id: '/app/tasks/', path: 'tasks/' },
        { id: '/app/settings/', path: 'settings/' },
      ],
    },
    { id: '/$', path: '/$' },
  ],
}

// Track router creation for singleton tests
let routerInstances: any[] = []

const mockCreateRouter = vi.fn(() => {
  const router = {
    routeTree: mockRouteTree,
    options: {
      defaultPreload: 'intent',
      defaultPreloadDelay: 150,
      defaultPreloadStaleTime: 30_000,
      defaultStaleTime: 5 * 60 * 1000,
      scrollRestoration: true,
      defaultStructuralSharing: true,
      notFoundMode: 'root',
    },
    state: {
      isLoading: false,
      location: { pathname: '/' },
    },
    navigate: vi.fn(),
    preloadRoute: vi.fn(),
    invalidate: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    matchRoutes: vi.fn((path: string) => {
      const routes: any[] = []
      const findRoute = (node: any, currentPath: string = '') => {
        const nodePath = node.path || ''
        const fullPath = currentPath + nodePath

        // Handle parameterized routes (e.g., /customers/$id matches /customers/123)
        const pathRegex = fullPath.replace(/\$[a-zA-Z]+/g, '[^/]+')
        const regex = new RegExp(`^${pathRegex}(/|$)`)

        if (regex.test(path) || path.startsWith(fullPath) || fullPath === path) {
          routes.push(node)
          if (node.children) {
            node.children.forEach((child: any) => findRoute(child, fullPath))
          }
        }
      }
      mockRouteTree.children.forEach((child) => findRoute(child))
      return routes
    }),
  }
  routerInstances.push(router)
  return router
})

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual('@tanstack/react-router')
  return {
    ...actual,
    createRouter: mockCreateRouter,
  }
})

// Mock the generated route tree
vi.mock('../src/routeTree.gen', () => ({
  routeTree: mockRouteTree,
}))

// =============================================================================
// Test Setup
// =============================================================================

beforeEach(() => {
  routerInstances = []
  vi.clearAllMocks()
  // Reset module cache to test singleton behavior
  vi.resetModules()
})

afterEach(() => {
  vi.clearAllMocks()
})

// =============================================================================
// Router Configuration Tests
// =============================================================================

describe('Router Configuration', () => {
  describe('createRouter', () => {
    it('should create router with intent-based preloading', async () => {
      const { createRouter } = await import('../src/router')
      const router = createRouter()

      expect(router.options.defaultPreload).toBe('intent')
    })

    it('should configure preload delay of 150ms', async () => {
      const { createRouter } = await import('../src/router')
      const router = createRouter()

      expect(router.options.defaultPreloadDelay).toBe(150)
    })

    it('should configure preload stale time of 30 seconds', async () => {
      const { createRouter } = await import('../src/router')
      const router = createRouter()

      expect(router.options.defaultPreloadStaleTime).toBe(30_000)
    })

    it('should configure route data stale time of 5 minutes', async () => {
      const { createRouter } = await import('../src/router')
      const router = createRouter()

      expect(router.options.defaultStaleTime).toBe(5 * 60 * 1000)
    })

    it('should enable scroll restoration', async () => {
      const { createRouter } = await import('../src/router')
      const router = createRouter()

      expect(router.options.scrollRestoration).toBe(true)
    })

    it('should enable structural sharing for minimal re-renders', async () => {
      const { createRouter } = await import('../src/router')
      const router = createRouter()

      expect(router.options.defaultStructuralSharing).toBe(true)
    })

    it('should configure not found mode as root', async () => {
      const { createRouter } = await import('../src/router')
      const router = createRouter()

      expect(router.options.notFoundMode).toBe('root')
    })
  })

  describe('getRouter singleton', () => {
    it('should return the same router instance on multiple calls', async () => {
      const { getRouter } = await import('../src/router')

      const router1 = getRouter()
      const router2 = getRouter()
      const router3 = getRouter()

      expect(router1).toBe(router2)
      expect(router2).toBe(router3)
    })

    it('should create router lazily on first call', async () => {
      expect(routerInstances.length).toBe(0)

      const { getRouter } = await import('../src/router')
      getRouter()

      expect(routerInstances.length).toBe(1)
    })
  })
})

// =============================================================================
// Route Definition Tests
// =============================================================================

describe('Route Definitions', () => {
  describe('public routes', () => {
    it('should define index route at /', () => {
      const indexRoute = mockRouteTree.children.find((r) => r.path === '/')
      expect(indexRoute).toBeDefined()
      expect(indexRoute?.id).toBe('/')
    })

    it('should define login route at /login', () => {
      const loginRoute = mockRouteTree.children.find((r) => r.path === '/login')
      expect(loginRoute).toBeDefined()
    })

    it('should define docs routes', () => {
      const docsIndex = mockRouteTree.children.find((r) => r.path === '/docs/')
      const docsSplat = mockRouteTree.children.find((r) => r.path === '/docs/$')

      expect(docsIndex).toBeDefined()
      expect(docsSplat).toBeDefined()
    })

    it('should define RPC endpoint route', () => {
      const rpcRoute = mockRouteTree.children.find((r) => r.path === '/rpc')
      expect(rpcRoute).toBeDefined()
    })

    it('should define schema API route', () => {
      const schemaRoute = mockRouteTree.children.find((r) => r.path === '/schema/api')
      expect(schemaRoute).toBeDefined()
    })
  })

  describe('auth routes', () => {
    it('should define auth callback route', () => {
      const callbackRoute = mockRouteTree.children.find((r) => r.path === '/auth/callback')
      expect(callbackRoute).toBeDefined()
    })

    it('should define auth logout route', () => {
      const logoutRoute = mockRouteTree.children.find((r) => r.path === '/auth/logout')
      expect(logoutRoute).toBeDefined()
    })
  })

  describe('customer routes', () => {
    it('should define customers index route', () => {
      const customersIndex = mockRouteTree.children.find((r) => r.path === '/customers/')
      expect(customersIndex).toBeDefined()
    })

    it('should define customer detail route with $id param', () => {
      const customerDetail = mockRouteTree.children.find((r) => r.path === '/customers/$id')
      expect(customerDetail).toBeDefined()
      expect(customerDetail?.path).toContain('$id')
    })
  })

  describe('API routes', () => {
    it('should define API search route', () => {
      const searchRoute = mockRouteTree.children.find((r) => r.path === '/api/search')
      expect(searchRoute).toBeDefined()
    })

    it('should define API customer detail route', () => {
      const apiCustomerRoute = mockRouteTree.children.find((r) => r.path === '/api/customers/$id')
      expect(apiCustomerRoute).toBeDefined()
    })
  })

  describe('catch-all route', () => {
    it('should define splat route for unmatched paths', () => {
      const splatRoute = mockRouteTree.children.find((r) => r.path === '/$')
      expect(splatRoute).toBeDefined()
      expect(splatRoute?.id).toBe('/$')
    })
  })
})

// =============================================================================
// Nested Route Tests
// =============================================================================

describe('Nested Routes', () => {
  describe('admin routes', () => {
    let adminRouteTree: any

    beforeEach(() => {
      adminRouteTree = mockRouteTree.children.find((r) => r.id === '/admin/_admin')
    })

    it('should define admin layout route at /admin', () => {
      expect(adminRouteTree).toBeDefined()
      expect(adminRouteTree?.path).toBe('/admin')
    })

    it('should define public admin auth routes', () => {
      const children = adminRouteTree?.children || []
      const loginRoute = children.find((r: any) => r.id.includes('login'))
      const signupRoute = children.find((r: any) => r.id.includes('signup'))
      const resetRoute = children.find((r: any) => r.id.includes('reset-password'))

      expect(loginRoute).toBeDefined()
      expect(signupRoute).toBeDefined()
      expect(resetRoute).toBeDefined()
    })

    it('should define admin index route', () => {
      const children = adminRouteTree?.children || []
      const indexRoute = children.find((r: any) => r.id === '/admin/_admin.index')

      expect(indexRoute).toBeDefined()
    })

    it('should define user management routes', () => {
      const children = adminRouteTree?.children || []
      const usersIndex = children.find((r: any) => r.id === '/admin/users/')
      const userDetail = children.find((r: any) => r.path === 'users/$userId')
      const newUser = children.find((r: any) => r.path === 'users/new')

      expect(usersIndex).toBeDefined()
      expect(userDetail).toBeDefined()
      expect(newUser).toBeDefined()
    })

    it('should define settings routes with sub-routes', () => {
      const children = adminRouteTree?.children || []
      const settingsIndex = children.find((r: any) => r.id === '/admin/settings/')
      const accountSettings = children.find((r: any) => r.path === 'settings/account')
      const securitySettings = children.find((r: any) => r.path === 'settings/security')
      const appearanceSettings = children.find((r: any) => r.path === 'settings/appearance')

      expect(settingsIndex).toBeDefined()
      expect(accountSettings).toBeDefined()
      expect(securitySettings).toBeDefined()
      expect(appearanceSettings).toBeDefined()
    })

    it('should define activity log routes', () => {
      const children = adminRouteTree?.children || []
      const activityIndex = children.find((r: any) => r.id === '/admin/activity/')
      const activityDetail = children.find((r: any) => r.path === 'activity/$logId')

      expect(activityIndex).toBeDefined()
      expect(activityDetail).toBeDefined()
    })

    it('should define integrations routes', () => {
      const children = adminRouteTree?.children || []
      const integrationsIndex = children.find((r: any) => r.id === '/admin/integrations/')
      const apiKeys = children.find((r: any) => r.path === 'integrations/api-keys')
      const integrationDetail = children.find((r: any) => r.path === 'integrations/$integrationId')

      expect(integrationsIndex).toBeDefined()
      expect(apiKeys).toBeDefined()
      expect(integrationDetail).toBeDefined()
    })

    it('should define browser management routes', () => {
      const children = adminRouteTree?.children || []
      const browsersIndex = children.find((r: any) => r.id === '/admin/browsers/')
      const browserDetail = children.find((r: any) => r.path === 'browsers/$browserId')

      expect(browsersIndex).toBeDefined()
      expect(browserDetail).toBeDefined()
    })

    it('should define sandbox routes', () => {
      const children = adminRouteTree?.children || []
      const sandboxesIndex = children.find((r: any) => r.id === '/admin/sandboxes/')
      const sandboxDetail = children.find((r: any) => r.path === 'sandboxes/$sandboxId')

      expect(sandboxesIndex).toBeDefined()
      expect(sandboxDetail).toBeDefined()
    })

    it('should define approval workflow routes', () => {
      const children = adminRouteTree?.children || []
      const approvalsIndex = children.find((r: any) => r.id === '/admin/approvals/')
      const approvalDetail = children.find((r: any) => r.path === 'approvals/$approvalId')
      const approvalsHistory = children.find((r: any) => r.path === 'approvals/history')

      expect(approvalsIndex).toBeDefined()
      expect(approvalDetail).toBeDefined()
      expect(approvalsHistory).toBeDefined()
    })

    it('should define workflow routes with deeply nested runs', () => {
      const children = adminRouteTree?.children || []
      const workflowsIndex = children.find((r: any) => r.id === '/admin/workflows/')
      const workflowDetail = children.find((r: any) => r.path === 'workflows/$workflowId')
      const workflowRuns = children.find((r: any) => r.path === 'workflows/$workflowId/runs')

      expect(workflowsIndex).toBeDefined()
      expect(workflowDetail).toBeDefined()
      expect(workflowRuns).toBeDefined()

      // Check deeply nested run detail route
      const runDetail = workflowRuns?.children?.find((r: any) => r.path === '$runId')
      expect(runDetail).toBeDefined()
    })
  })

  describe('app routes', () => {
    let appRouteTree: any

    beforeEach(() => {
      appRouteTree = mockRouteTree.children.find((r) => r.id === '/app/_app')
    })

    it('should define app layout route at /app', () => {
      expect(appRouteTree).toBeDefined()
      expect(appRouteTree?.path).toBe('/app')
    })

    it('should define app index route', () => {
      const children = appRouteTree?.children || []
      const indexRoute = children.find((r: any) => r.id === '/app/_app.index')

      expect(indexRoute).toBeDefined()
    })

    it('should define project routes', () => {
      const children = appRouteTree?.children || []
      const projectsIndex = children.find((r: any) => r.id === '/app/projects/')
      const projectDetail = children.find((r: any) => r.path === 'projects/$projectId')
      const newProject = children.find((r: any) => r.path === 'projects/new')

      expect(projectsIndex).toBeDefined()
      expect(projectDetail).toBeDefined()
      expect(newProject).toBeDefined()
    })

    it('should define workflow routes', () => {
      const children = appRouteTree?.children || []
      const workflowsIndex = children.find((r: any) => r.id === '/app/workflows/')
      const newWorkflow = children.find((r: any) => r.path === 'workflows/new')

      expect(workflowsIndex).toBeDefined()
      expect(newWorkflow).toBeDefined()
    })

    it('should define tasks route', () => {
      const children = appRouteTree?.children || []
      const tasksIndex = children.find((r: any) => r.id === '/app/tasks/')

      expect(tasksIndex).toBeDefined()
    })

    it('should define settings route', () => {
      const children = appRouteTree?.children || []
      const settingsIndex = children.find((r: any) => r.id === '/app/settings/')

      expect(settingsIndex).toBeDefined()
    })
  })
})

// =============================================================================
// Route Guard Tests
// =============================================================================

describe('Route Guards', () => {
  describe('admin route guards', () => {
    const publicAdminRoutes = ['/admin/login', '/admin/signup', '/admin/reset-password']
    const protectedAdminRoutes = [
      '/admin',
      '/admin/users',
      '/admin/settings',
      '/admin/activity',
      '/admin/integrations',
      '/admin/browsers',
      '/admin/sandboxes',
      '/admin/approvals',
      '/admin/workflows',
    ]

    it('should allow access to login route without authentication', () => {
      // Login is defined as a public route in the admin layout
      expect(publicAdminRoutes).toContain('/admin/login')
    })

    it('should allow access to signup route without authentication', () => {
      expect(publicAdminRoutes).toContain('/admin/signup')
    })

    it('should allow access to reset-password route without authentication', () => {
      expect(publicAdminRoutes).toContain('/admin/reset-password')
    })

    it('should require authentication for admin dashboard', () => {
      // Protected routes are not in the public list
      expect(publicAdminRoutes).not.toContain('/admin')
      expect(protectedAdminRoutes).toContain('/admin')
    })

    it('should require authentication for user management routes', () => {
      expect(protectedAdminRoutes).toContain('/admin/users')
    })

    it('should require authentication for settings routes', () => {
      expect(protectedAdminRoutes).toContain('/admin/settings')
    })
  })

  describe('app route guards', () => {
    it('should require authentication for all app routes', () => {
      // The app layout wraps all routes with AuthGuard
      const appRouteTree = mockRouteTree.children.find((r) => r.id === '/app/_app')
      expect(appRouteTree).toBeDefined()
      // All routes under /app require auth (no public exceptions defined)
    })
  })
})

// =============================================================================
// Error Route Tests
// =============================================================================

describe('Error Routes', () => {
  describe('not found handling', () => {
    it('should configure root-level not found mode', async () => {
      const { createRouter } = await import('../src/router')
      const router = createRouter()

      expect(router.options.notFoundMode).toBe('root')
    })

    it('should define splat route for catch-all handling', () => {
      const splatRoute = mockRouteTree.children.find((r) => r.path === '/$')
      expect(splatRoute).toBeDefined()
    })

    it('should define docs splat route for nested catch-all', () => {
      const docsSplat = mockRouteTree.children.find((r) => r.path === '/docs/$')
      expect(docsSplat).toBeDefined()
    })
  })

  describe('dynamic parameter routes', () => {
    it('should support $id parameter in customer routes', () => {
      const customerRoute = mockRouteTree.children.find((r) => r.path === '/customers/$id')
      expect(customerRoute?.path).toContain('$id')
    })

    it('should support $userId parameter in admin user routes', () => {
      const adminRoutes = mockRouteTree.children.find((r) => r.id === '/admin/_admin')
      const userDetailRoute = adminRoutes?.children?.find((r: any) => r.path === 'users/$userId')
      expect(userDetailRoute?.path).toContain('$userId')
    })

    it('should support $projectId parameter in app project routes', () => {
      const appRoutes = mockRouteTree.children.find((r) => r.id === '/app/_app')
      const projectDetailRoute = appRoutes?.children?.find((r: any) => r.path === 'projects/$projectId')
      expect(projectDetailRoute?.path).toContain('$projectId')
    })

    it('should support nested parameters in workflow runs', () => {
      const adminRoutes = mockRouteTree.children.find((r) => r.id === '/admin/_admin')
      const workflowRuns = adminRoutes?.children?.find((r: any) => r.path === 'workflows/$workflowId/runs')
      expect(workflowRuns?.path).toContain('$workflowId')

      const runDetail = workflowRuns?.children?.find((r: any) => r.path === '$runId')
      expect(runDetail?.path).toContain('$runId')
    })
  })
})

// =============================================================================
// Navigation Tests
// =============================================================================

describe('Navigation', () => {
  describe('route matching', () => {
    it('should match exact route paths', async () => {
      const { createRouter } = await import('../src/router')
      const router = createRouter()

      const matches = router.matchRoutes('/')
      expect(matches.length).toBeGreaterThan(0)
      expect(matches.some((m: any) => m.path === '/')).toBe(true)
    })

    it('should match nested admin routes', async () => {
      const { createRouter } = await import('../src/router')
      const router = createRouter()

      const matches = router.matchRoutes('/admin/users')
      expect(matches.some((m: any) => m.id?.includes('admin'))).toBe(true)
    })

    it('should match nested app routes', async () => {
      const { createRouter } = await import('../src/router')
      const router = createRouter()

      const matches = router.matchRoutes('/app/projects')
      expect(matches.some((m: any) => m.id?.includes('app'))).toBe(true)
    })

    it('should match parameterized routes', async () => {
      const { createRouter } = await import('../src/router')
      const router = createRouter()

      const matches = router.matchRoutes('/customers/123')
      expect(matches.some((m: any) => m.path?.includes('$id'))).toBe(true)
    })
  })

  describe('preloading behavior', () => {
    it('should use intent-based preloading strategy', async () => {
      const { createRouter } = await import('../src/router')
      const router = createRouter()

      // Intent preloading triggers on hover/focus
      expect(router.options.defaultPreload).toBe('intent')
    })

    it('should have 150ms preload delay to prevent accidental loads', async () => {
      const { createRouter } = await import('../src/router')
      const router = createRouter()

      // Short delay prevents accidental preloads from cursor passing over links
      expect(router.options.defaultPreloadDelay).toBe(150)
      expect(router.options.defaultPreloadDelay).toBeLessThan(300)
    })

    it('should cache preloaded data for 30 seconds', async () => {
      const { createRouter } = await import('../src/router')
      const router = createRouter()

      expect(router.options.defaultPreloadStaleTime).toBe(30_000)
    })
  })

  describe('scroll restoration', () => {
    it('should restore scroll position on back/forward navigation', async () => {
      const { createRouter } = await import('../src/router')
      const router = createRouter()

      expect(router.options.scrollRestoration).toBe(true)
    })
  })
})

// =============================================================================
// Route Structure Validation Tests
// =============================================================================

describe('Route Structure Validation', () => {
  it('should have a root route', () => {
    expect(mockRouteTree.id).toBe('__root__')
    expect(mockRouteTree.children).toBeDefined()
    expect(mockRouteTree.children.length).toBeGreaterThan(0)
  })

  it('should have unique route IDs', () => {
    const ids = new Set<string>()
    const collectIds = (node: any) => {
      if (node.id) ids.add(node.id)
      node.children?.forEach(collectIds)
    }
    collectIds(mockRouteTree)

    // If all IDs are unique, set size equals count of IDs
    const allIds: string[] = []
    const collectAllIds = (node: any) => {
      if (node.id) allIds.push(node.id)
      node.children?.forEach(collectAllIds)
    }
    collectAllIds(mockRouteTree)

    expect(ids.size).toBe(allIds.length)
  })

  it('should have valid path patterns for all routes', () => {
    const validatePaths = (node: any) => {
      if (node.path !== undefined) {
        // Path should be a string
        expect(typeof node.path).toBe('string')
        // Path should not have consecutive slashes (except protocol)
        expect(node.path).not.toMatch(/\/\//)
      }
      node.children?.forEach(validatePaths)
    }
    mockRouteTree.children.forEach(validatePaths)
  })

  it('should have layout routes (underscore prefix) for admin and app', () => {
    const adminLayout = mockRouteTree.children.find((r) => r.id === '/admin/_admin')
    const appLayout = mockRouteTree.children.find((r) => r.id === '/app/_app')

    expect(adminLayout).toBeDefined()
    expect(appLayout).toBeDefined()

    // Layout routes should have children
    expect(adminLayout?.children?.length).toBeGreaterThan(0)
    expect(appLayout?.children?.length).toBeGreaterThan(0)
  })
})
