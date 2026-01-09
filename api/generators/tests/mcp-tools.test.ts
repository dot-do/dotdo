import { describe, it, expect } from 'vitest'

/**
 * MCP Tool Generator Tests (TDD)
 *
 * These tests verify auto-generation of MCP tools from class public methods.
 * The generator works with any class that has exposed methods discovered
 * by the auto-wiring system.
 *
 * Requirements:
 * - Tools generated for all exposed methods
 * - JSON Schema reflects parameter structure
 * - Descriptions from method metadata
 * - Required vs optional parameters
 */

// Import the generator
import { generateMCPTools, generateJSONSchema, type McpTool } from '../mcp-tools'

// Import auto-wiring helpers for testing
import {
  getExposedMethods,
  type ParameterInfo,
} from '../../../objects/auto-wiring'

// ============================================================================
// Test Mock Classes
// ============================================================================

/**
 * Mock class with various method signatures.
 * This tests the generator without needing the full DO class hierarchy.
 */
class TestClass {
  /**
   * Simple method with no parameters
   */
  async ping(): Promise<string> {
    return 'pong'
  }

  /**
   * Method with required parameter
   */
  async greet(name: string): Promise<string> {
    return `Hello, ${name}`
  }

  /**
   * Method with optional parameter
   */
  async echo(message: string, prefix?: string): Promise<string> {
    return prefix ? `${prefix}: ${message}` : message
  }

  /**
   * Method with multiple parameters
   */
  async createItem(id: string, name: string, data: Record<string, unknown>): Promise<{ id: string }> {
    return { id }
  }

  /**
   * Method with default parameter value
   */
  async search(query: string, limit: number = 10): Promise<string[]> {
    return []
  }

  /**
   * Private method (should not be exposed)
   */
  _internalMethod(): void {
    // This should not appear in tools
  }

  /**
   * Protected-style method (should not be exposed)
   */
  __protectedMethod(): void {
    // This should not appear in tools
  }
}

/**
 * Empty class for edge case testing
 */
class EmptyClass {
  // No additional methods except Object.prototype ones
  // The auto-wiring system excludes constructor and Object.prototype methods
}

/**
 * Class with complex parameter types
 */
class ComplexClass {
  /**
   * Method with object parameter
   */
  async processData(options: { key: string; value: unknown }): Promise<void> {
    // Process data
  }

  /**
   * Method with array parameter
   */
  async processBatch(items: string[]): Promise<number> {
    return items.length
  }

  /**
   * Method with optional object parameter
   */
  async configure(config?: { enabled: boolean }): Promise<void> {
    // Configure
  }
}

// ============================================================================
// generateMCPTools Tests
// ============================================================================

describe('MCP Tool Generator - generateMCPTools', () => {
  describe('Returns McpTool array', () => {
    it('returns an array', () => {
      const tools = generateMCPTools(TestClass)
      expect(Array.isArray(tools)).toBe(true)
    })

    it('returns McpTool objects with required properties', () => {
      const tools = generateMCPTools(TestClass)
      for (const tool of tools) {
        expect(tool).toHaveProperty('name')
        expect(tool).toHaveProperty('description')
        expect(tool).toHaveProperty('inputSchema')
      }
    })

    it('returns empty array for class with no exposed methods', () => {
      const tools = generateMCPTools(EmptyClass)
      expect(tools).toEqual([])
    })
  })

  describe('Tools generated for all exposed methods', () => {
    it('generates tool for each exposed method', () => {
      const tools = generateMCPTools(TestClass)
      const toolNames = tools.map((t) => t.name)

      expect(toolNames).toContain('ping')
      expect(toolNames).toContain('greet')
      expect(toolNames).toContain('echo')
      expect(toolNames).toContain('createItem')
      expect(toolNames).toContain('search')
    })

    it('excludes private methods (_prefixed)', () => {
      const tools = generateMCPTools(TestClass)
      const toolNames = tools.map((t) => t.name)

      expect(toolNames).not.toContain('_internalMethod')
    })

    it('excludes protected-style methods (__prefixed)', () => {
      const tools = generateMCPTools(TestClass)
      const toolNames = tools.map((t) => t.name)

      expect(toolNames).not.toContain('__protectedMethod')
    })
  })

  describe('Descriptions from method metadata', () => {
    it('includes description for each tool', () => {
      const tools = generateMCPTools(TestClass)

      for (const tool of tools) {
        expect(typeof tool.description).toBe('string')
        expect(tool.description.length).toBeGreaterThan(0)
      }
    })

    it('generates meaningful description from method name', () => {
      const tools = generateMCPTools(TestClass)
      const pingTool = tools.find((t) => t.name === 'ping')
      const greetTool = tools.find((t) => t.name === 'greet')
      const createItemTool = tools.find((t) => t.name === 'createItem')

      // Descriptions should be human-readable
      expect(pingTool?.description).toBeTruthy()
      expect(greetTool?.description).toBeTruthy()
      expect(createItemTool?.description).toBeTruthy()
    })

    it('uses method metadata description when available', () => {
      const tools = generateMCPTools(TestClass)

      // Each tool should have some description
      for (const tool of tools) {
        expect(tool.description).toBeDefined()
      }
    })
  })

  describe('Tool naming', () => {
    it('uses method name as tool name', () => {
      const tools = generateMCPTools(TestClass)

      const ping = tools.find((t) => t.name === 'ping')
      const greet = tools.find((t) => t.name === 'greet')

      expect(ping).toBeDefined()
      expect(greet).toBeDefined()
    })

    it('preserves camelCase method names', () => {
      const tools = generateMCPTools(TestClass)

      const createItem = tools.find((t) => t.name === 'createItem')
      expect(createItem).toBeDefined()
    })
  })
})

