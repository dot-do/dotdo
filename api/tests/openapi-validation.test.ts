/**
 * @file openapi-validation.test.ts
 * @description Tests for input validation in OpenAPI functions
 *
 * Issue: do-8ak1b
 *
 * Tests for:
 * - specToYAML input validation
 * - createSwaggerUI XSS prevention
 */

import { describe, it, expect } from 'vitest'
import { specToYAML, createSwaggerUI, type OpenAPISpec } from '../openapi'

describe('OpenAPI Input Validation', () => {
  describe('specToYAML validation', () => {
    it('should throw on null input', () => {
      expect(() => {
        specToYAML(null as any)
      }).toThrow(/Invalid OpenAPI spec/)
    })

    it('should throw on undefined input', () => {
      expect(() => {
        specToYAML(undefined as any)
      }).toThrow(/Invalid OpenAPI spec/)
    })

    it('should throw on non-object input', () => {
      expect(() => {
        specToYAML('not an object' as any)
      }).toThrow(/Invalid OpenAPI spec/)

      expect(() => {
        specToYAML(123 as any)
      }).toThrow(/Invalid OpenAPI spec/)

      expect(() => {
        specToYAML(true as any)
      }).toThrow(/Invalid OpenAPI spec/)
    })

    it('should throw on array input', () => {
      expect(() => {
        specToYAML([] as any)
      }).toThrow(/Invalid OpenAPI spec/)
    })

    it('should throw on spec missing openapi field', () => {
      expect(() => {
        specToYAML({
          info: { title: 'Test', version: '1.0.0' },
          paths: {},
          components: { schemas: {} }
        } as any)
      }).toThrow(/Missing required field: openapi/)
    })

    it('should throw on spec missing info field', () => {
      expect(() => {
        specToYAML({
          openapi: '3.0.3',
          paths: {},
          components: { schemas: {} }
        } as any)
      }).toThrow(/Missing required field: info/)
    })

    it('should throw on spec missing paths field', () => {
      expect(() => {
        specToYAML({
          openapi: '3.0.3',
          info: { title: 'Test', version: '1.0.0' },
          components: { schemas: {} }
        } as any)
      }).toThrow(/Missing required field: paths/)
    })

    it('should throw on spec missing components field', () => {
      expect(() => {
        specToYAML({
          openapi: '3.0.3',
          info: { title: 'Test', version: '1.0.0' },
          paths: {}
        } as any)
      }).toThrow(/Missing required field: components/)
    })

    it('should accept valid OpenAPI spec', () => {
      const validSpec: OpenAPISpec = {
        openapi: '3.0.3',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {},
        components: { schemas: {} }
      }

      const yaml = specToYAML(validSpec)
      expect(yaml).toContain('openapi: 3.0.3')
      expect(yaml).toContain('title: Test API')
    })

    it('should handle spec with all optional fields', () => {
      const fullSpec: OpenAPISpec = {
        openapi: '3.0.3',
        info: {
          title: 'Test API',
          version: '1.0.0',
          description: 'A test API',
          termsOfService: 'https://example.com/terms',
          contact: { name: 'Support', email: 'support@example.com' },
          license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' }
        },
        servers: [{ url: 'https://api.example.com', description: 'Production' }],
        paths: {
          '/users': {
            get: {
              summary: 'List users',
              responses: { '200': { description: 'Success' } }
            }
          }
        },
        components: {
          schemas: {},
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer' }
          }
        },
        security: [{ bearerAuth: [] }],
        tags: [{ name: 'Users', description: 'User operations' }]
      }

      expect(() => specToYAML(fullSpec)).not.toThrow()
    })
  })

  describe('createSwaggerUI XSS prevention', () => {
    it('should escape quotes in specUrl', () => {
      const maliciousUrl = '/api\'); alert(\'xss\'); //'
      const html = createSwaggerUI(maliciousUrl)

      // Should not contain unescaped quotes that could break out of the string
      expect(html).not.toContain("url: '/api'); alert('xss');")
      // Should contain escaped version
      expect(html).toContain('url:')
    })

    it('should escape HTML tags in specUrl', () => {
      const maliciousUrl = '</script><script>alert("xss")</script>'
      const html = createSwaggerUI(maliciousUrl)

      // Should not contain raw script tags
      expect(html).not.toContain('<script>alert("xss")</script>')
    })

    it('should escape backslashes in specUrl', () => {
      const maliciousUrl = '/api\\"; alert("xss"); //'
      const html = createSwaggerUI(maliciousUrl)

      // Should handle backslash escaping properly
      expect(html).toContain('url:')
    })

    it('should escape newlines in specUrl', () => {
      const maliciousUrl = '/api\n"; alert("xss"); //'
      const html = createSwaggerUI(maliciousUrl)

      // Should not allow newlines to break out of the string literal
      expect(html).not.toContain('alert("xss")')
    })

    it('should handle javascript: protocol attempts', () => {
      const maliciousUrl = 'javascript:alert("xss")'
      const html = createSwaggerUI(maliciousUrl)

      // The URL will still be included but should be escaped
      // Swagger UI's fetch won't execute javascript: URLs
      expect(html).toContain('url:')
    })

    it('should handle data: URI attempts', () => {
      const maliciousUrl = 'data:text/html,<script>alert("xss")</script>'
      const html = createSwaggerUI(maliciousUrl)

      // Should be escaped and not executable
      expect(html).toContain('url:')
    })

    it('should properly escape single quotes', () => {
      const urlWithQuotes = "/api/spec's.json"
      const html = createSwaggerUI(urlWithQuotes)

      // Should be properly escaped
      expect(html).toContain('url:')
      // Should not break out of the string
      expect(html.match(/url:\s*'/g)?.length).toBe(1) // Only one opening quote
    })

    it('should work with normal URLs', () => {
      const normalUrl = '/openapi.json'
      const html = createSwaggerUI(normalUrl)

      expect(html).toContain("url: '/openapi.json'")
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('swagger-ui')
    })

    it('should work with absolute URLs', () => {
      const absoluteUrl = 'https://api.example.com/openapi.json'
      const html = createSwaggerUI(absoluteUrl)

      expect(html).toContain("url: 'https://api.example.com/openapi.json'")
    })

    it('should work with query parameters in URL', () => {
      const urlWithParams = '/openapi.json?version=1.0&format=json'
      const html = createSwaggerUI(urlWithParams)

      expect(html).toContain("url: '/openapi.json?version=1.0&amp;format=json'")
    })
  })
})
