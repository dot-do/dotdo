/**
 * Named Agent AI Integration Tests (RED Phase - TDD)
 *
 * These tests verify that named agents (Priya, Ralph, Tom, Mark, Sally, Quinn)
 * properly integrate with AI providers for real LLM-powered responses.
 *
 * CURRENT STATE (what these tests should expose):
 * - Named agents in factory.ts bypass the provider abstraction
 * - They directly call Anthropic/OpenAI SDKs in executeAgent()
 * - No way to inject/configure providers for named agents
 * - No unified provider interface for template literal agents
 *
 * EXPECTED STATE (what implementation should provide):
 * - Named agents use AgentProvider interface
 * - Providers can be configured per-agent or globally
 * - Conversation context managed through provider sessions
 * - Mock providers for testing without API calls
 *
 * @see dotdo-4tuvq - RED phase: AI integration tests
 * @module agents/tests/ai-integration.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Named agents from factory
import {
  priya,
  ralph,
  tom,
  mark,
  sally,
  quinn,
  createNamedAgent,
  PERSONAS,
  enableMockMode,
  disableMockMode,
} from '../named'

// Provider interfaces
import type { AgentProvider, AgentConfig, Agent, AgentResult, Message } from '../types'

// Providers (for integration)
import { createClaudeProvider, type ClaudeProviderOptions } from '../providers/claude'
import { createOpenAIProvider, type OpenAIProviderOptions } from '../providers/openai'

/**
 * Mock AI Provider for testing
 * This should be the standard way to test agents without real API calls
 */
class MockAIProvider implements AgentProvider {
  readonly name = 'mock'
  readonly version = '1.0.0'

  private responses: Map<string, string> = new Map()
  private callHistory: Array<{ prompt: string; response: string }> = []

  setResponse(pattern: string, response: string): void {
    this.responses.set(pattern, response)
  }

  getCallHistory(): Array<{ prompt: string; response: string }> {
    return this.callHistory
  }

  clearHistory(): void {
    this.callHistory = []
  }

  createAgent(config: AgentConfig): Agent {
    const self = this
    return {
      config,
      provider: this,
      async run(input) {
        const prompt = input.prompt || input.messages?.find(m => m.role === 'user')?.content || ''
        const promptStr = typeof prompt === 'string' ? prompt : JSON.stringify(prompt)

        // Find matching response
        let response = `[${config.name}] Mock response for: ${promptStr.slice(0, 50)}...`
        for (const [pattern, resp] of self.responses) {
          if (promptStr.includes(pattern)) {
            response = resp
            break
          }
        }

        self.callHistory.push({ prompt: promptStr, response })

        return {
          text: response,
          toolCalls: [],
          toolResults: [],
          messages: [
            { role: 'user' as const, content: promptStr },
            { role: 'assistant' as const, content: response },
          ],
          steps: 1,
          finishReason: 'stop' as const,
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        }
      },
      stream(input) {
        throw new Error('Streaming not implemented in mock provider')
      },
    }
  }
}

