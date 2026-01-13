import { describe, it, expect } from 'vitest'

/**
 * Parent/Child Context Navigation Tests
 *
 * Comprehensive tests for parent context handling in API responses:
 *
 * 1. Parent Context Navigation
 *    - $context field navigation "up" the hierarchy
 *    - From item to collection to parent DO
 *    - Orphan DO fallback to schema.org.ai
 *
 * 2. Parent-Child Relationships
 *    - Nested resources (e.g., /customers/alice/orders)
 *    - Child resources inherit parent context
 *    - Bidirectional navigation (up via $context, down via links)
 *
 * 3. Context Inheritance
 *    - Items inherit context from their collection
 *    - Collections inherit context from their parent DO
 *    - Nested collections maintain proper context chains
 *
 * 4. Nested Resource URLs
 *    - Building URLs for nested resources
 *    - Parent path segments in child URLs
 *    - Deep nesting support (3+ levels)
 *
 * 5. Breadcrumb Generation
 *    - Building navigation breadcrumbs from context chain
 *    - Traversable path from root to current resource
 *
 * 6. Access Control Propagation
 *    - Deriving access permissions from parent context
 *    - Role-based access inheritance
 *    - Permission scoping through hierarchy
 *
 * Expected behavior:
 * - isRoot + parent provided: $context = parent URL
 * - isRoot + no parent + type 'DO': $context = 'https://schema.org.ai/DO'
 * - isRoot + no parent + isCollection: $context = 'https://schema.org.ai/Collection'
 * - isRoot + no parent + other type: $context = 'https://schema.org.ai/{type}'
 */

import { buildResponse } from '../linked-data'
import { buildCollectionResponse } from '../collection'
import { buildIdUrl, buildTypeUrl } from '../urls'

// ============================================================================
// Root with Parent Tests
// ============================================================================

