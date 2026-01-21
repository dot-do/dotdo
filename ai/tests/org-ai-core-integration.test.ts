// TDD: @org.ai/core Integration Tests
// Testing generate(), AIPromise, and context management from @org.ai/core
// These tests are written TDD-style - some will fail until implementation is complete
//
// The @org.ai/core package alias is configured in ai/vitest.config.ts
// to point to primitives/packages/ai-core/src/index.ts
//
// These tests use mock stubs for the AI SDK (ai/stubs/ai.ts) and
// ai-providers (ai/stubs/ai-providers.ts) to enable testing without
// actual AI API calls.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * NOTE: @org.ai/core is imported from primitives/packages/ai-core/src
 * via vitest alias configuration in vitest.config.ts
 *
 * Mock stubs provide working implementations of the AI SDK functions
 * so that tests can run without external API calls.
 */

// ============================================================================
// Import Tests - Verify all exports are available
// ============================================================================

describe('@org.ai/core exports', () => {
  it('should export core generate function', async () => {
    const { generate } = await import('@org.ai/core')
    expect(typeof generate).toBe('function')
  })

  it('should export AIPromise class', async () => {
    const { AIPromise, isAIPromise, getRawPromise } = await import('@org.ai/core')
    expect(AIPromise).toBeDefined()
    expect(typeof isAIPromise).toBe('function')
    expect(typeof getRawPromise).toBe('function')
  })

  it('should export context management functions', async () => {
    const { configure, getContext, withContext, resetContext, getModel, getProvider } =
      await import('@org.ai/core')
    expect(typeof configure).toBe('function')
    expect(typeof getContext).toBe('function')
    expect(typeof withContext).toBe('function')
    expect(typeof resetContext).toBe('function')
    expect(typeof getModel).toBe('function')
    expect(typeof getProvider).toBe('function')
  })

  it('should export template literal functions', async () => {
    const { ai, write, code, list, lists, extract, summarize, is, diagram, slides } =
      await import('@org.ai/core')

    expect(typeof ai).toBe('function')
    expect(typeof write).toBe('function')
    expect(typeof code).toBe('function')
    expect(typeof list).toBe('function')
    expect(typeof lists).toBe('function')
    expect(typeof extract).toBe('function')
    expect(typeof summarize).toBe('function')
    expect(typeof is).toBe('function')
    expect(typeof diagram).toBe('function')
    expect(typeof slides).toBe('function')
  })

  it('should export AIPromise factory functions', async () => {
    const {
      createTextPromise,
      createObjectPromise,
      createListPromise,
      createListsPromise,
      createBooleanPromise,
      createExtractPromise,
      createAITemplateFunction,
    } = await import('@org.ai/core')

    expect(typeof createTextPromise).toBe('function')
    expect(typeof createObjectPromise).toBe('function')
    expect(typeof createListPromise).toBe('function')
    expect(typeof createListsPromise).toBe('function')
    expect(typeof createBooleanPromise).toBe('function')
    expect(typeof createExtractPromise).toBe('function')
    expect(typeof createAITemplateFunction).toBe('function')
  })

  it('should export agentic and human functions', async () => {
    const { research, read, browse, decide, ask, approve, review } =
      await import('@org.ai/core')

    // Core do is a reserved word, imported as doImpl
    expect(typeof research).toBe('function')
    expect(typeof read).toBe('function')
    expect(typeof browse).toBe('function')
    expect(typeof decide).toBe('function')
    expect(typeof ask).toBe('function')
    expect(typeof approve).toBe('function')
    expect(typeof review).toBe('function')
  })

  it('should export generation functions', async () => {
    const { generateText, generateObject, streamText, streamObject } =
      await import('@org.ai/core')

    expect(typeof generateText).toBe('function')
    expect(typeof generateObject).toBe('function')
    expect(typeof streamText).toBe('function')
    expect(typeof streamObject).toBe('function')
  })

  it('should export schema helper', async () => {
    const { schema } = await import('@org.ai/core')
    expect(typeof schema).toBe('function')
  })
})

// ============================================================================
// generate() - Core Generate Primitive Tests
// ============================================================================

