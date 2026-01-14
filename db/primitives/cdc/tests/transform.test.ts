/**
 * Transform tests
 *
 * RED phase: These tests define the expected behavior of change transformations.
 * All tests should FAIL until implementation is complete.
 *
 * Transform provides change data transformation capabilities:
 * - Field mapping and projection
 * - Data type conversion
 * - Filtering
 * - Enrichment with external data
 * - Schema transformation
 * - Change aggregation
 */
import { describe, it, expect, vi } from 'vitest'
import {
  createTransformPipeline,
  map,
  filter,
  project,
  enrich,
  flatten,
  aggregate,
  debounce,
  type TransformPipeline,
  type Transformer,
  type ChangeEvent,
} from '../transform'
import { ChangeType } from '../stream'

// ============================================================================
// TEST HELPERS
// ============================================================================

interface SourceRecord {
  id: string
  firstName: string
  lastName: string
  email: string
  createdAt: number
  metadata?: Record<string, unknown>
}

interface TargetRecord {
  userId: string
  fullName: string
  emailAddress: string
}

function createChange<T>(data: Partial<ChangeEvent<T>> & { after: T }): ChangeEvent<T> {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2)}`,
    type: ChangeType.INSERT,
    before: null,
    timestamp: Date.now(),
    position: { sequence: 1, timestamp: Date.now() },
    isBackfill: false,
    ...data,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// MAP TRANSFORMER
// ============================================================================

describe('Transform', () => {
  describe('map', () => {
    it('should transform record fields', async () => {
      const transformer = map<SourceRecord, TargetRecord>((record) => ({
        userId: record.id,
        fullName: `${record.firstName} ${record.lastName}`,
        emailAddress: record.email,
      }))

      const input = createChange<SourceRecord>({
        after: {
          id: '1',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          createdAt: Date.now(),
        },
      })

      const output = await transformer.transform(input)

      expect(output).not.toBeNull()
      expect(output!.after!.userId).toBe('1')
      expect(output!.after!.fullName).toBe('John Doe')
      expect(output!.after!.emailAddress).toBe('john@example.com')
    })

    it('should transform both before and after for updates', async () => {
      const transformer = map<SourceRecord, TargetRecord>((record) => ({
        userId: record.id,
        fullName: `${record.firstName} ${record.lastName}`,
        emailAddress: record.email,
      }))

      const input: ChangeEvent<SourceRecord> = {
        eventId: 'evt-1',
        type: ChangeType.UPDATE,
        before: { id: '1', firstName: 'John', lastName: 'Doe', email: 'old@example.com', createdAt: 1000 },
        after: { id: '1', firstName: 'John', lastName: 'Smith', email: 'new@example.com', createdAt: 2000 },
        timestamp: Date.now(),
        position: { sequence: 1, timestamp: Date.now() },
        isBackfill: false,
      }

      const output = await transformer.transform(input)

      expect(output!.before!.fullName).toBe('John Doe')
      expect(output!.after!.fullName).toBe('John Smith')
    })

    it('should handle async transformation', async () => {
      const transformer = map<SourceRecord, TargetRecord>(async (record) => {
        await delay(10)
        return {
          userId: record.id,
          fullName: `${record.firstName} ${record.lastName}`,
          emailAddress: record.email,
        }
      })

      const input = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })

      const output = await transformer.transform(input)
      expect(output!.after!.fullName).toBe('John Doe')
    })
  })

  // ============================================================================
  // FILTER TRANSFORMER
  // ============================================================================

  describe('filter', () => {
    it('should pass through matching changes', async () => {
      const transformer = filter<SourceRecord>((event) => event.after!.email.includes('@example.com'))

      const input = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })

      const output = await transformer.transform(input)
      expect(output).not.toBeNull()
    })

    it('should filter out non-matching changes', async () => {
      const transformer = filter<SourceRecord>((event) => event.after!.email.includes('@example.com'))

      const input = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@other.com', createdAt: Date.now() },
      })

      const output = await transformer.transform(input)
      expect(output).toBeNull()
    })

    it('should filter by change type', async () => {
      const transformer = filter<SourceRecord>((event) => event.type === ChangeType.INSERT)

      const insertInput = createChange<SourceRecord>({
        type: ChangeType.INSERT,
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })

      const updateInput: ChangeEvent<SourceRecord> = {
        ...insertInput,
        type: ChangeType.UPDATE,
        before: insertInput.after,
      }

      expect(await transformer.transform(insertInput)).not.toBeNull()
      expect(await transformer.transform(updateInput)).toBeNull()
    })

    it('should filter deletes based on before state', async () => {
      const transformer = filter<SourceRecord>((event) => {
        const record = event.type === ChangeType.DELETE ? event.before : event.after
        return record!.email.includes('@example.com')
      })

      const deleteInput: ChangeEvent<SourceRecord> = {
        eventId: 'evt-1',
        type: ChangeType.DELETE,
        before: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
        after: null,
        timestamp: Date.now(),
        position: { sequence: 1, timestamp: Date.now() },
        isBackfill: false,
      }

      expect(await transformer.transform(deleteInput)).not.toBeNull()
    })
  })

  // ============================================================================
  // PROJECT TRANSFORMER
  // ============================================================================

  describe('project', () => {
    it('should select specific fields', async () => {
      const transformer = project<SourceRecord, Pick<SourceRecord, 'id' | 'email'>>(['id', 'email'])

      const input = createChange<SourceRecord>({
        after: {
          id: '1',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          createdAt: Date.now(),
          metadata: { extra: 'data' },
        },
      })

      const output = await transformer.transform(input)

      expect(output!.after).toEqual({ id: '1', email: 'john@example.com' })
      expect((output!.after as any).firstName).toBeUndefined()
    })

    it('should handle nested field selection', async () => {
      interface NestedRecord {
        id: string
        profile: {
          name: string
          settings: {
            theme: string
          }
        }
      }

      const transformer = project<NestedRecord, { id: string; theme: string }>({
        id: 'id',
        theme: 'profile.settings.theme',
      })

      const input = createChange<NestedRecord>({
        after: {
          id: '1',
          profile: {
            name: 'John',
            settings: { theme: 'dark' },
          },
        },
      })

      const output = await transformer.transform(input)
      expect(output!.after).toEqual({ id: '1', theme: 'dark' })
    })

    it('should exclude specified fields', async () => {
      const transformer = project<SourceRecord, Omit<SourceRecord, 'metadata'>>({
        exclude: ['metadata'],
      })

      const input = createChange<SourceRecord>({
        after: {
          id: '1',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          createdAt: Date.now(),
          metadata: { sensitive: 'data' },
        },
      })

      const output = await transformer.transform(input)
      expect((output!.after as any).metadata).toBeUndefined()
      expect(output!.after!.id).toBe('1')
    })
  })

  // ============================================================================
  // ENRICH TRANSFORMER
  // ============================================================================

  describe('enrich', () => {
    it('should add external data to changes', async () => {
      interface EnrichedRecord extends SourceRecord {
        department: string
      }

      const userDepartments = new Map([['1', 'Engineering'], ['2', 'Sales']])

      const transformer = enrich<SourceRecord, EnrichedRecord>(async (event) => ({
        department: userDepartments.get(event.after!.id) || 'Unknown',
      }))

      const input = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })

      const output = await transformer.transform(input)
      expect(output!.after!.department).toBe('Engineering')
    })

    it('should handle enrichment failures gracefully', async () => {
      const transformer = enrich<SourceRecord, SourceRecord & { extra?: string }>(
        async () => {
          throw new Error('Enrichment failed')
        },
        { onError: 'skip' }
      )

      const input = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })

      const output = await transformer.transform(input)
      expect(output).not.toBeNull()
      expect(output!.after!.extra).toBeUndefined()
    })

    it('should cache enrichment results', async () => {
      let lookupCount = 0

      const transformer = enrich<SourceRecord, SourceRecord & { cached: string }>(
        async (event) => {
          lookupCount++
          return { cached: `value-${event.after!.id}` }
        },
        { cacheKey: (event) => event.after!.id, cacheTtlMs: 5000 }
      )

      const input1 = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })
      const input2 = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Updated', email: 'john@example.com', createdAt: Date.now() },
      })

      await transformer.transform(input1)
      await transformer.transform(input2)

      expect(lookupCount).toBe(1) // Cached
    })
  })

  // ============================================================================
  // FLATTEN TRANSFORMER
  // ============================================================================

  describe('flatten', () => {
    it('should flatten nested objects', async () => {
      interface NestedRecord {
        id: string
        user: {
          name: string
          address: {
            city: string
          }
        }
      }

      interface FlatRecord {
        id: string
        user_name: string
        user_address_city: string
      }

      const transformer = flatten<NestedRecord, FlatRecord>({ delimiter: '_' })

      const input = createChange<NestedRecord>({
        after: {
          id: '1',
          user: {
            name: 'John',
            address: { city: 'NYC' },
          },
        },
      })

      const output = await transformer.transform(input)
      expect(output!.after).toEqual({
        id: '1',
        user_name: 'John',
        user_address_city: 'NYC',
      })
    })

    it('should handle arrays in flattening', async () => {
      interface ArrayRecord {
        id: string
        tags: string[]
      }

      const transformer = flatten<ArrayRecord, { id: string; tags_0: string; tags_1: string }>({
        delimiter: '_',
        flattenArrays: true,
      })

      const input = createChange<ArrayRecord>({
        after: { id: '1', tags: ['a', 'b'] },
      })

      const output = await transformer.transform(input)
      expect(output!.after!.tags_0).toBe('a')
      expect(output!.after!.tags_1).toBe('b')
    })
  })

  // ============================================================================
  // AGGREGATE TRANSFORMER
  // ============================================================================

  describe('aggregate', () => {
    it('should aggregate changes by key', async () => {
      const aggregated: Array<{ key: string; count: number }> = []

      const transformer = aggregate<SourceRecord, { key: string; count: number }>({
        keyBy: (event) => event.after!.email.split('@')[1]!,
        windowMs: 100,
        reducer: (acc, event) => ({
          key: event.after!.email.split('@')[1]!,
          count: (acc?.count || 0) + 1,
        }),
        onAggregate: async (result) => {
          aggregated.push(result)
        },
      })

      await transformer.transform(createChange({ after: { id: '1', firstName: 'A', lastName: 'A', email: 'a@foo.com', createdAt: 1 } }))
      await transformer.transform(createChange({ after: { id: '2', firstName: 'B', lastName: 'B', email: 'b@foo.com', createdAt: 2 } }))
      await transformer.transform(createChange({ after: { id: '3', firstName: 'C', lastName: 'C', email: 'c@bar.com', createdAt: 3 } }))

      await delay(150) // Wait for window

      expect(aggregated.some((a) => a.key === 'foo.com' && a.count === 2)).toBe(true)
      expect(aggregated.some((a) => a.key === 'bar.com' && a.count === 1)).toBe(true)
    })

    it('should emit aggregates on flush', async () => {
      const aggregated: Array<{ key: string; count: number }> = []

      const transformer = aggregate<SourceRecord, { key: string; count: number }>({
        keyBy: (event) => event.after!.id,
        windowMs: 10000, // Long window
        reducer: (acc, event) => ({
          key: event.after!.id,
          count: (acc?.count || 0) + 1,
        }),
        onAggregate: async (result) => {
          aggregated.push(result)
        },
      })

      await transformer.transform(createChange({ after: { id: '1', firstName: 'A', lastName: 'A', email: 'a@foo.com', createdAt: 1 } }))
      await transformer.flush()

      expect(aggregated).toHaveLength(1)
    })
  })

  // ============================================================================
  // DEBOUNCE TRANSFORMER
  // ============================================================================

  describe('debounce', () => {
    it('should debounce rapid changes to same key', async () => {
      const emitted: ChangeEvent<SourceRecord>[] = []

      const transformer = debounce<SourceRecord>({
        keyBy: (event) => event.after!.id,
        windowMs: 50,
        onEmit: async (event) => {
          emitted.push(event)
        },
      })

      // Rapid changes to same key
      await transformer.transform(createChange({ after: { id: '1', firstName: 'V1', lastName: 'A', email: 'a@foo.com', createdAt: 1 } }))
      await transformer.transform(createChange({ after: { id: '1', firstName: 'V2', lastName: 'A', email: 'a@foo.com', createdAt: 2 } }))
      await transformer.transform(createChange({ after: { id: '1', firstName: 'V3', lastName: 'A', email: 'a@foo.com', createdAt: 3 } }))

      await delay(100)

      // Only last change should be emitted
      expect(emitted).toHaveLength(1)
      expect(emitted[0]!.after!.firstName).toBe('V3')
    })

    it('should not debounce different keys', async () => {
      const emitted: ChangeEvent<SourceRecord>[] = []

      const transformer = debounce<SourceRecord>({
        keyBy: (event) => event.after!.id,
        windowMs: 50,
        onEmit: async (event) => {
          emitted.push(event)
        },
      })

      await transformer.transform(createChange({ after: { id: '1', firstName: 'A', lastName: 'A', email: 'a@foo.com', createdAt: 1 } }))
      await transformer.transform(createChange({ after: { id: '2', firstName: 'B', lastName: 'B', email: 'b@foo.com', createdAt: 2 } }))

      await delay(100)

      expect(emitted).toHaveLength(2)
    })
  })

  // ============================================================================
  // PIPELINE COMPOSITION
  // ============================================================================

  describe('pipeline', () => {
    it('should compose multiple transformers', async () => {
      const pipeline = createTransformPipeline<SourceRecord, TargetRecord>()
        .pipe(filter((e) => e.after!.email.includes('@example.com')))
        .pipe(
          map((r) => ({
            userId: r.id,
            fullName: `${r.firstName} ${r.lastName}`,
            emailAddress: r.email,
          }))
        )

      const input1 = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })
      const input2 = createChange<SourceRecord>({
        after: { id: '2', firstName: 'Jane', lastName: 'Doe', email: 'jane@other.com', createdAt: Date.now() },
      })

      const output1 = await pipeline.transform(input1)
      const output2 = await pipeline.transform(input2)

      expect(output1).not.toBeNull()
      expect(output1!.after!.fullName).toBe('John Doe')
      expect(output2).toBeNull() // Filtered out
    })

    it('should execute transformers in order', async () => {
      const order: string[] = []

      const pipeline = createTransformPipeline<SourceRecord, SourceRecord>()
        .pipe({
          name: 'first',
          async transform(event) {
            order.push('first')
            return event
          },
        })
        .pipe({
          name: 'second',
          async transform(event) {
            order.push('second')
            return event
          },
        })

      const input = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })

      await pipeline.transform(input)
      expect(order).toEqual(['first', 'second'])
    })

    it('should short-circuit on filter returning null', async () => {
      const secondCalled = vi.fn()

      const pipeline = createTransformPipeline<SourceRecord, SourceRecord>()
        .pipe(filter(() => false))
        .pipe({
          name: 'second',
          async transform(event) {
            secondCalled()
            return event
          },
        })

      const input = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })

      await pipeline.transform(input)
      expect(secondCalled).not.toHaveBeenCalled()
    })

    it('should provide statistics', async () => {
      const pipeline = createTransformPipeline<SourceRecord, SourceRecord>()
        .pipe(filter((e) => e.after!.id !== '2'))

      await pipeline.transform(createChange({ after: { id: '1', firstName: 'A', lastName: 'A', email: 'a@foo.com', createdAt: 1 } }))
      await pipeline.transform(createChange({ after: { id: '2', firstName: 'B', lastName: 'B', email: 'b@foo.com', createdAt: 2 } }))
      await pipeline.transform(createChange({ after: { id: '3', firstName: 'C', lastName: 'C', email: 'c@foo.com', createdAt: 3 } }))

      const stats = pipeline.getStats()
      expect(stats.inputCount).toBe(3)
      expect(stats.outputCount).toBe(2)
      expect(stats.filteredCount).toBe(1)
    })
  })

  // ============================================================================
  // FILTER CHAIN - Composable Predicates
  // ============================================================================

  describe('FilterChain', () => {
    it('should combine multiple filters with AND logic', async () => {
      const { createFilterChain } = await import('../transform')

      const chain = createFilterChain<SourceRecord>()
        .and((e) => e.after!.email.includes('@example.com'))
        .and((e) => e.after!.firstName.startsWith('J'))

      const input1 = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })
      const input2 = createChange<SourceRecord>({
        after: { id: '2', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', createdAt: Date.now() },
      })
      const input3 = createChange<SourceRecord>({
        after: { id: '3', firstName: 'Jane', lastName: 'Doe', email: 'jane@other.com', createdAt: Date.now() },
      })

      expect(await chain.test(input1)).toBe(true)
      expect(await chain.test(input2)).toBe(false) // name doesn't start with J
      expect(await chain.test(input3)).toBe(false) // email not @example.com
    })

    it('should combine filters with OR logic', async () => {
      const { createFilterChain } = await import('../transform')

      const chain = createFilterChain<SourceRecord>()
        .or((e) => e.after!.id === '1')
        .or((e) => e.after!.id === '3')

      const input1 = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })
      const input2 = createChange<SourceRecord>({
        after: { id: '2', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', createdAt: Date.now() },
      })
      const input3 = createChange<SourceRecord>({
        after: { id: '3', firstName: 'Jane', lastName: 'Doe', email: 'jane@other.com', createdAt: Date.now() },
      })

      expect(await chain.test(input1)).toBe(true)
      expect(await chain.test(input2)).toBe(false)
      expect(await chain.test(input3)).toBe(true)
    })

    it('should negate filters with NOT', async () => {
      const { createFilterChain } = await import('../transform')

      const chain = createFilterChain<SourceRecord>()
        .not((e) => e.after!.email.includes('@spam.com'))

      const input1 = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })
      const input2 = createChange<SourceRecord>({
        after: { id: '2', firstName: 'Spam', lastName: 'Bot', email: 'spam@spam.com', createdAt: Date.now() },
      })

      expect(await chain.test(input1)).toBe(true)
      expect(await chain.test(input2)).toBe(false)
    })

    it('should support complex boolean expressions', async () => {
      const { createFilterChain } = await import('../transform')

      // (isVIP OR isAdmin) AND NOT isBanned
      const chain = createFilterChain<SourceRecord>()
        .group((g) => g
          .or((e) => e.after!.metadata?.vip === true)
          .or((e) => e.after!.metadata?.admin === true)
        )
        .not((e) => e.after!.metadata?.banned === true)

      const vipUser = createChange<SourceRecord>({
        after: { id: '1', firstName: 'VIP', lastName: 'User', email: 'vip@example.com', createdAt: Date.now(), metadata: { vip: true } },
      })
      const adminUser = createChange<SourceRecord>({
        after: { id: '2', firstName: 'Admin', lastName: 'User', email: 'admin@example.com', createdAt: Date.now(), metadata: { admin: true } },
      })
      const bannedVip = createChange<SourceRecord>({
        after: { id: '3', firstName: 'Banned', lastName: 'VIP', email: 'banned@example.com', createdAt: Date.now(), metadata: { vip: true, banned: true } },
      })
      const regularUser = createChange<SourceRecord>({
        after: { id: '4', firstName: 'Regular', lastName: 'User', email: 'regular@example.com', createdAt: Date.now() },
      })

      expect(await chain.test(vipUser)).toBe(true)
      expect(await chain.test(adminUser)).toBe(true)
      expect(await chain.test(bannedVip)).toBe(false)
      expect(await chain.test(regularUser)).toBe(false)
    })

    it('should convert FilterChain to Transformer', async () => {
      const { createFilterChain } = await import('../transform')

      const chain = createFilterChain<SourceRecord>()
        .and((e) => e.after!.id === '1')

      const transformer = chain.toTransformer()

      const input1 = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })
      const input2 = createChange<SourceRecord>({
        after: { id: '2', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', createdAt: Date.now() },
      })

      expect(await transformer.transform(input1)).not.toBeNull()
      expect(await transformer.transform(input2)).toBeNull()
    })
  })

  // ============================================================================
  // OPERATION TYPE FILTER
  // ============================================================================

  describe('filterByOperation', () => {
    it('should filter by INSERT operation', async () => {
      const { filterByOperation } = await import('../transform')

      const transformer = filterByOperation<SourceRecord>(['INSERT'])

      const insertEvent = createChange<SourceRecord>({
        type: ChangeType.INSERT,
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })
      const updateEvent: ChangeEvent<SourceRecord> = {
        ...insertEvent,
        type: ChangeType.UPDATE,
        before: insertEvent.after,
      }
      const deleteEvent: ChangeEvent<SourceRecord> = {
        ...insertEvent,
        type: ChangeType.DELETE,
        after: null,
        before: insertEvent.after,
      }

      expect(await transformer.transform(insertEvent)).not.toBeNull()
      expect(await transformer.transform(updateEvent)).toBeNull()
      expect(await transformer.transform(deleteEvent)).toBeNull()
    })

    it('should filter by multiple operation types', async () => {
      const { filterByOperation } = await import('../transform')

      const transformer = filterByOperation<SourceRecord>(['INSERT', 'DELETE'])

      const insertEvent = createChange<SourceRecord>({
        type: ChangeType.INSERT,
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })
      const updateEvent: ChangeEvent<SourceRecord> = {
        ...insertEvent,
        type: ChangeType.UPDATE,
        before: insertEvent.after,
      }
      const deleteEvent: ChangeEvent<SourceRecord> = {
        ...insertEvent,
        type: ChangeType.DELETE,
        after: null,
        before: insertEvent.after,
      }

      expect(await transformer.transform(insertEvent)).not.toBeNull()
      expect(await transformer.transform(updateEvent)).toBeNull()
      expect(await transformer.transform(deleteEvent)).not.toBeNull()
    })
  })

  // ============================================================================
  // TABLE/COLUMN PATTERN FILTER
  // ============================================================================

  describe('filterByTable', () => {
    it('should filter by exact table name', async () => {
      const { filterByTable } = await import('../transform')

      const transformer = filterByTable<SourceRecord>(['users', 'orders'])

      const usersEvent = createChange<SourceRecord>({
        table: 'users',
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })
      const ordersEvent = createChange<SourceRecord>({
        table: 'orders',
        after: { id: '2', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', createdAt: Date.now() },
      })
      const productsEvent = createChange<SourceRecord>({
        table: 'products',
        after: { id: '3', firstName: 'Bob', lastName: 'Smith', email: 'bob@example.com', createdAt: Date.now() },
      })

      expect(await transformer.transform(usersEvent)).not.toBeNull()
      expect(await transformer.transform(ordersEvent)).not.toBeNull()
      expect(await transformer.transform(productsEvent)).toBeNull()
    })

    it('should filter by table pattern with glob', async () => {
      const { filterByTable } = await import('../transform')

      const transformer = filterByTable<SourceRecord>(['user*', 'audit_*'])

      const usersEvent = createChange<SourceRecord>({
        table: 'users',
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })
      const userProfilesEvent = createChange<SourceRecord>({
        table: 'user_profiles',
        after: { id: '2', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', createdAt: Date.now() },
      })
      const auditLogsEvent = createChange<SourceRecord>({
        table: 'audit_logs',
        after: { id: '3', firstName: 'Bob', lastName: 'Smith', email: 'bob@example.com', createdAt: Date.now() },
      })
      const ordersEvent = createChange<SourceRecord>({
        table: 'orders',
        after: { id: '4', firstName: 'Alice', lastName: 'Johnson', email: 'alice@example.com', createdAt: Date.now() },
      })

      expect(await transformer.transform(usersEvent)).not.toBeNull()
      expect(await transformer.transform(userProfilesEvent)).not.toBeNull()
      expect(await transformer.transform(auditLogsEvent)).not.toBeNull()
      expect(await transformer.transform(ordersEvent)).toBeNull()
    })

    it('should exclude tables by pattern', async () => {
      const { filterByTable } = await import('../transform')

      const transformer = filterByTable<SourceRecord>({ exclude: ['_temp_*', 'log_*'] })

      const usersEvent = createChange<SourceRecord>({
        table: 'users',
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })
      const tempEvent = createChange<SourceRecord>({
        table: '_temp_staging',
        after: { id: '2', firstName: 'Temp', lastName: 'Data', email: 'temp@example.com', createdAt: Date.now() },
      })
      const logsEvent = createChange<SourceRecord>({
        table: 'log_access',
        after: { id: '3', firstName: 'Log', lastName: 'Entry', email: 'log@example.com', createdAt: Date.now() },
      })

      expect(await transformer.transform(usersEvent)).not.toBeNull()
      expect(await transformer.transform(tempEvent)).toBeNull()
      expect(await transformer.transform(logsEvent)).toBeNull()
    })
  })

  describe('filterByColumn', () => {
    it('should filter when specific column is changed', async () => {
      const { filterByColumn } = await import('../transform')

      const transformer = filterByColumn<SourceRecord>(['email', 'lastName'])

      const emailChangedEvent: ChangeEvent<SourceRecord> = {
        eventId: 'evt-1',
        type: ChangeType.UPDATE,
        before: { id: '1', firstName: 'John', lastName: 'Doe', email: 'old@example.com', createdAt: Date.now() },
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'new@example.com', createdAt: Date.now() },
        timestamp: Date.now(),
        position: { sequence: 1, timestamp: Date.now() },
        isBackfill: false,
      }
      const firstNameChangedEvent: ChangeEvent<SourceRecord> = {
        eventId: 'evt-2',
        type: ChangeType.UPDATE,
        before: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
        after: { id: '1', firstName: 'Johnny', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
        timestamp: Date.now(),
        position: { sequence: 2, timestamp: Date.now() },
        isBackfill: false,
      }

      expect(await transformer.transform(emailChangedEvent)).not.toBeNull()
      expect(await transformer.transform(firstNameChangedEvent)).toBeNull()
    })

    it('should pass INSERT and DELETE events regardless of column filter', async () => {
      const { filterByColumn } = await import('../transform')

      const transformer = filterByColumn<SourceRecord>(['email'])

      const insertEvent = createChange<SourceRecord>({
        type: ChangeType.INSERT,
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })
      const deleteEvent: ChangeEvent<SourceRecord> = {
        eventId: 'evt-2',
        type: ChangeType.DELETE,
        before: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
        after: null,
        timestamp: Date.now(),
        position: { sequence: 2, timestamp: Date.now() },
        isBackfill: false,
      }

      expect(await transformer.transform(insertEvent)).not.toBeNull()
      expect(await transformer.transform(deleteEvent)).not.toBeNull()
    })
  })

  // ============================================================================
  // FIELD TRANSFORMATIONS
  // ============================================================================

  describe('rename', () => {
    it('should rename fields', async () => {
      const { rename } = await import('../transform')

      const transformer = rename<SourceRecord, { userId: string; name: string; mail: string }>({
        id: 'userId',
        firstName: 'name',
        email: 'mail',
      })

      const input = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })

      const output = await transformer.transform(input)
      expect(output!.after!.userId).toBe('1')
      expect(output!.after!.name).toBe('John')
      expect(output!.after!.mail).toBe('john@example.com')
      expect((output!.after as any).id).toBeUndefined()
    })

    it('should preserve fields not in rename map', async () => {
      const { rename } = await import('../transform')

      const transformer = rename<SourceRecord, SourceRecord & { userId: string }>({
        id: 'userId',
      }, { preserveOthers: true })

      const input = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })

      const output = await transformer.transform(input)
      expect(output!.after!.userId).toBe('1')
      expect(output!.after!.firstName).toBe('John')
      expect(output!.after!.email).toBe('john@example.com')
    })
  })

  describe('mask', () => {
    it('should mask field values for PII protection', async () => {
      const { mask } = await import('../transform')

      const transformer = mask<SourceRecord>(['email'], {
        maskFn: (value) => String(value).replace(/(.{2}).*(@.*)/, '$1***$2'),
      })

      const input = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })

      const output = await transformer.transform(input)
      expect(output!.after!.email).toBe('jo***@example.com')
      expect(output!.after!.firstName).toBe('John') // Not masked
    })

    it('should use default masking strategy', async () => {
      const { mask } = await import('../transform')

      const transformer = mask<SourceRecord>(['email', 'lastName'])

      const input = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })

      const output = await transformer.transform(input)
      expect(output!.after!.email).toBe('****')
      expect(output!.after!.lastName).toBe('****')
      expect(output!.after!.firstName).toBe('John')
    })

    it('should mask nested fields', async () => {
      const { mask } = await import('../transform')

      interface NestedRecord {
        id: string
        profile: {
          ssn: string
          name: string
        }
      }

      const transformer = mask<NestedRecord>(['profile.ssn'])

      const input = createChange<NestedRecord>({
        after: {
          id: '1',
          profile: {
            ssn: '123-45-6789',
            name: 'John Doe',
          },
        },
      })

      const output = await transformer.transform(input)
      expect(output!.after!.profile.ssn).toBe('****')
      expect(output!.after!.profile.name).toBe('John Doe')
    })
  })

  describe('derive', () => {
    it('should compute derived fields from existing fields', async () => {
      const { derive } = await import('../transform')

      interface DerivedRecord extends SourceRecord {
        fullName: string
        emailDomain: string
      }

      const transformer = derive<SourceRecord, DerivedRecord>({
        fullName: (r) => `${r.firstName} ${r.lastName}`,
        emailDomain: (r) => r.email.split('@')[1] || '',
      })

      const input = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })

      const output = await transformer.transform(input)
      expect(output!.after!.fullName).toBe('John Doe')
      expect(output!.after!.emailDomain).toBe('example.com')
      expect(output!.after!.firstName).toBe('John') // Original preserved
    })

    it('should support async derivation functions', async () => {
      const { derive } = await import('../transform')

      interface DerivedRecord extends SourceRecord {
        enrichedData: string
      }

      const transformer = derive<SourceRecord, DerivedRecord>({
        enrichedData: async (r) => {
          await delay(5)
          return `enriched-${r.id}`
        },
      })

      const input = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })

      const output = await transformer.transform(input)
      expect(output!.after!.enrichedData).toBe('enriched-1')
    })

    it('should handle derivation with conditional logic', async () => {
      const { derive } = await import('../transform')

      interface DerivedRecord extends SourceRecord {
        status: string
      }

      const transformer = derive<SourceRecord, DerivedRecord>({
        status: (r) => r.email.endsWith('@vip.com') ? 'VIP' : 'Standard',
      })

      const vipInput = createChange<SourceRecord>({
        after: { id: '1', firstName: 'VIP', lastName: 'User', email: 'vip@vip.com', createdAt: Date.now() },
      })
      const standardInput = createChange<SourceRecord>({
        after: { id: '2', firstName: 'Standard', lastName: 'User', email: 'user@example.com', createdAt: Date.now() },
      })

      expect((await transformer.transform(vipInput))!.after!.status).toBe('VIP')
      expect((await transformer.transform(standardInput))!.after!.status).toBe('Standard')
    })
  })

  // ============================================================================
  // CONDITIONAL FILTERING WITH PREDICATES
  // ============================================================================

  describe('conditional filtering', () => {
    it('should filter based on field value predicates', async () => {
      const { where } = await import('../transform')

      const transformer = where<SourceRecord>({
        field: 'email',
        operator: 'contains',
        value: '@example.com',
      })

      const matchingEvent = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })
      const nonMatchingEvent = createChange<SourceRecord>({
        after: { id: '2', firstName: 'Jane', lastName: 'Doe', email: 'jane@other.com', createdAt: Date.now() },
      })

      expect(await transformer.transform(matchingEvent)).not.toBeNull()
      expect(await transformer.transform(nonMatchingEvent)).toBeNull()
    })

    it('should support multiple operators', async () => {
      const { where } = await import('../transform')

      // Test 'equals' operator
      const equalsTransformer = where<SourceRecord>({
        field: 'id',
        operator: 'equals',
        value: '1',
      })

      // Test 'gt' operator
      const gtTransformer = where<SourceRecord>({
        field: 'createdAt',
        operator: 'gt',
        value: 1000,
      })

      // Test 'regex' operator
      const regexTransformer = where<SourceRecord>({
        field: 'email',
        operator: 'regex',
        value: '^[a-z]+@example\\.com$',
      })

      const event = createChange<SourceRecord>({
        after: { id: '1', firstName: 'john', lastName: 'Doe', email: 'john@example.com', createdAt: 2000 },
      })

      expect(await equalsTransformer.transform(event)).not.toBeNull()
      expect(await gtTransformer.transform(event)).not.toBeNull()
      expect(await regexTransformer.transform(event)).not.toBeNull()
    })

    it('should combine multiple where conditions', async () => {
      const { whereAll, whereAny } = await import('../transform')

      const allTransformer = whereAll<SourceRecord>([
        { field: 'email', operator: 'contains', value: '@example.com' },
        { field: 'firstName', operator: 'equals', value: 'John' },
      ])

      const anyTransformer = whereAny<SourceRecord>([
        { field: 'id', operator: 'equals', value: '1' },
        { field: 'id', operator: 'equals', value: '2' },
      ])

      const matchAllEvent = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })
      const matchOneEvent = createChange<SourceRecord>({
        after: { id: '2', firstName: 'Jane', lastName: 'Doe', email: 'jane@other.com', createdAt: Date.now() },
      })
      const matchNoneEvent = createChange<SourceRecord>({
        after: { id: '3', firstName: 'Bob', lastName: 'Smith', email: 'bob@other.com', createdAt: Date.now() },
      })

      expect(await allTransformer.transform(matchAllEvent)).not.toBeNull()
      expect(await allTransformer.transform(matchOneEvent)).toBeNull()

      expect(await anyTransformer.transform(matchAllEvent)).not.toBeNull()
      expect(await anyTransformer.transform(matchOneEvent)).not.toBeNull()
      expect(await anyTransformer.transform(matchNoneEvent)).toBeNull()
    })
  })

  // ============================================================================
  // INTEGRATION WITH CDCSTREAM
  // ============================================================================

  describe('CDCStream integration', () => {
    it('should apply FilterChain to CDCStream', async () => {
      const { createFilterChain } = await import('../transform')
      const { createCDCStream, ChangeType: CT } = await import('../stream')

      const events: ChangeEvent<SourceRecord>[] = []

      const chain = createFilterChain<SourceRecord>()
        .and((e) => e.after!.email.includes('@example.com'))
        .and((e) => e.type === CT.INSERT)

      const stream = createCDCStream<SourceRecord>({
        filter: (e) => chain.testSync(e),
        onChange: async (e) => events.push(e),
      })

      await stream.insert({ id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() })
      await stream.insert({ id: '2', firstName: 'Jane', lastName: 'Doe', email: 'jane@other.com', createdAt: Date.now() })
      await stream.update(
        { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
        { id: '1', firstName: 'Johnny', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() }
      )
      await stream.flush()

      expect(events).toHaveLength(1)
      expect(events[0]!.after!.firstName).toBe('John')
    })

    it('should apply TransformPipeline with mask and derive to CDCStream', async () => {
      const { createTransformPipeline, mask, derive } = await import('../transform')
      const { createCDCStream } = await import('../stream')

      interface OutputRecord extends SourceRecord {
        fullName: string
      }

      const events: ChangeEvent<OutputRecord>[] = []

      const pipeline = createTransformPipeline<SourceRecord, OutputRecord>()
        .pipe(mask(['email']))
        .pipe(derive({
          fullName: (r) => `${r.firstName} ${r.lastName}`,
        }))

      // Use inline transform since stream.transform is sync
      const stream = createCDCStream<SourceRecord, OutputRecord>({
        transform: (e) => {
          // Apply mask manually (sync)
          const maskEmail = (record: SourceRecord | null): SourceRecord | null => {
            if (!record) return null
            return { ...record, email: '****' }
          }
          // Apply derive manually (sync)
          const deriveFullName = (record: SourceRecord | null): OutputRecord | null => {
            if (!record) return null
            return { ...record, fullName: `${record.firstName} ${record.lastName}` }
          }
          return {
            ...e,
            before: deriveFullName(maskEmail(e.before)),
            after: deriveFullName(maskEmail(e.after)),
          }
        },
        onChange: async (e) => events.push(e),
      })

      await stream.insert({ id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() })
      await stream.flush()

      expect(events).toHaveLength(1)
      expect(events[0]!.after!.email).toBe('****')
      expect(events[0]!.after!.fullName).toBe('John Doe')

      // Also test the async pipeline directly
      const inputEvent = createChange<SourceRecord>({
        after: { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@example.com', createdAt: Date.now() },
      })
      const pipelineOutput = await pipeline.transform(inputEvent)
      expect(pipelineOutput!.after!.email).toBe('****')
      expect(pipelineOutput!.after!.fullName).toBe('John Doe')
    })
  })
})
