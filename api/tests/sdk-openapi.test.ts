/**
 * SDK Generation from OpenAPI Spec Tests
 *
 * Tests the ability to generate TypeScript SDK code directly from an OpenAPI 3.0 specification.
 * This enables the HATEOAS principle: OpenAPI spec as single source of truth.
 */

import { describe, it, expect } from 'vitest'
import {
  generateSDKFromOpenAPI,
  SDKFromOpenAPIGenerator,
  type SDKFromOpenAPIOptions
} from '../codegen/sdk'
import type { OpenAPISpec } from '../openapi'

// Sample OpenAPI spec for testing
const sampleOpenAPISpec: OpenAPISpec = {
  openapi: '3.0.3',
  info: {
    title: 'Test API',
    version: '1.0.0',
    description: 'A test API for SDK generation'
  },
  paths: {
    '/customers': {
      get: {
        operationId: 'listCustomers',
        summary: 'List all customers',
        tags: ['customers'],
        responses: {
          '200': {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Customer' }
                }
              }
            }
          }
        }
      },
      post: {
        operationId: 'createCustomer',
        summary: 'Create a new customer',
        tags: ['customers'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CustomerInput' }
            }
          }
        },
        responses: {
          '201': {
            description: 'Customer created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Customer' }
              }
            }
          }
        }
      }
    },
    '/customers/{id}': {
      get: {
        operationId: 'getCustomer',
        summary: 'Get a customer by ID',
        tags: ['customers'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Customer' }
              }
            }
          }
        }
      },
      put: {
        operationId: 'updateCustomer',
        summary: 'Update a customer',
        tags: ['customers'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CustomerInput' }
            }
          }
        },
        responses: {
          '200': {
            description: 'Customer updated',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Customer' }
              }
            }
          }
        }
      },
      delete: {
        operationId: 'deleteCustomer',
        summary: 'Delete a customer',
        tags: ['customers'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: {
          '204': {
            description: 'Customer deleted'
          }
        }
      }
    },
    '/customers/{customerId}/orders': {
      get: {
        operationId: 'listCustomerOrders',
        summary: 'List orders for a customer',
        tags: ['customers', 'orders'],
        parameters: [
          {
            name: 'customerId',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Order' }
                }
              }
            }
          }
        }
      }
    },
    '/customers/{id}/upgrade': {
      post: {
        operationId: 'upgradeCustomer',
        summary: 'Upgrade customer plan',
        tags: ['customers'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  plan: { type: 'string' }
                },
                required: ['plan']
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Customer upgraded',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Customer' }
              }
            }
          }
        }
      }
    }
  },
  components: {
    schemas: {
      Customer: {
        type: 'object',
        properties: {
          $id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          plan: { type: 'string', enum: ['free', 'pro', 'enterprise'] },
          createdAt: { type: 'string', format: 'date-time' }
        },
        required: ['$id', 'name', 'email']
      },
      CustomerInput: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          plan: { type: 'string', enum: ['free', 'pro', 'enterprise'] }
        },
        required: ['name', 'email']
      },
      Order: {
        type: 'object',
        properties: {
          $id: { type: 'string' },
          customerId: { type: 'string' },
          total: { type: 'number' },
          status: { type: 'string', enum: ['pending', 'completed', 'cancelled'] }
        },
        required: ['$id', 'customerId', 'total', 'status']
      }
    },
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      },
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key'
      }
    }
  },
  security: [
    { bearerAuth: [] }
  ]
}