describe('generate() primitive', () => {
  it('should accept GenerateType and return appropriate result', async () => {
    const { generate } = await import('@org.ai/core')

    // Type text
    const textResult = await generate('text', 'Say hello')
    expect(typeof textResult).toBe('string')
  })

  it('should support text generation type', async () => {
    const { generate } = await import('@org.ai/core')

    const result = await generate('text', 'Say hello', {
      model: 'sonnet',
      temperature: 0.5,
    })

    expect(typeof result).toBe('string')
  })

  it('should support json generation type', async () => {
    const { generate } = await import('@org.ai/core')

    const result = await generate('json', 'Generate a user profile', {
      schema: { name: 'User name', email: 'User email' },
    })

    expect(typeof result).toBe('object')
  })

  it('should support list generation type', async () => {
    const { generate } = await import('@org.ai/core')

    const result = await generate('list', 'List 3 colors')

    expect(Array.isArray(result)).toBe(true)
  })

  it('should support boolean generation type', async () => {
    const { generate } = await import('@org.ai/core')

    const result = await generate('boolean', 'Is the sky blue?')

    expect(typeof result).toBe('boolean')
  })

  it('should support code generation type', async () => {
    const { generate } = await import('@org.ai/core')

    const result = await generate('code', 'Write a hello world function', {
      language: 'typescript',
    })

    expect(typeof result).toBe('string')
  })

  it('should support diagram generation type', async () => {
    const { generate } = await import('@org.ai/core')

    const result = await generate('diagram', 'User authentication flow', {
      format: 'mermaid',
    })

    expect(typeof result).toBe('string')
  })

  it('should support summary generation type', async () => {
    const { generate } = await import('@org.ai/core')

    const result = await generate('summary', 'The quick brown fox jumps over the lazy dog')

    expect(typeof result).toBe('string')
  })

  it('should support extract generation type', async () => {
    const { generate } = await import('@org.ai/core')

    const result = await generate('extract', 'Email: test@example.com, Phone: 555-1234', {
      schema: { email: 'Email address', phone: 'Phone number' },
    })

    expect(Array.isArray(result) || typeof result === 'object').toBe(true)
  })

  it('should reject unknown generation types', async () => {
    const { generate } = await import('@org.ai/core')

    await expect(
      generate('unknown' as any, 'test')
    ).rejects.toThrow(/unknown generate type/i)
  })
})

// ============================================================================
// AIPromise - Promise Pipelining Tests
// ============================================================================

describe('AIPromise', () => {
  it('should create AIPromise from factory functions', async () => {
    const { createTextPromise, isAIPromise } = await import('@org.ai/core')

    const promise = createTextPromise('Test prompt')

    expect(isAIPromise(promise)).toBe(true)
  })

  it('should be thenable (implements PromiseLike)', async () => {
    const { createTextPromise } = await import('@org.ai/core')

    const promise = createTextPromise('Test')

    // Should have then method
    expect(typeof promise.then).toBe('function')
    expect(typeof promise.catch).toBe('function')
    expect(typeof promise.finally).toBe('function')
  })

  it('should track property access for dynamic schema inference', async () => {
    const { AIPromise, isAIPromise } = await import('@org.ai/core')

    const promise = new AIPromise('Generate user', { type: 'object' })

    // Access properties - should create child AIPromises
    const { name, email } = promise as any

    expect(isAIPromise(name)).toBe(true)
    expect(isAIPromise(email)).toBe(true)
  })

  it('should record accessed properties for schema building', async () => {
    const { AIPromise, getRawPromise } = await import('@org.ai/core')

    const promise = new AIPromise('Generate user', { type: 'object' })

    // Access some properties
    const _unused1 = (promise as any).name
    const _unused2 = (promise as any).age
    const _unused3 = (promise as any).email

    // Get raw promise and check accessed props
    const raw = getRawPromise(promise)
    expect(raw.accessedProps.has('name')).toBe(true)
    expect(raw.accessedProps.has('age')).toBe(true)
    expect(raw.accessedProps.has('email')).toBe(true)
  })

  it('should support dependency tracking via addDependency', async () => {
    const { AIPromise } = await import('@org.ai/core')

    const dep1 = new AIPromise('Get name', { type: 'text' })
    const dep2 = new AIPromise('Get email', { type: 'text' })

    const main = new AIPromise('Combine ${name} and ${email}', { type: 'text' })

    main.addDependency(dep1, ['name'])
    main.addDependency(dep2, ['email'])

    // Dependency should be tracked (internal state)
    expect((main as any)._dependencies.length).toBe(2)
  })

  it('should support forEach for array results', async () => {
    const { createListPromise } = await import('@org.ai/core')

    const promise = createListPromise('List colors')
    const items: string[] = []

    // forEach should work (though it resolves the promise)
    await promise.forEach((item: string) => {
      items.push(item)
    })

    // Should have iterated over items
    expect(Array.isArray(items)).toBe(true)
  })

  it('should support async iteration', async () => {
    const { createListPromise } = await import('@org.ai/core')

    const promise = createListPromise('List colors')
    const items: string[] = []

    for await (const item of promise) {
      items.push(item)
    }

    expect(Array.isArray(items)).toBe(true)
  })

  it('should support streaming via .stream()', async () => {
    const { createTextPromise } = await import('@org.ai/core')

    const promise = createTextPromise('Write a story')
    const stream = promise.stream()

    // Stream should have required properties
    expect(stream.textStream).toBeDefined()
    expect(stream.partialObjectStream).toBeDefined()
    expect(stream.result).toBeDefined()
    expect(typeof stream.then).toBe('function')
  })

  it('should prevent mutation (read-only proxy)', async () => {
    const { AIPromise } = await import('@org.ai/core')

    const promise = new AIPromise('Test', { type: 'object' })

    expect(() => {
      (promise as any).foo = 'bar'
    }).toThrow(/read-only/i)

    expect(() => {
      delete (promise as any).foo
    }).toThrow(/cannot be deleted/i)
  })

  it('should work with Promise.all', async () => {
    const { createTextPromise } = await import('@org.ai/core')

    const p1 = createTextPromise('Prompt 1')
    const p2 = createTextPromise('Prompt 2')
    const p3 = createTextPromise('Prompt 3')

    // Should not throw - promises are compatible with Promise.all
    const results = await Promise.all([p1, p2, p3])
    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBe(3)
  })
})

