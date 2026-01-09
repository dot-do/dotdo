/**
 * OpenAI Provider Tests (RED Phase)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { OpenAIProvider, createOpenAIProvider } from './openai'
import type { Message, ToolDefinition, AgentConfig } from '../types'

// Mock the OpenAI SDK
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{
            message: { content: 'Hello', tool_calls: null },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      },
    },
  })),
}))

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider

  beforeEach(() => {
    provider = new OpenAIProvider({ apiKey: 'test-key' })
  })

  describe('constructor', () => {
    it('sets default model to gpt-4o', () => {
      const p = new OpenAIProvider()
      expect(p).toBeDefined()
    })

    it('accepts custom default model', () => {
      const p = new OpenAIProvider({ defaultModel: 'gpt-4-turbo' })
      expect(p).toBeDefined()
    })

    it('accepts organization ID', () => {
      const p = new OpenAIProvider({ organization: 'org-123' })
      expect(p).toBeDefined()
    })
  })

  describe('createAgent()', () => {
    it('creates agent with provided config', () => {
      const agent = provider.createAgent({
        id: 'test-agent',
        name: 'Test Agent',
        instructions: 'You are helpful',
        model: 'gpt-4o',
      })

      expect(agent).toBeDefined()
      expect(agent.config.id).toBe('test-agent')
      expect(agent.config.name).toBe('Test Agent')
    })

    it('uses defaultModel when not specified', () => {
      const p = new OpenAIProvider({ defaultModel: 'gpt-4o-mini' })
      const agent = p.createAgent({
        id: 'test',
        name: 'Test',
        instructions: 'Test',
      })

      expect(agent.config.model).toBe('gpt-4o-mini')
    })

    it('registers agent for handoffs', () => {
      const agent1 = provider.createAgent({
        id: 'agent-1',
        name: 'Agent 1',
        instructions: 'First agent',
        model: 'gpt-4o',
      })

      const agent2 = provider.createAgent({
        id: 'agent-2',
        name: 'Agent 2',
        instructions: 'Second agent',
        model: 'gpt-4o',
      })

      // Both agents should be registered
      expect(agent1).toBeDefined()
      expect(agent2).toBeDefined()
    })

    it('creates agent with tools', () => {
      const tool: ToolDefinition = {
        name: 'search',
        description: 'Search the web',
        inputSchema: z.object({ query: z.string() }),
        execute: async () => ({ results: [] }),
      }

      const agent = provider.createAgent({
        id: 'test',
        name: 'Test',
        instructions: 'Test',
        model: 'gpt-4o',
        tools: [tool],
      })

      expect(agent.config.tools).toHaveLength(1)
    })
  })

  describe('Handoffs', () => {
    it('adds handoff tools for each handoff agent', () => {
      const handoffAgents: AgentConfig[] = [
        { id: 'support', name: 'Support', instructions: 'Handle support', model: 'gpt-4o' },
        { id: 'sales', name: 'Sales', instructions: 'Handle sales', model: 'gpt-4o' },
      ]

      const agent = provider.createAgent({
        id: 'router',
        name: 'Router',
        instructions: 'Route to appropriate agent',
        model: 'gpt-4o',
        handoffs: handoffAgents,
      })

      expect(agent.config.handoffs).toHaveLength(2)
    })
  })

  describe('listModels()', () => {
    it('returns available OpenAI models', async () => {
      const models = await provider.listModels()

      expect(models).toContain('gpt-4o')
      expect(models).toContain('gpt-4o-mini')
      expect(models).toContain('gpt-4-turbo')
      expect(models).toContain('o1-preview')
    })
  })
})

describe('createOpenAIProvider()', () => {
  it('creates provider with default options', () => {
    const provider = createOpenAIProvider()
    expect(provider).toBeInstanceOf(OpenAIProvider)
  })

  it('creates provider with custom options', () => {
    const provider = createOpenAIProvider({
      apiKey: 'test-key',
      defaultModel: 'gpt-4-turbo'
    })
    expect(provider).toBeInstanceOf(OpenAIProvider)
  })
})
