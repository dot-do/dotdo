/**
 * MCP Server Tool Discovery Tests
 *
 * RED TDD: These tests verify MCP (Model Context Protocol) server tool discovery
 * mechanisms. Tests should FAIL initially because implementation does not exist yet.
 *
 * Key requirements tested:
 * 1. Discovering available tools from various sources
 * 2. Listing tool schemas in MCP-compliant format
 * 3. Tool metadata retrieval and introspection
 * 4. Dynamic tool registration and unregistration
 * 5. Tool versioning and capability negotiation
 *
 * @see https://modelcontextprotocol.io/docs
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type {
  GraphStore,
  GraphThing,
  GraphRelationship,
} from '../types'

// ============================================================================
// TYPE DEFINITIONS FOR MCP TOOL DISCOVERY
// ============================================================================

/**
 * MCP Tool definition as per Model Context Protocol specification.
 */
interface McpTool {
  /** Unique tool name identifier */
  name: string
  /** Human-readable description */
  description: string
  /** JSON Schema for input parameters */
  inputSchema: McpToolInputSchema
  /** Optional annotations for tool categorization */
  annotations?: McpToolAnnotations
}

/**
 * JSON Schema structure for MCP tool input.
 */
interface McpToolInputSchema {
  type: 'object'
  properties: Record<string, McpPropertySchema>
  required?: string[]
}

/**
 * Property schema within tool input schema.
 */
interface McpPropertySchema {
  type: string
  description?: string
  enum?: unknown[]
  default?: unknown
  items?: McpPropertySchema
  properties?: Record<string, McpPropertySchema>
  required?: string[]
  format?: string
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
}

/**
 * Tool annotations for categorization and filtering.
 */
interface McpToolAnnotations {
  /** Tool category (e.g., 'graph', 'search', 'mutation') */
  category?: string
  /** Whether the tool is destructive */
  destructive?: boolean
  /** Tool version */
  version?: string
  /** Required permissions */
  permissions?: string[]
  /** Deprecation info */
  deprecated?: boolean | string
  /** Custom metadata */
  [key: string]: unknown
}

/**
 * Tool discovery query options.
 */
interface ToolDiscoveryOptions {
  /** Filter by category */
  category?: string
  /** Filter by name prefix */
  prefix?: string
  /** Include deprecated tools */
  includeDeprecated?: boolean
  /** Pagination cursor */
  cursor?: string
  /** Maximum results */
  limit?: number
}

/**
 * Tool discovery result with pagination.
 */
interface ToolDiscoveryResult {
  /** Discovered tools */
  tools: McpTool[]
  /** Next page cursor */
  nextCursor?: string
  /** Total count if available */
  totalCount?: number
}

/**
 * Tool registry for dynamic registration.
 */
interface ToolRegistry {
  /** Register a new tool */
  register(tool: McpTool): Promise<void>
  /** Unregister a tool by name */
  unregister(name: string): Promise<boolean>
  /** List all registered tools */
  list(options?: ToolDiscoveryOptions): Promise<ToolDiscoveryResult>
  /** Get a specific tool by name */
  get(name: string): Promise<McpTool | null>
  /** Check if a tool exists */
  has(name: string): Promise<boolean>
  /** Clear all registered tools */
  clear(): Promise<void>
}

/**
 * Tool discovery service interface.
 */
interface ToolDiscoveryService {
  /** Discover all available tools */
  discoverTools(options?: ToolDiscoveryOptions): Promise<ToolDiscoveryResult>
  /** Get tool schema by name */
  getToolSchema(name: string): Promise<McpTool | null>
  /** Validate tool input against schema */
  validateInput(toolName: string, input: unknown): Promise<{ valid: boolean; errors?: string[] }>
  /** Get tool metadata */
  getToolMetadata(name: string): Promise<McpToolAnnotations | null>
  /** List tool categories */
  listCategories(): Promise<string[]>
  /** Refresh tool cache */
  refresh(): Promise<void>
}

// ============================================================================
// MOCK GRAPHSTORE IMPLEMENTATION
// ============================================================================

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

  // Test helper methods
  clear(): void {
    this.things.clear()
    this.relationships.clear()
  }
}

