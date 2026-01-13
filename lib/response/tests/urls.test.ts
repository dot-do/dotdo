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

// Import the module under test
import { buildContextUrl, buildTypeUrl, buildIdUrl, pluralize, normalizeNs } from '../urls'

// ============================================================================
// pluralize Tests
// ============================================================================

describe('pluralize', () => {
  describe('regular plurals - adding "s"', () => {
    it('pluralizes "customer" to "customers"', () => {
      expect(pluralize('customer')).toBe('customers')
    })

    it('pluralizes "product" to "products"', () => {
      expect(pluralize('product')).toBe('products')
    })

    it('pluralizes "user" to "users"', () => {
      expect(pluralize('user')).toBe('users')
    })

    it('pluralizes "deal" to "deals"', () => {
      expect(pluralize('deal')).toBe('deals')
    })

    it('pluralizes "order" to "orders"', () => {
      expect(pluralize('order')).toBe('orders')
    })
  })

  describe('words ending in s, x, ch, sh - adding "es"', () => {
    it('pluralizes "status" to "statuses"', () => {
      expect(pluralize('status')).toBe('statuses')
    })

    it('pluralizes "class" to "classes"', () => {
      expect(pluralize('class')).toBe('classes')
    })

    it('pluralizes "box" to "boxes"', () => {
      expect(pluralize('box')).toBe('boxes')
    })

    it('pluralizes "tax" to "taxes"', () => {
      expect(pluralize('tax')).toBe('taxes')
    })

    it('pluralizes "match" to "matches"', () => {
      expect(pluralize('match')).toBe('matches')
    })

    it('pluralizes "watch" to "watches"', () => {
      expect(pluralize('watch')).toBe('watches')
    })

    it('pluralizes "wish" to "wishes"', () => {
      expect(pluralize('wish')).toBe('wishes')
    })

    it('pluralizes "dish" to "dishes"', () => {
      expect(pluralize('dish')).toBe('dishes')
    })
  })

  describe('words ending in consonant + y - changing y to ies', () => {
    it('pluralizes "category" to "categories"', () => {
      expect(pluralize('category')).toBe('categories')
    })

    it('pluralizes "company" to "companies"', () => {
      expect(pluralize('company')).toBe('companies')
    })

    it('pluralizes "activity" to "activities"', () => {
      expect(pluralize('activity')).toBe('activities')
    })

    it('pluralizes "entity" to "entities"', () => {
      expect(pluralize('entity')).toBe('entities')
    })

    it('pluralizes "party" to "parties"', () => {
      expect(pluralize('party')).toBe('parties')
    })
  })

  describe('words ending in vowel + y - adding "s"', () => {
    it('pluralizes "key" to "keys"', () => {
      expect(pluralize('key')).toBe('keys')
    })

    it('pluralizes "day" to "days"', () => {
      expect(pluralize('day')).toBe('days')
    })

    it('pluralizes "toy" to "toys"', () => {
      expect(pluralize('toy')).toBe('toys')
    })

    it('pluralizes "boy" to "boys"', () => {
      expect(pluralize('boy')).toBe('boys')
    })

    it('pluralizes "guy" to "guys"', () => {
      expect(pluralize('guy')).toBe('guys')
    })
  })

  describe('irregular plurals', () => {
    it('pluralizes "person" to "people"', () => {
      expect(pluralize('person')).toBe('people')
    })

    it('pluralizes "child" to "children"', () => {
      expect(pluralize('child')).toBe('children')
    })

    it('pluralizes "man" to "men"', () => {
      expect(pluralize('man')).toBe('men')
    })

    it('pluralizes "woman" to "women"', () => {
      expect(pluralize('woman')).toBe('women')
    })

    it('pluralizes "foot" to "feet"', () => {
      expect(pluralize('foot')).toBe('feet')
    })

    it('pluralizes "tooth" to "teeth"', () => {
      expect(pluralize('tooth')).toBe('teeth')
    })

    it('pluralizes "goose" to "geese"', () => {
      expect(pluralize('goose')).toBe('geese')
    })

    it('pluralizes "mouse" to "mice"', () => {
      expect(pluralize('mouse')).toBe('mice')
    })

    it('pluralizes "ox" to "oxen"', () => {
      expect(pluralize('ox')).toBe('oxen')
    })
  })

  describe('case handling', () => {
    it('converts PascalCase to lowercase plural', () => {
      expect(pluralize('Customer')).toBe('customers')
    })

    it('converts uppercase to lowercase plural', () => {
      expect(pluralize('PRODUCT')).toBe('products')
    })

    it('handles mixed case', () => {
      expect(pluralize('OrderItem')).toBe('orderitems')
    })

    it('handles irregular plurals in PascalCase', () => {
      expect(pluralize('Person')).toBe('people')
    })
  })

  describe('caching behavior', () => {
    it('returns consistent results for same input', () => {
      const first = pluralize('customer')
      const second = pluralize('customer')

      expect(first).toBe(second)
    })

    it('returns consistent results regardless of case', () => {
      const lower = pluralize('customer')
      const upper = pluralize('Customer')
      const mixed = pluralize('CUSTOMER')

      expect(lower).toBe(upper)
      expect(upper).toBe(mixed)
    })
  })
})

