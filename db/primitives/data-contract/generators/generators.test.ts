/**
 * Tests for OpenAPI and AsyncAPI generators
 *
 * Validates:
 * - OpenAPI 3.1 generation with correct schema structure
 * - AsyncAPI 2.6 generation for event channels
 * - Example generation from schema defaults
 * - Deprecation notices in generated specs
 */

import { describe, it, expect } from 'vitest'
import type { DataContract, JSONSchema } from '../index'
import {
  // OpenAPI
  toOpenAPISchema,
  toOpenAPIPath,
  generateOpenAPIDocument,
  generateExample,
  // AsyncAPI
  toAsyncAPISchema,
  toAsyncAPIMessage,
  toAsyncAPIChannel,
  toAsyncAPIEventChannels,
  generateAsyncAPIDocument,
  generateDocs,
} from './index'

// ============================================================================
// TEST FIXTURES
// ============================================================================

const userContract: DataContract = {
  name: 'user',
  version: '1.0.0',
  schema: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
      name: { type: 'string', minLength: 1, maxLength: 100 },
      age: { type: 'integer', minimum: 0, maximum: 150 },
      role: { type: 'string', enum: ['admin', 'user', 'guest'], default: 'user' },
      active: { type: 'boolean', default: true },
    },
    required: ['id', 'email'],
  },
  metadata: {
    description: 'User account information',
    owner: 'identity-team',
    namespace: 'identity',
    tags: ['user', 'account'],
  },
}

const deprecatedContract: DataContract = {
  name: 'legacy-order',
  version: '1.0.0',
  schema: {
    type: 'object',
    properties: {
      orderId: { type: 'string' },
      total: { type: 'number' },
    },
    required: ['orderId'],
  },
  metadata: {
    description: 'Legacy order schema',
    deprecated: true,
    deprecationMessage: 'Use order-v2 instead',
  },
}

const nestedContract: DataContract = {
  name: 'order',
  version: '1.0.0',
  schema: {
    type: 'object',
    properties: {
      orderId: { type: 'string', format: 'uuid' },
      customer: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          address: {
            type: 'object',
            properties: {
              street: { type: 'string' },
              city: { type: 'string' },
              zipCode: { type: 'string', pattern: '^[0-9]{5}$' },
            },
            required: ['city'],
          },
        },
        required: ['id'],
      },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            productId: { type: 'string' },
            quantity: { type: 'integer', minimum: 1, default: 1 },
            price: { type: 'number', minimum: 0 },
          },
          required: ['productId', 'quantity'],
        },
        minItems: 1,
      },
      status: { type: 'string', enum: ['pending', 'processing', 'shipped', 'delivered'] },
    },
    required: ['orderId', 'items'],
  },
  metadata: {
    description: 'E-commerce order',
    namespace: 'commerce',
  },
}

// ============================================================================
// OPENAPI SCHEMA GENERATION TESTS
// ============================================================================

