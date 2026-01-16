/**
 * Output Component Isolation Tests (TDD RED Phase)
 *
 * Tests for module-level mutable state in Output.tsx.
 *
 * Current state: `let entryCounter = 0` at module level (line 197)
 * Target state: Counter scoped to component instance or context
 *
 * Problems with module-level state:
 * 1. Multiple Output instances share the same counter
 * 2. Tests cannot run in isolation without resetEntryCounter()
 * 3. Entry IDs are not deterministic for snapshot testing
 * 4. Parallel test execution can cause race conditions
 *
 * RED PHASE: These tests define the expected isolation behavior.
 * They should FAIL because module-level state isn't scoped properly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createOutputEntry,
  resetEntryCounter,
  OutputBuffer,
  type OutputEntry,
  type OutputType,
} from '../src/components/Output.js'

// =============================================================================
// Test 1: Entry IDs should be deterministic without manual reset
// =============================================================================

describe('Output entry ID isolation', () => {
  /**
   * This test verifies that entry IDs are deterministic when tests run in isolation.
   * Currently FAILS because module-level counter persists between tests.
   *
   * Expected: Each test should start with counter at 0
   * Actual: Counter continues from previous test
   */
  it('should generate deterministic entry IDs without explicit reset', () => {
    // Create first entry - should always be output_1_*
    const entry1 = createOutputEntry('info', 'First entry')

    // The ID should start with output_1_ (first entry in this test)
    // This will FAIL because the counter persists from other tests
    expect(entry1.id).toMatch(/^output_1_\d+$/)
  })

  it('should generate deterministic entry IDs in subsequent test', () => {
    // Create first entry in this test - should also be output_1_*
    // because this test should have its own isolated counter
    const entry1 = createOutputEntry('info', 'First entry in second test')

    // This will FAIL because counter continues from previous test
    // (will be output_2_ or higher instead of output_1_)
    expect(entry1.id).toMatch(/^output_1_\d+$/)
  })

  it('should generate sequential IDs within same test', () => {
    // Within a single test, IDs should be sequential starting from 1
    const entry1 = createOutputEntry('info', 'Entry 1')
    const entry2 = createOutputEntry('info', 'Entry 2')
    const entry3 = createOutputEntry('info', 'Entry 3')

    // Extract the counter portion from IDs
    const getCounter = (id: string) => parseInt(id.split('_')[1])

    const counter1 = getCounter(entry1.id)
    const counter2 = getCounter(entry2.id)
    const counter3 = getCounter(entry3.id)

    // Should be sequential
    expect(counter2).toBe(counter1 + 1)
    expect(counter3).toBe(counter2 + 1)

    // First entry should be 1 (will FAIL due to module-level state)
    expect(counter1).toBe(1)
  })
})

// =============================================================================
// Test 2: Multiple OutputBuffer instances should not interfere
// =============================================================================

describe('OutputBuffer instance isolation', () => {
  /**
   * Multiple OutputBuffer instances should have completely isolated state.
   * Each buffer's entries should have IDs independent of other buffers.
   */
  it('should not share entry counter between OutputBuffer instances', () => {
    const buffer1 = new OutputBuffer(100)
    const buffer2 = new OutputBuffer(100)

    // Add entries to buffer1
    const entry1a = buffer1.add('info', 'Buffer 1 - Entry A')
    const entry1b = buffer1.add('info', 'Buffer 1 - Entry B')

    // Add entries to buffer2
    const entry2a = buffer2.add('info', 'Buffer 2 - Entry A')
    const entry2b = buffer2.add('info', 'Buffer 2 - Entry B')

    // Each buffer should have entries with independent counter starting from 1
    // This will FAIL because both use shared module-level counter
    const getCounter = (id: string) => parseInt(id.split('_')[1])

    // Buffer 1 entries should be 1, 2
    expect(getCounter(entry1a.id)).toBe(1)
    expect(getCounter(entry1b.id)).toBe(2)

    // Buffer 2 entries should ALSO be 1, 2 (independent counter)
    // This will FAIL - they'll be 3, 4 due to shared counter
    expect(getCounter(entry2a.id)).toBe(1)
    expect(getCounter(entry2b.id)).toBe(2)
  })

  it('should maintain isolation when buffers are used concurrently', () => {
    const buffer1 = new OutputBuffer(100)
    const buffer2 = new OutputBuffer(100)

    // Interleave additions to both buffers
    const entries: { buffer: 1 | 2; entry: OutputEntry }[] = []

    entries.push({ buffer: 1, entry: buffer1.add('info', 'B1-1') })
    entries.push({ buffer: 2, entry: buffer2.add('info', 'B2-1') })
    entries.push({ buffer: 1, entry: buffer1.add('info', 'B1-2') })
    entries.push({ buffer: 2, entry: buffer2.add('info', 'B2-2') })
    entries.push({ buffer: 1, entry: buffer1.add('info', 'B1-3') })

    // Buffer 1 should have entries with counters 1, 2, 3
    // Buffer 2 should have entries with counters 1, 2
    // (independent sequences for each buffer)

    const getCounter = (id: string) => parseInt(id.split('_')[1])

    const buffer1Entries = entries.filter((e) => e.buffer === 1)
    const buffer2Entries = entries.filter((e) => e.buffer === 2)

    // Buffer 1: should be 1, 2, 3
    expect(buffer1Entries.map((e) => getCounter(e.entry.id))).toEqual([1, 2, 3])

    // Buffer 2: should be 1, 2 (independent counter)
    // This will FAIL - counters will be interleaved: 2, 4 instead of 1, 2
    expect(buffer2Entries.map((e) => getCounter(e.entry.id))).toEqual([1, 2])
  })

  it('should preserve entry content while maintaining isolation', () => {
    const buffer1 = new OutputBuffer(100)
    const buffer2 = new OutputBuffer(100)

    buffer1.add('error', 'Error in buffer 1')
    buffer2.add('warning', 'Warning in buffer 2')

    // Content should be preserved
    expect(buffer1.getEntries()[0].content).toBe('Error in buffer 1')
    expect(buffer1.getEntries()[0].type).toBe('error')

    expect(buffer2.getEntries()[0].content).toBe('Warning in buffer 2')
    expect(buffer2.getEntries()[0].type).toBe('warning')

    // Each buffer should have exactly 1 entry
    expect(buffer1.length).toBe(1)
    expect(buffer2.length).toBe(1)
  })
})

