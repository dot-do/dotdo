import { describe, it, expect } from 'vitest'

/**
 * URL Builder Utilities Tests (RED Phase)
 *
 * These tests verify the URL building utilities for constructing
 * context URLs, type URLs, and ID URLs in the dotdo response format.
 *
 * They are expected to FAIL until lib/response/urls.ts is implemented.
 *
 * Expected function signatures (to be implemented):
 * - buildContextUrl(ns: string, options?: { parent?: string; isRoot?: boolean }): string
 * - buildTypeUrl(ns: string, type: string): string
 * - buildIdUrl(ns: string, type: string, id: string): string
 *
 * URL Format:
 * - Context URL: The namespace or parent URL (at root level)
 * - Type URL: namespace + '/' + pluralize(type)
 * - ID URL: namespace + '/' + pluralize(type) + '/' + id
 *
 * Examples:
 * - Context: "https://headless.ly" or "https://crm.example.org.ai/acme"
 * - Type: "https://headless.ly/customers" (from type "Customer")
 * - ID: "https://headless.ly/customers/alice"
 */

// Import the module under test (will fail until implemented)
import { buildContextUrl, buildTypeUrl, buildIdUrl } from '../urls'

// ============================================================================
// buildContextUrl Tests
// ============================================================================

describe('buildContextUrl', () => {
  describe('basic namespace handling', () => {
    it('returns namespace as context when no options provided', () => {
      const result = buildContextUrl('https://headless.ly')

      expect(result).toBe('https://headless.ly')
    })

    it('returns namespace for CRM example', () => {
      const result = buildContextUrl('https://crm.example.org.ai/acme')

      expect(result).toBe('https://crm.example.org.ai/acme')
    })

    it('returns namespace for Startups.Studio', () => {
      const result = buildContextUrl('https://Startups.Studio')

      expect(result).toBe('https://Startups.Studio')
    })
  })

  describe('parent option behavior', () => {
    it('returns parent URL when parent is provided and isRoot is true', () => {
      const result = buildContextUrl('https://headless.ly', {
        parent: 'https://headless.ly/customers',
        isRoot: true,
      })

      expect(result).toBe('https://headless.ly/customers')
    })

    it('returns namespace when parent is provided but isRoot is false', () => {
      const result = buildContextUrl('https://headless.ly', {
        parent: 'https://headless.ly/customers',
        isRoot: false,
      })

      expect(result).toBe('https://headless.ly')
    })

    it('returns namespace when parent is provided but isRoot is undefined', () => {
      const result = buildContextUrl('https://headless.ly', {
        parent: 'https://headless.ly/customers',
      })

      expect(result).toBe('https://headless.ly')
    })

    it('returns schema.org.ai/DO when isRoot is true but parent is undefined (orphan fallback)', () => {
      // When isRoot is true and no parent is provided (orphan DO),
      // fall back to schema.org.ai type definition URL
      const result = buildContextUrl('https://headless.ly', {
        isRoot: true,
      })

      // Without type specified, defaults to 'DO'
      expect(result).toBe('https://schema.org.ai/DO')
    })
  })

  describe('edge cases - trailing slashes', () => {
    it('preserves trailing slash in namespace if present', () => {
      const result = buildContextUrl('https://headless.ly/')

      expect(result).toBe('https://headless.ly/')
    })

    it('does not add trailing slash if namespace has none', () => {
      const result = buildContextUrl('https://headless.ly')

      expect(result).not.toMatch(/\/$/)
    })

    it('handles parent with trailing slash', () => {
      const result = buildContextUrl('https://headless.ly', {
        parent: 'https://headless.ly/customers/',
        isRoot: true,
      })

      expect(result).toBe('https://headless.ly/customers/')
    })
  })

  describe('edge cases - special characters', () => {
    it('handles namespace with port', () => {
      const result = buildContextUrl('https://localhost:8787')

      expect(result).toBe('https://localhost:8787')
    })

    it('handles namespace with path segments', () => {
      const result = buildContextUrl('https://api.example.com/v1/tenant')

      expect(result).toBe('https://api.example.com/v1/tenant')
    })

    it('handles namespace with hyphenated domain', () => {
      const result = buildContextUrl('https://my-cool-app.workers.dev')

      expect(result).toBe('https://my-cool-app.workers.dev')
    })

    it('handles namespace with underscores in path', () => {
      const result = buildContextUrl('https://api.example.com/my_tenant')

      expect(result).toBe('https://api.example.com/my_tenant')
    })

    it('handles namespace with query parameters', () => {
      // Query params should be preserved as-is
      const result = buildContextUrl('https://headless.ly?version=1')

      expect(result).toBe('https://headless.ly?version=1')
    })
  })
})