describe('OpenAPI Schema Generation', () => {
  describe('toOpenAPISchema', () => {
    it('should convert basic schema properties', () => {
      const schema = toOpenAPISchema(userContract)

      expect(schema.type).toBe('object')
      expect(schema.properties).toBeDefined()
      expect(schema.properties?.id?.type).toBe('string')
      expect(schema.properties?.id?.format).toBe('uuid')
      expect(schema.properties?.email?.format).toBe('email')
      expect(schema.required).toEqual(['id', 'email'])
    })

    it('should include numeric constraints', () => {
      const schema = toOpenAPISchema(userContract)

      expect(schema.properties?.age?.minimum).toBe(0)
      expect(schema.properties?.age?.maximum).toBe(150)
    })

    it('should include string constraints', () => {
      const schema = toOpenAPISchema(userContract)

      expect(schema.properties?.name?.minLength).toBe(1)
      expect(schema.properties?.name?.maxLength).toBe(100)
    })

    it('should include enum values', () => {
      const schema = toOpenAPISchema(userContract)

      expect(schema.properties?.role?.enum).toEqual(['admin', 'user', 'guest'])
    })

    it('should use defaults as examples', () => {
      const schema = toOpenAPISchema(userContract)

      expect(schema.properties?.role?.default).toBe('user')
      expect(schema.properties?.role?.example).toBe('user')
      expect(schema.properties?.active?.default).toBe(true)
      expect(schema.properties?.active?.example).toBe(true)
    })

    it('should handle nested objects', () => {
      const schema = toOpenAPISchema(nestedContract)

      expect(schema.properties?.customer?.type).toBe('object')
      expect(schema.properties?.customer?.properties?.address?.type).toBe('object')
      expect(schema.properties?.customer?.properties?.address?.properties?.zipCode?.pattern).toBe('^[0-9]{5}$')
    })

    it('should handle arrays', () => {
      const schema = toOpenAPISchema(nestedContract)

      expect(schema.properties?.items?.type).toBe('array')
      expect(schema.properties?.items?.minItems).toBe(1)
      expect(schema.properties?.items?.items?.type).toBe('object')
      expect(schema.properties?.items?.items?.properties?.quantity?.minimum).toBe(1)
    })

    it('should add deprecation notice', () => {
      const schema = toOpenAPISchema(deprecatedContract)

      expect(schema.deprecated).toBe(true)
      expect(schema.description).toContain('DEPRECATED')
      expect(schema.description).toContain('Use order-v2 instead')
    })
  })

  describe('generateExample', () => {
    it('should generate string examples', () => {
      expect(generateExample({ type: 'string' })).toBe('example')
      expect(generateExample({ type: 'string', format: 'email' })).toBe('user@example.com')
      expect(generateExample({ type: 'string', format: 'uuid' })).toBe('550e8400-e29b-41d4-a716-446655440000')
      expect(generateExample({ type: 'string', format: 'uri' })).toBe('https://example.com')
      expect(generateExample({ type: 'string', format: 'date' })).toBe('2024-01-15')
      expect(generateExample({ type: 'string', format: 'date-time' })).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('should use default values when available', () => {
      expect(generateExample({ type: 'string', default: 'custom' })).toBe('custom')
      expect(generateExample({ type: 'number', default: 42 })).toBe(42)
      expect(generateExample({ type: 'boolean', default: false })).toBe(false)
    })

    it('should use first enum value', () => {
      expect(generateExample({ type: 'string', enum: ['pending', 'active'] })).toBe('pending')
    })

    it('should generate number examples respecting constraints', () => {
      expect(generateExample({ type: 'number', minimum: 10, maximum: 20 })).toBe(15)
      expect(generateExample({ type: 'integer', minimum: 0, maximum: 100 })).toBe(50)
    })

    it('should generate object examples', () => {
      const example = generateExample({
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'integer' },
        },
      })

      expect(example).toEqual({
        name: 'example',
        age: 50,
      })
    })

    it('should generate array examples', () => {
      const example = generateExample({
        type: 'array',
        items: { type: 'string' },
      })

      expect(Array.isArray(example)).toBe(true)
      expect((example as string[])[0]).toBe('example')
    })
  })
})

// ============================================================================
// OPENAPI PATH GENERATION TESTS
// ============================================================================

