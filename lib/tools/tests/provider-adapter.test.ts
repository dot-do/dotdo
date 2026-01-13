/**
 * Provider Adapter Tests
 *
 * Tests for the provider tool adapter interface and factory.
 * Verifies common patterns extracted from compat/ providers.
 *
 * @see lib/tools/provider-adapter.ts
 * @see dotdo-pwg8u - Extract Common Provider Patterns from compat/
 */

import { describe, it, expect, vi } from 'vitest'
import {
  createProviderAdapter,
  createParameterSchema,
  createToolId,
  parseToolId,
  ProviderError,
  isProviderError,
  type ProviderToolAdapter,
  type ProviderAdapterConfig,
  type ToolDefinition,
  type ToolCategory,
  type CredentialType,
  type ParameterDefinition,
  type RuntimeCredentials,
  type ToolContext,
} from '../provider-adapter'

// ============================================================================
// TYPE INTERFACE TESTS
// ============================================================================

describe('ToolCategory type', () => {
  it('supports all defined categories', () => {
    const categories: ToolCategory[] = [
      'ai',
      'analytics',
      'auth',
      'automation',
      'cms',
      'collaboration',
      'commerce',
      'communication',
      'crm',
      'database',
      'devops',
      'helpdesk',
      'project',
      'queue',
      'search',
      'storage',
    ]

    // Type-level verification - if this compiles, types are correct
    expect(categories).toHaveLength(16)
  })
})

describe('CredentialType type', () => {
  it('supports all defined credential types', () => {
    const credTypes: CredentialType[] = [
      'api_key',
      'bearer_token',
      'basic_auth',
      'oauth2',
      'aws_signature',
      'custom',
    ]

    expect(credTypes).toHaveLength(6)
  })
})

// ============================================================================
// createProviderAdapter TESTS
// ============================================================================

