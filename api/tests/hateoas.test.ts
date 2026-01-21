import { describe, it, expect } from 'vitest'
import {
  generateLinks,
  generateCollectionLinks,
  withLinks,
  withCollectionLinks,
  generateAPIRootLinks,
  generateAPIRoot,
  generateErrorLinks,
  createErrorResponse,
  // Validation exports
  isValidUrl,
  encodePathSegment,
  buildSafeUrl,
  validateLink,
  validateRequiredLinks,
  validateAllLinks,
  LinkValidationError,
  REQUIRED_RESOURCE_LINKS,
  REQUIRED_COLLECTION_LINKS,
  REQUIRED_ERROR_LINKS
} from '../hateoas'
import { expectValidLink } from '../../test-utils'

describe('HATEOAS Link Generation', () => {
  const baseUrl = 'https://api.example.com'

  describe('generateLinks', () => {
    it('should generate standard CRUD links', () => {
      const links = generateLinks('users', '123', baseUrl)

      expectValidLink(links.self, 'self', 'GET')
      expect(links.self.href).toBe('https://api.example.com/users/123')
      // RFC 8288 uses 'edit' relation for update operations
      expectValidLink(links.update, 'edit', 'PUT')
      expect(links.update.href).toBe('https://api.example.com/users/123')
      expectValidLink(links.delete, 'delete', 'DELETE')
      expectValidLink(links.collection, 'collection', 'GET')
      expect(links.collection.href).toBe('https://api.example.com/users')
    })

    it('should include relation links', () => {
      const links = generateLinks('users', '123', baseUrl, {
        relations: {
          orders: { resource: 'orders', type: 'hasMany' },
          profile: { resource: 'profiles', type: 'hasOne' }
        }
      })

      expect(links.orders.href).toBe('https://api.example.com/users/123/orders')
      expect(links.profile.href).toBe('https://api.example.com/users/123/profile')
    })

    it('should include action links', () => {
      const links = generateLinks('users', '123', baseUrl, {
        actions: ['activate', 'deactivate']
      })

      expect(links.activate.href).toBe('https://api.example.com/users/123/activate')
      expect(links.activate.method).toBe('POST')
      expect(links.deactivate.href).toBe('https://api.example.com/users/123/deactivate')
    })
  })

  describe('generateCollectionLinks', () => {
    it('should generate basic collection links', () => {
      const links = generateCollectionLinks('users', baseUrl)

      expect(links.self.href).toContain('users')
      expect(links.create.href).toBe('https://api.example.com/users')
      expect(links.create.method).toBe('POST')
    })

    it('should include pagination links', () => {
      const links = generateCollectionLinks('users', baseUrl, {
        page: 2,
        limit: 10,
        total: 50
      })

      expect(links.prev.href).toContain('page=1')
      expect(links.next.href).toContain('page=3')
      expect(links.first.href).toContain('page=1')
      expect(links.last.href).toContain('page=5')
    })

    it('should not include prev on first page', () => {
      const links = generateCollectionLinks('users', baseUrl, {
        page: 1,
        limit: 10,
        total: 50
      })

      expect(links.prev).toBeUndefined()
      expect(links.next).toBeDefined()
    })

    it('should not include next on last page', () => {
      const links = generateCollectionLinks('users', baseUrl, {
        page: 5,
        limit: 10,
        total: 50
      })

      expect(links.prev).toBeDefined()
      expect(links.next).toBeUndefined()
    })
  })

  describe('withLinks', () => {
    it('should wrap data with links', () => {
      const data = { id: '123', name: 'Alice' }
      const links = generateLinks('users', '123', baseUrl)

      const result = withLinks(data, links)

      expect(result.data).toEqual(data)
      expect(result._links).toEqual(links)
    })
  })

  describe('withCollectionLinks', () => {
    it('should wrap collection items with individual links', () => {
      const items = [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' }
      ]

      const result = withCollectionLinks(
        items,
        'users',
        baseUrl,
        (item) => item.id
      )

      expect(result.data).toHaveLength(2)
      expect(result.data[0]._links.self.href).toContain('/1')
      expect(result.data[1]._links.self.href).toContain('/2')
      expect(result._links.create).toBeDefined()
    })
  })

  describe('generateAPIRootLinks', () => {
    it('should generate discoverable API root links', () => {
      const links = generateAPIRootLinks({
        baseUrl,
        resources: {
          users: { path: '/users', title: 'Users' },
          orders: { path: '/orders', title: 'Orders' }
        },
        openapi: { json: '/openapi.json' },
        docsPath: '/docs',
        healthPath: '/health'
      })

      expect(links.self.href).toBe('https://api.example.com/')
      expect(links.users.href).toBe('https://api.example.com/users')
      expect(links.users.rel).toBe('collection')
      expect(links.orders.href).toBe('https://api.example.com/orders')
      expect(links.describedby.href).toBe('https://api.example.com/openapi.json')
      expect(links.help.href).toBe('https://api.example.com/docs')
      expect(links.health.href).toBe('https://api.example.com/health')
    })
  })

  describe('generateAPIRoot', () => {
    it('should generate complete API root response', () => {
      const root = generateAPIRoot({
        name: 'My API',
        version: '2.0.0',
        description: 'My awesome API',
        baseUrl
      })

      expect(root.name).toBe('My API')
      expect(root.version).toBe('2.0.0')
      expect(root.description).toBe('My awesome API')
      expect(root._links.self).toBeDefined()
    })
  })

  describe('generateErrorLinks', () => {
    it('should generate error response links', () => {
      const links = generateErrorLinks(baseUrl, {
        docsPath: '/docs',
        healthPath: '/health'
      })

      expect(links.root.href).toBe('https://api.example.com/')
      expect(links.root.rel).toBe('up')
      expect(links.help.href).toBe('https://api.example.com/docs')
      expect(links.health.href).toBe('https://api.example.com/health')
    })
  })

  describe('createErrorResponse', () => {
    it('should create a complete error response', () => {
      const response = createErrorResponse('Not found', 404, baseUrl, {
        docsPath: '/docs',
        healthPath: '/health'
      })

      expect(response.error).toBe('Not found')
      expect(response.status).toBe(404)
      expect(response._links).toBeDefined()
      expect(response._links?.root).toBeDefined()
    })

    it('should include requestId when provided', () => {
      const response = createErrorResponse('Server error', 500, baseUrl, {
        requestId: 'req-123'
      })

      expect(response.requestId).toBe('req-123')
    })

    it('should include details when provided', () => {
      const response = createErrorResponse('Validation error', 400, baseUrl, {
        details: { field: 'email', message: 'Invalid format' }
      })

      expect(response.details).toEqual({ field: 'email', message: 'Invalid format' })
    })
  })
})

