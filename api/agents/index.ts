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
  // Tool Things Integration (Graph Persistence)
  toolToThing,
  thingToTool,
  persistentTool,
  loadToolFromGraph,
  listToolsFromGraph,
  deleteToolFromGraph,
  registerHandler,
  getHandler,
  unregisterHandler,
  clearHandlerRegistry,
  getHandlerCount,
  ToolThingRegistry,
  createToolThingRegistry,
  type ToolThingData,
  type PersistentToolOptions,
  TOOL_TYPE_NAME,
  TOOL_TYPE_ID,
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
// Unified Memory (Graph-backed)
// ============================================================================

export {
  // Core interface and types
  type AgentMemory,
  type MemoryThing,
  type MemoryType,
  type MemorySearchOptions,
  type StoreMemoryOptions,
  type MemoryStats,

  // Graph adapter
  GraphMemoryAdapter,
  type GraphMemoryAdapterConfig,
  createGraphMemory,

  // In-memory implementation
  InMemoryAgentMemory,
  createInMemoryAgentMemory,

  // Compatibility adapters
  ConversationMemoryAdapter,
  toConversationMemory,
  AgentMemoryBridge,
  toAgentMemoryBridge,

  // Type constants
  MEMORY_TYPE_ID,
  MEMORY_TYPE_NAME,
  MESSAGE_TYPE_ID,
  MESSAGE_TYPE_NAME,

  // Migration utilities
  migrateMemory,
  hasLegacyMemories,
  countLegacyMemories,
  type MigrationResult,
  type MigrationOptions,
} from './unified-memory'

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
// Named Agents - MOVED TO workers.do
// ============================================================================
// Named agents (Priya, Ralph, Tom, Mark, Sally, Quinn, Rae, Casey, Finn, Dana)
// have been moved to the workers.do repository as they belong to the platform
// layer, not the runtime layer.
//
// Import from 'agents.do' (via workers.do) instead:
// import { priya, ralph, tom, mark, sally, quinn } from 'agents.do'
// ============================================================================

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

// ============================================================================
// Structured Output Parser
// ============================================================================

export {
  // Parser functions
  parseStructuredOutput,
  createStructuredOutputParser,
  extractJson,
  coerceType,
  // Error class
  StructuredOutputError,
  // Types
  type ParsePhase,
  type CoercionTarget,
  type StructuredOutputOptions,
} from './structured-output'

// ============================================================================
// Tool Result Caching
// ============================================================================

export {
  // Core class
  ToolResultCache,
  // Factory functions
  createToolCache,
  createCacheHooks,
  // Hook integration
  withCaching,
  // Tool wrapper
  cacheable,
  // Cached execution utility
  executeCached,
  // Key generation utilities
  generateCacheKey,
  stableStringify,
  // Storage implementation
  InMemoryCacheStorage,
  // Types
  type CacheableToolDefinition,
  type CacheEntry,
  type CacheStats,
  type ToolCacheConfig,
  type CacheStorage,
} from './tool-cache'

// ============================================================================
// Cost Tracking
// ============================================================================

export {
  // Core class
  CostTracker,
  // Factory function
  createCostTracker,
  // Agent integration
  withCostTracking,
  // Utility functions
  calculateCost,
  estimateCost,
  mergeTrackerStats,
  // Error class
  BudgetExceededError,
  // Default pricing table
  MODEL_PRICING,
  // Types
  type ModelPricing,
  type PricingTable,
  type CostBudget,
  type CostTrackerConfig,
  type UsageRecord,
  type UsageStats,
  type ModelUsage,
  type ProviderUsage,
  type RecordUsageInput,
  type AgentWithCostTracking,
} from './cost-tracker'

// ============================================================================
// Agent-to-Agent Communication
// ============================================================================

export {
  // Core classes
  AgentMessageBus,
  GraphMessageBus,
  // Factory functions
  createMessageBus,
  createGraphMessageBus,
  // Types
  type AgentMessage,
  type MessageEnvelope,
  type MessageFilter,
  type MessageSubscription,
  type MessageHandler,
  type BusConfig,
  type RequestOptions,
  type BroadcastRequest,
  type SimpleRequest,
  type CommunicationStats,
  type AgentActivity,
  type HandoffRecord,
  type MessageType,
  type DeliveryStatus,
  type DeliveryReceipt,
  type GraphMessageBusConfig,
} from './communication'

// ============================================================================
// Handoff Protocol
// ============================================================================

export {
  // Core class
  HandoffProtocol,
  // Factory functions
  createHandoffProtocol,
  createHandoffRequest,
  createHandoffContext,
  createCompleteHandoffContext,
  createProtocolHandoffTool,
  // Message factory functions (Acknowledgment Protocol)
  generateHandoffId,
  generateCorrelationId,
  createInitiateMessage,
  createAckMessage,
  createAcceptMessage,
  createRejectMessage,
  createProgressMessage,
  createCompleteMessage,
  createErrorMessage,
  // State preservation utilities
  createPreservedState,
  validatePreservedState,
  mergePreservedStates,
  extractPreservedState,
  // Context transfer utilities
  serializeContext,
  deserializeContext,
  // Types
  type HandoffReason,
  type HandoffState,
  type HandoffMessageType,
  type HandoffMessageBase,
  type HandoffInitiateMessage,
  type HandoffAckMessage,
  type HandoffAcceptMessage,
  type HandoffRejectMessage,
  type HandoffProgressMessage,
  type HandoffCompleteMessage,
  type HandoffErrorMessage,
  type HandoffMessage,
  type PreservedState,
  type HandoffContext,
  type HandoffRequest,
  type HandoffResult,
  type HandoffChainEntry,
  type HandoffHooks,
  type HandoffProtocolConfig,
} from './handoff'

// ============================================================================
// Handoff Chain (Graph-backed)
// ============================================================================

export {
  HANDED_OFF_TO,
  createHandoffRelationship,
  getHandoffChain,
  checkCircularHandoff,
  getHandoffAnalytics,
  getHandoffsBetweenAgents,
  createGraphBackedHandoffHooks,
  extractAgentId,
  type CreateHandoffRelationshipInput,
  type HandoffRelationship,
  type HandoffChainEntry as GraphHandoffChainEntry,
  type CircularHandoffCheckResult,
  type HandoffAnalytics,
  type GetHandoffChainOptions,
  type GetHandoffAnalyticsOptions,
} from './handoff-chain'
