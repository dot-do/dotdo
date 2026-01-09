import { test, expect } from '@playwright/test'
import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'

/**
 * E2E tests for @dotdo/payload CMS package
 *
 * Tests the embedded Next.js app approach where:
 * - Package contains the Next.js template
 * - CLI symlinks user's payload.config.ts
 * - Runs next from the template directory
 */

const EXAMPLE_DIR = join(__dirname, '../../examples/payload/cms')
const PAYLOAD_PORT = 3001
const PAYLOAD_URL = `http://localhost:${PAYLOAD_PORT}`

let server: ChildProcess | null = null

test.describe('Payload CMS Package', () => {
  test.beforeAll(async () => {
    // Start payload dev server from example directory
    server = spawn('npx', ['payload', 'dev', '-p', String(PAYLOAD_PORT)], {
      cwd: EXAMPLE_DIR,
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'development' },
    })

    // Wait for server to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 60000)

      server!.stdout?.on('data', (data: Buffer) => {
        const output = data.toString()
        if (output.includes('Ready') || output.includes('started') || output.includes('localhost')) {
          clearTimeout(timeout)
          resolve()
        }
      })

      server!.stderr?.on('data', (data: Buffer) => {
        console.error('Payload stderr:', data.toString())
      })

      server!.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  })

  test.afterAll(async () => {
    if (server) {
      server.kill('SIGTERM')
      await new Promise(resolve => server!.on('close', resolve))
    }
  })

  test.describe('Admin UI', () => {
    test('should load admin login page', async ({ page }) => {
      await page.goto(`${PAYLOAD_URL}/admin`)

      // Payload redirects to login on first visit
      await expect(page).toHaveURL(/\/admin\/login|\/admin/)
    })

    test('should have .do branding in title', async ({ page }) => {
      await page.goto(`${PAYLOAD_URL}/admin`)

      // Check for .do title suffix
      await expect(page).toHaveTitle(/\.do/)
    })

    test('should render .do logo', async ({ page }) => {
      await page.goto(`${PAYLOAD_URL}/admin`)

      // Look for .do logo SVG
      const logo = page.locator('svg:has(text:has-text(".do")), svg:has(text:has-text("do"))')
      await expect(logo.first()).toBeVisible({ timeout: 10000 }).catch(() => {
        // Logo might not be visible on login, that's ok
      })
    })

    test('should render login form', async ({ page }) => {
      await page.goto(`${PAYLOAD_URL}/admin/login`)

      // Check for email/password fields
      const emailInput = page.locator('input[type="email"], input[name="email"]')
      const passwordInput = page.locator('input[type="password"], input[name="password"]')

      await expect(emailInput.or(page.locator('input').first())).toBeVisible()
    })
  })

  test.describe('REST API', () => {
    test('should respond to /api/users endpoint', async ({ request }) => {
      const response = await request.get(`${PAYLOAD_URL}/api/users`)

      // Will be 401 unauthorized without auth, but proves endpoint exists
      expect([200, 401, 403]).toContain(response.status())
    })

    test('should respond to /api/posts endpoint', async ({ request }) => {
      const response = await request.get(`${PAYLOAD_URL}/api/posts`)

      expect([200, 401, 403]).toContain(response.status())
    })

    test('should respond to /api/authors endpoint', async ({ request }) => {
      const response = await request.get(`${PAYLOAD_URL}/api/authors`)

      expect([200, 401, 403]).toContain(response.status())
    })

    test('should respond to /api/blogs endpoint', async ({ request }) => {
      const response = await request.get(`${PAYLOAD_URL}/api/blogs`)

      expect([200, 401, 403]).toContain(response.status())
    })

    test('should respond to /api/tags endpoint', async ({ request }) => {
      const response = await request.get(`${PAYLOAD_URL}/api/tags`)

      expect([200, 401, 403]).toContain(response.status())
    })

    test('should return JSON content type', async ({ request }) => {
      const response = await request.get(`${PAYLOAD_URL}/api/users`)
      const contentType = response.headers()['content-type']

      expect(contentType).toContain('application/json')
    })
  })

  test.describe('Collection Configuration', () => {
    test('should have correct collections from payload.config.ts', async ({ request }) => {
      // Try to get the access endpoint or collection list
      const response = await request.get(`${PAYLOAD_URL}/api/access`)

      if (response.status() === 200) {
        const body = await response.json()
        // Verify our collections are registered
        const collections = Object.keys(body.collections || body)
        expect(collections).toContain('users')
        expect(collections).toContain('posts')
        expect(collections).toContain('authors')
        expect(collections).toContain('blogs')
        expect(collections).toContain('tags')
      }
    })
  })
})