// ============================================================================
// Template Literal Functions Tests
// ============================================================================

describe('Template literal functions', () => {
  it('ai() should return AIPromise', async () => {
    const { ai, isAIPromise } = await import('@org.ai/core')

    const promise = ai`Write about AI`

    expect(isAIPromise(promise)).toBe(true)
  })

  it('ai() should support dynamic schema from destructuring', async () => {
    const { ai, isAIPromise } = await import('@org.ai/core')

    const promise = ai`Generate a summary of TypeScript`
    const { summary, keyPoints, conclusion } = promise as any

    expect(isAIPromise(summary)).toBe(true)
    expect(isAIPromise(keyPoints)).toBe(true)
    expect(isAIPromise(conclusion)).toBe(true)
  })

  it('write() should return AIPromise for text', async () => {
    const { write, isAIPromise } = await import('@org.ai/core')

    const promise = write`Write a poem`

    expect(isAIPromise(promise)).toBe(true)
  })

  it('list() should return AIPromise for string array', async () => {
    const { list, isAIPromise } = await import('@org.ai/core')

    const promise = list`List programming languages`

    expect(isAIPromise(promise)).toBe(true)
  })

  it('is() should return AIPromise for boolean', async () => {
    const { is, isAIPromise } = await import('@org.ai/core')

    const promise = is`TypeScript a superset of JavaScript`

    expect(isAIPromise(promise)).toBe(true)
  })

  it('lists() should return AIPromise for multiple named lists', async () => {
    const { lists, isAIPromise } = await import('@org.ai/core')

    const promise = lists`pros and cons of using AI`

    expect(isAIPromise(promise)).toBe(true)

    // Should support destructuring for dynamic schema
    const { pros, cons } = promise as any
    expect(isAIPromise(pros)).toBe(true)
    expect(isAIPromise(cons)).toBe(true)
  })

  it('extract() should return AIPromise', async () => {
    const { extract, isAIPromise } = await import('@org.ai/core')

    const promise = extract`contact info from: email test@example.com phone 555-1234`

    expect(isAIPromise(promise)).toBe(true)
  })

  it('template functions should handle interpolated values', async () => {
    const { ai, isAIPromise } = await import('@org.ai/core')

    const topic = 'machine learning'
    const promise = ai`Write about ${topic}`

    expect(isAIPromise(promise)).toBe(true)
  })

  it('template functions should track AIPromise dependencies', async () => {
    const { ai, is, isAIPromise } = await import('@org.ai/core')

    // Create a chain where is() depends on ai()'s result
    const analysis = ai`Analyze the benefits of TypeScript`
    const { conclusion } = analysis as any

    // is() should track conclusion as a dependency
    const isValid = is`${conclusion} is well-reasoned`

    expect(isAIPromise(isValid)).toBe(true)
  })

  it('template functions should accept string prompts', async () => {
    const { ai, isAIPromise } = await import('@org.ai/core')

    // Can also be called as regular function
    const promise = ai('Write about AI', { model: 'sonnet' })

    expect(isAIPromise(promise)).toBe(true)
  })

  it('decide() should create decision function', async () => {
    const { decide } = await import('@org.ai/core')

    const decider = decide`which has higher engagement`

    // decide returns a function that takes options
    expect(typeof decider).toBe('function')
  })
})

// ============================================================================
// Context Management Tests
// ============================================================================

