/**
 * Unified Agent SDK
 *
 * A unified abstraction over multiple AI agent SDKs:
 * - Vercel AI SDK (Agent, Tool, stopWhen, prepareStep)
 * - Claude Agent SDK (query, subagents, hooks, MCP, v2 sessions)
 * - OpenAI Agents SDK (handoffs, Runner, Responses API)
 * - Devin API (sessions, attachments, knowledge)
 * - Mastra (workflows, memory, RAG)
 * - Vapi/LiveKit (voice agents, STT/TTS pipelines)
 *
 * @example
 * ```ts
 * import { createVercelProvider, tool, stepCountIs } from './agents'
 * import { z } from 'zod'
 *
 * const provider = createVercelProvider()
 *
 * const weatherTool = tool({
 *   name: 'getWeather',
 *   description: 'Get weather for a location',
 *   inputSchema: z.object({
 *     location: z.string(),
 *   }),
 *   execute: async ({ location }) => {
 *     return { temperature: 22, condition: 'sunny' }
 *   },
 * })
 *
 * const agent = provider.createAgent({
 *   id: 'weather-agent',
 *   name: 'Weather Agent',
 *   instructions: 'You help users with weather information.',
 *   model: 'gpt-4o',
 *   tools: [weatherTool],
 *   stopWhen: stepCountIs(5),
 * })
 *
 * const result = await agent.run({
 *   prompt: 'What is the weather in San Francisco?',
 * })
 *
 * console.log(result.text)
 * ```
 *
 * @module agents
 */

// ============================================================================
// Core Types
// ============================================================================

export type {
  // Schema Types
  Schema,
  JsonSchema,

  // Message Types
  MessageRole,
  BaseMessage,
  UserMessage,
  AssistantMessage,
  SystemMessage,
  ToolMessage,
  Message,
  ContentPart,

  // Tool Types
  ToolCall,
  ToolResult,
  ToolDefinition,
  ToolContext,

  // Agent Configuration
  AgentConfig,
  StopCondition,
  StepState,
  StepResult,
  TokenUsage,
  PrepareStepFn,
  PrepareStepResult,

  // Session Management
  Session,
  SessionStatus,
  Attachment,
  CreateSessionOptions,
  SendMessageOptions,

  // Voice Types
  VoiceConfig,
  TranscriberConfig,
  TTSConfig,
  VADConfig,

  // Memory Types
  MemoryConfig,

  // Streaming Types
  StreamEvent,
  StreamEventType,
  TextDeltaEvent,
  ToolCallStartEvent,
  ToolCallDeltaEvent,
  ToolCallEndEvent,
  ToolResultEvent,
  StepFinishEvent,
  ErrorEvent,
  DoneEvent,

  // Agent Execution
  AgentInput,
  AgentResult,
  AgentStreamResult,

  // Hooks
  AgentHooks,
  ToolCallDecision,
  PermissionRequest,

  // Multi-Agent
  HandoffRequest,
  SubagentTask,
  SubagentResult,

  // Provider Interface
  AgentProvider,
  Agent,
} from './types'

// ============================================================================
// Core Implementations
// ============================================================================

// Tool helper
export {
  tool,
  zodToJsonSchema,
  isZodSchema,
  validateInput,
  createDelegationTool,
  createHandoffTool,
  createFinishTool,
  createEscalationTool,
  type ToolOptions,
} from './Tool'

// Base Agent
export {
  BaseAgent,
  stepCountIs,
  hasToolCall,
  hasText,
  customStop,
  type BaseAgentOptions,
} from './Agent'

// ============================================================================
// Providers
// ============================================================================

export {
  // Vercel AI SDK
  VercelProvider,
  createVercelProvider,
  type VercelProviderOptions,

  // Claude / Anthropic
  ClaudeProvider,
  createClaudeProvider,
  type ClaudeProviderOptions,

  // OpenAI Agents SDK
  OpenAIProvider,
  createOpenAIProvider,
  type OpenAIProviderOptions,

  // Devin (Cognition)
  DevinProvider,
  createDevinProvider,
  type DevinProviderOptions,

  // Voice Agents
  VapiProvider,
  createVapiProvider,
  type VapiProviderOptions,
  LiveKitProvider,
  createLiveKitProvider,
  type LiveKitProviderOptions,
  type VoiceSession,
  type TranscriptEntry,
  type VoiceEvent,
} from './providers'

// ============================================================================
// Convenience Exports
// ============================================================================

/**
 * Create a provider by name
 *
 * @example
 * ```ts
 * const provider = createProvider('vercel')
 * const provider = createProvider('claude', { apiKey: '...' })
 * const provider = createProvider('openai')
 * const provider = createProvider('devin', { apiKey: '...' })
 * const provider = createProvider('vapi', { apiKey: '...' })
 * ```
 */
export function createProvider(
  name: 'vercel',
  options?: import('./providers/vercel').VercelProviderOptions
): import('./providers/vercel').VercelProvider
export function createProvider(
  name: 'claude',
  options?: import('./providers/claude').ClaudeProviderOptions
): import('./providers/claude').ClaudeProvider
export function createProvider(
  name: 'openai',
  options?: import('./providers/openai').OpenAIProviderOptions
): import('./providers/openai').OpenAIProvider
export function createProvider(
  name: 'devin',
  options: import('./providers/devin').DevinProviderOptions
): import('./providers/devin').DevinProvider
export function createProvider(
  name: 'vapi',
  options: import('./providers/voice').VapiProviderOptions
): import('./providers/voice').VapiProvider
export function createProvider(name: string, options?: unknown): unknown {
  switch (name) {
    case 'vercel':
      return new (require('./providers/vercel').VercelProvider)(options)
    case 'claude':
      return new (require('./providers/claude').ClaudeProvider)(options)
    case 'openai':
      return new (require('./providers/openai').OpenAIProvider)(options)
    case 'devin':
      return new (require('./providers/devin').DevinProvider)(options)
    case 'vapi':
      return new (require('./providers/voice').VapiProvider)(options)
    case 'livekit':
      return new (require('./providers/voice').LiveKitProvider)(options)
    default:
      throw new Error(`Unknown provider: ${name}`)
  }
}