// ============================================================================
// TESTS: Tool Discovery Service
// ============================================================================

describe('MCP Tool Discovery', () => {
  describe('ToolDiscoveryService', () => {
    let graphStore: MockGraphStore
    let discoveryService: ToolDiscoveryService

    beforeEach(async () => {
      graphStore = new MockGraphStore()

      // Seed test tool Things in the graph
      await graphStore.createThing({
        id: 'tool-search-nodes',
        typeId: 100,
        typeName: 'Tool',
        data: {
          name: 'searchNodes',
          description: 'Search for nodes in the graph by label and properties',
          category: 'graph',
          version: '1.0.0',
          parameters: [
            { name: 'label', type: 'string', description: 'Node label to search', required: false },
            { name: 'where', type: 'object', description: 'Property filter conditions', required: false },
            { name: 'limit', type: 'number', description: 'Maximum results', required: false },
          ],
        },
      })

      await graphStore.createThing({
        id: 'tool-create-node',
        typeId: 100,
        typeName: 'Tool',
        data: {
          name: 'createNode',
          description: 'Create a new node in the graph',
          category: 'mutation',
          version: '1.0.0',
          destructive: false,
          parameters: [
            { name: 'label', type: 'string', description: 'Node label', required: true },
            { name: 'properties', type: 'object', description: 'Node properties', required: false },
          ],
        },
      })

      await graphStore.createThing({
        id: 'tool-delete-node',
        typeId: 100,
        typeName: 'Tool',
        data: {
          name: 'deleteNode',
          description: 'Delete a node and its connected edges',
          category: 'mutation',
          version: '1.0.0',
          destructive: true,
          parameters: [
            { name: 'id', type: 'string', description: 'Node ID to delete', required: true },
          ],
        },
      })

      await graphStore.createThing({
        id: 'tool-deprecated',
        typeId: 100,
        typeName: 'Tool',
        data: {
          name: 'legacySearch',
          description: 'Deprecated search function',
          category: 'graph',
          version: '0.1.0',
          deprecated: 'Use searchNodes instead',
          parameters: [
            { name: 'query', type: 'string', description: 'Search query', required: true },
          ],
        },
      })

      // Create discovery service - THIS IMPORT WILL FAIL (RED phase)
      // The createToolDiscoveryService function does not exist yet
      const { createToolDiscoveryService } = await import('../mcp-tool-discovery')
      discoveryService = createToolDiscoveryService(graphStore)
    })

    // ========================================================================
    // TESTS: Discovering Available Tools
    // ========================================================================

    describe('discoverTools', () => {
      it('should discover all available tools', async () => {
        const result = await discoveryService.discoverTools()

        expect(result.tools).toBeDefined()
        expect(Array.isArray(result.tools)).toBe(true)
        expect(result.tools.length).toBeGreaterThanOrEqual(3)
      })

      it('should return tools in MCP-compliant format', async () => {
        const result = await discoveryService.discoverTools()

        for (const tool of result.tools) {
          expect(tool.name).toBeDefined()
          expect(typeof tool.name).toBe('string')
          expect(tool.description).toBeDefined()
          expect(typeof tool.description).toBe('string')
          expect(tool.inputSchema).toBeDefined()
          expect(tool.inputSchema.type).toBe('object')
          expect(tool.inputSchema.properties).toBeDefined()
        }
      })

      it('should filter tools by category', async () => {
        const result = await discoveryService.discoverTools({ category: 'mutation' })

        expect(result.tools.length).toBe(2) // createNode and deleteNode
        expect(result.tools.every((t) => t.annotations?.category === 'mutation')).toBe(true)
      })

      it('should filter tools by name prefix', async () => {
        const result = await discoveryService.discoverTools({ prefix: 'search' })

        expect(result.tools.length).toBe(1)
        expect(result.tools[0]!.name).toBe('searchNodes')
      })

      it('should exclude deprecated tools by default', async () => {
        const result = await discoveryService.discoverTools()

        const deprecatedTool = result.tools.find((t) => t.name === 'legacySearch')
        expect(deprecatedTool).toBeUndefined()
      })

      it('should include deprecated tools when requested', async () => {
        const result = await discoveryService.discoverTools({ includeDeprecated: true })

        const deprecatedTool = result.tools.find((t) => t.name === 'legacySearch')
        expect(deprecatedTool).toBeDefined()
        expect(deprecatedTool!.annotations?.deprecated).toBe('Use searchNodes instead')
      })

      it('should support pagination with cursor', async () => {
        const page1 = await discoveryService.discoverTools({ limit: 2 })

        expect(page1.tools.length).toBeLessThanOrEqual(2)

        if (page1.nextCursor) {
          const page2 = await discoveryService.discoverTools({
            limit: 2,
            cursor: page1.nextCursor,
          })

          expect(page2.tools.length).toBeGreaterThanOrEqual(0)
          // Ensure no overlap
          const page1Names = new Set(page1.tools.map((t) => t.name))
          for (const tool of page2.tools) {
            expect(page1Names.has(tool.name)).toBe(false)
          }
        }
      })

      it('should return total count when available', async () => {
        const result = await discoveryService.discoverTools({ includeDeprecated: true })

        expect(result.totalCount).toBeDefined()
        expect(result.totalCount).toBe(4) // All 4 tools including deprecated
      })
    })

    // ========================================================================
    // TESTS: Listing Tool Schemas
    // ========================================================================

    describe('getToolSchema', () => {
      it('should return tool schema by name', async () => {
        const schema = await discoveryService.getToolSchema('searchNodes')

        expect(schema).not.toBeNull()
        expect(schema!.name).toBe('searchNodes')
        expect(schema!.inputSchema).toBeDefined()
      })

      it('should return null for non-existent tool', async () => {
        const schema = await discoveryService.getToolSchema('nonExistentTool')

        expect(schema).toBeNull()
      })

      it('should include all properties in schema', async () => {
        const schema = await discoveryService.getToolSchema('searchNodes')

        expect(schema!.inputSchema.properties.label).toBeDefined()
        expect(schema!.inputSchema.properties.where).toBeDefined()
        expect(schema!.inputSchema.properties.limit).toBeDefined()
      })

      it('should include property types in schema', async () => {
        const schema = await discoveryService.getToolSchema('searchNodes')

        expect(schema!.inputSchema.properties.label.type).toBe('string')
        expect(schema!.inputSchema.properties.where.type).toBe('object')
        expect(schema!.inputSchema.properties.limit.type).toBe('number')
      })

      it('should include property descriptions in schema', async () => {
        const schema = await discoveryService.getToolSchema('searchNodes')

        expect(schema!.inputSchema.properties.label.description).toBe('Node label to search')
        expect(schema!.inputSchema.properties.where.description).toBe('Property filter conditions')
      })

      it('should include required fields in schema', async () => {
        const schema = await discoveryService.getToolSchema('createNode')

        expect(schema!.inputSchema.required).toBeDefined()
        expect(schema!.inputSchema.required).toContain('label')
        expect(schema!.inputSchema.required).not.toContain('properties')
      })

      it('should handle nested object schemas', async () => {
        // Add a tool with nested schema
        await graphStore.createThing({
          id: 'tool-complex',
          typeId: 100,
          typeName: 'Tool',
          data: {
            name: 'complexQuery',
            description: 'A tool with nested object parameters',
            category: 'graph',
            parameters: [
              {
                name: 'filter',
                type: 'object',
                description: 'Complex filter',
                required: true,
                properties: {
                  field: { type: 'string', description: 'Field name' },
                  operator: { type: 'string', enum: ['eq', 'gt', 'lt', 'in'] },
                  value: { type: 'any' },
                },
              },
            ],
          },
        })

        await discoveryService.refresh()
        const schema = await discoveryService.getToolSchema('complexQuery')

        expect(schema!.inputSchema.properties.filter.type).toBe('object')
        expect(schema!.inputSchema.properties.filter.properties).toBeDefined()
      })

      it('should handle array parameter schemas', async () => {
        await graphStore.createThing({
          id: 'tool-array',
          typeId: 100,
          typeName: 'Tool',
          data: {
            name: 'batchCreate',
            description: 'Create multiple nodes',
            category: 'mutation',
            parameters: [
              {
                name: 'nodes',
                type: 'array',
                description: 'Array of nodes to create',
                required: true,
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    properties: { type: 'object' },
                  },
                },
              },
            ],
          },
        })

        await discoveryService.refresh()
        const schema = await discoveryService.getToolSchema('batchCreate')

        expect(schema!.inputSchema.properties.nodes.type).toBe('array')
        expect(schema!.inputSchema.properties.nodes.items).toBeDefined()
      })
    })

    // ========================================================================
    // TESTS: Tool Metadata
    // ========================================================================

    describe('getToolMetadata', () => {
      it('should return tool metadata (annotations)', async () => {
        const metadata = await discoveryService.getToolMetadata('deleteNode')

        expect(metadata).not.toBeNull()
        expect(metadata!.category).toBe('mutation')
        expect(metadata!.destructive).toBe(true)
        expect(metadata!.version).toBe('1.0.0')
      })

      it('should return null for non-existent tool', async () => {
        const metadata = await discoveryService.getToolMetadata('nonExistent')

        expect(metadata).toBeNull()
      })

      it('should include deprecation info in metadata', async () => {
        const result = await discoveryService.discoverTools({ includeDeprecated: true })
        const legacyTool = result.tools.find((t) => t.name === 'legacySearch')

        expect(legacyTool).toBeDefined()
        const metadata = await discoveryService.getToolMetadata('legacySearch')

        expect(metadata!.deprecated).toBe('Use searchNodes instead')
      })

      it('should include version in metadata', async () => {
        const metadata = await discoveryService.getToolMetadata('searchNodes')

        expect(metadata!.version).toBe('1.0.0')
      })
    })

    // ========================================================================
    // TESTS: Tool Categories
    // ========================================================================

    describe('listCategories', () => {
      it('should list all available tool categories', async () => {
        const categories = await discoveryService.listCategories()

        expect(Array.isArray(categories)).toBe(true)
        expect(categories).toContain('graph')
        expect(categories).toContain('mutation')
      })

      it('should return unique categories only', async () => {
        const categories = await discoveryService.listCategories()

        const uniqueCategories = new Set(categories)
        expect(uniqueCategories.size).toBe(categories.length)
      })

      it('should handle tools without categories', async () => {
        await graphStore.createThing({
          id: 'tool-no-category',
          typeId: 100,
          typeName: 'Tool',
          data: {
            name: 'uncategorized',
            description: 'A tool without category',
            parameters: [],
          },
        })

        await discoveryService.refresh()
        const categories = await discoveryService.listCategories()

        // Should still work without throwing
        expect(Array.isArray(categories)).toBe(true)
      })
    })

    // ========================================================================
    // TESTS: Input Validation
    // ========================================================================

    describe('validateInput', () => {
      it('should validate correct input', async () => {
        const result = await discoveryService.validateInput('searchNodes', {
          label: 'Person',
          limit: 10,
        })

        expect(result.valid).toBe(true)
        expect(result.errors).toBeUndefined()
      })

      it('should reject missing required fields', async () => {
        const result = await discoveryService.validateInput('createNode', {})

        expect(result.valid).toBe(false)
        expect(result.errors).toBeDefined()
        expect(result.errors!.some((e) => e.includes('label'))).toBe(true)
      })

      it('should reject wrong type for field', async () => {
        const result = await discoveryService.validateInput('searchNodes', {
          limit: 'not-a-number',
        })

        expect(result.valid).toBe(false)
        expect(result.errors).toBeDefined()
      })

      it('should allow optional fields to be missing', async () => {
        const result = await discoveryService.validateInput('createNode', {
          label: 'Person',
        })

        expect(result.valid).toBe(true)
      })

      it('should reject unknown tool name', async () => {
        const result = await discoveryService.validateInput('unknownTool', {})

        expect(result.valid).toBe(false)
        expect(result.errors).toBeDefined()
        expect(result.errors![0]).toContain('not found')
      })

      it('should validate nested object properties', async () => {
        await graphStore.createThing({
          id: 'tool-nested-validation',
          typeId: 100,
          typeName: 'Tool',
          data: {
            name: 'nestedTool',
            description: 'Tool with nested validation',
            parameters: [
              {
                name: 'config',
                type: 'object',
                required: true,
                properties: {
                  enabled: { type: 'boolean', required: true },
                },
              },
            ],
          },
        })

        await discoveryService.refresh()

        const validResult = await discoveryService.validateInput('nestedTool', {
          config: { enabled: true },
        })
        expect(validResult.valid).toBe(true)

        const invalidResult = await discoveryService.validateInput('nestedTool', {
          config: { enabled: 'not-boolean' },
        })
        expect(invalidResult.valid).toBe(false)
      })
    })

    // ========================================================================
    // TESTS: Cache Refresh
    // ========================================================================

    describe('refresh', () => {
      it('should refresh tool cache from graph store', async () => {
        const initialResult = await discoveryService.discoverTools({ includeDeprecated: true })
        const initialCount = initialResult.tools.length

        // Add a new tool to graph store
        await graphStore.createThing({
          id: 'tool-new',
          typeId: 100,
          typeName: 'Tool',
          data: {
            name: 'newTool',
            description: 'A newly added tool',
            category: 'graph',
            parameters: [],
          },
        })

        // Before refresh, the new tool should not be visible
        const beforeRefresh = await discoveryService.discoverTools({ includeDeprecated: true })
        // This may or may not have the new tool depending on caching strategy

        // After refresh, new tool should be visible
        await discoveryService.refresh()
        const afterRefresh = await discoveryService.discoverTools({ includeDeprecated: true })

        expect(afterRefresh.tools.length).toBe(initialCount + 1)
        expect(afterRefresh.tools.some((t) => t.name === 'newTool')).toBe(true)
      })

      it('should handle deleted tools after refresh', async () => {
        await discoveryService.refresh()
        const beforeDelete = await discoveryService.discoverTools({ includeDeprecated: true })

        // Delete a tool from graph store
        await graphStore.deleteThing('tool-search-nodes')

        await discoveryService.refresh()
        const afterDelete = await discoveryService.discoverTools({ includeDeprecated: true })

        expect(afterDelete.tools.length).toBe(beforeDelete.tools.length - 1)
        expect(afterDelete.tools.some((t) => t.name === 'searchNodes')).toBe(false)
      })
    })
  })

  // ==========================================================================
  // TESTS: Tool Registry
  // ==========================================================================

  describe('ToolRegistry', () => {
    let registry: ToolRegistry

    beforeEach(async () => {
      // Create tool registry - THIS IMPORT WILL FAIL (RED phase)
      const { createToolRegistry } = await import('../mcp-tool-discovery')
      registry = createToolRegistry()
    })

    describe('register', () => {
      it('should register a new tool', async () => {
        const tool: McpTool = {
          name: 'testTool',
          description: 'A test tool',
          inputSchema: {
            type: 'object',
            properties: {
              input: { type: 'string', description: 'Input value' },
            },
            required: ['input'],
          },
        }

        await registry.register(tool)

        const retrieved = await registry.get('testTool')
        expect(retrieved).toEqual(tool)
      })

      it('should overwrite existing tool with same name', async () => {
        const tool1: McpTool = {
          name: 'overwriteTest',
          description: 'Version 1',
          inputSchema: { type: 'object', properties: {} },
        }

        const tool2: McpTool = {
          name: 'overwriteTest',
          description: 'Version 2',
          inputSchema: { type: 'object', properties: {} },
        }

        await registry.register(tool1)
        await registry.register(tool2)

        const retrieved = await registry.get('overwriteTest')
        expect(retrieved!.description).toBe('Version 2')
      })

      it('should validate tool schema on registration', async () => {
        const invalidTool = {
          name: 'invalidTool',
          description: 'Missing inputSchema',
          // Missing inputSchema - should fail validation
        } as unknown as McpTool

        await expect(registry.register(invalidTool)).rejects.toThrow()
      })
    })

    describe('unregister', () => {
      it('should unregister a tool by name', async () => {
        const tool: McpTool = {
          name: 'toRemove',
          description: 'Tool to be removed',
          inputSchema: { type: 'object', properties: {} },
        }

        await registry.register(tool)
        const removed = await registry.unregister('toRemove')

        expect(removed).toBe(true)
        expect(await registry.has('toRemove')).toBe(false)
      })

      it('should return false for non-existent tool', async () => {
        const removed = await registry.unregister('nonExistent')

        expect(removed).toBe(false)
      })
    })

    describe('list', () => {
      beforeEach(async () => {
        await registry.register({
          name: 'tool1',
          description: 'First tool',
          inputSchema: { type: 'object', properties: {} },
          annotations: { category: 'a' },
        })
        await registry.register({
          name: 'tool2',
          description: 'Second tool',
          inputSchema: { type: 'object', properties: {} },
          annotations: { category: 'b' },
        })
        await registry.register({
          name: 'tool3',
          description: 'Third tool',
          inputSchema: { type: 'object', properties: {} },
          annotations: { category: 'a' },
        })
      })

      it('should list all registered tools', async () => {
        const result = await registry.list()

        expect(result.tools.length).toBe(3)
      })

      it('should filter by category', async () => {
        const result = await registry.list({ category: 'a' })

        expect(result.tools.length).toBe(2)
      })

      it('should support pagination', async () => {
        const page1 = await registry.list({ limit: 2 })

        expect(page1.tools.length).toBe(2)
        expect(page1.nextCursor).toBeDefined()

        const page2 = await registry.list({ cursor: page1.nextCursor, limit: 2 })

        expect(page2.tools.length).toBe(1)
      })
    })

    describe('get', () => {
      it('should get tool by name', async () => {
        const tool: McpTool = {
          name: 'getTool',
          description: 'Tool for get test',
          inputSchema: { type: 'object', properties: {} },
        }

        await registry.register(tool)
        const retrieved = await registry.get('getTool')

        expect(retrieved).toEqual(tool)
      })

      it('should return null for non-existent tool', async () => {
        const retrieved = await registry.get('nonExistent')

        expect(retrieved).toBeNull()
      })
    })

    describe('has', () => {
      it('should return true for existing tool', async () => {
        await registry.register({
          name: 'existingTool',
          description: 'Existing',
          inputSchema: { type: 'object', properties: {} },
        })

        expect(await registry.has('existingTool')).toBe(true)
      })

      it('should return false for non-existent tool', async () => {
        expect(await registry.has('nonExistent')).toBe(false)
      })
    })

    describe('clear', () => {
      it('should remove all registered tools', async () => {
        await registry.register({
          name: 'tool1',
          description: 'First',
          inputSchema: { type: 'object', properties: {} },
        })
        await registry.register({
          name: 'tool2',
          description: 'Second',
          inputSchema: { type: 'object', properties: {} },
        })

        await registry.clear()

        const result = await registry.list()
        expect(result.tools.length).toBe(0)
      })
    })
  })

  // ==========================================================================
  // TESTS: Tool Schema Conversion
  // ==========================================================================

  describe('Tool Schema Conversion', () => {
    it('should convert GraphThing to McpTool format', async () => {
      const { graphThingToMcpTool } = await import('../mcp-tool-discovery')

      const graphThing: GraphThing = {
        id: 'tool-convert-test',
        typeId: 100,
        typeName: 'Tool',
        data: {
          name: 'convertTest',
          description: 'Test conversion',
          parameters: [
            { name: 'arg1', type: 'string', description: 'First arg', required: true },
            { name: 'arg2', type: 'number', description: 'Second arg', required: false },
          ],
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      }

      const mcpTool = graphThingToMcpTool(graphThing)

      expect(mcpTool.name).toBe('convertTest')
      expect(mcpTool.description).toBe('Test conversion')
      expect(mcpTool.inputSchema.type).toBe('object')
      expect(mcpTool.inputSchema.properties.arg1).toBeDefined()
      expect(mcpTool.inputSchema.properties.arg1.type).toBe('string')
      expect(mcpTool.inputSchema.required).toEqual(['arg1'])
    })

    it('should handle tools with no parameters', async () => {
      const { graphThingToMcpTool } = await import('../mcp-tool-discovery')

      const graphThing: GraphThing = {
        id: 'tool-no-params',
        typeId: 100,
        typeName: 'Tool',
        data: {
          name: 'noParams',
          description: 'Tool without parameters',
          parameters: [],
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      }

      const mcpTool = graphThingToMcpTool(graphThing)

      expect(mcpTool.inputSchema.properties).toEqual({})
      expect(mcpTool.inputSchema.required).toBeUndefined()
    })

    it('should include annotations from tool data', async () => {
      const { graphThingToMcpTool } = await import('../mcp-tool-discovery')

      const graphThing: GraphThing = {
        id: 'tool-annotations',
        typeId: 100,
        typeName: 'Tool',
        data: {
          name: 'annotatedTool',
          description: 'Tool with annotations',
          category: 'test',
          version: '2.0.0',
          destructive: true,
          parameters: [],
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      }

      const mcpTool = graphThingToMcpTool(graphThing)

      expect(mcpTool.annotations).toBeDefined()
      expect(mcpTool.annotations!.category).toBe('test')
      expect(mcpTool.annotations!.version).toBe('2.0.0')
      expect(mcpTool.annotations!.destructive).toBe(true)
    })
  })

  // ==========================================================================
  // TESTS: Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it('should handle graph store errors gracefully', async () => {
      const errorStore: GraphStore = {
        async createThing() { throw new Error('DB error') },
        async getThing() { throw new Error('DB error') },
        async getThingsByType() { throw new Error('DB error') },
        async updateThing() { throw new Error('DB error') },
        async deleteThing() { throw new Error('DB error') },
        async createRelationship() { throw new Error('DB error') },
        async queryRelationshipsFrom() { throw new Error('DB error') },
        async queryRelationshipsTo() { throw new Error('DB error') },
        async queryRelationshipsByVerb() { throw new Error('DB error') },
        async deleteRelationship() { throw new Error('DB error') },
      }

      const { createToolDiscoveryService } = await import('../mcp-tool-discovery')
      const service = createToolDiscoveryService(errorStore)

      // Should not throw, but return empty results
      const result = await service.discoverTools()
      expect(result.tools).toEqual([])
    })

    it('should handle malformed tool data gracefully', async () => {
      const graphStore = new MockGraphStore()

      // Create a thing with malformed tool data
      await graphStore.createThing({
        id: 'tool-malformed',
        typeId: 100,
        typeName: 'Tool',
        data: {
          // Missing required fields
          notAName: 'broken',
        },
      })

      const { createToolDiscoveryService } = await import('../mcp-tool-discovery')
      const service = createToolDiscoveryService(graphStore)

      // Should skip malformed tools without throwing
      const result = await service.discoverTools()
      expect(result.tools.some((t) => t.name === 'broken')).toBe(false)
    })

    it('should handle null/undefined data fields gracefully', async () => {
      const graphStore = new MockGraphStore()

      await graphStore.createThing({
        id: 'tool-null-data',
        typeId: 100,
        typeName: 'Tool',
        data: null as unknown as Record<string, unknown>,
      })

      const { createToolDiscoveryService } = await import('../mcp-tool-discovery')
      const service = createToolDiscoveryService(graphStore)

      // Should not throw
      const result = await service.discoverTools()
      expect(Array.isArray(result.tools)).toBe(true)
    })
  })

  // ==========================================================================
  // TESTS: Tool Versioning
  // ==========================================================================

  describe('Tool Versioning', () => {
    let graphStore: MockGraphStore

    beforeEach(async () => {
      graphStore = new MockGraphStore()

      // Create multiple versions of the same tool
      await graphStore.createThing({
        id: 'tool-search-v1',
        typeId: 100,
        typeName: 'Tool',
        data: {
          name: 'search',
          description: 'Search v1',
          version: '1.0.0',
          parameters: [{ name: 'query', type: 'string', required: true }],
        },
      })

      await graphStore.createThing({
        id: 'tool-search-v2',
        typeId: 100,
        typeName: 'Tool',
        data: {
          name: 'search',
          description: 'Search v2 with improved performance',
          version: '2.0.0',
          parameters: [
            { name: 'query', type: 'string', required: true },
            { name: 'filters', type: 'object', required: false },
          ],
        },
      })
    })

    it('should support getting specific version of a tool', async () => {
      const { createToolDiscoveryService } = await import('../mcp-tool-discovery')
      const service = createToolDiscoveryService(graphStore)

      // This tests a potential getToolSchemaByVersion function
      const { getToolSchemaByVersion } = await import('../mcp-tool-discovery')

      const v1 = await getToolSchemaByVersion(graphStore, 'search', '1.0.0')
      const v2 = await getToolSchemaByVersion(graphStore, 'search', '2.0.0')

      expect(v1!.description).toBe('Search v1')
      expect(v2!.description).toBe('Search v2 with improved performance')
    })

    it('should return latest version by default', async () => {
      const { createToolDiscoveryService } = await import('../mcp-tool-discovery')
      const service = createToolDiscoveryService(graphStore)

      // By default, should return the latest version
      const schema = await service.getToolSchema('search')

      expect(schema!.annotations?.version).toBe('2.0.0')
    })

    it('should list all versions of a tool', async () => {
      const { listToolVersions } = await import('../mcp-tool-discovery')

      const versions = await listToolVersions(graphStore, 'search')

      expect(versions).toContain('1.0.0')
      expect(versions).toContain('2.0.0')
      expect(versions.length).toBe(2)
    })
  })

  // ==========================================================================
  // TESTS: Capability Negotiation
  // ==========================================================================

  describe('Capability Negotiation', () => {
    let graphStore: MockGraphStore

    beforeEach(async () => {
      graphStore = new MockGraphStore()

      await graphStore.createThing({
        id: 'tool-feature-a',
        typeId: 100,
        typeName: 'Tool',
        data: {
          name: 'featureTool',
          description: 'Tool requiring feature A',
          requiredCapabilities: ['featureA'],
          parameters: [],
        },
      })

      await graphStore.createThing({
        id: 'tool-feature-ab',
        typeId: 100,
        typeName: 'Tool',
        data: {
          name: 'advancedTool',
          description: 'Tool requiring features A and B',
          requiredCapabilities: ['featureA', 'featureB'],
          parameters: [],
        },
      })

      await graphStore.createThing({
        id: 'tool-no-requirements',
        typeId: 100,
        typeName: 'Tool',
        data: {
          name: 'basicTool',
          description: 'Tool with no capability requirements',
          parameters: [],
        },
      })
    })

    it('should filter tools by client capabilities', async () => {
      const { createToolDiscoveryService } = await import('../mcp-tool-discovery')
      const service = createToolDiscoveryService(graphStore)

      // Client only has featureA
      const { filterByCapabilities } = await import('../mcp-tool-discovery')

      const result = await service.discoverTools()
      const filtered = await filterByCapabilities(result.tools, ['featureA'])

      expect(filtered.some((t) => t.name === 'featureTool')).toBe(true)
      expect(filtered.some((t) => t.name === 'basicTool')).toBe(true)
      expect(filtered.some((t) => t.name === 'advancedTool')).toBe(false)
    })

    it('should return all tools when client has all capabilities', async () => {
      const { createToolDiscoveryService } = await import('../mcp-tool-discovery')
      const service = createToolDiscoveryService(graphStore)

      const { filterByCapabilities } = await import('../mcp-tool-discovery')

      const result = await service.discoverTools()
      const filtered = await filterByCapabilities(result.tools, ['featureA', 'featureB'])

      expect(filtered.length).toBe(3)
    })

    it('should return only basic tools when client has no capabilities', async () => {
      const { createToolDiscoveryService } = await import('../mcp-tool-discovery')
      const service = createToolDiscoveryService(graphStore)

      const { filterByCapabilities } = await import('../mcp-tool-discovery')

      const result = await service.discoverTools()
      const filtered = await filterByCapabilities(result.tools, [])

      expect(filtered.length).toBe(1)
      expect(filtered[0]!.name).toBe('basicTool')
    })
  })
})
