/**
 * Ralph Agent Tests (RED Phase - TDD)
 *
 * Ralph is the Engineering agent - responsible for:
 * - Building code from specs
 * - Code generation tasks
 * - Technical implementation
 *
 * Tests:
 * - Ralph persona and system prompt
 * - Template literal invocation: ralph`build ${spec}`
 * - Code generation task execution
 * - Integration with Agent SDK
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ralph, RalphAgent, createRalph } from '../ralph'
import {
  createMockProvider,
  createIsolatedMockProvider,
  mockResponses,
} from '../../testing'
import type { AgentProvider, AgentConfig } from '../../types'

// ============================================================================
// Mock Setup
// ============================================================================

// Mock the AI Gateway for template literal tests
vi.mock('../../../lib/ai/gateway', () => ({
  AIGatewayClient: vi.fn().mockImplementation(() => ({
    chat: vi.fn(),
  })),
}))

import { AIGatewayClient } from '../../../lib/ai/gateway'

const mockChat = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  ;(AIGatewayClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    chat: mockChat,
  }))
})

// ============================================================================
// Ralph Persona Tests
// ============================================================================

describe('Ralph - Engineering Agent Persona', () => {
  it('exports a ralph template literal function', () => {
    expect(ralph).toBeDefined()
    expect(typeof ralph).toBe('function')
  })

  it('exports RalphAgent class', () => {
    expect(RalphAgent).toBeDefined()
    expect(typeof RalphAgent).toBe('function')
  })

  it('exports createRalph factory function', () => {
    expect(createRalph).toBeDefined()
    expect(typeof createRalph).toBe('function')
  })

  describe('RalphAgent', () => {
    it('has correct default configuration', () => {
      const mockProvider = createMockProvider({
        responses: [mockResponses.text('Built the feature')],
      })

      const agent = createRalph({ provider: mockProvider })

      expect(agent.config.id).toBe('ralph')
      expect(agent.config.name).toBe('Ralph')
    })

    it('has engineering-focused system prompt', () => {
      const mockProvider = createMockProvider({
        responses: [mockResponses.text('Built the feature')],
      })

      const agent = createRalph({ provider: mockProvider })

      expect(agent.config.instructions).toContain('engineer')
    })

    it('instructions include code generation capabilities', () => {
      const mockProvider = createMockProvider({
        responses: [mockResponses.text('Code generated')],
      })

      const agent = createRalph({ provider: mockProvider })

      // Ralph's instructions should mention code/implementation
      expect(agent.config.instructions.toLowerCase()).toMatch(/code|implement|build/)
    })

    it('can be configured with custom options', () => {
      const mockProvider = createMockProvider({
        responses: [mockResponses.text('Custom response')],
      })

      const agent = createRalph({
        provider: mockProvider,
        model: 'custom-model',
        maxSteps: 10,
      })

      expect(agent.config.model).toBe('custom-model')
      expect(agent.config.maxSteps).toBe(10)
    })
  })
})

// ============================================================================
// Template Literal Invocation Tests
// ============================================================================

describe('ralph`prompt` - Template Literal Syntax', () => {
  it('executes with template literal syntax', async () => {
    mockChat.mockResolvedValueOnce({
      content: 'Here is the React component you requested...',
    })

    const result = await ralph`Create a React button component`

    expect(result).toContain('React')
    expect(mockChat).toHaveBeenCalledTimes(1)
  })

  it('interpolates spec values', async () => {
    mockChat.mockResolvedValueOnce({
      content: 'Building the user authentication module...',
    })

    const spec = { feature: 'user authentication', framework: 'Next.js' }
    const result = await ralph`build ${spec}`

    expect(result).toBeDefined()
    expect(mockChat).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining('build'),
        }),
      ])
    )
  })

  it('handles complex interpolation', async () => {
    mockChat.mockResolvedValueOnce({
      content: 'Implementation complete.',
    })

    const spec = 'authentication flow'
    const framework = 'React'
    const result = await ralph`Implement ${spec} using ${framework}`

    expect(result).toBe('Implementation complete.')
  })

  it('returns a Promise', async () => {
    mockChat.mockResolvedValueOnce({ content: 'Building...' })

    const promise = ralph`Build something`

    expect(promise).toBeInstanceOf(Promise)
  })

  it('includes engineering-focused system prompt', async () => {
    mockChat.mockResolvedValueOnce({ content: 'Done' })

    await ralph`Build a feature`

    expect(mockChat).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringMatching(/engineer|code|implement/i),
        }),
      ])
    )
  })
})

// ============================================================================
// Code Generation Task Tests
// ============================================================================

describe('Ralph - Code Generation Tasks', () => {
  it('generates code from natural language description', async () => {
    mockChat.mockResolvedValueOnce({
      content: `\`\`\`typescript
export function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0)
}
\`\`\``,
    })

    const result = await ralph`Create a function to calculate cart total`

    expect(result).toContain('calculateTotal')
    expect(result).toContain('function')
  })

  it('understands technical specifications', async () => {
    mockChat.mockResolvedValueOnce({
      content: 'Implemented REST API endpoint with proper error handling.',
    })

    const spec = {
      endpoint: '/api/users',
      method: 'POST',
      validation: 'zod schema',
    }

    const result = await ralph`implement ${spec}`

    expect(result).toBeDefined()
  })

  it('handles multi-file code generation prompts', async () => {
    mockChat.mockResolvedValueOnce({
      content: 'Created component and test files.',
    })

    const result = await ralph`Create a Button component with tests`

    expect(result).toBeDefined()
  })
})

// ============================================================================
// Agent SDK Integration Tests
// ============================================================================

describe('Ralph - Agent SDK Integration', () => {
  it('can be used as a standard agent with run()', async () => {
    const mockProvider = createIsolatedMockProvider({
      responses: [mockResponses.text('Feature built successfully')],
    })

    const agent = createRalph({ provider: mockProvider })
    const result = await agent.run({ prompt: 'Build the login feature' })

    expect(result.text).toBe('Feature built successfully')
    expect(result.steps).toBe(1)
  })

  it('supports tool execution', async () => {
    const mockProvider = createIsolatedMockProvider({
      responses: [
        mockResponses.toolCall('writeFile', { path: 'src/Button.tsx', content: '...' }),
        mockResponses.text('File written successfully'),
      ],
    })

    const agent = createRalph({ provider: mockProvider })

    const writeFileTool = {
      name: 'writeFile',
      description: 'Write a file',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } } as const,
      execute: vi.fn().mockResolvedValue({ success: true }),
    }

    const result = await agent.run({
      prompt: 'Create a button component',
      tools: [writeFileTool],
    })

    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].name).toBe('writeFile')
  })

  it('respects stop conditions', async () => {
    const mockProvider = createIsolatedMockProvider({
      responses: [
        mockResponses.text('Step 1 complete'),
      ],
    })

    const agent = createRalph({
      provider: mockProvider,
      maxSteps: 1,
    })

    const result = await agent.run({ prompt: 'Build feature' })

    expect(result.steps).toBe(1)
  })

  it('streams responses', async () => {
    const mockProvider = createIsolatedMockProvider({
      responses: [mockResponses.text('Streaming code generation...')],
    })

    const agent = createRalph({ provider: mockProvider })
    const stream = agent.stream({ prompt: 'Generate code' })

    const events: unknown[] = []
    for await (const event of stream) {
      events.push(event)
    }

    expect(events.length).toBeGreaterThan(0)
    const result = await stream.result
    expect(result.text).toContain('Streaming')
  })
})

// ============================================================================
// Configuration Tests
// ============================================================================

describe('Ralph - Configuration', () => {
  it('ralph.configure() creates configured instance', async () => {
    mockChat.mockResolvedValueOnce({ content: 'Configured response' })

    const configuredRalph = ralph.configure({
      model: 'gpt-4o',
      temperature: 0.2,
    })

    const result = await configuredRalph`Build with custom config`

    expect(result).toBe('Configured response')
  })

  it('configuration overrides defaults', async () => {
    mockChat.mockResolvedValueOnce({ content: 'Custom model response' })

    const configuredRalph = ralph.configure({
      model: 'custom-model',
    })

    await configuredRalph`Test prompt`

    expect(AIGatewayClient).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'custom-model',
      }),
      expect.anything()
    )
  })

  it('can add additional system context', async () => {
    mockChat.mockResolvedValueOnce({ content: 'Response with context' })

    const configuredRalph = ralph.configure({
      systemPrompt: 'You are working on Project X.',
    })

    await configuredRalph`Build feature Y`

    expect(mockChat).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('Project X'),
        }),
      ])
    )
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Ralph - Error Handling', () => {
  it('handles API errors gracefully', async () => {
    mockChat.mockRejectedValueOnce(new Error('API rate limit'))

    await expect(ralph`Build something`).rejects.toThrow('API rate limit')
  })

  it('agent run handles errors', async () => {
    const errorProvider: AgentProvider = {
      name: 'error-provider',
      version: '1.0.0',
      createAgent: () => {
        throw new Error('Provider initialization failed')
      },
    }

    expect(() => createRalph({ provider: errorProvider })).toThrow()
  })
})

// ============================================================================
// Integration Pattern Tests
// ============================================================================

describe('Ralph - Business-as-Code Integration', () => {
  it('works with spec from priya pattern', async () => {
    mockChat.mockResolvedValueOnce({
      content: 'Built the MVP according to spec.',
    })

    // Simulating the pattern from CLAUDE.md:
    // let app = ralph`build ${spec}`
    const spec = {
      name: 'MVP',
      features: ['auth', 'dashboard'],
    }

    const app = await ralph`build ${spec}`

    expect(app).toContain('MVP')
  })

  it('supports iterative improvement pattern', async () => {
    mockChat
      .mockResolvedValueOnce({ content: 'Version 1 of app' })
      .mockResolvedValueOnce({ content: 'Improved version 2' })

    // Simulating: app = ralph`improve ${app} per ${feedback}`
    let app = await ralph`build initial version`
    const feedback = 'Add error handling'
    app = await ralph`improve ${app} per ${feedback}`

    expect(app).toContain('Improved')
  })
})