// ============================================================================
// buildTypeUrl Tests
// ============================================================================

describe('buildTypeUrl', () => {
  describe('basic type URL construction', () => {
    it('builds URL for Customer type', () => {
      const result = buildTypeUrl('https://headless.ly', 'Customer')

      expect(result).toBe('https://headless.ly/customers')
    })

    it('builds URL for Contact type', () => {
      const result = buildTypeUrl('https://crm.example.org.ai/acme', 'Contact')

      expect(result).toBe('https://crm.example.org.ai/acme/contacts')
    })

    it('builds URL for Deal type', () => {
      const result = buildTypeUrl('https://Startups.Studio', 'Deal')

      expect(result).toBe('https://Startups.Studio/deals')
    })
  })

  describe('pluralization rules', () => {
    it('pluralizes regular nouns by adding s', () => {
      const result = buildTypeUrl('https://headless.ly', 'Product')

      expect(result).toBe('https://headless.ly/products')
    })

    it('pluralizes nouns ending in y to ies', () => {
      const result = buildTypeUrl('https://headless.ly', 'Category')

      expect(result).toBe('https://headless.ly/categories')
    })

    it('pluralizes nouns ending in s to ses', () => {
      const result = buildTypeUrl('https://headless.ly', 'Status')

      expect(result).toBe('https://headless.ly/statuses')
    })

    it('pluralizes nouns ending in x to xes', () => {
      const result = buildTypeUrl('https://headless.ly', 'Box')

      expect(result).toBe('https://headless.ly/boxes')
    })

    it('pluralizes nouns ending in ch to ches', () => {
      const result = buildTypeUrl('https://headless.ly', 'Match')

      expect(result).toBe('https://headless.ly/matches')
    })

    it('pluralizes nouns ending in sh to shes', () => {
      const result = buildTypeUrl('https://headless.ly', 'Wish')

      expect(result).toBe('https://headless.ly/wishes')
    })

    it('handles irregular plurals - Person to people', () => {
      const result = buildTypeUrl('https://headless.ly', 'Person')

      expect(result).toBe('https://headless.ly/people')
    })

    it('handles irregular plurals - Child to children', () => {
      const result = buildTypeUrl('https://headless.ly', 'Child')

      expect(result).toBe('https://headless.ly/children')
    })
  })

  describe('case handling', () => {
    it('converts PascalCase type to lowercase path', () => {
      const result = buildTypeUrl('https://headless.ly', 'CustomerAccount')

      expect(result).toBe('https://headless.ly/customeraccounts')
    })

    it('converts single word PascalCase to lowercase', () => {
      const result = buildTypeUrl('https://headless.ly', 'User')

      expect(result).toBe('https://headless.ly/users')
    })

    it('preserves acronyms in lowercase', () => {
      const result = buildTypeUrl('https://headless.ly', 'APIKey')

      expect(result).toBe('https://headless.ly/apikeys')
    })
  })

  describe('edge cases - trailing slashes', () => {
    it('handles namespace with trailing slash', () => {
      const result = buildTypeUrl('https://headless.ly/', 'Customer')

      // Should not double up slashes
      expect(result).toBe('https://headless.ly/customers')
    })

    it('handles namespace without trailing slash', () => {
      const result = buildTypeUrl('https://headless.ly', 'Customer')

      expect(result).toBe('https://headless.ly/customers')
    })
  })

  describe('edge cases - special characters in namespace', () => {
    it('handles namespace with port', () => {
      const result = buildTypeUrl('https://localhost:8787', 'Customer')

      expect(result).toBe('https://localhost:8787/customers')
    })

    it('handles namespace with deep path', () => {
      const result = buildTypeUrl('https://api.example.com/v1/tenant/workspace', 'Customer')

      expect(result).toBe('https://api.example.com/v1/tenant/workspace/customers')
    })

    it('handles namespace with hyphenated domain', () => {
      const result = buildTypeUrl('https://my-cool-app.workers.dev', 'Customer')

      expect(result).toBe('https://my-cool-app.workers.dev/customers')
    })
  })

  describe('edge cases - empty or invalid types', () => {
    it('throws for empty type string', () => {
      expect(() => buildTypeUrl('https://headless.ly', '')).toThrow()
    })

    it('throws for whitespace-only type', () => {
      expect(() => buildTypeUrl('https://headless.ly', '   ')).toThrow()
    })

    it('handles type with numbers', () => {
      const result = buildTypeUrl('https://headless.ly', 'OAuth2Token')

      expect(result).toBe('https://headless.ly/oauth2tokens')
    })
  })
})