// ============================================================================
// normalizeNs Tests
// ============================================================================

describe('normalizeNs', () => {
  describe('trailing slash removal', () => {
    it('removes trailing slash from URL', () => {
      expect(normalizeNs('https://headless.ly/')).toBe('https://headless.ly')
    })

    it('leaves URL without trailing slash unchanged', () => {
      expect(normalizeNs('https://headless.ly')).toBe('https://headless.ly')
    })

    it('removes trailing slash from path URL', () => {
      expect(normalizeNs('https://api.example.com/v1/')).toBe('https://api.example.com/v1')
    })

    it('handles URL with only trailing slash as path', () => {
      expect(normalizeNs('https://example.com/')).toBe('https://example.com')
    })
  })

  describe('preserves other URL components', () => {
    it('preserves port numbers', () => {
      expect(normalizeNs('https://localhost:8787/')).toBe('https://localhost:8787')
    })

    it('preserves query parameters', () => {
      expect(normalizeNs('https://api.example.com?key=value')).toBe('https://api.example.com?key=value')
    })

    it('preserves hash fragments', () => {
      expect(normalizeNs('https://example.com/page#section')).toBe('https://example.com/page#section')
    })

    it('preserves deep paths', () => {
      expect(normalizeNs('https://api.example.com/v1/tenant/workspace/')).toBe(
        'https://api.example.com/v1/tenant/workspace'
      )
    })
  })

  describe('edge cases', () => {
    it('handles empty string', () => {
      expect(normalizeNs('')).toBe('')
    })

    it('handles single slash', () => {
      expect(normalizeNs('/')).toBe('')
    })

    it('handles relative paths', () => {
      expect(normalizeNs('api/v1/')).toBe('api/v1')
    })

    it('handles protocol-relative URLs', () => {
      expect(normalizeNs('//example.com/path/')).toBe('//example.com/path')
    })
  })

  describe('caching behavior', () => {
    it('returns consistent results for same input', () => {
      const first = normalizeNs('https://headless.ly/')
      const second = normalizeNs('https://headless.ly/')

      expect(first).toBe(second)
    })

    it('caches both slashed and non-slashed versions separately', () => {
      const slashed = normalizeNs('https://example.com/')
      const nonSlashed = normalizeNs('https://example.com')

      expect(slashed).toBe(nonSlashed)
    })
  })
})

// ============================================================================
// Query Parameter Handling Tests
// ============================================================================