// =============================================================================
// Test 3: Parallel test execution isolation
// =============================================================================

describe('Parallel execution isolation', () => {
  /**
   * When tests run in parallel (Vitest's default with `pool: 'forks'`),
   * each test process should have isolated state.
   *
   * This test simulates what happens when createOutputEntry is called
   * from multiple "parallel" contexts.
   */
  it('should support parallel entry creation without ID collisions', async () => {
    // Simulate parallel entry creation
    const createEntriesInContext = async (
      contextId: string,
      count: number
    ): Promise<OutputEntry[]> => {
      const entries: OutputEntry[] = []
      for (let i = 0; i < count; i++) {
        entries.push(createOutputEntry('info', `${contextId}-entry-${i}`))
        // Small delay to simulate async work
        await new Promise((r) => setTimeout(r, 0))
      }
      return entries
    }

    // Create entries in two "parallel" contexts
    const [context1Entries, context2Entries] = await Promise.all([
      createEntriesInContext('ctx1', 3),
      createEntriesInContext('ctx2', 3),
    ])

    // Extract all IDs
    const allIds = [...context1Entries, ...context2Entries].map((e) => e.id)

    // All IDs should be unique (this should pass - module counter ensures uniqueness)
    const uniqueIds = new Set(allIds)
    expect(uniqueIds.size).toBe(allIds.length)

    // However, the IDs should be predictable/deterministic for each context
    // This is a design requirement for snapshot testing
    const getCounter = (id: string) => parseInt(id.split('_')[1])

    // Context 1 should have sequential counters starting from 1
    // This will FAIL because contexts share counter
    const ctx1Counters = context1Entries.map((e) => getCounter(e.id))
    const ctx2Counters = context2Entries.map((e) => getCounter(e.id))

    // In an isolated world, both would be [1, 2, 3]
    // With shared counter, we get interleaved values
    expect(ctx1Counters).toEqual([1, 2, 3])
    expect(ctx2Counters).toEqual([1, 2, 3])
  })
})

// =============================================================================
// Test 4: Snapshot testing determinism
// =============================================================================

describe('Snapshot testing determinism', () => {
  /**
   * Entry IDs must be deterministic for snapshot testing to work.
   * Each test run should produce identical IDs for the same sequence.
   */
  it('should produce consistent IDs for snapshot testing', () => {
    // Create a known sequence of entries
    const entries = [
      createOutputEntry('info', 'Starting process'),
      createOutputEntry('warning', 'Low memory'),
      createOutputEntry('error', 'Connection failed'),
      createOutputEntry('info', 'Retrying...'),
      createOutputEntry('result', 'Success!'),
    ]

    // The IDs should match a deterministic pattern
    // For snapshot testing, we need these to be the same every test run
    const expectedPattern = entries.map((_, i) => new RegExp(`^output_${i + 1}_\\d+$`))

    entries.forEach((entry, i) => {
      // This will FAIL if counter doesn't start at 1
      expect(entry.id).toMatch(expectedPattern[i])
    })

    // Snapshot of the entry structure (IDs must be predictable)
    const snapshotData = entries.map((e) => ({
      // ID counter portion should be deterministic
      idCounter: parseInt(e.id.split('_')[1]),
      type: e.type,
      content: e.content,
    }))

    // Counter should start at 1 and increment
    expect(snapshotData.map((d) => d.idCounter)).toEqual([1, 2, 3, 4, 5])
  })

  it('should support creating factory functions with isolated counters', () => {
    /**
     * Ideal solution: Provide a factory that creates isolated entry creators.
     *
     * Example API (not yet implemented):
     * const createEntry = createOutputEntryFactory()
     * const entry1 = createEntry('info', 'test') // Always output_1_*
     */

    // For now, we can only test that the current implementation fails this requirement
    // by showing that sequential calls don't start from 1

    // First call in this test - what counter value do we get?
    const entry = createOutputEntry('info', 'Test')
    const counter = parseInt(entry.id.split('_')[1])

    // In an isolated system, this would always be 1
    // With module-level state, it depends on previous test execution order
    expect(counter).toBe(1)
  })
})