describe('createProviderAdapter', () => {
  const mockHandler = vi.fn().mockResolvedValue({ success: true })

  const baseConfig: ProviderAdapterConfig = {
    name: 'testprovider',
    category: 'communication',
    credential: {
      type: 'api_key',
      headerName: 'Authorization',
      headerPrefix: 'Bearer',
      envVar: 'TEST_API_KEY',
      required: true,
    },
    tools: [
      {
        id: 'test_tool',
        name: 'Test Tool',
        description: 'A test tool for testing',
        parameters: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'Message to send',
            },
          },
          required: ['message'],
        },
        handler: mockHandler,
        tags: ['test'],
      },
    ],
  }

  describe('adapter creation', () => {
    it('creates adapter with correct name', () => {
      const adapter = createProviderAdapter(baseConfig)
      expect(adapter.name).toBe('testprovider')
    })

    it('generates display name from name when not provided', () => {
      const adapter = createProviderAdapter(baseConfig)
      expect(adapter.displayName).toBe('Testprovider')
    })

    it('uses provided display name', () => {
      const adapter = createProviderAdapter({
        ...baseConfig,
        displayName: 'Test Provider',
      })
      expect(adapter.displayName).toBe('Test Provider')
    })

    it('generates description when not provided', () => {
      const adapter = createProviderAdapter(baseConfig)
      expect(adapter.description).toBe('Testprovider integration')
    })

    it('uses provided description', () => {
      const adapter = createProviderAdapter({
        ...baseConfig,
        description: 'Custom description',
      })
      expect(adapter.description).toBe('Custom description')
    })

    it('sets correct category', () => {
      const adapter = createProviderAdapter(baseConfig)
      expect(adapter.category).toBe('communication')
    })

    it('sets correct credential config', () => {
      const adapter = createProviderAdapter(baseConfig)
      expect(adapter.credential.type).toBe('api_key')
      expect(adapter.credential.required).toBe(true)
    })
  })

  describe('getTools', () => {
    it('returns all tools', () => {
      const adapter = createProviderAdapter(baseConfig)
      const tools = adapter.getTools()

      expect(tools).toHaveLength(1)
      expect(tools[0].id).toBe('test_tool')
    })

    it('returns a copy of tools array', () => {
      const adapter = createProviderAdapter(baseConfig)
      const tools1 = adapter.getTools()
      const tools2 = adapter.getTools()

      expect(tools1).not.toBe(tools2)
      expect(tools1).toEqual(tools2)
    })
  })

  describe('getTool', () => {
    it('returns tool by ID', () => {
      const adapter = createProviderAdapter(baseConfig)
      const tool = adapter.getTool('test_tool')

      expect(tool).toBeDefined()
      expect(tool?.name).toBe('Test Tool')
    })

    it('returns undefined for non-existent tool', () => {
      const adapter = createProviderAdapter(baseConfig)
      const tool = adapter.getTool('non_existent')

      expect(tool).toBeUndefined()
    })
  })

  describe('execute', () => {
    it('executes tool handler with params and credentials', async () => {
      const handler = vi.fn().mockResolvedValue({ result: 'success' })
      const adapter = createProviderAdapter({
        ...baseConfig,
        tools: [{ ...baseConfig.tools[0], handler }],
      })

      const params = { message: 'hello' }
      const credentials: RuntimeCredentials = { apiKey: 'test-key' }

      const result = await adapter.execute('test_tool', params, credentials)

      expect(handler).toHaveBeenCalledWith(params, credentials, undefined)
      expect(result).toEqual({ result: 'success' })
    })

    it('passes context to handler', async () => {
      const handler = vi.fn().mockResolvedValue({})
      const adapter = createProviderAdapter({
        ...baseConfig,
        tools: [{ ...baseConfig.tools[0], handler }],
      })

      const context: ToolContext = {
        requestId: 'req-123',
        timeout: 5000,
      }

      await adapter.execute('test_tool', {}, {}, context)

      expect(handler).toHaveBeenCalledWith({}, {}, context)
    })

    it('throws ProviderError for non-existent tool', async () => {
      const adapter = createProviderAdapter(baseConfig)

      await expect(
        adapter.execute('non_existent', {}, {})
      ).rejects.toThrow(ProviderError)

      try {
        await adapter.execute('non_existent', {}, {})
      } catch (error) {
        expect(isProviderError(error)).toBe(true)
        expect((error as ProviderError).code).toBe('TOOL_NOT_FOUND')
        expect((error as ProviderError).provider).toBe('testprovider')
      }
    })

    it('wraps handler errors in ProviderError', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Handler failed'))
      const adapter = createProviderAdapter({
        ...baseConfig,
        tools: [{ ...baseConfig.tools[0], handler }],
      })

      await expect(
        adapter.execute('test_tool', {}, {})
      ).rejects.toThrow(ProviderError)

      try {
        await adapter.execute('test_tool', {}, {})
      } catch (error) {
        expect(isProviderError(error)).toBe(true)
        expect((error as ProviderError).code).toBe('TOOL_EXECUTION_ERROR')
        expect((error as ProviderError).message).toBe('Handler failed')
        expect((error as ProviderError).toolId).toBe('test_tool')
      }
    })

    it('preserves ProviderError thrown by handler', async () => {
      const originalError = new ProviderError({
        code: 'CUSTOM_ERROR',
        message: 'Custom error message',
        provider: 'testprovider',
      })
      const handler = vi.fn().mockRejectedValue(originalError)
      const adapter = createProviderAdapter({
        ...baseConfig,
        tools: [{ ...baseConfig.tools[0], handler }],
      })

      try {
        await adapter.execute('test_tool', {}, {})
      } catch (error) {
        expect(error).toBe(originalError)
        expect((error as ProviderError).code).toBe('CUSTOM_ERROR')
      }
    })
  })

  describe('getMetadata', () => {
    it('returns complete provider metadata', () => {
      const adapter = createProviderAdapter({
        ...baseConfig,
        iconUrl: 'https://example.com/icon.png',
        docsUrl: 'https://docs.example.com',
        version: '2.0.0',
      })

      const metadata = adapter.getMetadata()

      expect(metadata.name).toBe('testprovider')
      expect(metadata.displayName).toBe('Testprovider')
      expect(metadata.category).toBe('communication')
      expect(metadata.toolCount).toBe(1)
      expect(metadata.iconUrl).toBe('https://example.com/icon.png')
      expect(metadata.docsUrl).toBe('https://docs.example.com')
      expect(metadata.version).toBe('2.0.0')
    })

    it('defaults version to 1.0.0', () => {
      const adapter = createProviderAdapter(baseConfig)
      const metadata = adapter.getMetadata()

      expect(metadata.version).toBe('1.0.0')
    })
  })
})

