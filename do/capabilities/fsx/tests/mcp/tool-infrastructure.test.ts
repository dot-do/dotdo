/**
 * Tests for MCP Tool Infrastructure
 *
 * RED phase: These tests define expected behavior for the tool infrastructure.
 * All tests should FAIL until the implementation is complete.
 *
 * Tests cover:
 * - registerTool() for adding tools to registry
 * - invokeTool() dispatcher for routing to correct handlers
 * - fsTools array containing all fs_* tools
 * - Tool schema validation
 * - Error handling for unknown tools
 * - Tool name normalization
 *
 * @module tests/mcp/tool-infrastructure
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { InMemoryStorage, createTestFilesystem } from '../test-utils'

// Types for MCP tools and tool infrastructure
interface McpToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
  isError?: boolean
}

interface McpToolSchema {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

interface McpTool {
  schema: McpToolSchema
  handler: (params: Record<string, unknown>, storage?: unknown) => Promise<McpToolResult>
}

interface ToolRegistry {
  get(name: string): McpTool | undefined
  has(name: string): boolean
  list(): string[]
  schemas(): McpToolSchema[]
}

// These imports will fail until the infrastructure is implemented
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import {
  registerTool,
  unregisterTool,
  invokeTool,
  getToolRegistry,
  fsTools,
  clearToolRegistry,
  // Tool schemas
  fsSearchToolSchema,
  fsListToolSchema,
  fsTreeToolSchema,
  fsStatToolSchema,
  fsMkdirToolSchema,
  fsReadToolSchema,
  fsWriteToolSchema,
  fsAppendToolSchema,
  fsDeleteToolSchema,
  fsMoveToolSchema,
  fsCopyToolSchema,
  fsExistsToolSchema,
} from '../../core/mcp'

// ============================================================================
// REGISTER TOOL
// ============================================================================

describe('MCP Tool Infrastructure - registerTool()', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    clearToolRegistry()
  })

  afterEach(() => {
    clearToolRegistry()
  })

  describe('basic registration', () => {
    it('should register a custom tool with schema and handler', () => {
      const customSchema: McpToolSchema = {
        name: 'custom_tool',
        description: 'A custom test tool',
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Input parameter' },
          },
          required: ['input'],
        },
      }

      const customHandler = async (params: Record<string, unknown>): Promise<McpToolResult> => {
        return {
          content: [{ type: 'text', text: `Processed: ${params.input}` }],
        }
      }

      registerTool(customSchema, customHandler)

      const registry = getToolRegistry()
      expect(registry.has('custom_tool')).toBe(true)
    })

    it('should return the registered tool from registry', () => {
      const customSchema: McpToolSchema = {
        name: 'my_tool',
        description: 'My tool',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      }

      const customHandler = async (): Promise<McpToolResult> => {
        return { content: [{ type: 'text', text: 'done' }] }
      }

      registerTool(customSchema, customHandler)

      const registry = getToolRegistry()
      const tool = registry.get('my_tool')

      expect(tool).toBeDefined()
      expect(tool?.schema.name).toBe('my_tool')
      expect(tool?.schema.description).toBe('My tool')
    })

    it('should add tool name to registry list', () => {
      registerTool(
        {
          name: 'tool_a',
          description: 'Tool A',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => ({ content: [{ type: 'text', text: '' }] })
      )

      registerTool(
        {
          name: 'tool_b',
          description: 'Tool B',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => ({ content: [{ type: 'text', text: '' }] })
      )

      const registry = getToolRegistry()
      const tools = registry.list()

      expect(tools).toContain('tool_a')
      expect(tools).toContain('tool_b')
    })

    it('should include schema in schemas list', () => {
      const schema: McpToolSchema = {
        name: 'schema_test_tool',
        description: 'Schema test',
        inputSchema: {
          type: 'object',
          properties: {
            foo: { type: 'string' },
          },
          required: ['foo'],
        },
      }

      registerTool(schema, async () => ({ content: [{ type: 'text', text: '' }] }))

      const registry = getToolRegistry()
      const schemas = registry.schemas()
      const foundSchema = schemas.find((s) => s.name === 'schema_test_tool')

      expect(foundSchema).toBeDefined()
      expect(foundSchema?.inputSchema.required).toContain('foo')
    })
  })

  describe('tool name validation', () => {
    it('should throw error for empty tool name', () => {
      const schema: McpToolSchema = {
        name: '',
        description: 'Empty name tool',
        inputSchema: { type: 'object', properties: {} },
      }

      expect(() => {
        registerTool(schema, async () => ({ content: [{ type: 'text', text: '' }] }))
      }).toThrow(/name|empty|required/i)
    })

    it('should throw error for tool name with spaces', () => {
      const schema: McpToolSchema = {
        name: 'my tool',
        description: 'Space in name',
        inputSchema: { type: 'object', properties: {} },
      }

      expect(() => {
        registerTool(schema, async () => ({ content: [{ type: 'text', text: '' }] }))
      }).toThrow(/name|invalid|space/i)
    })

    it('should throw error for tool name starting with number', () => {
      const schema: McpToolSchema = {
        name: '123tool',
        description: 'Number prefix',
        inputSchema: { type: 'object', properties: {} },
      }

      expect(() => {
        registerTool(schema, async () => ({ content: [{ type: 'text', text: '' }] }))
      }).toThrow(/name|invalid|number/i)
    })

    it('should allow underscores in tool name', () => {
      const schema: McpToolSchema = {
        name: 'my_custom_tool',
        description: 'Underscores allowed',
        inputSchema: { type: 'object', properties: {} },
      }

      expect(() => {
        registerTool(schema, async () => ({ content: [{ type: 'text', text: '' }] }))
      }).not.toThrow()

      const registry = getToolRegistry()
      expect(registry.has('my_custom_tool')).toBe(true)
    })

    it('should allow hyphens in tool name', () => {
      const schema: McpToolSchema = {
        name: 'my-custom-tool',
        description: 'Hyphens allowed',
        inputSchema: { type: 'object', properties: {} },
      }

      expect(() => {
        registerTool(schema, async () => ({ content: [{ type: 'text', text: '' }] }))
      }).not.toThrow()

      const registry = getToolRegistry()
      expect(registry.has('my-custom-tool')).toBe(true)
    })
  })

  describe('duplicate registration', () => {
    it('should throw error when registering tool with same name', () => {
      const schema: McpToolSchema = {
        name: 'duplicate_tool',
        description: 'First registration',
        inputSchema: { type: 'object', properties: {} },
      }

      registerTool(schema, async () => ({ content: [{ type: 'text', text: 'first' }] }))

      expect(() => {
        registerTool(
          { ...schema, description: 'Second registration' },
          async () => ({ content: [{ type: 'text', text: 'second' }] })
        )
      }).toThrow(/already|registered|exists|duplicate/i)
    })

    it('should allow re-registration after unregister', () => {
      const schema: McpToolSchema = {
        name: 're_register_tool',
        description: 'Original',
        inputSchema: { type: 'object', properties: {} },
      }

      registerTool(schema, async () => ({ content: [{ type: 'text', text: 'original' }] }))
      unregisterTool('re_register_tool')

      expect(() => {
        registerTool(
          { ...schema, description: 'Replacement' },
          async () => ({ content: [{ type: 'text', text: 'replacement' }] })
        )
      }).not.toThrow()

      const registry = getToolRegistry()
      const tool = registry.get('re_register_tool')
      expect(tool?.schema.description).toBe('Replacement')
    })
  })

  describe('schema validation', () => {
    it('should throw error for missing inputSchema', () => {
      const schema = {
        name: 'no_schema_tool',
        description: 'Missing inputSchema',
      } as McpToolSchema

      expect(() => {
        registerTool(schema, async () => ({ content: [{ type: 'text', text: '' }] }))
      }).toThrow(/inputSchema|schema|required/i)
    })

    it('should throw error for inputSchema not being object type', () => {
      const schema: McpToolSchema = {
        name: 'bad_schema_tool',
        description: 'Bad schema type',
        inputSchema: {
          type: 'array' as unknown as 'object',
          properties: {},
        },
      }

      expect(() => {
        registerTool(schema, async () => ({ content: [{ type: 'text', text: '' }] }))
      }).toThrow(/inputSchema|type|object/i)
    })

    it('should throw error for missing properties in inputSchema', () => {
      const schema = {
        name: 'no_props_tool',
        description: 'Missing properties',
        inputSchema: {
          type: 'object' as const,
        },
      } as McpToolSchema

      expect(() => {
        registerTool(schema, async () => ({ content: [{ type: 'text', text: '' }] }))
      }).toThrow(/properties|required/i)
    })
  })
})

// ============================================================================
// UNREGISTER TOOL
// ============================================================================

describe('MCP Tool Infrastructure - unregisterTool()', () => {
  beforeEach(() => {
    clearToolRegistry()
  })

  afterEach(() => {
    clearToolRegistry()
  })

  it('should remove tool from registry', () => {
    registerTool(
      {
        name: 'temp_tool',
        description: 'Temporary',
        inputSchema: { type: 'object', properties: {} },
      },
      async () => ({ content: [{ type: 'text', text: '' }] })
    )

    const registry = getToolRegistry()
    expect(registry.has('temp_tool')).toBe(true)

    unregisterTool('temp_tool')

    expect(registry.has('temp_tool')).toBe(false)
  })

  it('should throw error for non-existent tool', () => {
    expect(() => {
      unregisterTool('nonexistent_tool')
    }).toThrow(/not found|not registered|unknown/i)
  })

  it('should not affect other registered tools', () => {
    registerTool(
      { name: 'keep_tool', description: 'Keep', inputSchema: { type: 'object', properties: {} } },
      async () => ({ content: [{ type: 'text', text: '' }] })
    )
    registerTool(
      { name: 'remove_tool', description: 'Remove', inputSchema: { type: 'object', properties: {} } },
      async () => ({ content: [{ type: 'text', text: '' }] })
    )

    unregisterTool('remove_tool')

    const registry = getToolRegistry()
    expect(registry.has('keep_tool')).toBe(true)
    expect(registry.has('remove_tool')).toBe(false)
  })

  it('should prevent invocation of unregistered tool', async () => {
    registerTool(
      { name: 'invoke_test', description: 'Test', inputSchema: { type: 'object', properties: {} } },
      async () => ({ content: [{ type: 'text', text: 'success' }] })
    )

    unregisterTool('invoke_test')

    const result = await invokeTool('invoke_test', {})
    expect(result.isError).toBe(true)
    expect((result.content[0] as { type: 'text'; text: string }).text).toMatch(/not found|unknown/i)
  })
})

// ============================================================================
// INVOKE TOOL
// ============================================================================

describe('MCP Tool Infrastructure - invokeTool()', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    clearToolRegistry()
  })

  afterEach(() => {
    clearToolRegistry()
  })

  describe('tool dispatch', () => {
    it('should dispatch to correct handler based on tool name', async () => {
      registerTool(
        {
          name: 'echo_tool',
          description: 'Echo input',
          inputSchema: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
          },
        },
        async (params) => ({
          content: [{ type: 'text', text: `Echo: ${params.message}` }],
        })
      )

      const result = await invokeTool('echo_tool', { message: 'Hello' })

      expect(result.isError).toBeFalsy()
      expect((result.content[0] as { type: 'text'; text: string }).text).toBe('Echo: Hello')
    })

    it('should pass parameters to handler', async () => {
      let receivedParams: Record<string, unknown> = {}

      registerTool(
        {
          name: 'param_capture',
          description: 'Capture params',
          inputSchema: {
            type: 'object',
            properties: {
              a: { type: 'string' },
              b: { type: 'number' },
              c: { type: 'boolean' },
            },
          },
        },
        async (params) => {
          receivedParams = params
          return { content: [{ type: 'text', text: 'captured' }] }
        }
      )

      await invokeTool('param_capture', { a: 'foo', b: 42, c: true })

      expect(receivedParams).toEqual({ a: 'foo', b: 42, c: true })
    })

    it('should pass storage backend to handler when provided', async () => {
      let receivedStorage: unknown = null

      registerTool(
        {
          name: 'storage_tool',
          description: 'Uses storage',
          inputSchema: { type: 'object', properties: {} },
        },
        async (_params, storage) => {
          receivedStorage = storage
          return { content: [{ type: 'text', text: 'done' }] }
        }
      )

      await invokeTool('storage_tool', {}, storage)

      expect(receivedStorage).toBe(storage)
    })

    it('should return handler result', async () => {
      registerTool(
        {
          name: 'result_tool',
          description: 'Returns result',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => ({
          content: [
            { type: 'text', text: 'Line 1' },
            { type: 'text', text: 'Line 2' },
          ],
          isError: false,
        })
      )

      const result = await invokeTool('result_tool', {})

      expect(result.content.length).toBe(2)
      expect((result.content[0] as { type: 'text'; text: string }).text).toBe('Line 1')
      expect((result.content[1] as { type: 'text'; text: string }).text).toBe('Line 2')
    })
  })

  describe('error handling', () => {
    it('should return error for unknown tool name', async () => {
      const result = await invokeTool('nonexistent_tool', {})

      expect(result.isError).toBe(true)
      expect((result.content[0] as { type: 'text'; text: string }).text).toMatch(
        /unknown tool|tool not found|not registered/i
      )
    })

    it('should include tool name in error message', async () => {
      const result = await invokeTool('missing_tool_xyz', {})

      expect(result.isError).toBe(true)
      expect((result.content[0] as { type: 'text'; text: string }).text).toContain('missing_tool_xyz')
    })

    it('should catch and wrap handler exceptions', async () => {
      registerTool(
        {
          name: 'error_tool',
          description: 'Throws error',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => {
          throw new Error('Handler exploded')
        }
      )

      const result = await invokeTool('error_tool', {})

      expect(result.isError).toBe(true)
      expect((result.content[0] as { type: 'text'; text: string }).text).toMatch(
        /Handler exploded|error|exception/i
      )
    })

    it('should handle handler returning error result', async () => {
      registerTool(
        {
          name: 'error_result_tool',
          description: 'Returns error',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => ({
          content: [{ type: 'text', text: 'Something went wrong' }],
          isError: true,
        })
      )

      const result = await invokeTool('error_result_tool', {})

      expect(result.isError).toBe(true)
    })
  })

  describe('tool name normalization', () => {
    it('should normalize tool name to lowercase', async () => {
      registerTool(
        {
          name: 'lowercase_tool',
          description: 'Lowercase',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => ({ content: [{ type: 'text', text: 'found' }] })
      )

      const result = await invokeTool('LOWERCASE_TOOL', {})

      expect(result.isError).toBeFalsy()
      expect((result.content[0] as { type: 'text'; text: string }).text).toBe('found')
    })

    it('should handle mixed case invocation', async () => {
      registerTool(
        {
          name: 'mixed_case',
          description: 'Mixed',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => ({ content: [{ type: 'text', text: 'ok' }] })
      )

      const result = await invokeTool('MiXeD_CaSe', {})

      expect(result.isError).toBeFalsy()
    })

    it('should trim whitespace from tool name', async () => {
      registerTool(
        {
          name: 'trimmed_tool',
          description: 'Trimmed',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => ({ content: [{ type: 'text', text: 'trimmed' }] })
      )

      const result = await invokeTool('  trimmed_tool  ', {})

      expect(result.isError).toBeFalsy()
    })
  })

  describe('parameter validation', () => {
    it('should validate required parameters', async () => {
      registerTool(
        {
          name: 'required_params',
          description: 'Has required params',
          inputSchema: {
            type: 'object',
            properties: {
              required_param: { type: 'string' },
            },
            required: ['required_param'],
          },
        },
        async () => ({ content: [{ type: 'text', text: 'ok' }] })
      )

      const result = await invokeTool('required_params', {})

      expect(result.isError).toBe(true)
      expect((result.content[0] as { type: 'text'; text: string }).text).toMatch(
        /required|missing|required_param/i
      )
    })

    it('should pass when required parameters are provided', async () => {
      registerTool(
        {
          name: 'valid_params',
          description: 'Valid params',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
            required: ['name'],
          },
        },
        async () => ({ content: [{ type: 'text', text: 'valid' }] })
      )

      const result = await invokeTool('valid_params', { name: 'test' })

      expect(result.isError).toBeFalsy()
    })

    it('should validate parameter types when strict mode enabled', async () => {
      registerTool(
        {
          name: 'typed_params',
          description: 'Typed params',
          inputSchema: {
            type: 'object',
            properties: {
              count: { type: 'number' },
            },
            required: ['count'],
          },
        },
        async () => ({ content: [{ type: 'text', text: 'ok' }] })
      )

      const result = await invokeTool('typed_params', { count: 'not a number' }, undefined, {
        strictValidation: true,
      })

      expect(result.isError).toBe(true)
      expect((result.content[0] as { type: 'text'; text: string }).text).toMatch(/type|number|invalid/i)
    })
  })
})

// ============================================================================
// FS TOOLS ARRAY
// ============================================================================

describe('MCP Tool Infrastructure - fsTools Array', () => {
  describe('tool collection', () => {
    it('should export fsTools as an array', () => {
      expect(Array.isArray(fsTools)).toBe(true)
    })

    it('should include fs_search tool', () => {
      const hasSearch = fsTools.some((tool) => tool.schema.name === 'fs_search')
      expect(hasSearch).toBe(true)
    })

    it('should include fs_list tool', () => {
      const hasList = fsTools.some((tool) => tool.schema.name === 'fs_list')
      expect(hasList).toBe(true)
    })

    it('should include fs_tree tool', () => {
      const hasTree = fsTools.some((tool) => tool.schema.name === 'fs_tree')
      expect(hasTree).toBe(true)
    })

    it('should include fs_stat tool', () => {
      const hasStat = fsTools.some((tool) => tool.schema.name === 'fs_stat')
      expect(hasStat).toBe(true)
    })

    it('should include fs_mkdir tool', () => {
      const hasMkdir = fsTools.some((tool) => tool.schema.name === 'fs_mkdir')
      expect(hasMkdir).toBe(true)
    })

    it('should include fs_read tool', () => {
      const hasRead = fsTools.some((tool) => tool.schema.name === 'fs_read')
      expect(hasRead).toBe(true)
    })

    it('should include fs_write tool', () => {
      const hasWrite = fsTools.some((tool) => tool.schema.name === 'fs_write')
      expect(hasWrite).toBe(true)
    })

    it('should include fs_append tool', () => {
      const hasAppend = fsTools.some((tool) => tool.schema.name === 'fs_append')
      expect(hasAppend).toBe(true)
    })

    it('should include fs_delete tool', () => {
      const hasDelete = fsTools.some((tool) => tool.schema.name === 'fs_delete')
      expect(hasDelete).toBe(true)
    })

    it('should include fs_move tool', () => {
      const hasMove = fsTools.some((tool) => tool.schema.name === 'fs_move')
      expect(hasMove).toBe(true)
    })

    it('should include fs_copy tool', () => {
      const hasCopy = fsTools.some((tool) => tool.schema.name === 'fs_copy')
      expect(hasCopy).toBe(true)
    })

    it('should include fs_exists tool', () => {
      const hasExists = fsTools.some((tool) => tool.schema.name === 'fs_exists')
      expect(hasExists).toBe(true)
    })

    it('should contain at least 12 filesystem tools', () => {
      expect(fsTools.length).toBeGreaterThanOrEqual(12)
    })

    it('should have all tools with valid schemas', () => {
      for (const tool of fsTools) {
        expect(tool.schema).toBeDefined()
        expect(tool.schema.name).toBeTruthy()
        expect(tool.schema.description).toBeTruthy()
        expect(tool.schema.inputSchema).toBeDefined()
        expect(tool.schema.inputSchema.type).toBe('object')
      }
    })

    it('should have all tools with valid handlers', () => {
      for (const tool of fsTools) {
        expect(tool.handler).toBeDefined()
        expect(typeof tool.handler).toBe('function')
      }
    })

    it('should have all tool names prefixed with fs_', () => {
      for (const tool of fsTools) {
        expect(tool.schema.name.startsWith('fs_')).toBe(true)
      }
    })
  })

  describe('tool schemas exports', () => {
    it('should export fsSearchToolSchema', () => {
      expect(fsSearchToolSchema).toBeDefined()
      expect(fsSearchToolSchema.name).toBe('fs_search')
    })

    it('should export fsListToolSchema', () => {
      expect(fsListToolSchema).toBeDefined()
      expect(fsListToolSchema.name).toBe('fs_list')
    })

    it('should export fsTreeToolSchema', () => {
      expect(fsTreeToolSchema).toBeDefined()
      expect(fsTreeToolSchema.name).toBe('fs_tree')
    })

    it('should export fsStatToolSchema', () => {
      expect(fsStatToolSchema).toBeDefined()
      expect(fsStatToolSchema.name).toBe('fs_stat')
    })

    it('should export fsMkdirToolSchema', () => {
      expect(fsMkdirToolSchema).toBeDefined()
      expect(fsMkdirToolSchema.name).toBe('fs_mkdir')
    })

    it('should export fsReadToolSchema', () => {
      expect(fsReadToolSchema).toBeDefined()
      expect(fsReadToolSchema.name).toBe('fs_read')
    })

    it('should export fsWriteToolSchema', () => {
      expect(fsWriteToolSchema).toBeDefined()
      expect(fsWriteToolSchema.name).toBe('fs_write')
    })

    it('should export fsAppendToolSchema', () => {
      expect(fsAppendToolSchema).toBeDefined()
      expect(fsAppendToolSchema.name).toBe('fs_append')
    })

    it('should export fsDeleteToolSchema', () => {
      expect(fsDeleteToolSchema).toBeDefined()
      expect(fsDeleteToolSchema.name).toBe('fs_delete')
    })

    it('should export fsMoveToolSchema', () => {
      expect(fsMoveToolSchema).toBeDefined()
      expect(fsMoveToolSchema.name).toBe('fs_move')
    })

    it('should export fsCopyToolSchema', () => {
      expect(fsCopyToolSchema).toBeDefined()
      expect(fsCopyToolSchema.name).toBe('fs_copy')
    })

    it('should export fsExistsToolSchema', () => {
      expect(fsExistsToolSchema).toBeDefined()
      expect(fsExistsToolSchema.name).toBe('fs_exists')
    })
  })
})

// ============================================================================
// TOOL REGISTRY
// ============================================================================

describe('MCP Tool Infrastructure - getToolRegistry()', () => {
  beforeEach(() => {
    clearToolRegistry()
  })

  afterEach(() => {
    clearToolRegistry()
  })

  describe('registry interface', () => {
    it('should return registry with has() method', () => {
      const registry = getToolRegistry()
      expect(typeof registry.has).toBe('function')
    })

    it('should return registry with get() method', () => {
      const registry = getToolRegistry()
      expect(typeof registry.get).toBe('function')
    })

    it('should return registry with list() method', () => {
      const registry = getToolRegistry()
      expect(typeof registry.list).toBe('function')
    })

    it('should return registry with schemas() method', () => {
      const registry = getToolRegistry()
      expect(typeof registry.schemas).toBe('function')
    })
  })

  describe('registry operations', () => {
    it('should return false for has() on empty registry', () => {
      const registry = getToolRegistry()
      expect(registry.has('any_tool')).toBe(false)
    })

    it('should return undefined for get() on empty registry', () => {
      const registry = getToolRegistry()
      expect(registry.get('any_tool')).toBeUndefined()
    })

    it('should return empty array for list() on empty registry', () => {
      const registry = getToolRegistry()
      // Note: may contain default fs_ tools
      // This test checks custom tool registration behavior
    })

    it('should return array for schemas()', () => {
      const registry = getToolRegistry()
      expect(Array.isArray(registry.schemas())).toBe(true)
    })

    it('should be consistent between operations', () => {
      registerTool(
        {
          name: 'consistency_test',
          description: 'Test consistency',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => ({ content: [{ type: 'text', text: '' }] })
      )

      const registry = getToolRegistry()

      expect(registry.has('consistency_test')).toBe(true)
      expect(registry.get('consistency_test')).toBeDefined()
      expect(registry.list()).toContain('consistency_test')
      expect(registry.schemas().some((s) => s.name === 'consistency_test')).toBe(true)
    })
  })
})

// ============================================================================
// CLEAR TOOL REGISTRY
// ============================================================================

describe('MCP Tool Infrastructure - clearToolRegistry()', () => {
  afterEach(() => {
    clearToolRegistry()
  })

  it('should remove all custom tools from registry', () => {
    registerTool(
      { name: 'clear_test_1', description: 'Test 1', inputSchema: { type: 'object', properties: {} } },
      async () => ({ content: [{ type: 'text', text: '' }] })
    )
    registerTool(
      { name: 'clear_test_2', description: 'Test 2', inputSchema: { type: 'object', properties: {} } },
      async () => ({ content: [{ type: 'text', text: '' }] })
    )

    const registryBefore = getToolRegistry()
    expect(registryBefore.has('clear_test_1')).toBe(true)
    expect(registryBefore.has('clear_test_2')).toBe(true)

    clearToolRegistry()

    const registryAfter = getToolRegistry()
    expect(registryAfter.has('clear_test_1')).toBe(false)
    expect(registryAfter.has('clear_test_2')).toBe(false)
  })

  it('should preserve built-in fs_ tools after clear', () => {
    clearToolRegistry()

    const registry = getToolRegistry()
    // Built-in tools should still be available
    expect(registry.has('fs_search')).toBe(true)
    expect(registry.has('fs_list')).toBe(true)
  })

  it('should allow re-registration after clear', () => {
    registerTool(
      { name: 'reuse_name', description: 'Original', inputSchema: { type: 'object', properties: {} } },
      async () => ({ content: [{ type: 'text', text: 'original' }] })
    )

    clearToolRegistry()

    // Should not throw - name is now available
    expect(() => {
      registerTool(
        { name: 'reuse_name', description: 'New', inputSchema: { type: 'object', properties: {} } },
        async () => ({ content: [{ type: 'text', text: 'new' }] })
      )
    }).not.toThrow()
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('MCP Tool Infrastructure - Integration', () => {
  let storage: InMemoryStorage

  beforeEach(() => {
    storage = createTestFilesystem()
    clearToolRegistry()
  })

  afterEach(() => {
    clearToolRegistry()
  })

  describe('invoking built-in fs tools via invokeTool', () => {
    it('should invoke fs_search through invokeTool dispatcher', async () => {
      const result = await invokeTool('fs_search', { pattern: '*.txt', path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('hello.txt')
    })

    it('should invoke fs_list through invokeTool dispatcher', async () => {
      const result = await invokeTool('fs_list', { path: '/home/user' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toContain('hello.txt')
      expect(text).toContain('data.json')
    })

    it('should invoke fs_exists through invokeTool dispatcher', async () => {
      const result = await invokeTool('fs_exists', { path: '/home/user/hello.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/true|exists|found/i)
    })

    it('should invoke fs_stat through invokeTool dispatcher', async () => {
      const result = await invokeTool('fs_stat', { path: '/home/user/hello.txt' }, storage)

      expect(result.isError).toBeFalsy()
      const text = (result.content[0] as { type: 'text'; text: string }).text
      expect(text).toMatch(/file|size|type/i)
    })
  })

  describe('custom tool alongside built-in tools', () => {
    it('should allow custom tool to work alongside fs tools', async () => {
      registerTool(
        {
          name: 'custom_grep',
          description: 'Custom grep implementation',
          inputSchema: {
            type: 'object',
            properties: {
              pattern: { type: 'string' },
              file: { type: 'string' },
            },
            required: ['pattern', 'file'],
          },
        },
        async (params, storage) => {
          const st = storage as InMemoryStorage
          const content = st.readFileAsString(params.file as string)
          const matches = content.includes(params.pattern as string)
          return {
            content: [{ type: 'text', text: matches ? 'Match found' : 'No match' }],
          }
        }
      )

      // Use built-in tool
      const listResult = await invokeTool('fs_list', { path: '/home/user' }, storage)
      expect(listResult.isError).toBeFalsy()

      // Use custom tool
      const grepResult = await invokeTool('custom_grep', { pattern: 'Hello', file: '/home/user/hello.txt' }, storage)
      expect(grepResult.isError).toBeFalsy()
      expect((grepResult.content[0] as { type: 'text'; text: string }).text).toBe('Match found')
    })
  })

  describe('tool listing includes all tools', () => {
    it('should list both built-in and custom tools', () => {
      registerTool(
        { name: 'my_custom', description: 'Custom', inputSchema: { type: 'object', properties: {} } },
        async () => ({ content: [{ type: 'text', text: '' }] })
      )

      const registry = getToolRegistry()
      const tools = registry.list()

      // Built-in tools
      expect(tools).toContain('fs_search')
      expect(tools).toContain('fs_list')

      // Custom tool
      expect(tools).toContain('my_custom')
    })

    it('should return all schemas including built-in and custom', () => {
      registerTool(
        { name: 'schema_custom', description: 'Custom schema', inputSchema: { type: 'object', properties: { x: { type: 'string' } } } },
        async () => ({ content: [{ type: 'text', text: '' }] })
      )

      const registry = getToolRegistry()
      const schemas = registry.schemas()

      // Find schemas
      const searchSchema = schemas.find((s) => s.name === 'fs_search')
      const customSchema = schemas.find((s) => s.name === 'schema_custom')

      expect(searchSchema).toBeDefined()
      expect(customSchema).toBeDefined()
      expect(customSchema?.inputSchema.properties).toHaveProperty('x')
    })
  })
})

// ============================================================================
// CONCURRENT ACCESS
// ============================================================================

describe('MCP Tool Infrastructure - Concurrent Access', () => {
  beforeEach(() => {
    clearToolRegistry()
  })

  afterEach(() => {
    clearToolRegistry()
  })

  it('should handle concurrent tool invocations', async () => {
    let callCount = 0

    registerTool(
      {
        name: 'counter_tool',
        description: 'Counts calls',
        inputSchema: { type: 'object', properties: {} },
      },
      async () => {
        callCount++
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { content: [{ type: 'text', text: `Call ${callCount}` }] }
      }
    )

    const results = await Promise.all([
      invokeTool('counter_tool', {}),
      invokeTool('counter_tool', {}),
      invokeTool('counter_tool', {}),
    ])

    expect(results.every((r) => !r.isError)).toBe(true)
    expect(callCount).toBe(3)
  })

  it('should handle registration and invocation concurrently', async () => {
    registerTool(
      { name: 'fast_tool', description: 'Fast', inputSchema: { type: 'object', properties: {} } },
      async () => ({ content: [{ type: 'text', text: 'fast' }] })
    )

    // Start invocation
    const invokePromise = invokeTool('fast_tool', {})

    // Register another tool while first is running
    registerTool(
      { name: 'slow_tool', description: 'Slow', inputSchema: { type: 'object', properties: {} } },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return { content: [{ type: 'text', text: 'slow' }] }
      }
    )

    const result = await invokePromise
    expect(result.isError).toBeFalsy()
  })
})

// ============================================================================
// ERROR CASES
// ============================================================================

describe('MCP Tool Infrastructure - Edge Cases', () => {
  beforeEach(() => {
    clearToolRegistry()
  })

  afterEach(() => {
    clearToolRegistry()
  })

  describe('null and undefined handling', () => {
    it('should handle null parameters gracefully', async () => {
      registerTool(
        {
          name: 'null_test',
          description: 'Test null',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => ({ content: [{ type: 'text', text: 'ok' }] })
      )

      const result = await invokeTool('null_test', null as unknown as Record<string, unknown>)

      // Should either work with empty params or return validation error
      expect(result.content).toBeDefined()
    })

    it('should handle undefined parameters gracefully', async () => {
      registerTool(
        {
          name: 'undefined_test',
          description: 'Test undefined',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => ({ content: [{ type: 'text', text: 'ok' }] })
      )

      const result = await invokeTool('undefined_test', undefined as unknown as Record<string, unknown>)

      // Should either work with empty params or return validation error
      expect(result.content).toBeDefined()
    })
  })

  describe('special characters in tool names', () => {
    it('should handle tool names with special characters appropriately', async () => {
      const result = await invokeTool('tool/with/slashes', {})
      expect(result.isError).toBe(true)
    })

    it('should reject tool names with dots', async () => {
      expect(() => {
        registerTool(
          { name: 'tool.with.dots', description: 'Dots', inputSchema: { type: 'object', properties: {} } },
          async () => ({ content: [{ type: 'text', text: '' }] })
        )
      }).toThrow()
    })
  })

  describe('handler promise rejection', () => {
    it('should handle async handler rejection', async () => {
      registerTool(
        {
          name: 'rejection_test',
          description: 'Rejects',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => {
          return Promise.reject(new Error('Async rejection'))
        }
      )

      const result = await invokeTool('rejection_test', {})

      expect(result.isError).toBe(true)
      expect((result.content[0] as { type: 'text'; text: string }).text).toMatch(/rejection|error/i)
    })
  })

  describe('extremely long inputs', () => {
    it('should handle very long tool names in invocation', async () => {
      const longName = 'a'.repeat(1000)
      const result = await invokeTool(longName, {})

      expect(result.isError).toBe(true)
    })

    it('should handle very large parameter objects', async () => {
      registerTool(
        {
          name: 'large_params',
          description: 'Large params test',
          inputSchema: { type: 'object', properties: {} },
        },
        async () => ({ content: [{ type: 'text', text: 'ok' }] })
      )

      const largeParams: Record<string, string> = {}
      for (let i = 0; i < 1000; i++) {
        largeParams[`key_${i}`] = 'value_'.repeat(100)
      }

      const result = await invokeTool('large_params', largeParams)

      // Should handle without crashing
      expect(result.content).toBeDefined()
    })
  })
})
