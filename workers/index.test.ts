/**
 * Workers Module Exports Tests
 *
 * Integration tests verifying that all exports from the workers module
 * are properly exposed and functional. This ensures the public API
 * remains stable and all components are accessible.
 *
 * @module workers/index.test
 */

import { describe, it, expect } from 'vitest'

// Import everything from the workers module
import * as workers from './index'

// =============================================================================
// TYPE EXPORTS
// =============================================================================

describe('Workers Module Type Exports', () => {
  it('should export type definitions', () => {
    // Types are only available at compile time, but we can check
    // that the module exports exist without errors
    expect(workers).toBeDefined()
  })
})

// =============================================================================
// ROUTING EXPORTS
// =============================================================================

describe('Workers Module Routing Exports', () => {
  describe('Namespace Resolution', () => {
    it('should export hasSubdomain function', () => {
      expect(workers.hasSubdomain).toBeTypeOf('function')
    })

    it('should export resolveHostnameNamespace function', () => {
      expect(workers.resolveHostnameNamespace).toBeTypeOf('function')
    })

    it('should export resolvePathNamespace function', () => {
      expect(workers.resolvePathNamespace).toBeTypeOf('function')
    })

    it('should export extractPathParams function', () => {
      expect(workers.extractPathParams).toBeTypeOf('function')
    })

    it('should export resolveNamespace function', () => {
      expect(workers.resolveNamespace).toBeTypeOf('function')
    })

    it('should export resolveApiNamespace function', () => {
      expect(workers.resolveApiNamespace).toBeTypeOf('function')
    })
  })

  describe('DO Utilities', () => {
    it('should export findDOBinding function', () => {
      expect(workers.findDOBinding).toBeTypeOf('function')
    })

    it('should export getDOStub function', () => {
      expect(workers.getDOStub).toBeTypeOf('function')
    })
  })

  describe('Request Forwarding', () => {
    it('should export getForwardPath function', () => {
      expect(workers.getForwardPath).toBeTypeOf('function')
    })

    it('should export createForwardRequest function', () => {
      expect(workers.createForwardRequest).toBeTypeOf('function')
    })

    it('should export forwardToDO function', () => {
      expect(workers.forwardToDO).toBeTypeOf('function')
    })
  })

  describe('Error Responses', () => {
    it('should export errorResponse function', () => {
      expect(workers.errorResponse).toBeTypeOf('function')
    })

    it('should export notFoundResponse function', () => {
      expect(workers.notFoundResponse).toBeTypeOf('function')
    })

    it('should export serviceUnavailableResponse function', () => {
      expect(workers.serviceUnavailableResponse).toBeTypeOf('function')
    })
  })

  describe('Handler Factories', () => {
    it('should export createProxyHandler function', () => {
      expect(workers.createProxyHandler).toBeTypeOf('function')
    })

    it('should export createAPIHandler function', () => {
      expect(workers.createAPIHandler).toBeTypeOf('function')
    })
  })
})

// =============================================================================
// GRAPH EXPORTS
// =============================================================================

describe('Workers Module Graph Exports', () => {
  it('should export GraphLoadBalancer class', () => {
    expect(workers.GraphLoadBalancer).toBeTypeOf('function')
  })

  it('should export createGraphRoundRobinBalancer factory', () => {
    expect(workers.createGraphRoundRobinBalancer).toBeTypeOf('function')
  })

  it('should export createGraphLeastBusyBalancer factory', () => {
    expect(workers.createGraphLeastBusyBalancer).toBeTypeOf('function')
  })

  it('should export createGraphCapabilityBalancer factory', () => {
    expect(workers.createGraphCapabilityBalancer).toBeTypeOf('function')
  })
})

// =============================================================================
// PROXY HANDLER RE-EXPORTS
// =============================================================================

describe('Workers Module Proxy Handler Re-exports', () => {
  it('should export createHostnameProxyHandler for backward compatibility', () => {
    expect(workers.createHostnameProxyHandler).toBeTypeOf('function')
  })

  it('should export API factory', () => {
    expect(workers.API).toBeTypeOf('function')
  })

  it('should export APIDefault', () => {
    // APIDefault is the default export, could be a function or object
    expect(workers.APIDefault).toBeDefined()
  })

  it('should export stripEnvelope from simple module', () => {
    expect(workers.stripEnvelope).toBeTypeOf('function')
  })

  it('should export createSimpleHandler from simple module', () => {
    expect(workers.createSimpleHandler).toBeTypeOf('function')
  })

  it('should export SimpleDefault from simple module', () => {
    expect(workers.SimpleDefault).toBeDefined()
  })
})

// =============================================================================
// LOAD BALANCING RE-EXPORTS
// =============================================================================

