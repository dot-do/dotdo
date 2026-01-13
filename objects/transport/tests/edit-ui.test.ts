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

// ============================================================================
// 10. Save Feedback UX
// ============================================================================

describe('Edit UI: Save Feedback', () => {
  it('should include JSON validation before save', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // Save function should validate JSON before sending
    expect(html).toContain('JSON.parse')
    expect(html).toContain('Invalid JSON')
  })

  it('should show saving state while request is in progress', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // Save button should show "Saving..." state
    expect(html).toContain('Saving...')
    expect(html).toContain('disabled')
  })

  it('should navigate to view URL on success', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // On successful save, navigate to view URL
    expect(html).toContain('window.location.href = viewUrl')
  })

  it('should show error message when save fails', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // Error should be shown via showError function
    expect(html).toContain('showError(')
    expect(html).toContain('.catch(err')
  })

  it('should restore save button to normal state after error', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // Save button should be re-enabled after error
    expect(html).toContain('saveBtn.disabled = false')
    expect(html).toContain("textContent = 'Save'")
  })
})

// ============================================================================
// 11. Keyboard Shortcuts
// ============================================================================

describe('Edit UI: Keyboard Shortcuts', () => {
  it('should have Ctrl+S keyboard shortcut for save', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // Should listen for keyboard events
    expect(html).toContain('keydown')
    expect(html).toContain('ctrlKey')
    expect(html).toContain("e.key === 's'")
  })

  it('should support Cmd+S on Mac for save', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // Should support metaKey for Mac Cmd
    expect(html).toContain('metaKey')
  })

  it('should prevent default browser save dialog', async () => {
    const doInstance = await createInitializedDO('https://headless.ly')

    const request = new Request('https://headless.ly/customers/alice/edit')
    const response = await doInstance.fetch(request)
    const html = await response.text()

    // Should prevent default to avoid browser save dialog
    expect(html).toContain('preventDefault')
  })
})

// ============================================================================
// UNIT TESTS: generateEditUI Function
// ============================================================================

import {
  generateEditUI,
  handleEditRequest,
  createEditUIData,
  type EditUIData,
} from '../edit-ui'

