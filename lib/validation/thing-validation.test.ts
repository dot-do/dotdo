/**
 * Thing Validation Tests
 *
 * Tests for Thing creation schema validation to ensure data integrity.
 *
 * @module lib/validation/thing-validation.test
 */

import { describe, it, expect } from 'vitest'
import {
  validateCreateThingInput,
  validateThingData,
  validateType,
  assertValidCreateThingInput,
  ThingValidationError,
  ThingValidationException, // Deprecated alias - testing backward compat
  isValidCreateThingInput,
  isValidType,
  createThingInputSchema,
  thingTypeSchema,
} from './thing-validation'

// ============================================================================
// $type Validation Tests
// ============================================================================

describe('$type validation', () => {
  describe('valid PascalCase types', () => {
    it.each([
      'Customer',
      'Order',
      'ProductItem',
      'A',
      'ABC',
      'Customer123',
      'Item1',
    ])('should accept valid type: %s', (type) => {
      expect(validateType(type)).toBe(true)
      expect(isValidType(type)).toBe(true)
    })
  })

  describe('invalid types', () => {
    it('should reject empty string', () => {
      const result = validateType('')
      expect(result).not.toBe(true)
      expect(result).toContain('empty')
    })

    it('should reject lowercase start', () => {
      const result = validateType('customer')
      expect(result).not.toBe(true)
      expect(result).toContain('PascalCase')
    })

    it('should reject camelCase', () => {
      const result = validateType('productItem')
      expect(result).not.toBe(true)
      expect(result).toContain('PascalCase')
    })

    it('should reject snake_case', () => {
      const result = validateType('product_item')
      expect(result).not.toBe(true)
      expect(result).toContain('PascalCase')
    })

    it('should reject kebab-case', () => {
      const result = validateType('product-item')
      expect(result).not.toBe(true)
      expect(result).toContain('PascalCase')
    })

    it('should reject types starting with number', () => {
      const result = validateType('1Customer')
      expect(result).not.toBe(true)
      expect(result).toContain('PascalCase')
    })

    it('should reject types with spaces', () => {
      const result = validateType('Product Item')
      expect(result).not.toBe(true)
      expect(result).toContain('PascalCase')
    })

    it('should reject types with special characters', () => {
      const result = validateType('Product@Item')
      expect(result).not.toBe(true)
      expect(result).toContain('PascalCase')
    })

    it('should reject null', () => {
      expect(isValidType(null)).toBe(false)
    })

    it('should reject undefined', () => {
      expect(isValidType(undefined)).toBe(false)
    })

    it('should reject numbers', () => {
      expect(isValidType(123)).toBe(false)
    })

    it('should reject objects', () => {
      expect(isValidType({ type: 'Customer' })).toBe(false)
    })
  })
})

// ============================================================================
// createThingInput Validation Tests
// ============================================================================