// ============================================================================
// ProviderError TESTS
// ============================================================================

describe('ProviderError', () => {
  it('creates error with all properties', () => {
    const error = new ProviderError({
      code: 'TEST_ERROR',
      message: 'Test error message',
      provider: 'testprovider',
      toolId: 'test_tool',
      statusCode: 400,
      requestId: 'req-123',
      retryable: true,
      details: { field: 'value' },
    })

    expect(error.code).toBe('TEST_ERROR')
    expect(error.message).toBe('Test error message')
    expect(error.provider).toBe('testprovider')
    expect(error.toolId).toBe('test_tool')
    expect(error.statusCode).toBe(400)
    expect(error.requestId).toBe('req-123')
    expect(error.retryable).toBe(true)
    expect(error.details).toEqual({ field: 'value' })
  })

  it('defaults statusCode to 500', () => {
    const error = new ProviderError({
      code: 'TEST',
      message: 'Test',
      provider: 'test',
    })

    expect(error.statusCode).toBe(500)
  })

  it('defaults retryable to false', () => {
    const error = new ProviderError({
      code: 'TEST',
      message: 'Test',
      provider: 'test',
    })

    expect(error.retryable).toBe(false)
  })

  it('is instanceof Error', () => {
    const error = new ProviderError({
      code: 'TEST',
      message: 'Test',
      provider: 'test',
    })

    expect(error).toBeInstanceOf(Error)
  })

  it('has correct name', () => {
    const error = new ProviderError({
      code: 'TEST',
      message: 'Test',
      provider: 'test',
    })

    expect(error.name).toBe('ProviderError')
  })

  it('toJSON returns serializable object', () => {
    const error = new ProviderError({
      code: 'TEST_ERROR',
      message: 'Test error',
      provider: 'testprovider',
      toolId: 'test_tool',
      statusCode: 400,
      requestId: 'req-123',
      retryable: true,
      details: { key: 'value' },
    })

    const json = error.toJSON()

    expect(json).toEqual({
      code: 'TEST_ERROR',
      message: 'Test error',
      provider: 'testprovider',
      toolId: 'test_tool',
      statusCode: 400,
      requestId: 'req-123',
      retryable: true,
      details: { key: 'value' },
    })
  })

  it('stores cause error', () => {
    const cause = new Error('Original error')
    const error = new ProviderError({
      code: 'WRAPPED',
      message: 'Wrapped error',
      provider: 'test',
      cause,
    })

    expect(error._cause).toBe(cause)
  })
})

describe('isProviderError', () => {
  it('returns true for ProviderError', () => {
    const error = new ProviderError({
      code: 'TEST',
      message: 'Test',
      provider: 'test',
    })

    expect(isProviderError(error)).toBe(true)
  })

  it('returns false for regular Error', () => {
    const error = new Error('Regular error')

    expect(isProviderError(error)).toBe(false)
  })

  it('returns false for non-error values', () => {
    expect(isProviderError(null)).toBe(false)
    expect(isProviderError(undefined)).toBe(false)
    expect(isProviderError('string')).toBe(false)
    expect(isProviderError(123)).toBe(false)
    expect(isProviderError({})).toBe(false)
  })
})

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

