/**
 * Dot Trigger Completions Tests
 *
 * Tests for automatic completion triggering on dot (.) character.
 * RED PHASE: These tests define the expected behavior for dot-triggered completions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  CompletionEngine,
  shouldShowCompletions,
  type CompletionContext,
  type CompletionItem,
} from '../src/completions.js'

describe('Dot trigger completions', () => {
  let engine: CompletionEngine

  beforeEach(() => {
    engine = new CompletionEngine()
  })

  afterEach(() => {
    engine.dispose()
  })

  describe('auto-show on dot', () => {
    it('should auto-show completions when typing dot after identifier', async () => {
      // After typing "Customer.", completions should auto-appear
      const completions = engine.getCompletions('Customer.', 9)
      expect(completions.length).toBeGreaterThan(0)
    })

    it('should show $ context completions after typing $. ', () => {
      const completions = engine.getCompletions('$.', 2)
      expect(completions.length).toBeGreaterThan(0)
      expect(completions).toContainEqual(expect.objectContaining({ name: 'send' }))
      expect(completions).toContainEqual(expect.objectContaining({ name: 'try' }))
      expect(completions).toContainEqual(expect.objectContaining({ name: 'do' }))
    })

    it('should show method completions with create method present', () => {
      // Add a type definition for Customer
      engine.updateTypeDefinitions('domain', `
interface Customer {
  create(data: { name: string }): Promise<Customer>;
  get(id: string): Promise<Customer>;
  update(id: string, data: Partial<Customer>): Promise<Customer>;
  delete(id: string): Promise<void>;
  name: string;
  $id: string;
}
declare const Customer: Customer;
`)
      const completions = engine.getCompletions('Customer.', 9)
      expect(completions.length).toBeGreaterThan(0)
      expect(completions).toContainEqual(expect.objectContaining({ name: 'create' }))
    })
  })

  describe('shouldShowCompletions with context', () => {
    it('should trigger completions on . character', () => {
      const context: CompletionContext = {
        triggerCharacter: '.',
        isExplicit: false,
        currentWord: '',
        line: 0,
        column: 9,
      }
      const result = shouldShowCompletions('Customer.', context)
      expect(result).toBe(true)
    })

    it('should trigger on chained dots', () => {
      const context: CompletionContext = {
        triggerCharacter: '.',
        isExplicit: false,
        currentWord: '',
        line: 0,
        column: 19,
      }
      const result = shouldShowCompletions('Customer.get("id").', context)
      expect(result).toBe(true)
    })

    it('should not trigger on . in string literals', () => {
      const context: CompletionContext = {
        triggerCharacter: '.',
        isExplicit: false,
        currentWord: '',
        line: 0,
        column: 8,
      }
      const result = shouldShowCompletions('"foo.bar"', context)
      expect(result).toBe(false)
    })

    it('should trigger on $ prefix', () => {
      const context: CompletionContext = {
        triggerCharacter: '.',
        isExplicit: false,
        currentWord: '',
        line: 0,
        column: 2,
      }
      const result = shouldShowCompletions('$.', context)
      expect(result).toBe(true)
    })

    it('should not trigger on . after number literal', () => {
      const context: CompletionContext = {
        triggerCharacter: '.',
        isExplicit: false,
        currentWord: '',
        line: 0,
        column: 4,
      }
      // "123." could be start of float or method call - should NOT trigger completions
      const result = shouldShowCompletions('123.', context)
      expect(result).toBe(false)
    })
  })

  describe('method completions after opening paren', () => {
    it('should show parameter hints after opening paren', () => {
      // "Customer.create(" should show parameter hints
      engine.updateTypeDefinitions('domain', `
interface Customer {
  create(data: { name: string; email: string }): Promise<Customer>;
  name: string;
}
declare const Customer: Customer;
`)
      const signatureHelp = engine.getSignatureHelp('Customer.create(', 16)
      expect(signatureHelp).toBeDefined()
      expect(signatureHelp?.items.length).toBeGreaterThan(0)
    })

    it('should show available arguments inside function call', () => {
      engine.updateTypeDefinitions('domain', `
interface Customer {
  charge(amount: number, currency?: string): Promise<Receipt>;
}
interface Receipt { id: string; amount: number }
declare const customer: Customer;
`)
      // Inside the paren, should get completion suggestions for first argument
      const completions = engine.getCompletions('customer.charge(', 16)
      // Should at least have global completions available
      expect(completions).toBeDefined()
    })
  })

  describe('nested property completions', () => {
    it('should complete nested properties after method call', () => {
      // "customer.profile." should show profile properties after getting customer instance
      engine.updateTypeDefinitions('domain', `
interface Profile {
  avatar: string;
  bio: string;
  settings: Settings;
}
interface Settings {
  theme: string;
  notifications: boolean;
}
interface CustomerInstance {
  profile: Profile;
  orders: Order[];
}
interface Order { id: string; total: number }
declare const customer: CustomerInstance;
`)
      const completions = engine.getCompletions('customer.profile.', 17)
      expect(completions.length).toBeGreaterThan(0)
      expect(completions).toContainEqual(expect.objectContaining({ name: 'avatar' }))
      expect(completions).toContainEqual(expect.objectContaining({ name: 'bio' }))
      expect(completions).toContainEqual(expect.objectContaining({ name: 'settings' }))
    })

    it('should complete deeply nested properties', () => {
      engine.updateTypeDefinitions('domain', `
interface User {
  profile: {
    settings: {
      theme: string;
      language: string;
    };
  };
}
declare const user: User;
`)
      const completions = engine.getCompletions('user.profile.settings.', 22)
      expect(completions.length).toBeGreaterThan(0)
      expect(completions).toContainEqual(expect.objectContaining({ name: 'theme' }))
      expect(completions).toContainEqual(expect.objectContaining({ name: 'language' }))
    })

    it('should complete array method properties', () => {
      engine.updateTypeDefinitions('domain', `
interface Order { id: string; total: number }
declare const orders: Order[];
`)
      const completions = engine.getCompletions('orders.', 7)
      expect(completions.length).toBeGreaterThan(0)
      // Should have array methods
      expect(completions).toContainEqual(expect.objectContaining({ name: 'filter' }))
      expect(completions).toContainEqual(expect.objectContaining({ name: 'map' }))
      expect(completions).toContainEqual(expect.objectContaining({ name: 'reduce' }))
    })
  })

  describe('edge cases', () => {
    it('should not trigger completions inside comments', () => {
      const context: CompletionContext = {
        triggerCharacter: '.',
        isExplicit: false,
        currentWord: '',
        line: 0,
        column: 15,
      }
      const result = shouldShowCompletions('// Customer.', context)
      expect(result).toBe(false)
    })

    it('should not trigger completions after spread operator', () => {
      const context: CompletionContext = {
        triggerCharacter: '.',
        isExplicit: false,
        currentWord: '',
        line: 0,
        column: 4,
      }
      // "..." is spread, not property access
      const result = shouldShowCompletions('...', context)
      expect(result).toBe(false)
    })

    it('should handle optional chaining trigger', () => {
      const context: CompletionContext = {
        triggerCharacter: '.',
        isExplicit: false,
        currentWord: '',
        line: 0,
        column: 10,
      }
      // "customer?." should trigger completions
      const result = shouldShowCompletions('customer?.', context)
      expect(result).toBe(true)
    })

    it('should complete after await expression', () => {
      engine.updateTypeDefinitions('domain', `
interface Customer {
  fetch(): Promise<{ name: string; email: string }>;
}
declare const customer: Customer;
`)
      // After await, should complete the resolved type
      const completions = engine.getCompletions('(await customer.fetch()).', 25)
      expect(completions.length).toBeGreaterThan(0)
      expect(completions).toContainEqual(expect.objectContaining({ name: 'name' }))
      expect(completions).toContainEqual(expect.objectContaining({ name: 'email' }))
    })
  })

  describe('REPL integration scenarios', () => {
    it('should provide completions for workflow context $.on', () => {
      const completions = engine.getCompletions('$.on.', 5)
      expect(completions.length).toBeGreaterThan(0)
    })

    it('should provide completions for $.every scheduling', () => {
      const completions = engine.getCompletions('$.every.', 8)
      expect(completions.length).toBeGreaterThan(0)
      expect(completions).toContainEqual(expect.objectContaining({ name: 'Monday' }))
      expect(completions).toContainEqual(expect.objectContaining({ name: 'day' }))
      expect(completions).toContainEqual(expect.objectContaining({ name: 'hour' }))
    })

    it('should provide completions for chained schedule builder', () => {
      const completions = engine.getCompletions('$.every.Monday.', 15)
      expect(completions.length).toBeGreaterThan(0)
      expect(completions).toContainEqual(expect.objectContaining({ name: 'at9am' }))
      expect(completions).toContainEqual(expect.objectContaining({ name: 'at' }))
    })
  })
})
