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
  isJsonSchema,
  validateInput,
  ValidationError,
  createDelegationTool,
  createHandoffTool,
  createFinishTool,
  createEscalationTool,
  type ToolOptions,
  type ValidationResult,
} from './Tool'

// Base Agent
export {
  BaseAgent,
  stepCountIs,
  hasToolCall,
  hasText,
  customStop,
  all,
  any,
  not,
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

// ============================================================================
// Memory
// ============================================================================

export {
  createConversationMemory,
  withMemory,
  createLLMSummarizer,
  createTiktokenCounter,
  createAPITokenCounter,
  type ConversationMemory,
  type ConversationMemoryConfig,
  type ConversationState,
  type MemorySummary,
  type TokenCounter,
  type Summarizer,
  type AgentWithMemory,
  type LLMSummarizerOptions,
} from './memory'

// ============================================================================
// LLM Router
// ============================================================================

export {
  LLMRouter,
  createRouter,
  type RouterConfig,
  type ProviderConfig,
  type LoadBalanceStrategy,
  type FallbackConfig,
  type BudgetConfig,
  type HealthCheckConfig,
  type RouterMetrics,
  type ProviderHealthStatus,
} from './router'

// ============================================================================
// Testing Utilities
// ============================================================================

export {
  createMockProvider,
  createIsolatedMockProvider,
  createMockTool,
  createTrackedTool,
  mockResponses,
  fixtures,
  expectAgentResult,
  collectStreamEvents,
  type MockProviderOptions,
} from './testing'

// ============================================================================
// Typed Agent Results
// ============================================================================

export {
  // Core types
  type AgentResult as TypedAgentResult,
  type AgentResultMeta,
  type ToolCallRecord as TypedToolCallRecord,
  type AgentSchemaRegistry,
  type AgentTaskResult,
  // Schema registration
  defineAgentSchema,
  getAgentSchema,
  hasAgentSchema,
  // Common schemas
  SpecSchema,
  ReviewSchema,
  ImplementationSchema,
  TestResultSchema,
  ContentSchema,
  FinancialAnalysisSchema,
  DataAnalysisSchema,
  // Schema types
  type Spec,
  type Review,
  type Implementation,
  type TestResult,
  type Content,
  type FinancialAnalysis,
  type DataAnalysis,
  // Utilities
  parseAgentResult,
  createTypedInvoke,
  createTypedTemplateLiteral,
  zodToPromptSchema,
  generateSchemaPrompt,
} from './typed-result'

// ============================================================================
// Named Agents
// ============================================================================

export {
  priya,
  ralph,
  tom,
  mark,
  sally,
  quinn,
  rae,
  casey,
  finn,
  dana,
  createNamedAgent,
  enableMockMode,
  disableMockMode,
  setMockResponse,
  isMockMode,
  PERSONAS,
  type NamedAgent,
  type AgentPersona,
  type AgentRole,
  type TypedTemplateLiteral,
  type TypedInvokeOptions,
} from './named'

// ============================================================================
// Agent Loop - Think, Act, Observe Pattern
// ============================================================================

export {
  AgentLoop,
  createAgentLoop,
  runSingleCycle,
  type AgentLoopConfig,
  type AgentLoopInput,
  type AgentLoopStep,
  type AgentLoopEvent,
} from './loop'
