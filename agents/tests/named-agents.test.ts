import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { priya, ralph, tom } from '../named'

describe('Named Agents - Real AI Execution', () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY

  beforeAll(() => {
    // Set a fake API key to bypass the "no API key" error
    // This allows us to test that the placeholder is being returned
    // (which should FAIL - we want real AI responses, not placeholders)
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key-for-tdd'
  })

  afterAll(() => {
    // Restore original API key
    if (originalApiKey) {
      process.env.ANTHROPIC_API_KEY = originalApiKey
    } else {
      delete process.env.ANTHROPIC_API_KEY
    }
  })

  it('should execute real AI call, not return placeholder', async () => {
    const result = await priya`define a simple MVP for a todo app`

    // Should NOT contain placeholder text
    expect(result).not.toContain('[Priya] Would process:')
    expect(result).not.toContain('placeholder')

    // Should be actual AI response with substance
    expect(result.length).toBeGreaterThan(100)
    expect(result.toLowerCase()).toMatch(/feature|user|task|list|mvp/i)
  })

  it('should support streaming responses', async () => {
    const chunks: string[] = []

    // Assuming the API supports async iteration for streaming
    const response = ralph`write a hello world function in TypeScript`

    if (Symbol.asyncIterator in Object(response)) {
      for await (const chunk of response as AsyncIterable<string>) {
        chunks.push(chunk)
      }
      expect(chunks.length).toBeGreaterThan(1)
    } else {
      // If not streaming, at least verify it returns content
      const result = await response
      expect(result.length).toBeGreaterThan(50)
    }
  })

  it('should maintain conversation context', async () => {
    // First message establishes context
    await priya`I'm building an app called TaskMaster for project management`

    // Second message should remember context
    const result = await priya`What is my app called?`

    expect(result.toLowerCase()).toContain('taskmaster')
  })

  it('tom.approve should return structured review', async () => {
    const review = await tom.approve?.({
      code: 'const x = 1',
      file: 'test.ts'
    })

    expect(review).toBeDefined()
    expect(review).toHaveProperty('approved')
    expect(typeof review.approved).toBe('boolean')
  })
})