describe('Workers Module Load Balancing Re-exports', () => {
  it('should export LoadBalancingGraph alias', () => {
    expect(workers.LoadBalancingGraph).toBeTypeOf('function')
  })

  it('should export createRoundRobinBalancer alias', () => {
    expect(workers.createRoundRobinBalancer).toBeTypeOf('function')
  })

  it('should export createLeastBusyBalancer alias', () => {
    expect(workers.createLeastBusyBalancer).toBeTypeOf('function')
  })

  it('should export createCapabilityBalancer alias', () => {
    expect(workers.createCapabilityBalancer).toBeTypeOf('function')
  })

  it('should have LoadBalancingGraph equal to GraphLoadBalancer', () => {
    expect(workers.LoadBalancingGraph).toBe(workers.GraphLoadBalancer)
  })

  it('should have createRoundRobinBalancer equal to createGraphRoundRobinBalancer', () => {
    expect(workers.createRoundRobinBalancer).toBe(workers.createGraphRoundRobinBalancer)
  })
})

// =============================================================================
// FUNCTIONAL TESTS
// =============================================================================

describe('Workers Module Functional Tests', () => {
  describe('hasSubdomain', () => {
    it('should detect subdomains', () => {
      expect(workers.hasSubdomain('api.example.com')).toBe(true)
      expect(workers.hasSubdomain('example.com')).toBe(false)
    })

    it('should handle www as subdomain', () => {
      expect(workers.hasSubdomain('www.example.com')).toBe(true)
    })
  })

  describe('resolvePathNamespace', () => {
    it('should extract namespace from path pattern', () => {
      const result = workers.resolvePathNamespace('/api/v1/users', '/:version')
      expect(result.namespace).toBe('v1')
    })

    it('should return null for non-matching paths', () => {
      const result = workers.resolvePathNamespace('/api/users', '/:org/:project')
      expect(result.namespace).toBeNull()
    })
  })

  describe('extractPathParams', () => {
    it('should extract multiple params', () => {
      const params = workers.extractPathParams('/acme/proj1/rest', '/:org/:project')
      expect(params.org).toBe('acme')
      expect(params.project).toBe('proj1')
    })

    it('should return empty object for no matches', () => {
      const params = workers.extractPathParams('/test', '/different')
      expect(Object.keys(params).length).toBe(0)
    })
  })

  describe('errorResponse', () => {
    it('should create error response with message', () => {
      const response = workers.errorResponse('Something went wrong', 500)
      expect(response.status).toBe(500)
    })

    it('should use default status 400', () => {
      const response = workers.errorResponse('Bad request')
      expect(response.status).toBe(400)
    })
  })

  describe('notFoundResponse', () => {
    it('should create 404 response', () => {
      const response = workers.notFoundResponse('Resource not found')
      expect(response.status).toBe(404)
    })
  })

  describe('serviceUnavailableResponse', () => {
    it('should create 503 response', () => {
      const response = workers.serviceUnavailableResponse('Service down')
      expect(response.status).toBe(503)
    })
  })

  describe('getForwardPath', () => {
    it('should compute forward path correctly', () => {
      const path = workers.getForwardPath('/api/users/123', '/:org', { org: 'api' })
      expect(path).toBe('/users/123')
    })
  })

  describe('createForwardRequest', () => {
    it('should create forwarded request', () => {
      const originalRequest = new Request('http://localhost/test')
      const forwardedRequest = workers.createForwardRequest(originalRequest, '/new-path')

      expect(forwardedRequest.url).toContain('/new-path')
    })
  })
})

// =============================================================================
// NAMESPACE RESOLUTION INTEGRATION
// =============================================================================

describe('Namespace Resolution Integration', () => {
  describe('resolveApiNamespace', () => {
    it('should resolve namespace for hostname mode', () => {
      const request = new Request('http://tenant.api.example.com/users')
      const result = workers.resolveApiNamespace(request, {})

      expect(result.namespace).toBe('tenant')
    })

    it('should resolve namespace for path mode', () => {
      const request = new Request('http://api.example.com/acme/users')
      const result = workers.resolveApiNamespace(request, { ns: '/:org' })

      expect(result.namespace).toBe('acme')
    })

    it('should resolve namespace for fixed mode', () => {
      const request = new Request('http://api.example.com/users')
      const result = workers.resolveApiNamespace(request, { ns: 'main' })

      expect(result.namespace).toBe('main')
    })
  })
})

// =============================================================================
// STRIP ENVELOPE
// =============================================================================

describe('stripEnvelope', () => {
  it('should strip data envelope', () => {
    const envelope = { data: { name: 'test' }, meta: {} }
    const result = workers.stripEnvelope(envelope)
    expect(result).toEqual({ name: 'test' })
  })

  it('should return original if no envelope', () => {
    const data = { name: 'test' }
    const result = workers.stripEnvelope(data)
    expect(result).toEqual({ name: 'test' })
  })
})
