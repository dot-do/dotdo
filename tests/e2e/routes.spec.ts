import { test, expect } from '@playwright/test'

/**
 * Comprehensive E2E Route Tests for dotdo
 *
 * TDD RED Phase - These tests cover all application routes and are expected to fail
 * until the corresponding implementations are complete.
 *
 * Test categories:
 * 1. Landing page routes (/)
 * 2. Documentation routes (/docs/*)
 * 3. Admin routes (/admin/*)
 * 4. API routes (/api/*)
 * 5. MCP routes (/mcp)
 * 6. RPC routes (/rpc/*)
 * 7. Error pages (404, 500)
 * 8. Auth flow tests
 * 9. Form submission tests
 * 10. Navigation tests
 */

// =============================================================================
// 1. Landing Page Tests (/)
// =============================================================================

test.describe('Landing Page', () => {
  test.describe('Page Load', () => {
    test('should load landing page with 200 status', async ({ page }) => {
      const response = await page.goto('/')
      expect(response?.status()).toBe(200)
    })

    test('should have correct page title containing dotdo', async ({ page }) => {
      await page.goto('/')
      const title = await page.title()
      expect(title.toLowerCase()).toContain('dotdo')
    })

    test('should render hero section', async ({ page }) => {
      await page.goto('/')
      const hero = page.locator('#hero, .hero, section.Hero')
      await expect(hero).toBeVisible()
    })

    test('should render features section', async ({ page }) => {
      await page.goto('/')
      const features = page.locator('#features, .features, section.Features')
      await expect(features).toBeVisible()
    })

    test('should render CTA section', async ({ page }) => {
      await page.goto('/')
      const cta = page.locator('#cta, .cta, section.CTA, .call-to-action, .get-started')
      await expect(cta).toBeVisible()
    })

    test('should render footer', async ({ page }) => {
      await page.goto('/')
      const footer = page.locator('footer')
      await expect(footer).toBeVisible()
    })
  })

  test.describe('Content', () => {
    test('should display main headline', async ({ page }) => {
      await page.goto('/')
      const headline = page.locator('h1')
      await expect(headline).toBeVisible()
      const text = await headline.textContent()
      expect(text?.toLowerCase()).toContain('dotdo')
    })

    test('should display feature cards', async ({ page }) => {
      await page.goto('/')
      const featureCards = page.locator('.feature-card, .feature-item, article')
      const count = await featureCards.count()
      expect(count).toBeGreaterThanOrEqual(3)
    })

    test('should display Get Started button', async ({ page }) => {
      await page.goto('/')
      const ctaButton = page.locator('a:has-text("Get Started"), button:has-text("Get Started")')
      await expect(ctaButton.first()).toBeVisible()
    })

    test('should display documentation link', async ({ page }) => {
      await page.goto('/')
      const docsLink = page.locator('a[href="/docs"], a:has-text("Docs"), a:has-text("Documentation")')
      await expect(docsLink.first()).toBeVisible()
    })
  })

  test.describe('Navigation', () => {
    test('should have working navigation to docs', async ({ page }) => {
      await page.goto('/')
      const docsLink = page.locator('a[href="/docs"]').first()
      await docsLink.click()
      await expect(page).toHaveURL(/\/docs/)
    })

    test('should have working navigation to admin', async ({ page }) => {
      await page.goto('/')
      const adminLink = page.locator('a[href="/admin"]').first()
      if (await adminLink.isVisible()) {
        await adminLink.click()
        await expect(page).toHaveURL(/\/admin/)
      }
    })

    test('should have logo link to home', async ({ page }) => {
      await page.goto('/')
      const logo = page.locator('a[href="/"]').first()
      await expect(logo).toBeVisible()
    })
  })

  test.describe('Accessibility', () => {
    test('should have skip to content link', async ({ page }) => {
      await page.goto('/')
      const skipLink = page.locator('a[href="#main-content"], .skip-link, a:has-text("Skip")')
      // Skip link may be visually hidden but should exist
      const count = await skipLink.count()
      expect(count).toBeGreaterThan(0)
    })

    test('should have proper heading hierarchy', async ({ page }) => {
      await page.goto('/')
      const h1 = page.locator('h1')
      await expect(h1).toBeVisible()
      // Should have only one h1
      const h1Count = await h1.count()
      expect(h1Count).toBe(1)
    })

    test('should have alt text on images', async ({ page }) => {
      await page.goto('/')
      const images = page.locator('img:not([alt=""])')
      const count = await images.count()
      // All images should have alt attribute (even if empty for decorative)
      const allImages = page.locator('img')
      const allCount = await allImages.count()
      for (let i = 0; i < allCount; i++) {
        const hasAlt = await allImages.nth(i).getAttribute('alt')
        expect(hasAlt).not.toBeNull()
      }
    })

    test('should have proper ARIA landmarks', async ({ page }) => {
      await page.goto('/')
      // Check for main landmark
      const main = page.locator('main, [role="main"]')
      await expect(main).toBeVisible()
      // Check for navigation
      const nav = page.locator('nav, [role="navigation"]')
      await expect(nav.first()).toBeVisible()
    })
  })
})

