// TDD test for do-dwti: MCP tools array mutation race condition
// RED: Tests demonstrating direct push to tools array can cause race conditions
//
// Problem: server.tools array is exposed directly, allowing consumers to mutate
// it via server.tools.push() instead of using server.addTool(). This bypasses
// registry synchronization and can cause race conditions.
//
// Expected behavior:
// 1. Tools array should be read-only or encapsulated
// 2. All mutations should go through addTool() to maintain registry consistency
// 3. Concurrent addTool() calls should not cause data corruption

import { describe, it, expect, beforeEach } from 'vitest'
import { createMCPServer, type MCPServer, type MCPTool } from '../server'
import { ToolRegistry } from '../discovery'

function createTestTool(name: string): MCPTool {
  return {
    name,
    description: `Test tool: ${name}`,
    inputSchema: { type: 'object' },
    execute: async () => ({ result: name })
  }
}

describe('MCP Tools Array Mutation Race Conditions (do-dwti)', () => {
  describe('RED: Direct array mutation bypasses registry', () => {
    it('should NOT allow direct push to tools array (bypasses addTool)', () => {
      const registry = new ToolRegistry()
      const server = createMCPServer({ name: 'test', registry })

      // Using addTool correctly registers in both places
      server.addTool(createTestTool('proper-tool'))
      expect(server.tools.length).toBe(1)
      expect(registry.get('proper-tool')).toBeDefined()

      // BUG: Direct push bypasses registry!
      // This is the problematic pattern we want to prevent
      server.tools.push(createTestTool('sneaky-tool'))

      // Tool is in array but NOT in registry - inconsistent state!
      expect(server.tools.length).toBe(2)
      expect(server.tools.find(t => t.name === 'sneaky-tool')).toBeDefined()

      // This is the BUG - registry is out of sync
      // After fix, this should not be possible (array should be read-only or protected)
      const sneakyInRegistry = registry.get('sneaky-tool')

      // Currently FAILS because direct push doesn't update registry
      // After fix, the push itself should throw or be prevented
      expect(sneakyInRegistry).toBeDefined() // RED: This will fail currently
    })

    it('should prevent direct array modification methods', () => {
      const server = createMCPServer({ name: 'test' })
      server.addTool(createTestTool('tool-1'))
      server.addTool(createTestTool('tool-2'))

      const originalLength = server.tools.length

      // These mutations should be prevented after the fix:

      // Direct push
      server.tools.push(createTestTool('pushed'))

      // Splice
      server.tools.splice(0, 1) // Remove first tool

      // Direct assignment (if array not frozen)
      server.tools[0] = createTestTool('replaced')

      // Pop
      server.tools.pop()

      // After fix, array should be unchanged or mutations should throw
      // Currently these all succeed, causing state corruption
      expect(server.tools.length).toBe(originalLength) // RED: Will fail
    })
  })

  describe('RED: Concurrent addTool race conditions', () => {
    it('should handle concurrent addTool calls without data loss', async () => {
      const server = createMCPServer({ name: 'test' })
      const toolCount = 100

      // Simulate concurrent tool registration (like during server startup)
      const promises = Array.from({ length: toolCount }, (_, i) =>
        Promise.resolve().then(() => {
          server.addTool(createTestTool(`concurrent-tool-${i}`))
        })
      )

      await Promise.all(promises)

      // All tools should be registered
      expect(server.tools.length).toBe(toolCount)

      // Verify no duplicates or missing tools
      const names = server.tools.map(t => t.name)
      const uniqueNames = new Set(names)
      expect(uniqueNames.size).toBe(toolCount)
    })

    it('should maintain consistency between tools and /mcp/tools endpoint', async () => {
      const server = createMCPServer({ name: 'test' })

      // Add some tools
      server.addTool(createTestTool('api-tool-1'))
      server.addTool(createTestTool('api-tool-2'))

      // Someone directly mutates the array (bad practice)
      server.tools.push(createTestTool('direct-tool'))

      // Fetch tools list
      const request = new Request('http://localhost/mcp/tools')
      const response = await server.fetch(request)
      const json = await response.json() as { tools: { name: string }[] }

      // Currently the direct-push tool WILL appear in API (inconsistent with registry)
      // After fix, either:
      // a) Direct push is prevented
      // b) Or API endpoint should use registry, not raw array

      // The tool count should match expected (2 via addTool)
      // This RED test exposes that direct mutation pollutes the API response
      expect(json.tools.length).toBe(2) // RED: Will be 3 currently
    })
  })

  describe('RED: Interleaved read/write race conditions', () => {
    it('should provide consistent snapshot during iteration', async () => {
      const server = createMCPServer({ name: 'test' })

      // Pre-populate with some tools
      for (let i = 0; i < 5; i++) {
        server.addTool(createTestTool(`initial-${i}`))
      }

      // Start iterating over tools (simulating tool listing)
      const iteratedTools: string[] = []
      const iterationPromise = (async () => {
        // Simulate async iteration with yields
        for (const tool of server.tools) {
          iteratedTools.push(tool.name)
          // Yield to allow other operations
          await new Promise(resolve => setTimeout(resolve, 0))
        }
      })()

      // While iterating, add more tools
      server.addTool(createTestTool('late-addition'))
      server.tools.push(createTestTool('direct-late-addition'))

      await iterationPromise

      // With exposed mutable array, iteration may or may not include late additions
      // depending on timing - this is non-deterministic behavior

      // After fix with immutable/snapshot pattern:
      // Iteration should see a consistent snapshot (either all 5 or all 7, not random)

      // This test verifies the tools array returns a defensive copy or is frozen
      const afterTools = server.tools
      server.tools.push(createTestTool('another-direct'))

      // If properly encapsulated, the returned array should not be the same reference
      // or modifications to it should not affect internal state
      expect(afterTools).not.toBe(server.tools) // RED: Currently same reference
    })
  })

  describe('RED: Registry synchronization', () => {
    it('should keep registry in sync with tools array', () => {
      const registry = new ToolRegistry()
      const server = createMCPServer({ name: 'test', registry })

      // Add via proper method
      server.addTool(createTestTool('synced-tool'))

      // Verify both have the tool
      expect(server.tools.find(t => t.name === 'synced-tool')).toBeDefined()
      expect(registry.get('synced-tool')).toBeDefined()

      // Now directly manipulate array
      server.tools.length = 0 // Clear array directly

      // BUG: Registry is now out of sync with tools array!
      // Registry still has the tool, but tools array is empty
      expect(server.tools.length).toBe(0)
      expect(registry.get('synced-tool')).toBeUndefined() // RED: Still defined in registry
    })

    it('should prevent array clearing without registry update', () => {
      const registry = new ToolRegistry()
      const server = createMCPServer({ name: 'test', registry })

      server.addTool(createTestTool('tool-to-clear'))
      server.addTool(createTestTool('another-tool'))

      // Direct array operations that cause desync
      server.tools.pop()
      server.tools.shift()

      // After fix, these should either:
      // a) Throw (array is frozen/read-only)
      // b) Also update registry (array is a proxy)
      // c) Return a copy (defensive copy pattern)

      expect(registry.get('tool-to-clear')).toBeUndefined() // RED: Still defined
      expect(registry.get('another-tool')).toBeUndefined() // RED: Still defined
    })
  })

  describe('GREEN (future): Protected array patterns', () => {
    // These tests document expected behavior after the fix

    it('should expose tools as readonly array', () => {
      const server = createMCPServer({ name: 'test' })
      server.addTool(createTestTool('readonly-test'))

      // After fix, tools should be a readonly array (TypeScript)
      // and either frozen or return a copy at runtime
      const tools = server.tools

      // Option 1: Frozen array - mutations throw
      // Option 2: Defensive copy - mutations don't affect internal state
      // Option 3: Proxy that intercepts and prevents mutations

      // For now, just verify the getter exists and returns tools
      expect(Array.isArray(tools)).toBe(true)
      expect(tools.length).toBe(1)
    })

    it('should provide getTools() method returning a copy', () => {
      // Preferred pattern: method that explicitly returns a copy
      // server.getTools() instead of server.tools

      // This test is a design suggestion for the fix
      const server = createMCPServer({ name: 'test' })
      server.addTool(createTestTool('copy-test'))

      // If getTools() existed:
      // const copy1 = server.getTools()
      // const copy2 = server.getTools()
      // expect(copy1).not.toBe(copy2) // Different array instances
      // expect(copy1).toEqual(copy2)  // Same contents

      // Placeholder assertion for now
      expect(server.tools).toBeDefined()
    })
  })
})

describe('Array mutation detection', () => {
  it('demonstrates how direct array push causes inconsistency', () => {
    // This test clearly documents the exact bug

    const registry = new ToolRegistry()
    const server = createMCPServer({ name: 'test', registry })

    // Step 1: Add tool properly
    server.addTool({
      name: 'proper',
      description: 'Added via addTool',
      inputSchema: {},
      execute: async () => 'proper'
    })

    // Verify: both synchronized
    expect(server.tools.length).toBe(1)
    expect(registry.list().length).toBe(1)

    // Step 2: Add tool improperly (direct push)
    server.tools.push({
      name: 'improper',
      description: 'Added via direct push',
      inputSchema: {},
      execute: async () => 'improper'
    })

    // BUG: Tools array has 2, registry has 1
    expect(server.tools.length).toBe(2)
    expect(registry.list().length).toBe(1) // Still 1! Desync!

    // The 'improper' tool is in the array
    expect(server.tools.find(t => t.name === 'improper')).toBeDefined()

    // But NOT in the registry
    expect(registry.get('improper')).toBeUndefined()

    // This is the race condition - if code relies on registry for some operations
    // and raw array for others, behavior becomes inconsistent
  })
})