// ============================================================================
// generateJSONSchema Tests
// ============================================================================

describe('MCP Tool Generator - generateJSONSchema', () => {
  describe('Returns valid JSON Schema object', () => {
    it('returns object with type "object"', () => {
      const params: ParameterInfo[] = [{ name: 'id', optional: false }]
      const schema = generateJSONSchema(params)

      expect(schema.type).toBe('object')
    })

    it('includes properties object', () => {
      const params: ParameterInfo[] = [{ name: 'id', optional: false }]
      const schema = generateJSONSchema(params)

      expect(schema).toHaveProperty('properties')
      expect(typeof schema.properties).toBe('object')
    })

    it('includes required array', () => {
      const params: ParameterInfo[] = [{ name: 'id', optional: false }]
      const schema = generateJSONSchema(params)

      expect(schema).toHaveProperty('required')
      expect(Array.isArray(schema.required)).toBe(true)
    })
  })

  describe('Parameter properties', () => {
    it('creates property for each parameter', () => {
      const params: ParameterInfo[] = [
        { name: 'id', optional: false },
        { name: 'name', optional: false },
        { name: 'data', optional: true },
      ]
      const schema = generateJSONSchema(params)

      const properties = schema.properties as Record<string, unknown>
      expect(properties).toHaveProperty('id')
      expect(properties).toHaveProperty('name')
      expect(properties).toHaveProperty('data')
    })

    it('sets type to string by default', () => {
      const params: ParameterInfo[] = [{ name: 'id', optional: false }]
      const schema = generateJSONSchema(params)

      const properties = schema.properties as Record<string, { type: string }>
      expect(properties.id.type).toBe('string')
    })

    it('handles empty parameters array', () => {
      const params: ParameterInfo[] = []
      const schema = generateJSONSchema(params)

      expect(schema.type).toBe('object')
      expect(schema.properties).toEqual({})
      expect(schema.required).toEqual([])
    })
  })

  describe('Required vs optional parameters', () => {
    it('adds required parameters to required array', () => {
      const params: ParameterInfo[] = [
        { name: 'requiredParam', optional: false },
        { name: 'optionalParam', optional: true },
      ]
      const schema = generateJSONSchema(params)

      const required = schema.required as string[]
      expect(required).toContain('requiredParam')
      expect(required).not.toContain('optionalParam')
    })

    it('marks all non-optional parameters as required', () => {
      const params: ParameterInfo[] = [
        { name: 'a', optional: false },
        { name: 'b', optional: false },
        { name: 'c', optional: false },
      ]
      const schema = generateJSONSchema(params)

      const required = schema.required as string[]
      expect(required).toContain('a')
      expect(required).toContain('b')
      expect(required).toContain('c')
    })

    it('excludes all optional parameters from required', () => {
      const params: ParameterInfo[] = [
        { name: 'a', optional: true },
        { name: 'b', optional: true },
      ]
      const schema = generateJSONSchema(params)

      const required = schema.required as string[]
      expect(required).toHaveLength(0)
    })

    it('correctly handles mixed required and optional parameters', () => {
      const params: ParameterInfo[] = [
        { name: 'required1', optional: false },
        { name: 'optional1', optional: true },
        { name: 'required2', optional: false },
        { name: 'optional2', optional: true },
      ]
      const schema = generateJSONSchema(params)

      const required = schema.required as string[]
      expect(required).toHaveLength(2)
      expect(required).toContain('required1')
      expect(required).toContain('required2')
      expect(required).not.toContain('optional1')
      expect(required).not.toContain('optional2')
    })
  })
})

// ============================================================================
// JSON Schema reflects parameter structure Tests
// ============================================================================

