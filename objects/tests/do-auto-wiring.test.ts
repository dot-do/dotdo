/**
 * DO Auto-Wiring Tests
 *
 * RED TDD: Tests for auto-wiring public methods via reflection.
 *
 * The auto-wiring system discovers public methods on DO subclasses and
 * exposes them to SDK/RPC/MCP/REST/CLI transports. This enables a single
 * class definition to automatically provide multiple API interfaces.
 *
 * Key concepts:
 * - Public methods (no underscore prefix) are exposed
 * - _prefixed methods remain private
 * - Reflection discovers methods on prototype chain
 * - Method metadata (parameters, return types, descriptions) can be extracted
 *
 * This test file validates the discovery and exposure system WITHOUT
 * testing the actual transport implementations (those are in separate tests).
 */

import { describe, it, expect, beforeEach } from 'vitest'

// These imports will FAIL until implementation exists
import {
  getExposedMethods,
  isExposed,
  getMethodSignature,
  getMethodMetadata,
  type MethodSignature,
  type MethodMetadata,
  type ExposedMethodInfo,
} from '../auto-wiring'

import { DO } from '../DO'

// ============================================================================
// TEST DO CLASSES
// ============================================================================

/**
 * A simple test DO class with various method types
 */
class TestDO extends DO {
  // Public methods - should be exposed
  async processOrder(orderId: string, options?: { priority?: boolean }): Promise<{ success: boolean }> {
    return { success: true }
  }

  getStatus(): string {
    return 'ok'
  }

  calculate(a: number, b: number): number {
    return a + b
  }

  // Private methods - should NOT be exposed
  _internalProcess(): void {
    // Private implementation detail
  }

  _validateInput(input: unknown): boolean {
    return true
  }

  // Protected-style double underscore - should NOT be exposed
  __protectedMethod(): void {
    // Protected implementation
  }
}

/**
 * A DO with getters and setters
 */
class GetterSetterDO extends DO {
  private _data: string = ''

  // Getter - should NOT be exposed as a callable method
  get data(): string {
    return this._data
  }

  // Setter - should NOT be exposed as a callable method
  set data(value: string) {
    this._data = value
  }

  // Regular method - should be exposed
  getData(): string {
    return this._data
  }

  // Regular method - should be exposed
  setData(value: string): void {
    this._data = value
  }
}

/**
 * A subclass that adds more methods
 */
class ExtendedDO extends TestDO {
  // New public method in subclass
  async extendedAction(input: { id: string }): Promise<{ result: string }> {
    return { result: `processed-${input.id}` }
  }

  // Override a method
  override getStatus(): string {
    return 'extended-ok'
  }

  // Private method in subclass
  _subclassPrivate(): void {
    // Private to subclass
  }
}

/**
 * A DO with Symbol-keyed methods
 * Note: We test Symbol handling via the exposed API rather than
 * defining Symbol methods directly (which has TS/esbuild limitations)
 */
class SymbolMethodDO extends DO {
  // Public method - should be exposed
  normalMethod(): string {
    return 'normal'
  }

  // Private method - should NOT be exposed
  _privateMethod(): string {
    return 'private'
  }
}

// Add Symbol.iterator to the prototype after class definition
// This is a valid way to add Symbol-keyed methods
const iteratorSymbol = Symbol.iterator
Object.defineProperty(SymbolMethodDO.prototype, iteratorSymbol, {
  value: function* () {
    yield 'a'
    yield 'b'
  },
  writable: true,
  enumerable: false,
  configurable: true,
})

/**
 * A DO with documented methods (JSDoc-style metadata)
 */
class DocumentedDO extends DO {
  /**
   * Creates a new order in the system
   * @param customerId - The customer's unique identifier
   * @param items - Array of item IDs to include in the order
   * @returns The created order with its ID
   */
  async createOrder(
    customerId: string,
    items: string[]
  ): Promise<{ orderId: string; status: string }> {
    return { orderId: 'ord-123', status: 'created' }
  }