describe('buildResponse - parent context navigation', () => {
  describe('root with parent DO', () => {
    it('uses parent URL as $context when parent exists', () => {
      const result = buildResponse(
        { name: 'Headless.ly' },
        {
          ns: 'https://headless.ly',
          type: 'Startup',
          isRoot: true,
          parent: 'https://Startups.Studio',
        }
      )

      expect(result.$context).toBe('https://Startups.Studio')
      expect(result.$type).toBe('https://headless.ly')
      expect(result.$id).toBe('https://headless.ly')
    })

    it('handles deeply nested parent hierarchy', () => {
      // A project within an org within a platform
      const result = buildResponse(
        { name: 'My Project' },
        {
          ns: 'https://myproject.acme.platform.do',
          type: 'Project',
          isRoot: true,
          parent: 'https://acme.platform.do',
        }
      )

      expect(result.$context).toBe('https://acme.platform.do')
      expect(result.$type).toBe('https://myproject.acme.platform.do')
      expect(result.$id).toBe('https://myproject.acme.platform.do')
    })

    it('uses parent for child startup within studio', () => {
      const result = buildResponse(
        { name: 'Child Startup', hypothesis: 'Test hypothesis' },
        {
          ns: 'https://child.Startups.Studio',
          type: 'Startup',
          isRoot: true,
          parent: 'https://Startups.Studio/startups',
        }
      )

      expect(result.$context).toBe('https://Startups.Studio/startups')
      expect(result.name).toBe('Child Startup')
    })
  })

  // ============================================================================
  // Orphan DO Tests (no parent - should default to schema.org.ai)
  // ============================================================================

  describe('orphan DO (no parent)', () => {
    it('defaults to schema.org.ai/DO for orphan DO type', () => {
      const result = buildResponse(
        { name: 'Standalone DO' },
        {
          ns: 'https://standalone.example.org.ai',
          type: 'DO',
          isRoot: true,
          // no parent - orphan DO
        }
      )

      // Should fall back to schema definition for DO type
      expect(result.$context).toBe('https://schema.org.ai/DO')
      expect(result.$type).toBe('https://standalone.example.org.ai')
      expect(result.$id).toBe('https://standalone.example.org.ai')
    })

    it('defaults to schema.org.ai/Startup for orphan Startup type', () => {
      const result = buildResponse(
        { name: 'Independent Startup', hypothesis: 'Going it alone' },
        {
          ns: 'https://independent.startup.ai',
          type: 'Startup',
          isRoot: true,
          // no parent - orphan startup
        }
      )

      // Should fall back to schema definition for Startup type
      expect(result.$context).toBe('https://schema.org.ai/Startup')
      expect(result.$type).toBe('https://independent.startup.ai')
      expect(result.$id).toBe('https://independent.startup.ai')
    })

    it('defaults to schema.org.ai/Agent for orphan Agent type', () => {
      const result = buildResponse(
        { name: 'Autonomous Agent', role: 'worker' },
        {
          ns: 'https://agent.workers.do',
          type: 'Agent',
          isRoot: true,
          // no parent
        }
      )

      expect(result.$context).toBe('https://schema.org.ai/Agent')
      expect(result.$type).toBe('https://agent.workers.do')
    })

    it('defaults to schema.org.ai/Organization for orphan Organization type', () => {
      const result = buildResponse(
        { name: 'Acme Corp', industry: 'tech' },
        {
          ns: 'https://acme.org.ai',
          type: 'Organization',
          isRoot: true,
          // no parent
        }
      )

      expect(result.$context).toBe('https://schema.org.ai/Organization')
    })
  })

  // ============================================================================
  // Orphan Collection Tests
  // ============================================================================

  describe('orphan Collection (no parent)', () => {
    it('defaults to schema.org.ai/Collection for orphan Collection type', () => {
      const result = buildResponse(
        { items: [], total: 0 },
        {
          ns: 'https://Startups.Studio',
          type: 'Collection',
          isRoot: true,
          isCollection: true,
          // no parent - top-level collection
        }
      )

      // Orphan collection should reference Collection schema
      expect(result.$context).toBe('https://schema.org.ai/Collection')
      expect(result.$type).toBe('https://Startups.Studio')
      expect(result.$id).toBe('https://Startups.Studio')
    })

    it('defaults to schema.org.ai/Collection for any orphan root collection', () => {
      const result = buildResponse(
        { items: [{ name: 'Item 1' }], count: 1 },
        {
          ns: 'https://items.example.org.ai',
          type: 'Item',
          isRoot: true,
          isCollection: true,
          // no parent
        }
      )

      // isCollection at root without parent should use Collection schema
      expect(result.$context).toBe('https://schema.org.ai/Collection')
    })

    it('uses parent when collection has parent', () => {
      const result = buildResponse(
        { items: [], total: 0 },
        {
          ns: 'https://portfolio.Startups.Studio',
          type: 'Startup',
          isRoot: true,
          isCollection: true,
          parent: 'https://Startups.Studio',
        }
      )

      // Collection with parent should use parent
      expect(result.$context).toBe('https://Startups.Studio')
    })
  })

  // ============================================================================
  // Parent Relationship Storage Tests
  // ============================================================================

  describe('parent relationship stored and retrievable', () => {
    it('preserves parent in response metadata', () => {
      const result = buildResponse(
        { name: 'Child Entity' },
        {
          ns: 'https://child.parent.org.ai',
          type: 'Entity',
          isRoot: true,
          parent: 'https://parent.org.ai',
        }
      )

      // The $context should always equal parent when parent is provided
      expect(result.$context).toBe('https://parent.org.ai')

      // Verify the context chain is navigable
      // $context should be a valid URL that can be fetched
      expect(result.$context).toMatch(/^https?:\/\//)
    })

    it('maintains bidirectional relationship through context chain', () => {
      // Parent response
      const parentResult = buildResponse(
        { name: 'Parent DO', children: ['https://child.parent.org.ai'] },
        {
          ns: 'https://parent.org.ai',
          type: 'DO',
          isRoot: true,
          parent: 'https://schema.org.ai/DO',
        }
      )

      // Child response
      const childResult = buildResponse(
        { name: 'Child DO' },
        {
          ns: 'https://child.parent.org.ai',
          type: 'DO',
          isRoot: true,
          parent: 'https://parent.org.ai',
        }
      )

      // Child's context points to parent's ID
      expect(childResult.$context).toBe(parentResult.$id)
    })
  })

  // ============================================================================
  // Context Chain Verification Tests
  // ============================================================================

  describe('context chain integrity', () => {
    it('orphan chain terminates at schema.org.ai', () => {
      const result = buildResponse(
        { name: 'Orphan' },
        {
          ns: 'https://orphan.org.ai',
          type: 'Entity',
          isRoot: true,
          // no parent
        }
      )

      // Orphan should point to schema.org.ai
      expect(result.$context).toMatch(/^https:\/\/schema\.org\.ai\//)
    })

    it('parented chain terminates at parent', () => {
      const result = buildResponse(
        { name: 'Parented' },
        {
          ns: 'https://child.org.ai',
          type: 'Entity',
          isRoot: true,
          parent: 'https://parent.org.ai',
        }
      )

      // Parented entity should point to parent
      expect(result.$context).not.toMatch(/^https:\/\/schema\.org\.ai\//)
      expect(result.$context).toBe('https://parent.org.ai')
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases for parent context', () => {
    it('handles empty string parent as orphan', () => {
      const result = buildResponse(
        { name: 'Empty Parent' },
        {
          ns: 'https://test.org.ai',
          type: 'DO',
          isRoot: true,
          parent: '', // empty string should be treated as no parent
        }
      )

      // Empty parent should be treated as orphan
      expect(result.$context).toBe('https://schema.org.ai/DO')
    })

    it('handles undefined parent as orphan', () => {
      const result = buildResponse(
        { name: 'Undefined Parent' },
        {
          ns: 'https://test.org.ai',
          type: 'DO',
          isRoot: true,
          parent: undefined,
        }
      )

      expect(result.$context).toBe('https://schema.org.ai/DO')
    })

    it('handles whitespace-only parent as orphan', () => {
      const result = buildResponse(
        { name: 'Whitespace Parent' },
        {
          ns: 'https://test.org.ai',
          type: 'DO',
          isRoot: true,
          parent: '   ', // whitespace should be treated as no parent
        }
      )

      expect(result.$context).toBe('https://schema.org.ai/DO')
    })

    it('non-root responses ignore orphan fallback', () => {
      // Non-root responses should NOT use schema.org.ai fallback
      // They always use the namespace as context
      const result = buildResponse(
        { name: 'Item' },
        {
          ns: 'https://test.org.ai',
          type: 'Customer',
          id: 'alice',
          // Not isRoot, no parent
        }
      )

      // Non-root should use ns as context, not schema.org.ai
      expect(result.$context).toBe('https://test.org.ai')
      expect(result.$context).not.toMatch(/schema\.org\.ai/)
    })
  })

  // ============================================================================
  // Type-Specific Schema Defaults
  // ============================================================================

  describe('type-specific schema defaults', () => {
    it('uses correct schema URL for Workflow type', () => {
      const result = buildResponse(
        { name: 'My Workflow', steps: [] },
        {
          ns: 'https://workflow.example.org.ai',
          type: 'Workflow',
          isRoot: true,
          // no parent
        }
      )

      expect(result.$context).toBe('https://schema.org.ai/Workflow')
    })

    it('uses correct schema URL for Human type', () => {
      const result = buildResponse(
        { name: 'Approver', role: 'manager' },
        {
          ns: 'https://approver.humans.do',
          type: 'Human',
          isRoot: true,
          // no parent
        }
      )

      expect(result.$context).toBe('https://schema.org.ai/Human')
    })

    it('uses correct schema URL for Entity type', () => {
      const result = buildResponse(
        { name: 'Generic Entity' },
        {
          ns: 'https://entity.example.org.ai',
          type: 'Entity',
          isRoot: true,
          // no parent
        }
      )

      expect(result.$context).toBe('https://schema.org.ai/Entity')
    })

    it('uses correct schema URL for Thing type', () => {
      const result = buildResponse(
        { name: 'Generic Thing' },
        {
          ns: 'https://thing.example.org.ai',
          type: 'Thing',
          isRoot: true,
          // no parent
        }
      )

      expect(result.$context).toBe('https://schema.org.ai/Thing')
    })
  })
})

// ============================================================================
// Parent-Child Relationships Tests
// ============================================================================

describe('parent-child relationships', () => {
  describe('nested resources with parent option', () => {
    it('builds collection with parent context for nested resources', () => {
      // Orders collection nested under a customer
      const result = buildCollectionResponse(
        [
          { id: 'ord-001', total: 99.99 },
          { id: 'ord-002', total: 149.99 },
        ],
        50,
        {
          ns: 'https://shop.example.com',
          type: 'Order',
          parent: 'https://shop.example.com/customers/alice',
        }
      )

      // $context should point to the parent (customer)
      expect(result.$context).toBe('https://shop.example.com/customers/alice')

      // $type should be the orders collection under the parent
      expect(result.$type).toBe('https://shop.example.com/customers/alice/orders')

      // $id same as $type for collections
      expect(result.$id).toBe('https://shop.example.com/customers/alice/orders')
    })

    it('items in nested collection have correct $id under parent path', () => {
      const result = buildCollectionResponse(
        [{ id: 'ord-001', total: 99.99 }],
        1,
        {
          ns: 'https://shop.example.com',
          type: 'Order',
          parent: 'https://shop.example.com/customers/alice',
        }
      )

      // Item $id should be under the parent path
      expect(result.items[0].$id).toBe('https://shop.example.com/customers/alice/orders/ord-001')
    })

    it('items inherit $context from their collection', () => {
      const result = buildCollectionResponse(
        [{ id: 'ord-001', total: 99.99 }],
        1,
        {
          ns: 'https://shop.example.com',
          type: 'Order',
          parent: 'https://shop.example.com/customers/alice',
        }
      )

      // Items should have the same $context as the collection
      expect(result.items[0].$context).toBe(result.$context)
    })

    it('items have $type matching the collection $type', () => {
      const result = buildCollectionResponse(
        [{ id: 'ord-001', total: 99.99 }],
        1,
        {
          ns: 'https://shop.example.com',
          type: 'Order',
          parent: 'https://shop.example.com/customers/alice',
        }
      )

      // Items should have the same $type as the collection
      expect(result.items[0].$type).toBe(result.$type)
    })
  })

  describe('multi-level nesting', () => {
    it('supports three-level nesting (org -> project -> task)', () => {
      // Tasks collection under a project under an organization
      const result = buildCollectionResponse(
        [{ id: 'task-001', title: 'Implement feature' }],
        10,
        {
          ns: 'https://pm.example.com',
          type: 'Task',
          parent: 'https://pm.example.com/orgs/acme/projects/alpha',
        }
      )

      expect(result.$context).toBe('https://pm.example.com/orgs/acme/projects/alpha')
      expect(result.$type).toBe('https://pm.example.com/orgs/acme/projects/alpha/tasks')
      expect(result.items[0].$id).toBe('https://pm.example.com/orgs/acme/projects/alpha/tasks/task-001')
    })

    it('supports four-level nesting (tenant -> workspace -> folder -> document)', () => {
      const result = buildCollectionResponse(
        [{ id: 'doc-001', name: 'README.md' }],
        5,
        {
          ns: 'https://docs.example.com',
          type: 'Document',
          parent: 'https://docs.example.com/tenants/acme/workspaces/main/folders/root',
        }
      )

      expect(result.$context).toBe('https://docs.example.com/tenants/acme/workspaces/main/folders/root')
      expect(result.items[0].$id).toBe(
        'https://docs.example.com/tenants/acme/workspaces/main/folders/root/documents/doc-001'
      )
    })
  })

  describe('bidirectional navigation', () => {
    it('child $context points to parent $id', () => {
      // First, build the parent customer response
      const customerResult = buildResponse(
        { name: 'Alice', email: 'alice@example.com' },
        {
          ns: 'https://shop.example.com',
          type: 'Customer',
          id: 'alice',
        }
      )

      // Then, build the nested orders collection using parent's $id
      const ordersResult = buildCollectionResponse(
        [{ id: 'ord-001', total: 99.99 }],
        1,
        {
          ns: 'https://shop.example.com',
          type: 'Order',
          parent: customerResult.$id,
        }
      )

      // Orders $context should match customer $id
      expect(ordersResult.$context).toBe(customerResult.$id)
    })

    it('maintains consistency across parent-child chain', () => {
      // Build DO root
      const doRoot = buildResponse(
        { name: 'Shop' },
        {
          ns: 'https://shop.example.com',
          type: 'DO',
          isRoot: true,
          parent: 'https://platform.do',
        }
      )

      // Build customers collection under DO
      const customersCollection = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        {
          ns: 'https://shop.example.com',
          type: 'Customer',
          parent: doRoot.$id,
        }
      )

      // Build orders collection under customer
      const ordersCollection = buildCollectionResponse(
        [{ id: 'ord-001', total: 99.99 }],
        50,
        {
          ns: 'https://shop.example.com',
          type: 'Order',
          parent: `${doRoot.$id}/customers/alice`,
        }
      )

      // Verify chain: orders -> customer -> DO -> platform
      expect(doRoot.$context).toBe('https://platform.do')
      expect(customersCollection.$context).toBe(doRoot.$id)
      expect(ordersCollection.$context).toBe('https://shop.example.com/customers/alice')
    })
  })
})

// ============================================================================
// Context Inheritance Tests
// ============================================================================

describe('context inheritance', () => {
  describe('collection items inherit context', () => {
    it('all items in collection share the same $context', () => {
      const result = buildCollectionResponse(
        [
          { id: 'alice', name: 'Alice' },
          { id: 'bob', name: 'Bob' },
          { id: 'charlie', name: 'Charlie' },
        ],
        3,
        {
          ns: 'https://shop.example.com',
          type: 'Customer',
        }
      )

      // All items should have the same $context as the collection
      const collectionContext = result.$context
      result.items.forEach((item) => {
        expect(item.$context).toBe(collectionContext)
      })
    })

    it('all items in nested collection share parent context', () => {
      const result = buildCollectionResponse(
        [
          { id: 'ord-001', total: 99.99 },
          { id: 'ord-002', total: 149.99 },
        ],
        2,
        {
          ns: 'https://shop.example.com',
          type: 'Order',
          parent: 'https://shop.example.com/customers/alice',
        }
      )

      // All items should inherit context from parent
      result.items.forEach((item) => {
        expect(item.$context).toBe('https://shop.example.com/customers/alice')
      })
    })
  })

  describe('type inheritance in nested contexts', () => {
    it('nested collection items have type scoped to parent', () => {
      const result = buildCollectionResponse(
        [{ id: 'ord-001', total: 99.99 }],
        1,
        {
          ns: 'https://shop.example.com',
          type: 'Order',
          parent: 'https://shop.example.com/customers/alice',
        }
      )

      // $type should be scoped to parent path
      expect(result.items[0].$type).toContain('/customers/alice/')
      expect(result.items[0].$type).toBe('https://shop.example.com/customers/alice/orders')
    })
  })

  describe('context propagation through hierarchy', () => {
    it('root-level collection uses namespace as context', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        {
          ns: 'https://shop.example.com',
          type: 'Customer',
        }
      )

      // Root-level collection $context is just the namespace
      expect(result.$context).toBe('https://shop.example.com')
    })

    it('nested collection uses parent as context', () => {
      const result = buildCollectionResponse(
        [{ id: 'ord-001', total: 99.99 }],
        50,
        {
          ns: 'https://shop.example.com',
          type: 'Order',
          parent: 'https://shop.example.com/customers/alice',
        }
      )

      // Nested collection $context is the parent
      expect(result.$context).toBe('https://shop.example.com/customers/alice')
    })
  })
})

// ============================================================================
// Nested Resource URL Tests
// ============================================================================

describe('nested resource URLs', () => {
  describe('URL construction for nested resources', () => {
    it('constructs correct URL for single-level nested resource', () => {
      // Customer alice's orders collection
      const parentUrl = buildIdUrl('https://shop.example.com', 'Customer', 'alice')
      const nestedTypeUrl = buildTypeUrl(parentUrl, 'Order')

      expect(parentUrl).toBe('https://shop.example.com/customers/alice')
      expect(nestedTypeUrl).toBe('https://shop.example.com/customers/alice/orders')
    })

    it('constructs correct URL for specific nested item', () => {
      // Customer alice's order ord-001
      const parentUrl = buildIdUrl('https://shop.example.com', 'Customer', 'alice')
      const nestedItemUrl = buildIdUrl(parentUrl, 'Order', 'ord-001')

      expect(nestedItemUrl).toBe('https://shop.example.com/customers/alice/orders/ord-001')
    })

    it('constructs correct URLs for deeply nested resources', () => {
      // org -> project -> milestone -> task
      const orgUrl = buildIdUrl('https://pm.example.com', 'Org', 'acme')
      const projectUrl = buildIdUrl(orgUrl, 'Project', 'alpha')
      const milestoneUrl = buildIdUrl(projectUrl, 'Milestone', 'v1.0')
      const taskUrl = buildIdUrl(milestoneUrl, 'Task', 'task-001')

      expect(orgUrl).toBe('https://pm.example.com/orgs/acme')
      expect(projectUrl).toBe('https://pm.example.com/orgs/acme/projects/alpha')
      expect(milestoneUrl).toBe('https://pm.example.com/orgs/acme/projects/alpha/milestones/v1.0')
      expect(taskUrl).toBe('https://pm.example.com/orgs/acme/projects/alpha/milestones/v1.0/tasks/task-001')
    })
  })

  describe('URL encoding in nested paths', () => {
    it('encodes special characters in nested path segments', () => {
      const parentUrl = buildIdUrl('https://shop.example.com', 'Customer', 'user@example.com')
      const nestedItemUrl = buildIdUrl(parentUrl, 'Order', 'ord-001')

      expect(parentUrl).toBe('https://shop.example.com/customers/user%40example.com')
      expect(nestedItemUrl).toBe('https://shop.example.com/customers/user%40example.com/orders/ord-001')
    })

    it('encodes spaces in nested path segments', () => {
      const parentUrl = buildIdUrl('https://docs.example.com', 'Folder', 'My Documents')
      const nestedItemUrl = buildIdUrl(parentUrl, 'File', 'report.pdf')

      expect(parentUrl).toBe('https://docs.example.com/folders/My%20Documents')
      expect(nestedItemUrl).toBe('https://docs.example.com/folders/My%20Documents/files/report.pdf')
    })
  })

  describe('collection response nested URLs', () => {
    it('builds correct self link for nested collection', () => {
      const result = buildCollectionResponse(
        [{ id: 'ord-001', total: 99.99 }],
        1,
        {
          ns: 'https://shop.example.com',
          type: 'Order',
          parent: 'https://shop.example.com/customers/alice',
        }
      )

      expect(result.links.self).toBe('https://shop.example.com/customers/alice/orders')
    })

    it('builds correct item self links in nested collection', () => {
      const result = buildCollectionResponse(
        [
          { id: 'ord-001', total: 99.99 },
          { id: 'ord-002', total: 149.99 },
        ],
        2,
        {
          ns: 'https://shop.example.com',
          type: 'Order',
          parent: 'https://shop.example.com/customers/alice',
        }
      )

      expect(result.items[0].links.self).toBe('https://shop.example.com/customers/alice/orders/ord-001')
      expect(result.items[1].links.self).toBe('https://shop.example.com/customers/alice/orders/ord-002')
    })
  })
})

// ============================================================================
// Breadcrumb Generation Tests
// ============================================================================

describe('breadcrumb generation', () => {
  /**
   * Breadcrumbs provide a navigable path from root to current resource.
   * They are derived from the $context chain and can be used for UI navigation.
   */

  describe('building breadcrumb trail from context', () => {
    it('single-level item has two breadcrumbs (root, collection)', () => {
      const result = buildResponse(
        { name: 'Alice' },
        {
          ns: 'https://shop.example.com',
          type: 'Customer',
          id: 'alice',
        }
      )

      // From the response, we can derive breadcrumbs:
      // 1. Root: $context (https://shop.example.com)
      // 2. Collection: $type (https://shop.example.com/customers)
      // 3. Current: $id (https://shop.example.com/customers/alice)
      const breadcrumbs = [result.$context, result.$type, result.$id]

      expect(breadcrumbs).toEqual([
        'https://shop.example.com',
        'https://shop.example.com/customers',
        'https://shop.example.com/customers/alice',
      ])
    })

    it('nested item has extended breadcrumb trail', () => {
      // Order item nested under customer
      const orderResult = buildResponse(
        { total: 99.99 },
        {
          ns: 'https://shop.example.com/customers/alice',
          type: 'Order',
          id: 'ord-001',
        }
      )

      // Breadcrumbs for nested item:
      // Parent context, Parent, Collection type, Item
      const breadcrumbs = [orderResult.$context, orderResult.$type, orderResult.$id]

      expect(breadcrumbs).toEqual([
        'https://shop.example.com/customers/alice',
        'https://shop.example.com/customers/alice/orders',
        'https://shop.example.com/customers/alice/orders/ord-001',
      ])
    })
  })

  describe('breadcrumb labels derivation', () => {
    it('derives collection name from $type URL', () => {
      const result = buildCollectionResponse(
        [{ id: 'alice', name: 'Alice' }],
        100,
        {
          ns: 'https://shop.example.com',
          type: 'Customer',
        }
      )

      // The collection name can be extracted from $type
      // https://shop.example.com/customers -> "customers"
      const typeUrl = result.$type
      const collectionName = typeUrl.split('/').pop()

      expect(collectionName).toBe('customers')
    })

    it('derives item identifier from $id URL', () => {
      const result = buildResponse(
        { name: 'Alice' },
        {
          ns: 'https://shop.example.com',
          type: 'Customer',
          id: 'alice',
        }
      )

      // The item ID can be extracted from $id
      // https://shop.example.com/customers/alice -> "alice"
      const itemId = result.$id.split('/').pop()

      expect(itemId).toBe('alice')
    })
  })

  describe('full breadcrumb chain traversal', () => {
    it('can reconstruct full path from nested resource', () => {
      // Build a deeply nested resource and verify we can reconstruct the path
      const ns = 'https://pm.example.com'

      // Level 1: Organization
      const org = buildResponse(
        { name: 'Acme' },
        { ns, type: 'Org', id: 'acme' }
      )

      // Level 2: Project under org (using org $id as namespace)
      const project = buildResponse(
        { name: 'Project Alpha' },
        { ns: org.$id, type: 'Project', id: 'alpha' }
      )

      // Level 3: Task under project
      const task = buildResponse(
        { title: 'Implement feature' },
        { ns: project.$id, type: 'Task', id: 'task-001' }
      )

      // Verify the chain is navigable
      // task.$context = project.$id
      expect(task.$context).toBe(project.$id)
      // project.$context = org.$id
      expect(project.$context).toBe(org.$id)
      // org.$context = root namespace
      expect(org.$context).toBe(ns)
    })
  })
})

// ============================================================================
// Access Control Propagation Tests
// ============================================================================

describe('access control propagation', () => {
  /**
   * Access control is derived from the parent context.
   * If a user has access to a parent resource, they may have access to child resources.
   * The $context chain enables access control validation by following the hierarchy.
   */

  describe('permission inheritance through context', () => {
    it('child resources are scoped to parent context', () => {
      // If a user has access to a customer, they can access that customer's orders
      // The parent URL in $context establishes the scope
      const result = buildCollectionResponse(
        [{ id: 'ord-001', total: 99.99 }],
        1,
        {
          ns: 'https://shop.example.com',
          type: 'Order',
          parent: 'https://shop.example.com/customers/alice',
        }
      )

      // The $context establishes the permission scope
      // To access orders, you must have access to https://shop.example.com/customers/alice
      expect(result.$context).toBe('https://shop.example.com/customers/alice')

      // All items are under the same permission scope
      result.items.forEach((item) => {
        expect(item.$context).toBe('https://shop.example.com/customers/alice')
      })
    })

    it('multi-tenant isolation through context hierarchy', () => {
      // Tenant A's resources
      const tenantAOrders = buildCollectionResponse(
        [{ id: 'ord-001', total: 99.99 }],
        1,
        {
          ns: 'https://shop.example.com',
          type: 'Order',
          parent: 'https://shop.example.com/tenants/tenant-a/customers/alice',
        }
      )

      // Tenant B's resources
      const tenantBOrders = buildCollectionResponse(
        [{ id: 'ord-002', total: 199.99 }],
        1,
        {
          ns: 'https://shop.example.com',
          type: 'Order',
          parent: 'https://shop.example.com/tenants/tenant-b/customers/bob',
        }
      )

      // Different tenants have different permission scopes
      expect(tenantAOrders.$context).toContain('/tenants/tenant-a/')
      expect(tenantBOrders.$context).toContain('/tenants/tenant-b/')

      // Contexts are completely isolated
      expect(tenantAOrders.$context).not.toBe(tenantBOrders.$context)
    })
  })

  describe('role-based access patterns', () => {
    it('organization-scoped resources have org in context path', () => {
      // Resources scoped to an organization
      const result = buildCollectionResponse(
        [{ id: 'proj-001', name: 'Alpha' }],
        10,
        {
          ns: 'https://pm.example.com',
          type: 'Project',
          parent: 'https://pm.example.com/orgs/acme',
        }
      )

      // Access to projects requires access to the org
      expect(result.$context).toBe('https://pm.example.com/orgs/acme')
      expect(result.$type).toBe('https://pm.example.com/orgs/acme/projects')
    })

    it('team-scoped resources have team in context path', () => {
      // Resources scoped to a team within an org
      const result = buildCollectionResponse(
        [{ id: 'task-001', title: 'Implement feature' }],
        5,
        {
          ns: 'https://pm.example.com',
          type: 'Task',
          parent: 'https://pm.example.com/orgs/acme/teams/engineering',
        }
      )

      // Access to tasks requires access to the team
      expect(result.$context).toBe('https://pm.example.com/orgs/acme/teams/engineering')
    })
  })

  describe('permission scope validation helpers', () => {
    it('context URL can be parsed to extract permission scope', () => {
      const result = buildCollectionResponse(
        [{ id: 'ord-001', total: 99.99 }],
        1,
        {
          ns: 'https://shop.example.com',
          type: 'Order',
          parent: 'https://shop.example.com/customers/alice',
        }
      )

      // Parse context to extract scope components
      const contextUrl = new URL(result.$context)
      const pathParts = contextUrl.pathname.split('/').filter(Boolean)

      // Expected: ['customers', 'alice']
      expect(pathParts).toContain('customers')
      expect(pathParts).toContain('alice')
    })

    it('item $id contains full permission chain', () => {
      const result = buildCollectionResponse(
        [{ id: 'ord-001', total: 99.99 }],
        1,
        {
          ns: 'https://shop.example.com',
          type: 'Order',
          parent: 'https://shop.example.com/tenants/acme/customers/alice',
        }
      )

      const itemId = result.items[0].$id

      // Item ID contains full hierarchy for permission validation
      expect(itemId).toContain('/tenants/acme/')
      expect(itemId).toContain('/customers/alice/')
      expect(itemId).toContain('/orders/')
    })
  })
})

// ============================================================================
// Real-World Integration Scenarios
// ============================================================================

describe('real-world integration scenarios', () => {
  describe('e-commerce nested resources', () => {
    it('builds complete customer order hierarchy', () => {
      const ns = 'https://shop.example.com'

      // Customer
      const customer = buildResponse(
        { name: 'Alice Johnson', email: 'alice@example.com' },
        { ns, type: 'Customer', id: 'cust-alice' }
      )

      // Customer's orders collection
      const orders = buildCollectionResponse(
        [
          { id: 'ord-001', total: 99.99, status: 'shipped' },
          { id: 'ord-002', total: 149.99, status: 'processing' },
        ],
        2,
        { ns, type: 'Order', parent: customer.$id }
      )

      // Verify structure
      expect(customer.$id).toBe('https://shop.example.com/customers/cust-alice')
      expect(orders.$context).toBe(customer.$id)
      expect(orders.$type).toBe('https://shop.example.com/customers/cust-alice/orders')
      expect(orders.items[0].$id).toBe('https://shop.example.com/customers/cust-alice/orders/ord-001')
    })

    it('builds order line items nested under order', () => {
      const ns = 'https://shop.example.com'
      const orderUrl = 'https://shop.example.com/customers/cust-alice/orders/ord-001'

      const lineItems = buildCollectionResponse(
        [
          { id: 'line-001', productId: 'prod-abc', quantity: 2 },
          { id: 'line-002', productId: 'prod-xyz', quantity: 1 },
        ],
        2,
        { ns, type: 'LineItem', parent: orderUrl }
      )

      expect(lineItems.$context).toBe(orderUrl)
      expect(lineItems.items[0].$id).toBe(`${orderUrl}/lineitems/line-001`)
    })
  })

  describe('project management nested resources', () => {
    it('builds complete project task hierarchy', () => {
      const ns = 'https://pm.example.com'

      // Organization
      const org = buildResponse(
        { name: 'Acme Corp' },
        { ns, type: 'Org', id: 'acme' }
      )

      // Project under org
      const project = buildResponse(
        { name: 'Project Alpha' },
        { ns: org.$id, type: 'Project', id: 'alpha' }
      )

      // Tasks collection under project
      const tasks = buildCollectionResponse(
        [
          { id: 'task-001', title: 'Design', status: 'done' },
          { id: 'task-002', title: 'Implement', status: 'in-progress' },
        ],
        2,
        { ns, type: 'Task', parent: project.$id }
      )

      // Verify hierarchy
      expect(org.$id).toBe('https://pm.example.com/orgs/acme')
      expect(project.$id).toBe('https://pm.example.com/orgs/acme/projects/alpha')
      expect(tasks.$context).toBe(project.$id)
      expect(tasks.items[0].$id).toBe('https://pm.example.com/orgs/acme/projects/alpha/tasks/task-001')
    })
  })

  describe('multi-tenant SaaS nested resources', () => {
    it('builds tenant-isolated resource hierarchy', () => {
      const ns = 'https://saas.example.com'

      // Build two separate tenant hierarchies
      const tenantA = buildCollectionResponse(
        [{ id: 'user-001', name: 'Alice' }],
        100,
        { ns, type: 'User', parent: `${ns}/tenants/tenant-a` }
      )

      const tenantB = buildCollectionResponse(
        [{ id: 'user-001', name: 'Bob' }],
        50,
        { ns, type: 'User', parent: `${ns}/tenants/tenant-b` }
      )

      // Same user ID in different tenants should have different URLs
      expect(tenantA.items[0].$id).not.toBe(tenantB.items[0].$id)

      // Each tenant has isolated context
      expect(tenantA.$context).toBe('https://saas.example.com/tenants/tenant-a')
      expect(tenantB.$context).toBe('https://saas.example.com/tenants/tenant-b')
    })
  })
})
