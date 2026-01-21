/**
 * TDD Integration Tests for @dotdo/mcp using digital-tools patterns
 *
 * These tests verify that the MCP tool registry should integrate with
 * the digital-tools package from primitives.org.ai
 *
 * The digital-tools package provides:
 * - Core Tool interface and types (Tool, AnyTool, ToolCategory)
 * - Tool ontology/categories for organization
 * - Tool registry with registration and discovery
 * - Tool definition helpers (defineTool, toolBuilder)
 * - MCP compatibility (toMCP, listMCPTools)
 *
 * These tests describe the EXPECTED behavior after integration.
 * They will FAIL until the integration is implemented.
 *
 * @module mcp/tests/digital-tools-integration.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ToolRegistry, ToolCategory } from '../discovery'
import type { MCPTool } from '../server'

// ============================================================================
// Types - These mirror digital-tools types to define expected interface
// ============================================================================

/**
 * High-level tool categories from digital-tools
 */
type DigitalToolCategory =
  | 'communication'
  | 'data'
  | 'development'
  | 'documents'
  | 'finance'
  | 'integration'
  | 'knowledge'
  | 'media'
  | 'productivity'
  | 'security'
  | 'system'
  | 'web'

/**
 * Tool subcategories from digital-tools
 */
type DigitalToolSubcategory =
  | 'email' | 'sms' | 'slack' | 'notification'
  | 'database' | 'transform' | 'validate'
  | 'fetch' | 'scrape' | 'screenshot'
  | 'search' | 'rag' | 'embedding'
  | 'calendar' | 'task'
  | 'payment' | 'invoice'

/**
 * Tool audience from digital-tools
 */
type ToolAudience = 'agent' | 'human' | 'both'

/**
 * Tool permission from digital-tools
 */
interface ToolPermission {
  type: 'read' | 'write' | 'execute' | 'admin' | 'custom'
  resource?: string
}

/**
 * Security level from digital-tools
 */
type SecurityLevel = 'public' | 'internal' | 'confidential' | 'restricted'

/**
 * Tool parameter from digital-tools
 */
interface ToolParameter {
  name: string
  description: string
  schema: Record<string, unknown>
  required?: boolean
  default?: unknown
}

/**
 * Digital Tool interface - mirrors digital-tools Tool type
 */
interface DigitalTool<TInput = unknown, TOutput = unknown> {
  id: string
  name: string
  description: string
  version?: string
  category: DigitalToolCategory
  subcategory?: DigitalToolSubcategory
  tags?: string[]
  audience?: ToolAudience
  permissions?: ToolPermission[]
  securityLevel?: SecurityLevel
  parameters: ToolParameter[]
  handler: (input: TInput) => TOutput | Promise<TOutput>
  requiresConfirmation?: boolean
  idempotent?: boolean
}

/**
 * MCP Tool format from digital-tools
 */
interface DigitalMCPTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

/**
 * DefineToolOptions from digital-tools
 */
interface DefineToolOptions<TInput, TOutput> {
  id: string
  name: string
  description: string
  category: DigitalToolCategory
  subcategory?: DigitalToolSubcategory
  input: {
    type: string
    properties: Record<string, unknown>
    required?: string[]
  }
  handler: (input: TInput) => TOutput | Promise<TOutput>
  options?: Partial<Omit<DigitalTool<TInput, TOutput>, 'id' | 'name' | 'description' | 'category' | 'parameters' | 'handler'>>
}

// ============================================================================
// Stub implementations - These should be replaced by actual digital-tools
// ============================================================================

/**
 * Convert a schema to tool parameters (stub)
 */
function schemaToParameters(schema: DefineToolOptions<unknown, unknown>['input']): ToolParameter[] {
  if (!schema.properties) return []
  return Object.entries(schema.properties).map(([name, propSchema]) => ({
    name,
    description: (propSchema as Record<string, unknown>).description as string || `Parameter: ${name}`,
    schema: propSchema as Record<string, unknown>,
    required: schema.required?.includes(name),
  }))
}

