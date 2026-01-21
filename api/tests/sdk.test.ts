/**
 * Tests for api/sdk.ts - SDK Code Generation
 *
 * This test file provides comprehensive coverage of the SDK generation
 * functionality exported from sdk.ts.
 */
import { describe, it, expect } from 'vitest'
import {
  generateSDK,
  SDKGenerator,
  generateSDKFromOpenAPI,
  SDKFromOpenAPIGenerator,
  type SDKGeneratorOptions,
  type SDKFromOpenAPIOptions
} from '../sdk'
import type { ResourceDefinition } from '../resource'
import type { StorableData } from '@dotdo/db'
import type { OpenAPISpec } from '../openapi'
import { z } from 'zod'

describe('api/sdk.ts - SDK Generation', () => {
  // Test fixtures
  const userSchema = z.object({
    $id: z.string(),
    name: z.string(),
    email: z.string(),
    role: z.string().nullable()
  })

  interface UserResource extends StorableData {
    $id: string
    name: string
    email: string
    role: string | null
  }

  const userResource: ResourceDefinition<UserResource> = {
    name: 'users',
    schema: userSchema,
    fields: {
      name: { type: 'string', required: true },
      email: { type: 'string', required: true },
      role: { type: 'string', required: false }
    }
  }

  const postSchema = z.object({
    $id: z.string(),
    title: z.string(),
    content: z.string(),
    authorId: z.string(),
    published: z.boolean()
  })

  const postResource: ResourceDefinition<z.infer<typeof postSchema>> = {
    name: 'posts',
    schema: postSchema,
    fields: {
      title: { type: 'string', required: true },
      content: { type: 'string', required: true },
      authorId: { type: 'string', required: true },
      published: { type: 'boolean', required: true }
    },
    relations: {
      author: { type: 'belongsTo', resource: 'users' },
      comments: { type: 'hasMany', resource: 'comments' }
    },
    actions: {
      publish: {
        method: 'POST',
        handler: async () => ({})
      },
      archive: {
        method: 'POST',
        handler: async () => ({})
      }
    }
  }

  describe('generateSDK function', () => {
    it('should generate SDK code from a single resource', () => {
      const sdk = generateSDK([userResource])

      expect(sdk).toContain('interface User')
      expect(sdk).toContain('export function createClient')
    })

    it('should generate SDK code from multiple resources', () => {
      const sdk = generateSDK([userResource, postResource])

      expect(sdk).toContain('interface User')
      expect(sdk).toContain('interface Post')
    })

    it('should include auto-generated header', () => {
      const sdk = generateSDK([userResource])

      expect(sdk).toContain('// Auto-generated TypeScript SDK')
      expect(sdk).toContain('Generated at:')
      expect(sdk).toContain('Do not edit manually')
    })

    it('should include APIError class', () => {
      const sdk = generateSDK([userResource])

      expect(sdk).toContain('class APIError extends Error')
      expect(sdk).toContain('public status: number')
      expect(sdk).toContain('public response?: any')
    })

    it('should export createClient function', () => {
      const sdk = generateSDK([userResource])

      expect(sdk).toContain('export function createClient')
      expect(sdk).toContain('ClientOptions')
    })

    it('should accept SDKGeneratorOptions', () => {
      const options: SDKGeneratorOptions = {
        output: 'string',
        includeJSDoc: true
      }
      const sdk = generateSDK([userResource], options)

      expect(typeof sdk).toBe('string')
    })
  })

  describe('SDKGenerator class', () => {
    describe('constructor', () => {
      it('should create generator with resources', () => {
        const generator = new SDKGenerator([userResource])
        expect(generator).toBeDefined()
      })

      it('should create generator with multiple resources', () => {
        const generator = new SDKGenerator([userResource, postResource])
        expect(generator).toBeDefined()
      })
    })

    describe('generateTypes', () => {
      it('should generate TypeScript interfaces', () => {
        const generator = new SDKGenerator([userResource])
        const types = generator.generateTypes()

        expect(types).toContain('interface User')
      })

      it('should include all fields in interface', () => {
        const generator = new SDKGenerator([userResource])
        const types = generator.generateTypes()

        expect(types).toContain('name: string')
        expect(types).toContain('email: string')
        expect(types).toContain('$id: string')
      })

      it('should mark optional fields with ?', () => {
        const generator = new SDKGenerator([userResource])
        const types = generator.generateTypes()

        expect(types).toContain('role?: string')
      })

      it('should generate interfaces for all resources', () => {
        const generator = new SDKGenerator([userResource, postResource])
        const types = generator.generateTypes()

        expect(types).toContain('interface User')
        expect(types).toContain('interface Post')
      })

      it('should convert plural resource names to singular interface names', () => {
        const generator = new SDKGenerator([userResource, postResource])
        const types = generator.generateTypes()

        expect(types).toContain('interface User') // users -> User
        expect(types).toContain('interface Post') // posts -> Post
      })

      it('should handle resource names ending in -ies', () => {
        const categoriesResource: ResourceDefinition<any> = {
          name: 'categories',
          schema: z.object({ $id: z.string(), name: z.string() }),
          fields: { name: { type: 'string', required: true } }
        }
        const generator = new SDKGenerator([categoriesResource])
        const types = generator.generateTypes()

        expect(types).toContain('interface Category')
      })

      it('should handle resource names ending in -es', () => {
        const boxesResource: ResourceDefinition<any> = {
          name: 'boxes',
          schema: z.object({ $id: z.string(), size: z.string() }),
          fields: { size: { type: 'string', required: true } }
        }
        const generator = new SDKGenerator([boxesResource])
        const types = generator.generateTypes()

        expect(types).toContain('interface Box') // boxes -> box
      })
    })

    describe('generateClient', () => {
      it('should generate client factory function', () => {
        const generator = new SDKGenerator([userResource])
        const client = generator.generateClient()

        expect(client).toContain('export function createClient')
        expect(client).toContain('ClientOptions')
      })

      it('should include baseUrl parameter', () => {
        const generator = new SDKGenerator([userResource])
        const client = generator.generateClient()

        expect(client).toContain('baseUrl: string')
      })

      it('should include apiKey parameter', () => {
        const generator = new SDKGenerator([userResource])
        const client = generator.generateClient()

        expect(client).toContain('apiKey?: string')
      })

      it('should include headers parameter', () => {
        const generator = new SDKGenerator([userResource])
        const client = generator.generateClient()

        expect(client).toContain('headers?: Record<string, string>')
      })

      it('should generate internal request helper', () => {
        const generator = new SDKGenerator([userResource])
        const client = generator.generateClient()

        expect(client).toContain('async function request')
        expect(client).toContain('fetch(url')
      })

      it('should handle 204 No Content responses', () => {
        const generator = new SDKGenerator([userResource])
        const client = generator.generateClient()

        expect(client).toContain('response.status === 204')
        expect(client).toContain('return undefined')
      })

      it('should include authorization header handling', () => {
        const generator = new SDKGenerator([userResource])
        const client = generator.generateClient()

        expect(client).toContain('Authorization')
        expect(client).toContain('Bearer')
      })
    })

    describe('generateMethods', () => {
      it('should generate list method', () => {
        const generator = new SDKGenerator([userResource])
        const methods = generator.generateMethods(userResource)

        expect(methods).toContain('list:')
        expect(methods).toContain('Promise<User[]>')
      })

      it('should generate get method', () => {
        const generator = new SDKGenerator([userResource])
        const methods = generator.generateMethods(userResource)

        expect(methods).toContain('get:')
        expect(methods).toContain('id: string')
        expect(methods).toContain('Promise<User>')
      })

      it('should generate create method', () => {
        const generator = new SDKGenerator([userResource])
        const methods = generator.generateMethods(userResource)

        expect(methods).toContain('create:')
        expect(methods).toContain("Omit<User, '$id'>")
      })

      it('should generate update method', () => {
        const generator = new SDKGenerator([userResource])
        const methods = generator.generateMethods(userResource)

        expect(methods).toContain('update:')
        expect(methods).toContain('Partial<')
      })

      it('should generate delete method', () => {
        const generator = new SDKGenerator([userResource])
        const methods = generator.generateMethods(userResource)

        expect(methods).toContain('delete:')
        expect(methods).toContain('Promise<void>')
      })

      it('should include relation comments for resources with relations', () => {
        const generator = new SDKGenerator([postResource])
        const methods = generator.generateMethods(postResource)

        expect(methods).toContain('Relations:')
        expect(methods).toContain('author')
        expect(methods).toContain('comments')
      })

      it('should include action comments for resources with actions', () => {
        const generator = new SDKGenerator([postResource])
        const methods = generator.generateMethods(postResource)

        expect(methods).toContain('Actions:')
        expect(methods).toContain('publish')
        expect(methods).toContain('archive')
      })

      it('should include JSDoc examples', () => {
        const generator = new SDKGenerator([userResource])
        const methods = generator.generateMethods(userResource)

        expect(methods).toContain('@example')
      })
    })

    describe('generate', () => {
      it('should generate complete SDK code', () => {
        const generator = new SDKGenerator([userResource])
        const code = generator.generate()

        expect(code).toContain('// Auto-generated TypeScript SDK')
        expect(code).toContain('interface User')
        expect(code).toContain('export function createClient')
      })

      it('should generate valid TypeScript structure', () => {
        const generator = new SDKGenerator([userResource, postResource])
        const code = generator.generate()

        // Should have proper exports
        expect(code).toContain('export class APIError')
        expect(code).toContain('export interface')
        expect(code).toContain('export function createClient')
      })
    })
  })

  describe('Type mapping', () => {
    it('should map string type correctly', () => {
      const resource: ResourceDefinition<any> = {
        name: 'items',
        schema: z.object({ $id: z.string(), name: z.string() }),
        fields: { name: { type: 'string', required: true } }
      }
      const generator = new SDKGenerator([resource])
      const types = generator.generateTypes()

      expect(types).toContain('name: string')
    })

    it('should map number type correctly', () => {
      const resource: ResourceDefinition<any> = {
        name: 'items',
        schema: z.object({ $id: z.string(), count: z.number() }),
        fields: { count: { type: 'number', required: true } }
      }
      const generator = new SDKGenerator([resource])
      const types = generator.generateTypes()

      expect(types).toContain('count: number')
    })

    it('should map boolean type correctly', () => {
      const resource: ResourceDefinition<any> = {
        name: 'items',
        schema: z.object({ $id: z.string(), active: z.boolean() }),
        fields: { active: { type: 'boolean', required: true } }
      }
      const generator = new SDKGenerator([resource])
      const types = generator.generateTypes()

      expect(types).toContain('active: boolean')
    })

    it('should map date type correctly', () => {
      const resource: ResourceDefinition<any> = {
        name: 'items',
        schema: z.object({ $id: z.string(), createdAt: z.date() }),
        fields: { createdAt: { type: 'date', required: true } }
      }
      const generator = new SDKGenerator([resource])
      const types = generator.generateTypes()

      expect(types).toContain('createdAt: Date')
    })

    it('should map array type correctly', () => {
      const resource: ResourceDefinition<any> = {
        name: 'items',
        schema: z.object({ $id: z.string(), tags: z.array(z.string()) }),
        fields: { tags: { type: 'array', required: true } }
      }
      const generator = new SDKGenerator([resource])
      const types = generator.generateTypes()

      expect(types).toContain('tags: any[]')
    })

    it('should map object type correctly', () => {
      const resource: ResourceDefinition<any> = {
        name: 'items',
        schema: z.object({ $id: z.string(), metadata: z.object({}) }),
        fields: { metadata: { type: 'object', required: true } }
      }
      const generator = new SDKGenerator([resource])
      const types = generator.generateTypes()

      expect(types).toContain('metadata: any')
    })
  })

  describe('Relation generation', () => {
    it('should generate hasMany relation methods', () => {
      const generator = new SDKGenerator([postResource])
      const code = generator.generate()

      expect(code).toContain('comments:')
      expect(code).toContain('list:')
    })

    it('should generate belongsTo relation methods', () => {
      const generator = new SDKGenerator([postResource])
      const code = generator.generate()

      expect(code).toContain('author:')
      expect(code).toContain('get:')
    })

    it('should generate hasOne relation methods', () => {
      const profileResource: ResourceDefinition<any> = {
        name: 'profiles',
        schema: z.object({ $id: z.string(), bio: z.string() }),
        fields: { bio: { type: 'string', required: true } },
        relations: {
          user: { type: 'hasOne', resource: 'users' }
        }
      }
      const generator = new SDKGenerator([profileResource])
      const code = generator.generate()

      expect(code).toContain('user:')
    })
  })

  describe('Action generation', () => {
    it('should generate action methods', () => {
      const generator = new SDKGenerator([postResource])
      const code = generator.generate()

      expect(code).toContain('publish:')
      expect(code).toContain('archive:')
    })

    it('should use correct HTTP method for actions', () => {
      const generator = new SDKGenerator([postResource])
      const code = generator.generate()

      expect(code).toContain("'POST'")
    })

    it('should accept params for actions', () => {
      const generator = new SDKGenerator([postResource])
      const code = generator.generate()

      expect(code).toContain('params?: any')
    })
  })

  describe('Edge cases', () => {
    it('should handle empty resources array', () => {
      const generator = new SDKGenerator([])
      const code = generator.generate()

      expect(code).toContain('// Auto-generated TypeScript SDK')
      expect(code).toContain('export function createClient')
    })

    it('should handle resource without relations', () => {
      const generator = new SDKGenerator([userResource])
      const code = generator.generate()

      expect(code).not.toContain('Relations:')
    })

    it('should handle resource without actions', () => {
      const generator = new SDKGenerator([userResource])
      const code = generator.generate()

      expect(code).not.toContain('Actions:')
    })

    it('should handle resource with no optional fields', () => {
      const strictResource: ResourceDefinition<any> = {
        name: 'strictitems',
        schema: z.object({ $id: z.string(), name: z.string() }),
        fields: {
          name: { type: 'string', required: true }
        }
      }
      const generator = new SDKGenerator([strictResource])
      const types = generator.generateTypes()

      expect(types).toContain('name: string')
      expect(types).not.toContain('name?:')
    })

    it('should handle singular resource name', () => {
      const personResource: ResourceDefinition<any> = {
        name: 'person',
        schema: z.object({ $id: z.string(), name: z.string() }),
        fields: { name: { type: 'string', required: true } }
      }
      const generator = new SDKGenerator([personResource])
      const types = generator.generateTypes()

      expect(types).toContain('interface Person')
    })
  })

  describe('SDK Re-exports from sdk.ts', () => {
    it('should export generateSDKFromOpenAPI function', () => {
      expect(typeof generateSDKFromOpenAPI).toBe('function')
    })

    it('should export SDKFromOpenAPIGenerator class', () => {
      expect(typeof SDKFromOpenAPIGenerator).toBe('function')
    })

    it('should generate SDK from minimal OpenAPI spec', () => {
      const minimalSpec: OpenAPISpec = {
        openapi: '3.0.3',
        info: {
          title: 'Test API',
          version: '1.0.0'
        },
        paths: {},
        components: {}
      }

      const sdk = generateSDKFromOpenAPI(minimalSpec)
      expect(sdk).toContain('createClient')
      expect(sdk).toContain('ClientOptions')
    })

    it('should generate SDK with options', () => {
      const spec: OpenAPISpec = {
        openapi: '3.0.3',
        info: {
          title: 'My API',
          version: '2.0.0'
        },
        paths: {},
        components: {}
      }

      const options: SDKFromOpenAPIOptions = {
        packageName: 'my-custom-sdk',
        includeTimestamp: true
      }

      const sdk = generateSDKFromOpenAPI(spec, options)
      expect(sdk).toContain('my-custom-sdk')
      expect(sdk).toContain('Generated at:')
    })

    it('should create SDKFromOpenAPIGenerator with spec', () => {
      const spec: OpenAPISpec = {
        openapi: '3.0.3',
        info: { title: 'Test', version: '1.0.0' },
        paths: {},
        components: {}
      }

      const generator = new SDKFromOpenAPIGenerator(spec)
      expect(generator).toBeDefined()

      const types = generator.generateTypes()
      expect(types).toContain('APIError')

      const client = generator.generateClient()
      expect(client).toContain('createClient')
    })
  })
})