// ============================================================================
// buildIdUrl Tests
// ============================================================================

describe('buildIdUrl', () => {
  describe('basic ID URL construction', () => {
    it('builds URL for Customer with string id', () => {
      const result = buildIdUrl('https://headless.ly', 'Customer', 'alice')

      expect(result).toBe('https://headless.ly/customers/alice')
    })

    it('builds URL for Contact with prefixed id', () => {
      const result = buildIdUrl('https://crm.example.org.ai/acme', 'Contact', 'ord-123')

      expect(result).toBe('https://crm.example.org.ai/acme/contacts/ord-123')
    })

    it('builds URL for Deal with organization id', () => {
      const result = buildIdUrl('https://Startups.Studio', 'Deal', 'acme')

      expect(result).toBe('https://Startups.Studio/deals/acme')
    })
  })

  describe('id encoding and special characters', () => {
    it('handles id with dots (like domain names)', () => {
      const result = buildIdUrl('https://headless.ly', 'Domain', 'example.com')

      expect(result).toBe('https://headless.ly/domains/example.com')
    })

    it('handles id with hyphens', () => {
      const result = buildIdUrl('https://headless.ly', 'Customer', 'alice-bob')

      expect(result).toBe('https://headless.ly/customers/alice-bob')
    })

    it('handles id with underscores', () => {
      const result = buildIdUrl('https://headless.ly', 'Customer', 'alice_bob')

      expect(result).toBe('https://headless.ly/customers/alice_bob')
    })

    it('handles numeric string id', () => {
      const result = buildIdUrl('https://headless.ly', 'Customer', '12345')

      expect(result).toBe('https://headless.ly/customers/12345')
    })

    it('URL-encodes special characters in id', () => {
      const result = buildIdUrl('https://headless.ly', 'Customer', 'user@example.com')

      // @ should be URL-encoded
      expect(result).toBe('https://headless.ly/customers/user%40example.com')
    })

    it('URL-encodes spaces in id', () => {
      const result = buildIdUrl('https://headless.ly', 'Customer', 'alice bob')

      expect(result).toBe('https://headless.ly/customers/alice%20bob')
    })

    it('URL-encodes forward slashes in id', () => {
      const result = buildIdUrl('https://headless.ly', 'File', 'path/to/file')

      expect(result).toBe('https://headless.ly/files/path%2Fto%2Ffile')
    })
  })

  describe('type pluralization in ID URL', () => {
    it('pluralizes type correctly for Person', () => {
      const result = buildIdUrl('https://headless.ly', 'Person', 'john')

      expect(result).toBe('https://headless.ly/people/john')
    })

    it('pluralizes type correctly for Category', () => {
      const result = buildIdUrl('https://headless.ly', 'Category', 'tech')

      expect(result).toBe('https://headless.ly/categories/tech')
    })

    it('pluralizes type correctly for Status', () => {
      const result = buildIdUrl('https://headless.ly', 'Status', 'active')

      expect(result).toBe('https://headless.ly/statuses/active')
    })
  })

  describe('edge cases - trailing slashes', () => {
    it('handles namespace with trailing slash', () => {
      const result = buildIdUrl('https://headless.ly/', 'Customer', 'alice')

      // Should not double up slashes
      expect(result).toBe('https://headless.ly/customers/alice')
    })

    it('handles namespace without trailing slash', () => {
      const result = buildIdUrl('https://headless.ly', 'Customer', 'alice')

      expect(result).toBe('https://headless.ly/customers/alice')
    })
  })

  describe('edge cases - special characters in namespace', () => {
    it('handles namespace with port', () => {
      const result = buildIdUrl('https://localhost:8787', 'Customer', 'alice')

      expect(result).toBe('https://localhost:8787/customers/alice')
    })

    it('handles namespace with deep path', () => {
      const result = buildIdUrl('https://api.example.com/v1/tenant', 'Customer', 'alice')

      expect(result).toBe('https://api.example.com/v1/tenant/customers/alice')
    })
  })

  describe('edge cases - empty or invalid inputs', () => {
    it('throws for empty id', () => {
      expect(() => buildIdUrl('https://headless.ly', 'Customer', '')).toThrow()
    })

    it('throws for whitespace-only id', () => {
      expect(() => buildIdUrl('https://headless.ly', 'Customer', '   ')).toThrow()
    })

    it('throws for empty type', () => {
      expect(() => buildIdUrl('https://headless.ly', '', 'alice')).toThrow()
    })

    it('throws for empty namespace', () => {
      expect(() => buildIdUrl('', 'Customer', 'alice')).toThrow()
    })
  })
})

