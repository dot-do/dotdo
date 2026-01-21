/**
 * Global State Leakage Test (TDD)
 *
 * This test demonstrates a critical bug where the resourceRegistry is a global
 * module-level Map that persists across requests. When one tenant registers
 * a resource, other tenants can see it - violating tenant isolation.
 *
 * Bug location: api/resource.ts line 371
 *   const resourceRegistry: Map<string, ResourceDefinition<StorableData>> = new Map()
 *
 * The registry should be request-scoped or tenant-scoped, not global.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  defineResource,
  getResource,
  getAllResources,
  clearRegistry,
} from '../resource'

describe('Global State Leakage Bug', () => {
  beforeEach(() => {
    // Clear the registry before each test to ensure clean state
    clearRegistry()
  })

  it('should NOT leak resources between tenants (FAILS due to global registry bug)', () => {
    // Simulate tenant A's request - they define a resource
    const tenantAResourceName = 'TenantACustomer'
    defineResource(tenantAResourceName)
      .fields({
        name: { type: 'string', required: true },
        secretData: { type: 'string', required: true },
      })
      .build()

    // Verify tenant A can see their own resource
    expect(getResource(tenantAResourceName)).toBeDefined()
    expect(getAllResources()[tenantAResourceName]).toBeDefined()

    // Now simulate tenant B's request - they should NOT see tenant A's resource
    // This is a separate "request context" - in a real multi-tenant system,
    // tenant B should have no visibility into tenant A's resources

    // BUG: This assertion SHOULD pass (tenant B should NOT see tenant A's resource)
    // but it FAILS because the registry is global
    const tenantBView = getAllResources()
    const tenantBCanSeeResourceA = getResource(tenantAResourceName)

    // The bug: Tenant B CAN see Tenant A's resource due to global state
    // When fixed, these assertions should pass:
    expect(tenantBCanSeeResourceA).toBeUndefined() // BUG: Currently defined!
    expect(tenantBView[tenantAResourceName]).toBeUndefined() // BUG: Currently defined!
  })

  it('should isolate resource definitions per request context', () => {
    // Request 1: Define a Customer resource for tenant "acme"
    const acmeCustomer = defineResource('AcmeCustomer')
      .fields({
        companyName: { type: 'string', required: true },
      })
      .build()

    // Request 2: Define a Customer resource for tenant "bigcorp"
    const bigcorpCustomer = defineResource('BigcorpCustomer')
      .fields({
        corporateId: { type: 'string', required: true },
      })
      .build()

    // Both tenants registered resources - the global registry now has BOTH
    const allResources = getAllResources()
    const resourceCount = Object.keys(allResources).length

    // BUG: The registry has 2 resources because it's global
    // In a properly isolated system, each tenant should only see 1 resource
    // (their own) from their request context

    // This test documents the bug: we have 2 resources when there should be isolation
    expect(resourceCount).toBe(2) // This PASSES - demonstrating the bug exists

    // What SHOULD happen (but doesn't due to the bug):
    // Each request context should have its own registry
    // Tenant "acme" should only see AcmeCustomer
    // Tenant "bigcorp" should only see BigcorpCustomer
  })

  it('should not persist resources across requests (simulated)', () => {
    // Simulate Request 1
    function simulateRequest1() {
      defineResource('Request1Resource')
        .fields({ data: { type: 'string' } })
        .build()

      return getAllResources()
    }

    // Simulate Request 2 (separate context)
    function simulateRequest2() {
      // In a properly isolated system, this should start with an empty registry
      return getAllResources()
    }

    // Execute "Request 1"
    const request1Resources = simulateRequest1()
    expect(request1Resources['Request1Resource']).toBeDefined()

    // Execute "Request 2" - should NOT see Request 1's resource
    const request2Resources = simulateRequest2()

    // BUG: Request 2 CAN see Request 1's resource due to global state leakage
    expect(request2Resources['Request1Resource']).toBeUndefined() // FAILS!
  })

  describe('Cross-tenant data exposure scenarios', () => {
    it('should not expose sensitive resource configurations across tenants', () => {
      // Tenant A defines a resource with hooks containing sensitive logic
      const tenantAResource = defineResource('TenantASecretResource')
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

      // Tenant B should NOT be able to see tenant A's resource definition
      // including its hooks, fields, or computed values
      const exposedResource = getResource('TenantASecretResource')

      // BUG: Tenant B can see the entire resource definition including hooks!
      expect(exposedResource).toBeUndefined() // FAILS - resource is exposed
    })

    it('should not allow resource name collisions across tenants', () => {
      // Tenant A defines a "Customer" resource
      defineResource('Customer')
        .fields({
          tenantAField: { type: 'string', required: true },
        })
        .build()

      // Tenant B tries to define their own "Customer" resource
      // In a global registry, this OVERWRITES tenant A's definition!
      defineResource('Customer')
        .fields({
          tenantBField: { type: 'string', required: true },
        })
        .build()

      // Get the "Customer" resource
      const customerResource = getResource('Customer')

      // BUG: Tenant B's definition has OVERWRITTEN tenant A's!
      // This is a critical data integrity issue.
      expect(customerResource?.fields).toHaveProperty('tenantAField') // FAILS!

      // The resource now has tenantBField instead, proving the overwrite
      expect(customerResource?.fields).toHaveProperty('tenantBField') // Passes (bad!)
    })
  })
})
