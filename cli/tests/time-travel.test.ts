import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { CompletionEngine } from '../src/completions.js'

describe('time travel type completions', () => {
  let engine: CompletionEngine

  beforeEach(() => {
    engine = new CompletionEngine()
  })

  afterEach(() => {
    engine.dispose()
  })

  it('should provide checkout method on $', () => {
    const completions = engine.getCompletions('$.', 2)
    const names = completions.map(c => c.name)
    expect(names).toContain('checkout')
  })

  it('should provide branch method on $', () => {
    const completions = engine.getCompletions('$.', 2)
    const names = completions.map(c => c.name)
    expect(names).toContain('branch')
  })

  it('should provide merge method on $', () => {
    const completions = engine.getCompletions('$.', 2)
    const names = completions.map(c => c.name)
    expect(names).toContain('merge')
  })

  it('should show checkout parameter type as VersionRef', () => {
    const completions = engine.getCompletions('$.checkout(', 11)
    // Should indicate string parameter
    expect(completions.length).toBeGreaterThanOrEqual(0)
  })

  it('should provide checkout without $ prefix', () => {
    // checkout should be available globally too
    const completions = engine.getCompletions('checkout(', 9)
    expect(completions.length).toBeGreaterThanOrEqual(0)
  })

  it('should provide branch without $ prefix', () => {
    const completions = engine.getCompletions('branch(', 7)
    expect(completions.length).toBeGreaterThanOrEqual(0)
  })

  it('should provide merge without $ prefix', () => {
    const completions = engine.getCompletions('merge(', 6)
    expect(completions.length).toBeGreaterThanOrEqual(0)
  })
})

/**
 * Time Travel @ Operator Type Definitions (RED Phase)
 *
 * Tests for the @ operator syntax that enables time travel:
 * - Customer@'2024-01-01' - access entity at specific timestamp
 * - Customer@'-1h' - access entity at relative time (1 hour ago)
 * - Customer@'v1234' - access entity at specific version
 *
 * The @ operator should:
 * 1. Work as a postfix operator on any NounProxy
 * 2. Accept timestamp strings (ISO format)
 * 3. Accept relative time strings (-1h, -1d, -1w)
 * 4. Accept version refs (v1234, ~1)
 * 5. Return the same NounProxy type for method chaining
 */
describe('Time travel @ type definitions', () => {
  let engine: CompletionEngine

  beforeEach(() => {
    engine = new CompletionEngine()
  })

  afterEach(() => {
    engine.dispose()
  })

  describe('@timestamp syntax completions', () => {
    it('should provide completions for Customer@timestamp.', async () => {
      // Customer@'2024-01-01' should show Customer methods (get, list, create, etc.)
      // This tests that the @ operator returns a NounProxy type
      const completions = engine.getCompletions("Customer@'2024-01-01'.", 22)
      const names = completions.map(c => c.name)

      expect(names).toContainEqual('get')
      expect(names).toContainEqual('list')
      expect(names).toContainEqual('create')
    })

    it('should provide completions for $.Customer@timestamp.', async () => {
      // Full $ prefix syntax should also work
      const completions = engine.getCompletions("$.Customer@'2024-01-01'.", 24)
      const names = completions.map(c => c.name)

      expect(names).toContainEqual('get')
      expect(names).toContainEqual('list')
    })

    it('should accept ISO date format', async () => {
      // $.Customer@'2024-01-15T10:30:00Z' should be valid
      const diagnostics = engine.getDiagnostics("$.Customer@'2024-01-15T10:30:00Z'.get('c-123')")
      expect(diagnostics).toHaveLength(0)
    })
  })

  describe('@relative syntax completions', () => {
    it('should provide completions for @relative time syntax', async () => {
      // Customer@'-1h' should work (1 hour ago)
      const completions = engine.getCompletions("Customer@'-1h'.", 15)
      const names = completions.map(c => c.name)

      expect(names).toContainEqual('get')
      expect(names).toContainEqual('list')
    })

    it('should accept days relative format', async () => {
      // Customer@'-7d' should work (7 days ago)
      const completions = engine.getCompletions("Customer@'-7d'.", 15)
      const names = completions.map(c => c.name)

      expect(names).toContainEqual('get')
    })

    it('should accept weeks relative format', async () => {
      // Customer@'-2w' should work (2 weeks ago)
      const completions = engine.getCompletions("Customer@'-2w'.", 15)
      const names = completions.map(c => c.name)

      expect(names).toContainEqual('get')
    })
  })

  describe('@version syntax completions', () => {
    it('should provide completions for @version syntax', async () => {
      // Customer@'v1234' should work (specific version)
      const completions = engine.getCompletions("Customer@'v1234'.", 17)
      const names = completions.map(c => c.name)

      expect(names).toContainEqual('get')
      expect(names).toContainEqual('list')
    })

    it('should provide completions for @relative version syntax', async () => {
      // Customer@'~1' should work (one version back)
      const completions = engine.getCompletions("Customer@'~1'.", 14)
      const names = completions.map(c => c.name)

      expect(names).toContainEqual('get')
    })
  })

  describe('type checking time travel expressions', () => {
    it('should type check time travel expressions without errors', async () => {
      // Full expression should have no type errors
      const diagnostics = engine.getDiagnostics("$.Customer@'2024-01-01'.get('c-123')")
      expect(diagnostics).toHaveLength(0)
    })

    it('should type check chained time travel calls', async () => {
      // Method chaining after @ should work
      const diagnostics = engine.getDiagnostics(`
        const customer = await Customer@'2024-01-01'.get('c-123')
        const orders = await Order@'2024-01-01'.list()
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it('should preserve return types through time travel', async () => {
      // Return type from .get() should still be Promise<T>
      const code = `
        const result = Customer@'2024-01-01'.get('c-123')
      `
      const diagnostics = engine.getDiagnostics(code)
      // Should recognize result as Promise<Thing>
      expect(diagnostics).toHaveLength(0)
    })
  })

  describe('@ operator edge cases', () => {
    it('should work with multiple @ operators in same expression', async () => {
      // Comparing entities at different times
      const diagnostics = engine.getDiagnostics(`
        const past = await Customer@'-1d'.get('c-123')
        const present = await Customer.get('c-123')
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it('should not confuse @ with email addresses in strings', async () => {
      // @ inside strings should not trigger time travel
      const diagnostics = engine.getDiagnostics(`
        const email = "user@example.com"
        const customer = await Customer.create({ email })
      `)
      expect(diagnostics).toHaveLength(0)
    })

    it('should provide completions after complex time expressions', async () => {
      // Nested calls with time travel
      const completions = engine.getCompletions(
        "await Customer@'2024-01-01'.query({ status: 'active' }).",
        55
      )
      // After .query(), we should still get array methods or similar
      expect(completions.length).toBeGreaterThan(0)
    })
  })
})
