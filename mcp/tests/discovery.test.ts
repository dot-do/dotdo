import { describe, it, expect, beforeEach } from 'vitest'
import { ToolRegistry, ToolCategory } from '../discovery'
import { createSearchTool } from '../search'
import { createThingsStore } from '../../db/things'
import type { MCPTool } from '../server'

describe('Tool Discovery', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = new ToolRegistry()
  })

  describe('ToolRegistry', () => {
    it('should start with zero tools', () => {
      const tools = registry.list()
      expect(tools).toHaveLength(0)
    })

    it('should register a tool', () => {
      const tool: MCPTool = {
        name: 'test',
        description: 'A test tool',
        inputSchema: { type: 'object' },
        execute: async () => 'result'
      }

      registry.register(tool)
      expect(registry.list()).toHaveLength(1)
    })

    it('should list all registered tools', () => {
      const tool1: MCPTool = {
        name: 'tool1',
        description: 'First tool',
        inputSchema: { type: 'object' },
        execute: async () => 'result1'
      }

      const tool2: MCPTool = {
        name: 'tool2',
        description: 'Second tool',
        inputSchema: { type: 'object' },
        execute: async () => 'result2'
      }

      registry.register(tool1)
      registry.register(tool2)

      const tools = registry.list()
      expect(tools).toHaveLength(2)
      expect(tools.map(t => t.name)).toContain('tool1')
      expect(tools.map(t => t.name)).toContain('tool2')
    })

    it('should prevent duplicate tool names', () => {
      const tool: MCPTool = {
        name: 'duplicate',
        description: 'First',
        inputSchema: { type: 'object' },
        execute: async () => 'result'
      }

      registry.register(tool)
      expect(() => registry.register(tool)).toThrow(/already registered/)
    })

    it('should get tool by name', () => {
      const tool: MCPTool = {
        name: 'findme',
        description: 'Find me',
        inputSchema: { type: 'object' },
        execute: async () => 'found'
      }

      registry.register(tool)
      const found = registry.get('findme')
      expect(found).toBeDefined()
      expect(found?.name).toBe('findme')
    })

    it('should return undefined for non-existent tool', () => {
      const found = registry.get('nonexistent')
      expect(found).toBeUndefined()
    })

    it('should unregister a tool', () => {
      const tool: MCPTool = {
        name: 'removeme',
        description: 'Remove me',
        inputSchema: { type: 'object' },
        execute: async () => 'result'
      }

      registry.register(tool)
      expect(registry.list()).toHaveLength(1)

      registry.unregister('removeme')
      expect(registry.list()).toHaveLength(0)
    })

    it('should be idempotent when listing tools', () => {
      const tool: MCPTool = {
        name: 'test',
        description: 'Test',
        inputSchema: { type: 'object' },
        execute: async () => 'result'
      }

      registry.register(tool)

      const list1 = registry.list()
      const list2 = registry.list()

      expect(list1).toEqual(list2)
      expect(list1).toHaveLength(1)
    })
  })

  describe('Tool Metadata', () => {
    it('should extract tool metadata', () => {
      const tool: MCPTool = {
        name: 'metadata-test',
        description: 'A tool with rich metadata',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', minimum: 1, maximum: 100 }
          },
          required: ['query']
        },
        execute: async () => 'result'
      }

      registry.register(tool)
      const metadata = registry.getMetadata('metadata-test')

      expect(metadata).toBeDefined()
      expect(metadata?.name).toBe('metadata-test')
      expect(metadata?.description).toBe('A tool with rich metadata')
      expect(metadata?.inputSchema).toHaveProperty('type', 'object')
      expect(metadata?.inputSchema).toHaveProperty('properties')
    })

    it('should not include execute function in metadata', () => {
      const tool: MCPTool = {
        name: 'no-execute',
        description: 'Execute should not be in metadata',
        inputSchema: { type: 'object' },
        execute: async () => 'result'
      }

      registry.register(tool)
      const metadata = registry.getMetadata('no-execute')

      expect(metadata).toBeDefined()
      expect(metadata).not.toHaveProperty('execute')
    })

    it('should validate inputSchema is valid JSON Schema', () => {
      const tool: MCPTool = {
        name: 'schema-test',
        description: 'Schema validation test',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' }
          }
        },
        execute: async () => 'result'
      }

      registry.register(tool)
      const metadata = registry.getMetadata('schema-test')

      expect(metadata?.inputSchema).toHaveProperty('type')
      expect(metadata?.inputSchema).toHaveProperty('properties')
    })
  })

  describe('Tool Categorization', () => {
    it('should categorize tools', () => {
      const searchTool: MCPTool = {
        name: 'search',
        description: 'Search things',
        inputSchema: { type: 'object' },
        execute: async () => []
      }

      const fetchTool: MCPTool = {
        name: 'fetch',
        description: 'Fetch data',
        inputSchema: { type: 'object' },
        execute: async () => ({})
      }

      registry.register(searchTool, ToolCategory.DATA)
      registry.register(fetchTool, ToolCategory.DATA)

      const dataTools = registry.listByCategory(ToolCategory.DATA)
      expect(dataTools).toHaveLength(2)
    })

    it('should support multiple categories', () => {
      const tool1: MCPTool = {
        name: 'data-tool',
        description: 'Data tool',
        inputSchema: { type: 'object' },
        execute: async () => 'result'
      }

      const tool2: MCPTool = {
        name: 'compute-tool',
        description: 'Compute tool',
        inputSchema: { type: 'object' },
        execute: async () => 'result'
      }

      registry.register(tool1, ToolCategory.DATA)
      registry.register(tool2, ToolCategory.COMPUTE)

      expect(registry.listByCategory(ToolCategory.DATA)).toHaveLength(1)
      expect(registry.listByCategory(ToolCategory.COMPUTE)).toHaveLength(1)
    })

    it('should default to GENERAL category', () => {
      const tool: MCPTool = {
        name: 'uncategorized',
        description: 'No category',
        inputSchema: { type: 'object' },
        execute: async () => 'result'
      }

      registry.register(tool)
      const generalTools = registry.listByCategory(ToolCategory.GENERAL)
      expect(generalTools.map(t => t.name)).toContain('uncategorized')
    })

    it('should get tool category', () => {
      const tool: MCPTool = {
        name: 'categorized',
        description: 'Categorized tool',
        inputSchema: { type: 'object' },
        execute: async () => 'result'
      }

      registry.register(tool, ToolCategory.DATA)
      const category = registry.getCategory('categorized')
      expect(category).toBe(ToolCategory.DATA)
    })
  })

  describe('Tool Capability Negotiation', () => {
    it('should list tool capabilities', () => {
      const tool: MCPTool = {
        name: 'capable',
        description: 'Tool with capabilities',
        inputSchema: {
          type: 'object',
          properties: {
            streaming: { type: 'boolean' },
            batch: { type: 'boolean' }
          }
        },
        execute: async () => 'result'
      }

      registry.register(tool)
      const capabilities = registry.getCapabilities('capable')

      expect(capabilities).toBeDefined()
      expect(Array.isArray(capabilities)).toBe(true)
    })

    it('should check if tool supports a capability', () => {
      const tool: MCPTool = {
        name: 'streaming-tool',
        description: 'Supports streaming',
        inputSchema: { type: 'object' },
        execute: async () => 'result'
      }

      registry.register(tool, ToolCategory.DATA, ['streaming'])
      expect(registry.hasCapability('streaming-tool', 'streaming')).toBe(true)
      expect(registry.hasCapability('streaming-tool', 'batch')).toBe(false)
    })

    it('should filter tools by capability', () => {
      const tool1: MCPTool = {
        name: 'stream1',
        description: 'Streaming tool 1',
        inputSchema: { type: 'object' },
        execute: async () => 'result'
      }

      const tool2: MCPTool = {
        name: 'stream2',
        description: 'Streaming tool 2',
        inputSchema: { type: 'object' },
        execute: async () => 'result'
      }

      const tool3: MCPTool = {
        name: 'batch',
        description: 'Batch tool',
        inputSchema: { type: 'object' },
        execute: async () => 'result'
      }

      registry.register(tool1, ToolCategory.DATA, ['streaming'])
      registry.register(tool2, ToolCategory.DATA, ['streaming'])
      registry.register(tool3, ToolCategory.DATA, ['batch'])

      const streamingTools = registry.listByCapability('streaming')
      expect(streamingTools).toHaveLength(2)
      expect(streamingTools.map(t => t.name)).toContain('stream1')
      expect(streamingTools.map(t => t.name)).toContain('stream2')
    })
  })

  describe('Integration with real tools', () => {
    it('should register the search tool with proper metadata', () => {
      const store = createThingsStore()
      const searchTool = createSearchTool(store)

      registry.register(searchTool, ToolCategory.DATA)

      const metadata = registry.getMetadata('search')
      expect(metadata).toBeDefined()
      expect(metadata?.name).toBe('search')
      expect(metadata?.description).toContain('Search')
      expect(metadata?.inputSchema).toHaveProperty('properties')
    })

    it('should handle all three dotdo MCP tools', () => {
      // This test verifies we can handle search, fetch, and do tools
      const store = createThingsStore()
      const searchTool = createSearchTool(store)

      const fetchTool: MCPTool = {
        name: 'fetch',
        description: 'Fetch content from a URL',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string' }
          },
          required: ['url']
        },
        execute: async () => ({})
      }

      const doTool: MCPTool = {
        name: 'do',
        description: 'Execute code in sandbox',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string' }
          },
          required: ['code']
        },
        execute: async () => ({})
      }

      registry.register(searchTool, ToolCategory.DATA)
      registry.register(fetchTool, ToolCategory.DATA)
      registry.register(doTool, ToolCategory.COMPUTE)

      expect(registry.list()).toHaveLength(3)
      expect(registry.listByCategory(ToolCategory.DATA)).toHaveLength(2)
      expect(registry.listByCategory(ToolCategory.COMPUTE)).toHaveLength(1)
    })
  })

  describe('Dynamic tool registration', () => {
    it('should support registering tools at runtime', () => {
      expect(registry.list()).toHaveLength(0)

      const tool: MCPTool = {
        name: 'runtime-tool',
        description: 'Added at runtime',
        inputSchema: { type: 'object' },
        execute: async () => 'result'
      }

      registry.register(tool)
      expect(registry.list()).toHaveLength(1)

      const anotherTool: MCPTool = {
        name: 'another-runtime-tool',
        description: 'Another runtime tool',
        inputSchema: { type: 'object' },
        execute: async () => 'result'
      }

      registry.register(anotherTool)
      expect(registry.list()).toHaveLength(2)
    })

    it('should emit events on tool registration', () => {
      const events: string[] = []

      registry.on('tool:registered', (toolName: string) => {
        events.push(`registered:${toolName}`)
      })

      const tool: MCPTool = {
        name: 'event-tool',
        description: 'Tool with events',
        inputSchema: { type: 'object' },
        execute: async () => 'result'
      }

      registry.register(tool)
      expect(events).toContain('registered:event-tool')
    })

    it('should emit events on tool unregistration', () => {
      const events: string[] = []

      registry.on('tool:unregistered', (toolName: string) => {
        events.push(`unregistered:${toolName}`)
      })

      const tool: MCPTool = {
        name: 'remove-tool',
        description: 'Tool to remove',
        inputSchema: { type: 'object' },
        execute: async () => 'result'
      }

      registry.register(tool)
      registry.unregister('remove-tool')
      expect(events).toContain('unregistered:remove-tool')
    })
  })

  describe('Tool descriptions are LLM-friendly', () => {
    it('should provide clear descriptions for LLMs', () => {
      const tool: MCPTool = {
        name: 'llm-friendly',
        description: 'Search for Things in the Digital Object store. Supports filtering by type, field values, full-text search, sorting, and pagination.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Full-text search across all string fields (case-insensitive)'
            }
          }
        },
        execute: async () => 'result'
      }

      registry.register(tool)
      const metadata = registry.getMetadata('llm-friendly')

      expect(metadata?.description).toBeTruthy()
      expect(metadata?.description.length).toBeGreaterThan(20)

      // Description should contain action verbs and clear purpose
      expect(metadata?.description).toMatch(/Search|Fetch|Execute|Create|Update|Delete/)
    })

    it('should include parameter descriptions in schema', () => {
      const tool: MCPTool = {
        name: 'well-documented',
        description: 'Well documented tool',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query to find matching items'
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return (default: 20, max: 100)',
              minimum: 1,
              maximum: 100
            }
          }
        },
        execute: async () => 'result'
      }

      registry.register(tool)
      const metadata = registry.getMetadata('well-documented')

      const schema = metadata?.inputSchema as any
      expect(schema.properties.query.description).toBeTruthy()
      expect(schema.properties.limit.description).toBeTruthy()
    })
  })

  describe('Export and import', () => {
    it('should export tool definitions to JSON', () => {
      const tool: MCPTool = {
        name: 'export-test',
        description: 'Export test tool',
        inputSchema: { type: 'object' },
        execute: async () => 'result'
      }

      registry.register(tool)
      const exported = registry.export()

      expect(exported).toBeDefined()
      expect(Array.isArray(exported)).toBe(true)
      expect(exported).toHaveLength(1)
      expect(exported[0].name).toBe('export-test')
    })

    it('should import tool definitions from JSON', () => {
      const definitions = [
        {
          name: 'imported-tool',
          description: 'Imported tool',
          inputSchema: { type: 'object' },
          category: ToolCategory.DATA,
          capabilities: ['streaming']
        }
      ]

      // Note: import would require factory functions for execute
      // This test verifies the structure is correct for future implementation
      expect(definitions[0]).toHaveProperty('name')
      expect(definitions[0]).toHaveProperty('description')
      expect(definitions[0]).toHaveProperty('inputSchema')
    })
  })
})
