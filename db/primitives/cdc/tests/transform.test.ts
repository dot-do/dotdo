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
})
