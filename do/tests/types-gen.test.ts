/**
 * TypeScript Type Generation Tests - TDD Red-Green-Refactor
 *
 * Tests for the _types() RPC handler that generates TypeScript .d.ts definitions.
 *
 * @module do/tests/types-gen.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface TypesResponse {
  types: string
  version: string
  timestamp: number
}

interface RPCError {
  error: string
  code: string
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate a unique test identifier to isolate test data
 */
function generateTestId(): string {
  return `types-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get a fresh DO stub for testing
 */
function getStub(name?: string) {
  const testName = name ?? generateTestId()
  const id = env.DO.idFromName(testName)
  return env.DO.get(id)
}

/**
 * Call the _types RPC endpoint
 */
async function callTypes(stub: DurableObjectStub): Promise<Response> {
  return stub.fetch('https://do/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: '_types', args: [] }),
  })
}

/**
 * Check if a string is valid TypeScript by checking for common patterns
 * Note: Full validation would require the TypeScript compiler
 */
function hasValidTypeScriptPatterns(ts: string): boolean {
  // Should have interface or type declarations
  const hasInterfaces = /interface\s+\w+/.test(ts)
  const hasTypes = /type\s+\w+/.test(ts)

  // Should have properly closed braces
  const openBraces = (ts.match(/\{/g) || []).length
  const closeBraces = (ts.match(/\}/g) || []).length

  return (hasInterfaces || hasTypes) && openBraces === closeBraces
}

/**
 * Check if generated types include expected entity methods
 */
function hasEntityMethods(ts: string): {
  things: boolean
  events: boolean
  relationships: boolean
} {
  return {
    things: /things\s*:/.test(ts) && /create/.test(ts) && /get/.test(ts) && /update/.test(ts) && /delete/.test(ts) && /list/.test(ts),
    events: /events\s*:/.test(ts) && /emit/.test(ts) && /query/.test(ts) && /subscribe/.test(ts),
    relationships: /relationships\s*:/.test(ts) && /add/.test(ts) && /remove/.test(ts) && /find/.test(ts),
  }
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('_types() RPC Handler - TypeScript Generation', () => {
  describe('basic functionality', () => {
    it('should respond to _types RPC method', async () => {
      const stub = getStub()
      const response = await callTypes(stub)

      expect(response.status).toBe(200)
    })

    it('should return JSON response with types field', async () => {
      const stub = getStub()
      const response = await callTypes(stub)

      expect(response.status).toBe(200)
      const json = await response.json() as TypesResponse

      expect(json).toHaveProperty('types')
      expect(typeof json.types).toBe('string')
    })

    it('should return valid TypeScript .d.ts string', async () => {
      const stub = getStub()
      const response = await callTypes(stub)

      const json = await response.json() as TypesResponse

      // Should be a non-empty string
      expect(json.types.length).toBeGreaterThan(0)

      // Should have valid TypeScript patterns
      expect(hasValidTypeScriptPatterns(json.types)).toBe(true)
    })

    it('should include version and timestamp metadata', async () => {
      const stub = getStub()
      const response = await callTypes(stub)

      const json = await response.json() as TypesResponse

      expect(json).toHaveProperty('version')
      expect(typeof json.version).toBe('string')
      expect(json.version.length).toBeGreaterThan(0)

      expect(json).toHaveProperty('timestamp')
      expect(typeof json.timestamp).toBe('number')
      expect(json.timestamp).toBeLessThanOrEqual(Date.now())
    })
  })

  describe('entity method types', () => {
    it('should include ThingsStore methods', async () => {
      const stub = getStub()
      const response = await callTypes(stub)

      const json = await response.json() as TypesResponse
      const { things } = hasEntityMethods(json.types)

      expect(things).toBe(true)
    })

    it('should include EventsStore methods', async () => {
      const stub = getStub()
      const response = await callTypes(stub)

      const json = await response.json() as TypesResponse
      const { events } = hasEntityMethods(json.types)

      expect(events).toBe(true)
    })

    it('should include RelationshipsStore methods', async () => {
      const stub = getStub()
      const response = await callTypes(stub)

      const json = await response.json() as TypesResponse
      const { relationships } = hasEntityMethods(json.types)

      expect(relationships).toBe(true)
    })

    it('should include all CRUD operations for Things', async () => {
      const stub = getStub()
      const response = await callTypes(stub)

      const json = await response.json() as TypesResponse

      // Check for CRUD methods
      expect(json.types).toMatch(/create\s*[<(]/)
      expect(json.types).toMatch(/get\s*\(/)
      expect(json.types).toMatch(/update\s*[<(]/)
      expect(json.types).toMatch(/delete\s*\(/)
      expect(json.types).toMatch(/list\s*\(/)
    })
  })

  describe('JSDoc comments', () => {
    it('should include JSDoc comments for interfaces', async () => {
      const stub = getStub()
      const response = await callTypes(stub)

      const json = await response.json() as TypesResponse

      // Should have JSDoc comments
      expect(json.types).toMatch(/\/\*\*[\s\S]*?\*\//)
    })

    it('should have descriptive comments for entity stores', async () => {
      const stub = getStub()
      const response = await callTypes(stub)

      const json = await response.json() as TypesResponse

      // Should have comments mentioning the stores
      expect(json.types).toMatch(/Things|Entity|Storage/i)
      expect(json.types).toMatch(/Events?/i)
      expect(json.types).toMatch(/Relationship/i)
    })
  })

  describe('workflow context types', () => {
    it('should include WorkflowContext ($) types', async () => {
      const stub = getStub()
      const response = await callTypes(stub)

      const json = await response.json() as TypesResponse

      // Should reference WorkflowContext or $ types
      expect(json.types).toMatch(/WorkflowContext|\$|context/i)
    })

    it('should include scheduling methods', async () => {
      const stub = getStub()
      const response = await callTypes(stub)

      const json = await response.json() as TypesResponse

      // Should have scheduling-related types
      expect(json.types).toMatch(/every|schedule|alarm/i)
    })

    it('should include event handler types', async () => {
      const stub = getStub()
      const response = await callTypes(stub)

      const json = await response.json() as TypesResponse

      // Should have event handler types
      expect(json.types).toMatch(/on\s*:|EventHandler|handler/i)
    })
  })

  describe('DO interface types', () => {
    it('should include main DO interface', async () => {
      const stub = getStub()
      const response = await callTypes(stub)

      const json = await response.json() as TypesResponse

      // Should have a DO interface
      expect(json.types).toMatch(/interface\s+(DO|DurableObject|DigitalObject)/i)
    })

    it('should include fetch method type', async () => {
      const stub = getStub()
      const response = await callTypes(stub)

      const json = await response.json() as TypesResponse

      // Should have fetch method
      expect(json.types).toMatch(/fetch\s*\(/)
    })

    it('should include alarm method type', async () => {
      const stub = getStub()
      const response = await callTypes(stub)

      const json = await response.json() as TypesResponse

      // Should have alarm method
      expect(json.types).toMatch(/alarm\s*\(/)
    })
  })

  describe('type correctness', () => {
    it('should have proper Promise return types for async methods', async () => {
      const stub = getStub()
      const response = await callTypes(stub)

      const json = await response.json() as TypesResponse

      // Async methods should return Promise
      expect(json.types).toMatch(/Promise</)
    })

    it('should include branded types (ThingId, EventId)', async () => {
      const stub = getStub()
      const response = await callTypes(stub)

      const json = await response.json() as TypesResponse

      // Should reference branded ID types
      expect(json.types).toMatch(/ThingId|EventId|\$id\s*:/i)
    })

    it('should include system fields ($id, $type, $createdAt, $updatedAt)', async () => {
      const stub = getStub()
      const response = await callTypes(stub)

      const json = await response.json() as TypesResponse

      // Should have system fields
      expect(json.types).toMatch(/\$id/)
      expect(json.types).toMatch(/\$type/)
      expect(json.types).toMatch(/\$createdAt|\$timestamp/)
    })
  })

  describe('caching behavior', () => {
    it('should return consistent types for same DO instance', async () => {
      const testName = generateTestId()
      const stub1 = getStub(testName)
      const stub2 = getStub(testName)

      const response1 = await callTypes(stub1)
      const response2 = await callTypes(stub2)

      const json1 = await response1.json() as TypesResponse
      const json2 = await response2.json() as TypesResponse

      // Types should be identical
      expect(json1.types).toBe(json2.types)
      expect(json1.version).toBe(json2.version)
    })

    it('should include cache-related headers or metadata', async () => {
      const stub = getStub()
      const response = await callTypes(stub)

      // Response should indicate caching capability
      const cacheControl = response.headers.get('Cache-Control')
      const json = await response.json() as TypesResponse

      // Either has cache headers or timestamp for client-side caching
      expect(cacheControl !== null || json.timestamp !== undefined).toBe(true)
    })
  })

  describe('custom entity types', () => {
    it('should support custom type registration', async () => {
      const stub = getStub()

      // First create a thing with a custom type
      const createResponse = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'things.create',
          args: [{ $type: 'Customer', name: 'Alice', email: 'alice@example.com' }]
        }),
      })

      expect(createResponse.status).toBe(200)

      // Now get types - could potentially include registered custom types
      const typesResponse = await callTypes(stub)
      const json = await typesResponse.json() as TypesResponse

      // Types should still be valid
      expect(hasValidTypeScriptPatterns(json.types)).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should handle _types call gracefully even with invalid args', async () => {
      const stub = getStub()

      // Call with unexpected args (should still work)
      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: '_types', args: ['unexpected', 'args'] }),
      })

      // Should still succeed - args are ignored
      expect(response.status).toBe(200)
      const json = await response.json() as TypesResponse
      expect(json.types).toBeDefined()
    })
  })

  describe('format options', () => {
    it('should support format option for minified output', async () => {
      const stub = getStub()

      // Call with format option
      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: '_types', args: [{ format: 'minified' }] }),
      })

      expect(response.status).toBe(200)
      const json = await response.json() as TypesResponse

      // Minified should have fewer newlines
      const newlineCount = (json.types.match(/\n/g) || []).length

      // Get normal format for comparison
      const normalResponse = await callTypes(stub)
      const normalJson = await normalResponse.json() as TypesResponse
      const normalNewlines = (normalJson.types.match(/\n/g) || []).length

      // Minified should have same or fewer newlines
      expect(newlineCount).toBeLessThanOrEqual(normalNewlines)
    })
  })
})
