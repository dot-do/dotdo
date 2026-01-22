// E2E Test Setup - Runs before all tests
// Validates environment and optionally triggers deployment
// See do-luhm.27

import { beforeAll, afterAll } from 'vitest'

/**
 * E2E Test Configuration
 * Set via environment variables
 */
export interface E2EConfig {
  /** Base URL of the deployed Worker */
  workerUrl: string
  /** API key for authentication (optional) */
  apiKey?: string
  /** Tenant/namespace for multi-tenant testing */
  tenant?: string
  /** Skip deployment check (for CI with pre-deployed workers) */
  skipDeploymentCheck?: boolean
}

/**
 * Get E2E configuration from environment variables
 */
export function getE2EConfig(): E2EConfig {
  const workerUrl = process.env['WORKER_URL'] || process.env['E2E_WORKER_URL']

  if (!workerUrl) {
    throw new Error(
      'E2E tests require WORKER_URL environment variable.\n' +
      'Set WORKER_URL to the deployed Worker URL, e.g.:\n' +
      '  WORKER_URL=https://test.api.dotdo.dev npm run test:e2e\n' +
      '\nFor local development with wrangler dev:\n' +
      '  WORKER_URL=http://localhost:8787 npm run test:e2e'
    )
  }

  return {
    workerUrl,
    apiKey: process.env['API_KEY'] || process.env['E2E_API_KEY'],
    tenant: process.env['TENANT'] || process.env['E2E_TENANT'] || 'e2e-test',
    skipDeploymentCheck: process.env['SKIP_DEPLOYMENT_CHECK'] === 'true'
  }
}

/**
 * Check if a Worker is deployed and responding
 */
async function checkWorkerHealth(url: string, retries = 3): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(`${url}/health`)
      if (response.ok) {
        const data = await response.json() as { status?: string }
        console.log(`[E2E Setup] Worker healthy at ${url}:`, data)
        return true
      }
    } catch (error) {
      console.log(`[E2E Setup] Health check attempt ${i + 1}/${retries} failed:`, error)
      if (i < retries - 1) {
        // Wait before retry with exponential backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)))
      }
    }
  }
  return false
}

/**
 * Test cleanup tracking
 */
const createdResources: { type: string; id: string }[] = []

export function trackCreatedResource(type: string, id: string): void {
  createdResources.push({ type, id })
}

export function getCreatedResources(): readonly { type: string; id: string }[] {
  return createdResources
}

// Global setup - runs once before all tests
beforeAll(async () => {
  let config: E2EConfig

  try {
    config = getE2EConfig()
  } catch (error) {
    console.warn('[E2E Setup] Configuration missing, tests will be skipped')
    console.warn((error as Error).message)
    return
  }

  console.log('[E2E Setup] Starting E2E test suite')
  console.log(`[E2E Setup] Worker URL: ${config.workerUrl}`)
  console.log(`[E2E Setup] Tenant: ${config.tenant}`)

  if (!config.skipDeploymentCheck) {
    const healthy = await checkWorkerHealth(config.workerUrl)
    if (!healthy) {
      throw new Error(
        `Worker at ${config.workerUrl} is not responding.\n` +
        'Make sure the Worker is deployed and accessible.\n' +
        'For local testing, start wrangler dev first:\n' +
        '  cd api && npm run dev\n' +
        'Then run E2E tests:\n' +
        '  WORKER_URL=http://localhost:8787 npm run test:e2e'
      )
    }
  }

  console.log('[E2E Setup] Ready to run E2E tests')
})

// Global teardown - runs once after all tests
afterAll(async () => {
  console.log('[E2E Setup] E2E test suite complete')

  // Log created resources (for debugging)
  if (createdResources.length > 0) {
    console.log('[E2E Setup] Resources created during tests:')
    for (const resource of createdResources) {
      console.log(`  - ${resource.type}: ${resource.id}`)
    }
  }

  // Note: In production, you might want to clean up test resources here
  // But for now, we leave them for debugging purposes
})

/**
 * Helper to skip tests when WORKER_URL is not set
 */
export function skipIfNoWorker(): boolean {
  const workerUrl = process.env['WORKER_URL'] || process.env['E2E_WORKER_URL']
  return !workerUrl
}

/**
 * Generate a unique test identifier to avoid conflicts
 */
export function generateTestId(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}