describe('OpenAPI Path Generation', () => {
  describe('toOpenAPIPath', () => {
    it('should generate collection and item paths', () => {
      const { collection, item } = toOpenAPIPath(userContract)

      expect(collection.get).toBeDefined()
      expect(collection.post).toBeDefined()
      expect(item.get).toBeDefined()
      expect(item.put).toBeDefined()
      expect(item.delete).toBeDefined()
    })

    it('should generate correct operation IDs', () => {
      const { collection, item } = toOpenAPIPath(userContract)

      expect(collection.get?.operationId).toBe('listUser')
      expect(collection.post?.operationId).toBe('createUser')
      expect(item.get?.operationId).toBe('getUser')
      expect(item.put?.operationId).toBe('updateUser')
      expect(item.delete?.operationId).toBe('deleteUser')
    })

    it('should include schema references', () => {
      const { collection, item } = toOpenAPIPath(userContract)

      expect(collection.post?.requestBody?.content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/User')
      expect(item.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/User')
    })

    it('should include examples in responses', () => {
      const { item } = toOpenAPIPath(userContract)

      expect(item.get?.responses?.['200']?.content?.['application/json']?.example).toBeDefined()
    })

    it('should respect operation configuration', () => {
      const { collection, item } = toOpenAPIPath(userContract, {
        list: true,
        get: true,
        create: false,
        update: false,
        delete: false,
      })

      expect(collection.get).toBeDefined()
      expect(collection.post).toBeUndefined()
      expect(item.get).toBeDefined()
      expect(item.put).toBeUndefined()
      expect(item.delete).toBeUndefined()
    })

    it('should mark deprecated operations', () => {
      const { collection, item } = toOpenAPIPath(deprecatedContract)

      expect(collection.get?.deprecated).toBe(true)
      expect(collection.post?.deprecated).toBe(true)
      expect(item.get?.deprecated).toBe(true)
      expect(item.put?.deprecated).toBe(true)
      expect(item.delete?.deprecated).toBe(true)
    })

    it('should include query parameters for list operation', () => {
      const { collection } = toOpenAPIPath(userContract)

      const limitParam = collection.get?.parameters?.find((p) => p.name === 'limit')
      const offsetParam = collection.get?.parameters?.find((p) => p.name === 'offset')

      expect(limitParam).toBeDefined()
      expect(limitParam?.in).toBe('query')
      expect(offsetParam).toBeDefined()
    })

    it('should include path parameter for item operations', () => {
      const { item } = toOpenAPIPath(userContract)

      const idParam = item.get?.parameters?.find((p) => p.name === 'id')
      expect(idParam).toBeDefined()
      expect(idParam?.in).toBe('path')
      expect(idParam?.required).toBe(true)
    })
  })
})

// ============================================================================
// OPENAPI DOCUMENT GENERATION TESTS
// ============================================================================

describe('OpenAPI Document Generation', () => {
  describe('generateOpenAPIDocument', () => {
    it('should generate valid OpenAPI 3.1 document', () => {
      const doc = generateOpenAPIDocument([userContract])

      expect(doc.openapi).toBe('3.1.0')
      expect(doc.info.title).toBeDefined()
      expect(doc.info.version).toBeDefined()
    })

    it('should include all contracts as schemas', () => {
      const doc = generateOpenAPIDocument([userContract, nestedContract])

      expect(doc.components?.schemas?.User).toBeDefined()
      expect(doc.components?.schemas?.Order).toBeDefined()
    })

    it('should generate paths for all contracts', () => {
      const doc = generateOpenAPIDocument([userContract])

      expect(doc.paths['/user']).toBeDefined()
      expect(doc.paths['/user/{id}']).toBeDefined()
    })

    it('should use custom options', () => {
      const doc = generateOpenAPIDocument([userContract], {
        title: 'My API',
        version: '2.0.0',
        description: 'Test API',
        basePath: '/api/v2',
        servers: [{ url: 'https://api.example.com', description: 'Production' }],
      })

      expect(doc.info.title).toBe('My API')
      expect(doc.info.version).toBe('2.0.0')
      expect(doc.info.description).toBe('Test API')
      expect(doc.servers?.[0]?.url).toBe('https://api.example.com')
      expect(doc.paths['/api/v2/user']).toBeDefined()
    })

    it('should include tags for each contract', () => {
      const doc = generateOpenAPIDocument([userContract, nestedContract])

      expect(doc.tags?.find((t) => t.name === 'user')).toBeDefined()
      expect(doc.tags?.find((t) => t.name === 'order')).toBeDefined()
    })

    it('should include security schemes when configured', () => {
      const doc = generateOpenAPIDocument([userContract], {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
        defaultSecurity: [{ bearerAuth: [] }],
      })

      expect(doc.components?.securitySchemes?.bearerAuth).toBeDefined()
      expect(doc.paths['/user']?.get?.security).toEqual([{ bearerAuth: [] }])
    })
  })
})

// ============================================================================
// ASYNCAPI SCHEMA GENERATION TESTS
// ============================================================================

describe('AsyncAPI Schema Generation', () => {
  describe('toAsyncAPISchema', () => {
    it('should convert basic schema properties', () => {
      const schema = toAsyncAPISchema(userContract)

      expect(schema.type).toBe('object')
      expect(schema.properties).toBeDefined()
      expect(schema.properties?.email?.format).toBe('email')
    })

    it('should add deprecation notice', () => {
      const schema = toAsyncAPISchema(deprecatedContract)

      expect(schema.deprecated).toBe(true)
      expect(schema.description).toContain('DEPRECATED')
    })
  })
})

// ============================================================================
// ASYNCAPI MESSAGE GENERATION TESTS
// ============================================================================

describe('AsyncAPI Message Generation', () => {
  describe('toAsyncAPIMessage', () => {
    it('should generate message with event wrapper', () => {
      const message = toAsyncAPIMessage(userContract, 'created')

      expect(message.messageId).toBe('user.created')
      expect(message.name).toBe('user.created')
      expect(message.contentType).toBe('application/json')
    })

    it('should include payload with event structure', () => {
      const message = toAsyncAPIMessage(userContract, 'updated')

      expect(message.payload?.properties?.eventId).toBeDefined()
      expect(message.payload?.properties?.eventType?.enum).toEqual(['updated'])
      expect(message.payload?.properties?.timestamp).toBeDefined()
      expect(message.payload?.properties?.data).toBeDefined()
    })

    it('should include headers with correlation ID', () => {
      const message = toAsyncAPIMessage(userContract)

      expect(message.headers?.properties?.correlationId).toBeDefined()
      expect(message.correlationId?.location).toBe('$message.header#/correlationId')
    })

    it('should include examples', () => {
      const message = toAsyncAPIMessage(userContract, 'created')

      expect(message.examples?.length).toBeGreaterThan(0)
      expect(message.examples?.[0]?.payload?.eventType).toBe('created')
      expect(message.examples?.[0]?.payload?.data).toBeDefined()
    })

    it('should mark deprecated messages', () => {
      const message = toAsyncAPIMessage(deprecatedContract, 'updated')

      expect(message.deprecated).toBe(true)
      expect(message.description).toContain('DEPRECATED')
    })
  })
})

// ============================================================================
// ASYNCAPI CHANNEL GENERATION TESTS
// ============================================================================

describe('AsyncAPI Channel Generation', () => {
  describe('toAsyncAPIChannel', () => {
    it('should generate pubsub channel by default', () => {
      const channel = toAsyncAPIChannel(userContract)

      expect(channel.publish).toBeDefined()
      expect(channel.subscribe).toBeDefined()
    })

    it('should include channel description', () => {
      const channel = toAsyncAPIChannel(userContract)

      expect(channel.description).toBeDefined()
      expect(channel.description?.toLowerCase()).toContain('user')
    })

    it('should respect channel pattern configuration', () => {
      const channel = toAsyncAPIChannel(userContract, { pattern: 'request-reply' })

      expect(channel.publish).toBeDefined()
      expect(channel.subscribe).toBeUndefined()
    })
  })

  describe('toAsyncAPIEventChannels', () => {
    it('should generate channels for all event types', () => {
      const channels = toAsyncAPIEventChannels(userContract)

      expect(channels['user/created']).toBeDefined()
      expect(channels['user/updated']).toBeDefined()
      expect(channels['user/deleted']).toBeDefined()
    })

    it('should respect event configuration', () => {
      const channels = toAsyncAPIEventChannels(userContract, {
        created: true,
        updated: true,
        deleted: false,
      })

      expect(channels['user/created']).toBeDefined()
      expect(channels['user/updated']).toBeDefined()
      expect(channels['user/deleted']).toBeUndefined()
    })

    it('should include custom events', () => {
      const channels = toAsyncAPIEventChannels(userContract, {
        created: true,
        custom: ['activated', 'suspended'],
      })

      expect(channels['user/created']).toBeDefined()
      expect(channels['user/activated']).toBeDefined()
      expect(channels['user/suspended']).toBeDefined()
    })

    it('should generate correct operation IDs', () => {
      const channels = toAsyncAPIEventChannels(userContract)

      expect(channels['user/created']?.subscribe?.operationId).toBe('onUserCreated')
      expect(channels['user/created']?.publish?.operationId).toBe('emitUserCreated')
    })
  })
})

// ============================================================================
// ASYNCAPI DOCUMENT GENERATION TESTS
// ============================================================================

describe('AsyncAPI Document Generation', () => {
  describe('generateAsyncAPIDocument', () => {
    it('should generate valid AsyncAPI 2.6 document', () => {
      const doc = generateAsyncAPIDocument([userContract])

      expect(doc.asyncapi).toBe('2.6.0')
      expect(doc.info.title).toBeDefined()
      expect(doc.info.version).toBeDefined()
    })

    it('should include all contracts as schemas', () => {
      const doc = generateAsyncAPIDocument([userContract, nestedContract])

      expect(doc.components?.schemas?.User).toBeDefined()
      expect(doc.components?.schemas?.Order).toBeDefined()
    })

    it('should generate channels for all contracts', () => {
      const doc = generateAsyncAPIDocument([userContract])

      expect(doc.channels['user/created']).toBeDefined()
      expect(doc.channels['user/updated']).toBeDefined()
      expect(doc.channels['user/deleted']).toBeDefined()
    })

    it('should use custom options', () => {
      const doc = generateAsyncAPIDocument([userContract], {
        title: 'My Event API',
        version: '2.0.0',
        description: 'Event streams',
        channelPrefix: 'events',
        defaultContentType: 'application/cloudevents+json',
      })

      expect(doc.info.title).toBe('My Event API')
      expect(doc.info.version).toBe('2.0.0')
      expect(doc.defaultContentType).toBe('application/cloudevents+json')
      expect(doc.channels['events/user/created']).toBeDefined()
    })

    it('should include servers when configured', () => {
      const doc = generateAsyncAPIDocument([userContract], {
        servers: {
          production: {
            url: 'kafka://broker.example.com:9092',
            protocol: 'kafka',
            description: 'Production Kafka cluster',
          },
        },
      })

      expect(doc.servers?.production?.url).toBe('kafka://broker.example.com:9092')
      expect(doc.servers?.production?.protocol).toBe('kafka')
    })

    it('should include tags for each contract', () => {
      const doc = generateAsyncAPIDocument([userContract, nestedContract])

      expect(doc.tags?.find((t) => t.name === 'user')).toBeDefined()
      expect(doc.tags?.find((t) => t.name === 'order')).toBeDefined()
    })

    it('should include messages in components', () => {
      const doc = generateAsyncAPIDocument([userContract])

      expect(doc.components?.messages).toBeDefined()
      expect(Object.keys(doc.components?.messages || {}).length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// COMBINED DOCUMENT GENERATION TESTS
// ============================================================================

describe('Combined Document Generation', () => {
  describe('generateDocs', () => {
    it('should generate both OpenAPI and AsyncAPI documents', () => {
      const { openapi, asyncapi } = generateDocs([userContract])

      expect(openapi.openapi).toBe('3.1.0')
      expect(asyncapi.asyncapi).toBe('2.6.0')
    })

    it('should apply separate options to each document', () => {
      const { openapi, asyncapi } = generateDocs([userContract], {
        openapi: {
          title: 'REST API',
          version: '1.0.0',
        },
        asyncapi: {
          title: 'Event API',
          version: '2.0.0',
        },
      })

      expect(openapi.info.title).toBe('REST API')
      expect(openapi.info.version).toBe('1.0.0')
      expect(asyncapi.info.title).toBe('Event API')
      expect(asyncapi.info.version).toBe('2.0.0')
    })
  })
})

// ============================================================================
// EDGE CASES AND VALIDATION
// ============================================================================

describe('Edge Cases', () => {
  it('should handle empty schema', () => {
    const emptyContract: DataContract = {
      name: 'empty',
      version: '1.0.0',
      schema: { type: 'object' },
    }

    const openapiSchema = toOpenAPISchema(emptyContract)
    const asyncapiSchema = toAsyncAPISchema(emptyContract)

    expect(openapiSchema.type).toBe('object')
    expect(asyncapiSchema.type).toBe('object')
  })

  it('should handle nullable types', () => {
    const nullableContract: DataContract = {
      name: 'nullable',
      version: '1.0.0',
      schema: {
        type: 'object',
        properties: {
          value: { type: ['string', 'null'] },
        },
      },
    }

    const schema = toOpenAPISchema(nullableContract)
    expect(schema.properties?.value?.type).toEqual(['string', 'null'])
  })

  it('should handle additionalProperties', () => {
    const strictContract: DataContract = {
      name: 'strict',
      version: '1.0.0',
      schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        additionalProperties: false,
      },
    }

    const schema = toOpenAPISchema(strictContract)
    expect(schema.additionalProperties).toBe(false)
  })

  it('should handle contracts without metadata', () => {
    const minimalContract: DataContract = {
      name: 'minimal',
      version: '1.0.0',
      schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      },
    }

    const doc = generateOpenAPIDocument([minimalContract])
    expect(doc.paths['/minimal']).toBeDefined()
    expect(doc.tags?.[0]?.description).toBeUndefined()
  })

  it('should handle special characters in names', () => {
    const specialContract: DataContract = {
      name: 'user-profile',
      version: '1.0.0',
      schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      },
    }

    const doc = generateOpenAPIDocument([specialContract])
    expect(doc.components?.schemas?.UserProfile).toBeDefined()
    expect(doc.paths['/user-profile']).toBeDefined()
  })
})
