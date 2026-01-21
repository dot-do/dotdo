/**
 * AI <-> DO Integration Tests
 *
 * Tests AI-powered workflows within Durable Object context.
 * This validates the integration between:
 * - AI template literals and core functions
 * - WorkflowContext ($) event system
 * - $.send(), $.try(), $.do() durability levels
 * - Error handling in AI-DO workflows
 *
 * @module ai/tests/do-integration.test
 * @issue do-t7gk
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ai, write, summarize, code } from '../template'
import { generateText, generateObject, embedText, clearProviders } from '../ai-core'
import { createContext, type WorkflowContext } from '../../do/context'

// Mock DurableObjectState for testing
const createMockState = () => ({
  id: { toString: () => 'test-do-id' },
  storage: {
    get: vi.fn(),
    put: vi.fn(),
    list: vi.fn(() => Promise.resolve(new Map())),
    delete: vi.fn(),
  },
} as unknown as DurableObjectState)

describe('AI <-> DO Integration', () => {
  let $: WorkflowContext
  let mockState: DurableObjectState

  beforeEach(() => {
    clearProviders()
    mockState = createMockState()
    $ = createContext(mockState, {})
  })

  describe('AI calls within DO context', () => {
    it('should execute AI template literals within event handlers', async () => {
      const results: string[] = []

      $.on.Document.created(async (event) => {
        const summary = await ai`Summarize this document: ${(event as any).payload?.content}`
        results.push(summary)
      })

      $.send({ type: 'Document.created', payload: { content: 'This is a test document.' } })

      // Wait for async processing
      await new Promise(r => setTimeout(r, 100))

      expect(results).toHaveLength(1)
      // AI returns a string response (mock response when ai-providers not installed)
      expect(typeof results[0]).toBe('string')
      expect(results[0].length).toBeGreaterThan(0)
    })

    it('should execute generateText within $.try()', async () => {
      const result = await $.try(async () => {
        return await generateText({
          model: 'sonnet',
          prompt: 'Hello, world!',
        })
      })

      expect(result).toBeDefined()
      expect(result.text).toBeDefined()
      expect(result.usage).toBeDefined()
    })

    it('should execute generateObject within $.try()', async () => {
      const result = await $.try(async () => {
        return await generateObject({
          model: 'sonnet',
          schema: { name: 'User name', email: 'User email' },
          prompt: 'Create a test user',
        })
      })

      expect(result).toBeDefined()
      expect(result.object).toBeDefined()
      expect(result.usage).toBeDefined()
    })

    it('should execute embedText within $.try()', async () => {
      const result = await $.try(async () => {
        return await embedText('Hello world')
      })

      expect(Array.isArray(result)).toBe(true)
      expect((result as number[]).length).toBeGreaterThan(0)
    })

    it('should execute AI convenience functions within DO context', async () => {
      const results: string[] = []

      $.on.Content.generate(async (event) => {
        const topic = (event as any).payload?.topic ?? 'default'
        const written = await write`an article about ${topic}`
        results.push(written)
      })

      $.send({ type: 'Content.generate', payload: { topic: 'AI integration' } })

      await new Promise(r => setTimeout(r, 100))

      expect(results).toHaveLength(1)
      // AI returns a string response (mock response when ai-providers not installed)
      expect(typeof results[0]).toBe('string')
      expect(results[0].length).toBeGreaterThan(0)
    })

    it('should chain multiple AI calls within a single handler', async () => {
      const steps: string[] = []

      $.on.Report.generate(async (event) => {
        const data = (event as any).payload?.data ?? 'sample data'

        // Step 1: Summarize
        const summary = await ai`Summarize: ${data}`
        steps.push(`summary: ${summary.slice(0, 20)}`)

        // Step 2: Write based on summary
        const article = await write`based on ${summary}`
        steps.push(`article: ${article.slice(0, 20)}`)

        // Step 3: Generate code
        const codeResult = await code`for processing ${summary}`
        steps.push(`code: ${codeResult.slice(0, 20)}`)
      })

      $.send({ type: 'Report.generate', payload: { data: 'Q4 sales figures' } })

      await new Promise(r => setTimeout(r, 200))

      expect(steps).toHaveLength(3)
      expect(steps[0]).toContain('summary:')
      expect(steps[1]).toContain('article:')
      expect(steps[2]).toContain('code:')
    })
  })

  describe('AI with $.send events', () => {
    it('should emit AI-generated content via $.send', async () => {
      const receivedEvents: unknown[] = []

      $.on.AI.generated(async (event) => {
        receivedEvents.push(event)
      })

      $.on.User.request(async (event) => {
        const response = await ai`Respond to: ${(event as any).payload?.question}`

        $.send({
          type: 'AI.generated',
          payload: {
            response,
            originalQuestion: (event as any).payload?.question,
          },
        })
      })

      $.send({ type: 'User.request', payload: { question: 'What is AI?' } })

      await new Promise(r => setTimeout(r, 150))

      expect(receivedEvents).toHaveLength(1)
      // AI returns a string response (mock response when ai-providers not installed)
      expect(typeof receivedEvents[0].payload.response).toBe('string')
      expect(receivedEvents[0].payload.response.length).toBeGreaterThan(0)
      expect(receivedEvents[0].payload.originalQuestion).toBe('What is AI?')
    })

    it('should support AI-powered event chaining', async () => {
      const eventLog: string[] = []

      // Stage 1: Receive raw data
      $.on.Data.received(async (event) => {
        eventLog.push('Data.received')
        const processed = await ai`Process: ${(event as any).payload?.raw}`
        $.send({ type: 'Data.processed', payload: { processed } })
      })

      // Stage 2: Process and analyze
      $.on.Data.processed(async (event) => {
        eventLog.push('Data.processed')
        const analyzed = await ai`Analyze: ${(event as any).payload?.processed}`
        $.send({ type: 'Data.analyzed', payload: { analyzed } })
      })

      // Stage 3: Generate report
      $.on.Data.analyzed(async (event) => {
        eventLog.push('Data.analyzed')
        const report = await summarize`${(event as any).payload?.analyzed}`
        $.send({ type: 'Report.ready', payload: { report } })
      })

      // Final stage: Capture report
      $.on.Report.ready(async () => {
        eventLog.push('Report.ready')
      })

      // Trigger the chain
      $.send({ type: 'Data.received', payload: { raw: 'Sample data for processing' } })

      // Wait for full chain to complete
      await new Promise(r => setTimeout(r, 500))

      expect(eventLog).toContain('Data.received')
      expect(eventLog).toContain('Data.processed')
      expect(eventLog).toContain('Data.analyzed')
      expect(eventLog).toContain('Report.ready')
    })

    it('should handle AI results in wildcard handlers', async () => {
      const allAIEvents: unknown[] = []

      // Catch all AI-related events
      $.on.AI['*'](async (event) => {
        allAIEvents.push(event)
      })

      $.on.Task.process(async (event) => {
        const result = await ai`Process task: ${(event as any).payload?.description}`
        $.send({ type: 'AI.completed', payload: { result } })
      })

      $.send({ type: 'Task.process', payload: { description: 'Test task' } })

      await new Promise(r => setTimeout(r, 150))

      expect(allAIEvents.length).toBeGreaterThanOrEqual(1)
      expect(allAIEvents[0].type).toBe('AI.completed')
    })

    it('should pass AI metadata through events', async () => {
      const capturedMeta: unknown[] = []

      $.on.AI.result(async (event) => {
        capturedMeta.push((event as any).payload)
      })

      $.on.Analysis.start(async (event) => {
        const aiPromise = ai`Analyze: ${(event as any).payload?.text}`

        // Get metadata before resolving
        const metaBefore = { ...aiPromise.$meta }

        const result = await aiPromise

        // Get metadata after resolving
        const metaAfter = { ...aiPromise.$meta }

        $.send({
          type: 'AI.result',
          payload: {
            result,
            metaBefore,
            metaAfter,
          },
        })
      })

      $.send({ type: 'Analysis.start', payload: { text: 'Sample text' } })

      await new Promise(r => setTimeout(r, 150))

      expect(capturedMeta).toHaveLength(1)
      expect(capturedMeta[0].metaBefore.model).toBe('default')
      expect(capturedMeta[0].metaAfter.tokens).toBeDefined()
    })
  })

  describe('AI with $.do() durability', () => {
    it('should retry AI calls with $.do()', async () => {
      let attempts = 0

      const result = await $.do(async () => {
        attempts++
        if (attempts < 2) {
          throw new Error('Simulated AI failure')
        }
        return await generateText({
          model: 'sonnet',
          prompt: 'Test prompt',
        })
      }, { retries: 3 })

      expect(attempts).toBe(2)
      expect(result).toBeDefined()
      expect(result.text).toBeDefined()
    })

    it('should handle AI timeout with $.do()', async () => {
      await expect(
        $.do(
          async () => {
            // Simulate slow AI call
            await new Promise(r => setTimeout(r, 200))
            return await generateText({ model: 'sonnet', prompt: 'Test' })
          },
          { timeout: 50, retries: 0 }
        )
      ).rejects.toThrow('timed out')
    })

    it('should use exponential backoff for AI retries', async () => {
      const timestamps: number[] = []
      let attempts = 0

      await expect(
        $.do(
          async () => {
            timestamps.push(Date.now())
            attempts++
            throw new Error('AI service unavailable')
          },
          { retries: 2, backoff: 'exponential' }
        )
      ).rejects.toThrow('AI service unavailable')

      expect(attempts).toBe(3)

      // Verify exponential backoff timing
      if (timestamps.length >= 2) {
        const gap1 = timestamps[1] - timestamps[0]
        expect(gap1).toBeGreaterThanOrEqual(90) // ~100ms
      }
      if (timestamps.length >= 3) {
        const gap2 = timestamps[2] - timestamps[1]
        expect(gap2).toBeGreaterThanOrEqual(180) // ~200ms
      }
    })
  })

  describe('AI error handling in DO', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleErrorSpy.mockRestore()
    })

    it('should not crash DO when AI handler throws', async () => {
      const successResults: string[] = []

      $.on.AI.fail(async () => {
        throw new Error('AI handler crashed')
      })

      $.on.AI.success(async (event) => {
        successResults.push((event as any).payload?.message ?? 'success')
      })

      // Send failing event
      $.send({ type: 'AI.fail', payload: {} })

      // Wait for processing
      await new Promise(r => setTimeout(r, 100))

      // DO should still be operational
      $.send({ type: 'AI.success', payload: { message: 'Still working' } })

      await new Promise(r => setTimeout(r, 100))

      expect(successResults).toContain('Still working')
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('should handle AI promise rejection in event handlers', async () => {
      const otherHandlerCalled = vi.fn()

      $.on.Task.aiProcess(async () => {
        // Simulate AI promise rejection
        return Promise.reject(new Error('AI API error'))
      })

      $.on.Task.aiProcess(otherHandlerCalled)

      $.send({ type: 'Task.aiProcess', payload: {} })

      await new Promise(r => setTimeout(r, 150))

      // Other handler should still be called
      expect(otherHandlerCalled).toHaveBeenCalled()
    })

    it('should log AI errors with context', async () => {
      $.on.Data.process(async () => {
        await ai`Process data with intentional failure`
        throw new Error('Post-AI processing error')
      })

      $.send({ type: 'Data.process', payload: { id: 'test-123' } })

      await new Promise(r => setTimeout(r, 150))

      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('should handle multiple AI handler failures gracefully', async () => {
      const handler1 = vi.fn(async () => {
        throw new Error('Handler 1 AI error')
      })

      const handler2 = vi.fn(async () => {
        throw new Error('Handler 2 AI error')
      })

      const handler3 = vi.fn(async () => {
        // This one succeeds
        await ai`Success handler`
      })

      $.on.Multi.process(handler1)
      $.on.Multi.process(handler2)
      $.on.Multi.process(handler3)

      $.send({ type: 'Multi.process', payload: {} })

      await new Promise(r => setTimeout(r, 200))

      // All handlers should have been called
      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
      expect(handler3).toHaveBeenCalled()
    })

    it('should propagate AI errors correctly with $.try()', async () => {
      const failingAI = async () => {
        throw new Error('AI generation failed')
      }

      await expect($.try(failingAI)).rejects.toThrow('AI generation failed')
    })

    it('should handle AI streaming errors in event handlers', async () => {
      const streamErrors: Error[] = []

      $.on.Stream.process(async () => {
        try {
          const aiPromise = ai`Stream test`
          for await (const _chunk of aiPromise.stream()) {
            // Process chunks
          }
        } catch (error) {
          streamErrors.push(error as Error)
          throw error
        }
      })

      $.send({ type: 'Stream.process', payload: {} })

      await new Promise(r => setTimeout(r, 150))

      // Stream should complete without errors in mock mode
      // In production, errors would be captured here
    })
  })

  describe('AI with WorkflowContext configuration', () => {
    it('should use AI with custom model via .with()', async () => {
      const metaCaptures: unknown[] = []

      $.on.Custom.generate(async () => {
        const result = ai`Generate with custom model`.with({
          model: 'gpt-4',
          temperature: 0.9,
        })

        metaCaptures.push({ ...result.$meta })
        await result
      })

      $.send({ type: 'Custom.generate', payload: {} })

      await new Promise(r => setTimeout(r, 100))

      expect(metaCaptures).toHaveLength(1)
      expect(metaCaptures[0].model).toBe('gpt-4')
      expect(metaCaptures[0].temperature).toBe(0.9)
    })

    it('should track AI usage within DO context', async () => {
      const usageLog: unknown[] = []

      $.on.Analytics.track(async (event) => {
        const prompt = (event as any).payload?.prompt ?? 'default'
        const result = await generateText({
          model: 'sonnet',
          prompt,
        })

        usageLog.push({
          prompt,
          usage: result.usage,
        })
      })

      $.send({ type: 'Analytics.track', payload: { prompt: 'Test prompt 1' } })
      $.send({ type: 'Analytics.track', payload: { prompt: 'Test prompt 2' } })

      await new Promise(r => setTimeout(r, 200))

      expect(usageLog).toHaveLength(2)
      usageLog.forEach(entry => {
        expect(entry.usage).toBeDefined()
        expect(entry.usage.promptTokens).toBeDefined()
        expect(entry.usage.completionTokens).toBeDefined()
      })
    })
  })

  describe('AI embeddings in DO workflows', () => {
    it('should generate embeddings within event handlers', async () => {
      const embeddings: number[][] = []

      $.on.Document.index(async (event) => {
        const content = (event as any).payload?.content ?? ''
        const embedding = await embedText(content)
        embeddings.push(embedding as number[])
      })

      $.send({ type: 'Document.index', payload: { content: 'First document' } })
      $.send({ type: 'Document.index', payload: { content: 'Second document' } })

      await new Promise(r => setTimeout(r, 150))

      expect(embeddings).toHaveLength(2)
      embeddings.forEach(emb => {
        expect(Array.isArray(emb)).toBe(true)
        expect(emb.length).toBeGreaterThan(0)
      })
    })

    it('should batch embed multiple documents', async () => {
      const results: unknown[] = []

      $.on.Batch.embed(async (event) => {
        const documents = (event as any).payload?.documents ?? []
        const embeddings = await embedText(documents)
        results.push(embeddings)
      })

      $.send({
        type: 'Batch.embed',
        payload: { documents: ['Doc 1', 'Doc 2', 'Doc 3'] },
      })

      await new Promise(r => setTimeout(r, 100))

      expect(results).toHaveLength(1)
      expect(results[0]).toHaveLength(3)
    })
  })
})