describe('query parameter handling', () => {
  describe('buildContextUrl with query parameters', () => {
    it('preserves query parameters in namespace', () => {
      const result = buildContextUrl('https://headless.ly?version=1')

      expect(result).toBe('https://headless.ly?version=1')
    })

    it('preserves multiple query parameters', () => {
      const result = buildContextUrl('https://api.example.com?a=1&b=2')

      expect(result).toBe('https://api.example.com?a=1&b=2')
    })

    it('preserves encoded query parameters', () => {
      const result = buildContextUrl('https://api.example.com?q=hello%20world')

      expect(result).toBe('https://api.example.com?q=hello%20world')
    })
  })

  describe('buildTypeUrl with query parameters in namespace', () => {
    it('appends type path after query parameters', () => {
      // Note: query params in namespace are preserved but type is appended
      // This may or may not be the desired behavior - documenting current behavior
      const result = buildTypeUrl('https://headless.ly?version=1', 'Customer')

      // Current implementation appends type after query string
      expect(result).toBe('https://headless.ly?version=1/customers')
    })
  })

  describe('buildIdUrl with special characters requiring encoding', () => {
    it('encodes @ symbol in id', () => {
      const result = buildIdUrl('https://headless.ly', 'User', 'user@example.com')

      expect(result).toBe('https://headless.ly/users/user%40example.com')
    })

    it('encodes space in id', () => {
      const result = buildIdUrl('https://headless.ly', 'Customer', 'John Doe')

      expect(result).toBe('https://headless.ly/customers/John%20Doe')
    })

    it('encodes hash symbol in id', () => {
      const result = buildIdUrl('https://headless.ly', 'Tag', '#trending')

      expect(result).toBe('https://headless.ly/tags/%23trending')
    })

    it('encodes question mark in id', () => {
      const result = buildIdUrl('https://headless.ly', 'Query', 'what?')

      expect(result).toBe('https://headless.ly/queries/what%3F')
    })

    it('encodes ampersand in id', () => {
      const result = buildIdUrl('https://headless.ly', 'Company', 'Smith & Jones')

      expect(result).toBe('https://headless.ly/companies/Smith%20%26%20Jones')
    })

    it('encodes plus sign in id', () => {
      const result = buildIdUrl('https://headless.ly', 'Feature', 'A+B')

      expect(result).toBe('https://headless.ly/features/A%2BB')
    })

    it('encodes percent sign in id', () => {
      const result = buildIdUrl('https://headless.ly', 'Discount', '50%off')

      expect(result).toBe('https://headless.ly/discounts/50%25off')
    })

    it('preserves safe characters in id', () => {
      // These should NOT be encoded: A-Z a-z 0-9 - _ . ! ~ * ' ( )
      const result = buildIdUrl('https://headless.ly', 'Item', 'item-123_test.v1')

      expect(result).toBe('https://headless.ly/items/item-123_test.v1')
    })
  })
})

// ============================================================================
// Base URL Resolution Tests
// ============================================================================