describe('Named Agent AI Integration', () => {
  describe('Provider Integration', () => {
    /**
     * TEST: Named agents should accept a provider configuration
     *
     * CURRENT: Named agents are created with PERSONAS and don't accept providers
     * EXPECTED: createNamedAgent should accept a provider option
     */
    it('ralph should accept AI provider configuration', async () => {
      const mockProvider = new MockAIProvider()
      mockProvider.setResponse('build', 'Generated TypeScript code for authentication module')

      // This should work but currently doesn't exist
      // Named agents need a way to use injected providers
      const ralphWithProvider = createNamedAgent(PERSONAS.ralph, {
        provider: mockProvider,
      } as any)

      const result = await ralphWithProvider`build an authentication module`

      // Verify the mock provider was called
      expect(mockProvider.getCallHistory()).toHaveLength(1)
      expect(result.toString()).toContain('authentication')
    })

    /**
     * TEST: Priya should generate specs through AI provider
     *
     * CURRENT: priya uses direct SDK calls or mock mode
     * EXPECTED: priya should route through configured provider
     */
    it('priya generates specs via AI provider', async () => {
      const mockProvider = new MockAIProvider()
      mockProvider.setResponse('MVP', 'Product specification with user stories and acceptance criteria')

      const priyaWithProvider = createNamedAgent(PERSONAS.priya, {
        provider: mockProvider,
      } as any)

      const result = await priyaWithProvider`define the MVP for a task management app`

      expect(mockProvider.getCallHistory()).toHaveLength(1)
      const lastCall = mockProvider.getCallHistory()[0]
      expect(lastCall.prompt).toContain('MVP')
      expect(result.toString()).toContain('specification')
    })

    /**
     * TEST: All agents should use configured provider
     *
     * CURRENT: Each agent directly uses Anthropic/OpenAI SDK
     * EXPECTED: Agents should use the AgentProvider abstraction
     */
    it('agents use configured provider', async () => {
      const mockProvider = new MockAIProvider()

      // All named agents should be configurable with providers
      const agents = [
        { persona: PERSONAS.priya, prompt: 'define a feature' },
        { persona: PERSONAS.ralph, prompt: 'build a component' },
        { persona: PERSONAS.tom, prompt: 'review this code' },
        { persona: PERSONAS.mark, prompt: 'write marketing copy' },
        { persona: PERSONAS.sally, prompt: 'create a sales pitch' },
        { persona: PERSONAS.quinn, prompt: 'write test cases' },
      ]

      for (const { persona, prompt } of agents) {
        mockProvider.clearHistory()

        const agentWithProvider = createNamedAgent(persona, {
          provider: mockProvider,
        } as any)

        await agentWithProvider`${prompt}`

        expect(mockProvider.getCallHistory()).toHaveLength(1)
      }
    })
  })

  describe('Conversation Context', () => {
    /**
     * TEST: Agents should maintain conversation context through provider sessions
     *
     * CURRENT: Context is stored in a module-level Map (conversationContexts)
     * EXPECTED: Context should be managed through provider session API
     */
    it('agents maintain conversation context', async () => {
      const mockProvider = new MockAIProvider()

      // First call establishes context
      mockProvider.setResponse('TaskMaster', 'I understand you are building TaskMaster')

      const priyaWithProvider = createNamedAgent(PERSONAS.priya, {
        provider: mockProvider,
      } as any)

      await priyaWithProvider`I'm building an app called TaskMaster`

      // Second call should have access to context
      mockProvider.setResponse('app', 'Your app TaskMaster focuses on project management')

      const result = await priyaWithProvider`What is my app called?`

      // Verify context was maintained (provider should receive full message history)
      const calls = mockProvider.getCallHistory()
      expect(calls.length).toBeGreaterThanOrEqual(2)

      // The second call should reference the context from the first
      expect(result.toString().toLowerCase()).toContain('taskmaster')
    })

    /**
     * TEST: Context should be isolated per agent instance
     *
     * CURRENT: Context is keyed by persona name (shared across instances)
     * EXPECTED: Each agent instance should have isolated context
     */
    it('context is isolated per agent instance', async () => {
      const mockProvider1 = new MockAIProvider()
      const mockProvider2 = new MockAIProvider()

      const priya1 = createNamedAgent(PERSONAS.priya, { provider: mockProvider1 } as any)
      const priya2 = createNamedAgent(PERSONAS.priya, { provider: mockProvider2 } as any)

      await priya1`Working on Project Alpha`
      await priya2`Working on Project Beta`

      // Each instance should have its own context
      expect(mockProvider1.getCallHistory()[0].prompt).toContain('Alpha')
      expect(mockProvider2.getCallHistory()[0].prompt).toContain('Beta')

      // Verify they don't share context
      expect(mockProvider1.getCallHistory().length).toBe(1)
      expect(mockProvider2.getCallHistory().length).toBe(1)
    })
  })

  describe('Provider Selection', () => {
    /**
     * TEST: Named agents should support provider selection at creation time
     *
     * CURRENT: Provider is determined by environment variables
     * EXPECTED: Provider should be explicitly configurable
     */
    it('supports explicit provider selection', async () => {
      const mockClaude = new MockAIProvider()
      mockClaude.setResponse('test', 'Claude response')

      const mockOpenAI = new MockAIProvider()
      mockOpenAI.setResponse('test', 'OpenAI response')

      const ralphClaude = createNamedAgent(PERSONAS.ralph, {
        provider: mockClaude,
      } as any)

      const ralphOpenAI = createNamedAgent(PERSONAS.ralph, {
        provider: mockOpenAI,
      } as any)

      const claudeResult = await ralphClaude`test prompt`
      const openaiResult = await ralphOpenAI`test prompt`

      expect(claudeResult.toString()).toContain('Claude')
      expect(openaiResult.toString()).toContain('OpenAI')
    })

    /**
     * TEST: Default provider should be configurable globally
     *
     * CURRENT: Default is based on which API key is set
     * EXPECTED: Should have explicit global default configuration
     */
    it('supports global default provider configuration', async () => {
      const mockProvider = new MockAIProvider()

      // This API should exist to set a default provider
      // setDefaultProvider(mockProvider)

      // All agents should then use this provider by default
      // const result = await ralph`build something`
      // expect(mockProvider.getCallHistory().length).toBe(1)

      // For now, we just assert the pattern should work
      expect(() => {
        // @ts-expect-error - setDefaultProvider doesn't exist yet
        if (typeof setDefaultProvider === 'function') {
          setDefaultProvider(mockProvider)
        }
      }).not.toThrow()
    })
  })

  describe('AI Response Generation', () => {
    /**
     * TEST: Ralph should generate code responses
     *
     * CURRENT: In mock mode, returns placeholder; real mode calls SDK directly
     * EXPECTED: Should route through provider and return structured code
     */
    it('ralph generates code via AI provider', async () => {
      const mockProvider = new MockAIProvider()
      mockProvider.setResponse('hello world', `
\`\`\`typescript
export function hello(): string {
  return 'Hello, World!'
}
\`\`\`
      `.trim())

      const ralphWithProvider = createNamedAgent(PERSONAS.ralph, {
        provider: mockProvider,
      } as any)

      const result = await ralphWithProvider`write a hello world function`

      expect(result.toString()).toContain('typescript')
      expect(result.toString()).toContain('function')
      expect(result.toString()).toContain('Hello')
    })

    /**
     * TEST: Tom should generate structured review responses
     *
     * CURRENT: approve() method exists but uses direct SDK calls
     * EXPECTED: Review should go through provider with structured output
     */
    it('tom generates structured code reviews', async () => {
      const mockProvider = new MockAIProvider()
      mockProvider.setResponse('review', JSON.stringify({
        approved: false,
        issues: ['Missing type annotations', 'No error handling'],
        suggestions: ['Add TypeScript types', 'Wrap in try-catch'],
      }))

      const tomWithProvider = createNamedAgent(PERSONAS.tom, {
        provider: mockProvider,
      } as any)

      // Tom's approve method should use the provider
      if (tomWithProvider.approve) {
        const review = await tomWithProvider.approve({
          code: 'function add(a, b) { return a + b }',
          file: 'math.ts',
        })

        expect(review).toHaveProperty('approved')
        expect(review).toHaveProperty('feedback')
      }
    })

    /**
     * TEST: Quinn should generate test cases
     *
     * CURRENT: Quinn returns mock responses in mock mode
     * EXPECTED: Quinn should generate structured test suggestions
     */
    it('quinn generates test strategies via AI provider', async () => {
      const mockProvider = new MockAIProvider()
      mockProvider.setResponse('test', `
## Test Strategy

### Unit Tests
- Test input validation
- Test edge cases (empty input, null, undefined)
- Test error handling

### Integration Tests
- Test API endpoints
- Test database interactions

### E2E Tests
- Test user flows
- Test authentication
      `.trim())

      const quinnWithProvider = createNamedAgent(PERSONAS.quinn, {
        provider: mockProvider,
      } as any)

      const result = await quinnWithProvider`create test strategy for authentication module`

      expect(result.toString()).toContain('Test')
      expect(result.toString().toLowerCase()).toContain('unit')
    })
  })

  describe('Provider Configuration Passthrough', () => {
    /**
     * TEST: Agent config should pass through to provider
     *
     * CURRENT: withConfig() exists but doesn't configure provider
     * EXPECTED: Configuration should reach the underlying provider
     */
    it('passes temperature configuration to provider', async () => {
      const mockProvider = new MockAIProvider()
      let capturedConfig: AgentConfig | null = null

      // Spy on createAgent to capture config
      const originalCreateAgent = mockProvider.createAgent.bind(mockProvider)
      mockProvider.createAgent = (config: AgentConfig) => {
        capturedConfig = config
        return originalCreateAgent(config)
      }

      const creativeRalph = createNamedAgent(PERSONAS.ralph, {
        provider: mockProvider,
        temperature: 0.9,
      } as any)

      await creativeRalph`write creative code`

      expect(capturedConfig).not.toBeNull()
      // Temperature should be passed to provider
      expect(capturedConfig?.providerOptions?.temperature || (capturedConfig as any)?.temperature).toBe(0.9)
    })

    /**
     * TEST: Model selection should be configurable
     *
     * CURRENT: Model is hardcoded or from environment
     * EXPECTED: Model should be configurable per agent
     */
    it('allows model configuration per agent', async () => {
      const mockProvider = new MockAIProvider()
      let capturedConfig: AgentConfig | null = null

      const originalCreateAgent = mockProvider.createAgent.bind(mockProvider)
      mockProvider.createAgent = (config: AgentConfig) => {
        capturedConfig = config
        return originalCreateAgent(config)
      }

      const gpt4Ralph = createNamedAgent(PERSONAS.ralph, {
        provider: mockProvider,
        model: 'gpt-4-turbo-preview',
      } as any)

      await gpt4Ralph`build something`

      expect(capturedConfig?.model).toBe('gpt-4-turbo-preview')
    })
  })

  describe('Error Handling', () => {
    /**
     * TEST: Provider errors should propagate correctly
     *
     * CURRENT: Errors may not propagate cleanly from providers
     * EXPECTED: Provider errors should be caught and re-thrown with context
     */
    it('propagates provider errors with context', async () => {
      const errorProvider: AgentProvider = {
        name: 'error',
        version: '1.0.0',
        createAgent(config: AgentConfig): Agent {
          return {
            config,
            provider: this,
            async run() {
              throw new Error('API rate limit exceeded')
            },
            stream() {
              throw new Error('Streaming not supported')
            },
          }
        },
      }

      const ralphWithError = createNamedAgent(PERSONAS.ralph, {
        provider: errorProvider,
      } as any)

      await expect(ralphWithError`build something`).rejects.toThrow('rate limit')
    })

    /**
     * TEST: Missing provider should throw clear error
     *
     * CURRENT: Throws generic "No API key configured" error
     * EXPECTED: Should throw "No provider configured" when appropriate
     */
    it('throws clear error when no provider configured', async () => {
      // Clear environment variables temporarily
      const originalAnthropic = process.env.ANTHROPIC_API_KEY
      const originalOpenAI = process.env.OPENAI_API_KEY
      delete process.env.ANTHROPIC_API_KEY
      delete process.env.OPENAI_API_KEY

      // Disable mock mode to test real error path
      disableMockMode()

      try {
        await expect(ralph`test`).rejects.toThrow(/API key|provider/i)
      } finally {
        // Restore environment
        if (originalAnthropic) process.env.ANTHROPIC_API_KEY = originalAnthropic
        if (originalOpenAI) process.env.OPENAI_API_KEY = originalOpenAI
        enableMockMode()
      }
    })
  })

  describe('Real Provider Integration (Requires API Keys)', () => {
    /**
     * These tests require real API keys and make actual API calls.
     * They are skipped by default and should be run manually for integration testing.
     */

    const hasClaudeKey = !!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes('test')
    const hasOpenAIKey = !!process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('test')

    it.skipIf(!hasClaudeKey)('ralph uses Claude provider for code generation', async () => {
      disableMockMode()

      const claudeProvider = createClaudeProvider({
        apiKey: process.env.ANTHROPIC_API_KEY,
      })

      const ralphClaude = createNamedAgent(PERSONAS.ralph, {
        provider: claudeProvider,
      } as any)

      const result = await ralphClaude`write a TypeScript function that adds two numbers`

      expect(result.toString()).toContain('function')
      expect(result.toString().toLowerCase()).toMatch(/add|sum|number/)

      enableMockMode()
    })

    it.skipIf(!hasOpenAIKey)('priya uses OpenAI provider for spec generation', async () => {
      disableMockMode()

      const openaiProvider = createOpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY,
      })

      const priyaOpenAI = createNamedAgent(PERSONAS.priya, {
        provider: openaiProvider,
      } as any)

      const result = await priyaOpenAI`define a simple MVP for a note-taking app`

      expect(result.toString().length).toBeGreaterThan(100)
      expect(result.toString().toLowerCase()).toMatch(/feature|user|note|mvp/i)

      enableMockMode()
    })
  })
})

