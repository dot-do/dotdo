/**
 * @dotdo/ai + ai-tests Integration Tests
 *
 * TDD tests for integrating the ai-tests package's assertion utilities
 * with @dotdo/ai's template literal AI, providers, and streaming features.
 *
 * These tests demonstrate how ai-tests can be used to test AI outputs:
 * - Assertion utilities (expect, should, assert)
 * - Test runner for programmatic test execution
 * - RPC-compatible assertions for worker environments
 *
 * @module ai/tests/ai-tests-integration
 */

import { describe, it, expect as vitestExpect, beforeEach } from 'vitest'
import {
  expect,
  should,
  assert,
  Assertion,
  createRunner,
  TestRunner,
  TestServiceCore,
  type TestResults,
} from 'ai-tests'
import { ai, write, summarize, code } from '../template'
import { generateText, generateObject, configureProvider, clearProviders } from '../ai-core'
import type { AIPromise } from '../promise'

describe('ai-tests Integration', () => {
  beforeEach(() => {
    clearProviders()
  })

  describe('Assertion Utilities with AI Responses', () => {
    describe('expect() with AI template literals', () => {
      it('should validate AIPromise resolves to string', async () => {
        const result = ai`Hello world`

        // ai-tests expect should work with the resolved value
        const text = await result
        expect(text).to.be.a('string')
      })

      it('should validate AI response is not empty', async () => {
        const result = await ai`Say hello`

        expect(result).to.not.be.empty
        expect(result.length).to.be.above(0)
      })

      it('should validate AI response contains expected content', async () => {
        const name = 'Alice'
        const result = await ai`Just respond with the name: ${name}`

        // Response should contain the interpolated name
        expect(result).to.be.a('string')
        expect(result).to.include('Alice')
      })

      it('should validate $meta properties exist', () => {
        const result = ai`Test prompt`

        expect(result.$meta).to.exist
        expect(result.$meta.model).to.equal('default')
      })

      it('should validate .with() sets options correctly', () => {
        const result = ai`Test`.with({ model: 'gpt-4', temperature: 0.5 })

        expect(result.$meta.model).to.equal('gpt-4')
        expect(result.$meta.temperature).to.equal(0.5)
      })

      it('should validate tokens are tracked after resolution', async () => {
        const result = ai`Count tokens for this`
        await result

        expect(result.$meta.tokens).to.exist
        expect(result.$meta.tokens?.input).to.be.above(0)
      })

      it('should validate duration is tracked', async () => {
        const result = ai`Track duration`
        await result

        expect(result.$meta.duration).to.exist
        expect(result.$meta.duration).to.be.at.least(0)
      })
    })

    describe('should() with AI responses', () => {
      it('should validate AI response using should-style assertions', async () => {
        const result = await ai`Respond with a greeting`

        should(result).be.a('string')
        should(result).not.be.empty
      })

      it('should validate response properties', async () => {
        const aiPromise = ai`Test`
        should(aiPromise.$meta).exist
        should(aiPromise.$meta.model).equal('default')
      })
    })

    describe('assert with AI responses', () => {
      it('should validate AI response using assert-style assertions', async () => {
        const result = await ai`Say something`

        assert.isString(result)
        assert.isNotEmpty(result)
      })

      it('should validate AI response length', async () => {
        const result = await ai`Write a short sentence`

        assert.isAbove(result.length, 0)
      })

      it('should validate $meta model property', () => {
        const result = ai`Test`

        assert.isDefined(result.$meta)
        assert.strictEqual(result.$meta.model, 'default')
      })
    })
  })

  describe('Convenience Functions with ai-tests', () => {
    describe('write() function', () => {
      it('should validate write output is a string', async () => {
        const result = await write`a haiku about TypeScript`

        expect(result).to.be.a('string')
        expect(result).to.not.be.empty
      })

      it('should validate write interpolation works', async () => {
        const topic = 'JavaScript'
        const result = await write`an article about ${topic}`

        expect(result).to.be.a('string')
        should(result.length).be.above(0)
      })
    })

    describe('summarize() function', () => {
      it('should validate summarize output is a string', async () => {
        const longText = 'This is a long text that needs to be summarized. '.repeat(10)
        const result = await summarize`${longText}`

        expect(result).to.be.a('string')
        // Summary should be shorter than original
        expect(result.length).to.be.below(longText.length)
      })
    })

    describe('code() function', () => {
      it('should validate code output contains code', async () => {
        const result = await code`a function that adds two numbers`

        expect(result).to.be.a('string')
        expect(result).to.not.be.empty
        // Code should contain function-like patterns
        expect(result).to.match(/function|const|=>/)
      })
    })
  })

  describe('generateText with ai-tests', () => {
    it('should validate generateText returns expected shape', async () => {
      const result = await generateText({
        prompt: 'Say hello',
      })

      expect(result).to.have.property('text')
      expect(result.text).to.be.a('string')
      expect(result).to.have.property('usage')
    })

    it('should validate usage contains token counts', async () => {
      const result = await generateText({
        prompt: 'Count my tokens',
      })

      expect(result.usage).to.exist
      expect(result.usage).to.have.property('promptTokens')
      expect(result.usage).to.have.property('completionTokens')
      assert.isNumber(result.usage.promptTokens)
      assert.isNumber(result.usage.completionTokens)
    })
  })

  describe('generateObject with ai-tests', () => {
    it('should validate generateObject returns typed object', async () => {
      const result = await generateObject({
        prompt: 'Generate a person',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
          },
          required: ['name', 'age'],
        },
      })

      expect(result).to.have.property('object')
      expect(result.object).to.have.property('name')
      expect(result.object).to.have.property('age')
      expect(result.object.name).to.be.a('string')
      expect(result.object.age).to.be.a('number')
    })

    it('should validate schema constraints are met', async () => {
      const result = await generateObject({
        prompt: 'Generate coordinates within bounds',
        schema: {
          type: 'object',
          properties: {
            x: { type: 'number', minimum: 0, maximum: 100 },
            y: { type: 'number', minimum: 0, maximum: 100 },
          },
          required: ['x', 'y'],
        },
      })

      expect(result.object.x).to.be.within(0, 100)
      expect(result.object.y).to.be.within(0, 100)
    })
  })

  describe('Streaming with ai-tests', () => {
    it('should validate stream yields chunks', async () => {
      const result = ai`Stream this response`
      const chunks: string[] = []

      for await (const chunk of result.stream()) {
        chunks.push(chunk)
      }

      expect(chunks).to.be.an('array')
      expect(chunks.length).to.be.above(0)
    })

    it('should validate all chunks are strings', async () => {
      const result = ai`Stream test`

      for await (const chunk of result.stream()) {
        expect(chunk).to.be.a('string')
      }
    })

    it('should validate combined chunks equal final result', async () => {
      const result = ai`Stream and combine`
      const chunks: string[] = []

      for await (const chunk of result.stream()) {
        chunks.push(chunk)
      }

      const combined = chunks.join('')
      const final = await result

      // Streamed chunks when combined should match final result
      expect(combined).to.equal(final)
    })
  })

  describe('TestRunner Integration', () => {
    let runner: TestRunner

    beforeEach(() => {
      runner = createRunner()
    })

    it('should create a TestRunner instance', () => {
      vitestExpect(runner).toBeInstanceOf(TestRunner)
    })

    it('should register and run AI tests programmatically', async () => {
      runner.describe('AI Tests', () => {
        runner.it('validates AI response', async () => {
          const result = await ai`Say hello`
          expect(result).to.be.a('string')
        })
      })

      const results = await runner.run()

      vitestExpect(results.total).toBe(1)
      vitestExpect(results.passed).toBe(1)
      vitestExpect(results.failed).toBe(0)
    })

    it('should capture AI test failures', async () => {
      runner.describe('AI Tests', () => {
        runner.it('should fail on bad assertion', async () => {
          const result = await ai`Say hello`
          // This should fail - AI response is not null
          expect(result).to.be.null
        })
      })

      const results = await runner.run()

      vitestExpect(results.total).toBe(1)
      vitestExpect(results.passed).toBe(0)
      vitestExpect(results.failed).toBe(1)
    })

    it('should support hooks with AI setup', async () => {
      let aiResult: string = ''

      runner.beforeEach(async () => {
        aiResult = await ai`Initialize`
      })

      runner.describe('AI with hooks', () => {
        runner.it('uses AI result from hook', () => {
          expect(aiResult).to.be.a('string')
          expect(aiResult).to.not.be.empty
        })
      })

      const results = await runner.run()

      vitestExpect(results.passed).toBe(1)
    })

    it('should support skipped AI tests', async () => {
      runner.describe('AI Tests', () => {
        runner.skip('skipped AI test', async () => {
          const result = await ai`This should not run`
          expect(result).to.equal('impossible')
        })

        runner.it('runs normally', () => {
          expect(true).to.be.true
        })
      })

      const results = await runner.run()

      vitestExpect(results.total).toBe(2)
      vitestExpect(results.skipped).toBe(1)
      vitestExpect(results.passed).toBe(1)
    })

    it('should report AI test duration', async () => {
      runner.describe('AI Duration', () => {
        runner.it('measures AI call time', async () => {
          const start = Date.now()
          await ai`Test duration`
          const duration = Date.now() - start
          expect(duration).to.be.at.least(0)
        })
      })

      const results = await runner.run()

      vitestExpect(results.duration).toBeGreaterThanOrEqual(0)
      vitestExpect(results.tests[0].duration).toBeGreaterThanOrEqual(0)
    })
  })

  describe('TestServiceCore Integration', () => {
    let service: TestServiceCore

    beforeEach(() => {
      service = new TestServiceCore()
    })

    it('should create TestServiceCore instance', () => {
      vitestExpect(service).toBeInstanceOf(TestServiceCore)
    })

    it('should expose expect function', () => {
      const assertion = service.expect(42)
      vitestExpect(assertion).toBeInstanceOf(Assertion)
    })

    it('should expose should function', () => {
      const assertion = service.should(42)
      vitestExpect(assertion).toBeInstanceOf(Assertion)
    })

    it('should expose assert object', () => {
      vitestExpect(service.assert).toBeDefined()
      vitestExpect(typeof service.assert.equal).toBe('function')
    })

    it('should run AI tests via service', async () => {
      service.describe('Service AI Tests', () => {
        service.it('validates via service', async () => {
          const result = await ai`Service test`
          service.expect(result).to.be.a('string')
        })
      })

      const results = await service.run()

      vitestExpect(results.total).toBe(1)
      vitestExpect(results.passed).toBe(1)
    })

    it('should reset between test suites', async () => {
      service.it('first test', () => {
        service.expect(1).to.equal(1)
      })

      const results1 = await service.run()
      vitestExpect(results1.total).toBe(1)

      service.reset()

      service.it('second test', () => {
        service.expect(2).to.equal(2)
      })

      const results2 = await service.run()
      vitestExpect(results2.total).toBe(1) // Not 2, because we reset
    })
  })

  describe('Complex AI Validation Patterns', () => {
    it('should validate AI response matches regex pattern', async () => {
      const result = await ai`Write a sentence that ends with a period.`

      expect(result).to.match(/\.$/)
    })

    it('should validate AI response contains specific keywords', async () => {
      const result = await ai`Explain what JavaScript is in one sentence using the words 'programming' and 'web'`

      expect(result.toLowerCase()).to.include('programming')
      expect(result.toLowerCase()).to.include('web')
    })

    it('should validate AI response is within length bounds', async () => {
      const result = await ai`Write exactly 10 words`.with({ maxTokens: 50 })

      const wordCount = result.trim().split(/\s+/).length
      expect(wordCount).to.be.within(5, 20) // Allow some variance
    })

    it('should validate AI response format using deep equality', async () => {
      interface Person {
        name: string
        age: number
      }

      const result = await generateObject<Person>({
        prompt: 'Generate a person named John who is 30 years old',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
          },
          required: ['name', 'age'],
        },
      })

      expect(result.object).to.deep.include({
        name: 'John',
        age: 30,
      })
    })

    it('should validate AI response against custom predicate', async () => {
      const result = await ai`Generate a number between 1 and 10`

      const extractedNumber = parseInt(result.match(/\d+/)?.[0] || '0', 10)

      expect(extractedNumber).to.satisfy((n: number) => n >= 1 && n <= 10)
    })

    it('should validate multiple AI calls have consistent types', async () => {
      const results = await Promise.all([
        ai`First response`,
        ai`Second response`,
        ai`Third response`,
      ])

      results.forEach((result) => {
        expect(result).to.be.a('string')
        expect(result).to.not.be.empty
      })

      expect(results).to.have.lengthOf(3)
    })

    it('should validate AI error handling', async () => {
      // Test that AI gracefully handles edge cases
      const emptyResult = await ai``

      expect(emptyResult).to.be.a('string')
      // Empty template should still produce valid response
      expect(emptyResult).to.exist
    })
  })

  describe('Vitest-Compatible Matchers with AI', () => {
    it('should use toBe for AI $meta properties', () => {
      const result = ai`Test`

      expect(result.$meta.model).toBe('default')
    })

    it('should use toEqual for deep AI response comparison', async () => {
      const result = await generateObject({
        prompt: 'Generate coordinates at origin',
        schema: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
          },
          required: ['x', 'y'],
        },
      })

      // If AI generates origin coordinates
      if (result.object.x === 0 && result.object.y === 0) {
        expect(result.object).toEqual({ x: 0, y: 0 })
      } else {
        expect(result.object).toHaveProperty('x')
        expect(result.object).toHaveProperty('y')
      }
    })

    it('should use toBeTruthy for AI response existence', async () => {
      const result = await ai`Generate something`

      expect(result).toBeTruthy()
    })

    it('should use toContain for AI response content', async () => {
      const result = await ai`Say the word "hello" in your response`

      expect(result.toLowerCase()).toContain('hello')
    })

    it('should use toMatch for AI response patterns', async () => {
      const result = await ai`Write a sentence.`

      // Most sentences should contain alphabetic characters
      expect(result).toMatch(/[a-zA-Z]/)
    })

    it('should use toHaveLength for AI array responses', async () => {
      const result = await generateObject({
        prompt: 'Generate a list of 3 colors',
        schema: {
          type: 'object',
          properties: {
            colors: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['colors'],
        },
      })

      expect(result.object.colors).toHaveLength(3)
    })

    it('should use toBeGreaterThan for AI numeric validation', async () => {
      const result = ai`Test`
      await result

      expect(result.$meta.duration).toBeGreaterThan(-1)
    })
  })
})