describe('generateEditUI: HTML Generation', () => {
  const baseData: EditUIData = {
    $context: 'https://example.com',
    $type: 'https://example.com/Customer',
    $id: 'https://example.com/customers/alice',
  }

  describe('Basic HTML Structure', () => {
    it('should generate valid HTML5 document', () => {
      const html = generateEditUI(baseData)

      expect(html).toMatch(/<!DOCTYPE html>/i)
      expect(html).toContain('<html')
      expect(html).toContain('<head>')
      expect(html).toContain('<body>')
      expect(html).toContain('</html>')
    })

    it('should include UTF-8 charset meta tag', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('charset="UTF-8"')
    })

    it('should include title with type and ID', () => {
      const html = generateEditUI(baseData)
      const titleMatch = html.match(/<title>(.*?)<\/title>/)

      expect(titleMatch).not.toBeNull()
      expect(titleMatch![1]).toContain('Customer')
      expect(titleMatch![1]).toContain('alice')
    })
  })

  describe('Monaco Editor Integration', () => {
    it('should include Monaco editor CDN script', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('cdn.jsdelivr.net/npm/monaco-editor')
    })

    it('should configure Monaco for JSON language', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain("language: 'json'")
    })

    it('should use dark theme by default', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain("theme: 'vs-dark'")
    })

    it('should enable automatic layout', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('automaticLayout: true')
    })

    it('should include editor container div', () => {
      const html = generateEditUI(baseData)

      expect(html).toMatch(/<div\s+id=["']editor["']/)
    })

    it('should disable minimap for cleaner UI', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('minimap: { enabled: false }')
    })
  })

  describe('Data Embedding', () => {
    it('should embed data as JavaScript object', () => {
      const html = generateEditUI(baseData)

      expect(html).toMatch(/const\s+data\s*=\s*\{/)
    })

    it('should include $context in embedded data', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('"$context"')
      expect(html).toContain('https://example.com')
    })

    it('should include $type in embedded data', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('"$type"')
      expect(html).toContain('https://example.com/Customer')
    })

    it('should include $id in embedded data', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('"$id"')
      expect(html).toContain('https://example.com/customers/alice')
    })

    it('should embed additional data fields', () => {
      const dataWithFields: EditUIData = {
        ...baseData,
        name: 'Alice Smith',
        email: 'alice@example.com',
        age: 30,
        active: true,
      }

      const html = generateEditUI(dataWithFields)

      expect(html).toContain('"name"')
      expect(html).toContain('Alice Smith')
      expect(html).toContain('"email"')
      expect(html).toContain('"age"')
      expect(html).toContain('30')
      expect(html).toContain('"active"')
      expect(html).toContain('true')
    })

    it('should format JSON with proper indentation', () => {
      const html = generateEditUI(baseData)

      // JSON.stringify with 2-space indent
      expect(html).toContain('  "$context"')
    })

    it('should handle nested objects', () => {
      const nestedData: EditUIData = {
        ...baseData,
        address: {
          street: '123 Main St',
          city: 'Springfield',
        },
      }

      const html = generateEditUI(nestedData)

      expect(html).toContain('"address"')
      expect(html).toContain('"street"')
      expect(html).toContain('123 Main St')
    })

    it('should handle arrays', () => {
      const arrayData: EditUIData = {
        ...baseData,
        tags: ['premium', 'active', 'verified'],
      }

      const html = generateEditUI(arrayData)

      expect(html).toContain('"tags"')
      expect(html).toContain('premium')
      expect(html).toContain('active')
    })
  })

  describe('Header Display', () => {
    it('should display type name from $type URL', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('Customer')
    })

    it('should display ID from $id URL', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('alice')
    })

    it('should display full resource URL', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('https://example.com/customers/alice')
    })

    it('should extract type from simple string type', () => {
      const simpleData: EditUIData = {
        $context: 'https://example.com',
        $type: 'Product',
        $id: 'widget-1',
      }

      const html = generateEditUI(simpleData)

      expect(html).toContain('Product')
      expect(html).toContain('widget-1')
    })

    it('should include header element', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('<header')
      expect(html).toContain('</header>')
    })
  })

  describe('Save Button', () => {
    it('should include save button', () => {
      const html = generateEditUI(baseData)

      expect(html).toMatch(/<button[^>]*class="[^"]*save-btn[^"]*"/)
      expect(html).toContain('Save')
    })

    it('should have data-testid for save button', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('data-testid="save-button"')
    })

    it('should configure save with PUT method', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain("method: 'PUT'")
    })

    it('should set JSON content type for save', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain("'Content-Type': 'application/json'")
    })
  })

  describe('Cancel Button', () => {
    it('should include cancel button', () => {
      const html = generateEditUI(baseData)

      expect(html).toMatch(/<button[^>]*class="[^"]*cancel-btn[^"]*"/)
      expect(html).toContain('Cancel')
    })

    it('should have data-testid for cancel button', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('data-testid="cancel-button"')
    })

    it('should navigate back to resource view on cancel', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('function cancel()')
      expect(html).toContain('window.location.href = viewUrl')
    })
  })

  describe('Back Link', () => {
    it('should include back link to resource', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('Back to Customer')
    })

    it('should link to view URL without /edit', () => {
      const html = generateEditUI(baseData)

      expect(html).toMatch(/href="\/customers\/alice"/)
    })
  })
})

// ============================================================================
// UNIT TESTS: Form Field Validation
// ============================================================================

