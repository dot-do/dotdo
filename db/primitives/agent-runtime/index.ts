/**
 * Agent Runtime - LLM orchestration primitive for agent-based features
 *
 * Provides:
 * - Multi-provider LLM support (OpenAI, Anthropic)
 * - Tool schema validation and execution
 * - Conversation memory with context management
 * - Streaming response handling
 * - Cost tracking and rate limiting
 * - Retry logic with exponential backoff
 *
 * @example
 * ```typescript
 * import { createAgentRuntime, createTool } from 'db/primitives/agent-runtime'
 * import { z } from 'zod'
 *
 * // Create a tool
 * const weatherTool = createTool({
 *   name: 'get_weather',
 *   description: 'Get weather for a location',
 *   inputSchema: z.object({ location: z.string() }),
 *   execute: async ({ location }) => ({ temp: 72, location }),
 * })
 *
 * // Create runtime
 * const runtime = createAgentRuntime({
 *   id: 'my-agent',
 *   model: 'gpt-4o',
 *   tools: [weatherTool],
 *   router: {
 *     providers: [
 *       { name: 'openai', apiKey: process.env.OPENAI_API_KEY },
 *       { name: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
 *     ],
 *     fallback: { enabled: true },
 *   },
 *   memory: {
 *     maxMessages: 100,
 *     maxTokens: 8000,
 *     windowStrategy: 'summarize',
 *   },
 * })
 *
 * // Run agent
 * const response = await runtime.run({
 *   prompt: 'What is the weather in NYC?',
 *   sessionId: 'user-123',
 * })
 * console.log(response.text)
 *
 * // Stream response
 * const stream = runtime.stream({ prompt: 'Tell me a story' })
 * for await (const event of stream) {
 *   if (event.type === 'text-delta') {
 *     process.stdout.write(event.data.textDelta)
 *   }
 * }
 * ```
 *
 * @module db/primitives/agent-runtime
 */

// =============================================================================
// Types
// =============================================================================

export type {
  // Provider types
  LLMProvider,
  LLMProviderConfig,
  LLMProviderOptions,
  ProviderName,
  ModelConfig,
  // Message types
  Message,
  TextContent,
  ImageContent,
  AudioContent,
  MessageContent,
  // Request/Response types
  CompletionRequest,
  CompletionResponse,
  // Tool types
  ToolCall,
  ToolResult,
  ToolDefinition,
  ToolSchema,
  ToolContext,
  JsonSchemaProperty,
  RetryConfig,
  // Router types
  RouterConfig,
  RouterStrategy,
  ProviderRouteConfig,
  FallbackConfig,
  FallbackTrigger,
  // Memory types
  MemoryConfig,
  WindowStrategy,
  ConversationState,
  MemorySummary,
  // Agent types
  AgentRuntimeConfig,
  AgentRunRequest,
  AgentRunResponse,
  AgentStreamResponse,
  // Streaming types
  StreamEvent,
  StreamEventType,
  // Usage types
  TokenUsage,
  UsageStats,
  ProviderStats,
} from './types'

// =============================================================================
// Providers
// =============================================================================

export {
  createOpenAIProvider,
  OPENAI_MODELS,
} from './providers/openai'

export {
  createAnthropicProvider,
  ANTHROPIC_MODELS,
} from './providers/anthropic'

export {
  createProviderRegistry,
  type ProviderRegistry,
} from './providers/registry'

// =============================================================================
// Router
// =============================================================================

export {
  createLLMRouter,
  type LLMRouter,
} from './router'

// =============================================================================
// Tools
// =============================================================================

export {
  createTool,
  createToolRegistry,
  validateToolInput,
  executeToolWithRetry,
  type CreateToolOptions,
  type ToolRegistry,
  type ValidationResult,
} from './tools'

// =============================================================================
// Memory
// =============================================================================

export {
  createConversationMemory,
  type ConversationMemory,
  type TokenCounter,
  type Summarizer,
} from './memory'

// =============================================================================
// Runtime
// =============================================================================

export {
  createAgentRuntime,
  type AgentRuntime,
} from './runtime'
