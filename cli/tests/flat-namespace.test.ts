/**
 * Flat Namespace Completions Tests (RED phase)
 *
 * Tests that Nouns and DO helpers should be accessible without `$.` prefix:
 * - `Customer.get("id")` should work same as `$.Customer.get("id")`
 * - All DO types on globalThis for clean AI code generation
 *
 * These tests are expected to FAIL until flat namespace support is implemented
 * in the CompletionEngine's core type definitions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { CompletionEngine, filterCompletions } from '../src/completions.js'

describe('flat namespace completions', () => {
  let engine: CompletionEngine

  beforeEach(() => {
    engine = new CompletionEngine()
  })

  afterEach(() => {
    engine.dispose()
  })

  describe('DO nouns without $ prefix', () => {
    it('should provide Customer completions without $ prefix', () => {
      const completions = engine.getCompletions('Customer.', 9)
      expect(completions.map(c => c.name)).toContain('get')
    })

    it('should provide Order completions without $ prefix', () => {
      const completions = engine.getCompletions('Order.', 6)
      expect(completions.map(c => c.name)).toContain('list')
    })

    it('should provide Thing completions without $ prefix', () => {
      const completions = engine.getCompletions('Thing.', 6)
      expect(completions.map(c => c.name)).toContain('create')
    })

    it('should support arbitrary noun access like User without $ prefix', () => {
      const completions = engine.getCompletions('User.', 5)
      // Any noun should have standard CRUD methods via Proxy
      expect(completions.map(c => c.name)).toContain('get')
    })
  })

  describe('event handlers without $ prefix', () => {
    it('should provide on without $ prefix', () => {
      const completions = engine.getCompletions('on.', 3)
      expect(completions.length).toBeGreaterThan(0)
    })

    it('should provide on.Customer without $ prefix', () => {
      const completions = engine.getCompletions('on.Customer.', 12)
      expect(completions.length).toBeGreaterThan(0)
    })

    it('should have same completions as $ prefix version for on', () => {
      const withDollar = engine.getCompletions('$.on.', 5)
      const withoutDollar = engine.getCompletions('on.', 3)
      expect(withoutDollar.map(c => c.name)).toEqual(withDollar.map(c => c.name))
    })
  })

  describe('scheduling without $ prefix', () => {
    it('should provide every without $ prefix', () => {
      const completions = engine.getCompletions('every.', 6)
      expect(completions.map(c => c.name)).toContain('Monday')
    })

    it('should provide every.day without $ prefix', () => {
      const completions = engine.getCompletions('every.day.', 10)
      expect(completions.map(c => c.name)).toContain('at')
    })

    it('should have same completions as $ prefix version for every', () => {
      const withDollar = engine.getCompletions('$.every.', 8)
      const withoutDollar = engine.getCompletions('every.', 6)
      expect(withoutDollar.map(c => c.name)).toEqual(withDollar.map(c => c.name))
    })

    it('should provide every.Monday.at9am without $ prefix', () => {
      const completions = engine.getCompletions('every.Monday.', 13)
      expect(completions.map(c => c.name)).toContain('at9am')
    })
  })

  describe('durability primitives without $ prefix', () => {
    it('should provide send without $ prefix', () => {
      // send should be a callable function at global scope
      const allCompletions = engine.getCompletions('sen', 3)
      expect(allCompletions.map(c => c.name)).toContain('send')
    })

    it('should provide do without $ prefix', () => {
      // 'do' is a reserved keyword in JS, but we need it as a function
      // This might require special handling or an alias like doAction
      const allCompletions = engine.getCompletions('d', 1)
      const names = allCompletions.map(c => c.name)
      // At minimum, doAction or similar should work
      expect(names.some(n => n.startsWith('do'))).toBe(true)
    })

    it('should provide try as tryAction without $ prefix', () => {
      // 'try' is also a reserved keyword, may need alias like tryAction
      const completions = engine.getCompletions('try', 3)
      const names = completions.map(c => c.name)
      // Should have try-related function
      expect(names.some(n => n.includes('try') || n === 'tryAction')).toBe(true)
    })
  })

  describe('parity with $ prefix', () => {
    it('Customer. should have same methods as $.Customer.', () => {
      // Both should provide the same DO proxy interface
      const withDollar = engine.getCompletions('$.Customer.', 11)
      const withoutDollar = engine.getCompletions('Customer.', 9)

      // Filter to method completions only (not inherited Object methods)
      const dollarMethods = withDollar.map(c => c.name)
      const flatMethods = withoutDollar.map(c => c.name)

      // At minimum, both should have some methods
      expect(dollarMethods.length).toBeGreaterThan(0)
      expect(flatMethods.length).toBeGreaterThan(0)

      // They should be equivalent
      expect(flatMethods).toEqual(dollarMethods)
    })

    it('on.Order.placed should work same as $.on.Order.placed', () => {
      // Deep property access should work identically
      const withDollar = engine.getCompletions('$.on.Order.placed', 17)
      const withoutDollar = engine.getCompletions('on.Order.placed', 15)

      // Both should recognize this as a valid handler registration
      expect(withDollar).toBeDefined()
      expect(withoutDollar).toBeDefined()
    })
  })

  describe('type inference', () => {
    it('should infer Customer as a DO type proxy', () => {
      // Getting quick info should show it's a DO proxy type
      const info = engine.getQuickInfo('Customer', 4)
      expect(info).toBeDefined()
      // Should indicate it's a DO/Thing type, not undefined
      expect(info).not.toContain('undefined')
    })

    it('should infer on as EventHandlerProxy', () => {
      const info = engine.getQuickInfo('on', 2)
      expect(info).toBeDefined()
      expect(info).toContain('EventHandlerProxy')
    })

    it('should infer every as ScheduleBuilder', () => {
      const info = engine.getQuickInfo('every', 5)
      expect(info).toBeDefined()
      expect(info).toContain('ScheduleBuilder')
    })
  })

  describe('no diagnostics for flat namespace usage', () => {
    it('should not report errors for Customer.get usage', () => {
      const diagnostics = engine.getDiagnostics('Customer.get("cust-123")')
      expect(diagnostics.length).toBe(0)
    })

    it('should not report errors for on.Customer.signup usage', () => {
      const diagnostics = engine.getDiagnostics('on.Customer.signup(() => {})')
      expect(diagnostics.length).toBe(0)
    })

    it('should not report errors for every.Monday.at9am usage', () => {
      const diagnostics = engine.getDiagnostics('every.Monday.at9am(() => {})')
      expect(diagnostics.length).toBe(0)
    })

    it('should not report errors for send usage', () => {
      const diagnostics = engine.getDiagnostics('send({ $type: "CustomerCreated", customerId: "123" })')
      expect(diagnostics.length).toBe(0)
    })
  })
})