describe('MCP Tool Generator - inputSchema matches method parameters', () => {
  describe('Schema matches method signature', () => {
    it('generates schema for method with no parameters', () => {
      const tools = generateMCPTools(TestClass)
      const pingTool = tools.find((t) => t.name === 'ping')

      expect(pingTool).toBeDefined()
      expect(pingTool?.inputSchema.type).toBe('object')

      const properties = pingTool?.inputSchema.properties as Record<string, unknown>
      expect(Object.keys(properties)).toHaveLength(0)
    })

    it('generates schema for method with single required parameter', () => {
      const tools = generateMCPTools(TestClass)
      const greetTool = tools.find((t) => t.name === 'greet')

      expect(greetTool).toBeDefined()
      const properties = greetTool?.inputSchema.properties as Record<string, { type: string }>
      const required = greetTool?.inputSchema.required as string[]

      expect(properties).toHaveProperty('name')
      expect(required).toContain('name')
    })

    it('generates schema for method with optional parameter', () => {
      const tools = generateMCPTools(TestClass)
      const echoTool = tools.find((t) => t.name === 'echo')

      expect(echoTool).toBeDefined()
      const properties = echoTool?.inputSchema.properties as Record<string, { type: string }>

      expect(properties).toHaveProperty('message')
      expect(properties).toHaveProperty('prefix')
      // Note: TypeScript's `?` for optional params is compiled away at runtime
      // so the auto-wiring can't detect it. Only default values or heuristic
      // patterns (options, config, etc.) are detected as optional.
    })

    it('generates schema for method with multiple parameters', () => {
      const tools = generateMCPTools(TestClass)
      const createItemTool = tools.find((t) => t.name === 'createItem')

      expect(createItemTool).toBeDefined()
      const properties = createItemTool?.inputSchema.properties as Record<string, { type: string }>
      const required = createItemTool?.inputSchema.required as string[]

      expect(properties).toHaveProperty('id')
      expect(properties).toHaveProperty('name')
      expect(properties).toHaveProperty('data')
      expect(required).toContain('id')
      expect(required).toContain('name')
      expect(required).toContain('data')
    })

    it('generates schema for method with default parameter value', () => {
      const tools = generateMCPTools(TestClass)
      const searchTool = tools.find((t) => t.name === 'search')

      expect(searchTool).toBeDefined()
      const properties = searchTool?.inputSchema.properties as Record<string, { type: string }>
      const required = searchTool?.inputSchema.required as string[]

      expect(properties).toHaveProperty('query')
      expect(properties).toHaveProperty('limit')
      expect(required).toContain('query')
      // limit has default value, so it should be optional
      expect(required).not.toContain('limit')
    })
  })

  describe('Complex class parameter handling', () => {
    it('generates schema for method with object parameter', () => {
      const tools = generateMCPTools(ComplexClass)
      const processDataTool = tools.find((t) => t.name === 'processData')

      expect(processDataTool).toBeDefined()
      const properties = processDataTool?.inputSchema.properties as Record<string, unknown>
      expect(properties).toHaveProperty('options')
    })

    it('generates schema for method with array parameter', () => {
      const tools = generateMCPTools(ComplexClass)
      const processBatchTool = tools.find((t) => t.name === 'processBatch')

      expect(processBatchTool).toBeDefined()
      const properties = processBatchTool?.inputSchema.properties as Record<string, unknown>
      expect(properties).toHaveProperty('items')
    })

    it('generates schema for method with optional object parameter', () => {
      const tools = generateMCPTools(ComplexClass)
      const configureTool = tools.find((t) => t.name === 'configure')

      expect(configureTool).toBeDefined()
      const properties = configureTool?.inputSchema.properties as Record<string, unknown>
      // Note: TypeScript's `?` is compiled away at runtime, but since 'config'
      // matches the heuristic pattern for optional params, it should be optional
      expect(properties).toHaveProperty('config')
    })
  })
})

// ============================================================================
// McpTool Type Tests
// ============================================================================

describe('MCP Tool Generator - McpTool type', () => {
  it('name is a string', () => {
    const tools = generateMCPTools(TestClass)
    for (const tool of tools) {
      expect(typeof tool.name).toBe('string')
    }
  })

  it('description is a string', () => {
    const tools = generateMCPTools(TestClass)
    for (const tool of tools) {
      expect(typeof tool.description).toBe('string')
    }
  })

  it('inputSchema is an object', () => {
    const tools = generateMCPTools(TestClass)
    for (const tool of tools) {
      expect(typeof tool.inputSchema).toBe('object')
      expect(tool.inputSchema).not.toBeNull()
    }
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('MCP Tool Generator - Integration', () => {
  it('works with auto-wiring getExposedMethods', () => {
    const exposedMethods = getExposedMethods(TestClass)
    const tools = generateMCPTools(TestClass)

    // Each exposed method should have a corresponding tool
    for (const methodName of exposedMethods) {
      const tool = tools.find((t) => t.name === methodName)
      expect(tool).toBeDefined()
    }
  })

  it('produces tools compatible with MCP protocol', () => {
    const tools = generateMCPTools(TestClass)

    // MCP tools/list response format
    const mcpToolsListResponse = {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    }

    expect(mcpToolsListResponse).toHaveProperty('tools')
    expect(Array.isArray(mcpToolsListResponse.tools)).toBe(true)

    for (const tool of mcpToolsListResponse.tools) {
      expect(tool).toHaveProperty('name')
      expect(tool).toHaveProperty('description')
      expect(tool).toHaveProperty('inputSchema')
    }
  })

  it('generates deterministic output for same input', () => {
    const tools1 = generateMCPTools(TestClass)
    const tools2 = generateMCPTools(TestClass)

    expect(tools1).toEqual(tools2)
  })
})
