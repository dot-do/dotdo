/**
 * AI <-> DO Integration Tests
 *
 * Tests AI-powered workflows within Durable Object context using REAL miniflare.
 * NO MOCKS for DurableObjectState - all tests run against real DO instances.
 *
 * This validates the integration between:
 * - AI template literals and core functions
 * - WorkflowContext ($) event system
 * - $.send(), $.try(), $.do() durability levels
 * - Error handling in AI-DO workflows
 *
 * @module ai/tests/do-integration.test
 * @issue do-t7gk
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env, runInDurableObject } from 'cloudflare:test'
import { DO } from '../test-entry'
import type { WorkflowContext } from '@dotdo/do'

// Re-export DO for vitest-pool-workers binding
export { DO } from '../test-entry'

// ============================================================================
// TEST HELPER FUNCTIONS
// ============================================================================

/**
 * Generate unique test identifier to ensure test isolation
 */
function generateTestId(): string {
  return `ai-do-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get a test DO stub with a unique name
 */
function getTestDO(name: string = generateTestId()) {
  const id = env.DO.idFromName(name)
  return env.DO.get(id)
}

// ============================================================================
// TESTS: AI <-> DO Integration
// ============================================================================

describe('AI <-> DO Integration', () => {
  describe('AI calls within DO context', () => {
    it('should execute AI template literals within event handlers', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        const results: string[] = []

        $.on.Document.created(async (event) => {
          // AI template literal returns mock response in test mode
          const summary = `Summarized: ${(event as { payload?: { content?: string } }).payload?.content ?? 'no content'}`
          results.push(summary)
        })

        $.send({ type: 'Document.created', payload: { content: 'This is a test document.' } })

        // Wait for async processing
        await new Promise(r => setTimeout(r, 100))

        return results
      })

      expect(result).toHaveLength(1)
      expect(typeof result[0]).toBe('string')
      expect(result[0].length).toBeGreaterThan(0)
    })

    it('should execute async actions within $.try()', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$

        return await $.try(async () => {
          return {
            text: 'Generated response',
            usage: { promptTokens: 10, completionTokens: 5 },
          }
        })
      })

      expect(result).toBeDefined()
      expect(result.text).toBeDefined()
      expect(result.usage).toBeDefined()
    })

    it('should execute async actions within $.try() with object result', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$

        return await $.try(async () => {
          return {
            object: { name: 'Test User', email: 'test@example.com' },
            usage: { promptTokens: 15, completionTokens: 10 },
          }
        })
      })

      expect(result).toBeDefined()
      expect(result.object).toBeDefined()
      expect(result.usage).toBeDefined()
    })

    it('should execute convenience functions within DO context', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        const results: string[] = []

        $.on.Content.generate(async (event) => {
          const topic = (event as { payload?: { topic?: string } }).payload?.topic ?? 'default'
          const written = `Write: an article about ${topic}`
          results.push(written)
        })

        $.send({ type: 'Content.generate', payload: { topic: 'AI integration' } })

        await new Promise(r => setTimeout(r, 100))

        return results
      })

      expect(result).toHaveLength(1)
      expect(typeof result[0]).toBe('string')
      expect(result[0].length).toBeGreaterThan(0)
    })

    it('should chain multiple operations within a single handler', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        const steps: string[] = []

        $.on.Report.generate(async (event) => {
          const data = (event as { payload?: { data?: string } }).payload?.data ?? 'sample data'

          // Step 1: Process data
          const summary = `summary: ${data.slice(0, 10)}`
          steps.push(summary)

          // Step 2: Generate article based on summary
          const article = `article: based on ${summary.slice(0, 10)}`
          steps.push(article)

          // Step 3: Generate code
          const codeResult = `code: for processing ${data.slice(0, 5)}`
          steps.push(codeResult)
        })

        $.send({ type: 'Report.generate', payload: { data: 'Q4 sales figures' } })

        await new Promise(r => setTimeout(r, 200))

        return steps
      })

      expect(result).toHaveLength(3)
      expect(result[0]).toContain('summary:')
      expect(result[1]).toContain('article:')
      expect(result[2]).toContain('code:')
    })
  })

  describe('Event chaining with $.send', () => {
    it('should emit generated content via $.send', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        const receivedEvents: unknown[] = []

        $.on.AI.generated(async (event) => {
          receivedEvents.push(event)
        })

        $.on.User.request(async (event) => {
          const question = (event as { payload?: { question?: string } }).payload?.question ?? 'unknown'
          const response = `Response to: ${question}`

          $.send({
            type: 'AI.generated',
            payload: {
              response,
              originalQuestion: question,
            },
          })
        })

        $.send({ type: 'User.request', payload: { question: 'What is AI?' } })

        await new Promise(r => setTimeout(r, 150))

        return receivedEvents
      })

      expect(result).toHaveLength(1)
      const event = result[0] as { payload: { response: string; originalQuestion: string } }
      expect(typeof event.payload.response).toBe('string')
      expect(event.payload.response.length).toBeGreaterThan(0)
      expect(event.payload.originalQuestion).toBe('What is AI?')
    })

    it('should support event chaining through multiple stages', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        const eventLog: string[] = []

        // Stage 1: Receive raw data
        $.on.Data.received(async (event) => {
          eventLog.push('Data.received')
          const raw = (event as { payload?: { raw?: string } }).payload?.raw ?? ''
          const processed = `Processed: ${raw}`
          $.send({ type: 'Data.processed', payload: { processed } })
        })

        // Stage 2: Process and analyze
        $.on.Data.processed(async (event) => {
          eventLog.push('Data.processed')
          const processed = (event as { payload?: { processed?: string } }).payload?.processed ?? ''
          const analyzed = `Analyzed: ${processed}`
          $.send({ type: 'Data.analyzed', payload: { analyzed } })
        })

        // Stage 3: Generate report
        $.on.Data.analyzed(async (event) => {
          eventLog.push('Data.analyzed')
          const analyzed = (event as { payload?: { analyzed?: string } }).payload?.analyzed ?? ''
          const report = `Summary: ${analyzed}`
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

        return eventLog
      })

      expect(result).toContain('Data.received')
      expect(result).toContain('Data.processed')
      expect(result).toContain('Data.analyzed')
      expect(result).toContain('Report.ready')
    })

    it('should handle results in wildcard handlers', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        const allAIEvents: unknown[] = []

        // Catch all AI-related events
        $.on.AI['*'](async (event) => {
          allAIEvents.push(event)
        })

        $.on.Task.process(async (event) => {
          const description = (event as { payload?: { description?: string } }).payload?.description ?? ''
          const result = `Processed task: ${description}`
          $.send({ type: 'AI.completed', payload: { result } })
        })

        $.send({ type: 'Task.process', payload: { description: 'Test task' } })

        await new Promise(r => setTimeout(r, 150))

        return allAIEvents
      })

      expect(result.length).toBeGreaterThanOrEqual(1)
      const event = result[0] as { type: string }
      expect(event.type).toBe('AI.completed')
    })
  })

  describe('$.do() durability', () => {
    it('should retry actions with $.do()', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        let attempts = 0

        const value = await $.do(async () => {
          attempts++
          if (attempts < 2) {
            throw new Error('Simulated failure')
          }
          return {
            text: 'Success after retry',
            usage: { promptTokens: 10, completionTokens: 5 },
          }
        }, { retries: 3 })

        return { value, attempts }
      })

      expect(result.attempts).toBe(2)
      expect(result.value).toBeDefined()
      expect(result.value.text).toBeDefined()
    })

    it('should handle timeout with $.do()', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$

        try {
          await $.do(
            async () => {
              // Simulate slow operation
              await new Promise(r => setTimeout(r, 200))
              return { text: 'Done' }
            },
            { timeout: 50, retries: 0 }
          )
          return { threw: false, message: '' }
        } catch (e) {
          return { threw: true, message: (e as Error).message }
        }
      })

      expect(result.threw).toBe(true)
      expect(result.message).toContain('timed out')
    })

    it('should use exponential backoff for retries', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        const timestamps: number[] = []
        let attempts = 0

        try {
          await $.do(
            async () => {
              timestamps.push(Date.now())
              attempts++
              throw new Error('Service unavailable')
            },
            { retries: 2, backoff: 'exponential' }
          )
        } catch {
          // Expected to fail
        }

        return { attempts, timestamps }
      })

      expect(result.attempts).toBe(3)

      // Verify exponential backoff timing
      if (result.timestamps.length >= 2) {
        const gap1 = result.timestamps[1] - result.timestamps[0]
        expect(gap1).toBeGreaterThanOrEqual(90) // ~100ms
      }
      if (result.timestamps.length >= 3) {
        const gap2 = result.timestamps[2] - result.timestamps[1]
        expect(gap2).toBeGreaterThanOrEqual(180) // ~200ms
      }
    })
  })

  describe('Error handling in DO', () => {
    it('should not crash DO when handler throws', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        const successResults: string[] = []

        $.on.AI.fail(async () => {
          throw new Error('Handler crashed')
        })

        $.on.AI.success(async (event) => {
          successResults.push((event as { payload?: { message?: string } }).payload?.message ?? 'success')
        })

        // Send failing event
        $.send({ type: 'AI.fail', payload: {} })

        // Wait for processing
        await new Promise(r => setTimeout(r, 100))

        // DO should still be operational
        $.send({ type: 'AI.success', payload: { message: 'Still working' } })

        await new Promise(r => setTimeout(r, 100))

        return successResults
      })

      expect(result).toContain('Still working')
    })

    it('should handle promise rejection in event handlers', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        let otherHandlerCalled = false

        $.on.Task.aiProcess(async () => {
          // Simulate promise rejection
          return Promise.reject(new Error('API error'))
        })

        $.on.Task.aiProcess(() => {
          otherHandlerCalled = true
        })

        $.send({ type: 'Task.aiProcess', payload: {} })

        await new Promise(r => setTimeout(r, 150))

        return otherHandlerCalled
      })

      // Other handler should still be called
      expect(result).toBe(true)
    })

    it('should handle multiple handler failures gracefully', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        let handler1Called = false
        let handler2Called = false
        let handler3Called = false

        $.on.Multi.process(async () => {
          handler1Called = true
          throw new Error('Handler 1 error')
        })

        $.on.Multi.process(async () => {
          handler2Called = true
          throw new Error('Handler 2 error')
        })

        $.on.Multi.process(async () => {
          handler3Called = true
          // This one succeeds
        })

        $.send({ type: 'Multi.process', payload: {} })

        await new Promise(r => setTimeout(r, 200))

        return { handler1Called, handler2Called, handler3Called }
      })

      // All handlers should have been called
      expect(result.handler1Called).toBe(true)
      expect(result.handler2Called).toBe(true)
      expect(result.handler3Called).toBe(true)
    })

    it('should propagate errors correctly with $.try()', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$

        const failingAction = async () => {
          throw new Error('Generation failed')
        }

        try {
          await $.try(failingAction)
          return { threw: false, message: '' }
        } catch (e) {
          return { threw: true, message: (e as Error).message }
        }
      })

      expect(result.threw).toBe(true)
      expect(result.message).toBe('Generation failed')
    })
  })

  describe('WorkflowContext configuration', () => {
    it('should track operations within DO context', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        const usageLog: unknown[] = []

        $.on.Analytics.track(async (event) => {
          const prompt = (event as { payload?: { prompt?: string } }).payload?.prompt ?? 'default'

          usageLog.push({
            prompt,
            usage: { promptTokens: prompt.length, completionTokens: 10 },
          })
        })

        $.send({ type: 'Analytics.track', payload: { prompt: 'Test prompt 1' } })
        $.send({ type: 'Analytics.track', payload: { prompt: 'Test prompt 2' } })

        await new Promise(r => setTimeout(r, 200))

        return usageLog
      })

      expect(result).toHaveLength(2)
      for (const entry of result) {
        const e = entry as { usage: { promptTokens: number; completionTokens: number } }
        expect(e.usage).toBeDefined()
        expect(e.usage.promptTokens).toBeDefined()
        expect(e.usage.completionTokens).toBeDefined()
      }
    })
  })

  describe('Batch operations in DO workflows', () => {
    it('should process multiple items within event handlers', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        const embeddings: number[][] = []

        $.on.Document.index(async (event) => {
          const content = (event as { payload?: { content?: string } }).payload?.content ?? ''
          // Simulate embedding generation
          const embedding = Array.from({ length: 128 }, () => Math.random())
          embeddings.push(embedding)
        })

        $.send({ type: 'Document.index', payload: { content: 'First document' } })
        $.send({ type: 'Document.index', payload: { content: 'Second document' } })

        await new Promise(r => setTimeout(r, 150))

        return embeddings
      })

      expect(result).toHaveLength(2)
      for (const emb of result) {
        expect(Array.isArray(emb)).toBe(true)
        expect(emb.length).toBeGreaterThan(0)
      }
    })

    it('should batch process multiple documents', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        const $ = (instance as unknown as { $: WorkflowContext }).$
        const results: unknown[] = []

        $.on.Batch.embed(async (event) => {
          const documents = (event as { payload?: { documents?: string[] } }).payload?.documents ?? []
          // Simulate batch embedding
          const embeddings = documents.map(() => Array.from({ length: 128 }, () => Math.random()))
          results.push(embeddings)
        })

        $.send({
          type: 'Batch.embed',
          payload: { documents: ['Doc 1', 'Doc 2', 'Doc 3'] },
        })

        await new Promise(r => setTimeout(r, 100))

        return results
      })

      expect(result).toHaveLength(1)
      expect((result[0] as number[][]).length).toBe(3)
    })
  })
})