// ============================================================================
// Integration Tests - URL Consistency
// ============================================================================

describe('URL building consistency', () => {
  describe('buildTypeUrl and buildIdUrl relationship', () => {
    it('buildIdUrl starts with buildTypeUrl result', () => {
      const typeUrl = buildTypeUrl('https://headless.ly', 'Customer')
      const idUrl = buildIdUrl('https://headless.ly', 'Customer', 'alice')

      expect(idUrl.startsWith(typeUrl)).toBe(true)
    })

    it('id is appended after type path', () => {
      const typeUrl = buildTypeUrl('https://headless.ly', 'Customer')
      const idUrl = buildIdUrl('https://headless.ly', 'Customer', 'alice')

      expect(idUrl).toBe(`${typeUrl}/alice`)
    })
  })

  describe('buildContextUrl and buildTypeUrl relationship', () => {
    it('buildTypeUrl starts with buildContextUrl result', () => {
      const contextUrl = buildContextUrl('https://headless.ly')
      const typeUrl = buildTypeUrl('https://headless.ly', 'Customer')

      expect(typeUrl.startsWith(contextUrl)).toBe(true)
    })
  })

  describe('real-world namespace examples', () => {
    it('headless.ly namespace produces valid URLs', () => {
      const ns = 'https://headless.ly'

      expect(buildContextUrl(ns)).toBe('https://headless.ly')
      expect(buildTypeUrl(ns, 'Customer')).toBe('https://headless.ly/customers')
      expect(buildIdUrl(ns, 'Customer', 'alice')).toBe('https://headless.ly/customers/alice')
    })

    it('CRM example namespace produces valid URLs', () => {
      const ns = 'https://crm.example.org.ai/acme'

      expect(buildContextUrl(ns)).toBe('https://crm.example.org.ai/acme')
      expect(buildTypeUrl(ns, 'Contact')).toBe('https://crm.example.org.ai/acme/contacts')
      expect(buildIdUrl(ns, 'Contact', 'ord-123')).toBe('https://crm.example.org.ai/acme/contacts/ord-123')
    })

    it('Startups.Studio namespace produces valid URLs', () => {
      const ns = 'https://Startups.Studio'

      expect(buildContextUrl(ns)).toBe('https://Startups.Studio')
      expect(buildTypeUrl(ns, 'Deal')).toBe('https://Startups.Studio/deals')
      expect(buildIdUrl(ns, 'Deal', 'acme')).toBe('https://Startups.Studio/deals/acme')
    })
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('type safety', () => {
  it('buildContextUrl accepts string namespace', () => {
    const result: string = buildContextUrl('https://headless.ly')

    expect(typeof result).toBe('string')
  })

  it('buildContextUrl accepts options object', () => {
    const result: string = buildContextUrl('https://headless.ly', {
      parent: 'https://headless.ly/customers',
      isRoot: true,
    })

    expect(typeof result).toBe('string')
  })

  it('buildTypeUrl returns string', () => {
    const result: string = buildTypeUrl('https://headless.ly', 'Customer')

    expect(typeof result).toBe('string')
  })

  it('buildIdUrl returns string', () => {
    const result: string = buildIdUrl('https://headless.ly', 'Customer', 'alice')

    expect(typeof result).toBe('string')
  })
})