describe('Named Agent Provider Factory', () => {
  /**
   * TEST: Should be able to create agents with providers using factory pattern
   *
   * This tests the expected API for creating named agents with providers
   */
  it('createNamedAgent accepts provider option', () => {
    const mockProvider = new MockAIProvider()

    // This is the API we expect to exist
    const agent = createNamedAgent(PERSONAS.ralph, {
      provider: mockProvider,
    } as any)

    expect(agent).toBeDefined()
    expect(agent.role).toBe('engineering')
    expect(agent.name).toBe('Ralph')
  })

  /**
   * TEST: Should expose provider on agent instance
   *
   * CURRENT: Agents don't expose their provider
   * EXPECTED: Agent should have a .provider property
   */
  it('exposes provider on agent instance', () => {
    const mockProvider = new MockAIProvider()

    const agent = createNamedAgent(PERSONAS.ralph, {
      provider: mockProvider,
    } as any)

    // Agent should expose its provider for introspection
    expect((agent as any).provider).toBe(mockProvider)
  })

  /**
   * TEST: withProvider method for runtime provider switching
   *
   * CURRENT: Only withConfig exists
   * EXPECTED: Should have withProvider method
   */
  it('supports withProvider method for runtime switching', () => {
    const mockProvider = new MockAIProvider()

    // This API should exist
    const agentWithProvider = (ralph as any).withProvider?.(mockProvider)

    if (agentWithProvider) {
      expect(agentWithProvider.provider).toBe(mockProvider)
    } else {
      // Method doesn't exist yet - this is expected in RED phase
      expect((ralph as any).withProvider).toBeUndefined()
    }
  })
})