describe('generateEditUI: Field Validation', () => {
  const baseData: EditUIData = {
    $context: 'https://example.com',
    $type: 'https://example.com/Customer',
    $id: 'https://example.com/customers/alice',
  }

  describe('JSON Validation', () => {
    it('should include JSON.parse for validation', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('JSON.parse')
    })

    it('should catch JSON parse errors', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('catch')
      expect(html).toContain('Invalid JSON')
    })

    it('should display validation error message', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('showError')
      expect(html).toContain('Invalid JSON')
    })

    it('should have error message container', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('data-testid="error-message"')
      expect(html).toContain('error-message')
    })

    it('should validate before saving', () => {
      const html = generateEditUI(baseData)

      // JSON.parse should come before fetch
      const parseIndex = html.indexOf('JSON.parse')
      const fetchIndex = html.indexOf('fetch(')

      expect(parseIndex).toBeLessThan(fetchIndex)
    })
  })

  describe('Error Display', () => {
    it('should have showError function', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('function showError')
    })

    it('should have hideError function', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('function hideError')
    })

    it('should toggle error visibility class', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain("classList.add('visible')")
      expect(html).toContain("classList.remove('visible')")
    })

    it('should style error message container', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('.error-message')
      expect(html).toContain('display: none')
    })

    it('should show error with red styling', () => {
      const html = generateEditUI(baseData)

      // Error background color
      expect(html).toMatch(/\.error-message.*background.*#5a1d1d/s)
    })

    it('should hide error before save attempt', () => {
      const html = generateEditUI(baseData)

      // hideError should be called in save function before fetch
      const saveFunc = html.match(/function save\(\)[^}]*\{[\s\S]*?fetch/)
      expect(saveFunc).not.toBeNull()
      expect(saveFunc![0]).toContain('hideError()')
    })
  })
})

// ============================================================================
// UNIT TESTS: Submit Handling
// ============================================================================

describe('generateEditUI: Submit Handling', () => {
  const baseData: EditUIData = {
    $context: 'https://example.com',
    $type: 'https://example.com/Customer',
    $id: 'https://example.com/customers/alice',
  }

  describe('Save Function', () => {
    it('should have save function', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('function save()')
    })

    it('should get content from Monaco editor', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('editor.getValue()')
    })

    it('should use fetch API for submission', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('fetch(resourceUrl')
    })

    it('should pass editor content as request body', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('body: content')
    })
  })

  describe('Loading State', () => {
    it('should disable save button during save', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('saveBtn.disabled = true')
    })

    it('should set loading data attribute', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain("setAttribute('data-loading', 'true')")
    })

    it('should change button text to Saving...', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain("textContent = 'Saving...'")
    })

    it('should re-enable button after error', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('saveBtn.disabled = false')
    })

    it('should reset button text after error', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain("textContent = 'Save'")
    })
  })

  describe('Success Handling', () => {
    it('should check response status', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('r.ok')
    })

    it('should navigate to view URL on success', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('window.location.href = viewUrl')
    })
  })

  describe('Error Handling', () => {
    it('should handle HTTP errors', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('throw new Error')
      expect(html).toContain('HTTP')
    })

    it('should parse error response JSON', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('r.json()')
    })

    it('should show error message on failure', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('showError(')
    })

    it('should handle catch block', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('.catch(err')
    })
  })

  describe('Keyboard Shortcuts', () => {
    it('should listen for keydown events', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain("addEventListener('keydown'")
    })

    it('should check for Ctrl key', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('e.ctrlKey')
    })

    it('should check for Meta key (Cmd on Mac)', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('e.metaKey')
    })

    it('should check for S key', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain("e.key === 's'")
    })

    it('should prevent default on keyboard save', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('e.preventDefault()')
    })

    it('should call save function on keyboard shortcut', () => {
      const html = generateEditUI(baseData)

      expect(html).toContain('save()')
    })
  })
})

// ============================================================================
// UNIT TESTS: Field Types
// ============================================================================