describe('createParameterSchema', () => {
  it('creates schema from parameter definitions', () => {
    const params: ParameterDefinition[] = [
      { name: 'message', type: 'string', description: 'The message', required: true },
      { name: 'count', type: 'number', default: 1 },
    ]

    const schema = createParameterSchema(params)

    expect(schema.type).toBe('object')
    expect(schema.properties.message.type).toBe('string')
    expect(schema.properties.message.description).toBe('The message')
    expect(schema.properties.count.type).toBe('number')
    expect(schema.properties.count.default).toBe(1)
    expect(schema.required).toEqual(['message'])
  })

  it('handles array type with items', () => {
    const params: ParameterDefinition[] = [
      {
        name: 'tags',
        type: 'array',
        items: { name: 'tag', type: 'string' },
      },
    ]

    const schema = createParameterSchema(params)

    expect(schema.properties.tags.type).toBe('array')
    expect(schema.properties.tags.items).toEqual({ type: 'string' })
  })

  it('handles object type with properties', () => {
    const params: ParameterDefinition[] = [
      {
        name: 'address',
        type: 'object',
        properties: {
          street: { type: 'string' },
          city: { type: 'string' },
        },
      },
    ]

    const schema = createParameterSchema(params)

    expect(schema.properties.address.type).toBe('object')
    expect(schema.properties.address.properties).toEqual({
      street: { type: 'string' },
      city: { type: 'string' },
    })
  })

  it('handles enum values', () => {
    const params: ParameterDefinition[] = [
      { name: 'status', type: 'string', enum: ['active', 'inactive', 'pending'] },
    ]

    const schema = createParameterSchema(params)

    expect(schema.properties.status.enum).toEqual(['active', 'inactive', 'pending'])
  })

  it('returns undefined required array when no required params', () => {
    const params: ParameterDefinition[] = [
      { name: 'optional1', type: 'string' },
      { name: 'optional2', type: 'number' },
    ]

    const schema = createParameterSchema(params)

    expect(schema.required).toBeUndefined()
  })
})

describe('createToolId', () => {
  it('creates fully qualified tool ID', () => {
    const toolId = createToolId('communication', 'sendgrid', 'send_email')

    expect(toolId).toBe('communication.sendgrid.send_email')
  })

  it('handles different categories', () => {
    expect(createToolId('commerce', 'stripe', 'create_customer')).toBe('commerce.stripe.create_customer')
    expect(createToolId('collaboration', 'slack', 'post_message')).toBe('collaboration.slack.post_message')
  })
})

describe('parseToolId', () => {
  it('parses valid tool ID', () => {
    const result = parseToolId('communication.sendgrid.send_email')

    expect(result).toEqual({
      category: 'communication',
      provider: 'sendgrid',
      operation: 'send_email',
    })
  })

  it('returns null for invalid format (too few parts)', () => {
    expect(parseToolId('sendgrid.send_email')).toBeNull()
    expect(parseToolId('send_email')).toBeNull()
    expect(parseToolId('')).toBeNull()
  })

  it('returns null for invalid format (too many parts)', () => {
    expect(parseToolId('a.b.c.d')).toBeNull()
    expect(parseToolId('communication.sendgrid.mail.send')).toBeNull()
  })
})

// ============================================================================
// TOOL DEFINITION TESTS
// ============================================================================

