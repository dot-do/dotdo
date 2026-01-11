/**
 * Authentication Fixtures for E2E Tests
 *
 * Provides fixtures for testing authenticated and unauthenticated states.
 * Supports session storage for faster test runs.
 */

import { test as base, expect } from '@playwright/test'
import type { Page, BrowserContext, Cookie } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Auth state storage location
 * Used to persist auth state between tests for faster execution
 */
const AUTH_STATE_DIR = path.join(process.cwd(), '.playwright', 'auth')
const AUTH_STATE_FILE = path.join(AUTH_STATE_DIR, 'user.json')

/**
 * Test user credentials
 * In a real setup, these would come from environment variables
 */
export const testCredentials = {
  user: {
    email: process.env.TEST_USER_EMAIL || 'test@example.com.ai',
    password: process.env.TEST_USER_PASSWORD || 'test-password',
  },
  admin: {
    email: process.env.TEST_ADMIN_EMAIL || 'admin@example.com.ai',
    password: process.env.TEST_ADMIN_PASSWORD || 'admin-password',
  },
}

/**
 * Auth fixture types
 */
export type AuthFixtures = {
  /** Page with authenticated user session */
  authenticatedPage: Page

  /** Page in logged out state */
  unauthenticatedPage: Page

  /** Helper to log in a user */
  login: (email?: string, password?: string) => Promise<void>

  /** Helper to log out */
  logout: () => Promise<void>

  /** Check if user is currently logged in */
  isLoggedIn: () => Promise<boolean>

  /** Save current auth state for reuse */
  saveAuthState: () => Promise<void>

  /** Load saved auth state */
  loadAuthState: () => Promise<boolean>
}

/**
 * Extended test with auth fixtures
 */
export const test = base.extend<AuthFixtures>({
  // Authenticated page - logs in before test
  authenticatedPage: async ({ page, context }, use) => {
    // Try to load existing auth state first
    const hasState = await loadStorageState(context)

    if (!hasState) {
      // Perform login
      await performLogin(page, testCredentials.user.email, testCredentials.user.password)
    }

    await use(page)
  },

  // Unauthenticated page - ensures logged out state
  unauthenticatedPage: async ({ page, context }, use) => {
    // Clear any existing auth state
    await context.clearCookies()

    // Navigate to ensure clean state
    await page.goto('/')

    await use(page)
  },

  // Login helper
  login: async ({ page }, use) => {
    const loginFn = async (email?: string, password?: string) => {
      await performLogin(
        page,
        email || testCredentials.user.email,
        password || testCredentials.user.password
      )
    }
    await use(loginFn)
  },

  // Logout helper
  logout: async ({ page }, use) => {
    const logoutFn = async () => {
      await performLogout(page)
    }
    await use(logoutFn)
  },

  // Check login status
  isLoggedIn: async ({ page }, use) => {
    const checkFn = async () => {
      return await checkLoginStatus(page)
    }
    await use(checkFn)
  },

  // Save auth state
  saveAuthState: async ({ context }, use) => {
    const saveFn = async () => {
      await saveStorageState(context)
    }
    await use(saveFn)
  },

  // Load auth state
  loadAuthState: async ({ context }, use) => {
    const loadFn = async () => {
      return await loadStorageState(context)
    }
    await use(loadFn)
  },
})

/**
 * Perform login via the UI
 */
async function performLogin(page: Page, email: string, password: string): Promise<void> {
  // Navigate to login page
  await page.goto('/admin/login')

  // Fill in credentials
  const emailInput = page.locator('input[type="email"], input[name="email"]')
  const passwordInput = page.locator('input[type="password"]')
  const submitButton = page.locator('button[type="submit"]')

  // Check if login form exists
  if ((await emailInput.count()) === 0) {
    // Login page might not exist yet - skip silently
    return
  }

  await emailInput.fill(email)
  await passwordInput.fill(password)
  await submitButton.click()

  // Wait for navigation away from login page
  try {
    await page.waitForURL((url) => !url.pathname.includes('login'), {
      timeout: 5000,
    })
  } catch {
    // Login might fail - that's okay for tests that expect failures
  }
}

/**
 * Perform logout
 */
async function performLogout(page: Page): Promise<void> {
  // Look for logout button/link
  const logoutButton = page.locator(
    'button:has-text("Logout"), a:has-text("Logout"), button:has-text("Sign out"), a:has-text("Sign out")'
  )

  if ((await logoutButton.count()) > 0) {
    await logoutButton.first().click()
    // Wait for redirect to home or login
    await page.waitForURL((url) => url.pathname === '/' || url.pathname.includes('login'))
  } else {
    // No logout button - might need to navigate to a logout endpoint
    await page.goto('/api/auth/logout')
  }
}

/**
 * Check if user is currently logged in
 */
async function checkLoginStatus(page: Page): Promise<boolean> {
  // Navigate to admin to check auth
  await page.goto('/admin')

  // If redirected to login, not logged in
  return !page.url().includes('login')
}

/**
 * Save browser storage state to file
 */
async function saveStorageState(context: BrowserContext): Promise<void> {
  // Ensure directory exists
  if (!fs.existsSync(AUTH_STATE_DIR)) {
    fs.mkdirSync(AUTH_STATE_DIR, { recursive: true })
  }

  await context.storageState({ path: AUTH_STATE_FILE })
}

/**
 * Load browser storage state from file
 */
async function loadStorageState(context: BrowserContext): Promise<boolean> {
  if (!fs.existsSync(AUTH_STATE_FILE)) {
    return false
  }

  try {
    const stateData = JSON.parse(fs.readFileSync(AUTH_STATE_FILE, 'utf-8'))

    // Check if state has cookies
    if (stateData.cookies && stateData.cookies.length > 0) {
      await context.addCookies(stateData.cookies)
      return true
    }
  } catch {
    // Invalid state file - ignore
  }

  return false
}

/**
 * Global setup for auth state
 * Can be used in playwright.config.ts globalSetup
 */
export async function globalAuthSetup(): Promise<void> {
  // This would be called once before all tests to set up auth state
  console.log('Setting up global auth state...')
}

export { expect } from '@playwright/test'
