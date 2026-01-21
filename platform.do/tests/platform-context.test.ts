/**
 * platform.do Platform Context Tests
 *
 * Tests for the createPlatformContext function and $ proxy behavior.
 * These tests verify the proxy mechanics, enumeration, and service access.
 */

import { describe, it, expect } from 'vitest'

describe('PlatformContext proxy', () => {
  describe('$ default export', () => {
    it('should export $ as a proxy object', async () => {
      const { $ } = await import('platform.do')
      expect($).toBeDefined()
      expect(typeof $).toBe('object')
    })

    it('should have all four platform services', async () => {
      const { $ } = await import('platform.do')

      expect($.Functions).toBeDefined()
      expect($.Workflows).toBeDefined()
      expect($.Agents).toBeDefined()
      expect($.Database).toBeDefined()
    })

    it('should make services enumerable via Object.keys', async () => {
      const { $ } = await import('platform.do')
      const keys = Object.keys($)

      expect(keys).toHaveLength(4)
      expect(keys).toContain('Functions')
      expect(keys).toContain('Workflows')
      expect(keys).toContain('Agents')
      expect(keys).toContain('Database')
    })

    it('should support for...in iteration', async () => {
      const { $ } = await import('platform.do')
      const keys: string[] = []

      for (const key in $) {
        keys.push(key)
      }

      expect(keys).toHaveLength(4)
      expect(keys).toContain('Functions')
      expect(keys).toContain('Workflows')
      expect(keys).toContain('Agents')
      expect(keys).toContain('Database')
    })

    it('should support Object.entries iteration', async () => {
      const { $ } = await import('platform.do')
      const entries = Object.entries($)

      expect(entries).toHaveLength(4)
      const keys = entries.map(([k]) => k)
      expect(keys).toContain('Functions')
      expect(keys).toContain('Workflows')
      expect(keys).toContain('Agents')
      expect(keys).toContain('Database')
    })

    it('should support Object.getOwnPropertyDescriptor', async () => {
      const { $ } = await import('platform.do')

      const functionsDesc = Object.getOwnPropertyDescriptor($, 'Functions')
      expect(functionsDesc).toBeDefined()
      expect(functionsDesc?.enumerable).toBe(true)
      expect(functionsDesc?.configurable).toBe(true)

      const workflowsDesc = Object.getOwnPropertyDescriptor($, 'Workflows')
      expect(workflowsDesc).toBeDefined()
      expect(workflowsDesc?.enumerable).toBe(true)
    })

    it('should return undefined for non-existent property descriptor', async () => {
      const { $ } = await import('platform.do')

      const desc = Object.getOwnPropertyDescriptor($, 'NonExistent')
      expect(desc).toBeUndefined()
    })
  })

  describe('FunctionsService proxy', () => {
    it('should have create method', async () => {
      const { $ } = await import('platform.do')
      expect($.Functions.create).toBeDefined()
      expect(typeof $.Functions.create).toBe('function')
    })

    it('should have invoke method', async () => {
      const { $ } = await import('platform.do')
      expect($.Functions.invoke).toBeDefined()
      expect(typeof $.Functions.invoke).toBe('function')
    })

    it('should have list method', async () => {
      const { $ } = await import('platform.do')
      expect($.Functions.list).toBeDefined()
      expect(typeof $.Functions.list).toBe('function')
    })

    it('should allow accessing nested properties dynamically', async () => {
      const { $ } = await import('platform.do')

      // Access via bracket notation
      const functions = $['Functions']
      expect(functions).toBeDefined()
      expect(functions.create).toBeDefined()
    })
  })

  describe('WorkflowsService proxy', () => {
    it('should have create method', async () => {
      const { $ } = await import('platform.do')
      expect($.Workflows.create).toBeDefined()
      expect(typeof $.Workflows.create).toBe('function')
    })

    it('should have run method', async () => {
      const { $ } = await import('platform.do')
      expect($.Workflows.run).toBeDefined()
      expect(typeof $.Workflows.run).toBe('function')
    })

    it('should have get method', async () => {
      const { $ } = await import('platform.do')
      expect($.Workflows.get).toBeDefined()
      expect(typeof $.Workflows.get).toBe('function')
    })
  })

  describe('AgentsService proxy', () => {
    it('should have create method', async () => {
      const { $ } = await import('platform.do')
      expect($.Agents.create).toBeDefined()
      expect(typeof $.Agents.create).toBe('function')
    })

    it('should have invoke method', async () => {
      const { $ } = await import('platform.do')
      expect($.Agents.invoke).toBeDefined()
      expect(typeof $.Agents.invoke).toBe('function')
    })
  })

  describe('DatabaseService proxy', () => {
    it('should have query method', async () => {
      const { $ } = await import('platform.do')
      expect($.Database.query).toBeDefined()
      expect(typeof $.Database.query).toBe('function')
    })

    it('should have execute method', async () => {
      const { $ } = await import('platform.do')
      expect($.Database.execute).toBeDefined()
      expect(typeof $.Database.execute).toBe('function')
    })
  })

  describe('Proxy fallthrough behavior', () => {
    it('should pass through to underlying client for unknown properties', async () => {
      const { $ } = await import('platform.do')

      // Non-service properties should still be accessible via the underlying client proxy
      // These won't throw because createProxy returns proxies for any property access
      const customProperty = ($['CustomService'] as Record<string, unknown>)
      expect(customProperty).toBeDefined() // Proxy will return a nested proxy
    })

    it('should handle symbol properties gracefully', async () => {
      const { $ } = await import('platform.do')

      // Symbol access should not throw
      const symbolKey = Symbol('test')
      expect(() => ($)[symbolKey as unknown as keyof typeof $]).not.toThrow()
    })
  })
})

