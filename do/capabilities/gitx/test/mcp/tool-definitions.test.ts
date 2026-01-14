import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  gitTools,
  MCPTool,
  JSONSchema,
  registerTool,
  invokeTool,
  validateToolInput,
  listTools,
  getTool,
} from '../../src/mcp/tools'

/**
 * Test file for MCP Git Tool Definitions
 *
 * This file tests the following areas:
 * 1. Tool schema validation
 * 2. Input parameter validation
 * 3. Tool handler mapping
 * 4. Documentation generation
 * 5. Tool discovery
 *
 * RED phase: These tests should fail because the implementations
 * don't exist yet (gitTools is empty, functions are stubs).
 */

describe('MCP Git Tool Definitions', () => {
  // ==========================================================================
  // 1. TOOL SCHEMA VALIDATION
  // ==========================================================================
  describe('Tool Schema Validation', () => {
    describe('Schema structure requirements', () => {
      it('should validate that all tools have object type schemas', () => {
        expect(gitTools.length).toBeGreaterThan(0)
        gitTools.forEach((tool) => {
          expect(tool.inputSchema.type).toBe('object')
        })
      })

      it('should validate that all schemas have properties defined', () => {
        gitTools.forEach((tool) => {
          expect(tool.inputSchema.properties).toBeDefined()
          expect(typeof tool.inputSchema.properties).toBe('object')
        })
      })

      it('should validate required array only contains existing properties', () => {
        gitTools.forEach((tool) => {
          const required = tool.inputSchema.required || []
          const propertyNames = Object.keys(tool.inputSchema.properties || {})
          required.forEach((req) => {
            expect(propertyNames).toContain(req)
          })
        })
      })

      it('should validate property types are valid JSON Schema types', () => {
        const validTypes = ['string', 'number', 'boolean', 'array', 'object', 'null', 'integer']
        gitTools.forEach((tool) => {
          const props = tool.inputSchema.properties || {}
          Object.entries(props).forEach(([key, schema]) => {
            expect(validTypes).toContain(schema.type)
          })
        })
      })

      it('should validate array properties have items defined', () => {
        gitTools.forEach((tool) => {
          const props = tool.inputSchema.properties || {}
          Object.entries(props).forEach(([key, schema]) => {
            if (schema.type === 'array') {
              expect(schema.items).toBeDefined()
              expect(schema.items?.type).toBeDefined()
            }
          })
        })
      })

      it('should validate enum values are non-empty arrays', () => {
        gitTools.forEach((tool) => {
          const props = tool.inputSchema.properties || {}
          Object.entries(props).forEach(([key, schema]) => {
            if (schema.enum !== undefined) {
              expect(Array.isArray(schema.enum)).toBe(true)
              expect(schema.enum.length).toBeGreaterThan(0)
            }
          })
        })
      })

      it('should validate number constraints are properly ordered', () => {
        gitTools.forEach((tool) => {
          const props = tool.inputSchema.properties || {}
          Object.entries(props).forEach(([key, schema]) => {
            if (schema.minimum !== undefined && schema.maximum !== undefined) {
              expect(schema.maximum).toBeGreaterThanOrEqual(schema.minimum)
            }
          })
        })
      })
    })

    describe('Schema property type validation', () => {
      it('should validate string property has correct type', () => {
        const gitStatus = gitTools.find((t) => t.name === 'git_status')
        expect(gitStatus).toBeDefined()
        expect(gitStatus!.inputSchema.properties?.path?.type).toBe('string')
      })

      it('should validate boolean property has correct type', () => {
        const gitStatus = gitTools.find((t) => t.name === 'git_status')
        expect(gitStatus).toBeDefined()
        expect(gitStatus!.inputSchema.properties?.short?.type).toBe('boolean')
      })

      it('should validate number property has correct type with constraints', () => {
        const gitLog = gitTools.find((t) => t.name === 'git_log')
        expect(gitLog).toBeDefined()
        expect(gitLog!.inputSchema.properties?.maxCount?.type).toBe('number')
        expect(gitLog!.inputSchema.properties?.maxCount?.minimum).toBeDefined()
      })

      it('should validate array property has items schema', () => {
        const gitAdd = gitTools.find((t) => t.name === 'git_add')
        expect(gitAdd).toBeDefined()
        expect(gitAdd!.inputSchema.properties?.files?.type).toBe('array')
        expect(gitAdd!.inputSchema.properties?.files?.items?.type).toBe('string')
      })

      it('should validate enum property has valid values', () => {
        const gitReset = gitTools.find((t) => t.name === 'git_reset')
        expect(gitReset).toBeDefined()
        expect(gitReset!.inputSchema.properties?.mode?.enum).toContain('soft')
        expect(gitReset!.inputSchema.properties?.mode?.enum).toContain('mixed')
        expect(gitReset!.inputSchema.properties?.mode?.enum).toContain('hard')
      })
    })

    describe('Schema compliance for specific tools', () => {
      it('git_commit should require message parameter', () => {
        const gitCommit = gitTools.find((t) => t.name === 'git_commit')
        expect(gitCommit).toBeDefined()
        expect(gitCommit!.inputSchema.required).toContain('message')
      })

      it('git_clone should require url parameter', () => {
        const gitClone = gitTools.find((t) => t.name === 'git_clone')
        expect(gitClone).toBeDefined()
        expect(gitClone!.inputSchema.required).toContain('url')
      })

      it('git_checkout should require ref parameter', () => {
        const gitCheckout = gitTools.find((t) => t.name === 'git_checkout')
        expect(gitCheckout).toBeDefined()
        expect(gitCheckout!.inputSchema.required).toContain('ref')
      })

      it('git_merge should require branch parameter', () => {
        const gitMerge = gitTools.find((t) => t.name === 'git_merge')
        expect(gitMerge).toBeDefined()
        expect(gitMerge!.inputSchema.required).toContain('branch')
      })

      it('git_init should require path parameter', () => {
        const gitInit = gitTools.find((t) => t.name === 'git_init')
        expect(gitInit).toBeDefined()
        expect(gitInit!.inputSchema.required).toContain('path')
      })
    })
  })

  // ==========================================================================
  // 2. INPUT PARAMETER VALIDATION
  // ==========================================================================
  describe('Input Parameter Validation', () => {
    describe('Required parameter validation', () => {
      it('should reject missing required parameters', () => {
        const tool: MCPTool = {
          name: 'test_required',
          description: 'Test required params',
          inputSchema: {
            type: 'object',
            properties: {
              requiredField: { type: 'string', description: 'Required field' },
              optionalField: { type: 'string', description: 'Optional field' },
            },
            required: ['requiredField'],
          },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        }

        const result = validateToolInput(tool, { optionalField: 'value' })
        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual(expect.stringMatching(/requiredField|required/i))
      })

      it('should accept when all required parameters are provided', () => {
        const tool: MCPTool = {
          name: 'test_required_valid',
          description: 'Test required params validation',
          inputSchema: {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'Message' },
            },
            required: ['message'],
          },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        }

        const result = validateToolInput(tool, { message: 'Hello' })
        expect(result.valid).toBe(true)
        expect(result.errors).toHaveLength(0)
      })

      it('should validate multiple required parameters', () => {
        const tool: MCPTool = {
          name: 'test_multi_required',
          description: 'Test multiple required params',
          inputSchema: {
            type: 'object',
            properties: {
              field1: { type: 'string', description: 'Field 1' },
              field2: { type: 'number', description: 'Field 2' },
              field3: { type: 'boolean', description: 'Field 3' },
            },
            required: ['field1', 'field2'],
          },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        }

        const result = validateToolInput(tool, { field3: true })
        expect(result.valid).toBe(false)
        expect(result.errors.length).toBeGreaterThanOrEqual(2)
      })
    })

    describe('Type validation', () => {
      it('should reject string when number expected', () => {
        const tool: MCPTool = {
          name: 'test_number_type',
          description: 'Test number type validation',
          inputSchema: {
            type: 'object',
            properties: {
              count: { type: 'number', description: 'Count' },
            },
          },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        }

        const result = validateToolInput(tool, { count: 'not a number' })
        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual(expect.stringMatching(/type|number|count/i))
      })

      it('should reject number when string expected', () => {
        const tool: MCPTool = {
          name: 'test_string_type',
          description: 'Test string type validation',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Name' },
            },
          },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        }

        const result = validateToolInput(tool, { name: 12345 })
        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual(expect.stringMatching(/type|string|name/i))
      })

      it('should reject non-boolean when boolean expected', () => {
        const tool: MCPTool = {
          name: 'test_boolean_type',
          description: 'Test boolean type validation',
          inputSchema: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean', description: 'Enabled' },
            },
          },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        }

        const result = validateToolInput(tool, { enabled: 'true' })
        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual(expect.stringMatching(/type|boolean|enabled/i))
      })

      it('should reject non-array when array expected', () => {
        const tool: MCPTool = {
          name: 'test_array_type',
          description: 'Test array type validation',
          inputSchema: {
            type: 'object',
            properties: {
              items: { type: 'array', items: { type: 'string' }, description: 'Items' },
            },
          },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        }

        const result = validateToolInput(tool, { items: 'not an array' })
        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual(expect.stringMatching(/type|array|items/i))
      })

      it('should validate array item types', () => {
        const tool: MCPTool = {
          name: 'test_array_items',
          description: 'Test array item type validation',
          inputSchema: {
            type: 'object',
            properties: {
              numbers: { type: 'array', items: { type: 'number' }, description: 'Numbers' },
            },
          },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        }

        const result = validateToolInput(tool, { numbers: [1, 'two', 3] })
        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual(expect.stringMatching(/array|item|type/i))
      })
    })

    describe('Constraint validation', () => {
      it('should reject value below minimum', () => {
        const tool: MCPTool = {
          name: 'test_min',
          description: 'Test minimum constraint',
          inputSchema: {
            type: 'object',
            properties: {
              count: { type: 'number', minimum: 1, description: 'Count' },
            },
          },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        }

        const result = validateToolInput(tool, { count: 0 })
        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual(expect.stringMatching(/minimum|count|1/i))
      })

      it('should reject value above maximum', () => {
        const tool: MCPTool = {
          name: 'test_max',
          description: 'Test maximum constraint',
          inputSchema: {
            type: 'object',
            properties: {
              count: { type: 'number', maximum: 100, description: 'Count' },
            },
          },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        }

        const result = validateToolInput(tool, { count: 101 })
        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual(expect.stringMatching(/maximum|count|100/i))
      })

      it('should accept value within range', () => {
        const tool: MCPTool = {
          name: 'test_range',
          description: 'Test range constraint',
          inputSchema: {
            type: 'object',
            properties: {
              count: { type: 'number', minimum: 1, maximum: 100, description: 'Count' },
            },
          },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        }

        const result = validateToolInput(tool, { count: 50 })
        expect(result.valid).toBe(true)
        expect(result.errors).toHaveLength(0)
      })

      it('should reject value not in enum', () => {
        const tool: MCPTool = {
          name: 'test_enum',
          description: 'Test enum constraint',
          inputSchema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['active', 'inactive'], description: 'Status' },
            },
          },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        }

        const result = validateToolInput(tool, { status: 'unknown' })
        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual(expect.stringMatching(/enum|status|unknown/i))
      })

      it('should accept value in enum', () => {
        const tool: MCPTool = {
          name: 'test_enum_valid',
          description: 'Test enum constraint valid',
          inputSchema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['active', 'inactive'], description: 'Status' },
            },
          },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        }

        const result = validateToolInput(tool, { status: 'active' })
        expect(result.valid).toBe(true)
        expect(result.errors).toHaveLength(0)
      })

      it('should validate string pattern if defined', () => {
        const tool: MCPTool = {
          name: 'test_pattern',
          description: 'Test pattern constraint',
          inputSchema: {
            type: 'object',
            properties: {
              email: { type: 'string', pattern: '^[^@]+@[^@]+\\.[^@]+$', description: 'Email' },
            },
          },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        }

        const invalidResult = validateToolInput(tool, { email: 'not-an-email' })
        expect(invalidResult.valid).toBe(false)

        const validResult = validateToolInput(tool, { email: 'test@example.com.ai' })
        expect(validResult.valid).toBe(true)
      })
    })

    describe('Git tool specific validation', () => {
      it('should validate git_commit requires message', () => {
        const gitCommit = gitTools.find((t) => t.name === 'git_commit')
        expect(gitCommit).toBeDefined()

        const result = validateToolInput(gitCommit!, { path: '/repo' })
        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual(expect.stringMatching(/message|required/i))
      })

      it('should validate git_clone requires url', () => {
        const gitClone = gitTools.find((t) => t.name === 'git_clone')
        expect(gitClone).toBeDefined()

        const result = validateToolInput(gitClone!, { destination: '/target' })
        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual(expect.stringMatching(/url|required/i))
      })

      it('should validate git_log maxCount is a positive number', () => {
        const gitLog = gitTools.find((t) => t.name === 'git_log')
        expect(gitLog).toBeDefined()

        const result = validateToolInput(gitLog!, { path: '/repo', maxCount: -5 })
        expect(result.valid).toBe(false)
      })
    })
  })

  // ==========================================================================
  // 3. TOOL HANDLER MAPPING
  // ==========================================================================
  describe('Tool Handler Mapping', () => {
    describe('Handler registration', () => {
      it('should register a tool with a handler', () => {
        const tool: MCPTool = {
          name: 'test_handler_reg',
          description: 'Test handler registration',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        }

        expect(() => registerTool(tool)).not.toThrow()
      })

      it('should throw when registering duplicate tool name', () => {
        const tool1: MCPTool = {
          name: 'duplicate_test_tool',
          description: 'First tool',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: 'first' }] }),
        }

        const tool2: MCPTool = {
          name: 'duplicate_test_tool',
          description: 'Second tool',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: 'second' }] }),
        }

        registerTool(tool1)
        expect(() => registerTool(tool2)).toThrow(/already exists|duplicate|registered/i)
      })

      it('should reject tools without handlers', () => {
        const toolWithoutHandler = {
          name: 'no_handler_tool',
          description: 'Tool without handler',
          inputSchema: { type: 'object', properties: {} },
        }

        expect(() => registerTool(toolWithoutHandler as MCPTool)).toThrow()
      })
    })

    describe('Handler invocation', () => {
      it('should invoke tool handler by name', async () => {
        const mockHandler = vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'invoked' }],
        })

        const tool: MCPTool = {
          name: 'invocation_test',
          description: 'Test invocation',
          inputSchema: { type: 'object', properties: {} },
          handler: mockHandler,
        }

        registerTool(tool)
        const result = await invokeTool('invocation_test', {})

        expect(mockHandler).toHaveBeenCalled()
        expect(result.content[0].text).toBe('invoked')
      })

      it('should pass parameters to handler', async () => {
        const mockHandler = vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'done' }],
        })

        const tool: MCPTool = {
          name: 'param_test',
          description: 'Test parameter passing',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path' },
              count: { type: 'number', description: 'Count' },
            },
          },
          handler: mockHandler,
        }

        registerTool(tool)
        await invokeTool('param_test', { path: '/test', count: 5 })

        expect(mockHandler).toHaveBeenCalledWith({ path: '/test', count: 5 })
      })

      it('should throw for non-existent tool', async () => {
        await expect(invokeTool('nonexistent_tool_xyz', {})).rejects.toThrow(
          /not found|does not exist|unknown/i
        )
      })

      it('should validate parameters before invoking handler', async () => {
        const mockHandler = vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'done' }],
        })

        const tool: MCPTool = {
          name: 'validation_before_invoke',
          description: 'Test validation before invocation',
          inputSchema: {
            type: 'object',
            properties: {
              required_field: { type: 'string', description: 'Required' },
            },
            required: ['required_field'],
          },
          handler: mockHandler,
        }

        registerTool(tool)
        await invokeTool('validation_before_invoke', {})

        expect(mockHandler).not.toHaveBeenCalled()
      })

      it('should return error result for invalid parameters', async () => {
        const tool: MCPTool = {
          name: 'invalid_param_test',
          description: 'Test invalid parameters',
          inputSchema: {
            type: 'object',
            properties: {
              required_field: { type: 'string', description: 'Required' },
            },
            required: ['required_field'],
          },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        }

        registerTool(tool)
        const result = await invokeTool('invalid_param_test', {})

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toMatch(/required_field|required|missing/i)
      })
    })

    describe('Handler error handling', () => {
      it('should catch handler exceptions and return error result', async () => {
        const tool: MCPTool = {
          name: 'throwing_handler',
          description: 'Handler that throws',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => {
            throw new Error('Handler exploded')
          },
        }

        registerTool(tool)
        const result = await invokeTool('throwing_handler', {})

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('Handler exploded')
      })

      it('should include tool name in error messages', async () => {
        try {
          await invokeTool('definitely_nonexistent_tool', {})
        } catch (error) {
          expect((error as Error).message).toContain('definitely_nonexistent_tool')
        }
      })

      it('should handle async rejections gracefully', async () => {
        const tool: MCPTool = {
          name: 'rejecting_handler',
          description: 'Handler that rejects',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => {
            return Promise.reject(new Error('Async rejection'))
          },
        }

        registerTool(tool)
        const result = await invokeTool('rejecting_handler', {})

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('Async rejection')
      })
    })

    describe('Handler result formatting', () => {
      it('should return text content correctly', async () => {
        const tool: MCPTool = {
          name: 'text_result',
          description: 'Returns text',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({
            content: [{ type: 'text', text: 'Hello World' }],
          }),
        }

        registerTool(tool)
        const result = await invokeTool('text_result', {})

        expect(result.content[0].type).toBe('text')
        expect(result.content[0].text).toBe('Hello World')
      })

      it('should return multiple content items', async () => {
        const tool: MCPTool = {
          name: 'multi_content',
          description: 'Returns multiple content items',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({
            content: [
              { type: 'text', text: 'First' },
              { type: 'text', text: 'Second' },
              { type: 'text', text: 'Third' },
            ],
          }),
        }

        registerTool(tool)
        const result = await invokeTool('multi_content', {})

        expect(result.content).toHaveLength(3)
      })

      it('should preserve isError flag from handler result', async () => {
        const tool: MCPTool = {
          name: 'error_flag_result',
          description: 'Returns error flag',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({
            content: [{ type: 'text', text: 'Something failed' }],
            isError: true,
          }),
        }

        registerTool(tool)
        const result = await invokeTool('error_flag_result', {})

        expect(result.isError).toBe(true)
      })
    })

    describe('Git tool handlers', () => {
      it('all git tools should have valid handlers', () => {
        gitTools.forEach((tool) => {
          expect(typeof tool.handler).toBe('function')
        })
      })

      it('git_status handler should be invokable', async () => {
        const result = await invokeTool('git_status', { path: '/test/repo' })
        expect(result).toBeDefined()
        expect(result.content).toBeDefined()
        expect(Array.isArray(result.content)).toBe(true)
      })

      it('git_log handler should accept maxCount parameter', async () => {
        const result = await invokeTool('git_log', {
          path: '/test/repo',
          maxCount: 10,
          oneline: true,
        })
        expect(result).toBeDefined()
        expect(result.content).toBeDefined()
      })

      it('git_diff handler should accept staged parameter', async () => {
        const result = await invokeTool('git_diff', {
          path: '/test/repo',
          staged: true,
        })
        expect(result).toBeDefined()
        expect(result.content).toBeDefined()
      })

      it('git_commit handler should require message', async () => {
        const result = await invokeTool('git_commit', {
          path: '/test/repo',
          // missing message
        })
        expect(result.isError).toBe(true)
      })
    })
  })

  // ==========================================================================
  // 4. DOCUMENTATION GENERATION
  // ==========================================================================
  describe('Documentation Generation', () => {
    describe('Tool metadata requirements', () => {
      it('all tools should have non-empty names', () => {
        expect(gitTools.length).toBeGreaterThan(0)
        gitTools.forEach((tool) => {
          expect(tool.name).toBeTruthy()
          expect(tool.name.length).toBeGreaterThan(0)
        })
      })

      it('all tools should have non-empty descriptions', () => {
        gitTools.forEach((tool) => {
          expect(tool.description).toBeTruthy()
          expect(tool.description.length).toBeGreaterThan(0)
        })
      })

      it('descriptions should be at least 20 characters', () => {
        gitTools.forEach((tool) => {
          expect(tool.description.length).toBeGreaterThanOrEqual(20)
        })
      })

      it('descriptions should start with capital letter', () => {
        gitTools.forEach((tool) => {
          expect(tool.description).toMatch(/^[A-Z]/)
        })
      })

      it('descriptions should not end with period (MCP convention)', () => {
        gitTools.forEach((tool) => {
          expect(tool.description).not.toMatch(/\.$/)
        })
      })

      it('descriptions should be actionable (describe what tool does)', () => {
        gitTools.forEach((tool) => {
          // Descriptions should contain a verb or action word
          const actionWords = [
            'get',
            'show',
            'list',
            'create',
            'delete',
            'update',
            'clone',
            'push',
            'pull',
            'fetch',
            'commit',
            'merge',
            'rebase',
            'checkout',
            'add',
            'reset',
            'stash',
            'tag',
          ]
          const lowerDesc = tool.description.toLowerCase()
          const hasAction = actionWords.some((word) => lowerDesc.includes(word))
          expect(hasAction).toBe(true)
        })
      })
    })

    describe('Property documentation', () => {
      it('all properties should have descriptions', () => {
        gitTools.forEach((tool) => {
          const props = tool.inputSchema.properties || {}
          Object.entries(props).forEach(([key, schema]) => {
            expect(schema.description).toBeDefined()
            expect(schema.description!.length).toBeGreaterThan(0)
          })
        })
      })

      it('property descriptions should be meaningful (at least 5 chars)', () => {
        gitTools.forEach((tool) => {
          const props = tool.inputSchema.properties || {}
          Object.entries(props).forEach(([key, schema]) => {
            expect(schema.description!.length).toBeGreaterThanOrEqual(5)
          })
        })
      })
    })

    describe('Tool naming conventions', () => {
      it('all tool names should start with git_', () => {
        gitTools.forEach((tool) => {
          expect(tool.name).toMatch(/^git_/)
        })
      })

      it('all tool names should use snake_case', () => {
        gitTools.forEach((tool) => {
          expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/)
        })
      })

      it('all tool names should be unique', () => {
        const names = gitTools.map((t) => t.name)
        const uniqueNames = new Set(names)
        expect(uniqueNames.size).toBe(names.length)
      })
    })

    describe('Documentation extraction', () => {
      it('listTools should return tools without handlers', () => {
        const tools = listTools()
        tools.forEach((tool) => {
          expect(tool).not.toHaveProperty('handler')
        })
      })

      it('listTools should include all required metadata', () => {
        const tools = listTools()
        expect(tools.length).toBeGreaterThan(0)
        tools.forEach((tool) => {
          expect(tool.name).toBeDefined()
          expect(tool.description).toBeDefined()
          expect(tool.inputSchema).toBeDefined()
        })
      })

      it('listed tools should have complete inputSchema', () => {
        const tools = listTools()
        tools.forEach((tool) => {
          expect(tool.inputSchema.type).toBe('object')
          expect(tool.inputSchema.properties).toBeDefined()
        })
      })
    })

    describe('Documentation for specific tools', () => {
      it('git_clone documentation should mention repository', () => {
        const gitClone = gitTools.find((t) => t.name === 'git_clone')
        expect(gitClone).toBeDefined()
        expect(gitClone!.description.toLowerCase()).toMatch(/clone|repository|repo/i)
      })

      it('git_commit documentation should mention changes or commit', () => {
        const gitCommit = gitTools.find((t) => t.name === 'git_commit')
        expect(gitCommit).toBeDefined()
        expect(gitCommit!.description.toLowerCase()).toMatch(/commit|change|record/i)
      })

      it('git_push documentation should mention remote', () => {
        const gitPush = gitTools.find((t) => t.name === 'git_push')
        expect(gitPush).toBeDefined()
        expect(gitPush!.description.toLowerCase()).toMatch(/push|remote|upload/i)
      })

      it('git_pull documentation should mention fetch or update', () => {
        const gitPull = gitTools.find((t) => t.name === 'git_pull')
        expect(gitPull).toBeDefined()
        expect(gitPull!.description.toLowerCase()).toMatch(/pull|fetch|update|remote/i)
      })
    })
  })

  // ==========================================================================
  // 5. TOOL DISCOVERY
  // ==========================================================================
  describe('Tool Discovery', () => {
    describe('List all tools', () => {
      it('should list all available tools', () => {
        const tools = listTools()
        expect(Array.isArray(tools)).toBe(true)
        expect(tools.length).toBeGreaterThan(0)
      })

      it('should include all git tools in listing', () => {
        const tools = listTools()
        const toolNames = tools.map((t) => t.name)

        const expectedTools = [
          'git_status',
          'git_log',
          'git_diff',
          'git_commit',
          'git_branch',
          'git_checkout',
          'git_push',
          'git_pull',
          'git_clone',
          'git_fetch',
          'git_init',
          'git_add',
          'git_reset',
          'git_merge',
          'git_rebase',
          'git_stash',
          'git_tag',
          'git_remote',
        ]

        expectedTools.forEach((expected) => {
          expect(toolNames).toContain(expected)
        })
      })

      it('should return consistent results on multiple calls', () => {
        const tools1 = listTools()
        const tools2 = listTools()

        expect(tools1.length).toBe(tools2.length)
        tools1.forEach((tool, index) => {
          expect(tool.name).toBe(tools2[index].name)
        })
      })
    })

    describe('Get tool by name', () => {
      it('should get tool by exact name', () => {
        const tool = getTool('git_status')
        expect(tool).toBeDefined()
        expect(tool?.name).toBe('git_status')
      })

      it('should return undefined for non-existent tool', () => {
        const tool = getTool('nonexistent_tool')
        expect(tool).toBeUndefined()
      })

      it('should return complete tool definition with handler', () => {
        const tool = getTool('git_status')
        expect(tool).toBeDefined()
        expect(tool?.name).toBeDefined()
        expect(tool?.description).toBeDefined()
        expect(tool?.inputSchema).toBeDefined()
        expect(typeof tool?.handler).toBe('function')
      })

      it('should be case sensitive', () => {
        const lowercase = getTool('git_status')
        const uppercase = getTool('GIT_STATUS')

        expect(lowercase).toBeDefined()
        expect(uppercase).toBeUndefined()
      })
    })

    describe('Tool count and coverage', () => {
      it('should have at least 18 git tools defined', () => {
        expect(gitTools.length).toBeGreaterThanOrEqual(18)
      })

      it('should cover basic git operations', () => {
        const toolNames = gitTools.map((t) => t.name)

        // Basic operations
        expect(toolNames).toContain('git_init')
        expect(toolNames).toContain('git_clone')
        expect(toolNames).toContain('git_status')
      })

      it('should cover staging operations', () => {
        const toolNames = gitTools.map((t) => t.name)

        expect(toolNames).toContain('git_add')
        expect(toolNames).toContain('git_reset')
      })

      it('should cover history operations', () => {
        const toolNames = gitTools.map((t) => t.name)

        expect(toolNames).toContain('git_log')
        expect(toolNames).toContain('git_diff')
        expect(toolNames).toContain('git_commit')
      })

      it('should cover branch operations', () => {
        const toolNames = gitTools.map((t) => t.name)

        expect(toolNames).toContain('git_branch')
        expect(toolNames).toContain('git_checkout')
        expect(toolNames).toContain('git_merge')
        expect(toolNames).toContain('git_rebase')
      })

      it('should cover remote operations', () => {
        const toolNames = gitTools.map((t) => t.name)

        expect(toolNames).toContain('git_push')
        expect(toolNames).toContain('git_pull')
        expect(toolNames).toContain('git_fetch')
        expect(toolNames).toContain('git_remote')
      })

      it('should cover utility operations', () => {
        const toolNames = gitTools.map((t) => t.name)

        expect(toolNames).toContain('git_stash')
        expect(toolNames).toContain('git_tag')
      })
    })

    describe('Tool discovery for automation', () => {
      it('should allow filtering tools by pattern', () => {
        const tools = listTools()
        const branchTools = tools.filter(
          (t) =>
            t.name.includes('branch') || t.name.includes('checkout') || t.name.includes('merge')
        )

        expect(branchTools.length).toBeGreaterThanOrEqual(3)
      })

      it('should allow finding tools with specific parameter', () => {
        const tools = listTools()
        const toolsWithPath = tools.filter((t) => t.inputSchema.properties?.path !== undefined)

        // Most git tools should have a path parameter
        expect(toolsWithPath.length).toBeGreaterThan(10)
      })

      it('should allow finding tools with required parameters', () => {
        const tools = listTools()
        const toolsWithRequired = tools.filter((t) => (t.inputSchema.required || []).length > 0)

        expect(toolsWithRequired.length).toBeGreaterThan(0)
      })
    })

    describe('Dynamic tool registration discovery', () => {
      it('should discover newly registered tools', () => {
        const initialCount = listTools().length

        const newTool: MCPTool = {
          name: 'git_custom_discovery_test',
          description: 'Custom tool for discovery testing',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
        }

        registerTool(newTool)

        const newCount = listTools().length
        expect(newCount).toBe(initialCount + 1)

        const found = getTool('git_custom_discovery_test')
        expect(found).toBeDefined()
      })

      it('newly registered tools should be immediately available', () => {
        const toolName = 'git_immediate_discovery_test'

        const tool: MCPTool = {
          name: toolName,
          description: 'Test immediate discovery',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: 'immediate' }] }),
        }

        registerTool(tool)

        // Should be findable immediately
        const found = getTool(toolName)
        expect(found).toBeDefined()
        expect(found?.name).toBe(toolName)
      })
    })
  })

  // ==========================================================================
  // ADDITIONAL: Complete Tool Definition Tests
  // ==========================================================================
  describe('Complete Tool Definitions', () => {
    describe('git_clone tool', () => {
      it('should be defined with all expected properties', () => {
        const gitClone = gitTools.find((t) => t.name === 'git_clone')
        expect(gitClone).toBeDefined()
        expect(gitClone!.inputSchema.properties?.url).toBeDefined()
        expect(gitClone!.inputSchema.properties?.destination).toBeDefined()
        expect(gitClone!.inputSchema.properties?.depth).toBeDefined()
        expect(gitClone!.inputSchema.properties?.branch).toBeDefined()
        expect(gitClone!.inputSchema.properties?.bare).toBeDefined()
      })
    })

    describe('git_init tool', () => {
      it('should be defined with all expected properties', () => {
        const gitInit = gitTools.find((t) => t.name === 'git_init')
        expect(gitInit).toBeDefined()
        expect(gitInit!.inputSchema.properties?.path).toBeDefined()
        expect(gitInit!.inputSchema.properties?.bare).toBeDefined()
        expect(gitInit!.inputSchema.properties?.initialBranch).toBeDefined()
      })
    })

    describe('git_add tool', () => {
      it('should be defined with all expected properties', () => {
        const gitAdd = gitTools.find((t) => t.name === 'git_add')
        expect(gitAdd).toBeDefined()
        expect(gitAdd!.inputSchema.properties?.path).toBeDefined()
        expect(gitAdd!.inputSchema.properties?.files).toBeDefined()
        expect(gitAdd!.inputSchema.properties?.all).toBeDefined()
        expect(gitAdd!.inputSchema.properties?.force).toBeDefined()
      })
    })

    describe('git_reset tool', () => {
      it('should be defined with all expected properties', () => {
        const gitReset = gitTools.find((t) => t.name === 'git_reset')
        expect(gitReset).toBeDefined()
        expect(gitReset!.inputSchema.properties?.path).toBeDefined()
        expect(gitReset!.inputSchema.properties?.mode).toBeDefined()
        expect(gitReset!.inputSchema.properties?.commit).toBeDefined()
      })
    })

    describe('git_merge tool', () => {
      it('should be defined with all expected properties', () => {
        const gitMerge = gitTools.find((t) => t.name === 'git_merge')
        expect(gitMerge).toBeDefined()
        expect(gitMerge!.inputSchema.properties?.path).toBeDefined()
        expect(gitMerge!.inputSchema.properties?.branch).toBeDefined()
        expect(gitMerge!.inputSchema.properties?.noFf).toBeDefined()
        expect(gitMerge!.inputSchema.properties?.squash).toBeDefined()
      })
    })

    describe('git_rebase tool', () => {
      it('should be defined with all expected properties', () => {
        const gitRebase = gitTools.find((t) => t.name === 'git_rebase')
        expect(gitRebase).toBeDefined()
        expect(gitRebase!.inputSchema.properties?.path).toBeDefined()
        expect(gitRebase!.inputSchema.properties?.onto).toBeDefined()
        expect(gitRebase!.inputSchema.properties?.abort).toBeDefined()
        expect(gitRebase!.inputSchema.properties?.continue).toBeDefined()
      })
    })

    describe('git_stash tool', () => {
      it('should be defined with all expected properties', () => {
        const gitStash = gitTools.find((t) => t.name === 'git_stash')
        expect(gitStash).toBeDefined()
        expect(gitStash!.inputSchema.properties?.path).toBeDefined()
        expect(gitStash!.inputSchema.properties?.action).toBeDefined()
        expect(gitStash!.inputSchema.properties?.message).toBeDefined()
      })
    })

    describe('git_tag tool', () => {
      it('should be defined with all expected properties', () => {
        const gitTag = gitTools.find((t) => t.name === 'git_tag')
        expect(gitTag).toBeDefined()
        expect(gitTag!.inputSchema.properties?.path).toBeDefined()
        expect(gitTag!.inputSchema.properties?.name).toBeDefined()
        expect(gitTag!.inputSchema.properties?.message).toBeDefined()
        expect(gitTag!.inputSchema.properties?.delete).toBeDefined()
      })
    })

    describe('git_remote tool', () => {
      it('should be defined with all expected properties', () => {
        const gitRemote = gitTools.find((t) => t.name === 'git_remote')
        expect(gitRemote).toBeDefined()
        expect(gitRemote!.inputSchema.properties?.path).toBeDefined()
        expect(gitRemote!.inputSchema.properties?.action).toBeDefined()
        expect(gitRemote!.inputSchema.properties?.name).toBeDefined()
        expect(gitRemote!.inputSchema.properties?.url).toBeDefined()
      })
    })

    describe('git_fetch tool', () => {
      it('should be defined with all expected properties', () => {
        const gitFetch = gitTools.find((t) => t.name === 'git_fetch')
        expect(gitFetch).toBeDefined()
        expect(gitFetch!.inputSchema.properties?.path).toBeDefined()
        expect(gitFetch!.inputSchema.properties?.remote).toBeDefined()
        expect(gitFetch!.inputSchema.properties?.all).toBeDefined()
        expect(gitFetch!.inputSchema.properties?.prune).toBeDefined()
      })
    })
  })
})