describe('base URL resolution', () => {
  describe('different URL schemes', () => {
    it('handles https URLs', () => {
      expect(buildTypeUrl('https://headless.ly', 'Customer')).toBe('https://headless.ly/customers')
    })

    it('handles http URLs', () => {
      expect(buildTypeUrl('http://localhost:8787', 'Customer')).toBe('http://localhost:8787/customers')
    })

    it('handles custom protocols', () => {
      // While uncommon, custom protocols should work
      expect(buildTypeUrl('app://my-app', 'Customer')).toBe('app://my-app/customers')
    })
  })

  describe('port handling', () => {
    it('preserves standard HTTPS port (implicit)', () => {
      expect(buildTypeUrl('https://headless.ly', 'Customer')).toBe('https://headless.ly/customers')
    })

    it('preserves non-standard port', () => {
      expect(buildTypeUrl('https://localhost:8787', 'Customer')).toBe('https://localhost:8787/customers')
    })

    it('preserves port 443 if explicit', () => {
      expect(buildTypeUrl('https://example.com:443', 'Customer')).toBe('https://example.com:443/customers')
    })

    it('preserves port 80 if explicit', () => {
      expect(buildTypeUrl('http://example.com:80', 'Customer')).toBe('http://example.com:80/customers')
    })
  })

  describe('path segment handling', () => {
    it('handles single path segment', () => {
      expect(buildTypeUrl('https://api.example.com/v1', 'Customer')).toBe('https://api.example.com/v1/customers')
    })

    it('handles multiple path segments', () => {
      expect(buildTypeUrl('https://api.example.com/v1/tenant', 'Customer')).toBe(
        'https://api.example.com/v1/tenant/customers'
      )
    })

    it('handles deep nested paths', () => {
      expect(buildTypeUrl('https://api.example.com/a/b/c/d', 'Customer')).toBe(
        'https://api.example.com/a/b/c/d/customers'
      )
    })
  })

  describe('subdomain handling', () => {
    it('handles multiple subdomains', () => {
      expect(buildTypeUrl('https://api.v2.staging.example.com', 'Customer')).toBe(
        'https://api.v2.staging.example.com/customers'
      )
    })

    it('handles hyphenated subdomains', () => {
      expect(buildTypeUrl('https://my-cool-app.workers.dev', 'Customer')).toBe(
        'https://my-cool-app.workers.dev/customers'
      )
    })

    it('handles numbered subdomains', () => {
      expect(buildTypeUrl('https://api2.example.com', 'Customer')).toBe('https://api2.example.com/customers')
    })
  })

  describe('TLD handling', () => {
    it('handles .com TLD', () => {
      expect(buildTypeUrl('https://example.com', 'Customer')).toBe('https://example.com/customers')
    })

    it('handles .io TLD', () => {
      expect(buildTypeUrl('https://example.io', 'Customer')).toBe('https://example.io/customers')
    })

    it('handles .dev TLD', () => {
      expect(buildTypeUrl('https://example.dev', 'Customer')).toBe('https://example.dev/customers')
    })

    it('handles .ai TLD', () => {
      expect(buildTypeUrl('https://schema.org.ai', 'Customer')).toBe('https://schema.org.ai/customers')
    })

    it('handles country TLDs', () => {
      expect(buildTypeUrl('https://example.co.uk', 'Customer')).toBe('https://example.co.uk/customers')
    })
  })
})

// ============================================================================
// Relative URL Tests
// ============================================================================

describe('relative URL handling', () => {
  describe('path-only inputs', () => {
    it('handles root-relative path', () => {
      expect(buildTypeUrl('/api/v1', 'Customer')).toBe('/api/v1/customers')
    })

    it('handles simple relative path', () => {
      expect(buildTypeUrl('api/v1', 'Customer')).toBe('api/v1/customers')
    })

    it('handles current directory relative path', () => {
      expect(buildTypeUrl('./api', 'Customer')).toBe('./api/customers')
    })
  })

  describe('protocol-relative URLs', () => {
    it('handles protocol-relative URL', () => {
      expect(buildTypeUrl('//example.com/api', 'Customer')).toBe('//example.com/api/customers')
    })
  })

  describe('special path patterns', () => {
    it('handles path with dots', () => {
      expect(buildTypeUrl('https://api.example.com/v1.0', 'Customer')).toBe('https://api.example.com/v1.0/customers')
    })

    it('handles path with underscores', () => {
      expect(buildTypeUrl('https://api.example.com/my_tenant', 'Customer')).toBe(
        'https://api.example.com/my_tenant/customers'
      )
    })

    it('handles path with hyphens', () => {
      expect(buildTypeUrl('https://api.example.com/my-tenant', 'Customer')).toBe(
        'https://api.example.com/my-tenant/customers'
      )
    })

    it('handles path with numbers', () => {
      expect(buildTypeUrl('https://api.example.com/tenant123', 'Customer')).toBe(
        'https://api.example.com/tenant123/customers'
      )
    })
  })
})

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