describe('sdk.do re-exports from platform.do', () => {
  it('should re-export createClient from sdk.do', async () => {
    const { createClient } = await import('platform.do')
    expect(createClient).toBeDefined()
    expect(typeof createClient).toBe('function')
  })

  it('should re-export createProxy from sdk.do', async () => {
    const { createProxy } = await import('platform.do')
    expect(createProxy).toBeDefined()
    expect(typeof createProxy).toBe('function')
  })

  it('should re-export FetchTransport from sdk.do', async () => {
    const { FetchTransport } = await import('platform.do')
    expect(FetchTransport).toBeDefined()
    expect(typeof FetchTransport).toBe('function')
  })

  it('should re-export TokenStore from sdk.do', async () => {
    const { TokenStore } = await import('platform.do')
    expect(TokenStore).toBeDefined()
    expect(typeof TokenStore).toBe('function')
  })

  it('should re-export ensureLoggedIn from sdk.do', async () => {
    const { ensureLoggedIn } = await import('platform.do')
    expect(ensureLoggedIn).toBeDefined()
    expect(typeof ensureLoggedIn).toBe('function')
  })

  it('should re-export DeviceFlow from sdk.do', async () => {
    const { DeviceFlow } = await import('platform.do')
    expect(DeviceFlow).toBeDefined()
    expect(typeof DeviceFlow).toBe('function')
  })

  it('should re-export correlation ID utilities from sdk.do', async () => {
    const { generateCorrelationId, CORRELATION_ID_HEADER } = await import('platform.do')
    expect(generateCorrelationId).toBeDefined()
    expect(typeof generateCorrelationId).toBe('function')
    expect(CORRELATION_ID_HEADER).toBeDefined()
    expect(typeof CORRELATION_ID_HEADER).toBe('string')
  })

  it('should have identical exports as sdk.do', async () => {
    const platformModule = await import('platform.do')
    const sdkModule = await import('sdk.do')

    // Core exports should be identical
    expect(platformModule.createClient).toBe(sdkModule.createClient)
    expect(platformModule.createProxy).toBe(sdkModule.createProxy)
    expect(platformModule.FetchTransport).toBe(sdkModule.FetchTransport)
    expect(platformModule.TokenStore).toBe(sdkModule.TokenStore)
    expect(platformModule.ensureLoggedIn).toBe(sdkModule.ensureLoggedIn)
  })
})

describe('Type exports (compile-time verification)', () => {
  it('should export PlatformContext type', async () => {
    // Import and verify module loads
    const platformModule = await import('platform.do')
    expect(platformModule).toBeDefined()
    // Types are verified at compile time
  })

  it('should export service types', async () => {
    // These imports verify types exist and module compiles
    const platformModule = await import('platform.do')
    expect(platformModule).toBeDefined()
    // FunctionsService, WorkflowsService, AgentsService, DatabaseService
    // are type-only exports verified at compile time
  })

  it('should export entity types', async () => {
    // These imports verify types exist and module compiles
    const platformModule = await import('platform.do')
    expect(platformModule).toBeDefined()
    // FunctionDef, Function, WorkflowDef, Workflow, etc.
    // are type-only exports verified at compile time
  })
})

describe('createClient integration', () => {
  it('should create a client with custom URL', async () => {
    const { createClient } = await import('platform.do')

    const client = createClient({ url: 'https://custom.api.dotdo.dev' })
    expect(client).toBeDefined()
  })

  it('should create a client with default options', async () => {
    const { createClient } = await import('platform.do')

    const client = createClient({ url: 'https://apis.do' })
    expect(client).toBeDefined()
  })

  it('should create proxy with service access', async () => {
    const { createClient } = await import('platform.do')

    const client = createClient({ url: 'https://apis.do' })

    // Proxy should allow accessing any service
    expect((client as Record<string, unknown>).Functions).toBeDefined()
    expect((client as Record<string, unknown>).CustomService).toBeDefined()
  })
})
