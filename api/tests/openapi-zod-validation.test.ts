/**
 * @file openapi-zod-validation.test.ts
 * @description Tests for Zod schema validation in OpenAPI generator
 *
 * Issue: do-nta6
 *
 * These tests demonstrate potential security and robustness issues
 * when processing untrusted or malformed Zod schemas in the OpenAPI generator.
 * The zodToOpenAPI method directly accesses internal _def properties without
 * validation, which can lead to unexpected behavior or crashes.
 */

import { describe, it, expect } from 'vitest'
import { OpenAPIGenerator, generateOpenAPI } from '../openapi'
import { Hono } from 'hono'
import { z } from 'zod'

describe('OpenAPI Zod Validation Security', () => {
  describe('Untrusted schema handling', () => {
    it('should handle malformed _def structure without crashing', () => {
      const generator = new OpenAPIGenerator()

      // Simulate an untrusted schema with a malformed _def
      const malformedSchema = {
        _def: {
          typeName: 'ZodObject',
          shape: () => {
            throw new Error('Malicious shape function')
          }
        }
      } as any

      // This should not throw, but currently it will
      expect(() => {
        generator.zodToOpenAPI(malformedSchema)
      }).not.toThrow()
    })

    it('should validate schema has required _def property', () => {
      const generator = new OpenAPIGenerator()

      // Schema without _def
      const invalidSchema = {} as any

      // Should handle gracefully, not crash with "Cannot read properties of undefined"
      expect(() => {
        generator.zodToOpenAPI(invalidSchema)
      }).not.toThrow()
    })

    it('should handle null or undefined schema', () => {
      const generator = new OpenAPIGenerator()

      // These should be handled gracefully
      expect(() => {
        generator.zodToOpenAPI(null as any)
      }).not.toThrow()

      expect(() => {
        generator.zodToOpenAPI(undefined as any)
      }).not.toThrow()
    })

    it('should handle _def with missing typeName', () => {
      const generator = new OpenAPIGenerator()

      const schemaWithoutTypeName = {
        _def: {}
      } as any

      // Should return a safe default, not fail silently or crash
      const result = generator.zodToOpenAPI(schemaWithoutTypeName)
      expect(result).toBeDefined()
      expect(result.type).toBeDefined()
    })

    it('should handle ZodObject with non-function shape', () => {
      const generator = new OpenAPIGenerator()

      // shape should be a function, but what if it's not?
      const badObjectSchema = {
        _def: {
          typeName: 'ZodObject',
          shape: { name: 'not a function' } // should be shape()
        }
      } as any

      expect(() => {
        generator.zodToOpenAPI(badObjectSchema)
      }).not.toThrow()
    })

    it('should handle deeply nested malicious schemas', () => {
      const generator = new OpenAPIGenerator()

      // Create a schema that could cause stack overflow via circular reference
      const circularDef: any = {
        typeName: 'ZodObject',
        shape: () => ({
          recursive: { _def: circularDef }
        })
      }

      const circularSchema = { _def: circularDef } as any

      // Should handle circular references gracefully
      // This test demonstrates the vulnerability - it may hang or crash
      expect(() => {
        generator.zodToOpenAPI(circularSchema)
      }).not.toThrow()
    })

    it('should sanitize schema property names to prevent injection', () => {
      const generator = new OpenAPIGenerator()

      // Property names with special characters that could be problematic
      const dangerousSchema = z.object({
        'normal': z.string(),
        '__proto__': z.string(),
        'constructor': z.string(),
        '$ref': z.string(), // Could conflict with OpenAPI $ref
      })

      const result = generator.zodToOpenAPI(dangerousSchema)

      // The $ref property in schema properties could be confused with OpenAPI references
      // This should be handled safely
      expect(result.properties).toBeDefined()
      // Property names that could cause prototype pollution should be sanitized or rejected
      expect(result.properties?.['__proto__']).toBeDefined() // Should be handled safely
    })

    it('should limit recursion depth for deeply nested schemas', () => {
      const generator = new OpenAPIGenerator()

      // Create a very deeply nested schema
      let deepSchema: z.ZodTypeAny = z.string()
      for (let i = 0; i < 100; i++) {
        deepSchema = z.object({ nested: deepSchema })
      }

      // Should complete without stack overflow
      // Should potentially return a limited depth result or error gracefully
      expect(() => {
        generator.zodToOpenAPI(deepSchema)
      }).not.toThrow()
    })
  })

  describe('generateOpenAPI with untrusted schemas', () => {
    it('should validate schemas before processing', () => {
      const app = new Hono()

      // Attempt to register an invalid schema
      expect(() => {
        generateOpenAPI({
          app,
          schemas: {
            'MalformedSchema': null as any
          }
        })
      }).not.toThrow()
    })

    it('should handle schemas with getter traps', () => {
      const app = new Hono()

      // Create a schema with a getter that throws
      const trapSchema = new Proxy({}, {
        get(target, prop) {
          if (prop === '_def') {
            return {
              typeName: 'ZodString'
            }
          }
          throw new Error('Trap triggered')
        }
      }) as any

      expect(() => {
        generateOpenAPI({
          app,
          schemas: {
            'TrapSchema': trapSchema
          }
        })
      }).not.toThrow()
    })

    it('should reject schemas with unsafe default value functions', () => {
      const generator = new OpenAPIGenerator()

      // A ZodDefault where defaultValue() has side effects
      const unsafeDefaultSchema = {
        _def: {
          typeName: 'ZodDefault',
          innerType: { _def: { typeName: 'ZodString' } },
          defaultValue: () => {
            // This could have side effects in real attack scenarios
            throw new Error('Side effect triggered during schema processing')
          }
        }
      } as any

      // Should handle this gracefully - don't call defaultValue() blindly
      expect(() => {
        generator.zodToOpenAPI(unsafeDefaultSchema)
      }).not.toThrow()
    })

    it('should handle ZodArray with undefined type property', () => {
      const generator = new OpenAPIGenerator()

      const badArraySchema = {
        _def: {
          typeName: 'ZodArray',
          type: undefined // should be the inner type
        }
      } as any

      expect(() => {
        generator.zodToOpenAPI(badArraySchema)
      }).not.toThrow()
    })

    it('should handle ZodOptional with undefined innerType', () => {
      const generator = new OpenAPIGenerator()

      const badOptionalSchema = {
        _def: {
          typeName: 'ZodOptional',
          innerType: undefined
        }
      } as any

      expect(() => {
        generator.zodToOpenAPI(badOptionalSchema)
      }).not.toThrow()
    })
  })

  describe('Schema registration security', () => {
    it('should sanitize schema names to prevent path traversal in $ref', () => {
      const generator = new OpenAPIGenerator()

      // Schema name that could be used for path traversal in $ref
      const dangerousName = '../../../etc/passwd'
      generator.registerSchema(dangerousName, z.string())

      const schemas = generator.getSchemas()

      // The name should be sanitized or the registration should fail
      // Currently this allows arbitrary names which end up in $ref paths
      expect(Object.keys(schemas)).not.toContain(dangerousName)
    })

    it('should prevent schema name collision attacks', () => {
      const generator = new OpenAPIGenerator()

      // Register a schema
      generator.registerSchema('User', z.object({ name: z.string() }))

      // Attempt to overwrite with a different schema
      generator.registerSchema('User', z.object({ malicious: z.boolean() }))

      const schemas = generator.getSchemas()

      // Should either prevent overwrite or at least warn
      // Currently silently overwrites which could be a security issue
      expect(schemas.User.properties).toHaveProperty('name')
    })
  })
})