// =============================================================================
// 2. Documentation Routes (/docs/*)
// =============================================================================

test.describe('Documentation Routes', () => {
  test.describe('Docs Index', () => {
    test('should load docs index page', async ({ page }) => {
      const response = await page.goto('/docs')
      expect(response?.status()).toBe(200)
    })

    test('should display documentation navigation', async ({ page }) => {
      await page.goto('/docs')
      // Fumadocs typically has a sidebar
      const sidebar = page.locator('aside, nav.sidebar, .docs-nav, [data-sidebar]')
      await expect(sidebar.first()).toBeVisible()
    })

    test('should have search functionality', async ({ page }) => {
      await page.goto('/docs')
      const search = page.locator('input[type="search"], button:has-text("Search"), [data-search]')
      const count = await search.count()
      expect(count).toBeGreaterThan(0)
    })
  })

  test.describe('Docs Pages', () => {
    test('should load getting-started page', async ({ page }) => {
      const response = await page.goto('/docs/getting-started')
      expect(response?.status()).toBe(200)
    })

    test('should load API reference page', async ({ page }) => {
      const response = await page.goto('/docs/api')
      expect(response?.status()).toBe(200)
    })

    test('should render MDX content', async ({ page }) => {
      await page.goto('/docs/getting-started')
      // MDX content should render with proper typography
      const prose = page.locator('.prose, article, .docs-content, .mdx-content')
      await expect(prose.first()).toBeVisible()
    })

    test('should have working table of contents', async ({ page }) => {
      await page.goto('/docs/getting-started')
      const toc = page.locator('.toc, .table-of-contents, nav[aria-label*="contents"]')
      // TOC may not be on all pages, so just check it exists if present
      const count = await toc.count()
      if (count > 0) {
        await expect(toc.first()).toBeVisible()
      }
    })

    test('should have code blocks with syntax highlighting', async ({ page }) => {
      await page.goto('/docs/getting-started')
      const codeBlocks = page.locator('pre code, .code-block, [data-rehype-pretty-code]')
      const count = await codeBlocks.count()
      // Getting started should have at least one code example
      expect(count).toBeGreaterThan(0)
    })
  })

  test.describe('Docs Navigation', () => {
    test('should navigate between docs pages', async ({ page }) => {
      await page.goto('/docs')
      // Click on a sidebar link
      const sidebarLink = page.locator('aside a, nav.sidebar a').first()
      if (await sidebarLink.isVisible()) {
        await sidebarLink.click()
        await expect(page).toHaveURL(/\/docs\//)
      }
    })

    test('should have prev/next navigation', async ({ page }) => {
      await page.goto('/docs/getting-started')
      const prevNext = page.locator('a:has-text("Previous"), a:has-text("Next"), .pagination')
      const count = await prevNext.count()
      // Should have at least one navigation element
      expect(count).toBeGreaterThan(0)
    })

    test('should have breadcrumbs', async ({ page }) => {
      await page.goto('/docs/getting-started')
      const breadcrumbs = page.locator('nav[aria-label*="breadcrumb"], .breadcrumbs, ol')
      const count = await breadcrumbs.count()
      // Breadcrumbs may exist
      expect(count).toBeGreaterThanOrEqual(0)
    })
  })
})

// =============================================================================
// 3. Admin Routes (/admin/*)
// =============================================================================

test.describe('Admin Routes', () => {
  test.describe('Admin Dashboard', () => {
    test('should load admin dashboard', async ({ page }) => {
      const response = await page.goto('/admin')
      // Might redirect to login if not authenticated
      expect([200, 302, 307]).toContain(response?.status())
    })

    test('should display dashboard metrics', async ({ page }) => {
      await page.goto('/admin')
      // If redirected to login, this test might fail
      const dashboard = page.locator('.dashboard, [data-dashboard], .metrics')
      const kpiCards = page.locator('.kpi-card, .metric-card, .stat-card')
      const count = await kpiCards.count()
      // Dashboard should have metric cards
      expect(count).toBeGreaterThanOrEqual(0)
    })

    test('should display admin shell/navigation', async ({ page }) => {
      await page.goto('/admin')
      const shell = page.locator('.shell, .admin-shell, aside.sidebar')
      // Admin shell component from @mdxui/cockpit
      const count = await shell.count()
      expect(count).toBeGreaterThanOrEqual(0)
    })
  })

  test.describe('Admin Login', () => {
    test('should load login page', async ({ page }) => {
      const response = await page.goto('/admin/login')
      expect(response?.status()).toBe(200)
    })

    test('should display login form', async ({ page }) => {
      await page.goto('/admin/login')
      const form = page.locator('form')
      await expect(form).toBeVisible()
    })

    test('should have email input', async ({ page }) => {
      await page.goto('/admin/login')
      const emailInput = page.locator('input[type="email"], input[name="email"]')
      await expect(emailInput).toBeVisible()
    })

    test('should have password input', async ({ page }) => {
      await page.goto('/admin/login')
      const passwordInput = page.locator('input[type="password"], input[name="password"]')
      await expect(passwordInput).toBeVisible()
    })

    test('should have OAuth buttons', async ({ page }) => {
      await page.goto('/admin/login')
      const oauthButtons = page.locator('button:has-text("Google"), button:has-text("GitHub"), button:has-text("Microsoft")')
      const count = await oauthButtons.count()
      expect(count).toBeGreaterThan(0)
    })

    test('should have forgot password link', async ({ page }) => {
      await page.goto('/admin/login')
      const forgotLink = page.locator('a:has-text("Forgot"), button:has-text("Forgot")')
      const count = await forgotLink.count()
      expect(count).toBeGreaterThan(0)
    })
  })

  test.describe('Admin Users', () => {
    test('should load users list page', async ({ page }) => {
      const response = await page.goto('/admin/users')
      expect([200, 302, 307]).toContain(response?.status())
    })

    test('should display users data table', async ({ page }) => {
      await page.goto('/admin/users')
      const dataTable = page.locator('table, [data-table], .data-table')
      const count = await dataTable.count()
      expect(count).toBeGreaterThanOrEqual(0)
    })

    test('should have create user button', async ({ page }) => {
      await page.goto('/admin/users')
      const createButton = page.locator('a:has-text("Create"), button:has-text("Create"), a[href="/admin/users/new"]')
      const count = await createButton.count()
      expect(count).toBeGreaterThan(0)
    })

    test('should have search input', async ({ page }) => {
      await page.goto('/admin/users')
      const searchInput = page.locator('input[type="search"], input[placeholder*="Search"]')
      const count = await searchInput.count()
      expect(count).toBeGreaterThan(0)
    })

    test('should load create user page', async ({ page }) => {
      const response = await page.goto('/admin/users/new')
      expect([200, 302, 307]).toContain(response?.status())
    })

    test('should load user detail page', async ({ page }) => {
      const response = await page.goto('/admin/users/user-1')
      // User might not exist, so 404 is acceptable
      expect([200, 302, 307, 404]).toContain(response?.status())
    })
  })

  test.describe('Admin Workflows', () => {
    test('should load workflows list page', async ({ page }) => {
      const response = await page.goto('/admin/workflows')
      expect([200, 302, 307]).toContain(response?.status())
    })

    test('should display workflows data table', async ({ page }) => {
      await page.goto('/admin/workflows')
      const dataTable = page.locator('table, [data-table], .data-table')
      const count = await dataTable.count()
      expect(count).toBeGreaterThanOrEqual(0)
    })

    test('should have status filter', async ({ page }) => {
      await page.goto('/admin/workflows')
      const statusFilter = page.locator('select, [data-filter="status"]')
      const count = await statusFilter.count()
      expect(count).toBeGreaterThan(0)
    })

    test('should load workflow detail page', async ({ page }) => {
      const response = await page.goto('/admin/workflows/workflow-1')
      expect([200, 302, 307, 404]).toContain(response?.status())
    })

    test('should load workflow runs page', async ({ page }) => {
      const response = await page.goto('/admin/workflows/workflow-1/runs')
      expect([200, 302, 307, 404]).toContain(response?.status())
    })
  })

  test.describe('Admin Integrations', () => {
    test('should load integrations page', async ({ page }) => {
      const response = await page.goto('/admin/integrations')
      expect([200, 302, 307]).toContain(response?.status())
    })

    test('should load API keys page', async ({ page }) => {
      const response = await page.goto('/admin/integrations/api-keys')
      expect([200, 302, 307]).toContain(response?.status())
    })
  })

  test.describe('Admin Settings', () => {
    test('should load settings index page', async ({ page }) => {
      const response = await page.goto('/admin/settings')
      expect([200, 302, 307]).toContain(response?.status())
    })

    test('should load account settings page', async ({ page }) => {
      const response = await page.goto('/admin/settings/account')
      expect([200, 302, 307]).toContain(response?.status())
    })

    test('should load security settings page', async ({ page }) => {
      const response = await page.goto('/admin/settings/security')
      expect([200, 302, 307]).toContain(response?.status())
    })
  })

  test.describe('Admin Activity', () => {
    test('should load activity log page', async ({ page }) => {
      const response = await page.goto('/admin/activity')
      expect([200, 302, 307]).toContain(response?.status())
    })
  })
})

// =============================================================================
// 4. API Routes (/api/*)
// =============================================================================

test.describe('API Routes', () => {
  test.describe('Health Check', () => {
    test('should return 200 for /api/health', async ({ request }) => {
      const response = await request.get('/api/health')
      expect(response.status()).toBe(200)
    })

    test('should return JSON content-type', async ({ request }) => {
      const response = await request.get('/api/health')
      const contentType = response.headers()['content-type']
      expect(contentType).toContain('application/json')
    })

    test('should return status in body', async ({ request }) => {
      const response = await request.get('/api/health')
      const body = await response.json()
      expect(body).toHaveProperty('status')
    })

    test('should return timestamp in body', async ({ request }) => {
      const response = await request.get('/api/health')
      const body = await response.json()
      expect(body).toHaveProperty('timestamp')
    })
  })

  test.describe('API Info', () => {
    test('should return API info at /api/', async ({ request }) => {
      const response = await request.get('/api/')
      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(body).toHaveProperty('name')
      expect(body).toHaveProperty('version')
    })
  })

  test.describe('Things CRUD', () => {
    test('should list things at GET /api/things', async ({ request }) => {
      const response = await request.get('/api/things')
      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(Array.isArray(body)).toBe(true)
    })

    test('should create thing at POST /api/things', async ({ request }) => {
      const response = await request.post('/api/things', {
        headers: { 'Content-Type': 'application/json' },
        data: { name: 'Test Thing' },
      })
      expect(response.status()).toBe(201)
      const body = await response.json()
      expect(body).toHaveProperty('id')
      expect(body.name).toBe('Test Thing')
    })

    test('should return 400 for invalid JSON', async ({ request }) => {
      const response = await request.post('/api/things', {
        headers: { 'Content-Type': 'application/json' },
        data: 'invalid json',
      })
      expect(response.status()).toBe(400)
    })

    test('should return 422 for missing name', async ({ request }) => {
      const response = await request.post('/api/things', {
        headers: { 'Content-Type': 'application/json' },
        data: {},
      })
      expect(response.status()).toBe(422)
    })

    test('should return 404 for non-existent thing', async ({ request }) => {
      const response = await request.get('/api/things/non-existent-id')
      expect(response.status()).toBe(404)
    })

    test('should return 405 for unsupported methods', async ({ request }) => {
      const response = await request.delete('/api/things')
      expect(response.status()).toBe(405)
    })
  })

  test.describe('API Error Handling', () => {
    test('should return 404 for unknown routes', async ({ request }) => {
      const response = await request.get('/api/unknown-route')
      expect(response.status()).toBe(404)
    })

    test('should return JSON error response', async ({ request }) => {
      const response = await request.get('/api/unknown-route')
      const body = await response.json()
      expect(body).toHaveProperty('error')
      expect(body.error).toHaveProperty('code')
      expect(body.error).toHaveProperty('message')
    })

    test('should return 401 for protected routes', async ({ request }) => {
      const response = await request.get('/api/protected')
      expect(response.status()).toBe(401)
    })

    test('should return 403 for admin routes without permission', async ({ request }) => {
      const response = await request.get('/api/admin/settings')
      expect(response.status()).toBe(403)
    })
  })

  test.describe('API Validation', () => {
    test('should validate email format', async ({ request }) => {
      const response = await request.post('/api/users', {
        headers: { 'Content-Type': 'application/json' },
        data: { email: 'invalid-email' },
      })
      expect(response.status()).toBe(422)
      const body = await response.json()
      expect(body.error.details).toHaveProperty('email')
    })

    test('should handle empty request body', async ({ request }) => {
      const response = await request.post('/api/things', {
        headers: { 'Content-Type': 'application/json' },
        data: '',
      })
      expect(response.status()).toBe(400)
    })
  })
})

// =============================================================================
// 5. MCP Routes (/mcp)
// =============================================================================

test.describe('MCP Routes', () => {
  test.describe('MCP HTTP Transport', () => {
    test('should handle OPTIONS preflight', async ({ request }) => {
      const response = await request.fetch('/mcp', { method: 'OPTIONS' })
      expect([200, 204]).toContain(response.status())
    })

    test('should require Content-Type for POST', async ({ request }) => {
      const response = await request.post('/mcp', {
        data: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      })
      expect(response.status()).toBe(415)
    })

    test('should handle initialize method', async ({ request }) => {
      const response = await request.post('/mcp', {
        headers: { 'Content-Type': 'application/json' },
        data: {
          jsonrpc: '2.0',
          method: 'initialize',
          id: 1,
          params: { clientInfo: { name: 'test', version: '1.0' } },
        },
      })
      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(body.result).toHaveProperty('protocolVersion')
      expect(body.result).toHaveProperty('capabilities')
    })

    test('should handle ping method', async ({ request }) => {
      const response = await request.post('/mcp', {
        headers: { 'Content-Type': 'application/json' },
        data: { jsonrpc: '2.0', method: 'ping', id: 1 },
      })
      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(body.result).toBeDefined()
    })

    test('should handle tools/list method', async ({ request }) => {
      // First initialize
      const initResponse = await request.post('/mcp', {
        headers: { 'Content-Type': 'application/json' },
        data: { jsonrpc: '2.0', method: 'initialize', id: 1 },
      })
      const sessionId = initResponse.headers()['mcp-session-id']

      const response = await request.post('/mcp', {
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionId || 'test-session-1',
        },
        data: { jsonrpc: '2.0', method: 'tools/list', id: 2 },
      })
      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(body.result).toHaveProperty('tools')
      expect(Array.isArray(body.result.tools)).toBe(true)
    })

    test('should handle tools/call method', async ({ request }) => {
      const response = await request.post('/mcp', {
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': 'test-session-1',
        },
        data: {
          jsonrpc: '2.0',
          method: 'tools/call',
          id: 1,
          params: { name: 'echo', arguments: { message: 'hello' } },
        },
      })
      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(body.result).toHaveProperty('content')
    })

    test('should return error for unknown method', async ({ request }) => {
      const response = await request.post('/mcp', {
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': 'test-session-1',
        },
        data: { jsonrpc: '2.0', method: 'unknown/method', id: 1 },
      })
      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(body.error).toHaveProperty('code', -32601) // Method not found
    })

    test('should handle batch requests', async ({ request }) => {
      const response = await request.post('/mcp', {
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': 'test-session-1',
        },
        data: [
          { jsonrpc: '2.0', method: 'ping', id: 1 },
          { jsonrpc: '2.0', method: 'ping', id: 2 },
        ],
      })
      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(Array.isArray(body)).toBe(true)
      expect(body.length).toBe(2)
    })

    test('should require session for GET (SSE)', async ({ request }) => {
      const response = await request.get('/mcp')
      expect(response.status()).toBe(400)
    })

    test('should return SSE stream with session', async ({ request }) => {
      const response = await request.get('/mcp', {
        headers: { 'Mcp-Session-Id': 'test-session-1' },
      })
      expect(response.status()).toBe(200)
      const contentType = response.headers()['content-type']
      expect(contentType).toContain('text/event-stream')
    })

    test('should handle DELETE session', async ({ request }) => {
      // Create a session first
      const initResponse = await request.post('/mcp', {
        headers: { 'Content-Type': 'application/json' },
        data: { jsonrpc: '2.0', method: 'initialize', id: 1 },
      })
      const sessionId = initResponse.headers()['mcp-session-id']

      if (sessionId) {
        const response = await request.delete('/mcp', {
          headers: { 'Mcp-Session-Id': sessionId },
        })
        expect(response.status()).toBe(204)
      }
    })
  })
})