describe('validateCreateThingInput', () => {
  describe('valid inputs', () => {
    it('should accept valid input with $type only', () => {
      const result = validateCreateThingInput({ $type: 'Customer' })
      expect(result.success).toBe(true)
      expect(result.data?.$type).toBe('Customer')
    })

    it('should accept valid input with $type and $id', () => {
      const result = validateCreateThingInput({
        $type: 'Customer',
        $id: 'cust_123',
      })
      expect(result.success).toBe(true)
      expect(result.data?.$type).toBe('Customer')
      expect(result.data?.$id).toBe('cust_123')
    })

    it('should accept valid input with additional fields', () => {
      const result = validateCreateThingInput({
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
        tags: ['vip', 'active'],
        metadata: { source: 'api' },
      })
      expect(result.success).toBe(true)
      expect(result.data?.name).toBe('Alice')
      expect(result.data?.email).toBe('alice@example.com')
      expect(result.data?.age).toBe(30)
    })
  })

  describe('missing $type', () => {
    it('should reject input without $type', () => {
      const result = validateCreateThingInput({ name: 'Alice' })
      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors?.some((e) => e.field === '$type')).toBe(true)
    })

    it('should provide helpful error message for missing $type', () => {
      const result = validateCreateThingInput({ name: 'Alice' })
      expect(result.errors?.some((e) => e.message.includes('required'))).toBe(true)
    })

    it('should reject empty object', () => {
      const result = validateCreateThingInput({})
      expect(result.success).toBe(false)
    })
  })

  describe('invalid $type', () => {
    it('should reject lowercase $type', () => {
      const result = validateCreateThingInput({ $type: 'customer' })
      expect(result.success).toBe(false)
      expect(result.errors?.some((e) => e.message.includes('PascalCase'))).toBe(true)
    })

    it('should reject empty $type', () => {
      const result = validateCreateThingInput({ $type: '' })
      expect(result.success).toBe(false)
    })

    it('should reject null $type', () => {
      const result = validateCreateThingInput({ $type: null })
      expect(result.success).toBe(false)
    })

    it('should reject numeric $type', () => {
      const result = validateCreateThingInput({ $type: 123 })
      expect(result.success).toBe(false)
    })
  })

  describe('invalid $id', () => {
    it('should reject empty $id when provided', () => {
      const result = validateCreateThingInput({
        $type: 'Customer',
        $id: '',
      })
      expect(result.success).toBe(false)
    })

    it('should accept undefined $id (optional)', () => {
      const result = validateCreateThingInput({
        $type: 'Customer',
        $id: undefined,
      })
      expect(result.success).toBe(true)
    })
  })

  describe('non-object inputs', () => {
    it('should reject null', () => {
      const result = validateCreateThingInput(null)
      expect(result.success).toBe(false)
    })

    it('should reject undefined', () => {
      const result = validateCreateThingInput(undefined)
      expect(result.success).toBe(false)
    })

    it('should reject string', () => {
      const result = validateCreateThingInput('Customer')
      expect(result.success).toBe(false)
    })

    it('should reject number', () => {
      const result = validateCreateThingInput(123)
      expect(result.success).toBe(false)
    })

    it('should reject array', () => {
      const result = validateCreateThingInput(['Customer'])
      expect(result.success).toBe(false)
    })
  })
})

// ============================================================================
// isValidCreateThingInput Type Guard Tests
// ============================================================================

describe('isValidCreateThingInput', () => {
  it('should return true for valid input', () => {
    expect(isValidCreateThingInput({ $type: 'Customer' })).toBe(true)
  })

  it('should return false for invalid input', () => {
    expect(isValidCreateThingInput({ name: 'Alice' })).toBe(false)
    expect(isValidCreateThingInput({ $type: 'customer' })).toBe(false)
    expect(isValidCreateThingInput(null)).toBe(false)
    expect(isValidCreateThingInput(undefined)).toBe(false)
  })
})

// ============================================================================
// assertValidCreateThingInput Tests
// ============================================================================