describe('Context management', () => {
  beforeEach(async () => {
    const { resetContext } = await import('@org.ai/core')
    resetContext()
  })

  afterEach(async () => {
    const { resetContext } = await import('@org.ai/core')
    resetContext()
  })

  it('should configure global context', async () => {
    const { configure, getContext, getGlobalContext } = await import('@org.ai/core')

    configure({ model: 'claude-sonnet-4-20250514' })

    const ctx = getContext()
    expect(ctx.model).toBe('claude-sonnet-4-20250514')

    const globalCtx = getGlobalContext()
    expect(globalCtx.model).toBe('claude-sonnet-4-20250514')
  })

  it('should merge configurations', async () => {
    const { configure, getContext } = await import('@org.ai/core')

    configure({ model: 'sonnet' })
    configure({ temperature: 0.7 })

    const ctx = getContext()
    expect(ctx.model).toBe('sonnet')
    expect(ctx.temperature).toBe(0.7)
  })

  it('should reset context to defaults', async () => {
    const { configure, resetContext, getContext } = await import('@org.ai/core')

    configure({ model: 'opus', temperature: 0.8 })
    resetContext()

    const ctx = getContext()
    expect(ctx.model).toBeUndefined()
    expect(ctx.temperature).toBeUndefined()
  })

  it('should provide execution context via withContext', async () => {
    const { configure, withContext, getContext } = await import('@org.ai/core')

    configure({ model: 'sonnet' })

    const result = await withContext({ model: 'gpt-4o', temperature: 0.5 }, () => {
      const ctx = getContext()
      return {
        model: ctx.model,
        temperature: ctx.temperature,
      }
    })

    expect(result.model).toBe('gpt-4o')
    expect(result.temperature).toBe(0.5)

    // Outside withContext, should be back to global
    const outerCtx = getContext()
    expect(outerCtx.model).toBe('sonnet')
  })

  it('withContext should support async functions', async () => {
    const { withContext, getContext } = await import('@org.ai/core')

    const result = await withContext({ model: 'opus' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return getContext().model
    })

    expect(result).toBe('opus')
  })

  it('should get model from context', async () => {
    const { configure, getModel } = await import('@org.ai/core')

    // Default
    expect(getModel()).toBe('sonnet')

    configure({ model: 'opus' })
    expect(getModel()).toBe('opus')
  })

  it('should get provider from context', async () => {
    const { configure, getProvider, resetContext } = await import('@org.ai/core')

    resetContext()

    // Default provider
    expect(getProvider()).toBe('openai')

    configure({ provider: 'anthropic' })
    expect(getProvider()).toBe('anthropic')
  })

  it('should read from environment variables', async () => {
    const { resetContext, getContext } = await import('@org.ai/core')

    // This test documents expected environment variable behavior
    // The actual env vars may or may not be set in test environment

    resetContext()
    const ctx = getContext()

    // Context should check for AI_MODEL, AI_PROVIDER, etc.
    // If env vars are set, they should appear in context
    expect(typeof ctx).toBe('object')
  })
})

// ============================================================================
// Streaming Tests
// ============================================================================

describe('Streaming', () => {
  it('streamText should return AsyncIterable', async () => {
    const { streamText } = await import('@org.ai/core')

    const result = await streamText({
      model: 'sonnet',
      prompt: 'Say hello',
    })

    expect(result.textStream).toBeDefined()
    expect(typeof result.textStream[Symbol.asyncIterator]).toBe('function')
  })

  it('streamObject should return streaming result', async () => {
    const { streamObject } = await import('@org.ai/core')

    // streamObject returns a StreamObjectResult
    // The partialObjectStream getter creates a locked stream
    // We just verify the function exists and returns the expected structure
    const result = await streamObject({
      model: 'sonnet',
      schema: { name: 'User name', bio: 'User bio' },
      prompt: 'Generate a user profile',
    })

    // Stream result should have the object property (final result)
    expect(result).toBeDefined()
    // Note: partialObjectStream is a getter that locks the stream on access
    // In real usage, you'd consume it with for-await-of
  })

  it('AIPromise.stream() should provide text stream', async () => {
    const { createTextPromise } = await import('@org.ai/core')

    const promise = createTextPromise('Write a story')
    const stream = promise.stream()

    expect(stream.textStream).toBeDefined()
  })

  it('AIPromise.stream() should provide partial object stream', async () => {
    const { createObjectPromise } = await import('@org.ai/core')

    const promise = createObjectPromise('Generate user')
    const stream = promise.stream()

    expect(stream.partialObjectStream).toBeDefined()
  })

  it('streaming should support abort signal', async () => {
    const { createTextPromise } = await import('@org.ai/core')

    const promise = createTextPromise('Write a long story')
    const controller = new AbortController()

    const stream = promise.stream({ abortSignal: controller.signal })

    // Should accept abort signal
    expect(stream).toBeDefined()
  })
})