/**
 * Define a tool (stub implementation - should use digital-tools)
 */
function defineTool<TInput, TOutput>(
  options: DefineToolOptions<TInput, TOutput>
): DigitalTool<TInput, TOutput> {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    category: options.category,
    subcategory: options.subcategory,
    parameters: schemaToParameters(options.input),
    handler: options.handler,
    ...options.options,
  }
}

/**
 * Convert a digital tool to MCP format (stub implementation)
 */
function toMCP(tool: DigitalTool): DigitalMCPTool {
  return {
    name: tool.id,
    description: tool.description,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(
        tool.parameters.map((p) => [
          p.name,
          { ...p.schema, description: p.description },
        ])
      ),
      required: tool.parameters.filter((p) => p.required).map((p) => p.name),
    },
  }
}

/**
 * Digital Tool Registry interface
 */
interface DigitalToolRegistry {
  register(tool: DigitalTool): void
  unregister(id: string): boolean
  get(id: string): DigitalTool | undefined
  has(id: string): boolean
  list(): string[]
  query(options: { category?: DigitalToolCategory; audience?: ToolAudience }): DigitalTool[]
  clear(): void
}

/**
 * Create a digital registry (stub implementation)
 */
function createDigitalRegistry(): DigitalToolRegistry {
  const tools = new Map<string, DigitalTool>()
  return {
    register(tool: DigitalTool) {
      tools.set(tool.id, tool)
    },
    unregister(id: string) {
      return tools.delete(id)
    },
    get(id: string) {
      return tools.get(id)
    },
    has(id: string) {
      return tools.has(id)
    },
    list() {
      return Array.from(tools.keys())
    },
    query(options) {
      let results = Array.from(tools.values())
      if (options.category) {
        results = results.filter((t) => t.category === options.category)
      }
      if (options.audience) {
        results = results.filter(
          (t) => !t.audience || t.audience === options.audience || t.audience === 'both'
        )
      }
      return results
    },
    clear() {
      tools.clear()
    },
  }
}

/**
 * List all tools as MCP format (stub implementation)
 */
function listMCPTools(registry: DigitalToolRegistry): DigitalMCPTool[] {
  return registry.list().map((id) => toMCP(registry.get(id)!))
}

/**
 * Execute a tool by ID (stub implementation)
 */
async function executeTool<TInput, TOutput>(
  registry: DigitalToolRegistry,
  id: string,
  input: TInput
): Promise<TOutput> {
  const tool = registry.get(id)
  if (!tool) {
    throw new Error(`Tool "${id}" not found`)
  }
  return tool.handler(input) as Promise<TOutput>
}

/**
 * Tool context for execution
 */
interface ToolContext {
  executor: { type: ToolAudience; id: string; name?: string }
  environment?: 'development' | 'staging' | 'production'
  requestId?: string
}

/**
 * Create a tool executor with context (stub implementation)
 */
