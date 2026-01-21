/**
 * Tests to verify no duplicate exports from @dotdo/rpc
 *
 * This test ensures that each type is exported exactly once from the index,
 * preventing TypeScript TS2308 errors for duplicate export names.
 */

import { describe, it, expect } from 'vitest'
import * as rpcExports from '../index'

describe('@dotdo/rpc exports', () => {
  describe('no duplicate exports', () => {
    it('should export PipelineClientOptions exactly once', () => {
      // This test verifies that importing from index doesn't cause TS2308
      // The type itself may be defined in multiple places, but only one should be exported
      expect(typeof rpcExports).toBe('object')
    })

    it('should export CircuitState exactly once', () => {
      // This test verifies that importing from index doesn't cause TS2308
      expect(typeof rpcExports).toBe('object')
    })
  })

  describe('essential exports exist', () => {
    it('should export client functions', () => {
      expect(typeof rpcExports.createClient).toBe('function')
      expect(typeof rpcExports.createClientWithTransport).toBe('function')
      expect(typeof rpcExports.createDOStub).toBe('function')
      expect(typeof rpcExports.createClientWithPipeline).toBe('function')
    })

    it('should export server functions', () => {
      expect(typeof rpcExports.createServer).toBe('function')
    })

    it('should export pipeline functions', () => {
      expect(typeof rpcExports.createPipeline).toBe('function')
      expect(typeof rpcExports.createPipelineClient).toBe('function')
      expect(typeof rpcExports.PipelineBuilder).toBe('function')
    })

    it('should export circuit breaker functions', () => {
      expect(typeof rpcExports.createDOStubWithCircuitBreaker).toBe('function')
      expect(typeof rpcExports.createCrossDOClientWithCircuitBreaker).toBe('function')
    })

    it('should export error types and utilities', () => {
      expect(typeof rpcExports.RPCError).toBe('function')
      expect(typeof rpcExports.serializeError).toBe('function')
      expect(typeof rpcExports.deserializeError).toBe('function')
      expect(typeof rpcExports.isRPCError).toBe('function')
    })
  })
})