describe('generateEditUI: Field Types', () => {
  const baseData: EditUIData = {
    $context: 'https://example.com',
    $type: 'https://example.com/Customer',
    $id: 'https://example.com/customers/alice',
  }

  describe('String Fields', () => {
    it('should handle string values', () => {
      const data: EditUIData = {
        ...baseData,
        name: 'Alice Smith',
        email: 'alice@example.com',
      }

      const html = generateEditUI(data)

      expect(html).toContain('"name": "Alice Smith"')
      expect(html).toContain('"email": "alice@example.com"')
    })

    it('should escape special characters in strings', () => {
      const data: EditUIData = {
        ...baseData,
        description: 'Line 1\nLine 2',
        path: 'C:\\Users\\Alice',
      }

      const html = generateEditUI(data)

      // JSON should escape newlines and backslashes
      expect(html).toContain('\\n')
      expect(html).toContain('\\\\')
    })

    it('should handle empty strings', () => {
      const data: EditUIData = {
        ...baseData,
        bio: '',
      }

      const html = generateEditUI(data)

      expect(html).toContain('"bio": ""')
    })
  })

  describe('Number Fields', () => {
    it('should handle integer values', () => {
      const data: EditUIData = {
        ...baseData,
        age: 30,
        score: 100,
      }

      const html = generateEditUI(data)

      expect(html).toContain('"age": 30')
      expect(html).toContain('"score": 100')
    })

    it('should handle floating point values', () => {
      const data: EditUIData = {
        ...baseData,
        balance: 123.45,
        rate: 0.15,
      }

      const html = generateEditUI(data)

      expect(html).toContain('"balance": 123.45')
      expect(html).toContain('"rate": 0.15')
    })

    it('should handle zero', () => {
      const data: EditUIData = {
        ...baseData,
        count: 0,
      }

      const html = generateEditUI(data)

      expect(html).toContain('"count": 0')
    })

    it('should handle negative numbers', () => {
      const data: EditUIData = {
        ...baseData,
        offset: -10,
      }

      const html = generateEditUI(data)

      expect(html).toContain('"offset": -10')
    })
  })

  describe('Boolean Fields', () => {
    it('should handle true values', () => {
      const data: EditUIData = {
        ...baseData,
        active: true,
        verified: true,
      }

      const html = generateEditUI(data)

      expect(html).toContain('"active": true')
      expect(html).toContain('"verified": true')
    })

    it('should handle false values', () => {
      const data: EditUIData = {
        ...baseData,
        deleted: false,
        premium: false,
      }

      const html = generateEditUI(data)

      expect(html).toContain('"deleted": false')
      expect(html).toContain('"premium": false')
    })
  })

  describe('Null Fields', () => {
    it('should handle null values', () => {
      const data: EditUIData = {
        ...baseData,
        deletedAt: null,
      }

      const html = generateEditUI(data)

      expect(html).toContain('"deletedAt": null')
    })
  })

  describe('Array Fields', () => {
    it('should handle string arrays', () => {
      const data: EditUIData = {
        ...baseData,
        tags: ['premium', 'vip', 'active'],
      }

      const html = generateEditUI(data)

      expect(html).toContain('"tags"')
      expect(html).toContain('"premium"')
      expect(html).toContain('"vip"')
    })

    it('should handle number arrays', () => {
      const data: EditUIData = {
        ...baseData,
        scores: [95, 87, 92],
      }

      const html = generateEditUI(data)

      expect(html).toContain('"scores"')
      expect(html).toContain('95')
      expect(html).toContain('87')
    })

    it('should handle empty arrays', () => {
      const data: EditUIData = {
        ...baseData,
        items: [],
      }

      const html = generateEditUI(data)

      expect(html).toContain('"items": []')
    })

    it('should handle mixed-type arrays', () => {
      const data: EditUIData = {
        ...baseData,
        mixed: ['string', 42, true, null],
      }

      const html = generateEditUI(data)

      expect(html).toContain('"mixed"')
    })
  })

  describe('Object Fields', () => {
    it('should handle nested objects', () => {
      const data: EditUIData = {
        ...baseData,
        address: {
          street: '123 Main St',
          city: 'Springfield',
          zip: '12345',
        },
      }

      const html = generateEditUI(data)

      expect(html).toContain('"address"')
      expect(html).toContain('"street"')
      expect(html).toContain('123 Main St')
    })

    it('should handle deeply nested objects', () => {
      const data: EditUIData = {
        ...baseData,
        company: {
          name: 'Acme Corp',
          location: {
            building: 'HQ',
            floor: 10,
          },
        },
      }

      const html = generateEditUI(data)

      expect(html).toContain('"company"')
      expect(html).toContain('"location"')
      expect(html).toContain('"building"')
    })

    it('should handle empty objects', () => {
      const data: EditUIData = {
        ...baseData,
        metadata: {},
      }

      const html = generateEditUI(data)

      expect(html).toContain('"metadata": {}')
    })
  })

  describe('Date-like Fields', () => {
    it('should handle ISO date strings', () => {
      const data: EditUIData = {
        ...baseData,
        createdAt: '2024-01-15T10:30:00Z',
      }

      const html = generateEditUI(data)

      expect(html).toContain('"createdAt": "2024-01-15T10:30:00Z"')
    })
  })
})