describe('ToolDefinition', () => {
  it('supports all tool properties', () => {
    const tool: ToolDefinition = {
      id: 'send_email',
      name: 'Send Email',
      description: 'Send an email via the provider',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient' },
        },
        required: ['to'],
      },
      handler: async () => ({}),
      tags: ['email', 'communication'],
      deprecated: false,
      deprecationMessage: undefined,
      rateLimitTier: 'medium',
      requiresConfirmation: false,
      examples: [
        {
          name: 'Simple email',
          input: { to: 'user@example.com' },
          description: 'Send a basic email',
        },
      ],
    }

    expect(tool.id).toBe('send_email')
    expect(tool.tags).toContain('email')
    expect(tool.rateLimitTier).toBe('medium')
    expect(tool.examples).toHaveLength(1)
  })

  it('supports deprecated tools', () => {
    const tool: ToolDefinition = {
      id: 'legacy_send',
      name: 'Legacy Send',
      description: 'Deprecated send method',
      parameters: { type: 'object', properties: {} },
      handler: async () => ({}),
      deprecated: true,
      deprecationMessage: 'Use send_email instead',
    }

    expect(tool.deprecated).toBe(true)
    expect(tool.deprecationMessage).toBe('Use send_email instead')
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Provider Adapter Integration', () => {
  it('creates a complete provider adapter with multiple tools', async () => {
    const sendHandler = vi.fn().mockResolvedValue({ messageId: 'msg-123' })
    const listHandler = vi.fn().mockResolvedValue({ emails: [] })

    const adapter = createProviderAdapter({
      name: 'email',
      displayName: 'Email Service',
      description: 'Email delivery service',
      category: 'communication',
      credential: {
        type: 'api_key',
        envVar: 'EMAIL_API_KEY',
      },
      baseUrl: 'https://api.email.com',
      timeout: 30000,
      maxRetries: 3,
      iconUrl: 'https://email.com/icon.png',
      docsUrl: 'https://docs.email.com',
      version: '1.2.0',
      tools: [
        {
          id: 'send_email',
          name: 'Send Email',
          description: 'Send an email',
          parameters: {
            type: 'object',
            properties: {
              to: { type: 'string' },
              subject: { type: 'string' },
              body: { type: 'string' },
            },
            required: ['to', 'subject', 'body'],
          },
          handler: sendHandler,
          tags: ['email', 'send'],
          rateLimitTier: 'medium',
        },
        {
          id: 'list_templates',
          name: 'List Templates',
          description: 'List email templates',
          parameters: {
            type: 'object',
            properties: {
              limit: { type: 'number', default: 10 },
            },
          },
          handler: listHandler,
          tags: ['email', 'templates'],
          rateLimitTier: 'high',
        },
      ],
    })

    // Verify adapter properties
    expect(adapter.name).toBe('email')
    expect(adapter.displayName).toBe('Email Service')
    expect(adapter.category).toBe('communication')

    // Verify tools
    const tools = adapter.getTools()
    expect(tools).toHaveLength(2)
    expect(tools.map(t => t.id)).toEqual(['send_email', 'list_templates'])

    // Verify metadata
    const metadata = adapter.getMetadata()
    expect(metadata.toolCount).toBe(2)
    expect(metadata.version).toBe('1.2.0')

    // Test execution
    const sendResult = await adapter.execute(
      'send_email',
      { to: 'user@example.com', subject: 'Test', body: 'Hello' },
      { apiKey: 'test-key' }
    )
    expect(sendResult).toEqual({ messageId: 'msg-123' })
    expect(sendHandler).toHaveBeenCalled()

    const listResult = await adapter.execute('list_templates', {}, { apiKey: 'test-key' })
    expect(listResult).toEqual({ emails: [] })
  })

  it('handles tool execution with full context', async () => {
    const handler = vi.fn().mockImplementation(async (params, creds, ctx) => ({
      params,
      hasApiKey: !!creds.apiKey,
      requestId: ctx?.requestId,
    }))

    const adapter = createProviderAdapter({
      name: 'test',
      category: 'communication',
      credential: { type: 'api_key' },
      tools: [{
        id: 'test',
        name: 'Test',
        description: 'Test tool',
        parameters: { type: 'object', properties: {} },
        handler,
      }],
    })

    const result = await adapter.execute(
      'test',
      { key: 'value' },
      { apiKey: 'secret' },
      { requestId: 'req-456', timeout: 10000 }
    )

    expect(result).toEqual({
      params: { key: 'value' },
      hasApiKey: true,
      requestId: 'req-456',
    })
  })
})