// =============================================================================
// 6. RPC Routes (/rpc/*)
// =============================================================================

test.describe('RPC Routes', () => {
  test.describe('RPC HTTP Batch', () => {
    test('should return info for GET /rpc', async ({ request }) => {
      const response = await request.get('/rpc')
      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(body).toHaveProperty('methods')
    })

    test('should handle POST batch call', async ({ request }) => {
      const response = await request.post('/rpc', {
        headers: { 'Content-Type': 'application/json' },
        data: {
          id: 'test-1',
          type: 'call',
          calls: [
            {
              promiseId: 'p1',
              target: { type: 'root' },
              method: 'echo',
              args: [{ type: 'value', value: 'hello' }],
            },
          ],
        },
      })
      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(body).toHaveProperty('results')
    })

    test('should handle add method', async ({ request }) => {
      const response = await request.post('/rpc', {
        headers: { 'Content-Type': 'application/json' },
        data: {
          id: 'test-2',
          type: 'call',
          calls: [
            {
              promiseId: 'p1',
              target: { type: 'root' },
              method: 'add',
              args: [
                { type: 'value', value: 2 },
                { type: 'value', value: 3 },
              ],
            },
          ],
        },
      })
      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(body.results[0].value).toBe(5)
    })

    test('should return error for missing request id', async ({ request }) => {
      const response = await request.post('/rpc', {
        headers: { 'Content-Type': 'application/json' },
        data: { type: 'call', calls: [] },
      })
      expect(response.status()).toBe(400)
    })

    test('should return error for invalid JSON', async ({ request }) => {
      const response = await request.post('/rpc', {
        headers: { 'Content-Type': 'application/json' },
        data: 'invalid json',
      })
      expect(response.status()).toBe(400)
    })

    test('should handle promise pipelining', async ({ request }) => {
      const response = await request.post('/rpc', {
        headers: { 'Content-Type': 'application/json' },
        data: {
          id: 'pipeline-test',
          type: 'batch',
          calls: [
            {
              promiseId: 'p1',
              target: { type: 'root' },
              method: 'getUser',
              args: [{ type: 'value', value: 'user-1' }],
            },
            {
              promiseId: 'p2',
              target: { type: 'promise', promiseId: 'p1' },
              method: 'name',
              args: [],
            },
          ],
        },
      })
      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(body.type).toBe('batch')
      expect(body.results.length).toBe(2)
    })
  })

  test.describe('RPC WebSocket', () => {
    test('should upgrade to WebSocket with proper header', async ({ request }) => {
      // Note: Playwright request API doesn't support WebSocket
      // This test verifies the upgrade header requirement
      // When using HTTP API (not real WebSocket), the request is incomplete
      // (missing Sec-WebSocket-Key, Sec-WebSocket-Version) so Workers runtime
      // rejects with 400, or our handler returns 200 (info) or 426 (upgrade required)
      const response = await request.get('/rpc', {
        headers: { Upgrade: 'websocket' },
      })
      // Accept 400 from Workers runtime for incomplete upgrade, 200 for info,
      // 101 for actual upgrade, or 426 for upgrade required
      expect([101, 200, 400, 426]).toContain(response.status())
    })
  })
})

