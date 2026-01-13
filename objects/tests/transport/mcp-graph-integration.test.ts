/**
 * MCP Graph Integration Tests
 *
 * RED TDD: These tests verify that the MCP server can discover tools from
 * the graph store and track tool invocations as relationships.
 *
 * @see dotdo-b5txz - [GREEN] Implement MCP Graph Integration
 *
 * Key requirements tested:
 * 1. getMcpToolsFromGraph - Discover tools from graph-stored Tool Things
 * 2. Invocation tracking - Create relationship records on tools/call
 * 3. Backward compatibility - Support both $mcp static config and graph
 * 4. Tool merging - Combine tools from multiple sources
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { GraphStore, GraphThing, GraphRelationship } from '../../../db/graph/types'

// ============================================================================
// MOCK GRAPHSTORE IMPLEMENTATION
// ============================================================================

/**
 * In-memory GraphStore implementation for testing.
 * Simulates tool Things stored in the graph.
 */
class MockGraphStore implements GraphStore {
  private things: Map<string, GraphThing> = new Map()
  private relationships: Map<string, GraphRelationship> = new Map()

  async createThing(input: Omit<GraphThing, 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<GraphThing> {
    const now = Date.now()
    const thing: GraphThing = {
      ...input,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }
    this.things.set(thing.id, thing)
    return thing
  }

  async getThing(id: string): Promise<GraphThing | null> {
    return this.things.get(id) ?? null
  }

  async getThingsByType(options: { typeId?: number; typeName?: string }): Promise<GraphThing[]> {
    return Array.from(this.things.values()).filter((t) => {
      if (options.typeId !== undefined && t.typeId !== options.typeId) return false
      if (options.typeName !== undefined && t.typeName !== options.typeName) return false
      return t.deletedAt === null
    })
  }

  async updateThing(id: string, updates: { data?: Record<string, unknown> | null }): Promise<GraphThing | null> {
    const thing = this.things.get(id)
    if (!thing) return null
    const updated = { ...thing, data: updates.data ?? thing.data, updatedAt: Date.now() }
    this.things.set(id, updated)
    return updated
  }

  async deleteThing(id: string): Promise<GraphThing | null> {
    const thing = this.things.get(id)
    if (!thing) return null
    const deleted = { ...thing, deletedAt: Date.now() }
    this.things.set(id, deleted)
    return deleted
  }

  async createRelationship(input: {
    id: string
    verb: string
    from: string
    to: string
    data?: Record<string, unknown>
  }): Promise<GraphRelationship> {
    const rel: GraphRelationship = {
      id: input.id,
      verb: input.verb,
      from: input.from,
      to: input.to,
      data: input.data ?? null,
      createdAt: new Date(),
    }
    this.relationships.set(rel.id, rel)
    return rel
  }

  async queryRelationshipsFrom(url: string, options?: { verb?: string }): Promise<GraphRelationship[]> {
    return Array.from(this.relationships.values()).filter((r) => {
      if (r.from !== url) return false
      if (options?.verb && r.verb !== options.verb) return false
      return true
    })
  }

  async queryRelationshipsTo(url: string, options?: { verb?: string }): Promise<GraphRelationship[]> {
    return Array.from(this.relationships.values()).filter((r) => {
      if (r.to !== url) return false
      if (options?.verb && r.verb !== options.verb) return false
      return true
    })
  }

  async queryRelationshipsByVerb(verb: string): Promise<GraphRelationship[]> {
    return Array.from(this.relationships.values()).filter((r) => r.verb === verb)
  }

  async deleteRelationship(id: string): Promise<boolean> {
    return this.relationships.delete(id)
  }

  // Test helpers
  getRelationship(id: string): GraphRelationship | undefined {
    return this.relationships.get(id)
  }

  getAllRelationships(): GraphRelationship[] {
    return Array.from(this.relationships.values())
  }
}

// ============================================================================
// TOOL THING TYPES
// ============================================================================

/**
 * Tool parameter definition stored in graph.
 */
interface ToolParameter {
  name: string
  type: string
  description?: string
  required?: boolean
  schema?: Record<string, unknown>
}

/**
 * Tool definition stored as a Thing in the graph.
 * This is the structure stored in GraphThing.data.
 */
interface ToolThingData {
  id: string
  description: string
  parameters: ToolParameter[]
  handler?: string // Optional: method name to invoke
}

// ============================================================================
// IMPORTS FROM MCP-SERVER (after implementation)
// ============================================================================

// These will be imported from mcp-server.ts after implementation
import type { McpTool } from '../../transport/mcp-server'

// ============================================================================
// TESTS: getMcpToolsFromGraph
// ============================================================================

describe('MCP Graph Integration', () => {
  describe('getMcpToolsFromGraph', () => {
    let graphStore: MockGraphStore

    beforeEach(async () => {
      graphStore = new MockGraphStore()

      // Seed test tool Things
      await graphStore.createThing({
        id: 'tool-search',
        typeId: 100, // Tool type
        typeName: 'Tool',
        data: {
          id: 'search',
          description: 'Search for items in the database',
          parameters: [
            { name: 'query', type: 'string', description: 'Search query', required: true },
            { name: 'limit', type: 'number', description: 'Max results', required: false },
          ],
        } satisfies ToolThingData,
      })

      await graphStore.createThing({
        id: 'tool-create',
        typeId: 100,
        typeName: 'Tool',
        data: {
          id: 'create',
          description: 'Create a new item',
          parameters: [
            { name: 'name', type: 'string', description: 'Item name', required: true },
            { name: 'data', type: 'object', description: 'Item data', required: false },
          ],
        } satisfies ToolThingData,
      })
    })

    it('should discover tools from graph-stored Tool Things', async () => {
      const { getMcpToolsFromGraph } = await import('../../transport/mcp-server')

      const tools = await getMcpToolsFromGraph(graphStore)

      expect(Array.isArray(tools)).toBe(true)
      expect(tools.length).toBe(2)
    })

    it('should convert Tool Things to MCP tool format', async () => {
      const { getMcpToolsFromGraph } = await import('../../transport/mcp-server')

      const tools = await getMcpToolsFromGraph(graphStore)

      const searchTool = tools.find((t) => t.name === 'search')
      expect(searchTool).toBeDefined()
      expect(searchTool!.description).toBe('Search for items in the database')
      expect(searchTool!.inputSchema.type).toBe('object')
      expect(searchTool!.inputSchema.properties.query).toBeDefined()
      expect(searchTool!.inputSchema.properties.query.type).toBe('string')
    })

    it('should include required fields in schema', async () => {
      const { getMcpToolsFromGraph } = await import('../../transport/mcp-server')

      const tools = await getMcpToolsFromGraph(graphStore)

      const searchTool = tools.find((t) => t.name === 'search')
      expect(searchTool!.inputSchema.required).toContain('query')
      expect(searchTool!.inputSchema.required).not.toContain('limit')
    })

    it('should filter tools by query', async () => {
      const { getMcpToolsFromGraph } = await import('../../transport/mcp-server')

      // Query only tools with 'search' in the ID
      const tools = await getMcpToolsFromGraph(graphStore, { idPrefix: 'search' })

      expect(tools.length).toBe(1)
      expect(tools[0]!.name).toBe('search')
    })

    it('should return empty array when no Tool Things exist', async () => {
      const { getMcpToolsFromGraph } = await import('../../transport/mcp-server')

      const emptyStore = new MockGraphStore()
      const tools = await getMcpToolsFromGraph(emptyStore)

      expect(tools).toEqual([])
    })

    it('should handle Tool Things with missing parameters gracefully', async () => {
      const { getMcpToolsFromGraph } = await import('../../transport/mcp-server')

      await graphStore.createThing({
        id: 'tool-simple',
        typeId: 100,
        typeName: 'Tool',
        data: {
          id: 'simple',
          description: 'A simple tool with no parameters',
          parameters: [],
        } satisfies ToolThingData,
      })

      const tools = await getMcpToolsFromGraph(graphStore)

      const simpleTool = tools.find((t) => t.name === 'simple')
      expect(simpleTool).toBeDefined()
      expect(simpleTool!.inputSchema.properties).toEqual({})
    })
  })

  // ==========================================================================
  // TESTS: toolThingToMcp conversion
  // ==========================================================================

  describe('toolThingToMcp', () => {
    it('should convert a Tool Thing to MCP tool format', async () => {
      const { toolThingToMcp } = await import('../../transport/mcp-server')

      const toolThing: GraphThing = {
        id: 'tool-test',
        typeId: 100,
        typeName: 'Tool',
        data: {
          id: 'testTool',
          description: 'A test tool',
          parameters: [
            { name: 'arg1', type: 'string', description: 'First argument', required: true },
          ],
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      }

      const mcpTool = toolThingToMcp(toolThing)

      expect(mcpTool.name).toBe('testTool')
      expect(mcpTool.description).toBe('A test tool')
      expect(mcpTool.inputSchema.type).toBe('object')
      expect(mcpTool.inputSchema.properties.arg1).toEqual({
        type: 'string',
        description: 'First argument',
      })
      expect(mcpTool.inputSchema.required).toEqual(['arg1'])
    })

    it('should handle complex parameter schemas', async () => {
      const { toolThingToMcp } = await import('../../transport/mcp-server')

      const toolThing: GraphThing = {
        id: 'tool-complex',
        typeId: 100,
        typeName: 'Tool',
        data: {
          id: 'complexTool',
          description: 'A tool with complex schema',
          parameters: [
            {
              name: 'config',
              type: 'object',
              description: 'Configuration object',
              required: true,
              schema: {
                properties: {
                  enabled: { type: 'boolean' },
                  count: { type: 'number' },
                },
              },
            },
          ],
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      }

      const mcpTool = toolThingToMcp(toolThing)

      expect(mcpTool.inputSchema.properties.config.type).toBe('object')
    })
  })

  // ==========================================================================
  // TESTS: Invocation Tracking
  // ==========================================================================

  describe('Invocation Tracking', () => {
    let graphStore: MockGraphStore

    beforeEach(async () => {
      graphStore = new MockGraphStore()

      // Seed a test tool
      await graphStore.createThing({
        id: 'tool-calculate',
        typeId: 100,
        typeName: 'Tool',
        data: {
          id: 'calculate',
          description: 'Perform a calculation',
          parameters: [
            { name: 'a', type: 'number', required: true },
            { name: 'b', type: 'number', required: true },
            { name: 'operation', type: 'string', required: true },
          ],
        } satisfies ToolThingData,
      })
    })

    it('should create invocation relationship on tool call', async () => {
      const { trackToolInvocation } = await import('../../transport/mcp-server')

      const sessionId = 'session-123'
      const toolId = 'tool-calculate'
      const input = { a: 5, b: 3, operation: 'add' }

      const invocation = await trackToolInvocation(graphStore, {
        sessionId,
        toolId,
        input,
      })

      expect(invocation).toBeDefined()
      expect(invocation.verb).toBe('invoke')
      expect(invocation.from).toContain(sessionId)
      expect(invocation.to).toBe(toolId)
      expect(invocation.data).toMatchObject({ input })
    })

    it('should record startedAt timestamp in invocation data', async () => {
      const { trackToolInvocation } = await import('../../transport/mcp-server')

      const before = Date.now()

      const invocation = await trackToolInvocation(graphStore, {
        sessionId: 'session-456',
        toolId: 'tool-calculate',
        input: { a: 1, b: 2, operation: 'multiply' },
      })

      const after = Date.now()

      const startedAt = (invocation.data as { startedAt: number }).startedAt
      expect(startedAt).toBeGreaterThanOrEqual(before)
      expect(startedAt).toBeLessThanOrEqual(after)
    })

    it('should update invocation with result on success', async () => {
      const { trackToolInvocation, completeToolInvocation } = await import('../../transport/mcp-server')

      const invocation = await trackToolInvocation(graphStore, {
        sessionId: 'session-789',
        toolId: 'tool-calculate',
        input: { a: 10, b: 5, operation: 'divide' },
      })

      const result = { value: 2 }
      const completed = await completeToolInvocation(graphStore, invocation.id, {
        result,
        duration: 50,
      })

      expect(completed.verb).toBe('invoked')
      expect((completed.data as { output: unknown }).output).toEqual(result)
      expect((completed.data as { duration: number }).duration).toBe(50)
    })

    it('should update invocation with error on failure', async () => {
      const { trackToolInvocation, completeToolInvocation } = await import('../../transport/mcp-server')

      const invocation = await trackToolInvocation(graphStore, {
        sessionId: 'session-error',
        toolId: 'tool-calculate',
        input: { a: 10, b: 0, operation: 'divide' },
      })

      const errorMessage = 'Division by zero'
      const completed = await completeToolInvocation(graphStore, invocation.id, {
        error: errorMessage,
        duration: 10,
      })

      expect(completed.verb).toBe('invoked')
      expect((completed.data as { error: string }).error).toBe(errorMessage)
    })

    it('should query invocations by session', async () => {
      const { trackToolInvocation } = await import('../../transport/mcp-server')

      const sessionId = 'session-query-test'

      // Create multiple invocations
      await trackToolInvocation(graphStore, {
        sessionId,
        toolId: 'tool-calculate',
        input: { a: 1, b: 1, operation: 'add' },
      })

      await trackToolInvocation(graphStore, {
        sessionId,
        toolId: 'tool-calculate',
        input: { a: 2, b: 2, operation: 'add' },
      })

      const invocations = await graphStore.queryRelationshipsFrom(`do://sessions/${sessionId}`, {
        verb: 'invoke',
      })

      expect(invocations.length).toBe(2)
    })
  })

  // ==========================================================================
  // TESTS: Merged Tool Discovery
  // ==========================================================================

  describe('Merged Tool Discovery', () => {
    let graphStore: MockGraphStore

    beforeEach(async () => {
      graphStore = new MockGraphStore()

      // Add a graph-stored tool
      await graphStore.createThing({
        id: 'tool-graph-tool',
        typeId: 100,
        typeName: 'Tool',
        data: {
          id: 'graphTool',
          description: 'A tool from graph',
          parameters: [],
        } satisfies ToolThingData,
      })
    })

    it('should merge tools from static config and graph', async () => {
      const { getMergedMcpTools } = await import('../../transport/mcp-server')

      // Static tools from $mcp config
      const staticTools: McpTool[] = [
        {
          name: 'staticTool',
          description: 'A static tool',
          inputSchema: { type: 'object', properties: {} },
        },
      ]

      const merged = await getMergedMcpTools(staticTools, graphStore)

      expect(merged.length).toBe(2)
      expect(merged.some((t) => t.name === 'staticTool')).toBe(true)
      expect(merged.some((t) => t.name === 'graphTool')).toBe(true)
    })

    it('should prefer static config over graph for duplicate tool names', async () => {
      const { getMergedMcpTools } = await import('../../transport/mcp-server')

      // Add a graph tool with same name as static
      await graphStore.createThing({
        id: 'tool-duplicate',
        typeId: 100,
        typeName: 'Tool',
        data: {
          id: 'duplicate',
          description: 'Graph version',
          parameters: [],
        } satisfies ToolThingData,
      })

      const staticTools: McpTool[] = [
        {
          name: 'duplicate',
          description: 'Static version',
          inputSchema: { type: 'object', properties: {} },
        },
      ]

      const merged = await getMergedMcpTools(staticTools, graphStore)

      const duplicateTool = merged.find((t) => t.name === 'duplicate')
      expect(duplicateTool!.description).toBe('Static version')
    })

    it('should work without graph store (backward compatible)', async () => {
      const { getMergedMcpTools } = await import('../../transport/mcp-server')

      const staticTools: McpTool[] = [
        {
          name: 'onlyStatic',
          description: 'Only from static config',
          inputSchema: { type: 'object', properties: {} },
        },
      ]

      // Pass undefined for graph store
      const merged = await getMergedMcpTools(staticTools, undefined)

      expect(merged.length).toBe(1)
      expect(merged[0]!.name).toBe('onlyStatic')
    })
  })

  // ==========================================================================
  // TESTS: GraphStore Interface Compatibility
  // ==========================================================================

  describe('GraphStore Interface Compatibility', () => {
    it('should accept any GraphStore implementation', async () => {
      const { getMcpToolsFromGraph } = await import('../../transport/mcp-server')

      // MockGraphStore implements GraphStore interface
      const store = new MockGraphStore()

      // Should not throw
      await expect(getMcpToolsFromGraph(store)).resolves.toBeDefined()
    })

    it('should handle graph store errors gracefully', async () => {
      const { getMcpToolsFromGraph } = await import('../../transport/mcp-server')

      // Create a store that throws
      const errorStore: GraphStore = {
        async createThing() {
          throw new Error('DB error')
        },
        async getThing() {
          throw new Error('DB error')
        },
        async getThingsByType() {
          throw new Error('DB error')
        },
        async updateThing() {
          throw new Error('DB error')
        },
        async deleteThing() {
          throw new Error('DB error')
        },
        async createRelationship() {
          throw new Error('DB error')
        },
        async queryRelationshipsFrom() {
          throw new Error('DB error')
        },
        async queryRelationshipsTo() {
          throw new Error('DB error')
        },
        async queryRelationshipsByVerb() {
          throw new Error('DB error')
        },
        async deleteRelationship() {
          throw new Error('DB error')
        },
      }

      // Should return empty array instead of throwing
      const tools = await getMcpToolsFromGraph(errorStore)
      expect(tools).toEqual([])
    })
  })
})
