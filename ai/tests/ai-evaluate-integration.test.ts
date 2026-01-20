/**
 * AI-Evaluate Integration Tests
 *
 * Tests @dotdo/ai integration with ai-evaluate for sandboxed code execution.
 * Verifies that AI template literals, generateText, and other AI functions
 * can be safely executed in sandboxed environments.
 *
 * @module ai/tests/ai-evaluate-integration.test
 * @issue do-zr1u.10
 */

import { describe, it, expect } from 'vitest'

// Import ai-evaluate/node for local testing with Miniflare fallback
// In production Cloudflare Workers, use ai-evaluate (worker_loaders)
import { evaluate, createEvaluator } from 'ai-evaluate/node'
import type { EvaluateResult } from 'ai-evaluate/node'

describe('AI-Evaluate Integration', () => {
  describe('evaluate() with @dotdo/ai module', () => {
    it('should evaluate AI template literal code in sandbox', async () => {
      const result = await evaluate({
        module: `
          export const greet = async (name) => {
            // Simulates AI template literal usage
            return \`Hello, \${name}! This is an AI-generated greeting.\`
          }
        `,
        script: `
          const greeting = await module.greet('World')
          return greeting
        `,
      })

      expect(result.success).toBe(true)
      expect(result.value).toContain('Hello, World!')
      expect(result.error).toBeUndefined()
    })

    it('should evaluate code that imports AI core functions', async () => {
      const result = await evaluate({
        sdk: true, // Enable SDK globals for AI access
        script: `
          // In sandbox, ai global provides AI functionality
          const response = await ai('What is 2 + 2?')
          return typeof response === 'string' && response.length > 0
        `,
      })

      expect(result.success).toBe(true)
      expect(result.value).toBe(true)
    })

    it('should execute AI-style streaming code', async () => {
      const result = await evaluate({
        module: `
          export async function* streamResponse(prompt) {
            const words = ['Hello', ' ', 'from', ' ', 'streaming', '!']
            for (const word of words) {
              yield word
            }
          }
        `,
        script: `
          const chunks = []
          for await (const chunk of module.streamResponse('test')) {
            chunks.push(chunk)
          }
          return chunks.join('')
        `,
      })

      expect(result.success).toBe(true)
      expect(result.value).toBe('Hello from streaming!')
    })

    it('should handle AI promise resolution in sandbox', async () => {
      const result = await evaluate({
        module: `
          export function createAIPromise(input) {
            const promise = Promise.resolve({
              text: \`Processed: \${input}\`,
              usage: { promptTokens: 10, completionTokens: 5 }
            })
            // Simulate AIPromise.$meta
            promise.$meta = { model: 'test', tokens: { input: 10, output: 5 } }
            return promise
          }
        `,
        script: `
          const result = await module.createAIPromise('hello')
          return {
            text: result.text,
            usage: result.usage
          }
        `,
      })

      expect(result.success).toBe(true)
      const value = result.value as { text: string; usage: { promptTokens: number; completionTokens: number } }
      expect(value.text).toBe('Processed: hello')
      expect(value.usage.promptTokens).toBe(10)
      expect(value.usage.completionTokens).toBe(5)
    })

    it('should capture console logs from AI operations', async () => {
      const result = await evaluate({
        script: `
          console.log('Starting AI operation')
          console.info('Model: test')
          console.warn('Token limit approaching')
          return 'done'
        `,
      })

      expect(result.success).toBe(true)
      expect(result.logs).toHaveLength(3)
      expect(result.logs[0].level).toBe('log')
      expect(result.logs[0].message).toContain('Starting AI operation')
      expect(result.logs[1].level).toBe('info')
      expect(result.logs[2].level).toBe('warn')
    })

    it('should handle AI errors gracefully', async () => {
      const result = await evaluate({
        script: `
          throw new Error('AI rate limit exceeded')
        `,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('AI rate limit exceeded')
    })

    it('should enforce timeout for long-running AI operations', async () => {
      const result = await evaluate({
        script: `
          await new Promise(resolve => setTimeout(resolve, 10000))
          return 'done'
        `,
        timeout: 100,
      })

      expect(result.success).toBe(false)
      // Timeout should cause failure
    })
  })

  describe('evaluate() with SDK globals', () => {
    it('should provide ai() function in sandbox with SDK enabled', async () => {
      const result = await evaluate({
        sdk: true,
        script: `
          // SDK provides global 'ai' function
          return typeof ai === 'function'
        `,
      })

      expect(result.success).toBe(true)
      expect(result.value).toBe(true)
    })

    it('should provide db global for AI-database integration', async () => {
      const result = await evaluate({
        sdk: true,
        script: `
          // SDK provides global 'db' for database operations
          return typeof db !== 'undefined'
        `,
      })

      expect(result.success).toBe(true)
      expect(result.value).toBe(true)
    })

    it('should execute AI with db integration', async () => {
      const result = await evaluate({
        sdk: {
          context: 'local', // Use in-memory implementation
          ns: 'test-ns',
        },
        script: `
          // Create a thing in the local database
          const user = await db.create({
            $type: 'User',
            name: 'Alice',
            email: 'alice@example.com'
          })

          // Use AI to generate a greeting for the user
          const greeting = await ai(\`Generate a greeting for \${user.data.name}\`)

          return {
            userId: user.id,
            userName: user.data.name,
            hasGreeting: typeof greeting === 'string' && greeting.length > 0
          }
        `,
      })

      expect(result.success).toBe(true)
      const value = result.value as { userId: string; userName: string; hasGreeting: boolean }
      expect(value.userId).toBeDefined()
      expect(value.userName).toBe('Alice')
      expect(value.hasGreeting).toBe(true)
    })

    it('should support $ workflow context', async () => {
      const result = await evaluate({
        sdk: true,
        script: `
          // SDK provides $ for workflow context
          return typeof $ !== 'undefined' && typeof $.send === 'function'
        `,
      })

      expect(result.success).toBe(true)
      expect(result.value).toBe(true)
    })
  })

  describe('evaluate() with tests', () => {
    it('should run vitest-style tests for AI code', async () => {
      const result = await evaluate({
        module: `
          export function tokenize(text) {
            return text.split(/\\s+/).filter(Boolean)
          }

          export function countTokens(text) {
            return tokenize(text).length
          }
        `,
        tests: `
          describe('tokenize', () => {
            it('should split text into tokens', () => {
              expect(module.tokenize('hello world')).toEqual(['hello', 'world'])
            })

            it('should handle multiple spaces', () => {
              expect(module.tokenize('hello   world')).toEqual(['hello', 'world'])
            })
          })

          describe('countTokens', () => {
            it('should count tokens correctly', () => {
              expect(module.countTokens('hello world')).toBe(2)
            })

            it('should return 0 for empty string', () => {
              expect(module.countTokens('')).toBe(0)
            })
          })
        `,
      })

      expect(result.success).toBe(true)
      expect(result.testResults).toBeDefined()
      expect(result.testResults!.total).toBe(4)
      expect(result.testResults!.passed).toBe(4)
      expect(result.testResults!.failed).toBe(0)
    })

    it('should report failing tests for AI code', async () => {
      const result = await evaluate({
        module: `
          export function generateResponse() {
            return 'wrong response'
          }
        `,
        tests: `
          describe('generateResponse', () => {
            it('should return expected response', () => {
              expect(module.generateResponse()).toBe('correct response')
            })
          })
        `,
      })

      // Tests ran but one failed
      expect(result.testResults).toBeDefined()
      expect(result.testResults!.failed).toBe(1)
    })

    it('should support async tests for AI operations', async () => {
      const result = await evaluate({
        module: `
          export async function fetchAIResponse(prompt) {
            await new Promise(r => setTimeout(r, 10))
            return \`Response to: \${prompt}\`
          }
        `,
        tests: `
          describe('fetchAIResponse', () => {
            it('should handle async AI calls', async () => {
              const response = await module.fetchAIResponse('hello')
              expect(response).toContain('Response to: hello')
            })
          })
        `,
      })

      expect(result.success).toBe(true)
      expect(result.testResults!.passed).toBe(1)
    })
  })

  describe('createEvaluator()', () => {
    it('should create a bound evaluator function', async () => {
      const sandbox = createEvaluator()

      const result = await sandbox({
        script: `return 1 + 1`,
      })

      expect(result.success).toBe(true)
      expect(result.value).toBe(2)
    })

    it('should allow multiple evaluations with same evaluator', async () => {
      const sandbox = createEvaluator()

      const result1 = await sandbox({ script: `return 'first'` })
      const result2 = await sandbox({ script: `return 'second'` })

      expect(result1.success).toBe(true)
      expect(result1.value).toBe('first')
      expect(result2.success).toBe(true)
      expect(result2.value).toBe('second')
    })

    it('should isolate state between evaluations', async () => {
      const sandbox = createEvaluator()

      // First evaluation sets a global
      await sandbox({
        script: `
          globalThis.__testValue__ = 'set'
          return 'done'
        `,
      })

      // Second evaluation should not see it (isolated)
      const result = await sandbox({
        script: `
          return globalThis.__testValue__ ?? 'not set'
        `,
      })

      expect(result.success).toBe(true)
      expect(result.value).toBe('not set')
    })
  })

  describe('Network isolation', () => {
    it('should allow fetch by default', async () => {
      const result = await evaluate({
        script: `
          return typeof fetch === 'function'
        `,
      })

      expect(result.success).toBe(true)
      expect(result.value).toBe(true)
    })

    it('should block network access when fetch: null', async () => {
      const result = await evaluate({
        script: `
          try {
            await fetch('https://example.com')
            return 'fetch succeeded'
          } catch (error) {
            return 'fetch blocked: ' + error.message
          }
        `,
        fetch: null,
      })

      expect(result.success).toBe(true)
      // When fetch is null, network should be blocked
      expect(result.value).toContain('fetch blocked')
    })
  })

  describe('AI code patterns', () => {
    it('should handle template literal interpolation', async () => {
      const result = await evaluate({
        module: `
          export function buildPrompt(template, ...values) {
            return template.reduce((acc, str, i) => {
              return acc + str + (values[i] ?? '')
            }, '')
          }
        `,
        script: `
          const prompt = module.buildPrompt(['Hello ', ', how are you?'], 'Alice')
          return prompt
        `,
      })

      expect(result.success).toBe(true)
      expect(result.value).toBe('Hello Alice, how are you?')
    })

    it('should handle structured output (generateObject pattern)', async () => {
      const result = await evaluate({
        module: `
          export async function generateStructured(schema, prompt) {
            // Simulate structured output generation
            return {
              object: {
                name: 'Generated Name',
                email: 'generated@example.com',
                age: 25
              },
              usage: { promptTokens: 15, completionTokens: 20 }
            }
          }
        `,
        script: `
          const result = await module.generateStructured(
            { name: 'string', email: 'string', age: 'number' },
            'Create a test user'
          )
          return result.object
        `,
      })

      expect(result.success).toBe(true)
      const obj = result.value as { name: string; email: string; age: number }
      expect(obj.name).toBe('Generated Name')
      expect(obj.email).toBe('generated@example.com')
      expect(obj.age).toBe(25)
    })

    it('should handle embedText pattern', async () => {
      const result = await evaluate({
        module: `
          export async function embedText(text) {
            // Simulate embedding generation
            const embedding = new Array(128).fill(0).map(() => Math.random())
            return embedding
          }
        `,
        script: `
          const embedding = await module.embedText('Hello world')
          return {
            isArray: Array.isArray(embedding),
            length: embedding.length
          }
        `,
      })

      expect(result.success).toBe(true)
      const value = result.value as { isArray: boolean; length: number }
      expect(value.isArray).toBe(true)
      expect(value.length).toBe(128)
    })

    it('should handle multi-turn conversation pattern', async () => {
      const result = await evaluate({
        module: `
          export function createConversation() {
            const messages = []
            return {
              addMessage(role, content) {
                messages.push({ role, content })
              },
              getMessages() {
                return messages
              },
              async generate() {
                return \`Response based on \${messages.length} messages\`
              }
            }
          }
        `,
        script: `
          const conv = module.createConversation()
          conv.addMessage('user', 'Hello')
          conv.addMessage('assistant', 'Hi there!')
          conv.addMessage('user', 'How are you?')

          const response = await conv.generate()
          return {
            messageCount: conv.getMessages().length,
            response
          }
        `,
      })

      expect(result.success).toBe(true)
      const value = result.value as { messageCount: number; response: string }
      expect(value.messageCount).toBe(3)
      expect(value.response).toContain('3 messages')
    })

    it('should handle tool/function calling pattern', async () => {
      const result = await evaluate({
        module: `
          export const tools = {
            calculator: {
              description: 'Perform arithmetic operations',
              parameters: { a: 'number', b: 'number', op: 'string' },
              execute({ a, b, op }) {
                switch (op) {
                  case 'add': return a + b
                  case 'sub': return a - b
                  case 'mul': return a * b
                  case 'div': return a / b
                  default: throw new Error('Unknown operation')
                }
              }
            }
          }

          export async function runWithTools(prompt, tools) {
            // Simulate tool calling
            const toolCall = { name: 'calculator', args: { a: 5, b: 3, op: 'add' } }
            const toolResult = tools[toolCall.name].execute(toolCall.args)
            return { toolCall, result: toolResult }
          }
        `,
        script: `
          const result = await module.runWithTools('What is 5 + 3?', module.tools)
          return result
        `,
      })

      expect(result.success).toBe(true)
      const value = result.value as { toolCall: { name: string }; result: number }
      expect(value.toolCall.name).toBe('calculator')
      expect(value.result).toBe(8)
    })
  })

  describe('Error handling patterns', () => {
    it('should handle rate limit errors', async () => {
      const result = await evaluate({
        module: `
          export async function callAI(prompt, { retries = 3, delay = 100 } = {}) {
            let lastError
            for (let i = 0; i < retries; i++) {
              try {
                if (i < 2) throw new Error('Rate limit exceeded')
                return 'Success after ' + (i + 1) + ' attempts'
              } catch (error) {
                lastError = error
                await new Promise(r => setTimeout(r, delay))
              }
            }
            throw lastError
          }
        `,
        script: `
          const result = await module.callAI('test', { retries: 3, delay: 10 })
          return result
        `,
      })

      expect(result.success).toBe(true)
      expect(result.value).toBe('Success after 3 attempts')
    })

    it('should handle timeout with AbortController', async () => {
      const result = await evaluate({
        module: `
          export async function callWithTimeout(fn, timeout) {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), timeout)

            try {
              const result = await Promise.race([
                fn(controller.signal),
                new Promise((_, reject) =>
                  controller.signal.addEventListener('abort', () =>
                    reject(new Error('Operation timed out'))
                  )
                )
              ])
              clearTimeout(timeoutId)
              return result
            } catch (error) {
              clearTimeout(timeoutId)
              throw error
            }
          }
        `,
        script: `
          try {
            await module.callWithTimeout(
              async () => {
                await new Promise(r => setTimeout(r, 1000))
                return 'done'
              },
              50
            )
            return 'completed'
          } catch (error) {
            return 'timeout: ' + error.message
          }
        `,
      })

      expect(result.success).toBe(true)
      expect(result.value).toContain('timeout')
    })
  })

  describe('Duration tracking', () => {
    it('should report execution duration', async () => {
      const result = await evaluate({
        script: `
          await new Promise(r => setTimeout(r, 50))
          return 'done'
        `,
      })

      expect(result.success).toBe(true)
      expect(result.duration).toBeGreaterThanOrEqual(50)
    })
  })
})