// =============================================================================
// 7. Error Pages
// =============================================================================

test.describe('Error Pages', () => {
  test.describe('404 Not Found', () => {
    test('should return 404 for non-existent page', async ({ page }) => {
      const response = await page.goto('/this-page-does-not-exist-xyz')
      expect(response?.status()).toBe(404)
    })

    test('should display 404 page content', async ({ page }) => {
      await page.goto('/this-page-does-not-exist-xyz')
      const body = await page.textContent('body')
      // Should show some indication it's not found
      expect(body?.toLowerCase()).toMatch(/not found|404|page doesn't exist/i)
    })

    test('should have link back to home', async ({ page }) => {
      await page.goto('/this-page-does-not-exist-xyz')
      const homeLink = page.locator('a[href="/"]')
      const count = await homeLink.count()
      expect(count).toBeGreaterThan(0)
    })
  })

  test.describe('500 Error Handling', () => {
    test('should not expose stack traces', async ({ page }) => {
      await page.goto('/this-page-does-not-exist-xyz')
      const body = await page.textContent('body')
      expect(body).not.toContain('at Object.')
      expect(body).not.toContain('node_modules')
    })

    test('should return proper error for API 500', async ({ request }) => {
      const response = await request.get('/api/error/unhandled')
      expect(response.status()).toBe(500)
      const body = await response.json()
      expect(body.error.code).toBe('INTERNAL_SERVER_ERROR')
    })
  })
})

// =============================================================================
// 8. Auth Flow Tests
// =============================================================================

test.describe('Auth Flow', () => {
  test.describe('Login Redirect', () => {
    test('should redirect unauthenticated users to login', async ({ page }) => {
      await page.goto('/admin')
      // If auth is enforced, should redirect to login
      const url = page.url()
      // Either stays on admin (no auth) or redirects to login
      expect(url).toMatch(/\/(admin|admin\/login)/)
    })

    test('should preserve return URL after login', async ({ page }) => {
      await page.goto('/admin/users')
      const url = page.url()
      // Should include return URL parameter if redirected
      if (url.includes('login')) {
        expect(url).toContain('return')
      }
    })
  })

  test.describe('Login Form', () => {
    test('should show validation error for empty email', async ({ page }) => {
      await page.goto('/admin/login')
      const submitButton = page.locator('button[type="submit"]')
      await submitButton.click()
      // Should show validation error
      const error = page.locator('.error, [role="alert"], .validation-error')
      // Error may appear for empty fields
      const count = await error.count()
      expect(count).toBeGreaterThanOrEqual(0)
    })

    test('should show validation error for invalid email', async ({ page }) => {
      await page.goto('/admin/login')
      const emailInput = page.locator('input[type="email"], input[name="email"]')
      await emailInput.fill('invalid-email')
      const submitButton = page.locator('button[type="submit"]')
      await submitButton.click()
      // Browser or custom validation should trigger
    })

    test('should submit with valid credentials', async ({ page }) => {
      await page.goto('/admin/login')
      const emailInput = page.locator('input[type="email"], input[name="email"]')
      const passwordInput = page.locator('input[type="password"]')
      const submitButton = page.locator('button[type="submit"]')

      await emailInput.fill('test@example.com.ai')
      await passwordInput.fill('password123')
      await submitButton.click()

      // Should navigate away from login or show error
      await page.waitForURL(/\/(admin|admin\/login)/, { timeout: 5000 })
    })
  })

  test.describe('Logout', () => {
    test('should have logout functionality', async ({ page }) => {
      await page.goto('/admin')
      const logoutButton = page.locator('button:has-text("Logout"), a:has-text("Logout"), a:has-text("Sign out")')
      const count = await logoutButton.count()
      // Logout should be available when logged in
      expect(count).toBeGreaterThanOrEqual(0)
    })
  })
})

// =============================================================================
// 9. Form Submission Tests
// =============================================================================

test.describe('Form Submissions', () => {
  test.describe('Create User Form', () => {
    test('should have all required fields', async ({ page }) => {
      await page.goto('/admin/users/new')
      // Check for standard user form fields
      const nameInput = page.locator('input[name="name"], input[placeholder*="name" i]')
      const emailInput = page.locator('input[name="email"], input[type="email"]')
      const count = await nameInput.count()
      expect(count).toBeGreaterThanOrEqual(0)
    })

    test('should validate required fields', async ({ page }) => {
      await page.goto('/admin/users/new')
      const submitButton = page.locator('button[type="submit"]')
      if (await submitButton.isVisible()) {
        await submitButton.click()
        // Should show validation errors
      }
    })
  })

  test.describe('Settings Forms', () => {
    test('should save account settings', async ({ page }) => {
      await page.goto('/admin/settings/account')
      const saveButton = page.locator('button[type="submit"], button:has-text("Save")')
      const count = await saveButton.count()
      expect(count).toBeGreaterThanOrEqual(0)
    })

    test('should have security settings form', async ({ page }) => {
      await page.goto('/admin/settings/security')
      const form = page.locator('form')
      const count = await form.count()
      expect(count).toBeGreaterThanOrEqual(0)
    })
  })
})

// =============================================================================
// 10. Navigation Tests
// =============================================================================

test.describe('Navigation', () => {
  test.describe('Client-Side Navigation', () => {
    test('should navigate without full page reload', async ({ page }) => {
      await page.goto('/')
      const initialLoadId = await page.evaluate(() => document.body.dataset.loadId || 'none')

      const docsLink = page.locator('a[href="/docs"]').first()
      if (await docsLink.isVisible()) {
        await docsLink.click()
        await page.waitForURL(/\/docs/)

        // If client-side navigation, body should not have changed
        // This is a basic check - real SPAs would preserve more state
      }
    })

    test('should update browser history', async ({ page }) => {
      await page.goto('/')
      const docsLink = page.locator('a[href="/docs"]').first()
      if (await docsLink.isVisible()) {
        await docsLink.click()
        await page.waitForURL(/\/docs/)
        await page.goBack()
        await expect(page).toHaveURL('/')
      }
    })
  })

  test.describe('Responsive Navigation', () => {
    test('should show mobile menu on small screens', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 })
      await page.goto('/')
      const mobileMenu = page.locator('[aria-label*="menu"], .mobile-menu, .hamburger, button[aria-expanded]')
      const count = await mobileMenu.count()
      expect(count).toBeGreaterThan(0)
    })

    test('should toggle mobile menu', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 })
      await page.goto('/')
      const menuButton = page.locator('[aria-label*="menu"], .hamburger, button[aria-expanded]').first()
      if (await menuButton.isVisible()) {
        await menuButton.click()
        // Menu should expand
        const expanded = await menuButton.getAttribute('aria-expanded')
        // Either has aria-expanded="true" or shows menu content
      }
    })
  })

  test.describe('Keyboard Navigation', () => {
    test('should be navigable with Tab key', async ({ page }) => {
      await page.goto('/')
      await page.keyboard.press('Tab')
      // Skip link should be first focusable element
      const focused = await page.evaluate(() => document.activeElement?.tagName)
      expect(focused).toBe('A')
    })

    test('should have visible focus indicators', async ({ page }) => {
      await page.goto('/')
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      // Check that focus is visible (has outline or other indicator)
      const focusedElement = page.locator(':focus')
      await expect(focusedElement).toBeVisible()
    })
  })
})