// ============================================================================
// UNIT TESTS: handleEditRequest Function
// ============================================================================

describe('handleEditRequest: Request Handler', () => {
  describe('Success Response', () => {
    it('should return HTML response when data exists', async () => {
      const request = new Request('https://example.com/edit')
      const getData = async () => ({
        $context: 'https://example.com',
        $type: 'https://example.com/Customer',
        $id: 'https://example.com/customers/alice',
      })

      const response = await handleEditRequest(request, getData)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toContain('text/html')
    })

    it('should include charset in content type', async () => {
      const request = new Request('https://example.com/edit')
      const getData = async () => ({
        $context: 'https://example.com',
        $type: 'https://example.com/Customer',
        $id: 'https://example.com/customers/alice',
      })

      const response = await handleEditRequest(request, getData)

      expect(response.headers.get('Content-Type')).toContain('charset=utf-8')
    })

    it('should return generated HTML', async () => {
      const request = new Request('https://example.com/edit')
      const getData = async () => ({
        $context: 'https://example.com',
        $type: 'https://example.com/Customer',
        $id: 'https://example.com/customers/alice',
        name: 'Alice',
      })

      const response = await handleEditRequest(request, getData)
      const html = await response.text()

      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('Alice')
    })
  })

  describe('Not Found Response', () => {
    it('should return 404 when getData returns null', async () => {
      const request = new Request('https://example.com/edit')
      const getData = async () => null

      const response = await handleEditRequest(request, getData)

      expect(response.status).toBe(404)
    })

    it('should return text/html content type for 404', async () => {
      const request = new Request('https://example.com/edit')
      const getData = async () => null

      const response = await handleEditRequest(request, getData)

      expect(response.headers.get('Content-Type')).toContain('text/html')
    })

    it('should return Not Found message', async () => {
      const request = new Request('https://example.com/edit')
      const getData = async () => null

      const response = await handleEditRequest(request, getData)
      const text = await response.text()

      expect(text).toBe('Not Found')
    })
  })

  describe('Async getData', () => {
    it('should await getData function', async () => {
      let called = false
      const request = new Request('https://example.com/edit')
      const getData = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        called = true
        return {
          $context: 'https://example.com',
          $type: 'https://example.com/Test',
          $id: 'https://example.com/tests/1',
        }
      }

      await handleEditRequest(request, getData)

      expect(called).toBe(true)
    })
  })
})

// ============================================================================
// UNIT TESTS: createEditUIData Function
// ============================================================================