// ============================================================================
// URL Validation Tests
// ============================================================================

describe('URL Validation', () => {
  describe('isValidUrl', () => {
    it('should accept valid https URLs', () => {
      expect(isValidUrl('https://api.example.com')).toBe(true)
      expect(isValidUrl('https://api.example.com/path')).toBe(true)
      expect(isValidUrl('https://api.example.com/path?query=1')).toBe(true)
    })

    it('should accept valid http URLs', () => {
      expect(isValidUrl('http://localhost:3000')).toBe(true)
      expect(isValidUrl('http://127.0.0.1')).toBe(true)
    })

    it('should accept relative URLs starting with /', () => {
      expect(isValidUrl('/path')).toBe(true)
      expect(isValidUrl('/path/to/resource')).toBe(true)
      expect(isValidUrl('/')).toBe(true)
    })

    it('should reject javascript: protocol (XSS)', () => {
      expect(isValidUrl('javascript:alert(1)')).toBe(false)
      expect(isValidUrl('JAVASCRIPT:alert(1)')).toBe(false)
      expect(isValidUrl('javascript :alert(1)')).toBe(false)
    })

    it('should reject data: protocol (XSS)', () => {
      expect(isValidUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
      expect(isValidUrl('DATA:text/html,test')).toBe(false)
    })

    it('should reject vbscript: protocol (XSS)', () => {
      expect(isValidUrl('vbscript:msgbox(1)')).toBe(false)
      expect(isValidUrl('VBSCRIPT:test')).toBe(false)
    })

    it('should reject URLs with event handlers (XSS)', () => {
      expect(isValidUrl('http://example.com/?onclick=alert(1)')).toBe(false)
      expect(isValidUrl('/path?onload=evil()')).toBe(false)
    })

    it('should reject URLs with script tags', () => {
      expect(isValidUrl('http://example.com/<script>alert(1)</script>')).toBe(false)
      expect(isValidUrl('/path<script>evil</script>')).toBe(false)
    })

    it('should reject non-http(s) protocols', () => {
      expect(isValidUrl('ftp://example.com')).toBe(false)
      expect(isValidUrl('file:///etc/passwd')).toBe(false)
    })

    it('should reject empty or invalid input', () => {
      expect(isValidUrl('')).toBe(false)
      expect(isValidUrl(null as unknown as string)).toBe(false)
      expect(isValidUrl(undefined as unknown as string)).toBe(false)
      expect(isValidUrl('not a url')).toBe(false)
    })
  })

  describe('encodePathSegment', () => {
    it('should encode special characters', () => {
      expect(encodePathSegment('<script>')).toBe('%3Cscript%3E')
      expect(encodePathSegment('a&b')).toBe('a%26b')
      expect(encodePathSegment('user name')).toBe('user%20name')
    })

    it('should preserve safe characters', () => {
      expect(encodePathSegment('simple')).toBe('simple')
      expect(encodePathSegment('path/to/resource')).toBe('path/to/resource')
    })

    it('should handle empty input', () => {
      expect(encodePathSegment('')).toBe('')
      expect(encodePathSegment(null as unknown as string)).toBe('')
    })
  })

  describe('buildSafeUrl', () => {
    it('should build URLs with encoded path segments', () => {
      const url = buildSafeUrl('https://api.example.com', 'users', '123')
      expect(url).toBe('https://api.example.com/users/123')
    })

    it('should encode special characters in segments', () => {
      const url = buildSafeUrl('https://api.example.com', 'users', '<script>')
      expect(url).toContain('%3Cscript%3E')
    })

    it('should handle trailing slashes in base URL', () => {
      const url = buildSafeUrl('https://api.example.com/', 'users')
      expect(url).toBe('https://api.example.com/users')
    })

    it('should throw for invalid base URL', () => {
      expect(() => buildSafeUrl('javascript:alert(1)', 'path')).toThrow(LinkValidationError)
    })

    it('should skip empty segments', () => {
      const url = buildSafeUrl('https://api.example.com', 'users', '', '123')
      expect(url).toBe('https://api.example.com/users/123')
    })
  })
})

// ============================================================================
// Link Validation Tests
// ============================================================================

describe('Link Validation', () => {
  describe('validateLink', () => {
    it('should accept valid links', () => {
      const validLink = {
        href: 'https://api.example.com/users',
        rel: 'self',
        method: 'GET'
      }
      expect(() => validateLink(validLink, 'self')).not.toThrow()
    })

    it('should reject links without href', () => {
      const invalidLink = { rel: 'self' }
      expect(() => validateLink(invalidLink, 'self')).toThrow(LinkValidationError)
    })

    it('should reject links with invalid href', () => {
      const invalidLink = { href: 'javascript:alert(1)', rel: 'self' }
      expect(() => validateLink(invalidLink, 'self')).toThrow(LinkValidationError)
    })

    it('should reject links without rel', () => {
      const invalidLink = { href: 'https://api.example.com' }
      expect(() => validateLink(invalidLink, 'test')).toThrow(LinkValidationError)
    })

    it('should reject links with invalid method', () => {
      const invalidLink = {
        href: 'https://api.example.com',
        rel: 'self',
        method: 'INVALID'
      }
      expect(() => validateLink(invalidLink, 'test')).toThrow(LinkValidationError)
    })

    it('should accept valid methods', () => {
      const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
      for (const method of methods) {
        const link = { href: 'https://api.example.com', rel: 'self', method }
        expect(() => validateLink(link, 'test')).not.toThrow()
      }
    })
  })

  describe('validateRequiredLinks', () => {
    it('should pass when all required links are present', () => {
      const links = {
        self: { href: 'https://api.example.com/users/1', rel: 'self' },
        update: { href: 'https://api.example.com/users/1', rel: 'edit' }
      }
      expect(() => validateRequiredLinks(links, ['self'])).not.toThrow()
    })

    it('should fail when required links are missing', () => {
      const links = {
        collection: { href: 'https://api.example.com/users', rel: 'collection' }
      }
      expect(() => validateRequiredLinks(links, ['self'])).toThrow(LinkValidationError)
    })
  })

  describe('validateAllLinks', () => {
    it('should return empty array for valid links', () => {
      const links = {
        self: { href: 'https://api.example.com/users/1', rel: 'self' },
        collection: { href: 'https://api.example.com/users', rel: 'collection' }
      }
      const errors = validateAllLinks(links)
      expect(errors).toHaveLength(0)
    })

    it('should return errors for invalid links', () => {
      const links = {
        self: { href: 'javascript:alert(1)', rel: 'self' },
        collection: { href: 'https://api.example.com/users', rel: 'collection' }
      }
      const errors = validateAllLinks(links)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].field).toBe('href')
    })
  })

  describe('Required Link Constants', () => {
    it('should define required resource links', () => {
      expect(REQUIRED_RESOURCE_LINKS).toContain('self')
    })

    it('should define required collection links', () => {
      expect(REQUIRED_COLLECTION_LINKS).toContain('self')
      expect(REQUIRED_COLLECTION_LINKS).toContain('create')
    })

    it('should define required error links', () => {
      expect(REQUIRED_ERROR_LINKS).toContain('root')
    })
  })
})