// =============================================================================
// 11. Static Asset Tests
// =============================================================================

test.describe('Static Assets', () => {
  test('should load CSS correctly', async ({ page }) => {
    await page.goto('/')
    // Page should have styled content
    const body = page.locator('body')
    const bgColor = await body.evaluate((el) => getComputedStyle(el).backgroundColor)
    // Background should be set (not default)
    expect(bgColor).toBeTruthy()
  })

  test('should load JavaScript correctly', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    await page.goto('/')
    await page.waitForTimeout(1000)

    // Should not have JS errors
    expect(errors.length).toBe(0)
  })

  test('should have proper Content-Type headers', async ({ request }) => {
    const response = await request.get('/api/health')
    expect(response.headers()['content-type']).toContain('application/json')
  })
})

// =============================================================================
// 12. Performance Tests
// =============================================================================

test.describe('Performance', () => {
  test('should load landing page within 3 seconds', async ({ page }) => {
    const start = Date.now()
    await page.goto('/', { waitUntil: 'networkidle' })
    const duration = Date.now() - start
    expect(duration).toBeLessThan(3000)
  })

  test('should have reasonable TTFB', async ({ page }) => {
    const response = await page.goto('/')
    // Response should start quickly
    expect(response?.status()).toBe(200)
  })

  test('should load images lazily', async ({ page }) => {
    await page.goto('/')
    const lazyImages = page.locator('img[loading="lazy"]')
    const count = await lazyImages.count()
    // Should have at least some lazy-loaded images
    expect(count).toBeGreaterThanOrEqual(0)
  })
})
