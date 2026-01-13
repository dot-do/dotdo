import { describe, it, expect } from 'vitest'

/**
 * Actions Builder Tests (RED Phase)
 *
 * These tests verify the action URL building utilities for constructing
 * mutation endpoints in the dotdo response format.
 *
 * They are expected to FAIL until lib/response/actions.ts is implemented.
 *
 * Expected function signatures (to be implemented):
 *
 * interface ItemActionsOptions {
 *   ns: string
 *   type: string
 *   id: string
 *   customActions?: string[]  // e.g., ['promote', 'archive']
 * }
 *
 * interface CollectionActionsOptions {
 *   ns: string
 *   type: string
 *   customActions?: string[]  // e.g., ['export', 'import']
 * }
 *
 * export function buildItemActions(options: ItemActionsOptions): Record<string, string>
 * export function buildCollectionActions(options: CollectionActionsOptions): Record<string, string>
 *
 * URL Format:
 * - Item update/delete: namespace + '/' + pluralize(type) + '/' + id
 * - Item custom action: namespace + '/' + pluralize(type) + '/' + id + '/' + action
 * - Collection create: namespace + '/' + pluralize(type)
 * - Collection custom action: namespace + '/' + pluralize(type) + '/' + action
 *
 * Examples:
 * - Item update: "https://headless.ly/customers/alice"
 * - Item promote action: "https://headless.ly/customers/alice/promote"
 * - Collection create: "https://headless.ly/customers"
 * - Collection export action: "https://headless.ly/customers/export"
 */

// Import the module under test (will fail until implemented)
import { buildItemActions, buildCollectionActions } from '../actions'

// ============================================================================
// buildItemActions Tests
// ============================================================================