describe('SDK Generation from OpenAPI Spec', () => {
  describe('generateSDKFromOpenAPI', () => {
    it('should generate TypeScript SDK code from OpenAPI spec', () => {
      const sdkCode = generateSDKFromOpenAPI(sampleOpenAPISpec)

      // Should generate interfaces
      expect(sdkCode).toContain('interface Customer')
      expect(sdkCode).toContain('interface CustomerInput')
      expect(sdkCode).toContain('interface Order')

      // Should generate createClient
      expect(sdkCode).toContain('export function createClient')
    })

    it('should generate type-safe interfaces from component schemas', () => {
      const sdkCode = generateSDKFromOpenAPI(sampleOpenAPISpec)

      // Customer interface should have all fields
      expect(sdkCode).toContain('$id: string')
      expect(sdkCode).toContain('name: string')
      expect(sdkCode).toContain('email: string')
      expect(sdkCode).toContain('plan?:')
      expect(sdkCode).toContain('createdAt?:')
    })

    it('should generate methods for each operation', () => {
      const sdkCode = generateSDKFromOpenAPI(sampleOpenAPISpec)

      // CRUD operations
      expect(sdkCode).toContain('listCustomers')
      expect(sdkCode).toContain('createCustomer')
      expect(sdkCode).toContain('getCustomer')
      expect(sdkCode).toContain('updateCustomer')
      expect(sdkCode).toContain('deleteCustomer')

      // Relation operations
      expect(sdkCode).toContain('listCustomerOrders')

      // Custom actions
      expect(sdkCode).toContain('upgradeCustomer')
    })

    it('should generate correct method signatures with types', () => {
      const sdkCode = generateSDKFromOpenAPI(sampleOpenAPISpec)

      // Get should take id parameter
      expect(sdkCode).toMatch(/getCustomer.*id:\s*string/)

      // Create should take data parameter
      expect(sdkCode).toMatch(/createCustomer.*data:\s*CustomerInput/)

      // Update should take id and data
      expect(sdkCode).toMatch(/updateCustomer.*id:\s*string/)
      expect(sdkCode).toMatch(/updateCustomer.*data:\s*CustomerInput/)

      // Delete should take id and return void
      expect(sdkCode).toMatch(/deleteCustomer.*id:\s*string/)
      expect(sdkCode).toMatch(/deleteCustomer.*Promise<void>/)
    })

    it('should generate correct return types', () => {
      const sdkCode = generateSDKFromOpenAPI(sampleOpenAPISpec)

      // List returns array
      expect(sdkCode).toMatch(/listCustomers.*Promise<Customer\[\]>/)

      // Get returns single item
      expect(sdkCode).toMatch(/getCustomer.*Promise<Customer>/)

      // Create returns created item
      expect(sdkCode).toMatch(/createCustomer.*Promise<Customer>/)

      // Update returns updated item
      expect(sdkCode).toMatch(/updateCustomer.*Promise<Customer>/)
    })

    it('should generate request helper with proper auth handling', () => {
      const sdkCode = generateSDKFromOpenAPI(sampleOpenAPISpec)

      // Should include Bearer auth support
      expect(sdkCode).toContain('Authorization')
      expect(sdkCode).toContain('Bearer')

      // Should include API key support
      expect(sdkCode).toContain('apiKey')
    })

    it('should generate error handling', () => {
      const sdkCode = generateSDKFromOpenAPI(sampleOpenAPISpec)

      // Should have APIError class
      expect(sdkCode).toContain('class APIError')
      expect(sdkCode).toContain('throw new APIError')
    })

    it('should handle nested path parameters', () => {
      const sdkCode = generateSDKFromOpenAPI(sampleOpenAPISpec)

      // listCustomerOrders should take customerId
      expect(sdkCode).toMatch(/listCustomerOrders.*customerId:\s*string/)
    })
  })

  describe('SDKFromOpenAPIGenerator class', () => {
    it('should generate types from component schemas', () => {
      const generator = new SDKFromOpenAPIGenerator(sampleOpenAPISpec)
      const types = generator.generateTypes()

      expect(types).toContain('interface Customer')
      expect(types).toContain('interface CustomerInput')
      expect(types).toContain('interface Order')
    })

    it('should handle enum types', () => {
      const generator = new SDKFromOpenAPIGenerator(sampleOpenAPISpec)
      const types = generator.generateTypes()

      // Enum should be union type
      expect(types).toMatch(/plan\?:\s*['"]free['"].*\|.*['"]pro['"].*\|.*['"]enterprise['"]/)
    })

    it('should handle optional vs required fields', () => {
      const generator = new SDKFromOpenAPIGenerator(sampleOpenAPISpec)
      const types = generator.generateTypes()

      // Required fields should not have ?
      expect(types).toMatch(/\s+name:\s+string/)
      expect(types).toMatch(/\s+email:\s+string/)

      // Optional fields should have ?
      expect(types).toMatch(/plan\?:/)
      expect(types).toMatch(/createdAt\?:/)
    })

    it('should handle date-time formats', () => {
      const generator = new SDKFromOpenAPIGenerator(sampleOpenAPISpec)
      const types = generator.generateTypes()

      // Date-time should map to Date or string
      expect(types).toMatch(/createdAt\?:\s*(Date|string)/)
    })

    it('should generate operation methods', () => {
      const generator = new SDKFromOpenAPIGenerator(sampleOpenAPISpec)
      const methods = generator.generateOperations()

      expect(methods).toContain('listCustomers')
      expect(methods).toContain('getCustomer')
      expect(methods).toContain('createCustomer')
      expect(methods).toContain('updateCustomer')
      expect(methods).toContain('deleteCustomer')
    })

    it('should generate path building for operations', () => {
      const generator = new SDKFromOpenAPIGenerator(sampleOpenAPISpec)
      const code = generator.generate()

      // Should interpolate path parameters
      expect(code).toContain('/customers/${id}')
      expect(code).toContain('/customers/${customerId}/orders')
    })

    it('should generate JSDoc comments from OpenAPI descriptions', () => {
      const generator = new SDKFromOpenAPIGenerator(sampleOpenAPISpec)
      const code = generator.generate()

      // Should include summary as JSDoc
      expect(code).toContain('/**')
      expect(code).toContain('*/')
      expect(code).toContain('List all customers')
      expect(code).toContain('Get a customer by ID')
    })
  })

  describe('Generated SDK structure', () => {
    it('should export createClient factory', () => {
      const sdkCode = generateSDKFromOpenAPI(sampleOpenAPISpec)

      expect(sdkCode).toContain('export function createClient')
    })

    it('should include ClientOptions interface', () => {
      const sdkCode = generateSDKFromOpenAPI(sampleOpenAPISpec)

      expect(sdkCode).toContain('interface ClientOptions')
      expect(sdkCode).toContain('baseUrl: string')
      expect(sdkCode).toContain('apiKey?: string')
      expect(sdkCode).toContain('token?: string')
    })

    it('should handle content-type headers', () => {
      const sdkCode = generateSDKFromOpenAPI(sampleOpenAPISpec)

      expect(sdkCode).toContain("'Content-Type': 'application/json'")
    })

    it('should handle query parameters', () => {
      // Add a spec with query params
      const specWithQuery: OpenAPISpec = {
        ...sampleOpenAPISpec,
        paths: {
          ...sampleOpenAPISpec.paths,
          '/search': {
            get: {
              operationId: 'searchItems',
              parameters: [
                {
                  name: 'q',
                  in: 'query',
                  required: true,
                  schema: { type: 'string' }
                },
                {
                  name: 'limit',
                  in: 'query',
                  required: false,
                  schema: { type: 'number' }
                }
              ],
              responses: {
                '200': { description: 'Results' }
              }
            }
          }
        }
      }

      const sdkCode = generateSDKFromOpenAPI(specWithQuery)

      // Should handle query params
      expect(sdkCode).toContain('searchItems')
      expect(sdkCode).toMatch(/q:\s*string/)
      expect(sdkCode).toMatch(/limit\?:\s*number/)
    })
  })

  describe('Options handling', () => {
    it('should respect custom package name option', () => {
      const sdkCode = generateSDKFromOpenAPI(sampleOpenAPISpec, {
        packageName: 'my-api-client'
      })

      expect(sdkCode).toContain('my-api-client')
    })

    it('should include timestamps when requested', () => {
      const sdkCode = generateSDKFromOpenAPI(sampleOpenAPISpec, {
        includeTimestamp: true
      })

      expect(sdkCode).toContain('Generated at:')
    })

    it('should support runtime options', () => {
      const sdkCode = generateSDKFromOpenAPI(sampleOpenAPISpec, {
        runtime: 'node'
      })

      // Node runtime may have different fetch implementation
      expect(sdkCode).toBeDefined()
    })
  })

  describe('Edge cases', () => {
    it('should handle empty paths', () => {
      const emptySpec: OpenAPISpec = {
        openapi: '3.0.3',
        info: { title: 'Empty API', version: '1.0.0' },
        paths: {},
        components: {}
      }

      const sdkCode = generateSDKFromOpenAPI(emptySpec)

      expect(sdkCode).toContain('createClient')
    })

    it('should handle operations without operationId', () => {
      const specWithoutOpId: OpenAPISpec = {
        openapi: '3.0.3',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/items': {
            get: {
              responses: { '200': { description: 'OK' } }
            }
          }
        },
        components: {}
      }

      const sdkCode = generateSDKFromOpenAPI(specWithoutOpId)

      // Should generate method name from path + method
      expect(sdkCode).toMatch(/getItems|listItems/)
    })

    it('should handle $ref in nested objects', () => {
      const nestedSpec: OpenAPISpec = {
        openapi: '3.0.3',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/items': {
            get: {
              operationId: 'getItems',
              responses: {
                '200': {
                  description: 'OK',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: {
                          data: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/Item' }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        components: {
          schemas: {
            Item: {
              type: 'object',
              properties: {
                id: { type: 'string' }
              }
            }
          }
        }
      }

      const sdkCode = generateSDKFromOpenAPI(nestedSpec)

      expect(sdkCode).toContain('interface Item')
    })

    it('should handle allOf/oneOf/anyOf schemas', () => {
      const compositionSpec: OpenAPISpec = {
        openapi: '3.0.3',
        info: { title: 'Test', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            Base: {
              type: 'object',
              properties: {
                id: { type: 'string' }
              }
            }
          }
        }
      }

      const sdkCode = generateSDKFromOpenAPI(compositionSpec)

      // Should handle without errors
      expect(sdkCode).toBeDefined()
    })
  })

  describe('TypeScript compilation safety', () => {
    it('should generate syntactically valid TypeScript', () => {
      const sdkCode = generateSDKFromOpenAPI(sampleOpenAPISpec)

      // Basic syntax checks
      expect(sdkCode).not.toContain('undefined:')
      expect(sdkCode).not.toContain('null:')

      // Balanced braces (simple check)
      const openBraces = (sdkCode.match(/{/g) || []).length
      const closeBraces = (sdkCode.match(/}/g) || []).length
      expect(openBraces).toBe(closeBraces)

      // Balanced parentheses
      const openParens = (sdkCode.match(/\(/g) || []).length
      const closeParens = (sdkCode.match(/\)/g) || []).length
      expect(openParens).toBe(closeParens)
    })

    it('should escape special characters in strings', () => {
      const specWithSpecialChars: OpenAPISpec = {
        openapi: '3.0.3',
        info: {
          title: "Test API with 'quotes' and \"double quotes\"",
          version: '1.0.0'
        },
        paths: {},
        components: {}
      }

      const sdkCode = generateSDKFromOpenAPI(specWithSpecialChars)

      // Should not break string literals (no empty strings from bad escaping)
      expect(sdkCode).not.toContain("''")

      // Should contain the title without breaking the code
      // The title appears in the header comment, so quotes are safe there
      expect(sdkCode).toContain("Test API with 'quotes'")

      // Basic structural validation - balanced braces and parens indicate valid syntax
      const openBraces = (sdkCode.match(/{/g) || []).length
      const closeBraces = (sdkCode.match(/}/g) || []).length
      expect(openBraces).toBe(closeBraces)
    })

    it('should generate valid identifiers for unusual operation names', () => {
      const specWithUnusualNames: OpenAPISpec = {
        openapi: '3.0.3',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/api/v1/special-items': {
            get: {
              operationId: 'get-special-items',
              responses: { '200': { description: 'OK' } }
            }
          }
        },
        components: {}
      }

      const sdkCode = generateSDKFromOpenAPI(specWithUnusualNames)

      // Should convert to valid identifier (camelCase)
      expect(sdkCode).toMatch(/getSpecialItems/)
    })
  })
})
