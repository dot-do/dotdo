/**
 * dotdo Testing Utilities
 *
 * Provides reusable testing infrastructure for dotdo applications.
 * Import from `dotdo/testing` to use these utilities.
 *
 * @example
 * ```typescript
 * import { createTestClient } from 'dotdo/testing'
 *
 * const client = createTestClient(app)
 * const response = await client.get('/health')
 * response.expectStatus(200).expectJson()
 * ```
 *
 * @module dotdo/testing
 */

// API Testing Utilities
export { createTestClient, type TestClient, type TestResponse } from './api'
