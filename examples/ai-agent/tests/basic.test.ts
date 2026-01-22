/**
 * AI Agent Example - Basic Smoke Tests
 *
 * Tests using @cloudflare/vitest-pool-workers with real Durable Objects.
 * NO MOCKS - per CLAUDE.md guidelines.
 *
 * Verifies:
 * - DO instantiation works
 * - Basic CRUD operations work
 * - No TypeScript errors
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'

// Type definitions for API responses
interface Tool {
  $id: string
  $type: string
  name: string
  enabled: boolean
}

interface AgentConfig {
  name: string
  systemPrompt: string
  model: string
}

// Helper to get a fresh DO stub
function getStub(name?: string) {
  const testName = name ?? `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const id = env.AGENT.idFromName(testName)
  return env.AGENT.get(id)
}

describe('AgentDO', () => {
  describe('instantiation', () => {
    it('should create a new DO instance', async () => {
      const stub = getStub()
      expect(stub).toBeDefined()
    })

    it('should respond to basic requests', async () => {
      const stub = getStub()
      const response = await stub.fetch('https://agent/')

      expect(response.status).toBe(200)
    })
  })

  describe('conversations API', () => {
    it('should list conversations', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://agent/conversations')
      expect(response.status).toBe(200)

      const conversations = await response.json()
      expect(Array.isArray(conversations)).toBe(true)
    })
  })

  describe('memory API', () => {
    it('should list memories', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://agent/memory')
      expect(response.status).toBe(200)

      const memories = await response.json()
      expect(Array.isArray(memories)).toBe(true)
    })
  })

  describe('tools API', () => {
    it('should list available tools', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://agent/tools')
      expect(response.status).toBe(200)

      const tools = (await response.json()) as Tool[]
      expect(Array.isArray(tools)).toBe(true)
      // Built-in tools should be present
      expect(tools.length).toBeGreaterThan(0)
    })

    it('should execute calculator tool', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://agent/tools/calculate/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expression: '2 + 2' }),
      })

      expect(response.status).toBe(200)
      const result = (await response.json()) as { success: boolean; result: { result: number } }
      expect(result.success).toBe(true)
      expect(result.result.result).toBe(4)
    })
  })

  describe('config API', () => {
    it('should return default config', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://agent/config')
      expect(response.status).toBe(200)

      const config = (await response.json()) as AgentConfig
      expect(config.name).toBeDefined()
      expect(config.systemPrompt).toBeDefined()
      expect(config.model).toBeDefined()
    })
  })

  describe('tasks API', () => {
    it('should list tasks', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://agent/tasks')
      expect(response.status).toBe(200)

      const tasks = await response.json()
      expect(Array.isArray(tasks)).toBe(true)
    })
  })

  describe('notes API', () => {
    it('should list notes', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://agent/notes')
      expect(response.status).toBe(200)

      const notes = await response.json()
      expect(Array.isArray(notes)).toBe(true)
    })
  })
})
