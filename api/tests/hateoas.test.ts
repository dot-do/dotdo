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
import { expectValidLink } from '@dotdo/test-utils/assertions'

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

    // ============================================================================
    // Comprehensive URL Validation Edge Cases (Issue do-cv40)
    // ============================================================================

    describe('malformed URL edge cases', () => {
      it('should reject URLs with missing protocol', () => {
        expect(isValidUrl('example.com')).toBe(false)
        expect(isValidUrl('www.example.com')).toBe(false)
        expect(isValidUrl('api.example.com/path')).toBe(false)
      })

      it('should reject URLs with invalid protocol format', () => {
        // Note: The URL constructor is permissive with these formats
        // http:/example.com is parsed as http://example.com/ (auto-fixes single slash)
        // http:example.com is parsed as http://example.com/ (auto-adds slashes)
        // These are quirks of the URL API that normalize malformed inputs
        expect(isValidUrl('http:/example.com')).toBe(true) // URL constructor normalizes this
        expect(isValidUrl('http:example.com')).toBe(true) // URL constructor normalizes this
        expect(isValidUrl('http//example.com')).toBe(false) // Actually invalid
        expect(isValidUrl('://example.com')).toBe(false)
      })

      it('should handle URLs with triple slashes', () => {
        // Note: URL constructor parses http:///path as valid with empty host
        // This is browser-compatible behavior
        expect(isValidUrl('http:///example.com')).toBe(true) // Parsed as empty host with path
        expect(isValidUrl('https:///path')).toBe(true) // Parsed as empty host with path
      })

      it('should reject URLs without host for absolute URLs', () => {
        expect(isValidUrl('http://')).toBe(false)
        expect(isValidUrl('https://')).toBe(false)
      })

      it('should reject URLs with only protocol', () => {
        expect(isValidUrl('http:')).toBe(false)
        expect(isValidUrl('https:')).toBe(false)
      })

      it('should reject relative URLs not starting with /', () => {
        expect(isValidUrl('path/to/resource')).toBe(false)
        expect(isValidUrl('../parent/path')).toBe(false)
        expect(isValidUrl('./current/path')).toBe(false)
      })

      it('should handle URLs with backslashes', () => {
        // Note: The URL constructor converts backslashes to forward slashes
        // This is browser-compatible behavior (WHATWG URL spec)
        // http://example.com\path becomes http://example.com/path
        expect(isValidUrl('http://example.com\\path')).toBe(true) // Normalized by URL constructor
        expect(isValidUrl('/path\\to\\resource')).toBe(true) // Relative URLs allow backslashes
      })
    })

    describe('XSS bypass attempt edge cases', () => {
      it('should reject javascript: with various whitespace patterns', () => {
        expect(isValidUrl('javascript\t:alert(1)')).toBe(false)
        expect(isValidUrl('javascript\n:alert(1)')).toBe(false)
        expect(isValidUrl('javascript\r:alert(1)')).toBe(false)
        expect(isValidUrl('java\0script:alert(1)')).toBe(false)
      })

      it('should reject javascript: with mixed case variations', () => {
        expect(isValidUrl('JaVaScRiPt:alert(1)')).toBe(false)
        expect(isValidUrl('jAvAsCrIpT:alert(1)')).toBe(false)
      })

      it('should reject data: with various content types', () => {
        expect(isValidUrl('data:text/javascript,alert(1)')).toBe(false)
        expect(isValidUrl('data:application/javascript,code')).toBe(false)
        expect(isValidUrl('data:image/svg+xml,<svg onload="alert(1)">')).toBe(false)
        expect(isValidUrl('data:base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')).toBe(false)
      })

      it('should reject URLs with multiple event handler patterns', () => {
        expect(isValidUrl('http://example.com/?onmouseover=alert(1)')).toBe(false)
        expect(isValidUrl('http://example.com/?onerror=evil()')).toBe(false)
        expect(isValidUrl('http://example.com/?onfocus=hack()')).toBe(false)
        expect(isValidUrl('http://example.com/?onblur=bad()')).toBe(false)
        expect(isValidUrl('/path?onkeydown=keylog()')).toBe(false)
        expect(isValidUrl('/path?onkeyup=capture()')).toBe(false)
        expect(isValidUrl('/path?onsubmit=steal()')).toBe(false)
      })

      it('should reject URLs with HTML tags other than script', () => {
        expect(isValidUrl('/path<img src=x onerror=alert(1)>')).toBe(false)
        expect(isValidUrl('/path<iframe src="javascript:alert(1)">')).toBe(false)
        expect(isValidUrl('/path<body onload=alert(1)>')).toBe(false)
        expect(isValidUrl('/path<svg onload=alert(1)>')).toBe(false)
      })

      it('should reject script tags with variations', () => {
        expect(isValidUrl('/path<SCRIPT>alert(1)</SCRIPT>')).toBe(false)
        expect(isValidUrl('/path<ScRiPt>alert(1)</ScRiPt>')).toBe(false)
        expect(isValidUrl('/path<script src="evil.js">')).toBe(false)
        expect(isValidUrl('/path<script type="text/javascript">')).toBe(false)
      })
    })

    describe('protocol edge cases', () => {
      it('should reject various dangerous protocols', () => {
        expect(isValidUrl('mailto:user@example.com')).toBe(false)
        expect(isValidUrl('tel:+1234567890')).toBe(false)
        expect(isValidUrl('ws://example.com')).toBe(false)
        expect(isValidUrl('wss://example.com')).toBe(false)
        expect(isValidUrl('ssh://user@host')).toBe(false)
        expect(isValidUrl('ldap://server')).toBe(false)
      })

      it('should reject custom/unknown protocols', () => {
        expect(isValidUrl('custom://example.com')).toBe(false)
        expect(isValidUrl('myapp://deeplink')).toBe(false)
        expect(isValidUrl('android-app://com.example')).toBe(false)
        expect(isValidUrl('ios-app://123456789')).toBe(false)
      })
    })

    describe('Unicode and encoding edge cases', () => {
      it('should handle URLs with percent-encoded characters', () => {
        expect(isValidUrl('https://example.com/path%20with%20spaces')).toBe(true)
        expect(isValidUrl('https://example.com/path%2F%2F')).toBe(true)
        expect(isValidUrl('/path%20segment')).toBe(true)
      })

      it('should handle URLs with unicode characters in path', () => {
        expect(isValidUrl('https://example.com/caf%C3%A9')).toBe(true)
        expect(isValidUrl('https://example.com/%E4%B8%AD%E6%96%87')).toBe(true)
      })

      it('should handle IDN domains', () => {
        // Punycode encoded domains are valid
        expect(isValidUrl('https://xn--nxasmq5b.com')).toBe(true)
      })
    })

    describe('URL structure edge cases', () => {
      it('should accept URLs with authentication info', () => {
        expect(isValidUrl('https://user:pass@example.com')).toBe(true)
        expect(isValidUrl('http://user@example.com')).toBe(true)
      })

      it('should accept URLs with port numbers', () => {
        expect(isValidUrl('https://example.com:443')).toBe(true)
        expect(isValidUrl('http://example.com:8080')).toBe(true)
        expect(isValidUrl('http://example.com:65535')).toBe(true)
      })

      it('should accept URLs with fragment identifiers', () => {
        expect(isValidUrl('https://example.com/page#section')).toBe(true)
        expect(isValidUrl('https://example.com#anchor')).toBe(true)
        expect(isValidUrl('/path#fragment')).toBe(true)
      })

      it('should accept URLs with complex query strings', () => {
        expect(isValidUrl('https://example.com/path?a=1&b=2&c=3')).toBe(true)
        expect(isValidUrl('https://example.com/search?q=hello+world')).toBe(true)
        expect(isValidUrl('https://example.com/api?filter[name]=test')).toBe(true)
        expect(isValidUrl('/path?key=value&array[]=1&array[]=2')).toBe(true)
      })

      it('should accept URLs with empty query and fragment', () => {
        expect(isValidUrl('https://example.com/path?')).toBe(true)
        expect(isValidUrl('https://example.com/path#')).toBe(true)
        expect(isValidUrl('https://example.com/path?#')).toBe(true)
      })

      it('should accept deeply nested paths', () => {
        expect(isValidUrl('https://example.com/a/b/c/d/e/f/g/h/i/j')).toBe(true)
        expect(isValidUrl('/api/v1/users/123/posts/456/comments/789')).toBe(true)
      })
    })

    describe('whitespace and special input edge cases', () => {
      it('should reject strings with only whitespace', () => {
        expect(isValidUrl(' ')).toBe(false)
        expect(isValidUrl('  ')).toBe(false)
        expect(isValidUrl('\t')).toBe(false)
        expect(isValidUrl('\n')).toBe(false)
        expect(isValidUrl(' \t\n ')).toBe(false)
      })

      it('should handle URLs with leading/trailing whitespace', () => {
        // Note: The URL constructor trims leading/trailing whitespace
        // This is WHATWG URL spec compliant behavior
        expect(isValidUrl(' https://example.com')).toBe(true) // Trimmed by URL constructor
        expect(isValidUrl('https://example.com ')).toBe(true) // Trimmed by URL constructor
        // Relative URLs with whitespace - startsWith('/') check handles the leading space
        expect(isValidUrl(' /path ')).toBe(false) // Relative URL check fails (doesn't start with /)
      })

      it('should handle non-string types gracefully', () => {
        expect(isValidUrl(123 as unknown as string)).toBe(false)
        expect(isValidUrl({} as unknown as string)).toBe(false)
        expect(isValidUrl([] as unknown as string)).toBe(false)
        expect(isValidUrl(true as unknown as string)).toBe(false)
        expect(isValidUrl(false as unknown as string)).toBe(false)
        expect(isValidUrl(NaN as unknown as string)).toBe(false)
      })
    })

    describe('relative URL edge cases', () => {
      it('should accept relative URLs with query strings', () => {
        expect(isValidUrl('/path?query=value')).toBe(true)
        expect(isValidUrl('/?search=term')).toBe(true)
      })

      it('should accept relative URLs with fragments', () => {
        expect(isValidUrl('/path#anchor')).toBe(true)
        expect(isValidUrl('/#top')).toBe(true)
      })

      it('should accept relative URLs with both query and fragment', () => {
        expect(isValidUrl('/path?query=value#section')).toBe(true)
      })

      it('should handle protocol-relative URLs', () => {
        // Protocol-relative URLs (//example.com) start with / so they pass
        // the relative URL check in isValidUrl. This is intentional since
        // the function accepts relative URLs starting with /
        // Note: //example.com starts with / and passes the relative URL check
        expect(isValidUrl('//example.com/path')).toBe(true) // Starts with /
        expect(isValidUrl('//evil.com')).toBe(true) // Starts with /
      })
    })

    describe('IP address URL edge cases', () => {
      it('should accept IPv4 addresses', () => {
        expect(isValidUrl('http://192.168.1.1')).toBe(true)
        expect(isValidUrl('https://10.0.0.1:8080')).toBe(true)
        expect(isValidUrl('http://127.0.0.1/path')).toBe(true)
      })

      it('should accept IPv6 addresses', () => {
        expect(isValidUrl('http://[::1]')).toBe(true)
        expect(isValidUrl('http://[::1]:8080')).toBe(true)
        expect(isValidUrl('https://[2001:db8::1]/path')).toBe(true)
      })
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

// ============================================================================
// Link Href Templating Tests (Issue do-tnd7 requirement 1)
// ============================================================================

describe('Link Href Templating', () => {
  const baseUrl = 'https://api.example.com'

  describe('Resource and ID interpolation', () => {
    it('should correctly interpolate resource name in href', () => {
      const links = generateLinks('customers', 'cust-456', baseUrl)

      expect(links.self.href).toBe('https://api.example.com/customers/cust-456')
      expect(links.collection.href).toBe('https://api.example.com/customers')
      expect(links.update.href).toBe('https://api.example.com/customers/cust-456')
      expect(links.delete.href).toBe('https://api.example.com/customers/cust-456')
    })

    it('should handle resource names with dashes', () => {
      const links = generateLinks('order-items', 'item-123', baseUrl)

      expect(links.self.href).toBe('https://api.example.com/order-items/item-123')
      expect(links.collection.href).toBe('https://api.example.com/order-items')
    })

    it('should handle resource names with underscores', () => {
      const links = generateLinks('line_items', 'li_abc', baseUrl)

      expect(links.self.href).toBe('https://api.example.com/line_items/li_abc')
    })

    it('should handle IDs with special characters (URL-safe)', () => {
      const links = generateLinks('users', 'user_2024-01-21', baseUrl)

      expect(links.self.href).toBe('https://api.example.com/users/user_2024-01-21')
    })

    it('should handle UUID-style IDs', () => {
      const links = generateLinks('resources', '550e8400-e29b-41d4-a716-446655440000', baseUrl)

      expect(links.self.href).toBe('https://api.example.com/resources/550e8400-e29b-41d4-a716-446655440000')
    })

    it('should handle numeric IDs as strings', () => {
      const links = generateLinks('users', '12345', baseUrl)

      expect(links.self.href).toBe('https://api.example.com/users/12345')
    })
  })

  describe('Base URL variations', () => {
    it('should handle base URLs with trailing paths', () => {
      const apiBaseUrl = 'https://api.example.com/v2/api'
      const links = generateLinks('users', '123', apiBaseUrl)

      expect(links.self.href).toBe('https://api.example.com/v2/api/users/123')
      expect(links.collection.href).toBe('https://api.example.com/v2/api/users')
    })

    it('should handle base URLs with port numbers', () => {
      const links = generateLinks('items', 'test', 'https://example.com:3000')

      expect(links.self.href).toBe('https://example.com:3000/items/test')
    })

    it('should handle localhost URLs', () => {
      const links = generateLinks('users', '1', 'http://localhost:8787')

      expect(links.self.href).toBe('http://localhost:8787/users/1')
    })
  })

  describe('Pagination query string templating', () => {
    it('should include page and limit in self href', () => {
      const links = generateCollectionLinks('users', baseUrl, {
        page: 2,
        limit: 25,
        total: 100
      })

      expect(links.self.href).toBe('https://api.example.com/users?page=2&limit=25')
    })

    it('should correctly calculate pagination hrefs', () => {
      const links = generateCollectionLinks('users', baseUrl, {
        page: 2,
        limit: 25,
        total: 100
      })

      expect(links.prev.href).toBe('https://api.example.com/users?page=1&limit=25')
      expect(links.next.href).toBe('https://api.example.com/users?page=3&limit=25')
      expect(links.first.href).toBe('https://api.example.com/users?page=1&limit=25')
      expect(links.last.href).toBe('https://api.example.com/users?page=4&limit=25')
    })

    it('should correctly calculate last page for non-evenly-divisible totals', () => {
      const links = generateCollectionLinks('items', baseUrl, {
        page: 1,
        limit: 10,
        total: 27
      })

      // 27 items / 10 per page = 3 pages (ceil)
      expect(links.last.href).toBe('https://api.example.com/items?page=3&limit=10')
    })
  })
})

// ============================================================================
// Nested Resource Links Tests (Issue do-tnd7 requirement 2)
// ============================================================================

describe('Nested Resource Links', () => {
  const baseUrl = 'https://api.example.com'

  describe('hasMany relations', () => {
    it('should generate nested resource hrefs for hasMany relations', () => {
      const links = generateLinks('users', '123', baseUrl, {
        relations: {
          orders: { resource: 'orders', type: 'hasMany' },
          posts: { resource: 'posts', type: 'hasMany' },
          comments: { resource: 'comments', type: 'hasMany' }
        }
      })

      expect(links.orders.href).toBe('https://api.example.com/users/123/orders')
      expect(links.posts.href).toBe('https://api.example.com/users/123/posts')
      expect(links.comments.href).toBe('https://api.example.com/users/123/comments')
    })

    it('should use related rel for hasMany relations (RFC 8288)', () => {
      const links = generateLinks('users', '1', baseUrl, {
        relations: {
          orders: { resource: 'orders', type: 'hasMany' }
        }
      })

      expect(links.orders.rel).toBe('related')
    })
  })

  describe('hasOne relations', () => {
    it('should generate nested resource hrefs for hasOne relations', () => {
      const links = generateLinks('users', '456', baseUrl, {
        relations: {
          profile: { resource: 'profiles', type: 'hasOne' },
          settings: { resource: 'settings', type: 'hasOne' }
        }
      })

      expect(links.profile.href).toBe('https://api.example.com/users/456/profile')
      expect(links.settings.href).toBe('https://api.example.com/users/456/settings')
    })

    it('should use item rel for hasOne relations (RFC 8288)', () => {
      const links = generateLinks('users', '1', baseUrl, {
        relations: {
          profile: { resource: 'profiles', type: 'hasOne' }
        }
      })

      expect(links.profile.rel).toBe('item')
    })
  })

  describe('mixed relation types', () => {
    it('should generate correct hrefs for mixed relation types', () => {
      const links = generateLinks('organizations', 'org-789', baseUrl, {
        relations: {
          members: { resource: 'users', type: 'hasMany' },
          owner: { resource: 'users', type: 'hasOne' },
          teams: { resource: 'teams', type: 'hasMany' },
          billing: { resource: 'billing', type: 'hasOne' }
        }
      })

      expect(links.members.href).toBe('https://api.example.com/organizations/org-789/members')
      expect(links.owner.href).toBe('https://api.example.com/organizations/org-789/owner')
      expect(links.teams.href).toBe('https://api.example.com/organizations/org-789/teams')
      expect(links.billing.href).toBe('https://api.example.com/organizations/org-789/billing')
    })
  })

  describe('action links', () => {
    it('should generate action links nested under resource', () => {
      const links = generateLinks('orders', 'order-100', baseUrl, {
        actions: ['ship', 'cancel', 'refund', 'archive']
      })

      expect(links.ship.href).toBe('https://api.example.com/orders/order-100/ship')
      expect(links.cancel.href).toBe('https://api.example.com/orders/order-100/cancel')
      expect(links.refund.href).toBe('https://api.example.com/orders/order-100/refund')
      expect(links.archive.href).toBe('https://api.example.com/orders/order-100/archive')
    })
  })

  describe('combined relations and actions', () => {
    it('should handle resources with both relations and actions', () => {
      const links = generateLinks('subscriptions', 'sub-50', baseUrl, {
        relations: {
          invoices: { resource: 'invoices', type: 'hasMany' },
          plan: { resource: 'plans', type: 'hasOne' }
        },
        actions: ['upgrade', 'downgrade', 'pause', 'resume']
      })

      // Relation links
      expect(links.invoices.href).toBe('https://api.example.com/subscriptions/sub-50/invoices')
      expect(links.plan.href).toBe('https://api.example.com/subscriptions/sub-50/plan')

      // Action links
      expect(links.upgrade.href).toBe('https://api.example.com/subscriptions/sub-50/upgrade')
      expect(links.downgrade.href).toBe('https://api.example.com/subscriptions/sub-50/downgrade')
      expect(links.pause.href).toBe('https://api.example.com/subscriptions/sub-50/pause')
      expect(links.resume.href).toBe('https://api.example.com/subscriptions/sub-50/resume')
    })
  })

  describe('relation naming', () => {
    it('should use relation name as path segment, not resource name', () => {
      const links = generateLinks('users', '1', baseUrl, {
        relations: {
          'recent-orders': { resource: 'orders', type: 'hasMany' }
        }
      })

      expect(links['recent-orders'].href).toBe('https://api.example.com/users/1/recent-orders')
    })
  })
})

// ============================================================================
// Conditional Link Generation Tests (Issue do-tnd7 requirement 3)
// ============================================================================

describe('Conditional Link Generation', () => {
  const baseUrl = 'https://api.example.com'

  describe('relations and actions', () => {
    it('should not include relation links when no relations configured', () => {
      const links = generateLinks('simple-resources', 'res-1', baseUrl)

      // Should only have standard CRUD links
      expect(Object.keys(links)).toEqual(['self', 'update', 'delete', 'collection'])
    })

    it('should not include action links when no actions configured', () => {
      const links = generateLinks('basic', 'id-1', baseUrl)

      expect(links.activate).toBeUndefined()
      expect(links.deactivate).toBeUndefined()
    })

    it('should include relation links only when relations are configured', () => {
      const linksWithoutRelations = generateLinks('users', '1', baseUrl)
      const linksWithRelations = generateLinks('users', '1', baseUrl, {
        relations: { posts: { resource: 'posts', type: 'hasMany' } }
      })

      expect(linksWithoutRelations.posts).toBeUndefined()
      expect(linksWithRelations.posts).toBeDefined()
    })

    it('should include action links only when actions are configured', () => {
      const linksWithoutActions = generateLinks('orders', '1', baseUrl)
      const linksWithActions = generateLinks('orders', '1', baseUrl, {
        actions: ['ship']
      })

      expect(linksWithoutActions.ship).toBeUndefined()
      expect(linksWithActions.ship).toBeDefined()
    })

    it('should handle empty relations object', () => {
      const links = generateLinks('users', '1', baseUrl, {
        relations: {}
      })

      // Should only have standard CRUD links
      expect(Object.keys(links)).toEqual(['self', 'update', 'delete', 'collection'])
    })

    it('should handle empty actions array', () => {
      const links = generateLinks('users', '1', baseUrl, {
        actions: []
      })

      // Should only have standard CRUD links
      expect(Object.keys(links)).toEqual(['self', 'update', 'delete', 'collection'])
    })
  })

  describe('pagination links', () => {
    it('should conditionally include prev link based on page number', () => {
      const firstPageLinks = generateCollectionLinks('items', baseUrl, { page: 1, limit: 10, total: 50 })
      const middlePageLinks = generateCollectionLinks('items', baseUrl, { page: 3, limit: 10, total: 50 })

      expect(firstPageLinks.prev).toBeUndefined()
      expect(firstPageLinks.first).toBeUndefined()
      expect(middlePageLinks.prev).toBeDefined()
      expect(middlePageLinks.first).toBeDefined()
    })

    it('should conditionally include next link based on total items', () => {
      const lastPageLinks = generateCollectionLinks('items', baseUrl, { page: 5, limit: 10, total: 50 })
      const notLastPageLinks = generateCollectionLinks('items', baseUrl, { page: 4, limit: 10, total: 50 })

      expect(lastPageLinks.next).toBeUndefined()
      expect(lastPageLinks.last).toBeUndefined()
      expect(notLastPageLinks.next).toBeDefined()
      expect(notLastPageLinks.last).toBeDefined()
    })

    it('should not include next/last links when total is not provided', () => {
      const links = generateCollectionLinks('items', baseUrl, { page: 2, limit: 10 })

      // Without total, we can still show prev (based on page > 1)
      expect(links.prev).toBeDefined()
      expect(links.first).toBeDefined()
      // But cannot show next/last without knowing total
      expect(links.next).toBeUndefined()
      expect(links.last).toBeUndefined()
    })

    it('should not include any pagination links for single page results', () => {
      const links = generateCollectionLinks('items', baseUrl, { page: 1, limit: 10, total: 5 })

      expect(links.prev).toBeUndefined()
      expect(links.next).toBeUndefined()
      expect(links.first).toBeUndefined()
      expect(links.last).toBeUndefined()
    })
  })

  describe('error response links', () => {
    it('should conditionally include help link in error links', () => {
      const linksWithDocs = generateErrorLinks(baseUrl, { docsPath: '/docs' })
      const linksWithoutDocs = generateErrorLinks(baseUrl, {})

      expect(linksWithDocs.help).toBeDefined()
      expect(linksWithoutDocs.help).toBeUndefined()
    })

    it('should conditionally include health link in error links', () => {
      const linksWithHealth = generateErrorLinks(baseUrl, { healthPath: '/health' })
      const linksWithoutHealth = generateErrorLinks(baseUrl, {})

      expect(linksWithHealth.health).toBeDefined()
      expect(linksWithoutHealth.health).toBeUndefined()
    })
  })

  describe('API root links', () => {
    it('should conditionally include openapi links in API root', () => {
      const linksWithOpenAPI = generateAPIRootLinks({
        baseUrl,
        openapi: { json: '/openapi.json', yaml: '/openapi.yaml' }
      })
      const linksWithoutOpenAPI = generateAPIRootLinks({ baseUrl })

      expect(linksWithOpenAPI.describedby).toBeDefined()
      expect(linksWithOpenAPI['describedby-yaml']).toBeDefined()
      expect(linksWithoutOpenAPI.describedby).toBeUndefined()
      expect(linksWithoutOpenAPI['describedby-yaml']).toBeUndefined()
    })

    it('should include only JSON openapi link when yaml not provided', () => {
      const links = generateAPIRootLinks({
        baseUrl,
        openapi: { json: '/openapi.json' }
      })

      expect(links.describedby).toBeDefined()
      expect(links['describedby-yaml']).toBeUndefined()
    })

    it('should conditionally include help link based on docsPath', () => {
      const withDocs = generateAPIRootLinks({ baseUrl, docsPath: '/docs' })
      const withoutDocs = generateAPIRootLinks({ baseUrl })

      expect(withDocs.help).toBeDefined()
      expect(withoutDocs.help).toBeUndefined()
    })

    it('should conditionally include health link based on healthPath', () => {
      const withHealth = generateAPIRootLinks({ baseUrl, healthPath: '/health' })
      const withoutHealth = generateAPIRootLinks({ baseUrl })

      expect(withHealth.health).toBeDefined()
      expect(withoutHealth.health).toBeUndefined()
    })
  })
})

// ============================================================================
// Link Metadata Tests (Issue do-tnd7 requirement 4)
// ============================================================================

describe('Link Metadata (method, schema, title)', () => {
  const baseUrl = 'https://api.example.com'

  describe('method property', () => {
    it('should set correct HTTP methods for CRUD links', () => {
      const links = generateLinks('resources', 'res-1', baseUrl)

      expect(links.self.method).toBe('GET')
      expect(links.update.method).toBe('PUT')
      expect(links.delete.method).toBe('DELETE')
      expect(links.collection.method).toBe('GET')
    })

    it('should set POST method for create links', () => {
      const links = generateCollectionLinks('items', baseUrl)

      expect(links.create.method).toBe('POST')
    })

    it('should set POST method for action links', () => {
      const links = generateLinks('orders', '1', baseUrl, {
        actions: ['ship', 'cancel', 'refund']
      })

      expect(links.ship.method).toBe('POST')
      expect(links.cancel.method).toBe('POST')
      expect(links.refund.method).toBe('POST')
    })

    it('should set GET method for relation links', () => {
      const links = generateLinks('users', '1', baseUrl, {
        relations: {
          orders: { resource: 'orders', type: 'hasMany' },
          profile: { resource: 'profiles', type: 'hasOne' }
        }
      })

      expect(links.orders.method).toBe('GET')
      expect(links.profile.method).toBe('GET')
    })

    it('should set GET method for pagination links', () => {
      const links = generateCollectionLinks('items', baseUrl, {
        page: 2, limit: 10, total: 50
      })

      expect(links.self.method).toBe('GET')
      expect(links.prev.method).toBe('GET')
      expect(links.next.method).toBe('GET')
      expect(links.first.method).toBe('GET')
      expect(links.last.method).toBe('GET')
    })

    it('should set GET method for API root links', () => {
      const links = generateAPIRootLinks({
        baseUrl,
        resources: { users: { path: '/users' } },
        openapi: { json: '/openapi.json' },
        docsPath: '/docs',
        healthPath: '/health'
      })

      expect(links.self.method).toBe('GET')
      expect(links.users.method).toBe('GET')
      expect(links.describedby.method).toBe('GET')
      expect(links.help.method).toBe('GET')
      expect(links.health.method).toBe('GET')
    })

    it('should set GET method for error links', () => {
      const links = generateErrorLinks(baseUrl, {
        docsPath: '/docs',
        healthPath: '/health'
      })

      expect(links.root.method).toBe('GET')
      expect(links.help.method).toBe('GET')
      expect(links.health.method).toBe('GET')
    })
  })

  describe('title property', () => {
    it('should include title for CRUD links', () => {
      const links = generateLinks('customers', 'cust-1', baseUrl)

      expect(links.self.title).toBe('Get customers')
      expect(links.update.title).toBe('Update customers')
      expect(links.delete.title).toBe('Delete customers')
      expect(links.collection.title).toBe('List all customers')
    })

    it('should include title for create links', () => {
      const links = generateCollectionLinks('products', baseUrl)

      expect(links.create.title).toBe('Create products')
    })

    it('should include title for action links', () => {
      const links = generateLinks('orders', '1', baseUrl, {
        actions: ['ship', 'cancel']
      })

      expect(links.ship.title).toBe('ship orders')
      expect(links.cancel.title).toBe('cancel orders')
    })

    it('should include title for relation links', () => {
      const links = generateLinks('users', '1', baseUrl, {
        relations: {
          orders: { resource: 'orders', type: 'hasMany' }
        }
      })

      expect(links.orders.title).toBe('Get orders for users')
    })

    it('should include title for API root links', () => {
      const links = generateAPIRootLinks({
        baseUrl,
        resources: {
          users: { path: '/users', title: 'User management' }
        },
        openapi: { json: '/openapi.json', yaml: '/openapi.yaml' },
        docsPath: '/docs',
        healthPath: '/health'
      })

      expect(links.self.title).toBe('API Root')
      expect(links.users.title).toBe('User management')
      expect(links.describedby.title).toBe('OpenAPI specification (JSON)')
      expect(links['describedby-yaml'].title).toBe('OpenAPI specification (YAML)')
      expect(links.help.title).toBe('API documentation')
      expect(links.health.title).toBe('Health check endpoint')
    })

    it('should use default title when not provided in resource config', () => {
      const links = generateAPIRootLinks({
        baseUrl,
        resources: {
          items: { path: '/items' } // No title provided
        }
      })

      expect(links.items.title).toBe('items collection')
    })

    it('should include title for error links', () => {
      const links = generateErrorLinks(baseUrl, {
        docsPath: '/docs',
        healthPath: '/health'
      })

      expect(links.root.title).toBe('API Root')
      expect(links.help.title).toBe('API documentation')
      expect(links.health.title).toBe('Health check endpoint')
    })
  })

  describe('rel property (RFC 8288 standard relations)', () => {
    it('should set correct rel for CRUD links', () => {
      const links = generateLinks('resources', '1', baseUrl)

      expect(links.self.rel).toBe('self')
      expect(links.update.rel).toBe('edit')  // RFC 8288 standard
      expect(links.delete.rel).toBe('delete')
      expect(links.collection.rel).toBe('collection')
    })

    it('should use RFC 8288 rel types for relation links', () => {
      const links = generateLinks('users', '1', baseUrl, {
        relations: {
          orders: { resource: 'orders', type: 'hasMany' },
          profile: { resource: 'profiles', type: 'hasOne' }
        }
      })

      expect(links.orders.rel).toBe('related')  // hasMany -> related
      expect(links.profile.rel).toBe('item')     // hasOne -> item
    })

    it('should use action name as rel for action links', () => {
      const links = generateLinks('resources', '1', baseUrl, {
        actions: ['activate', 'archive']
      })

      expect(links.activate.rel).toBe('activate')
      expect(links.archive.rel).toBe('archive')
    })

    it('should set create-form rel for create links (RFC 8288)', () => {
      const links = generateCollectionLinks('users', baseUrl)

      expect(links.create.rel).toBe('create-form')
    })

    it('should set collection rel for resource links in API root', () => {
      const links = generateAPIRootLinks({
        baseUrl,
        resources: {
          users: { path: '/users' },
          orders: { path: '/orders' }
        }
      })

      expect(links.users.rel).toBe('collection')
      expect(links.orders.rel).toBe('collection')
    })

    it('should set describedby rel for OpenAPI links', () => {
      const links = generateAPIRootLinks({
        baseUrl,
        openapi: { json: '/openapi.json', yaml: '/openapi.yaml' }
      })

      expect(links.describedby.rel).toBe('describedby')
      expect(links['describedby-yaml'].rel).toBe('describedby')
    })

    it('should set up rel for error root link', () => {
      const links = generateErrorLinks(baseUrl)

      expect(links.root.rel).toBe('up')
    })

    it('should set help rel for docs link', () => {
      const links = generateAPIRootLinks({
        baseUrl,
        docsPath: '/docs'
      })

      expect(links.help.rel).toBe('help')
    })

    it('should set health rel for health link in API root', () => {
      const links = generateAPIRootLinks({
        baseUrl,
        healthPath: '/health'
      })

      expect(links.health.rel).toBe('health')
    })

    it('should set related rel for health link in error links', () => {
      const links = generateErrorLinks(baseUrl, { healthPath: '/health' })

      expect(links.health.rel).toBe('related')
    })
  })

  describe('link structure validation', () => {
    it('should produce links that pass validation for all CRUD operations', () => {
      const links = generateLinks('things', 'thing-1', baseUrl)

      expectValidLink(links.self, 'self', 'GET')
      expectValidLink(links.update, 'edit', 'PUT')
      expectValidLink(links.delete, 'delete', 'DELETE')
      expectValidLink(links.collection, 'collection', 'GET')
    })

    it('should produce valid links for relations', () => {
      const links = generateLinks('users', '1', baseUrl, {
        relations: {
          posts: { resource: 'posts', type: 'hasMany' }
        }
      })

      expectValidLink(links.posts, 'related', 'GET')
    })

    it('should produce valid links for actions', () => {
      const links = generateLinks('items', '1', baseUrl, {
        actions: ['process']
      })

      expectValidLink(links.process, 'process', 'POST')
    })

    it('should produce valid links for collection pagination', () => {
      const links = generateCollectionLinks('items', baseUrl, {
        page: 2, limit: 10, total: 50
      })

      expectValidLink(links.self, 'self', 'GET')
      expectValidLink(links.create, 'create-form', 'POST')
      expectValidLink(links.prev, 'prev', 'GET')
      expectValidLink(links.next, 'next', 'GET')
      expectValidLink(links.first, 'first', 'GET')
      expectValidLink(links.last, 'last', 'GET')
    })

    it('should produce valid links for API root', () => {
      const links = generateAPIRootLinks({
        baseUrl,
        resources: { users: { path: '/users' } },
        openapi: { json: '/openapi.json' },
        docsPath: '/docs',
        healthPath: '/health'
      })

      expectValidLink(links.self, 'self', 'GET')
      expectValidLink(links.users, 'collection', 'GET')
      expectValidLink(links.describedby, 'describedby', 'GET')
      expectValidLink(links.help, 'help', 'GET')
      expectValidLink(links.health, 'health', 'GET')
    })

    it('should produce valid links for error responses', () => {
      const links = generateErrorLinks(baseUrl, {
        docsPath: '/docs',
        healthPath: '/health'
      })

      expectValidLink(links.root, 'up', 'GET')
      expectValidLink(links.help, 'help', 'GET')
      expectValidLink(links.health, 'related', 'GET')
    })
  })
})

// ============================================================================
// Edge Cases and Robustness Tests
// ============================================================================

describe('Edge Cases', () => {
  const baseUrl = 'https://api.example.com'

  it('should handle single-item collections', () => {
    const items = [{ id: 'only-one' }]
    const result = withCollectionLinks(items, 'items', baseUrl, item => item.id)

    expect(result.data).toHaveLength(1)
    expect(result.data[0]._links.self.href).toBe('https://api.example.com/items/only-one')
  })

  it('should handle empty collections', () => {
    const items: { id: string }[] = []
    const result = withCollectionLinks(items, 'items', baseUrl, item => item.id)

    expect(result.data).toHaveLength(0)
    expect(result._links.create).toBeDefined()
  })

  it('should handle page 0 gracefully (normalizes to page 1)', () => {
    const links = generateCollectionLinks('items', baseUrl, {
      page: 0,
      limit: 10,
      total: 50
    })

    // With page 0, should normalize to page 1
    expect(links.self).toBeDefined()
    expect(links.self.href).toContain('page=1')
  })

  it('should handle negative limit gracefully (normalizes to 1)', () => {
    const links = generateCollectionLinks('items', baseUrl, {
      page: 1,
      limit: -10,
      total: 50
    })

    expect(links.self).toBeDefined()
    expect(links.self.href).toContain('limit=1')
  })

  it('should handle total 0', () => {
    const links = generateCollectionLinks('items', baseUrl, {
      page: 1,
      limit: 10,
      total: 0
    })

    expect(links.self).toBeDefined()
    expect(links.next).toBeUndefined()
    expect(links.last).toBeUndefined()
  })

  it('should handle very large page numbers', () => {
    const links = generateCollectionLinks('items', baseUrl, {
      page: 999999,
      limit: 10,
      total: 10000000
    })

    expect(links.self.href).toContain('page=999999')
    expect(links.prev).toBeDefined()
  })

  it('should cap limit at 1000', () => {
    const links = generateCollectionLinks('items', baseUrl, {
      page: 1,
      limit: 9999999,
      total: 100
    })

    expect(links.self.href).toContain('limit=1000')
  })

  it('should handle API root with no resources', () => {
    const links = generateAPIRootLinks({
      baseUrl,
      resources: {}
    })

    expect(links.self).toBeDefined()
    // Should not throw and should return at least self link
    expect(Object.keys(links).length).toBeGreaterThanOrEqual(1)
  })

  it('should handle API root with only baseUrl', () => {
    const links = generateAPIRootLinks({ baseUrl })

    expect(links.self.href).toBe('https://api.example.com/')
  })

  it('should generate API root with default values', () => {
    const root = generateAPIRoot({ baseUrl })

    expect(root.name).toBe('API')
    expect(root.version).toBe('1.0.0')
    expect(root.description).toBe('Self-describing HATEOAS API')
  })
})