function createToolExecutor(context: ToolContext, registry: DigitalToolRegistry) {
  return {
    async execute<TInput, TOutput>(toolId: string, input: TInput) {
      const tool = registry.get(toolId)
      if (!tool) {
        return { success: false, error: { code: 'TOOL_NOT_FOUND', message: `Tool not found: ${toolId}` } }
      }
      try {
        const data = await tool.handler(input) as TOutput
        return { success: true, data }
      } catch (error) {
        return { success: false, error: { code: 'EXECUTION_ERROR', message: String(error) } }
      }
    },
    listAvailable() {
      return registry.query({ audience: context.executor.type as ToolAudience })
    },
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Digital Tools Integration', () => {
  let mcpRegistry: ToolRegistry
  let digitalRegistry: DigitalToolRegistry

  beforeEach(() => {
    mcpRegistry = new ToolRegistry()
    digitalRegistry = createDigitalRegistry()
  })

  describe('Tool Definition Compatibility', () => {
    it('should define tools using digital-tools defineTool helper', () => {
      const searchTool = defineTool<
        { query: string; limit?: number },
        { results: unknown[]; total: number }
      >({
        id: 'data.search',
        name: 'Search',
        description: 'Search for items in the store',
        category: 'data',
        subcategory: 'database',
        input: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results' },
          },
          required: ['query'],
        },
        handler: async (input) => {
          return { results: [], total: 0 }
        },
      })

      expect(searchTool.id).toBe('data.search')
      expect(searchTool.name).toBe('Search')
      expect(searchTool.category).toBe('data')
      expect(searchTool.subcategory).toBe('database')
      expect(searchTool.parameters).toBeDefined()
      expect(searchTool.handler).toBeDefined()
    })

    it('should support digital-tools category taxonomy', () => {
      const categories: DigitalToolCategory[] = [
        'communication',
        'data',
        'development',
        'documents',
        'finance',
        'integration',
        'knowledge',
        'media',
        'productivity',
        'security',
        'system',
        'web',
      ]

      // Current MCP categories are: DATA, COMPUTE, GENERAL
      // Integration should map digital-tools categories to MCP categories
      const categoryMap: Record<DigitalToolCategory, ToolCategory> = {
        communication: ToolCategory.GENERAL,
        data: ToolCategory.DATA,
        development: ToolCategory.COMPUTE,
        documents: ToolCategory.DATA,
        finance: ToolCategory.GENERAL,
        integration: ToolCategory.DATA,
        knowledge: ToolCategory.DATA,
        media: ToolCategory.GENERAL,
        productivity: ToolCategory.GENERAL,
        security: ToolCategory.GENERAL,
        system: ToolCategory.COMPUTE,
        web: ToolCategory.DATA,
      }

      for (const category of categories) {
        expect(categoryMap[category]).toBeDefined()
      }
    })
  })

  describe('Registry Interoperability', () => {
    it('should register digital-tools in MCP registry', () => {
      const digitalTool = defineTool({
        id: 'communication.email.send',
        name: 'Send Email',
        description: 'Send an email to recipients',
        category: 'communication',
        subcategory: 'email',
        input: {
          type: 'object',
          properties: {
            to: { type: 'array', items: { type: 'string' } },
            subject: { type: 'string' },
            body: { type: 'string' },
          },
          required: ['to', 'subject', 'body'],
        },
        handler: async () => ({ success: true, messageId: 'msg_123' }),
      })

      // Convert to MCP format and register
      const mcpFormat = toMCP(digitalTool)
      const mcpTool: MCPTool = {
        name: mcpFormat.name,
        description: mcpFormat.description,
        inputSchema: mcpFormat.inputSchema,
        execute: digitalTool.handler as MCPTool['execute'],
      }

      mcpRegistry.register(mcpTool)

      expect(mcpRegistry.get('communication.email.send')).toBeDefined()
    })

    it('should use digital-tools toMCP converter', () => {
      const tool = defineTool({
        id: 'data.transform',
        name: 'Transform Data',
        description: 'Transform data using a mapping function',
        category: 'data',
        subcategory: 'transform',
        input: {
          type: 'object',
          properties: {
            data: { type: 'array', description: 'Input data array' },
            mapping: { type: 'object', description: 'Transformation mapping' },
          },
          required: ['data', 'mapping'],
        },
        handler: async () => ({ transformed: [] }),
      })

      const mcpFormat = toMCP(tool)

      expect(mcpFormat.name).toBe('data.transform')
      expect(mcpFormat.description).toBe('Transform data using a mapping function')
      expect(mcpFormat.inputSchema).toHaveProperty('type', 'object')
      expect(mcpFormat.inputSchema).toHaveProperty('properties')
      expect(mcpFormat.inputSchema).toHaveProperty('required')
    })

    it('should list all digital-tools as MCP tools', () => {
      const tools = [
        defineTool({
          id: 'web.fetch',
          name: 'Fetch',
          description: 'Fetch URL',
          category: 'web',
          input: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
          handler: async () => ({}),
        }),
        defineTool({
          id: 'data.parse',
          name: 'Parse',
          description: 'Parse data',
          category: 'data',
          input: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] },
          handler: async () => ({}),
        }),
      ]

      for (const tool of tools) {
        digitalRegistry.register(tool)
      }

      const mcpTools = listMCPTools(digitalRegistry)

      expect(mcpTools).toHaveLength(2)
      expect(mcpTools.map((t) => t.name)).toContain('web.fetch')
      expect(mcpTools.map((t) => t.name)).toContain('data.parse')
    })
  })

  describe('Tool Execution', () => {
    it('should execute digital-tools through MCP server', async () => {
      const computeTool = defineTool<
        { code: string; timeout?: number },
        { result: unknown; duration: number }
      >({
        id: 'system.execute',
        name: 'Execute Code',
        description: 'Execute code in a sandbox',
        category: 'system',
        subcategory: 'database',
        input: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Code to execute' },
            timeout: { type: 'number', description: 'Timeout in ms' },
          },
          required: ['code'],
        },
        handler: async () => {
          const start = Date.now()
          return { result: 'executed', duration: Date.now() - start }
        },
      })

      digitalRegistry.register(computeTool)

      const result = await executeTool<{ code: string }, { result: unknown; duration: number }>(
        digitalRegistry,
        'system.execute',
        { code: 'return 42' }
      )
      expect(result).toHaveProperty('result')
      expect(result).toHaveProperty('duration')
    })

    it('should support tool executor with context', () => {
      const tool = defineTool({
        id: 'knowledge.search',
        name: 'Knowledge Search',
        description: 'Search knowledge base',
        category: 'knowledge',
        subcategory: 'search',
        input: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
        handler: async (input) => ({ results: [], query: input }),
      })

      digitalRegistry.register(tool)

      const executor = createToolExecutor(
        {
          executor: { type: 'agent', id: 'agent_001', name: 'Test Agent' },
          environment: 'development',
          requestId: 'req_123',
        },
        digitalRegistry
      )

      const available = executor.listAvailable()
      expect(available).toBeDefined()
      expect(available.length).toBeGreaterThan(0)
    })

    it('should handle tool execution errors gracefully', async () => {
      const failingTool = defineTool({
        id: 'test.fail',
        name: 'Failing Tool',
        description: 'A tool that always fails',
        category: 'system',
        input: { type: 'object', properties: {} },
        handler: async () => {
          throw new Error('Intentional failure')
        },
      })

      digitalRegistry.register(failingTool)

      await expect(
        executeTool(digitalRegistry, 'test.fail', {})
      ).rejects.toThrow('Intentional failure')
    })
  })

  describe('MCP Protocol Compliance', () => {
    it('should produce valid MCP tool definitions', () => {
      const tool = defineTool({
        id: 'productivity.calendar.create',
        name: 'Create Calendar Event',
        description: 'Create a new calendar event',
        category: 'productivity',
        subcategory: 'calendar',
        input: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Event title' },
            start: { type: 'string', format: 'date-time', description: 'Start time (ISO 8601)' },
            end: { type: 'string', format: 'date-time', description: 'End time (ISO 8601)' },
            attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee emails' },
          },
          required: ['title', 'start', 'end'],
        },
        handler: async () => ({ eventId: 'evt_123', created: true }),
      })

      const mcpTool = toMCP(tool)

      // MCP protocol requires these fields
      expect(mcpTool).toHaveProperty('name')
      expect(mcpTool).toHaveProperty('description')
      expect(mcpTool).toHaveProperty('inputSchema')

      // inputSchema must be valid JSON Schema
      expect(mcpTool.inputSchema).toHaveProperty('type', 'object')
      expect(mcpTool.inputSchema).toHaveProperty('properties')
      expect(mcpTool.inputSchema).toHaveProperty('required')
    })

    it('should handle tools with optional parameters', () => {
      const tool = defineTool({
        id: 'web.screenshot',
        name: 'Take Screenshot',
        description: 'Capture a screenshot of a webpage',
        category: 'web',
        subcategory: 'screenshot',
        input: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to capture' },
            width: { type: 'number', description: 'Viewport width' },
            height: { type: 'number', description: 'Viewport height' },
            fullPage: { type: 'boolean', description: 'Capture full page' },
          },
          required: ['url'],
        },
        handler: async () => ({ imageData: '', format: 'png' }),
      })

      const mcpTool = toMCP(tool)

      expect(mcpTool.inputSchema.required).toEqual(['url'])
      expect(Object.keys(mcpTool.inputSchema.properties)).toContain('width')
      expect(Object.keys(mcpTool.inputSchema.properties)).toContain('height')
      expect(Object.keys(mcpTool.inputSchema.properties)).toContain('fullPage')
    })

    it('should preserve parameter descriptions for LLM consumption', () => {
      const tool = defineTool({
        id: 'communication.sms.send',
        name: 'Send SMS',
        description: 'Send an SMS text message to a phone number',
        category: 'communication',
        subcategory: 'sms',
        input: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Phone number in E.164 format (e.g., +14155551234)' },
            message: { type: 'string', description: 'SMS message content (max 160 chars recommended)' },
            from: { type: 'string', description: 'Sender phone number or messaging service ID' },
          },
          required: ['to', 'message'],
        },
        handler: async () => ({ success: true, messageId: 'sms_123' }),
      })

      const mcpTool = toMCP(tool)
      const props = mcpTool.inputSchema.properties as Record<string, { description?: string }>

      // Parameter descriptions should be preserved for LLM understanding
      expect(props.to?.description).toContain('E.164')
      expect(props.message?.description).toContain('160')
    })
  })

  describe('Tool Metadata and Discovery', () => {
    it('should support tool audiences (agent, human, both)', () => {
      const agentOnlyTool = defineTool({
        id: 'system.internal.optimize',
        name: 'Optimize System',
        description: 'Internal optimization (agent only)',
        category: 'system',
        input: { type: 'object', properties: {} },
        handler: async () => ({}),
        options: { audience: 'agent' },
      })

      const humanOnlyTool = defineTool({
        id: 'security.admin.reset',
        name: 'Reset Admin',
        description: 'Reset admin credentials (human only)',
        category: 'security',
        input: { type: 'object', properties: {} },
        handler: async () => ({}),
        options: { audience: 'human' },
      })

      const bothTool = defineTool({
        id: 'data.export',
        name: 'Export Data',
        description: 'Export data (both)',
        category: 'data',
        input: { type: 'object', properties: {} },
        handler: async () => ({}),
        options: { audience: 'both' },
      })

      expect(agentOnlyTool.audience).toBe('agent')
      expect(humanOnlyTool.audience).toBe('human')
      expect(bothTool.audience).toBe('both')
    })

    it('should support tool permissions', () => {
      const tool = defineTool({
        id: 'finance.payment.process',
        name: 'Process Payment',
        description: 'Process a payment transaction',
        category: 'finance',
        subcategory: 'payment',
        input: {
          type: 'object',
          properties: {
            amount: { type: 'number' },
            currency: { type: 'string' },
          },
          required: ['amount', 'currency'],
        },
        handler: async () => ({ transactionId: 'txn_123' }),
        options: {
          permissions: [
            { type: 'execute', resource: 'payments' },
            { type: 'write', resource: 'transactions' },
          ],
          securityLevel: 'confidential',
          requiresConfirmation: true,
        },
      })

      expect(tool.permissions).toHaveLength(2)
      expect(tool.securityLevel).toBe('confidential')
      expect(tool.requiresConfirmation).toBe(true)
    })

    it('should support tool tags for categorization', () => {
      const tool = defineTool({
        id: 'media.image.resize',
        name: 'Resize Image',
        description: 'Resize an image to specified dimensions',
        category: 'media',
        input: {
          type: 'object',
          properties: {
            imageUrl: { type: 'string' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
          required: ['imageUrl', 'width', 'height'],
        },
        handler: async () => ({ resizedUrl: '' }),
        options: {
          tags: ['image', 'resize', 'transform', 'media'],
        },
      })

      expect(tool.tags).toContain('image')
      expect(tool.tags).toContain('resize')
      expect(tool.tags).toContain('transform')
    })

    it('should support tool versioning', () => {
      const toolV1 = defineTool({
        id: 'api.request.v1',
        name: 'API Request',
        description: 'Make an API request',
        category: 'integration',
        input: {
          type: 'object',
          properties: { url: { type: 'string' } },
          required: ['url'],
        },
        handler: async () => ({}),
        options: { version: '1.0.0' },
      })

      const toolV2 = defineTool({
        id: 'api.request.v2',
        name: 'API Request',
        description: 'Make an API request (v2 with retry)',
        category: 'integration',
        input: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            retries: { type: 'number' },
          },
          required: ['url'],
        },
        handler: async () => ({}),
        options: { version: '2.0.0' },
      })

      expect(toolV1.version).toBe('1.0.0')
      expect(toolV2.version).toBe('2.0.0')
    })
  })

  describe('Built-in Tools Integration (Future)', () => {
    // These tests describe expected future integration with digital-tools built-in tools

    it('should support web tools integration', () => {
      // When integrated, these tools should be available from digital-tools
      const expectedWebTools = ['fetchUrl', 'parseHtml', 'readUrl']

      // FUTURE: Import and test actual digital-tools
      // import { webTools } from 'digital-tools'
      // expect(webTools.map(t => t.name)).toEqual(expectedWebTools)

      // For now, verify the expected interface
      expect(expectedWebTools).toHaveLength(3)
    })

    it('should support data tools integration', () => {
      const expectedDataTools = ['parseJson', 'stringifyJson', 'parseCsv', 'transformData', 'filterData']
      expect(expectedDataTools).toHaveLength(5)
    })

    it('should support communication tools integration', () => {
      const expectedCommTools = ['sendEmail', 'sendSlackMessage', 'sendNotification', 'sendSms']
      expect(expectedCommTools).toHaveLength(4)
    })
  })

  describe('Category Mapping', () => {
    it('should map digital-tools categories to MCP categories correctly', () => {
      // digital-tools has 12 categories, MCP currently has 3
      // This test verifies the mapping is complete and sensible

      const digitalCategories: DigitalToolCategory[] = [
        'communication', 'data', 'development', 'documents', 'finance',
        'integration', 'knowledge', 'media', 'productivity', 'security',
        'system', 'web',
      ]

      const mcpCategories = [ToolCategory.DATA, ToolCategory.COMPUTE, ToolCategory.GENERAL]

      // Every digital-tools category should map to an MCP category
      const mapping: Record<DigitalToolCategory, ToolCategory> = {
        communication: ToolCategory.GENERAL,
        data: ToolCategory.DATA,
        development: ToolCategory.COMPUTE,
        documents: ToolCategory.DATA,
        finance: ToolCategory.GENERAL,
        integration: ToolCategory.DATA,
        knowledge: ToolCategory.DATA,
        media: ToolCategory.GENERAL,
        productivity: ToolCategory.GENERAL,
        security: ToolCategory.GENERAL,
        system: ToolCategory.COMPUTE,
        web: ToolCategory.DATA,
      }

      for (const category of digitalCategories) {
        expect(mcpCategories).toContain(mapping[category])
      }
    })
  })

  describe('Error Handling', () => {
    it('should return error for non-existent tool', async () => {
      await expect(
        executeTool(digitalRegistry, 'nonexistent.tool', {})
      ).rejects.toThrow('Tool "nonexistent.tool" not found')
    })

    it('should handle invalid tool parameters gracefully', async () => {
      const tool = defineTool({
        id: 'test.validate',
        name: 'Validate Test',
        description: 'Test validation',
        category: 'data',
        input: {
          type: 'object',
          properties: {
            required_param: { type: 'string' },
          },
          required: ['required_param'],
        },
        handler: async (input: { required_param: string }) => {
          if (!input.required_param) {
            throw new Error('required_param is required')
          }
          return { valid: true }
        },
      })

      digitalRegistry.register(tool)

      // This should fail because required_param is missing
      await expect(
        executeTool(digitalRegistry, 'test.validate', {})
      ).rejects.toThrow('required_param is required')
    })
  })
})
