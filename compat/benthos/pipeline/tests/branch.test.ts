/**
 * RED Phase Tests: Branch Processor
 * Issue: dotdo-1bdb3
 *
 * These tests define the expected behavior for the Branch Processor.
 * They should FAIL until the implementation is complete.
 *
 * Branch processor provides:
 * - Conditional routing to different processing branches
 * - Parallel fan-out processing
 * - Request mapping (transform input before branch)
 * - Result mapping (merge branch results back)
 *
 * Benthos branch processor pattern:
 * https://www.benthos.dev/docs/components/processors/branch
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type {
  Processor,
  ProcessorConfig,
  ProcessorContext,
  ProcessorResult
} from '../processors'
import {
  createProcessor,
  MappingProcessor,
  FilterProcessor,
  BranchProcessor,
  createBranchProcessor
} from '../processors'
import type { BranchProcessorConfig, BranchConfig } from '../processors'
import {
  BenthosMessage,
  BenthosBatch,
  createMessage,
  createBatch,
  isMessage,
  isBatch
} from '../../core/message'

// ============================================================================
// Test Helpers
// ============================================================================

function createTestContext(): ProcessorContext {
  return {
    id: 'test-processor',
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {}
    },
    metrics: {
      increment: () => {},
      gauge: () => {},
      histogram: () => {}
    }
  }
}

// ============================================================================
// BRANCH PROCESSOR CONDITIONAL ROUTING TESTS
// ============================================================================

describe('BranchProcessor', () => {
  describe('Conditional routing', () => {
    it('routes to matching branch based on condition', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            request_map: 'root = this',
            condition: 'this.type == "order"',
            processors: [{ mapping: 'root.routed = "orders"' }]
          },
          {
            request_map: 'root = this',
            condition: 'this.type == "user"',
            processors: [{ mapping: 'root.routed = "users"' }]
          }
        ]
      })

      const result = await processor.process(
        createMessage({ type: 'order', id: 1 }),
        createTestContext()
      )

      expect(isMessage(result)).toBe(true)
      const json = (result as BenthosMessage).json() as Record<string, unknown>
      expect(json.routed).toBe('orders')
    })

    it('routes to second branch when first condition fails', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            condition: 'this.type == "order"',
            processors: [{ mapping: 'root.routed = "orders"' }]
          },
          {
            condition: 'this.type == "user"',
            processors: [{ mapping: 'root.routed = "users"' }]
          }
        ]
      })

      const result = await processor.process(
        createMessage({ type: 'user', id: 2 }),
        createTestContext()
      )

      expect(isMessage(result)).toBe(true)
      const json = (result as BenthosMessage).json() as Record<string, unknown>
      expect(json.routed).toBe('users')
    })

    it('processes through default branch when no condition matches', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            condition: 'this.type == "order"',
            processors: [{ mapping: 'root.routed = "orders"' }]
          },
          {
            // No condition = default branch
            processors: [{ mapping: 'root.routed = "default"' }]
          }
        ]
      })

      const result = await processor.process(
        createMessage({ type: 'unknown', id: 3 }),
        createTestContext()
      )

      expect(isMessage(result)).toBe(true)
      const json = (result as BenthosMessage).json() as Record<string, unknown>
      expect(json.routed).toBe('default')
    })

    it('returns original message when no branch matches and no default', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            condition: 'this.type == "order"',
            processors: [{ mapping: 'root.routed = "orders"' }]
          }
        ]
      })

      const result = await processor.process(
        createMessage({ type: 'unknown', id: 4 }),
        createTestContext()
      )

      expect(isMessage(result)).toBe(true)
      const json = (result as BenthosMessage).json() as Record<string, unknown>
      expect(json.type).toBe('unknown')
      expect(json.routed).toBeUndefined()
    })

    it('evaluates conditions with complex expressions', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            condition: 'this.priority > 5 && this.status == "active"',
            processors: [{ mapping: 'root.queue = "high"' }]
          },
          {
            condition: 'this.priority <= 5 && this.status == "active"',
            processors: [{ mapping: 'root.queue = "normal"' }]
          },
          {
            processors: [{ mapping: 'root.queue = "inactive"' }]
          }
        ]
      })

      const result = await processor.process(
        createMessage({ priority: 8, status: 'active' }),
        createTestContext()
      )

      expect(isMessage(result)).toBe(true)
      const json = (result as BenthosMessage).json() as Record<string, unknown>
      expect(json.queue).toBe('high')
    })
  })

  // ============================================================================
  // PARALLEL BRANCH PROCESSING TESTS
  // ============================================================================

  describe('Parallel branches (fan-out)', () => {
    it('supports parallel branches without conditions', async () => {
      const processor = createBranchProcessor({
        branches: [
          { request_map: 'root = this.a', result_map: 'root.a = this' },
          { request_map: 'root = this.b', result_map: 'root.b = this' }
        ]
      })

      const result = await processor.process(
        createMessage({ a: 1, b: 2 }),
        createTestContext()
      )

      expect(isMessage(result)).toBe(true)
      const json = (result as BenthosMessage).json() as Record<string, unknown>
      expect(json).toEqual({ a: 1, b: 2 })
    })

    it('executes all parallel branches and merges results', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            request_map: 'root = this.value',
            processors: [{ mapping: 'root = this * 2' }],
            result_map: 'root.doubled = this'
          },
          {
            request_map: 'root = this.value',
            processors: [{ mapping: 'root = this + 10' }],
            result_map: 'root.added = this'
          }
        ]
      })

      const result = await processor.process(
        createMessage({ value: 5 }),
        createTestContext()
      )

      expect(isMessage(result)).toBe(true)
      const json = (result as BenthosMessage).json() as Record<string, unknown>
      expect(json.doubled).toBe(10)
      expect(json.added).toBe(15)
    })

    it('handles parallel branches with independent transformations', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            request_map: 'root = this.user',
            processors: [{ mapping: 'root.name = this.name.upper()' }],
            result_map: 'root.formatted_user = this'
          },
          {
            request_map: 'root = this.items',
            processors: [{ mapping: 'root = this.map(x -> x * 2)' }],
            result_map: 'root.doubled_items = this'
          }
        ]
      })

      const result = await processor.process(
        createMessage({
          user: { name: 'alice' },
          items: [1, 2, 3]
        }),
        createTestContext()
      )

      expect(isMessage(result)).toBe(true)
      const json = (result as BenthosMessage).json() as Record<string, unknown>
      expect((json.formatted_user as any).name).toBe('ALICE')
      expect(json.doubled_items).toEqual([2, 4, 6])
    })

    it('preserves original fields not affected by branches', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            request_map: 'root = this.a',
            processors: [{ mapping: 'root = this * 2' }],
            result_map: 'root.a_doubled = this'
          }
        ]
      })

      const result = await processor.process(
        createMessage({ a: 5, b: 10, c: 15 }),
        createTestContext()
      )

      expect(isMessage(result)).toBe(true)
      const json = (result as BenthosMessage).json() as Record<string, unknown>
      expect(json.a).toBe(5)
      expect(json.b).toBe(10)
      expect(json.c).toBe(15)
      expect(json.a_doubled).toBe(10)
    })
  })

  // ============================================================================
  // REQUEST MAP TESTS
  // ============================================================================

  describe('Request mapping', () => {
    it('transforms input before branch processing', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            request_map: 'root = {extracted: this.nested.value}',
            processors: [{ mapping: 'root.doubled = this.extracted * 2' }],
            result_map: 'root.result = this'
          }
        ]
      })

      const result = await processor.process(
        createMessage({ nested: { value: 21 } }),
        createTestContext()
      )

      expect(isMessage(result)).toBe(true)
      const json = (result as BenthosMessage).json() as Record<string, unknown>
      expect((json.result as any).doubled).toBe(42)
    })

    it('handles complex request_map with multiple fields', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            request_map: 'root = {a: this.x, b: this.y, sum: this.x + this.y}',
            processors: [{ mapping: 'root.product = this.a * this.b' }],
            result_map: 'root.computed = this'
          }
        ]
      })

      const result = await processor.process(
        createMessage({ x: 3, y: 4 }),
        createTestContext()
      )

      expect(isMessage(result)).toBe(true)
      const json = (result as BenthosMessage).json() as Record<string, unknown>
      const computed = json.computed as Record<string, unknown>
      expect(computed.sum).toBe(7)
      expect(computed.product).toBe(12)
    })

    it('passes entire message when no request_map specified', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            processors: [{ mapping: 'root.processed = true' }],
            result_map: 'root = this'
          }
        ]
      })

      const result = await processor.process(
        createMessage({ original: 'data' }),
        createTestContext()
      )

      expect(isMessage(result)).toBe(true)
      const json = (result as BenthosMessage).json() as Record<string, unknown>
      expect(json.original).toBe('data')
      expect(json.processed).toBe(true)
    })
  })

  // ============================================================================
  // RESULT MAP TESTS
  // ============================================================================

  describe('Result mapping', () => {
    it('merges branch result back to original message', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            request_map: 'root = this.data',
            processors: [{ mapping: 'root = this.toUpperCase()' }],
            result_map: 'root.uppercase_data = this'
          }
        ]
      })

      const result = await processor.process(
        createMessage({ data: 'hello', other: 'unchanged' }),
        createTestContext()
      )

      expect(isMessage(result)).toBe(true)
      const json = (result as BenthosMessage).json() as Record<string, unknown>
      expect(json.data).toBe('hello')
      expect(json.other).toBe('unchanged')
      expect(json.uppercase_data).toBe('HELLO')
    })

    it('replaces entire root when result_map is root = this', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            request_map: 'root = this',
            processors: [{ mapping: 'root = {new: "content"}' }],
            result_map: 'root = this'
          }
        ]
      })

      const result = await processor.process(
        createMessage({ old: 'content' }),
        createTestContext()
      )

      expect(isMessage(result)).toBe(true)
      const json = (result as BenthosMessage).json() as Record<string, unknown>
      expect(json.new).toBe('content')
      expect(json.old).toBeUndefined()
    })

    it('handles nested result_map paths', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            request_map: 'root = this.value',
            processors: [{ mapping: 'root = this * 2' }],
            result_map: 'root.computed.doubled = this'
          }
        ]
      })

      const result = await processor.process(
        createMessage({ value: 10 }),
        createTestContext()
      )

      expect(isMessage(result)).toBe(true)
      const json = (result as BenthosMessage).json() as Record<string, unknown>
      expect((json.computed as any).doubled).toBe(20)
    })

    it('discards branch result when no result_map specified', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            request_map: 'root = this.data',
            processors: [{ mapping: 'root = this.toUpperCase()' }]
            // No result_map - result is discarded
          }
        ]
      })

      const result = await processor.process(
        createMessage({ data: 'hello' }),
        createTestContext()
      )

      expect(isMessage(result)).toBe(true)
      const json = (result as BenthosMessage).json() as Record<string, unknown>
      expect(json.data).toBe('hello')
      // No uppercase_data because result was discarded
    })
  })

  // ============================================================================
  // CHAINED PROCESSORS IN BRANCH TESTS
  // ============================================================================

  describe('Chained processors in branch', () => {
    it('executes multiple processors in sequence within a branch', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            request_map: 'root = this.value',
            processors: [
              { mapping: 'root = this * 2' },
              { mapping: 'root = this + 10' },
              { mapping: 'root = this / 2' }
            ],
            result_map: 'root.result = this'
          }
        ]
      })

      // (5 * 2 + 10) / 2 = 10
      const result = await processor.process(
        createMessage({ value: 5 }),
        createTestContext()
      )

      expect(isMessage(result)).toBe(true)
      const json = (result as BenthosMessage).json() as Record<string, unknown>
      expect(json.result).toBe(10)
    })

    it('supports filter processor in branch chain', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            condition: 'this.value > 0',
            processors: [
              { mapping: 'root = this' },
              { filter: '.value > 10' },
              { mapping: 'root.passed_filter = true' }
            ],
            result_map: 'root = this'
          },
          {
            processors: [{ mapping: 'root.passed_filter = false' }],
            result_map: 'root = this'
          }
        ]
      })

      // Value 15 should pass filter
      const result1 = await processor.process(
        createMessage({ value: 15 }),
        createTestContext()
      )

      expect(isMessage(result1)).toBe(true)
      expect((result1 as BenthosMessage).json()).toMatchObject({ passed_filter: true })

      // Value 5 should not pass filter, falls to default branch
      const result2 = await processor.process(
        createMessage({ value: 5 }),
        createTestContext()
      )

      expect(isMessage(result2)).toBe(true)
      // When filter drops message in branch, it should fall through
    })

    it('handles empty processors array', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            request_map: 'root = this.data',
            processors: [],
            result_map: 'root.extracted = this'
          }
        ]
      })

      const result = await processor.process(
        createMessage({ data: 'value' }),
        createTestContext()
      )

      expect(isMessage(result)).toBe(true)
      const json = (result as BenthosMessage).json() as Record<string, unknown>
      expect(json.extracted).toBe('value')
    })
  })

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('Error handling', () => {
    it('throws on invalid branch configuration', () => {
      expect(() => {
        createBranchProcessor({
          branches: []
        })
      }).toThrow()
    })

    it('handles processor error in branch gracefully', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            request_map: 'root = this.nonexistent.deep.path',
            processors: [{ mapping: 'root = this * 2' }],
            result_map: 'root.result = this'
          }
        ]
      })

      // Should not throw, but handle error gracefully
      const result = await processor.process(
        createMessage({ other: 'data' }),
        createTestContext()
      )

      expect(result).toBeDefined()
    })

    it('continues to next branch when current branch processor fails', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            condition: 'this.type == "a"',
            processors: [{ mapping: 'root = this.missing.field' }], // Will fail
            result_map: 'root.branch = "a"'
          },
          {
            processors: [{ mapping: 'root.branch = "fallback"' }],
            result_map: 'root = this'
          }
        ]
      })

      const result = await processor.process(
        createMessage({ type: 'a' }),
        createTestContext()
      )

      expect(isMessage(result)).toBe(true)
      // Should fall through to fallback branch on error
    })

    it('validates branch condition syntax at construction', () => {
      expect(() => {
        createBranchProcessor({
          branches: [
            {
              condition: 'this.value >',  // Invalid syntax
              processors: []
            }
          ]
        })
      }).toThrow()
    })

    it('validates request_map syntax at construction', () => {
      expect(() => {
        createBranchProcessor({
          branches: [
            {
              request_map: 'root = invalid(',  // Invalid syntax
              processors: []
            }
          ]
        })
      }).toThrow()
    })

    it('validates result_map syntax at construction', () => {
      expect(() => {
        createBranchProcessor({
          branches: [
            {
              processors: [],
              result_map: 'root.field = missing)'  // Invalid syntax
            }
          ]
        })
      }).toThrow()
    })
  })

  // ============================================================================
  // BATCH PROCESSING TESTS
  // ============================================================================

  describe('Batch processing', () => {
    it('processes batch of messages through branches', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            condition: 'this.type == "order"',
            processors: [{ mapping: 'root.processed = "order"' }],
            result_map: 'root = this'
          },
          {
            condition: 'this.type == "user"',
            processors: [{ mapping: 'root.processed = "user"' }],
            result_map: 'root = this'
          }
        ]
      })

      const batch = createBatch([
        { type: 'order', id: 1 },
        { type: 'user', id: 2 },
        { type: 'order', id: 3 }
      ])

      const result = processor.processBatch?.(batch, createTestContext())

      expect(result).toBeDefined()
      expect(isBatch(result)).toBe(true)
      if (isBatch(result)) {
        expect(result.length).toBe(3)
        const messages = result.toArray()
        expect((messages[0].json() as any).processed).toBe('order')
        expect((messages[1].json() as any).processed).toBe('user')
        expect((messages[2].json() as any).processed).toBe('order')
      }
    })

    it('handles mixed routing in batch', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            condition: 'this.priority > 5',
            processors: [{ mapping: 'root.queue = "high"' }],
            result_map: 'root = this'
          },
          {
            processors: [{ mapping: 'root.queue = "normal"' }],
            result_map: 'root = this'
          }
        ]
      })

      const batch = createBatch([
        { priority: 8 },
        { priority: 3 },
        { priority: 10 },
        { priority: 2 }
      ])

      const result = processor.processBatch?.(batch, createTestContext())

      expect(isBatch(result)).toBe(true)
      if (isBatch(result)) {
        const messages = result.toArray()
        expect((messages[0].json() as any).queue).toBe('high')
        expect((messages[1].json() as any).queue).toBe('normal')
        expect((messages[2].json() as any).queue).toBe('high')
        expect((messages[3].json() as any).queue).toBe('normal')
      }
    })
  })

  // ============================================================================
  // METADATA HANDLING TESTS
  // ============================================================================

  describe('Metadata handling', () => {
    it('preserves message metadata through branch processing', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            processors: [{ mapping: 'root.processed = true' }],
            result_map: 'root = this'
          }
        ]
      })

      const msg = createMessage({ data: 'test' }, { trace_id: '123', source: 'api' })
      const result = await processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const resultMsg = result as BenthosMessage
      expect(resultMsg.metadata.get('trace_id')).toBe('123')
      expect(resultMsg.metadata.get('source')).toBe('api')
    })

    it('allows metadata access in branch conditions', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            condition: 'meta("source") == "api"',
            processors: [{ mapping: 'root.from_api = true' }],
            result_map: 'root = this'
          },
          {
            processors: [{ mapping: 'root.from_api = false' }],
            result_map: 'root = this'
          }
        ]
      })

      const msg = createMessage({ data: 'test' }, { source: 'api' })
      const result = await processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const json = (result as BenthosMessage).json() as Record<string, unknown>
      expect(json.from_api).toBe(true)
    })

    it('supports metadata modification in branch processors', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            processors: [{ mapping: 'root = this; meta("processed_by") = "branch"' }],
            result_map: 'root = this'
          }
        ]
      })

      const msg = createMessage({ data: 'test' })
      const result = await processor.process(msg, createTestContext())

      expect(isMessage(result)).toBe(true)
      const resultMsg = result as BenthosMessage
      expect(resultMsg.metadata.get('processed_by')).toBe('branch')
    })
  })

  // ============================================================================
  // ADVANCED ROUTING TESTS
  // ============================================================================

  describe('Advanced routing patterns', () => {
    it('supports multiple conditions evaluated in order', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            condition: 'this.status == "urgent" && this.priority > 8',
            processors: [{ mapping: 'root.routing = "critical"' }],
            result_map: 'root = this'
          },
          {
            condition: 'this.status == "urgent"',
            processors: [{ mapping: 'root.routing = "urgent"' }],
            result_map: 'root = this'
          },
          {
            condition: 'this.priority > 5',
            processors: [{ mapping: 'root.routing = "high"' }],
            result_map: 'root = this'
          },
          {
            processors: [{ mapping: 'root.routing = "normal"' }],
            result_map: 'root = this'
          }
        ]
      })

      // Urgent + high priority = critical
      const result1 = await processor.process(
        createMessage({ status: 'urgent', priority: 9 }),
        createTestContext()
      )
      expect((result1 as BenthosMessage).json()).toMatchObject({ routing: 'critical' })

      // Urgent + low priority = urgent
      const result2 = await processor.process(
        createMessage({ status: 'urgent', priority: 3 }),
        createTestContext()
      )
      expect((result2 as BenthosMessage).json()).toMatchObject({ routing: 'urgent' })

      // Not urgent + high priority = high
      const result3 = await processor.process(
        createMessage({ status: 'normal', priority: 7 }),
        createTestContext()
      )
      expect((result3 as BenthosMessage).json()).toMatchObject({ routing: 'high' })

      // Neither = normal
      const result4 = await processor.process(
        createMessage({ status: 'normal', priority: 2 }),
        createTestContext()
      )
      expect((result4 as BenthosMessage).json()).toMatchObject({ routing: 'normal' })
    })

    it('supports array-based routing', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            condition: 'this.tags.contains("premium")',
            processors: [{ mapping: 'root.tier = "premium"' }],
            result_map: 'root = this'
          },
          {
            condition: 'this.tags.length() > 3',
            processors: [{ mapping: 'root.tier = "active"' }],
            result_map: 'root = this'
          },
          {
            processors: [{ mapping: 'root.tier = "basic"' }],
            result_map: 'root = this'
          }
        ]
      })

      const result = await processor.process(
        createMessage({ tags: ['premium', 'vip'] }),
        createTestContext()
      )

      expect((result as BenthosMessage).json()).toMatchObject({ tier: 'premium' })
    })

    it('supports nested object conditions', async () => {
      const processor = createBranchProcessor({
        branches: [
          {
            condition: 'this.user.subscription.plan == "enterprise"',
            processors: [{ mapping: 'root.access = "full"' }],
            result_map: 'root = this'
          },
          {
            condition: 'this.user.subscription.plan == "pro"',
            processors: [{ mapping: 'root.access = "enhanced"' }],
            result_map: 'root = this'
          },
          {
            processors: [{ mapping: 'root.access = "basic"' }],
            result_map: 'root = this'
          }
        ]
      })

      const result = await processor.process(
        createMessage({
          user: {
            name: 'Alice',
            subscription: { plan: 'enterprise', active: true }
          }
        }),
        createTestContext()
      )

      expect((result as BenthosMessage).json()).toMatchObject({ access: 'full' })
    })
  })

  // ============================================================================
  // FACTORY FUNCTION TESTS
  // ============================================================================

  describe('Factory functions', () => {
    it('createProcessor recognizes branch type', () => {
      const processor = createProcessor('branch', {
        branches: [
          {
            processors: [{ mapping: 'root.test = true' }],
            result_map: 'root = this'
          }
        ]
      })

      expect(processor.name).toBe('branch')
      expect(processor).toBeInstanceOf(BranchProcessor)
    })

    it('BranchProcessor class can be instantiated directly', () => {
      const processor = new BranchProcessor({
        branches: [
          {
            condition: 'true',
            processors: [],
            result_map: 'root = this'
          }
        ]
      })

      expect(processor.name).toBe('branch')
    })
  })
})