describe('assertValidCreateThingInput', () => {
  it('should not throw for valid input', () => {
    expect(() => {
      assertValidCreateThingInput({ $type: 'Customer', name: 'Alice' })
    }).not.toThrow()
  })

  it('should throw ThingValidationError for invalid input', () => {
    expect(() => {
      assertValidCreateThingInput({ name: 'Alice' })
    }).toThrow(ThingValidationError)
  })

  it('should throw with helpful error messages', () => {
    try {
      assertValidCreateThingInput({ name: 'Alice' })
      expect.fail('Should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ThingValidationError)
      const error = e as ThingValidationError
      expect(error.errors.length).toBeGreaterThan(0)
      expect(error.message).toContain('$type')
    }
  })
})

// ============================================================================
// ThingValidationError Tests
// ============================================================================

describe('ThingValidationError', () => {
  it('should have name ThingValidationError', () => {
    const error = new ThingValidationError([
      { field: '$type', message: '$type is required', code: 'invalid_type' },
    ])
    expect(error.name).toBe('ThingValidationError')
  })

  it('should include all error messages', () => {
    const error = new ThingValidationError([
      { field: '$type', message: '$type is required', code: 'invalid_type' },
      { field: '$id', message: '$id cannot be empty', code: 'too_small' },
    ])
    expect(error.message).toContain('$type')
    expect(error.message).toContain('$id')
  })

  it('should provide getMessages() for user-friendly errors', () => {
    const error = new ThingValidationError([
      { field: '$type', message: '$type is required', code: 'invalid_type' },
    ])
    const messages = error.getMessages()
    expect(messages.length).toBe(1)
    expect(messages[0]).toContain('required')
  })

  it('should provide PascalCase guidance in error messages', () => {
    const error = new ThingValidationError([
      { field: '$type', message: 'PascalCase validation failed', code: 'invalid_string' },
    ])
    const messages = error.getMessages()
    expect(messages[0]).toContain('PascalCase')
    expect(messages[0]).toContain('Customer')
  })

  it('should support deprecated ThingValidationException alias', () => {
    // ThingValidationException is a deprecated alias for backward compatibility
    const error = new ThingValidationException([
      { field: '$type', message: '$type is required', code: 'invalid_type' },
    ])
    expect(error).toBeInstanceOf(ThingValidationError)
    expect(error.name).toBe('ThingValidationError')
  })
})

// ============================================================================
// validateThingData Tests
// ============================================================================

describe('validateThingData', () => {
  it('should accept valid ThingData', () => {
    const result = validateThingData({
      $id: 'cust_123',
      $type: 'Customer',
      $version: 1,
      name: 'Alice',
    })
    expect(result.success).toBe(true)
  })

  it('should reject missing $id', () => {
    const result = validateThingData({
      $type: 'Customer',
    })
    expect(result.success).toBe(false)
  })

  it('should reject missing $type', () => {
    const result = validateThingData({
      $id: 'cust_123',
    })
    expect(result.success).toBe(false)
  })

  it('should accept optional fields', () => {
    const result = validateThingData({
      $id: 'cust_123',
      $type: 'Customer',
      $version: 5,
      $createdAt: '2026-01-15T10:00:00.000Z',
      $updatedAt: '2026-01-15T12:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// Integration with Storage Tests
// ============================================================================

describe('Integration with InMemoryStateManager', () => {
  // These tests verify that validation works with the actual storage layer
  // Import is dynamic to avoid circular dependencies in test setup

  it('should reject invalid input when creating via InMemoryStateManager', async () => {
    const { InMemoryStateManager } = await import('../../storage/in-memory-state-manager')
    const manager = new InMemoryStateManager()

    // Should throw for lowercase type
    expect(() => {
      manager.create({ $type: 'customer', name: 'Alice' })
    }).toThrow(ThingValidationError)
  })

  it('should accept valid input when creating via InMemoryStateManager', async () => {
    const { InMemoryStateManager } = await import('../../storage/in-memory-state-manager')
    const manager = new InMemoryStateManager()

    // Should not throw for valid input
    const thing = manager.create({ $type: 'Customer', name: 'Alice' })
    expect(thing.$id).toBeDefined()
    expect(thing.$type).toBe('Customer')
    expect(thing.name).toBe('Alice')
  })
})

// ============================================================================
// Error Message Quality Tests
// ============================================================================

describe('Error message quality', () => {
  it('should provide helpful message for missing $type', () => {
    const result = validateCreateThingInput({ name: 'Alice' })
    expect(result.success).toBe(false)
    const typeError = result.errors?.find((e) => e.field === '$type')
    expect(typeError?.message).toMatch(/required/i)
  })

  it('should provide helpful message for invalid PascalCase', () => {
    const result = validateCreateThingInput({ $type: 'customer' })
    expect(result.success).toBe(false)
    const typeError = result.errors?.find((e) => e.field === '$type')
    expect(typeError?.message).toContain('PascalCase')
    expect(typeError?.message).toContain('Customer')
  })

  it('should provide helpful message for empty $id', () => {
    const result = validateCreateThingInput({ $type: 'Customer', $id: '' })
    expect(result.success).toBe(false)
    const idError = result.errors?.find((e) => e.field === '$id')
    expect(idError?.message).toMatch(/empty/i)
  })
})