describe('createEditUIData: Data Creation', () => {
  describe('With Existing Data', () => {
    it('should include $context from namespace', () => {
      const data = createEditUIData('https://example.com', 'Customer', 'alice', {
        name: 'Alice',
      })

      expect(data.$context).toBe('https://example.com')
    })

    it('should construct $type from namespace and type', () => {
      const data = createEditUIData('https://example.com', 'Customer', 'alice', {
        name: 'Alice',
      })

      expect(data.$type).toBe('https://example.com/Customer')
    })

    it('should construct $id from namespace, type, and id', () => {
      const data = createEditUIData('https://example.com', 'Customer', 'alice', {
        name: 'Alice',
      })

      expect(data.$id).toBe('https://example.com/customers/alice')
    })

    it('should include existing data fields', () => {
      const existing = {
        name: 'Alice Smith',
        email: 'alice@example.com',
        age: 30,
      }

      const data = createEditUIData('https://example.com', 'Customer', 'alice', existing)

      expect(data.name).toBe('Alice Smith')
      expect(data.email).toBe('alice@example.com')
      expect(data.age).toBe(30)
    })

    it('should spread existing data over linked data fields', () => {
      const existing = {
        name: 'Alice',
        custom: 'value',
      }

      const data = createEditUIData('https://example.com', 'Customer', 'alice', existing)

      expect(data.$context).toBe('https://example.com')
      expect(data.$type).toBe('https://example.com/Customer')
      expect(data.$id).toBe('https://example.com/customers/alice')
      expect(data.name).toBe('Alice')
      expect(data.custom).toBe('value')
    })

    it('should lowercase type for collection path', () => {
      const data = createEditUIData('https://example.com', 'Product', 'widget', {})

      expect(data.$id).toBe('https://example.com/products/widget')
    })

    it('should handle complex type names', () => {
      const data = createEditUIData('https://example.com', 'OrderItem', 'item-1', {})

      expect(data.$id).toBe('https://example.com/orderitems/item-1')
    })
  })

  describe('Without Existing Data (New Resource)', () => {
    it('should return minimal data for new resource', () => {
      const data = createEditUIData('https://example.com', 'Customer', 'new-id', null)

      expect(data.$context).toBe('https://example.com')
      expect(data.$type).toBe('https://example.com/Customer')
      expect(data.$id).toBe('https://example.com/customers/new-id')
    })

    it('should only have linked data fields when no existing data', () => {
      const data = createEditUIData('https://example.com', 'Customer', 'new-id', null)

      expect(Object.keys(data)).toEqual(['$context', '$type', '$id'])
    })

    it('should handle undefined existing data same as null', () => {
      const data = createEditUIData('https://example.com', 'Customer', 'new-id')

      expect(data.$context).toBe('https://example.com')
      expect(Object.keys(data)).toEqual(['$context', '$type', '$id'])
    })
  })

  describe('Different Namespaces', () => {
    it('should work with different domain namespaces', () => {
      const data = createEditUIData('https://acme.do', 'Task', 'task-1', {})

      expect(data.$context).toBe('https://acme.do')
      expect(data.$type).toBe('https://acme.do/Task')
      expect(data.$id).toBe('https://acme.do/tasks/task-1')
    })

    it('should work with localhost namespace', () => {
      const data = createEditUIData('http://localhost:3000', 'User', 'user-1', {})

      expect(data.$context).toBe('http://localhost:3000')
      expect(data.$type).toBe('http://localhost:3000/User')
      expect(data.$id).toBe('http://localhost:3000/users/user-1')
    })
  })

  describe('Special Characters', () => {
    it('should handle IDs with hyphens', () => {
      const data = createEditUIData('https://example.com', 'Customer', 'alice-bob-charlie', {})

      expect(data.$id).toBe('https://example.com/customers/alice-bob-charlie')
    })

    it('should handle IDs with underscores', () => {
      const data = createEditUIData('https://example.com', 'Customer', 'user_123_abc', {})

      expect(data.$id).toBe('https://example.com/customers/user_123_abc')
    })

    it('should handle numeric IDs', () => {
      const data = createEditUIData('https://example.com', 'Order', '12345', {})

      expect(data.$id).toBe('https://example.com/orders/12345')
    })
  })
})

// ============================================================================
// UNIT TESTS: URL Path Extraction
// ============================================================================

describe('generateEditUI: URL Path Handling', () => {
  describe('Full URL $id', () => {
    it('should extract path from full URL for view link', () => {
      const data: EditUIData = {
        $context: 'https://example.com',
        $type: 'https://example.com/Customer',
        $id: 'https://example.com/customers/alice',
      }

      const html = generateEditUI(data)

      expect(html).toContain('href="/customers/alice"')
    })

    it('should use path for resourceUrl in JavaScript', () => {
      const data: EditUIData = {
        $context: 'https://example.com',
        $type: 'https://example.com/Customer',
        $id: 'https://example.com/customers/alice',
      }

      const html = generateEditUI(data)

      expect(html).toContain("const resourceUrl = '/customers/alice'")
    })
  })

  describe('Path-only $id', () => {
    it('should handle path-only $id', () => {
      const data: EditUIData = {
        $context: 'https://example.com',
        $type: 'Customer',
        $id: '/customers/bob',
      }

      const html = generateEditUI(data)

      expect(html).toContain('href="/customers/bob"')
    })
  })

  describe('Complex Paths', () => {
    it('should handle nested collection paths', () => {
      const data: EditUIData = {
        $context: 'https://example.com',
        $type: 'https://example.com/Organization',
        $id: 'https://example.com/orgs/acme/teams/engineering',
      }

      const html = generateEditUI(data)

      expect(html).toContain('/orgs/acme/teams/engineering')
    })
  })
})
