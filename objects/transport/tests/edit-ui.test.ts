/**
 * Edit UI Endpoint Tests - TDD RED Phase
 *
 * Tests for the built-in /:type/:id/edit endpoint that returns an HTML page
 * with an embedded Monaco editor for inline resource editing.
 *
 * Expected behavior:
 * - GET /:type/:id/edit returns text/html content type
 * - HTML includes Monaco editor script (CDN or bundled)
 * - HTML includes current resource data as JSON
 * - HTML has save button that triggers PUT
 * - Resource URL displayed in header
 *
 * These tests are RED phase TDD tests - they MUST FAIL until the endpoint
 * is implemented.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DO, type Env } from '../../DO'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock SQL storage cursor result
 */
interface MockSqlCursor {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[]
}

/**
 * Mock SQL storage that simulates Cloudflare's SqlStorage API
 */
function createMockSqlStorage() {
  return {
    exec(_query: string, ..._params: unknown[]): MockSqlCursor {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
  }
}

/**
 * Mock KV storage for Durable Object state
 */
function createMockKvStorage() {
  const storage = new Map<string, unknown>()

  return {
    get: vi.fn(async <T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined> => {
      if (Array.isArray(key)) {
        const result = new Map<string, T>()
        for (const k of key) {
          const value = storage.get(k)
          if (value !== undefined) {
            result.set(k, value as T)
          }
        }
        return result as Map<string, T>
      }
      return storage.get(key) as T | undefined
    }),
    put: vi.fn(async <T>(key: string | Record<string, T>, value?: T): Promise<void> => {
      if (typeof key === 'object') {
        for (const [k, v] of Object.entries(key)) {
          storage.set(k, v)
        }
      } else {
        storage.set(key, value)
      }
    }),
    delete: vi.fn(async (key: string | string[]): Promise<boolean | number> => {
      if (Array.isArray(key)) {
        let count = 0
        for (const k of key) {
          if (storage.delete(k)) count++
        }
        return count
      }
      return storage.delete(key)
    }),
    deleteAll: vi.fn(async (): Promise<void> => {
      storage.clear()
    }),
    list: vi.fn(async <T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> => {
      const result = new Map<string, T>()
      for (const [key, value] of storage) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          result.set(key, value as T)
        }
      }
      return result
    }),
    setAlarm: vi.fn(async (_time: number): Promise<void> => {}),
    getAlarm: vi.fn(async (): Promise<number | null> => null),
    deleteAlarm: vi.fn(async (): Promise<void> => {}),
    _storage: storage,
  }
}

/**
 * Create a mock DurableObjectId
 */
function createMockDOId(name: string = 'test-do-id'): { toString: () => string; equals: (other: unknown) => boolean; name: string } {
  return {
    toString: () => name,
    equals: (other: unknown) => (other as { toString: () => string })?.toString?.() === name,
    name,
  }
}

/**
 * Create a mock DurableObjectState
 */
function createMockState(idName: string = 'test-do-id') {
  const kvStorage = createMockKvStorage()
  const sqlStorage = createMockSqlStorage()

  return {
    id: createMockDOId(idName),
    storage: {
      ...kvStorage,
      sql: sqlStorage,
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async <T>(callback: () => Promise<T>): Promise<T> => callback()),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn(() => []),
  }
}

/**
 * Create a mock environment
 */
function createMockEnv(): Env {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
  }
}

/**
 * Create a test DO instance
 */
function createTestDO(): DO {
  const state = createMockState()
  const env = createMockEnv()
  // @ts-expect-error - Mock state doesn't have all DurableObjectState properties
  return new DO(state, env)
}

/**
 * Create an initialized DO instance with namespace
 */
async function createInitializedDO(ns: string = 'https://headless.ly'): Promise<DO> {
  const doInstance = createTestDO()
  await doInstance.initialize({ ns })
  return doInstance
}

// ============================================================================
// 1. GET /:type/:id/edit - Content Type Tests
// ============================================================================

describe('Edit UI: Content Type', () => {
  it('should return text/html content type for GET /:type/:id/edit', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    // GET https://headless.ly/customers/alice/edit
    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)

    // RED: This should fail because the /edit endpoint is not implemented
    // The endpoint should return HTML, not JSON
    expect(response.headers.get('content-type')).toContain('text/html')
  })

  it('should return 200 status for edit endpoint', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)

    // RED: Edit endpoint should return 200 OK
    expect(response.status).toBe(200)
  })

  it('should not return JSON content type', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)

    // RED: Edit endpoint returns HTML, not JSON
    expect(response.headers.get('content-type')).not.toContain('application/json')
  })
})

// ============================================================================
// 2. Monaco Editor Script Inclusion
// ============================================================================

describe('Edit UI: Monaco Editor', () => {
  it('should include Monaco editor script reference', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: HTML should contain reference to Monaco editor
    // Either via CDN (monaco-editor) or bundled module
    expect(html).toContain('monaco-editor')
  })

  it('should include Monaco editor loader script', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: Should have script tag for Monaco loader
    expect(html).toMatch(/<script[^>]*monaco[^>]*>/)
  })

  it('should configure Monaco for JSON editing', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: Monaco should be configured for JSON language
    expect(html).toContain('language')
    expect(html).toMatch(/language['":\s]*['"]?json['"]?/)
  })
})

// ============================================================================
// 3. Resource Data Embedding
// ============================================================================

