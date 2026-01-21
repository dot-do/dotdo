/**
 * Tenant State Isolation Tests
 *
 * These tests verify that the request-scoped resource context properly isolates
 * tenant state, preventing resource definitions from leaking between requests.
 *
 * The fix uses runWithResourceContext() to create isolated contexts per request.
 * When running inside a context, getResource() and getAllResources() only return
 * resources from that context, not the global registry.
 *
 * See do-miqf for the original bug report.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  defineResource,
  getResource,
  getAllResources,
  clearRegistry,
  clearGlobalRegistry,
  runWithResourceContext,
  getCurrentResourceContext,
} from '../resource'

describe('Tenant State Isolation', () => {
  beforeEach(() => {
    // Clear both global and any lingering context state
    clearGlobalRegistry()
  })

  afterEach(() => {
    clearGlobalRegistry()
  })

  it('should isolate resources between tenant contexts', async () => {
    // Tenant A's request context
    await runWithResourceContext(async () => {
      defineResource('TenantACustomer')
        .fields({
          name: { type: 'string', required: true },
          secretData: { type: 'string', required: true },
        })
        .build()

      // Tenant A can see their own resource
      expect(getResource('TenantACustomer')).toBeDefined()
      expect(getAllResources()['TenantACustomer']).toBeDefined()
    })

    // Tenant B's request context (completely separate)
    await runWithResourceContext(async () => {
      // Tenant B should NOT see Tenant A's resource (proper isolation)
      const tenantBView = getAllResources()
      const tenantBCanSeeResourceA = getResource('TenantACustomer')

      expect(tenantBCanSeeResourceA).toBeUndefined()
      expect(tenantBView['TenantACustomer']).toBeUndefined()
    })
  })

  it('should isolate resource definitions per request context', async () => {
    // Tenant "acme" request context
    await runWithResourceContext(async () => {
      defineResource('AcmeCustomer')
        .fields({
          companyName: { type: 'string', required: true },
        })
        .build()

      // Acme only sees their own resource
      const acmeResources = getAllResources()
      expect(Object.keys(acmeResources)).toHaveLength(1)
      expect(acmeResources['AcmeCustomer']).toBeDefined()
    })

    // Tenant "bigcorp" request context
    await runWithResourceContext(async () => {
      defineResource('BigcorpCustomer')
        .fields({
          corporateId: { type: 'string', required: true },
        })
        .build()

      // Bigcorp only sees their own resource
      const bigcorpResources = getAllResources()
      expect(Object.keys(bigcorpResources)).toHaveLength(1)
      expect(bigcorpResources['BigcorpCustomer']).toBeDefined()
      expect(bigcorpResources['AcmeCustomer']).toBeUndefined()
    })
  })

  it('should not persist resources across requests', async () => {
    // Request 1
    await runWithResourceContext(async () => {
      defineResource('Request1Resource')
        .fields({ data: { type: 'string' } })
        .build()

      const resources = getAllResources()
      expect(resources['Request1Resource']).toBeDefined()
    })

    // Request 2 - should NOT see Request 1's resource
    await runWithResourceContext(async () => {
      const resources = getAllResources()
      expect(resources['Request1Resource']).toBeUndefined()
    })
  })

  describe('Cross-tenant data exposure prevention', () => {
    it('should not expose sensitive resource configurations across tenants', async () => {
      // Tenant A defines a resource with hooks containing sensitive logic
      await runWithResourceContext(async () => {
        defineResource('TenantASecretResource')
          .fields({
            apiKey: { type: 'string', required: true },
          })
          .hooks({
            beforeCreate: async (data) => {
              // Sensitive business logic that should not be visible to other tenants
              return { ...data, internalField: 'secret-value' }
            },
          })
          .build()

        // Tenant A can see their own resource
        expect(getResource('TenantASecretResource')).toBeDefined()
      })

      // Tenant B's context - should NOT see Tenant A's resource
      await runWithResourceContext(async () => {
        const exposedResource = getResource('TenantASecretResource')
        expect(exposedResource).toBeUndefined()
      })
    })

    it('should allow same resource names in different tenant contexts', async () => {
      let tenantAFieldsSnapshot: unknown
      let tenantBFieldsSnapshot: unknown

      // Tenant A defines "Customer"
      await runWithResourceContext(async () => {
        defineResource('Customer')
          .fields({
            tenantAField: { type: 'string', required: true },
          })
          .build()

        tenantAFieldsSnapshot = getResource('Customer')?.fields
        expect(tenantAFieldsSnapshot).toHaveProperty('tenantAField')
      })

      // Tenant B defines their own "Customer" - no collision!
      await runWithResourceContext(async () => {
        defineResource('Customer')
          .fields({
            tenantBField: { type: 'string', required: true },
          })
          .build()

        tenantBFieldsSnapshot = getResource('Customer')?.fields
        expect(tenantBFieldsSnapshot).toHaveProperty('tenantBField')
        expect(tenantBFieldsSnapshot).not.toHaveProperty('tenantAField')
      })

      // Both definitions remained intact in their respective contexts
      expect(tenantAFieldsSnapshot).toHaveProperty('tenantAField')
      expect(tenantBFieldsSnapshot).toHaveProperty('tenantBField')
    })
  })

  describe('Backward compatibility (deprecated global registry)', () => {
    it('should still work with global registry when not in context (deprecated)', () => {
      // This tests the backward compatibility path - using defineResource
      // outside of a context still works but uses the global registry
      defineResource('GlobalResource')
        .fields({ name: { type: 'string' } })
        .build()

      // Resource is in global registry
      expect(getResource('GlobalResource')).toBeDefined()

      // Cleanup
      clearGlobalRegistry()
    })

    it('should isolate context from global registry when inside context', async () => {
      // Define a global resource
      defineResource('GlobalResource')
        .fields({ name: { type: 'string' } })
        .build()

      // Inside a context, we should NOT see the global resource
      await runWithResourceContext(async () => {
        // Context is isolated - does NOT see global resources
        expect(getResource('GlobalResource')).toBeUndefined()
        expect(getAllResources()['GlobalResource']).toBeUndefined()

        // Define a context-local resource
        defineResource('ContextResource')
          .fields({ data: { type: 'string' } })
          .build()

        expect(getResource('ContextResource')).toBeDefined()
      })

      // Outside context, still see global resource
      expect(getResource('GlobalResource')).toBeDefined()
    })
  })
})
