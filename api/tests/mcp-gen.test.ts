import { describe, it, expect, beforeEach } from 'vitest'
import { generateMCPTools, MCPGenerator } from '../codegen/mcp'
import { defineResource, clearRegistry } from '../resource'
import type { ResourceDefinition } from '../resource'

describe('MCP Tool Generation', () => {
  beforeEach(() => {
    clearRegistry()
  })

  describe('generateMCPTools', () => {
    it('should generate MCP tools from resource definitions', () => {
      const Customer = defineResource('Customer')
        .fields({
          name: { type: 'string', required: true },
          email: { type: 'string', required: true, format: 'email' }
        })
        .build()

      const tools = generateMCPTools([Customer])

      expect(tools).toBeDefined()
      expect(tools.length).toBeGreaterThan(0)
    })

    it('should generate tool names following MCP conventions (resource_action)', () => {
      const Product = defineResource('Product')
        .fields({
          name: { type: 'string', required: true },
          price: { type: 'number', required: true }
        })
        .build()

      const tools = generateMCPTools([Product])

      // Should have CRUD operations: create, get, update, delete, list
      const toolNames = tools.map(t => t.name)
      expect(toolNames).toContain('product_create')
      expect(toolNames).toContain('product_get')
      expect(toolNames).toContain('product_update')
      expect(toolNames).toContain('product_delete')
      expect(toolNames).toContain('product_list')
    })

    it('should generate input schemas from resource fields', () => {
      const Order = defineResource('Order')
        .fields({
          customerId: { type: 'string', required: true },
          total: { type: 'number', required: true }
        })
        .build()

      const tools = generateMCPTools([Order])
      const createTool = tools.find(t => t.name === 'order_create')

      expect(createTool).toBeDefined()
      expect(createTool!.inputSchema).toEqual({
        type: 'object',
        properties: {
          customerId: {
            type: 'string',
            description: 'The customerId field'
          },
          total: {
            type: 'number',
            description: 'The total field'
          }
        },
        required: ['customerId', 'total']
      })
    })

    it('should generate LLM-friendly descriptions', () => {
      const Invoice = defineResource('Invoice')
        .fields({
          invoiceNumber: { type: 'string', required: true },
          amount: { type: 'number', required: true }
        })
        .build()

      const tools = generateMCPTools([Invoice])
      const createTool = tools.find(t => t.name === 'invoice_create')

      expect(createTool!.description).toBeDefined()
      expect(createTool!.description).toContain('Create a new invoice')
      expect(createTool!.description.length).toBeGreaterThan(10) // Meaningful description
    })

    it('should handle optional fields correctly', () => {
      const Task = defineResource('Task')
        .fields({
          title: { type: 'string', required: true },
          description: { type: 'string', required: false }
        })
        .build()

      const tools = generateMCPTools([Task])
      const createTool = tools.find(t => t.name === 'task_create')

      expect(createTool!.inputSchema).toEqual({
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'The title field'
          },
          description: {
            type: 'string',
            description: 'The description field'
          }
        },
        required: ['title']
      })
    })

    it('should include custom action tools', () => {
      const Customer = defineResource('Customer')
        .fields({
          name: { type: 'string', required: true },
          email: { type: 'string', required: true }
        })
        .actions({
          upgrade: {
            method: 'POST',
            handler: async () => ({ upgraded: true })
          }
        })
        .build()

      const tools = generateMCPTools([Customer])
      const upgradeTool = tools.find(t => t.name === 'customer_upgrade')

      expect(upgradeTool).toBeDefined()
      expect(upgradeTool!.description).toContain('upgrade')
    })

    it('should generate tools with proper type conversions', () => {
      const Event = defineResource('Event')
        .fields({
          name: { type: 'string', required: true },
          date: { type: 'date', required: true },
          attendees: { type: 'number', required: true },
          confirmed: { type: 'boolean', required: true }
        })
        .build()

      const tools = generateMCPTools([Event])
      const createTool = tools.find(t => t.name === 'event_create')

      expect(createTool!.inputSchema.properties).toEqual({
        name: { type: 'string', description: 'The name field' },
        date: { type: 'string', format: 'date-time', description: 'The date field' },
        attendees: { type: 'number', description: 'The attendees field' },
        confirmed: { type: 'boolean', description: 'The confirmed field' }
      })
    })
  })

  describe('MCPGenerator class', () => {
    it('should generate tools from resources', () => {
      const generator = new MCPGenerator()

      const Customer = defineResource('Customer')
        .fields({
          name: { type: 'string', required: true }
        })
        .build()

      const tools = generator.generateTools([Customer])

      expect(tools.length).toBeGreaterThan(0)
    })

    it('should convert resource field to JSON schema', () => {
      const generator = new MCPGenerator()

      const schema = generator.fieldToJSONSchema('email', {
        type: 'string',
        required: true
      })

      expect(schema).toEqual({
        type: 'string',
        description: 'The email field'
      })
    })

    it('should create tool schemas from resource definitions', () => {
      const generator = new MCPGenerator()

      const Customer = defineResource('Customer')
        .fields({
          name: { type: 'string', required: true },
          email: { type: 'string', required: true }
        })
        .build()

      const toolSchema = generator.resourceToInputSchema(Customer)

      expect(toolSchema).toEqual({
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The name field' },
          email: { type: 'string', description: 'The email field' }
        },
        required: ['name', 'email']
      })
    })

    it('should generate semantic descriptions for LLM understanding', () => {
      const generator = new MCPGenerator()

      const description = generator.generateDescription('Customer', 'create')

      expect(description).toBe('Create a new customer in the system')
    })

    it('should support all CRUD operations', () => {
      const generator = new MCPGenerator()

      const operations = ['create', 'get', 'update', 'delete', 'list']

      operations.forEach(op => {
        const desc = generator.generateDescription('Order', op)
        expect(desc).toBeDefined()
        expect(desc.length).toBeGreaterThan(0)
      })
    })

    it('should handle relation fields', () => {
      const generator = new MCPGenerator()

      const Order = defineResource('Order')
        .fields({
          customerId: { type: 'string', required: true }
        })
        .relations({
          customer: {
            type: 'belongsTo',
            resource: 'Customer'
          }
        })
        .build()

      const tools = generator.generateTools([Order])

      // Should still generate standard CRUD tools
      expect(tools.some(t => t.name === 'order_create')).toBe(true)
    })

    it('should export MCP server configuration', () => {
      const generator = new MCPGenerator()

      const Customer = defineResource('Customer')
        .fields({
          name: { type: 'string', required: true }
        })
        .build()

      const config = generator.generateServerConfig([Customer], {
        name: 'test-api',
        version: '1.0.0'
      })

      expect(config).toEqual({
        name: 'test-api',
        version: '1.0.0',
        tools: expect.any(Array)
      })

      expect(config.tools.length).toBeGreaterThan(0)
      expect(config.tools[0]).toHaveProperty('name')
      expect(config.tools[0]).toHaveProperty('description')
      expect(config.tools[0]).toHaveProperty('inputSchema')
    })
  })

  describe('Tool execution', () => {
    it('should generate executable tool handlers', async () => {
      const Customer = defineResource('Customer')
        .fields({
          name: { type: 'string', required: true }
        })
        .build()

      const tools = generateMCPTools([Customer])
      const createTool = tools.find(t => t.name === 'customer_create')

      expect(createTool).toBeDefined()
      // Handler should be defined (will be connected to actual API in integration)
      expect(createTool!.handler).toBeDefined()
    })

    it('should validate input against schema', async () => {
      const generator = new MCPGenerator()

      const Customer = defineResource('Customer')
        .fields({
          name: { type: 'string', required: true }
        })
        .build()

      const tools = generator.generateTools([Customer])
      const createTool = tools.find(t => t.name === 'customer_create')

      // Handler should validate input
      expect(createTool!.handler).toBeDefined()

      // Test with valid input
      const validResult = await createTool!.handler!({ name: 'Test Customer' })
      expect(validResult).toBeDefined()

      // Test with invalid input - should throw or return error
      await expect(createTool!.handler!({})).rejects.toThrow()
    })
  })

  describe('MCP compliance', () => {
    it('should generate MCP-compliant tool definitions', () => {
      const Customer = defineResource('Customer')
        .fields({
          name: { type: 'string', required: true }
        })
        .build()

      const tools = generateMCPTools([Customer])
      const tool = tools[0]

      // MCP tool must have: name, description, inputSchema
      expect(tool).toHaveProperty('name')
      expect(typeof tool.name).toBe('string')

      expect(tool).toHaveProperty('description')
      expect(typeof tool.description).toBe('string')

      expect(tool).toHaveProperty('inputSchema')
      expect(typeof tool.inputSchema).toBe('object')
      expect(tool.inputSchema).toHaveProperty('type', 'object')
    })

    it('should generate valid JSON Schema for inputSchema', () => {
      const Product = defineResource('Product')
        .fields({
          name: { type: 'string', required: true },
          price: { type: 'number', required: true },
          inStock: { type: 'boolean', required: true }
        })
        .build()

      const tools = generateMCPTools([Product])
      const createTool = tools.find(t => t.name === 'product_create')

      const schema = createTool!.inputSchema

      // Valid JSON Schema properties
      expect(schema.type).toBe('object')
      expect(schema.properties).toBeDefined()
      expect(schema.required).toBeDefined()
      expect(Array.isArray(schema.required)).toBe(true)

      // All required fields should be in required array
      expect(schema.required).toContain('name')
      expect(schema.required).toContain('price')
      expect(schema.required).toContain('inStock')
    })
  })
})