describe('Edit UI: Resource Data', () => {
  it('should embed current resource data as JSON', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: The HTML should contain the current resource data as embedded JSON
    // Expected pattern: const data = { ... } or similar
    expect(html).toMatch(/const\s+data\s*=\s*\{/)
  })

  it('should include $id field in embedded data', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: Embedded data should contain linked data field $id
    expect(html).toContain('"$id"')
  })

  it('should include $type field in embedded data', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: Embedded data should contain linked data field $type
    expect(html).toContain('"$type"')
  })

  it('should include $context field in embedded data', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: Embedded data should contain linked data field $context
    expect(html).toContain('"$context"')
  })

  it('should have JSON data parseable as valid JSON', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: The embedded JSON should be valid and parseable
    // Extract the data assignment and validate it
    const dataMatch = html.match(/const\s+data\s*=\s*(\{[\s\S]*?\});/)
    expect(dataMatch).not.toBeNull()

    if (dataMatch) {
      expect(() => JSON.parse(dataMatch[1]!)).not.toThrow()
    }
  })
})

// ============================================================================
// 4. Save Functionality
// ============================================================================

describe('Edit UI: Save Functionality', () => {
  it('should include save button', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: HTML should have a save button
    expect(html).toMatch(/<button[^>]*>.*save.*<\/button>/i)
  })

  it('should configure save to use PUT method', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: Save operation should use PUT method for updates
    expect(html).toContain('PUT')
  })

  it('should target the resource URL for save', async () => {
    const doInstance = await createInitializedDO('https://headless.ly/customers/alice/edit')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: Save should PUT to the resource URL (without /edit)
    expect(html).toContain('/customers/alice')
  })

  it('should include fetch or XMLHttpRequest for saving', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: Should have JavaScript fetch or XMLHttpRequest for saving
    expect(html).toMatch(/fetch\(|XMLHttpRequest/)
  })

  it('should set Content-Type to application/json for save', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: Save request should use application/json content type
    expect(html).toContain('application/json')
  })
})

// ============================================================================
// 5. Header with URL
// ============================================================================

describe('Edit UI: Header Display', () => {
  it('should display the full resource URL in header', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: Header should show the full URL of the resource being edited
    expect(html).toContain('https://headless.ly/customers/alice')
  })

  it('should have a header element', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: Should have an HTML header element
    expect(html).toMatch(/<header[^>]*>|<h1[^>]*>/)
  })

  it('should indicate the resource type in header', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: Header should indicate the resource type (Customer)
    expect(html).toMatch(/customer/i)
  })

  it('should indicate the resource ID in header', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: Header should indicate the resource ID (alice)
    expect(html).toContain('alice')
  })
})

// ============================================================================
// 6. HTML Structure Tests
// ============================================================================

describe('Edit UI: HTML Structure', () => {
  it('should have valid HTML doctype', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: Should have proper HTML5 doctype
    expect(html).toMatch(/<!DOCTYPE html>/i)
  })

  it('should have html, head, and body elements', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: Should have proper HTML structure
    expect(html).toContain('<html')
    expect(html).toContain('<head')
    expect(html).toContain('<body')
  })

  it('should have a title element', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: Should have a title for the page
    expect(html).toMatch(/<title[^>]*>.*<\/title>/)
  })

  it('should include title with resource info', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: Title should contain resource information
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/)
    expect(titleMatch).not.toBeNull()
    expect(titleMatch![1]).toMatch(/edit|customer|alice/i)
  })

  it('should have container for Monaco editor', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: Should have a div container for the Monaco editor
    expect(html).toMatch(/<div[^>]*id=["']?editor["']?[^>]*>/)
  })
})

// ============================================================================
// 7. Different Resource Types
// ============================================================================

describe('Edit UI: Different Resource Types', () => {
  it('should work for products resource type', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/products/widget-1/edit')
    const response = await doInstance.fetch(request)

    // RED: Should return HTML for products edit endpoint too
    expect(response.headers.get('content-type')).toContain('text/html')
  })

  it('should display correct URL for products', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/products/widget-1/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: Should show products URL in header
    expect(html).toContain('/products/widget-1')
  })

  it('should work for orders resource type', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/orders/ord-123/edit')
    const response = await doInstance.fetch(request)

    // RED: Should return HTML for orders edit endpoint
    expect(response.headers.get('content-type')).toContain('text/html')
  })

  it('should configure correct save URL for different types', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/orders/ord-123/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: Save URL should match the resource being edited
    expect(html).toContain('/orders/ord-123')
  })
})

// ============================================================================
// 8. Error Handling
// ============================================================================

describe('Edit UI: Error Handling', () => {
  it('should handle non-existent resource gracefully', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/non-existent-id/edit')
    const response = await doInstance.fetch(request)

    // RED: Should still return HTML (possibly with empty/default data)
    // or a 404 HTML page, not a JSON error
    expect(response.headers.get('content-type')).toContain('text/html')
  })

  it('should show empty editor for new resources', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/new-resource/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: Editor should still be present even for new/empty resources
    expect(html).toContain('monaco-editor')
  })
})

// ============================================================================
// 9. Different Namespaces
// ============================================================================

describe('Edit UI: Different Namespaces', () => {
  it('should use correct namespace in displayed URL', async () => {
    const doInstance = await createInitializedDO('https://acme.do')

    const request = new Request('https://acme.do/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: URL should reflect the actual namespace
    expect(html).toContain('https://acme.do/customers/alice')
  })

  it('should embed data with correct $context for namespace', async () => {
    const doInstance = await createInitializedDO('https://acme.do')

    const request = new Request('https://acme.do/products/widget/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // RED: $context should reflect the namespace or standard context URL
    expect(html).toContain('$context')
  })
})