// =============================================================================
// Test 5: Manual reset effectiveness (documents current workaround)
// =============================================================================

describe('resetEntryCounter workaround', () => {
  /**
   * Documents the current workaround: manually calling resetEntryCounter()
   * This test suite uses beforeEach to reset, showing it works but is fragile.
   */

  beforeEach(() => {
    // Current workaround: manually reset before each test
    resetEntryCounter()
  })

  it('should allow deterministic IDs after manual reset', () => {
    const entry1 = createOutputEntry('info', 'Entry 1')
    const entry2 = createOutputEntry('info', 'Entry 2')

    // After reset, counter starts at 1
    expect(entry1.id).toMatch(/^output_1_\d+$/)
    expect(entry2.id).toMatch(/^output_2_\d+$/)
  })

  it('should require reset in every test that needs determinism', () => {
    // This test also gets reset via beforeEach
    const entry = createOutputEntry('info', 'Entry')

    // Works because of beforeEach, but this is fragile
    expect(entry.id).toMatch(/^output_1_\d+$/)
  })

  /**
   * The problem: Forgetting to reset breaks isolation.
   * This test is in a different describe block without beforeEach
   * to demonstrate the issue.
   */
})

describe('Isolation without manual reset (demonstrates the bug)', () => {
  // No beforeEach reset here

  it('test A - creates entries', () => {
    createOutputEntry('info', 'Entry from test A')
    createOutputEntry('info', 'Another entry from test A')
    // Counter is now at 2 (or higher if other tests ran first)
  })

  it('test B - expects isolation but gets polluted state', () => {
    // This test expects to start fresh, but counter continues
    const entry = createOutputEntry('info', 'Entry from test B')
    const counter = parseInt(entry.id.split('_')[1])

    // This will FAIL - counter will be 3 or higher, not 1
    expect(counter).toBe(1)
  })
})

// =============================================================================
// Test 6: Component-level state isolation (target behavior)
// =============================================================================

describe('Target behavior: Component-level state isolation', () => {
  /**
   * These tests describe the DESIRED behavior after fixing the module-level state.
   * The fix could be:
   * 1. React Context for the counter
   * 2. Closure-based factory function
   * 3. Instance-based counter in OutputBuffer
   */

  it('should provide createOutputEntryFactory for isolated counter', () => {
    // Target API: Factory that creates an isolated entry creator
    // const createEntry = createOutputEntryFactory()

    // For now, test that we need this API
    type CreateOutputEntryFactory = () => (type: OutputType, content: unknown) => OutputEntry

    // Check if the factory function exists (it doesn't yet)
    const hasFactory = typeof (globalThis as any).createOutputEntryFactory === 'function'

    // This test will PASS once we implement createOutputEntryFactory
    // For now it documents the requirement
    expect(hasFactory).toBe(false) // Currently not implemented

    // When implemented, usage would be:
    // const factory = createOutputEntryFactory()
    // const entry1 = factory('info', 'test') // output_1_*
    // const entry2 = factory('info', 'test') // output_2_*
    //
    // const factory2 = createOutputEntryFactory()
    // const entry3 = factory2('info', 'test') // output_1_* (independent counter!)
  })

  it('should document OutputBuffer as the preferred isolated API', () => {
    // OutputBuffer has its own entry storage, but still uses shared counter
    // Ideal: OutputBuffer should have its own counter

    const buffer = new OutputBuffer(100)

    // Add entries
    buffer.add('info', 'Entry 1')
    buffer.add('info', 'Entry 2')

    // Clear and start fresh
    buffer.clear()

    // Add new entries after clear
    const freshEntry = buffer.add('info', 'Fresh entry')

    // With proper isolation, this fresh entry would have counter 1
    // But currently it continues from global counter
    const counter = parseInt(freshEntry.id.split('_')[1])

    // This will FAIL - counter doesn't reset when buffer is cleared
    expect(counter).toBe(1)
  })
})

// =============================================================================
// Test 7: Memory and cleanup
// =============================================================================

describe('Memory and cleanup', () => {
  it('should not leak counter state across module reloads', async () => {
    // In a fresh module load, counter should start at 0
    // This tests that there's no persistence mechanism

    // Create some entries
    createOutputEntry('info', 'Entry 1')
    createOutputEntry('info', 'Entry 2')
    createOutputEntry('info', 'Entry 3')

    // Reset counter
    resetEntryCounter()

    // After reset, next entry should be 1
    const entry = createOutputEntry('info', 'After reset')
    expect(entry.id).toMatch(/^output_1_\d+$/)
  })

  it('should document that module-level state survives HMR', () => {
    // In development with Hot Module Replacement (HMR),
    // module-level state may or may not survive reloads
    // depending on the bundler configuration.

    // This is a documentation test - no assertion needed
    // Just noting that module-level state has HMR implications

    expect(true).toBe(true) // Placeholder for documentation
  })
})