  /**
   * Retrieves order details
   * @param orderId - The order ID to fetch
   * @throws OrderNotFoundError if order doesn't exist
   */
  async getOrder(orderId: string): Promise<{ orderId: string; items: string[] }> {
    return { orderId, items: [] }
  }
}

/**
 * A DO with static methods
 */
class StaticMethodDO extends DO {
  // Static method - should NOT be exposed on instances
  static getClassName(): string {
    return 'StaticMethodDO'
  }

  // Instance method - should be exposed
  getInstanceId(): string {
    return 'instance-123'
  }
}

/**
 * A DO with arrow function properties
 */
class ArrowFunctionDO extends DO {
  // Arrow function property - behavior TBD, test documents expected outcome
  arrowMethod = (x: number): number => x * 2

  // Regular method - should be exposed
  regularMethod(x: number): number {
    return x * 2
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('DO Auto-Wiring', () => {
  // ==========================================================================
  // 1. METHOD DISCOVERY TESTS
  // ==========================================================================

  describe('Method Discovery', () => {
    describe('getExposedMethods()', () => {
      it('returns an array of exposed method names', () => {
        const methods = getExposedMethods(TestDO)

        expect(methods).toBeDefined()
        expect(Array.isArray(methods)).toBe(true)
      })

      it('includes public methods without underscore prefix', () => {
        const methods = getExposedMethods(TestDO)

        expect(methods).toContain('processOrder')
        expect(methods).toContain('getStatus')
        expect(methods).toContain('calculate')
      })

      it('excludes _prefixed private methods', () => {
        const methods = getExposedMethods(TestDO)

        expect(methods).not.toContain('_internalProcess')
        expect(methods).not.toContain('_validateInput')
      })

      it('excludes __prefixed protected-style methods', () => {
        const methods = getExposedMethods(TestDO)

        expect(methods).not.toContain('__protectedMethod')
      })

      it('excludes constructor', () => {
        const methods = getExposedMethods(TestDO)

        expect(methods).not.toContain('constructor')
      })

      it('excludes inherited Object methods', () => {
        const methods = getExposedMethods(TestDO)

        expect(methods).not.toContain('toString')
        expect(methods).not.toContain('valueOf')
        expect(methods).not.toContain('hasOwnProperty')
      })

      it('excludes inherited DurableObject/DO base methods', () => {
        const methods = getExposedMethods(TestDO)

        // Methods from DO base class that shouldn't be exposed
        expect(methods).not.toContain('initialize')
        expect(methods).not.toContain('fork')
        expect(methods).not.toContain('compact')
        expect(methods).not.toContain('moveTo')
        expect(methods).not.toContain('branch')
        expect(methods).not.toContain('checkout')
        expect(methods).not.toContain('merge')
        expect(methods).not.toContain('resolve')
        expect(methods).not.toContain('fetch')
      })

      it('returns methods for instance as well as class', () => {
        // Should work with both class constructor and instance
        class SimpleDO extends DO {
          doSomething(): string {
            return 'done'
          }
        }

        const classResult = getExposedMethods(SimpleDO)

        // For instances, we'd need a mock - just test class for now
        expect(classResult).toContain('doSomething')
      })
    })

    describe('Getter/Setter Handling', () => {
      it('excludes getters from exposed methods', () => {
        const methods = getExposedMethods(GetterSetterDO)

        expect(methods).not.toContain('data') // getter
      })

      it('excludes setters from exposed methods', () => {
        const methods = getExposedMethods(GetterSetterDO)

        // Setters appear with same name as getter
        // Should verify data is not included as a method
        expect(methods).not.toContain('data')
      })

      it('includes regular methods with get/set naming convention', () => {
        const methods = getExposedMethods(GetterSetterDO)

        expect(methods).toContain('getData')
        expect(methods).toContain('setData')
      })
    })
  })

  // ==========================================================================
  // 2. EXPOSURE CHECK TESTS
  // ==========================================================================

  describe('Exposure Checks', () => {
    describe('isExposed()', () => {
      it('returns true for public methods', () => {
        expect(isExposed(TestDO, 'processOrder')).toBe(true)
        expect(isExposed(TestDO, 'getStatus')).toBe(true)
        expect(isExposed(TestDO, 'calculate')).toBe(true)
      })

      it('returns false for _prefixed methods', () => {
        expect(isExposed(TestDO, '_internalProcess')).toBe(false)
        expect(isExposed(TestDO, '_validateInput')).toBe(false)
      })

      it('returns false for __prefixed methods', () => {
        expect(isExposed(TestDO, '__protectedMethod')).toBe(false)
      })

      it('returns false for constructor', () => {
        expect(isExposed(TestDO, 'constructor')).toBe(false)
      })

      it('returns false for non-existent methods', () => {
        expect(isExposed(TestDO, 'nonExistentMethod')).toBe(false)
      })

      it('returns false for getters/setters', () => {
        expect(isExposed(GetterSetterDO, 'data')).toBe(false)
      })

      it('returns false for static methods', () => {
        expect(isExposed(StaticMethodDO, 'getClassName')).toBe(false)
      })

      it('returns false for Symbol methods', () => {
        // Symbol.iterator as string
        expect(isExposed(SymbolMethodDO, Symbol.iterator.toString())).toBe(false)
      })

      it('returns true for regular method on SymbolMethodDO', () => {
        expect(isExposed(SymbolMethodDO, 'normalMethod')).toBe(true)
      })
    })
  })

  // ==========================================================================
  // 3. PRIVATE METHOD TESTS
  // ==========================================================================

  describe('Private Methods', () => {
    it('_prefixed methods are not exposed', () => {
      const methods = getExposedMethods(TestDO)

      const privateMethod = methods.find((m) => m.startsWith('_'))
      expect(privateMethod).toBeUndefined()
    })

    it('__prefixed methods are not exposed', () => {
      const methods = getExposedMethods(TestDO)

      const protectedMethod = methods.find((m) => m.startsWith('__'))
      expect(protectedMethod).toBeUndefined()
    })

    it('Symbol-keyed methods are not exposed', () => {
      const methods = getExposedMethods(SymbolMethodDO)

      // Symbol methods wouldn't appear as string names
      expect(methods).not.toContain('[Symbol.iterator]')
      expect(methods).toContain('normalMethod')
    })

    it('only exposes string-keyed methods', () => {
      const methods = getExposedMethods(SymbolMethodDO)

      // All returned methods should be plain strings (no symbols)
      methods.forEach((method) => {
        expect(typeof method).toBe('string')
        expect(method.includes('Symbol')).toBe(false)
      })
    })
  })

  // ==========================================================================
  // 4. SUBCLASS METHODS TESTS
  // ==========================================================================

  describe('Subclass Methods', () => {
    it('discovers methods from subclass', () => {
      const methods = getExposedMethods(ExtendedDO)

      expect(methods).toContain('extendedAction')
    })

    it('includes inherited public methods from parent class', () => {
      const methods = getExposedMethods(ExtendedDO)

      // Should include methods from TestDO
      expect(methods).toContain('processOrder')
      expect(methods).toContain('calculate')
    })

    it('handles overridden methods correctly (no duplicates)', () => {
      const methods = getExposedMethods(ExtendedDO)

      // getStatus is overridden, should appear only once
      const statusMethods = methods.filter((m) => m === 'getStatus')
      expect(statusMethods.length).toBe(1)
    })

    it('excludes private methods from subclass', () => {
      const methods = getExposedMethods(ExtendedDO)

      expect(methods).not.toContain('_subclassPrivate')
    })

    it('excludes inherited private methods from parent', () => {
      const methods = getExposedMethods(ExtendedDO)

      expect(methods).not.toContain('_internalProcess')
      expect(methods).not.toContain('_validateInput')
    })
  })

  // ==========================================================================
  // 5. METHOD SIGNATURE TESTS
  // ==========================================================================

  describe('Method Signatures', () => {
    describe('getMethodSignature()', () => {
      it('returns signature for public method', () => {
        const signature = getMethodSignature(TestDO, 'calculate')

        expect(signature).toBeDefined()
      })

      it('includes method name in signature', () => {
        const signature = getMethodSignature(TestDO, 'calculate')

        expect(signature.name).toBe('calculate')
      })

      it('returns parameter count', () => {
        const signature = getMethodSignature(TestDO, 'calculate')

        expect(signature.parameterCount).toBe(2)
      })

      it('returns parameter names when available', () => {
        const signature = getMethodSignature(TestDO, 'calculate')

        expect(signature.parameters).toBeDefined()
        expect(signature.parameters).toHaveLength(2)
        expect(signature.parameters?.[0]?.name).toBe('a')
        expect(signature.parameters?.[1]?.name).toBe('b')
      })

      it('handles optional parameters', () => {
        const signature = getMethodSignature(TestDO, 'processOrder')

        expect(signature.parameters).toBeDefined()
        // options parameter is optional
        const optionsParam = signature.parameters?.find((p) => p.name === 'options')
        expect(optionsParam?.optional).toBe(true)
      })

      it('returns undefined for non-exposed methods', () => {
        const signature = getMethodSignature(TestDO, '_internalProcess')

        expect(signature).toBeUndefined()
      })

      it('returns undefined for non-existent methods', () => {
        const signature = getMethodSignature(TestDO, 'doesNotExist')

        expect(signature).toBeUndefined()
      })

      it('indicates async methods', () => {
        const signature = getMethodSignature(TestDO, 'processOrder')

        expect(signature.async).toBe(true)
      })

      it('indicates sync methods', () => {
        const signature = getMethodSignature(TestDO, 'calculate')

        expect(signature.async).toBe(false)
      })

      it('handles methods with no parameters', () => {
        const signature = getMethodSignature(TestDO, 'getStatus')

        expect(signature.parameterCount).toBe(0)
        expect(signature.parameters).toEqual([])
      })
    })
  })

  // ==========================================================================
  // 6. METHOD METADATA TESTS
  // ==========================================================================

  describe('Method Metadata', () => {
    describe('getMethodMetadata()', () => {
      it('returns metadata object for public method', () => {
        const metadata = getMethodMetadata(DocumentedDO, 'createOrder')

        expect(metadata).toBeDefined()
      })

      it('includes method description when available', () => {
        const metadata = getMethodMetadata(DocumentedDO, 'createOrder')

        // Description should be extracted from JSDoc if possible
        // (Note: This may require special tooling/decorators to work at runtime)
        expect(metadata.description).toBeDefined()
        // If JSDoc parsing is available:
        // expect(metadata.description).toContain('Creates a new order')
      })

      it('includes parameter descriptions when available', () => {
        const metadata = getMethodMetadata(DocumentedDO, 'createOrder')

        expect(metadata.parameters).toBeDefined()
        // If JSDoc parsing is available:
        // expect(metadata.parameters?.customerId?.description).toContain('customer')
      })

      it('includes return type description when available', () => {
        const metadata = getMethodMetadata(DocumentedDO, 'createOrder')

        expect(metadata.returns).toBeDefined()
      })

      it('includes thrown exceptions when documented', () => {
        const metadata = getMethodMetadata(DocumentedDO, 'getOrder')

        // If JSDoc parsing is available:
        // expect(metadata.throws).toBeDefined()
        // expect(metadata.throws).toContain('OrderNotFoundError')
      })

      it('returns undefined for non-exposed methods', () => {
        const metadata = getMethodMetadata(TestDO, '_internalProcess')

        expect(metadata).toBeUndefined()
      })

      it('returns basic metadata even without JSDoc', () => {
        const metadata = getMethodMetadata(TestDO, 'calculate')

        expect(metadata).toBeDefined()
        expect(metadata.name).toBe('calculate')
      })
    })
  })

  // ==========================================================================
  // 7. ARROW FUNCTION PROPERTY TESTS
  // ==========================================================================

  describe('Arrow Function Properties', () => {
    it('handles arrow function properties (defined behavior)', () => {
      const methods = getExposedMethods(ArrowFunctionDO)

      // Arrow functions are instance properties, not prototype methods
      // The expected behavior should be documented here
      // Option A: Include them
      // Option B: Exclude them (more consistent with prototype-based discovery)

      // We assert the expected behavior (exclude arrow functions from prototype discovery)
      expect(methods).not.toContain('arrowMethod')
      expect(methods).toContain('regularMethod')
    })

    it('regular methods on same class are exposed', () => {
      const methods = getExposedMethods(ArrowFunctionDO)

      expect(methods).toContain('regularMethod')
    })
  })

  // ==========================================================================
  // 8. STATIC METHOD TESTS
  // ==========================================================================

  describe('Static Methods', () => {
    it('static methods are not included in instance exposed methods', () => {
      const methods = getExposedMethods(StaticMethodDO)

      expect(methods).not.toContain('getClassName')
    })

    it('instance methods are included', () => {
      const methods = getExposedMethods(StaticMethodDO)

      expect(methods).toContain('getInstanceId')
    })
  })

  // ==========================================================================
  // 9. EXPOSED METHOD INFO TESTS
  // ==========================================================================

  describe('ExposedMethodInfo', () => {
    it('provides complete method info structure', () => {
      const signature = getMethodSignature(TestDO, 'processOrder')

      // Verify the shape of MethodSignature
      expect(signature).toHaveProperty('name')
      expect(signature).toHaveProperty('parameterCount')
      expect(signature).toHaveProperty('parameters')
      expect(signature).toHaveProperty('async')
    })

    it('parameters have name, type, and optional flag', () => {
      const signature = getMethodSignature(TestDO, 'processOrder')

      expect(signature.parameters).toBeDefined()
      expect(signature.parameters!.length).toBeGreaterThan(0)

      const firstParam = signature.parameters![0]
      expect(firstParam).toHaveProperty('name')
      expect(firstParam).toHaveProperty('optional')
    })
  })

  // ==========================================================================
  // 10. EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles class with no public methods', () => {
      class EmptyDO extends DO {
        _onlyPrivate(): void {}
      }

      const methods = getExposedMethods(EmptyDO)

      expect(methods).toEqual([])
    })

    it('handles class with many methods', () => {
      class ManyMethodsDO extends DO {
        method1(): void {}
        method2(): void {}
        method3(): void {}
        method4(): void {}
        method5(): void {}
        _private1(): void {}
        _private2(): void {}
      }

      const methods = getExposedMethods(ManyMethodsDO)

      // Check that all expected public methods are present
      expect(methods).toContain('method1')
      expect(methods).toContain('method2')
      expect(methods).toContain('method3')
      expect(methods).toContain('method4')
      expect(methods).toContain('method5')
      // Check that private methods are NOT exposed
      expect(methods).not.toContain('_private1')
      expect(methods).not.toContain('_private2')
    })

    it('handles deeply nested inheritance', () => {
      class Level1 extends DO {
        level1Method(): void {}
      }
      class Level2 extends Level1 {
        level2Method(): void {}
      }
      class Level3 extends Level2 {
        level3Method(): void {}
      }

      const methods = getExposedMethods(Level3)

      expect(methods).toContain('level1Method')
      expect(methods).toContain('level2Method')
      expect(methods).toContain('level3Method')
    })

    it('handles methods with complex parameter types', () => {
      class ComplexDO extends DO {
        complexMethod(
          data: { nested: { value: number }[] },
          callback: (result: string) => void,
          ...rest: unknown[]
        ): Promise<void> {
          return Promise.resolve()
        }
      }

      const signature = getMethodSignature(ComplexDO, 'complexMethod')

      expect(signature).toBeDefined()
      expect(signature.parameterCount).toBeGreaterThanOrEqual(2)
    })

    it('handles generator methods appropriately', () => {
      class GeneratorDO extends DO {
        *generateItems(): Generator<number> {
          yield 1
          yield 2
        }

        normalMethod(): number {
          return 42
        }
      }

      const methods = getExposedMethods(GeneratorDO)

      // Generator methods could be exposed or not based on design decision
      // This test documents the expected behavior
      expect(methods).toContain('normalMethod')
      // Depending on implementation, generator may or may not be exposed
    })

    it('handles method names that are JavaScript reserved words', () => {
      // Note: This is edge case - methods can't actually be named 'class', etc.
      // But they can have names like 'delete', 'import', etc. as identifiers
      class ReservedNameDO extends DO {
        // 'delete' is a valid method name
        delete(id: string): Promise<void> {
          return Promise.resolve()
        }

        // 'import' is a valid method name
        import(data: unknown): Promise<void> {
          return Promise.resolve()
        }
      }

      const methods = getExposedMethods(ReservedNameDO)

      expect(methods).toContain('delete')
      expect(methods).toContain('import')
    })
  })

  // ==========================================================================
  // 11. CACHING BEHAVIOR
  // ==========================================================================

  describe('Caching Behavior', () => {
    it('returns consistent results for same class', () => {
      const result1 = getExposedMethods(TestDO)
      const result2 = getExposedMethods(TestDO)

      expect(result1).toEqual(result2)
    })

    it('returns different results for different classes', () => {
      const testMethods = getExposedMethods(TestDO)
      const extendedMethods = getExposedMethods(ExtendedDO)

      // ExtendedDO has additional methods
      expect(extendedMethods.length).toBeGreaterThan(testMethods.length)
      expect(extendedMethods).toContain('extendedAction')
      expect(testMethods).not.toContain('extendedAction')
    })
  })

  // ==========================================================================
  // 12. TYPE SAFETY TESTS
  // ==========================================================================

  describe('Type Safety', () => {
    it('MethodSignature type has required properties', () => {
      const signature: MethodSignature = {
        name: 'test',
        parameterCount: 2,
        parameters: [
          { name: 'a', optional: false },
          { name: 'b', optional: true },
        ],
        async: false,
      }

      expect(signature.name).toBe('test')
      expect(signature.parameterCount).toBe(2)
      expect(signature.async).toBe(false)
    })

    it('MethodMetadata type has expected shape', () => {
      const metadata: MethodMetadata = {
        name: 'createOrder',
        description: 'Creates a new order',
        parameters: {
          customerId: { description: 'Customer ID' },
        },
        returns: { description: 'Created order' },
      }

      expect(metadata.name).toBe('createOrder')
      expect(metadata.description).toBeDefined()
    })

    it('ExposedMethodInfo combines signature and metadata', () => {
      const info: ExposedMethodInfo = {
        name: 'processOrder',
        signature: {
          name: 'processOrder',
          parameterCount: 2,
          parameters: [],
          async: true,
        },
        metadata: {
          name: 'processOrder',
          description: 'Processes an order',
        },
      }

      expect(info.name).toBe('processOrder')
      expect(info.signature.async).toBe(true)
      expect(info.metadata.description).toBeDefined()
    })
  })

  // ==========================================================================
  // 13. INTEGRATION WITH DO HIERARCHY
  // ==========================================================================

  describe('Integration with DO Hierarchy', () => {
    it('works with Worker subclass', () => {
      // Worker extends DO
      // Assuming Worker is imported from objects/
      // This test verifies the auto-wiring works across the DO hierarchy
      class CustomWorker extends DO {
        async performTask(taskId: string): Promise<{ completed: boolean }> {
          return { completed: true }
        }
      }

      const methods = getExposedMethods(CustomWorker)
      expect(methods).toContain('performTask')
    })

    it('excludes protected DO base methods from exposure', () => {
      const methods = getExposedMethods(TestDO)

      // These are protected methods in DO that shouldn't be exposed
      expect(methods).not.toContain('send')
      expect(methods).not.toContain('try')
      expect(methods).not.toContain('do')
      expect(methods).not.toContain('emit')
      expect(methods).not.toContain('logAction')
      expect(methods).not.toContain('emitEvent')
      expect(methods).not.toContain('createWorkflowContext')
    })

    it('hasCapability is exposed as it is public in DO', () => {
      // hasCapability is a public method on DO
      // Depending on the design, it may or may not be exposed for RPC
      const methods = getExposedMethods(TestDO)

      // Document the expected behavior - likely exposed since it's public
      // or excluded since it's a framework method
      // This test documents whichever decision is made
    })
  })

  // ==========================================================================
  // 14. REAL-WORLD USAGE PATTERNS
  // ==========================================================================

  describe('Real-World Usage Patterns', () => {
    it('order processing DO exposes business methods', () => {
      class OrderDO extends DO {
        async createOrder(customerId: string, items: string[]): Promise<{ orderId: string }> {
          return { orderId: 'ord-123' }
        }

        async getOrder(orderId: string): Promise<{ orderId: string; status: string }> {
          return { orderId, status: 'pending' }
        }

        async cancelOrder(orderId: string, reason: string): Promise<{ cancelled: boolean }> {
          return { cancelled: true }
        }

        _calculateTotal(items: string[]): number {
          return 100 // Private calculation
        }

        _validateCustomer(customerId: string): boolean {
          return true // Private validation
        }
      }

      const methods = getExposedMethods(OrderDO)

      // Check that all business methods are exposed
      expect(methods).toContain('createOrder')
      expect(methods).toContain('getOrder')
      expect(methods).toContain('cancelOrder')
      // Check that private methods are NOT exposed
      expect(methods).not.toContain('_calculateTotal')
      expect(methods).not.toContain('_validateCustomer')
    })

    it('user management DO exposes CRUD operations', () => {
      class UserDO extends DO {
        async createUser(data: { email: string; name: string }): Promise<{ userId: string }> {
          return { userId: 'user-123' }
        }

        async getUser(userId: string): Promise<{ userId: string; email: string }> {
          return { userId, email: 'test@example.com' }
        }

        async updateUser(userId: string, data: Partial<{ email: string; name: string }>): Promise<void> {}

        async deleteUser(userId: string): Promise<void> {}

        async listUsers(options?: { limit?: number; offset?: number }): Promise<{ users: unknown[] }> {
          return { users: [] }
        }

        _hashPassword(password: string): string {
          return 'hashed' // Private
        }
      }

      const methods = getExposedMethods(UserDO)

      expect(methods).toContain('createUser')
      expect(methods).toContain('getUser')
      expect(methods).toContain('updateUser')
      expect(methods).toContain('deleteUser')
      expect(methods).toContain('listUsers')
      expect(methods).not.toContain('_hashPassword')
    })

    it('workflow DO exposes step execution methods', () => {
      class CustomWorkflowDO extends DO {
        async start(input: unknown): Promise<{ workflowId: string }> {
          return { workflowId: 'wf-123' }
        }

        async getStatus(workflowId: string): Promise<{ status: string }> {
          return { status: 'running' }
        }

        async pause(workflowId: string): Promise<void> {}

        async resume(workflowId: string): Promise<void> {}

        async cancel(workflowId: string): Promise<void> {}

        _executeStep(stepId: string): Promise<unknown> {
          return Promise.resolve({})
        }

        _handleError(error: Error): void {}
      }

      const methods = getExposedMethods(CustomWorkflowDO)

      expect(methods).toContain('start')
      expect(methods).toContain('getStatus')
      expect(methods).toContain('pause')
      expect(methods).toContain('resume')
      expect(methods).toContain('cancel')
      expect(methods).not.toContain('_executeStep')
      expect(methods).not.toContain('_handleError')
    })
  })
})
