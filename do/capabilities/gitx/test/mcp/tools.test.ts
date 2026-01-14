import { describe, it, expect, beforeEach } from 'vitest'
import {
  MCPTool,
  MCPToolResult,
  MCPToolHandler,
  JSONSchema,
  gitTools,
  registerTool,
  invokeTool,
  validateToolInput,
  listTools,
  getTool,
} from '../../src/mcp/tools'

describe('MCP Git Tool Definitions', () => {
  describe('Type definitions', () => {
    it('should have MCPTool interface with required properties', () => {
      const tool: MCPTool = {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        handler: async () => ({ content: [{ type: 'text', text: 'result' }] }),
      }

      expect(tool.name).toBe('test_tool')
      expect(tool.description).toBe('A test tool')
      expect(tool.inputSchema).toBeDefined()
      expect(typeof tool.handler).toBe('function')
    })

    it('should have MCPToolResult interface with content array', () => {
      const result: MCPToolResult = {
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'image', data: 'base64...', mimeType: 'image/png' },
        ],
        isError: false,
      }

      expect(result.content).toHaveLength(2)
      expect(result.content[0].type).toBe('text')
      expect(result.content[1].type).toBe('image')
      expect(result.isError).toBe(false)
    })

    it('should have JSONSchema interface with common schema properties', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The name' },
          count: { type: 'number', minimum: 0, maximum: 100 },
          tags: { type: 'array', items: { type: 'string' } },
          status: { type: 'string', enum: ['active', 'inactive'] },
        },
        required: ['name'],
      }

      expect(schema.type).toBe('object')
      expect(schema.properties).toBeDefined()
      expect(schema.required).toContain('name')
    })
  })

  describe('Tool definition schema validation', () => {
    describe('git_status tool', () => {
      it('should have git_status tool defined in gitTools', () => {
        const gitStatus = gitTools.find((t) => t.name === 'git_status')
        expect(gitStatus).toBeDefined()
      })

      it('should have correct schema for git_status', () => {
        const gitStatus = gitTools.find((t) => t.name === 'git_status')!
        expect(gitStatus.inputSchema.type).toBe('object')
        expect(gitStatus.inputSchema.properties).toHaveProperty('path')
        expect(gitStatus.description).toContain('status')
      })

      it('should have optional short parameter for git_status', () => {
        const gitStatus = gitTools.find((t) => t.name === 'git_status')!
        expect(gitStatus.inputSchema.properties).toHaveProperty('short')
        expect(gitStatus.inputSchema.properties?.short?.type).toBe('boolean')
      })
    })

    describe('git_log tool', () => {
      it('should have git_log tool defined in gitTools', () => {
        const gitLog = gitTools.find((t) => t.name === 'git_log')
        expect(gitLog).toBeDefined()
      })

      it('should have correct schema for git_log', () => {
        const gitLog = gitTools.find((t) => t.name === 'git_log')!
        expect(gitLog.inputSchema.type).toBe('object')
        expect(gitLog.inputSchema.properties).toHaveProperty('path')
        expect(gitLog.inputSchema.properties).toHaveProperty('maxCount')
        expect(gitLog.description).toContain('log')
      })

      it('should have oneline parameter for git_log', () => {
        const gitLog = gitTools.find((t) => t.name === 'git_log')!
        expect(gitLog.inputSchema.properties).toHaveProperty('oneline')
        expect(gitLog.inputSchema.properties?.oneline?.type).toBe('boolean')
      })

      it('should have ref parameter for git_log', () => {
        const gitLog = gitTools.find((t) => t.name === 'git_log')!
        expect(gitLog.inputSchema.properties).toHaveProperty('ref')
        expect(gitLog.inputSchema.properties?.ref?.type).toBe('string')
      })
    })

    describe('git_diff tool', () => {
      it('should have git_diff tool defined in gitTools', () => {
        const gitDiff = gitTools.find((t) => t.name === 'git_diff')
        expect(gitDiff).toBeDefined()
      })

      it('should have correct schema for git_diff', () => {
        const gitDiff = gitTools.find((t) => t.name === 'git_diff')!
        expect(gitDiff.inputSchema.type).toBe('object')
        expect(gitDiff.inputSchema.properties).toHaveProperty('path')
        expect(gitDiff.description).toContain('diff')
      })

      it('should have staged parameter for git_diff', () => {
        const gitDiff = gitTools.find((t) => t.name === 'git_diff')!
        expect(gitDiff.inputSchema.properties).toHaveProperty('staged')
        expect(gitDiff.inputSchema.properties?.staged?.type).toBe('boolean')
      })

      it('should have commit parameters for git_diff', () => {
        const gitDiff = gitTools.find((t) => t.name === 'git_diff')!
        expect(gitDiff.inputSchema.properties).toHaveProperty('commit1')
        expect(gitDiff.inputSchema.properties).toHaveProperty('commit2')
      })
    })

    describe('git_commit tool', () => {
      it('should have git_commit tool defined in gitTools', () => {
        const gitCommit = gitTools.find((t) => t.name === 'git_commit')
        expect(gitCommit).toBeDefined()
      })

      it('should have correct schema for git_commit', () => {
        const gitCommit = gitTools.find((t) => t.name === 'git_commit')!
        expect(gitCommit.inputSchema.type).toBe('object')
        expect(gitCommit.inputSchema.properties).toHaveProperty('path')
        expect(gitCommit.inputSchema.properties).toHaveProperty('message')
        expect(gitCommit.description).toContain('commit')
      })

      it('should require message parameter for git_commit', () => {
        const gitCommit = gitTools.find((t) => t.name === 'git_commit')!
        expect(gitCommit.inputSchema.required).toContain('message')
      })

      it('should have author parameters for git_commit', () => {
        const gitCommit = gitTools.find((t) => t.name === 'git_commit')!
        expect(gitCommit.inputSchema.properties).toHaveProperty('author')
        expect(gitCommit.inputSchema.properties).toHaveProperty('email')
      })

      it('should have amend parameter for git_commit', () => {
        const gitCommit = gitTools.find((t) => t.name === 'git_commit')!
        expect(gitCommit.inputSchema.properties).toHaveProperty('amend')
        expect(gitCommit.inputSchema.properties?.amend?.type).toBe('boolean')
      })
    })

    describe('git_branch tool', () => {
      it('should have git_branch tool defined in gitTools', () => {
        const gitBranch = gitTools.find((t) => t.name === 'git_branch')
        expect(gitBranch).toBeDefined()
      })

      it('should have correct schema for git_branch', () => {
        const gitBranch = gitTools.find((t) => t.name === 'git_branch')!
        expect(gitBranch.inputSchema.type).toBe('object')
        expect(gitBranch.inputSchema.properties).toHaveProperty('path')
        expect(gitBranch.description).toContain('branch')
      })

      it('should have list parameter for git_branch', () => {
        const gitBranch = gitTools.find((t) => t.name === 'git_branch')!
        expect(gitBranch.inputSchema.properties).toHaveProperty('list')
        expect(gitBranch.inputSchema.properties?.list?.type).toBe('boolean')
      })

      it('should have create/delete parameters for git_branch', () => {
        const gitBranch = gitTools.find((t) => t.name === 'git_branch')!
        expect(gitBranch.inputSchema.properties).toHaveProperty('name')
        expect(gitBranch.inputSchema.properties).toHaveProperty('delete')
      })

      it('should have all flag for listing remote branches', () => {
        const gitBranch = gitTools.find((t) => t.name === 'git_branch')!
        expect(gitBranch.inputSchema.properties).toHaveProperty('all')
        expect(gitBranch.inputSchema.properties?.all?.type).toBe('boolean')
      })
    })

    describe('git_checkout tool', () => {
      it('should have git_checkout tool defined in gitTools', () => {
        const gitCheckout = gitTools.find((t) => t.name === 'git_checkout')
        expect(gitCheckout).toBeDefined()
      })

      it('should have correct schema for git_checkout', () => {
        const gitCheckout = gitTools.find((t) => t.name === 'git_checkout')!
        expect(gitCheckout.inputSchema.type).toBe('object')
        expect(gitCheckout.inputSchema.properties).toHaveProperty('path')
        expect(gitCheckout.inputSchema.properties).toHaveProperty('ref')
        expect(gitCheckout.description).toContain('checkout')
      })

      it('should require ref parameter for git_checkout', () => {
        const gitCheckout = gitTools.find((t) => t.name === 'git_checkout')!
        expect(gitCheckout.inputSchema.required).toContain('ref')
      })

      it('should have createBranch parameter for git_checkout', () => {
        const gitCheckout = gitTools.find((t) => t.name === 'git_checkout')!
        expect(gitCheckout.inputSchema.properties).toHaveProperty('createBranch')
        expect(gitCheckout.inputSchema.properties?.createBranch?.type).toBe('boolean')
      })
    })

    describe('git_push tool', () => {
      it('should have git_push tool defined in gitTools', () => {
        const gitPush = gitTools.find((t) => t.name === 'git_push')
        expect(gitPush).toBeDefined()
      })

      it('should have correct schema for git_push', () => {
        const gitPush = gitTools.find((t) => t.name === 'git_push')!
        expect(gitPush.inputSchema.type).toBe('object')
        expect(gitPush.inputSchema.properties).toHaveProperty('path')
        expect(gitPush.description).toContain('push')
      })

      it('should have remote and branch parameters for git_push', () => {
        const gitPush = gitTools.find((t) => t.name === 'git_push')!
        expect(gitPush.inputSchema.properties).toHaveProperty('remote')
        expect(gitPush.inputSchema.properties).toHaveProperty('branch')
      })

      it('should have force parameter for git_push', () => {
        const gitPush = gitTools.find((t) => t.name === 'git_push')!
        expect(gitPush.inputSchema.properties).toHaveProperty('force')
        expect(gitPush.inputSchema.properties?.force?.type).toBe('boolean')
      })

      it('should have setUpstream parameter for git_push', () => {
        const gitPush = gitTools.find((t) => t.name === 'git_push')!
        expect(gitPush.inputSchema.properties).toHaveProperty('setUpstream')
        expect(gitPush.inputSchema.properties?.setUpstream?.type).toBe('boolean')
      })
    })

    describe('git_pull tool', () => {
      it('should have git_pull tool defined in gitTools', () => {
        const gitPull = gitTools.find((t) => t.name === 'git_pull')
        expect(gitPull).toBeDefined()
      })

      it('should have correct schema for git_pull', () => {
        const gitPull = gitTools.find((t) => t.name === 'git_pull')!
        expect(gitPull.inputSchema.type).toBe('object')
        expect(gitPull.inputSchema.properties).toHaveProperty('path')
        expect(gitPull.description).toContain('pull')
      })

      it('should have remote and branch parameters for git_pull', () => {
        const gitPull = gitTools.find((t) => t.name === 'git_pull')!
        expect(gitPull.inputSchema.properties).toHaveProperty('remote')
        expect(gitPull.inputSchema.properties).toHaveProperty('branch')
      })

      it('should have rebase parameter for git_pull', () => {
        const gitPull = gitTools.find((t) => t.name === 'git_pull')!
        expect(gitPull.inputSchema.properties).toHaveProperty('rebase')
        expect(gitPull.inputSchema.properties?.rebase?.type).toBe('boolean')
      })
    })

    describe('git_clone tool', () => {
      it('should have git_clone tool defined in gitTools', () => {
        const gitClone = gitTools.find((t) => t.name === 'git_clone')
        expect(gitClone).toBeDefined()
      })

      it('should have correct schema for git_clone', () => {
        const gitClone = gitTools.find((t) => t.name === 'git_clone')!
        expect(gitClone.inputSchema.type).toBe('object')
        expect(gitClone.inputSchema.properties).toHaveProperty('url')
        expect(gitClone.inputSchema.properties).toHaveProperty('destination')
        expect(gitClone.description).toContain('clone')
      })

      it('should require url parameter for git_clone', () => {
        const gitClone = gitTools.find((t) => t.name === 'git_clone')!
        expect(gitClone.inputSchema.required).toContain('url')
      })

      it('should have depth parameter for git_clone', () => {
        const gitClone = gitTools.find((t) => t.name === 'git_clone')!
        expect(gitClone.inputSchema.properties).toHaveProperty('depth')
        expect(gitClone.inputSchema.properties?.depth?.type).toBe('number')
      })

      it('should have branch parameter for git_clone', () => {
        const gitClone = gitTools.find((t) => t.name === 'git_clone')!
        expect(gitClone.inputSchema.properties).toHaveProperty('branch')
        expect(gitClone.inputSchema.properties?.branch?.type).toBe('string')
      })
    })
  })

  describe('Tool registration and listing', () => {
    it('should register a tool successfully', () => {
      const tool: MCPTool = {
        name: 'custom_tool',
        description: 'A custom tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
      }

      expect(() => registerTool(tool)).not.toThrow()
    })

    it('should throw error when registering duplicate tool', () => {
      const tool: MCPTool = {
        name: 'duplicate_tool',
        description: 'First tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ content: [{ type: 'text', text: 'first' }] }),
      }

      registerTool(tool)

      const duplicateTool: MCPTool = {
        name: 'duplicate_tool',
        description: 'Second tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ content: [{ type: 'text', text: 'second' }] }),
      }

      expect(() => registerTool(duplicateTool)).toThrow(/already exists|duplicate/i)
    })

    it('should list all registered tools', () => {
      const tools = listTools()
      expect(Array.isArray(tools)).toBe(true)
      expect(tools.length).toBeGreaterThan(0)
    })

    it('should include all git tools in listing', () => {
      const tools = listTools()
      const toolNames = tools.map((t) => t.name)

      expect(toolNames).toContain('git_status')
      expect(toolNames).toContain('git_log')
      expect(toolNames).toContain('git_diff')
      expect(toolNames).toContain('git_commit')
      expect(toolNames).toContain('git_branch')
      expect(toolNames).toContain('git_checkout')
      expect(toolNames).toContain('git_push')
      expect(toolNames).toContain('git_pull')
      expect(toolNames).toContain('git_clone')
    })

    it('should not include handler in listed tools', () => {
      const tools = listTools()
      tools.forEach((tool) => {
        expect(tool).not.toHaveProperty('handler')
      })
    })

    it('should get tool by name', () => {
      const tool = getTool('git_status')
      expect(tool).toBeDefined()
      expect(tool?.name).toBe('git_status')
    })

    it('should return undefined for non-existent tool', () => {
      const tool = getTool('nonexistent_tool')
      expect(tool).toBeUndefined()
    })
  })

  describe('Tool parameter validation', () => {
    it('should validate required parameters', () => {
      const tool: MCPTool = {
        name: 'test_required',
        description: 'Test required params',
        inputSchema: {
          type: 'object',
          properties: {
            requiredParam: { type: 'string' },
          },
          required: ['requiredParam'],
        },
        handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
      }

      const result = validateToolInput(tool, {})
      expect(result.valid).toBe(false)
      expect(result.errors).toContainEqual(expect.stringMatching(/requiredParam|required/i))
    })

    it('should validate parameter types', () => {
      const tool: MCPTool = {
        name: 'test_types',
        description: 'Test type validation',
        inputSchema: {
          type: 'object',
          properties: {
            stringParam: { type: 'string' },
            numberParam: { type: 'number' },
            boolParam: { type: 'boolean' },
          },
        },
        handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
      }

      const result = validateToolInput(tool, {
        stringParam: 123,
        numberParam: 'not a number',
        boolParam: 'not a boolean',
      })

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should pass valid parameters', () => {
      const tool: MCPTool = {
        name: 'test_valid',
        description: 'Test valid params',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            count: { type: 'number' },
          },
          required: ['message'],
        },
        handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
      }

      const result = validateToolInput(tool, {
        message: 'Hello',
        count: 42,
      })

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should validate enum values', () => {
      const tool: MCPTool = {
        name: 'test_enum',
        description: 'Test enum validation',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['active', 'inactive', 'pending'] },
          },
        },
        handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
      }

      const invalidResult = validateToolInput(tool, { status: 'invalid' })
      expect(invalidResult.valid).toBe(false)

      const validResult = validateToolInput(tool, { status: 'active' })
      expect(validResult.valid).toBe(true)
    })

    it('should validate number constraints', () => {
      const tool: MCPTool = {
        name: 'test_number_constraints',
        description: 'Test number constraints',
        inputSchema: {
          type: 'object',
          properties: {
            count: { type: 'number', minimum: 1, maximum: 100 },
          },
        },
        handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
      }

      const belowMin = validateToolInput(tool, { count: 0 })
      expect(belowMin.valid).toBe(false)

      const aboveMax = validateToolInput(tool, { count: 101 })
      expect(aboveMax.valid).toBe(false)

      const validRange = validateToolInput(tool, { count: 50 })
      expect(validRange.valid).toBe(true)
    })

    it('should validate array parameters', () => {
      const tool: MCPTool = {
        name: 'test_array',
        description: 'Test array validation',
        inputSchema: {
          type: 'object',
          properties: {
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
        handler: async () => ({ content: [{ type: 'text', text: 'done' }] }),
      }

      const invalidResult = validateToolInput(tool, { tags: 'not an array' })
      expect(invalidResult.valid).toBe(false)

      const invalidItemsResult = validateToolInput(tool, { tags: [1, 2, 3] })
      expect(invalidItemsResult.valid).toBe(false)

      const validResult = validateToolInput(tool, { tags: ['tag1', 'tag2'] })
      expect(validResult.valid).toBe(true)
    })

    it('should validate git_commit parameters', () => {
      const gitCommit = gitTools.find((t) => t.name === 'git_commit')!

      const missingMessage = validateToolInput(gitCommit, { path: '/repo' })
      expect(missingMessage.valid).toBe(false)

      const validParams = validateToolInput(gitCommit, {
        path: '/repo',
        message: 'Initial commit',
      })
      expect(validParams.valid).toBe(true)
    })

    it('should validate git_clone parameters', () => {
      const gitClone = gitTools.find((t) => t.name === 'git_clone')!

      const missingUrl = validateToolInput(gitClone, { destination: '/target' })
      expect(missingUrl.valid).toBe(false)

      const validParams = validateToolInput(gitClone, {
        url: 'https://github.com/user/repo.git',
        destination: '/target',
      })
      expect(validParams.valid).toBe(true)
    })
  })

  describe('Tool result formatting', () => {
    it('should format text results correctly', async () => {
      const result: MCPToolResult = {
        content: [
          {
            type: 'text',
            text: 'On branch main\nnothing to commit, working tree clean',
          },
        ],
      }

      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toBeDefined()
    })

    it('should format error results with isError flag', async () => {
      const result: MCPToolResult = {
        content: [
          {
            type: 'text',
            text: 'fatal: not a git repository',
          },
        ],
        isError: true,
      }

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('fatal')
    })

    it('should support multiple content items in result', async () => {
      const result: MCPToolResult = {
        content: [
          { type: 'text', text: 'Changes staged:' },
          { type: 'text', text: '- file1.ts' },
          { type: 'text', text: '- file2.ts' },
        ],
      }

      expect(result.content).toHaveLength(3)
    })

    it('should support resource content type', async () => {
      const result: MCPToolResult = {
        content: [
          {
            type: 'resource',
            data: 'base64encodeddata',
            mimeType: 'application/octet-stream',
          },
        ],
      }

      expect(result.content[0].type).toBe('resource')
      expect(result.content[0].mimeType).toBeDefined()
    })
  })

  describe('Tool invocation', () => {
    it('should invoke git_status tool', async () => {
      const result = await invokeTool('git_status', { path: '/test/repo' })

      expect(result).toBeDefined()
      expect(result.content).toBeDefined()
      expect(Array.isArray(result.content)).toBe(true)
    })

    it('should invoke git_log tool with parameters', async () => {
      const result = await invokeTool('git_log', {
        path: '/test/repo',
        maxCount: 10,
        oneline: true,
      })

      expect(result).toBeDefined()
      expect(result.content).toBeDefined()
    })

    it('should invoke git_diff tool', async () => {
      const result = await invokeTool('git_diff', {
        path: '/test/repo',
        staged: true,
      })

      expect(result).toBeDefined()
      expect(result.content).toBeDefined()
    })

    it('should invoke git_commit tool', async () => {
      const result = await invokeTool('git_commit', {
        path: '/test/repo',
        message: 'Test commit',
      })

      expect(result).toBeDefined()
      expect(result.content).toBeDefined()
    })

    it('should invoke git_branch tool', async () => {
      const result = await invokeTool('git_branch', {
        path: '/test/repo',
        list: true,
      })

      expect(result).toBeDefined()
      expect(result.content).toBeDefined()
    })

    it('should invoke git_checkout tool', async () => {
      const result = await invokeTool('git_checkout', {
        path: '/test/repo',
        ref: 'main',
      })

      expect(result).toBeDefined()
      expect(result.content).toBeDefined()
    })

    it('should invoke git_push tool', async () => {
      const result = await invokeTool('git_push', {
        path: '/test/repo',
        remote: 'origin',
        branch: 'main',
      })

      expect(result).toBeDefined()
      expect(result.content).toBeDefined()
    })

    it('should invoke git_pull tool', async () => {
      const result = await invokeTool('git_pull', {
        path: '/test/repo',
        remote: 'origin',
      })

      expect(result).toBeDefined()
      expect(result.content).toBeDefined()
    })

    it('should invoke git_clone tool', async () => {
      const result = await invokeTool('git_clone', {
        url: 'https://github.com/user/repo.git',
        destination: '/target',
      })

      expect(result).toBeDefined()
      expect(result.content).toBeDefined()
    })
  })

  describe('Error handling for invalid tool calls', () => {
    it('should throw error for non-existent tool', async () => {
      await expect(invokeTool('nonexistent_tool', {})).rejects.toThrow(
        /not found|unknown tool|does not exist/i
      )
    })

    it('should return error result for invalid parameters', async () => {
      const result = await invokeTool('git_commit', {
        path: '/test/repo',
        // missing required 'message' parameter
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/missing|required|message/i)
    })

    it('should return error result for type mismatch', async () => {
      const result = await invokeTool('git_log', {
        path: '/test/repo',
        maxCount: 'not a number',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/type|invalid|number/i)
    })

    it('should handle handler exceptions gracefully', async () => {
      const tool: MCPTool = {
        name: 'failing_tool',
        description: 'A tool that fails',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          throw new Error('Handler failed')
        },
      }

      registerTool(tool)

      const result = await invokeTool('failing_tool', {})
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Handler failed')
    })

    it('should validate parameters before invoking handler', async () => {
      const handlerCalled = { value: false }
      const tool: MCPTool = {
        name: 'validation_test_tool',
        description: 'Test validation before invocation',
        inputSchema: {
          type: 'object',
          properties: {
            required_field: { type: 'string' },
          },
          required: ['required_field'],
        },
        handler: async () => {
          handlerCalled.value = true
          return { content: [{ type: 'text', text: 'done' }] }
        },
      }

      registerTool(tool)

      await invokeTool('validation_test_tool', {})

      expect(handlerCalled.value).toBe(false)
    })

    it('should include tool name in error messages', async () => {
      try {
        await invokeTool('definitely_not_a_real_tool', {})
      } catch (error) {
        expect((error as Error).message).toContain('definitely_not_a_real_tool')
      }
    })
  })

  describe('Complete git tools array', () => {
    it('should have exactly 22 git tools defined', () => {
      expect(gitTools).toHaveLength(22)
    })

    it('should have unique tool names', () => {
      const names = gitTools.map((t) => t.name)
      const uniqueNames = new Set(names)
      expect(uniqueNames.size).toBe(names.length)
    })

    it('should have non-empty descriptions for all tools', () => {
      gitTools.forEach((tool) => {
        expect(tool.description).toBeTruthy()
        expect(tool.description.length).toBeGreaterThan(10)
      })
    })

    it('should have valid input schemas for all tools', () => {
      gitTools.forEach((tool) => {
        expect(tool.inputSchema.type).toBe('object')
        expect(tool.inputSchema.properties).toBeDefined()
      })
    })

    it('should have handlers defined for all tools', () => {
      gitTools.forEach((tool) => {
        expect(typeof tool.handler).toBe('function')
      })
    })

    it('should have path property in all git tools except git_clone and git_cat_file', () => {
      // git_clone creates new repos, git_cat_file operates on objects by SHA
      const toolsWithPath = gitTools.filter((t) => t.name !== 'git_clone' && t.name !== 'git_cat_file')
      toolsWithPath.forEach((tool) => {
        expect(tool.inputSchema.properties).toHaveProperty('path')
      })
    })
  })
})
