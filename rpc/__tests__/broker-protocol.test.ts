/**
 * Broker Protocol Tests
 *
 * TDD tests for RPC Protocol Types and Message Format.
 * These tests define the expected behavior for the broker protocol messages
 * used in cross-DO and cross-worker communication.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  CallMessage,
  ReturnMessage,
  ErrorMessage,
  BatchMessage,
  BatchReturnMessage,
  BrokerMessage,
  isCallMessage,
  isReturnMessage,
  isErrorMessage,
  isBatchMessage,
  isBatchReturnMessage,
  generateBrokerMessageId,
} from '../broker-protocol'

describe('RPC Protocol', () => {
  describe('CallMessage', () => {
    it('should serialize CallMessage with all fields', () => {
      const msg: CallMessage = {
        id: 'call_123',
        type: 'call',
        target: 'worker-shard-1',
        method: 'getUser',
        args: [{ userId: 'u_456' }],
        capability: 'cap_opaque_token_xyz',
      }

      // Verify all fields are present and correctly typed
      expect(msg.id).toBe('call_123')
      expect(msg.type).toBe('call')
      expect(msg.target).toBe('worker-shard-1')
      expect(msg.method).toBe('getUser')
      expect(msg.args).toEqual([{ userId: 'u_456' }])
      expect(msg.capability).toBe('cap_opaque_token_xyz')

      // Verify JSON serialization preserves all fields
      const serialized = JSON.stringify(msg)
      const deserialized = JSON.parse(serialized) as CallMessage

      expect(deserialized).toEqual(msg)
    })

    it('should allow CallMessage without optional capability field', () => {
      const msg: CallMessage = {
        id: 'call_789',
        type: 'call',
        target: 'worker-shard-2',
        method: 'ping',
        args: [],
      }

      expect(msg.capability).toBeUndefined()
      expect(isCallMessage(msg)).toBe(true)
    })

    it('should support complex nested args', () => {
      const msg: CallMessage = {
        id: 'call_complex',
        type: 'call',
        target: 'compute-worker',
        method: 'processData',
        args: [
          { nested: { deep: { value: 42 } } },
          [1, 2, 3],
          null,
          'string',
          true,
        ],
      }

      const roundTripped = JSON.parse(JSON.stringify(msg)) as CallMessage
      expect(roundTripped.args).toEqual(msg.args)
    })
  })

  describe('ReturnMessage', () => {
    it('should serialize ReturnMessage with result', () => {
      const msg: ReturnMessage = {
        id: 'call_123',
        type: 'return',
        value: { user: { id: 'u_456', name: 'Alice' } },
      }

      expect(msg.id).toBe('call_123')
      expect(msg.type).toBe('return')
      expect(msg.value).toEqual({ user: { id: 'u_456', name: 'Alice' } })

      const serialized = JSON.stringify(msg)
      const deserialized = JSON.parse(serialized) as ReturnMessage

      expect(deserialized).toEqual(msg)
    })

    it('should support primitive return values', () => {
      const numberReturn: ReturnMessage = {
        id: 'call_1',
        type: 'return',
        value: 42,
      }
      expect(numberReturn.value).toBe(42)

      const stringReturn: ReturnMessage = {
        id: 'call_2',
        type: 'return',
        value: 'success',
      }
      expect(stringReturn.value).toBe('success')

      const boolReturn: ReturnMessage = {
        id: 'call_3',
        type: 'return',
        value: true,
      }
      expect(boolReturn.value).toBe(true)

      const nullReturn: ReturnMessage = {
        id: 'call_4',
        type: 'return',
        value: null,
      }
      expect(nullReturn.value).toBeNull()

      const undefinedReturn: ReturnMessage = {
        id: 'call_5',
        type: 'return',
        value: undefined,
      }
      expect(undefinedReturn.value).toBeUndefined()
    })
  })

  describe('ErrorMessage', () => {
    it('should serialize ErrorMessage with code and message', () => {
      const msg: ErrorMessage = {
        id: 'call_123',
        type: 'error',
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      }

      expect(msg.id).toBe('call_123')
      expect(msg.type).toBe('error')
      expect(msg.error).toBe('User not found')
      expect(msg.code).toBe('USER_NOT_FOUND')

      const serialized = JSON.stringify(msg)
      const deserialized = JSON.parse(serialized) as ErrorMessage

      expect(deserialized).toEqual(msg)
    })

    it('should allow ErrorMessage without optional code', () => {
      const msg: ErrorMessage = {
        id: 'call_456',
        type: 'error',
        error: 'Internal server error',
      }

      expect(msg.code).toBeUndefined()
      expect(isErrorMessage(msg)).toBe(true)
    })
  })

  describe('BatchMessage', () => {
    it('should serialize BatchMessage with multiple calls', () => {
      const msg: BatchMessage = {
        id: 'batch_001',
        type: 'batch',
        calls: [
          {
            id: 'call_1',
            type: 'call',
            target: 'shard-1',
            method: 'getUser',
            args: ['u_1'],
          },
          {
            id: 'call_2',
            type: 'call',
            target: 'shard-1',
            method: 'getUser',
            args: ['u_2'],
            capability: 'cap_token',
          },
          {
            id: 'call_3',
            type: 'call',
            target: 'shard-2',
            method: 'processPayment',
            args: [{ amount: 100, currency: 'USD' }],
          },
        ],
      }

      expect(msg.id).toBe('batch_001')
      expect(msg.type).toBe('batch')
      expect(msg.calls).toHaveLength(3)
      expect(msg.calls[0].method).toBe('getUser')
      expect(msg.calls[1].capability).toBe('cap_token')
      expect(msg.calls[2].target).toBe('shard-2')

      const serialized = JSON.stringify(msg)
      const deserialized = JSON.parse(serialized) as BatchMessage

      expect(deserialized).toEqual(msg)
    })

    it('should allow empty calls array', () => {
      const msg: BatchMessage = {
        id: 'batch_empty',
        type: 'batch',
        calls: [],
      }

      expect(msg.calls).toHaveLength(0)
      expect(isBatchMessage(msg)).toBe(true)
    })
  })

  describe('BatchReturnMessage', () => {
    it('should serialize BatchReturnMessage with mixed results', () => {
      const msg: BatchReturnMessage = {
        id: 'batch_001',
        type: 'batch_return',
        results: [
          { id: 'call_1', type: 'return', value: { id: 'u_1', name: 'Alice' } },
          { id: 'call_2', type: 'error', error: 'User not found', code: 'NOT_FOUND' },
          { id: 'call_3', type: 'return', value: { success: true, txId: 'tx_123' } },
        ],
      }

      expect(msg.id).toBe('batch_001')
      expect(msg.type).toBe('batch_return')
      expect(msg.results).toHaveLength(3)

      // First result is a return
      expect(msg.results[0].type).toBe('return')
      expect((msg.results[0] as ReturnMessage).value).toEqual({ id: 'u_1', name: 'Alice' })

      // Second result is an error
      expect(msg.results[1].type).toBe('error')
      expect((msg.results[1] as ErrorMessage).error).toBe('User not found')

      // Third result is a return
      expect(msg.results[2].type).toBe('return')

      const serialized = JSON.stringify(msg)
      const deserialized = JSON.parse(serialized) as BatchReturnMessage

      expect(deserialized).toEqual(msg)
    })
  })

  describe('Type Guards', () => {
    it('should correctly identify CallMessage', () => {
      const call: CallMessage = {
        id: 'test',
        type: 'call',
        target: 'worker',
        method: 'test',
        args: [],
      }

      expect(isCallMessage(call)).toBe(true)
      expect(isReturnMessage(call)).toBe(false)
      expect(isErrorMessage(call)).toBe(false)
      expect(isBatchMessage(call)).toBe(false)
      expect(isBatchReturnMessage(call)).toBe(false)
    })

    it('should correctly identify ReturnMessage', () => {
      const ret: ReturnMessage = {
        id: 'test',
        type: 'return',
        value: 'result',
      }

      expect(isCallMessage(ret)).toBe(false)
      expect(isReturnMessage(ret)).toBe(true)
      expect(isErrorMessage(ret)).toBe(false)
      expect(isBatchMessage(ret)).toBe(false)
      expect(isBatchReturnMessage(ret)).toBe(false)
    })

    it('should correctly identify ErrorMessage', () => {
      const err: ErrorMessage = {
        id: 'test',
        type: 'error',
        error: 'Something went wrong',
      }

      expect(isCallMessage(err)).toBe(false)
      expect(isReturnMessage(err)).toBe(false)
      expect(isErrorMessage(err)).toBe(true)
      expect(isBatchMessage(err)).toBe(false)
      expect(isBatchReturnMessage(err)).toBe(false)
    })

    it('should correctly identify BatchMessage', () => {
      const batch: BatchMessage = {
        id: 'test',
        type: 'batch',
        calls: [],
      }

      expect(isCallMessage(batch)).toBe(false)
      expect(isReturnMessage(batch)).toBe(false)
      expect(isErrorMessage(batch)).toBe(false)
      expect(isBatchMessage(batch)).toBe(true)
      expect(isBatchReturnMessage(batch)).toBe(false)
    })

    it('should correctly identify BatchReturnMessage', () => {
      const batchRet: BatchReturnMessage = {
        id: 'test',
        type: 'batch_return',
        results: [],
      }

      expect(isCallMessage(batchRet)).toBe(false)
      expect(isReturnMessage(batchRet)).toBe(false)
      expect(isErrorMessage(batchRet)).toBe(false)
      expect(isBatchMessage(batchRet)).toBe(false)
      expect(isBatchReturnMessage(batchRet)).toBe(true)
    })

    it('should reject invalid objects', () => {
      const invalid = { foo: 'bar' }

      expect(isCallMessage(invalid)).toBe(false)
      expect(isReturnMessage(invalid)).toBe(false)
      expect(isErrorMessage(invalid)).toBe(false)
      expect(isBatchMessage(invalid)).toBe(false)
      expect(isBatchReturnMessage(invalid)).toBe(false)
    })

    it('should handle null and undefined', () => {
      expect(isCallMessage(null)).toBe(false)
      expect(isCallMessage(undefined)).toBe(false)
      expect(isReturnMessage(null)).toBe(false)
      expect(isReturnMessage(undefined)).toBe(false)
      expect(isErrorMessage(null)).toBe(false)
      expect(isErrorMessage(undefined)).toBe(false)
      expect(isBatchMessage(null)).toBe(false)
      expect(isBatchMessage(undefined)).toBe(false)
      expect(isBatchReturnMessage(null)).toBe(false)
      expect(isBatchReturnMessage(undefined)).toBe(false)
    })

    it('should handle primitive types', () => {
      expect(isCallMessage('string')).toBe(false)
      expect(isCallMessage(42)).toBe(false)
      expect(isCallMessage(true)).toBe(false)
      expect(isReturnMessage('string')).toBe(false)
      expect(isErrorMessage(42)).toBe(false)
      expect(isBatchMessage(true)).toBe(false)
    })
  })

  describe('generateBrokerMessageId', () => {
    it('should generate unique message IDs', () => {
      const ids = new Set<string>()
      const count = 1000

      for (let i = 0; i < count; i++) {
        ids.add(generateBrokerMessageId())
      }

      expect(ids.size).toBe(count)
    })

    it('should generate IDs with broker prefix', () => {
      const id = generateBrokerMessageId()
      expect(id.startsWith('brk_')).toBe(true)
    })

    it('should generate non-empty string IDs', () => {
      const id = generateBrokerMessageId()
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })

    it('should be suitable for message correlation', () => {
      // Create a call with generated ID
      const callId = generateBrokerMessageId()
      const call: CallMessage = {
        id: callId,
        type: 'call',
        target: 'worker',
        method: 'test',
        args: [],
      }

      // Create response with same ID
      const response: ReturnMessage = {
        id: callId,
        type: 'return',
        value: 'result',
      }

      // Verify correlation
      expect(call.id).toBe(response.id)
    })
  })

  describe('Correlation', () => {
    it('should correlate responses by ID', () => {
      const callId = 'corr_test_123'

      const call: CallMessage = {
        id: callId,
        type: 'call',
        target: 'worker',
        method: 'getData',
        args: [1, 2, 3],
      }

      const successResponse: ReturnMessage = {
        id: callId,
        type: 'return',
        value: { result: 6 },
      }

      const errorResponse: ErrorMessage = {
        id: callId,
        type: 'error',
        error: 'Failed',
        code: 'COMPUTE_ERROR',
      }

      expect(call.id).toBe(successResponse.id)
      expect(call.id).toBe(errorResponse.id)
    })

    it('should correlate batch responses by ID', () => {
      const batchId = 'batch_corr_456'

      const batch: BatchMessage = {
        id: batchId,
        type: 'batch',
        calls: [
          { id: 'call_a', type: 'call', target: 'w', method: 'm', args: [] },
          { id: 'call_b', type: 'call', target: 'w', method: 'm', args: [] },
        ],
      }

      const batchReturn: BatchReturnMessage = {
        id: batchId,
        type: 'batch_return',
        results: [
          { id: 'call_a', type: 'return', value: 1 },
          { id: 'call_b', type: 'return', value: 2 },
        ],
      }

      expect(batch.id).toBe(batchReturn.id)
      expect(batch.calls[0].id).toBe(batchReturn.results[0].id)
      expect(batch.calls[1].id).toBe(batchReturn.results[1].id)
    })
  })

  describe('Capability Handling', () => {
    it('should handle capability field opaquely', () => {
      // The capability field should be treated as an opaque token
      // that passes through without modification
      const opaqueToken = 'cap_v1_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxx.yyy'

      const msg: CallMessage = {
        id: 'call_with_cap',
        type: 'call',
        target: 'secure-worker',
        method: 'sensitiveOperation',
        args: ['data'],
        capability: opaqueToken,
      }

      // Serialize and deserialize
      const serialized = JSON.stringify(msg)
      const deserialized = JSON.parse(serialized) as CallMessage

      // Capability should be preserved exactly
      expect(deserialized.capability).toBe(opaqueToken)
    })

    it('should preserve capability across message transformations', () => {
      const capability = 'cap_xyz_abc123'

      const original: CallMessage = {
        id: generateBrokerMessageId(),
        type: 'call',
        target: 'worker',
        method: 'action',
        args: [],
        capability,
      }

      // Simulate what might happen in a broker: re-package the message
      const repackaged: CallMessage = {
        ...original,
        id: generateBrokerMessageId(), // New ID for routing
      }

      expect(repackaged.capability).toBe(capability)
    })
  })

  describe('BrokerMessage Union Type', () => {
    it('should accept any valid message type', () => {
      const messages: BrokerMessage[] = [
        { id: '1', type: 'call', target: 'w', method: 'm', args: [] },
        { id: '2', type: 'return', value: 'x' },
        { id: '3', type: 'error', error: 'e' },
        { id: '4', type: 'batch', calls: [] },
        { id: '5', type: 'batch_return', results: [] },
      ]

      expect(messages).toHaveLength(5)

      // Type narrowing should work
      for (const msg of messages) {
        if (isCallMessage(msg)) {
          expect(msg.target).toBeDefined()
        } else if (isReturnMessage(msg)) {
          expect('value' in msg).toBe(true)
        } else if (isErrorMessage(msg)) {
          expect(msg.error).toBeDefined()
        } else if (isBatchMessage(msg)) {
          expect(Array.isArray(msg.calls)).toBe(true)
        } else if (isBatchReturnMessage(msg)) {
          expect(Array.isArray(msg.results)).toBe(true)
        }
      }
    })
  })
})