// ============================================================================
// XSS Prevention Tests
// ============================================================================

describe('XSS Prevention in Link Generation', () => {
  const baseUrl = 'https://api.example.com'

  describe('generateLinks with malicious input', () => {
    it('should encode script tags in resource name', () => {
      const links = generateLinks('<script>alert(1)</script>', '123', baseUrl)
      // The key security assertion: raw script tags should not be in the URL
      expect(links.self.href).not.toContain('<script>')
      expect(links.self.href).not.toContain('</script>')
      // URL should be encoded (exact encoding may vary based on implementation)
      expect(links.self.href).toMatch(/%3C|%253C/) // Either single or double encoded
    })

    it('should encode script tags in id', () => {
      const links = generateLinks('users', '<img onerror=alert(1)>', baseUrl)
      // The key security assertions: dangerous characters should be encoded
      expect(links.self.href).not.toContain('<img')
      expect(links.self.href).not.toContain('=alert')
    })

    it('should encode special characters in action names', () => {
      const links = generateLinks('users', '123', baseUrl, {
        actions: ['<script>evil</script>']
      })
      const actionKey = '<script>evil</script>'
      expect(links[actionKey].href).not.toContain('<script>')
    })

    it('should encode special characters in relation names', () => {
      const links = generateLinks('users', '123', baseUrl, {
        relations: {
          '<script>': { resource: 'evil', type: 'hasMany' }
        }
      })
      const relKey = '<script>'
      expect(links[relKey].href).not.toContain('<script>')
    })
  })

  describe('generateCollectionLinks with malicious input', () => {
    it('should encode script tags in resource name', () => {
      const links = generateCollectionLinks('<script>alert(1)</script>', baseUrl)
      expect(links.self.href).not.toContain('<script>')
    })

    it('should sanitize pagination parameters', () => {
      // Test that negative page numbers are handled
      const links = generateCollectionLinks('users', baseUrl, {
        page: -1,
        limit: -10,
        total: 100
      })
      // Should normalize to positive values
      expect(links.self.href).toContain('page=1')
      expect(links.self.href).toContain('limit=1')
    })

    it('should limit maximum page size', () => {
      const links = generateCollectionLinks('users', baseUrl, {
        page: 1,
        limit: 999999, // Attempt very large limit
        total: 100
      })
      // Should cap at 1000
      expect(links.self.href).toContain('limit=1000')
    })
  })

  describe('generateErrorLinks with malicious input', () => {
    it('should handle invalid base URL gracefully', () => {
      const links = generateErrorLinks('javascript:alert(1)', {
        docsPath: '/docs'
      })
      // Should fall back to relative URL
      expect(links.root.href).toBe('/')
    })

    it('should encode paths in error links', () => {
      const links = generateErrorLinks(baseUrl, {
        docsPath: '/<script>alert(1)</script>'
      })
      expect(links.help?.href).not.toContain('<script>')
    })
  })

  describe('generateAPIRootLinks with malicious input', () => {
    it('should throw for invalid base URL', () => {
      expect(() => generateAPIRootLinks({
        baseUrl: 'javascript:alert(1)'
      })).toThrow(LinkValidationError)
    })

    it('should encode resource paths', () => {
      const links = generateAPIRootLinks({
        baseUrl,
        resources: {
          users: { path: '/<script>users</script>' }
        }
      })
      expect(links.users.href).not.toContain('<script>')
    })
  })
})