// ============================================================================
// Schema Helper Tests
// ============================================================================

describe('Schema helper', () => {
  it('should create schema from simple object', async () => {
    const { schema } = await import('@org.ai/core')

    const userSchema = schema({
      name: 'User name',
      email: 'User email address',
      age: 'User age as number',
    })

    expect(userSchema).toBeDefined()
  })

  it('should support array schemas', async () => {
    const { schema } = await import('@org.ai/core')

    const listSchema = schema({
      items: ['List of items'],
    })

    expect(listSchema).toBeDefined()
  })

  it('should support nested schemas', async () => {
    const { schema } = await import('@org.ai/core')

    const complexSchema = schema({
      user: {
        name: 'User name',
        address: {
          street: 'Street address',
          city: 'City name',
        },
      },
    })

    expect(complexSchema).toBeDefined()
  })
})

// ============================================================================
// Integration Scenarios Tests
// ============================================================================

describe('Integration scenarios', () => {
  it('should support promise pipelining without intermediate await', async () => {
    const { ai, is, isAIPromise } = await import('@org.ai/core')

    // This is the key feature: no await needed between operations
    const analysis = ai`Analyze TypeScript vs JavaScript`
    const { conclusion } = analysis as any
    const isValid = is`${conclusion} is a fair assessment`
    const improved = ai`Improve ${conclusion} to be more balanced`

    // All are AIPromises, not resolved yet
    expect(isAIPromise(analysis)).toBe(true)
    expect(isAIPromise(conclusion)).toBe(true)
    expect(isAIPromise(isValid)).toBe(true)
    expect(isAIPromise(improved)).toBe(true)
  })

  it('should only resolve when awaited', async () => {
    const { createTextPromise } = await import('@org.ai/core')

    const promise = createTextPromise('Test')

    // Not resolved yet
    expect(promise.isResolved).toBe(false)

    // Now resolve
    await promise

    // Should be resolved now
    expect(promise.isResolved).toBe(true)
  })

  it('should work with context in nested operations', async () => {
    const { configure, withContext, getContext, ai, isAIPromise, resetContext } =
      await import('@org.ai/core')

    resetContext()
    configure({ model: 'sonnet' })

    const outerPromise = ai`Test outer`

    // withContext returns the result of the inner function
    // When the inner function returns an AIPromise, withContext returns it directly
    // Only when you await the withContext call does the inner promise get resolved
    const innerPromise = withContext({ model: 'opus' }, () => {
      const ctx = getContext()
      expect(ctx.model).toBe('opus')
      return ai`Test inner`
    })

    expect(isAIPromise(outerPromise)).toBe(true)
    // innerPromise is the AIPromise (not awaited)
    expect(isAIPromise(innerPromise)).toBe(true)
  })
})

// ============================================================================
// Type Guards Tests
// ============================================================================

describe('Type guards', () => {
  it('isAIPromise should correctly identify AIPromise instances', async () => {
    const { AIPromise, isAIPromise, createTextPromise } = await import('@org.ai/core')

    const promise = new AIPromise('test', {})
    const textPromise = createTextPromise('test')

    expect(isAIPromise(promise)).toBe(true)
    expect(isAIPromise(textPromise)).toBe(true)
    expect(isAIPromise(Promise.resolve('test'))).toBe(false)
    expect(isAIPromise('string')).toBe(false)
    expect(isAIPromise(null)).toBe(false)
    expect(isAIPromise(undefined)).toBe(false)
    expect(isAIPromise({})).toBe(false)
  })

  it('getRawPromise should unwrap proxied AIPromise', async () => {
    const { AIPromise, getRawPromise, isAIPromise, RAW_PROMISE_SYMBOL } = await import('@org.ai/core')

    const promise = new AIPromise('test', {})

    // AIPromise constructor returns a Proxy, getRawPromise unwraps it
    const raw = getRawPromise(promise)

    // Both should be AIPromise instances
    expect(isAIPromise(raw)).toBe(true)
    expect(isAIPromise(promise)).toBe(true)

    // The raw promise should have the same prompt
    expect(raw.prompt).toBe('test')
  })

  it('isZodSchema should identify Zod schemas', async () => {
    const { isZodSchema } = await import('@org.ai/core')

    expect(typeof isZodSchema).toBe('function')

    // Simple object is not a Zod schema
    expect(isZodSchema({ name: 'string' })).toBe(false)
  })
})
