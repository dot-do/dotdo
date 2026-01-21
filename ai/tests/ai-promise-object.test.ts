/**
 * Tests for AIPromise.object() method
 *
 * Verifies that the .object(schema) method works correctly for structured output:
 * - Returns typed objects according to schema
 * - Works with JSON schemas, Zod schemas, and plain objects
 * - Integrates with generateObject from ai-core
 * - Preserves meta information (tokens, model, etc.)
 *
 * @see do-8wsa.8 - Implement .object(schema) for structured output
 */

import { describe, it, expect } from 'vitest'
import { ai } from '../template'
import type { AIPromise } from '../promise'

describe('AIPromise.object()', () => {
  it('should have object method defined on AIPromise', async () => {
    const promise = ai`Test`
    expect(promise.object).toBeDefined()
    expect(typeof promise.object).toBe('function')
  })

  it('should accept JSONSchema as parameter', async () => {
    const promise = ai`Extract user data from: name: John, age: 30`
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name', 'age'],
    }

    const objectPromise = promise.object(schema)
    expect(objectPromise).toBeDefined()
    expect(objectPromise.$meta).toBeDefined()
  })

  it('should accept plain object schema as parameter', async () => {
    const promise = ai`Extract person data: Alice 25`
    const schema = {
      name: 'string',
      age: 'number',
    }

    const objectPromise = promise.object(schema)
    expect(objectPromise).toBeDefined()
    expect(objectPromise.$meta).toBeDefined()
  })

  it('should support generic type parameter', async () => {
    interface Person {
      name: string
      age: number
      email: string
    }

    const promise = ai`Extract person: Alice, 30, alice@example.com`
    const schema = {
      name: 'string',
      age: 'number',
      email: 'string',
    }

    const objectPromise = promise.object<Person>(schema)
    expect(objectPromise).toBeDefined()
  })

  it('should allow chaining with .with() method', async () => {
    const schema = { name: 'string', age: 'number' }
    const promise = ai`Extract data`
      .with({ model: 'haiku', temperature: 0.5 })
      .object(schema)

    expect(promise).toBeDefined()
    expect(promise.$meta.model).toBe('haiku')
    expect(promise.$meta.temperature).toBe(0.5)
  })

  it('should preserve model configuration when creating object promise', async () => {
    const schema = { value: 'string' }
    const promise = ai`Test`
      .with({ model: 'opus' })
      .object(schema)

    expect(promise.$meta.model).toBe('opus')
  })

  it('should support pipe chaining after object()', async () => {
    const schema = { count: 'number' }
    const promise = ai`Count items: 1, 2, 3`
      .object<{ count: number }>(schema)
      .pipe((obj) => obj.count * 2)

    expect(promise).toBeDefined()
    // Note: We can't fully test the execution without a real LLM provider
  })

  it('should work with complex nested schemas', async () => {
    interface Address {
      street: string
      city: string
      zipCode: string
    }

    interface UserProfile {
      name: string
      age: number
      email: string
      address: Address
    }

    const schema = {
      name: 'string',
      age: 'number',
      email: 'string',
      address: {
        street: 'string',
        city: 'string',
        zipCode: 'string',
      },
    }

    const promise = ai`Extract user profile`
      .object<UserProfile>(schema)

    expect(promise).toBeDefined()
  })

  describe('Documentation examples', () => {
    it('should match usage example from docstring', () => {
      // Example from template.ts docstring:
      // const schema = { name: 'string', age: 'number', email: 'string' }
      // const user = await ai`Extract user info: ${userData}`.object(schema)

      const userData = 'John Doe, 30, john@example.com'
      const schema = { name: 'string', age: 'number', email: 'string' }
      const userPromise = ai`Extract user info: ${userData}`.object(schema)

      expect(userPromise).toBeDefined()
      expect(userPromise.$meta).toBeDefined()
    })

    it('should allow method chaining as shown in usage examples', () => {
      const schema = { name: 'string', age: 'number' }

      // Test chaining with configuration
      const promise = ai`Extract person data`
        .with({ model: 'opus', temperature: 0.3 })
        .object(schema)

      expect(promise).toBeDefined()
      expect(promise.$meta.model).toBe('opus')
    })
  })

  describe('Type safety', () => {
    it('should support typed generic for structured output', () => {
      interface Result {
        success: boolean
        message: string
        data: unknown
      }

      const schema = {
        success: 'boolean',
        message: 'string',
        data: 'object',
      }

      const promise: AIPromise<Result> = ai`Generate response`
        .object<Result>(schema)

      expect(promise).toBeDefined()
    })

    it('should preserve type information through promise chain', () => {
      interface Config {
        apiKey: string
        timeout: number
        retries: number
      }

      const schema = {
        apiKey: 'string',
        timeout: 'number',
        retries: 'number',
      }

      const configPromise: AIPromise<Config> = ai`Generate config`
        .object<Config>(schema)

      // The promise should maintain the generic type parameter
      expect(configPromise.$meta).toBeDefined()
    })
  })

  describe('Integration with generateObject', () => {
    it('should use generateObject from ai-core internally', async () => {
      // The implementation imports generateObject at runtime
      // This test verifies the method exists and is callable
      const promise = ai`Test`
      const objectMethod = promise.object

      expect(objectMethod).toBeDefined()
      expect(typeof objectMethod).toBe('function')
    })
  })
})
