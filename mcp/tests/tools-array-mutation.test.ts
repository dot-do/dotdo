// TDD test for do-tisl: MCP tools array mutation race condition
// GREEN: Tests verifying that direct push to tools array is prevented
//
// Solution: server.tools array is now read-only (frozen defensive copy)
//
// Benefits:
// 1. Tools array cannot be directly mutated via server.tools.push()
// 2. All mutations must go through server.addTool() which maintains registry consistency
// 3. Concurrent addTool() calls are safe (no data corruption possible)
// 4. Consumers always see a consistent snapshot of tools
//
// Implementation:
// - Changed from public tools array to getter that returns Object.freeze([...toolsArray])
// - Internal toolsArray remains mutable for addTool() operations
// - External callers cannot modify the returned frozen array

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

describe('MCP Tools Array Mutation Race Conditions (do-tisl)', () => {
  describe('GREEN: Direct array mutation prevented', () => {
    it('should prevent direct push to tools array (enforces addTool)', () => {
      const registry = new ToolRegistry()
      const server = createMCPServer({ name: 'test', registry })

      // Using addTool correctly registers in both places
      server.addTool(createTestTool('proper-tool'))
      expect(server.tools.length).toBe(1)
      expect(registry.get('proper-tool')).toBeDefined()

      // Fix: Direct push is now prevented (frozen array)
      // This should throw because the array is frozen
      expect(() => {
        (server.tools as MCPTool[]).push(createTestTool('sneaky-tool'))
      }).toThrow()

      // Tools array remains unchanged - protected from direct mutation
      expect(server.tools.length).toBe(1)
      expect(server.tools.find(t => t.name === 'sneaky-tool')).toBeUndefined()

      // Registry remains in sync
      expect(registry.get('sneaky-tool')).toBeUndefined()
    })

    it('should prevent all direct array modification methods', () => {
      const server = createMCPServer({ name: 'test' })
      server.addTool(createTestTool('tool-1'))
      server.addTool(createTestTool('tool-2'))

      const originalLength = server.tools.length
      const toolNames = Array.from(server.tools).map(t => t.name)

      // These mutations should all fail (array is frozen):

      // Direct push should throw
      expect(() => {
        (server.tools as MCPTool[]).push(createTestTool('pushed'))
      }).toThrow()

      // Splice should throw
      expect(() => {
        (server.tools as MCPTool[]).splice(0, 1)
      }).toThrow()

      // Direct assignment should throw
      expect(() => {
        (server.tools as any)[0] = createTestTool('replaced')
      }).toThrow()

      // Pop should throw
      expect(() => {
        (server.tools as MCPTool[]).pop()
      }).toThrow()

      // Array should remain completely unchanged
      expect(server.tools.length).toBe(originalLength)
      expect(Array.from(server.tools).map(t => t.name)).toEqual(toolNames)
    })
  })

  describe('GREEN: Concurrent addTool race conditions', () => {
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
      const names = Array.from(server.tools).map(t => t.name)
      const uniqueNames = new Set(names)
      expect(uniqueNames.size).toBe(toolCount)
    })

    it('should maintain consistency between tools and /mcp/tools endpoint', async () => {
      const server = createMCPServer({ name: 'test' })

      // Add some tools
      server.addTool(createTestTool('api-tool-1'))
      server.addTool(createTestTool('api-tool-2'))

      // Try to directly mutate the array (now prevented)
      expect(() => {
        (server.tools as MCPTool[]).push(createTestTool('direct-tool'))
      }).toThrow()

      // Fetch tools list
      const request = new Request('http://localhost/mcp/tools')
      const response = await server.fetch(request)
      const json = await response.json() as { tools: { name: string }[] }

      // With the fix, direct mutations are prevented
      // The API endpoint reflects only properly added tools
      // Tool count is exactly 2 via addTool
      expect(json.tools.length).toBe(2)
    })
  })

  describe('GREEN: Snapshot consistency', () => {
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

      // While iterating, try to add more tools
      server.addTool(createTestTool('late-addition'))

      // Try to directly mutate (now prevented)
      expect(() => {
        (server.tools as MCPTool[]).push(createTestTool('direct-late-addition'))
      }).toThrow()

      await iterationPromise

      // Iteration captured the snapshot at time of iteration start
      // Since the array is immutable from outside, iteration is always consistent
      expect(iteratedTools.length).toBeGreaterThanOrEqual(5)

      // Each call to server.tools returns a new frozen array
      const snapshot1 = server.tools
      const snapshot2 = server.tools

      // Different instances (defensive copies)
      expect(snapshot1).not.toBe(snapshot2)

      // Same contents
      expect(Array.from(snapshot1)).toEqual(Array.from(snapshot2))
    })
  })

  describe('GREEN: Registry synchronization', () => {
    it('should keep registry in sync with tools array', () => {
      const registry = new ToolRegistry()
      const server = createMCPServer({ name: 'test', registry })

      // Add via proper method
      server.addTool(createTestTool('synced-tool'))

      // Verify both have the tool
      expect(server.tools.find(t => t.name === 'synced-tool')).toBeDefined()
      expect(registry.get('synced-tool')).toBeDefined()

      // Try to directly clear array - should be prevented
      expect(() => {
        (server.tools as any).length = 0
      }).toThrow()

      // Registry remains in sync (both still have the tool)
      expect(server.tools.length).toBe(1)
      expect(registry.get('synced-tool')).toBeDefined()
    })

    it('should prevent array clearing without registry update', () => {
      const registry = new ToolRegistry()
      const server = createMCPServer({ name: 'test', registry })

      server.addTool(createTestTool('tool-to-clear'))
      server.addTool(createTestTool('another-tool'))

      // Direct array operations that would cause desync are now prevented
      expect(() => {
        (server.tools as MCPTool[]).pop()
      }).toThrow()

      expect(() => {
        (server.tools as MCPTool[]).shift()
      }).toThrow()

      // Registry remains in perfect sync
      expect(registry.get('tool-to-clear')).toBeDefined()
      expect(registry.get('another-tool')).toBeDefined()
    })
  })

  describe('GREEN: Protected array patterns', () => {
    it('should expose tools as readonly frozen array', () => {
      const server = createMCPServer({ name: 'test' })
      server.addTool(createTestTool('readonly-test'))

      // Tools are exposed as readonly (TypeScript)
      const tools = server.tools

      // Each getter call returns a new frozen array
      const tools2 = server.tools
      expect(tools).not.toBe(tools2)

      // But with same contents
      expect(Array.from(tools)).toEqual(Array.from(tools2))

      // Both are frozen (immutable)
      expect(Object.isFrozen(tools)).toBe(true)
      expect(Object.isFrozen(tools2)).toBe(true)

      // Verify it's really an array
      expect(Array.isArray(tools)).toBe(true)
      expect(tools.length).toBe(1)
    })

    it('should provide defensive copy preventing external mutations', () => {
      const server = createMCPServer({ name: 'test' })
      server.addTool(createTestTool('copy-test'))

      // Get snapshot
      const copy1 = server.tools
      const initialLength = copy1.length

      // Try to mutate the returned copy
      expect(() => {
        (copy1 as MCPTool[]).push(createTestTool('external-push'))
      }).toThrow()

      // Get new snapshot - should be unaffected
      const copy2 = server.tools
      expect(copy2.length).toBe(initialLength)

      // No external mutations possible
      expect(Array.from(copy2).map(t => t.name)).toContain('copy-test')
      expect(Array.from(copy2).map(t => t.name)).not.toContain('external-push')
    })
  })

  describe('GREEN: Array mutation detection', () => {
    it('demonstrates proper tool registration prevents inconsistency', () => {
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

      // Step 2: Try to add tool improperly (direct push - now prevented)
      expect(() => {
        (server.tools as MCPTool[]).push({
          name: 'improper',
          description: 'Attempted via direct push',
          inputSchema: {},
          execute: async () => 'improper'
        })
      }).toThrow()

      // Both remain in perfect sync (1 tool, not 2)
      expect(server.tools.length).toBe(1)
      expect(registry.list().length).toBe(1)

      // The 'improper' tool is NOT in the array
      expect(server.tools.find(t => t.name === 'improper')).toBeUndefined()

      // And NOT in the registry
      expect(registry.get('improper')).toBeUndefined()

      // Perfect consistency maintained
      expect(Array.from(server.tools).map(t => t.name)).toEqual(['proper'])
      expect(registry.list().map(t => t.name)).toEqual(['proper'])
    })
  })
})