describe('buildItemActions', () => {
  describe('default item actions', () => {
    it('returns update and delete actions for basic item', () => {
      const result = buildItemActions({
        ns: 'https://headless.ly',
        type: 'Customer',
        id: 'alice',
      })

      expect(result).toEqual({
        update: 'https://headless.ly/customers/alice',
        delete: 'https://headless.ly/customers/alice',
      })
    })

    it('returns update and delete actions for CRM example', () => {
      const result = buildItemActions({
        ns: 'https://crm.example.org.ai/acme',
        type: 'Contact',
        id: 'ord-123',
      })

      expect(result).toEqual({
        update: 'https://crm.example.org.ai/acme/contacts/ord-123',
        delete: 'https://crm.example.org.ai/acme/contacts/ord-123',
      })
    })

    it('returns update and delete actions for Startups.Studio', () => {
      const result = buildItemActions({
        ns: 'https://Startups.Studio',
        type: 'Deal',
        id: 'acme',
      })

      expect(result).toEqual({
        update: 'https://Startups.Studio/deals/acme',
        delete: 'https://Startups.Studio/deals/acme',
      })
    })
  })

  describe('item actions with custom actions', () => {
    it('includes single custom action', () => {
      const result = buildItemActions({
        ns: 'https://headless.ly',
        type: 'Customer',
        id: 'alice',
        customActions: ['promote'],
      })

      expect(result).toEqual({
        update: 'https://headless.ly/customers/alice',
        delete: 'https://headless.ly/customers/alice',
        promote: 'https://headless.ly/customers/alice/promote',
      })
    })

    it('includes multiple custom actions', () => {
      const result = buildItemActions({
        ns: 'https://headless.ly',
        type: 'Customer',
        id: 'alice',
        customActions: ['promote', 'archive', 'suspend'],
      })

      expect(result).toEqual({
        update: 'https://headless.ly/customers/alice',
        delete: 'https://headless.ly/customers/alice',
        promote: 'https://headless.ly/customers/alice/promote',
        archive: 'https://headless.ly/customers/alice/archive',
        suspend: 'https://headless.ly/customers/alice/suspend',
      })
    })

    it('handles empty custom actions array', () => {
      const result = buildItemActions({
        ns: 'https://headless.ly',
        type: 'Customer',
        id: 'alice',
        customActions: [],
      })

      expect(result).toEqual({
        update: 'https://headless.ly/customers/alice',
        delete: 'https://headless.ly/customers/alice',
      })
    })

    it('handles hyphenated custom action names', () => {
      const result = buildItemActions({
        ns: 'https://headless.ly',
        type: 'Order',
        id: 'ord-123',
        customActions: ['mark-shipped', 'request-refund'],
      })

      expect(result).toEqual({
        update: 'https://headless.ly/orders/ord-123',
        delete: 'https://headless.ly/orders/ord-123',
        'mark-shipped': 'https://headless.ly/orders/ord-123/mark-shipped',
        'request-refund': 'https://headless.ly/orders/ord-123/request-refund',
      })
    })
  })

  describe('type pluralization', () => {
    it('pluralizes regular nouns', () => {
      const result = buildItemActions({
        ns: 'https://headless.ly',
        type: 'Product',
        id: 'p1',
      })

      expect(result.update).toBe('https://headless.ly/products/p1')
    })

    it('pluralizes nouns ending in y to ies', () => {
      const result = buildItemActions({
        ns: 'https://headless.ly',
        type: 'Category',
        id: 'tech',
      })

      expect(result.update).toBe('https://headless.ly/categories/tech')
    })

    it('pluralizes nouns ending in s to ses', () => {
      const result = buildItemActions({
        ns: 'https://headless.ly',
        type: 'Status',
        id: 'active',
      })

      expect(result.update).toBe('https://headless.ly/statuses/active')
    })

    it('handles irregular plurals - Person to people', () => {
      const result = buildItemActions({
        ns: 'https://headless.ly',
        type: 'Person',
        id: 'john',
      })

      expect(result.update).toBe('https://headless.ly/people/john')
    })

    it('handles irregular plurals - Child to children', () => {
      const result = buildItemActions({
        ns: 'https://headless.ly',
        type: 'Child',
        id: 'c1',
      })

      expect(result.update).toBe('https://headless.ly/children/c1')
    })
  })

  describe('ID encoding', () => {
    it('URL-encodes special characters in id', () => {
      const result = buildItemActions({
        ns: 'https://headless.ly',
        type: 'User',
        id: 'user@example.com',
      })

      expect(result.update).toBe('https://headless.ly/users/user%40example.com')
    })

    it('URL-encodes spaces in id', () => {
      const result = buildItemActions({
        ns: 'https://headless.ly',
        type: 'User',
        id: 'alice bob',
      })

      expect(result.update).toBe('https://headless.ly/users/alice%20bob')
    })

    it('URL-encodes forward slashes in id', () => {
      const result = buildItemActions({
        ns: 'https://headless.ly',
        type: 'File',
        id: 'path/to/file',
      })

      expect(result.update).toBe('https://headless.ly/files/path%2Fto%2Ffile')
    })

    it('preserves hyphens and underscores in id', () => {
      const result = buildItemActions({
        ns: 'https://headless.ly',
        type: 'Resource',
        id: 'my-resource_123',
      })

      expect(result.update).toBe('https://headless.ly/resources/my-resource_123')
    })
  })

  describe('edge cases - namespace handling', () => {
    it('handles namespace with trailing slash', () => {
      const result = buildItemActions({
        ns: 'https://headless.ly/',
        type: 'Customer',
        id: 'alice',
      })

      // Should not double up slashes
      expect(result.update).toBe('https://headless.ly/customers/alice')
    })

    it('handles namespace with port', () => {
      const result = buildItemActions({
        ns: 'https://localhost:8787',
        type: 'Customer',
        id: 'alice',
      })

      expect(result.update).toBe('https://localhost:8787/customers/alice')
    })

    it('handles namespace with deep path', () => {
      const result = buildItemActions({
        ns: 'https://api.example.com/v1/tenant',
        type: 'Customer',
        id: 'alice',
      })

      expect(result.update).toBe('https://api.example.com/v1/tenant/customers/alice')
    })
  })

  describe('fully qualified URL validation', () => {
    it('returns URLs that are fully qualified (start with https://)', () => {
      const result = buildItemActions({
        ns: 'https://headless.ly',
        type: 'Customer',
        id: 'alice',
        customActions: ['promote'],
      })

      expect(result.update).toMatch(/^https?:\/\//)
      expect(result.delete).toMatch(/^https?:\/\//)
      expect(result.promote).toMatch(/^https?:\/\//)
    })

    it('all action URLs are valid URLs', () => {
      const result = buildItemActions({
        ns: 'https://headless.ly',
        type: 'Customer',
        id: 'alice',
        customActions: ['promote', 'archive'],
      })

      Object.values(result).forEach((url) => {
        expect(() => new URL(url)).not.toThrow()
      })
    })
  })
})

// ============================================================================
// buildCollectionActions Tests
// ============================================================================

describe('buildCollectionActions', () => {
  describe('default collection actions', () => {
    it('returns create action for basic collection', () => {
      const result = buildCollectionActions({
        ns: 'https://headless.ly',
        type: 'Customer',
      })

      expect(result).toEqual({
        create: 'https://headless.ly/customers',
      })
    })

    it('returns create action for CRM example', () => {
      const result = buildCollectionActions({
        ns: 'https://crm.example.org.ai/acme',
        type: 'Contact',
      })

      expect(result).toEqual({
        create: 'https://crm.example.org.ai/acme/contacts',
      })
    })

    it('returns create action for Startups.Studio', () => {
      const result = buildCollectionActions({
        ns: 'https://Startups.Studio',
        type: 'Deal',
      })

      expect(result).toEqual({
        create: 'https://Startups.Studio/deals',
      })
    })
  })

  describe('collection actions with custom actions', () => {
    it('includes single custom action', () => {
      const result = buildCollectionActions({
        ns: 'https://headless.ly',
        type: 'Customer',
        customActions: ['export'],
      })

      expect(result).toEqual({
        create: 'https://headless.ly/customers',
        export: 'https://headless.ly/customers/export',
      })
    })

    it('includes multiple custom actions', () => {
      const result = buildCollectionActions({
        ns: 'https://headless.ly',
        type: 'Customer',
        customActions: ['export', 'import', 'bulk-delete'],
      })

      expect(result).toEqual({
        create: 'https://headless.ly/customers',
        export: 'https://headless.ly/customers/export',
        import: 'https://headless.ly/customers/import',
        'bulk-delete': 'https://headless.ly/customers/bulk-delete',
      })
    })

    it('handles empty custom actions array', () => {
      const result = buildCollectionActions({
        ns: 'https://headless.ly',
        type: 'Customer',
        customActions: [],
      })

      expect(result).toEqual({
        create: 'https://headless.ly/customers',
      })
    })

    it('handles hyphenated custom action names', () => {
      const result = buildCollectionActions({
        ns: 'https://headless.ly',
        type: 'Order',
        customActions: ['bulk-cancel', 'generate-report'],
      })

      expect(result).toEqual({
        create: 'https://headless.ly/orders',
        'bulk-cancel': 'https://headless.ly/orders/bulk-cancel',
        'generate-report': 'https://headless.ly/orders/generate-report',
      })
    })
  })

  describe('type pluralization', () => {
    it('pluralizes regular nouns', () => {
      const result = buildCollectionActions({
        ns: 'https://headless.ly',
        type: 'Product',
      })

      expect(result.create).toBe('https://headless.ly/products')
    })

    it('pluralizes nouns ending in y to ies', () => {
      const result = buildCollectionActions({
        ns: 'https://headless.ly',
        type: 'Category',
      })

      expect(result.create).toBe('https://headless.ly/categories')
    })

    it('pluralizes nouns ending in s to ses', () => {
      const result = buildCollectionActions({
        ns: 'https://headless.ly',
        type: 'Status',
      })

      expect(result.create).toBe('https://headless.ly/statuses')
    })

    it('pluralizes nouns ending in x to xes', () => {
      const result = buildCollectionActions({
        ns: 'https://headless.ly',
        type: 'Box',
      })

      expect(result.create).toBe('https://headless.ly/boxes')
    })

    it('pluralizes nouns ending in ch to ches', () => {
      const result = buildCollectionActions({
        ns: 'https://headless.ly',
        type: 'Match',
      })

      expect(result.create).toBe('https://headless.ly/matches')
    })

    it('handles irregular plurals - Person to people', () => {
      const result = buildCollectionActions({
        ns: 'https://headless.ly',
        type: 'Person',
      })

      expect(result.create).toBe('https://headless.ly/people')
    })

    it('handles irregular plurals - Child to children', () => {
      const result = buildCollectionActions({
        ns: 'https://headless.ly',
        type: 'Child',
      })

      expect(result.create).toBe('https://headless.ly/children')
    })
  })

  describe('edge cases - namespace handling', () => {
    it('handles namespace with trailing slash', () => {
      const result = buildCollectionActions({
        ns: 'https://headless.ly/',
        type: 'Customer',
      })

      // Should not double up slashes
      expect(result.create).toBe('https://headless.ly/customers')
    })

    it('handles namespace with port', () => {
      const result = buildCollectionActions({
        ns: 'https://localhost:8787',
        type: 'Customer',
      })

      expect(result.create).toBe('https://localhost:8787/customers')
    })

    it('handles namespace with deep path', () => {
      const result = buildCollectionActions({
        ns: 'https://api.example.com/v1/tenant',
        type: 'Customer',
      })

      expect(result.create).toBe('https://api.example.com/v1/tenant/customers')
    })

    it('handles namespace with hyphenated domain', () => {
      const result = buildCollectionActions({
        ns: 'https://my-cool-app.workers.dev',
        type: 'Customer',
      })

      expect(result.create).toBe('https://my-cool-app.workers.dev/customers')
    })
  })

  describe('fully qualified URL validation', () => {
    it('returns URLs that are fully qualified (start with https://)', () => {
      const result = buildCollectionActions({
        ns: 'https://headless.ly',
        type: 'Customer',
        customActions: ['export'],
      })

      expect(result.create).toMatch(/^https?:\/\//)
      expect(result.export).toMatch(/^https?:\/\//)
    })

    it('all action URLs are valid URLs', () => {
      const result = buildCollectionActions({
        ns: 'https://headless.ly',
        type: 'Customer',
        customActions: ['export', 'import'],
      })

      Object.values(result).forEach((url) => {
        expect(() => new URL(url)).not.toThrow()
      })
    })
  })
})

// ============================================================================
// Integration Tests - Actions Consistency
// ============================================================================

describe('actions consistency', () => {
  describe('item and collection action relationship', () => {
    it('item update URL extends collection create URL', () => {
      const collectionActions = buildCollectionActions({
        ns: 'https://headless.ly',
        type: 'Customer',
      })

      const itemActions = buildItemActions({
        ns: 'https://headless.ly',
        type: 'Customer',
        id: 'alice',
      })

      expect(itemActions.update.startsWith(collectionActions.create)).toBe(true)
    })

    it('item custom action URL extends item base URL', () => {
      const itemActions = buildItemActions({
        ns: 'https://headless.ly',
        type: 'Customer',
        id: 'alice',
        customActions: ['promote'],
      })

      expect(itemActions.promote.startsWith(itemActions.update)).toBe(true)
      expect(itemActions.promote).toBe(`${itemActions.update}/promote`)
    })

    it('collection custom action URL extends collection base URL', () => {
      const collectionActions = buildCollectionActions({
        ns: 'https://headless.ly',
        type: 'Customer',
        customActions: ['export'],
      })

      expect(collectionActions.export.startsWith(collectionActions.create)).toBe(true)
      expect(collectionActions.export).toBe(`${collectionActions.create}/export`)
    })
  })

  describe('real-world namespace examples', () => {
    it('headless.ly namespace produces valid action URLs', () => {
      const ns = 'https://headless.ly'

      const collectionActions = buildCollectionActions({
        ns,
        type: 'Customer',
        customActions: ['export'],
      })

      expect(collectionActions).toEqual({
        create: 'https://headless.ly/customers',
        export: 'https://headless.ly/customers/export',
      })

      const itemActions = buildItemActions({
        ns,
        type: 'Customer',
        id: 'alice',
        customActions: ['promote'],
      })

      expect(itemActions).toEqual({
        update: 'https://headless.ly/customers/alice',
        delete: 'https://headless.ly/customers/alice',
        promote: 'https://headless.ly/customers/alice/promote',
      })
    })

    it('CRM example namespace produces valid action URLs', () => {
      const ns = 'https://crm.example.org.ai/acme'

      const collectionActions = buildCollectionActions({
        ns,
        type: 'Contact',
        customActions: ['import'],
      })

      expect(collectionActions).toEqual({
        create: 'https://crm.example.org.ai/acme/contacts',
        import: 'https://crm.example.org.ai/acme/contacts/import',
      })

      const itemActions = buildItemActions({
        ns,
        type: 'Contact',
        id: 'ord-123',
        customActions: ['archive'],
      })

      expect(itemActions).toEqual({
        update: 'https://crm.example.org.ai/acme/contacts/ord-123',
        delete: 'https://crm.example.org.ai/acme/contacts/ord-123',
        archive: 'https://crm.example.org.ai/acme/contacts/ord-123/archive',
      })
    })

    it('Startups.Studio namespace produces valid action URLs', () => {
      const ns = 'https://Startups.Studio'

      const collectionActions = buildCollectionActions({
        ns,
        type: 'Deal',
      })

      expect(collectionActions).toEqual({
        create: 'https://Startups.Studio/deals',
      })

      const itemActions = buildItemActions({
        ns,
        type: 'Deal',
        id: 'acme',
        customActions: ['close', 'reopen'],
      })

      expect(itemActions).toEqual({
        update: 'https://Startups.Studio/deals/acme',
        delete: 'https://Startups.Studio/deals/acme',
        close: 'https://Startups.Studio/deals/acme/close',
        reopen: 'https://Startups.Studio/deals/acme/reopen',
      })
    })
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('type safety', () => {
  it('buildItemActions returns Record<string, string>', () => {
    const result: Record<string, string> = buildItemActions({
      ns: 'https://headless.ly',
      type: 'Customer',
      id: 'alice',
    })

    expect(typeof result).toBe('object')
    expect(typeof result.update).toBe('string')
    expect(typeof result.delete).toBe('string')
  })

  it('buildCollectionActions returns Record<string, string>', () => {
    const result: Record<string, string> = buildCollectionActions({
      ns: 'https://headless.ly',
      type: 'Customer',
    })

    expect(typeof result).toBe('object')
    expect(typeof result.create).toBe('string')
  })

  it('buildItemActions accepts customActions array', () => {
    const result: Record<string, string> = buildItemActions({
      ns: 'https://headless.ly',
      type: 'Customer',
      id: 'alice',
      customActions: ['promote', 'archive'],
    })

    expect(typeof result.promote).toBe('string')
    expect(typeof result.archive).toBe('string')
  })

  it('buildCollectionActions accepts customActions array', () => {
    const result: Record<string, string> = buildCollectionActions({
      ns: 'https://headless.ly',
      type: 'Customer',
      customActions: ['export', 'import'],
    })

    expect(typeof result.export).toBe('string')
    expect(typeof result.import).toBe('string')
  })
})
