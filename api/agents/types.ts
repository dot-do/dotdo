/**
 * Unified Agent SDK Types
 *
 * Core abstractions synthesized from:
 * - Vercel AI SDK (Agent, Tool, stopWhen, prepareStep)
 * - Claude Agent SDK (query, subagents, hooks, MCP)
 * - OpenAI Agents SDK (handoffs, Runner, Responses API)
 * - Devin API (sessions, attachments, knowledge)
 * - Mastra (workflows, memory, RAG)
 * - Vapi/LiveKit (voice pipelines, STT/TTS)
 */

import type { z } from 'zod'

// ============================================================================
// Schema Types
// ============================================================================

/**
 * Schema definition - supports Zod, JSON Schema, or raw objects
 */
export type Schema<T = unknown> =
  | z.ZodType<T>
  | JsonSchema
  | { type: 'object'; properties: Record<string, unknown> }

export interface JsonSchema {
  $schema?: string
  type: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  description?: string
  [key: string]: unknown
}

// ============================================================================
// Message Types
// ============================================================================

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface BaseMessage {
  id?: string
  role: MessageRole
  createdAt?: Date
  metadata?: Record<string, unknown>
}

export interface UserMessage extends BaseMessage {
  role: 'user'
  content: string | ContentPart[]
}

export interface AssistantMessage extends BaseMessage {
  role: 'assistant'
  content?: string
  toolCalls?: ToolCall[]
}

export interface SystemMessage extends BaseMessage {
  role: 'system'
  content: string
}

export interface ToolMessage extends BaseMessage {
  role: 'tool'
  toolCallId: string
  toolName: string
  content: unknown
}

export type Message = UserMessage | AssistantMessage | SystemMessage | ToolMessage

export interface ContentPart {
  type: 'text' | 'image' | 'audio' | 'file'
  text?: string
  data?: string | Uint8Array
  mimeType?: string
  url?: string
}

// ============================================================================
// Tool Types
// ============================================================================

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  toolName: string
  result: unknown
  error?: string
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  inputSchema: Schema<TInput>
  outputSchema?: Schema<TOutput>
  execute: (input: TInput, context: ToolContext) => Promise<TOutput>

  /** For voice agents: can this tool be called while speaking? */
  interruptible?: boolean
  /** Permission level required */
  permission?: 'auto' | 'confirm' | 'deny'
}

export interface ToolContext {
  agentId: string
  sessionId?: string
  userId?: string
  abortSignal?: AbortSignal
  metadata?: Record<string, unknown>
}

// ============================================================================
// Agent Configuration
// ============================================================================

export interface AgentConfig {
  /** Unique identifier for the agent */
  id: string
  /** Human-readable name */
  name: string
  /** System prompt / instructions */
  instructions: string
  /** Model identifier (provider-specific or unified) */
  model: string
  /** Available tools */
  tools?: ToolDefinition[]

  // Loop Control (Vercel pattern)
  /** Stopping conditions */
  stopWhen?: StopCondition | StopCondition[]
  /** Maximum steps before forcing stop */
  maxSteps?: number
  /** Hook called before each step */
  prepareStep?: PrepareStepFn

  // Multi-agent
  /** Agents this agent can hand off to */
  handoffs?: AgentConfig[]
  /** Can spawn subagents? */
  canSpawnSubagents?: boolean

  // Voice (Vapi/LiveKit pattern)
  /** Voice configuration for voice agents */
  voice?: VoiceConfig

  // Memory/State
  /** Memory/context store */
  memory?: MemoryConfig

  // Provider-specific options
  providerOptions?: Record<string, unknown>
}

// ============================================================================
// Loop Control (Vercel AI SDK pattern)
// ============================================================================

export type StopCondition =
  | { type: 'stepCount'; count: number }
  | { type: 'hasToolCall'; toolName: string }
  | { type: 'hasText' }
  | { type: 'custom'; check: (state: StepState) => boolean }

export interface StepState {
  stepNumber: number
  messages: Message[]
  lastStep: StepResult
  totalTokens: number
}

export interface StepResult {
  text?: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  finishReason: 'stop' | 'tool_calls' | 'max_steps' | 'error'
  usage?: TokenUsage
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export type PrepareStepFn = (state: StepState) => PrepareStepResult | Promise<PrepareStepResult>

export interface PrepareStepResult {
  /** Override model for this step */
  model?: string
  /** Override tools for this step */
  tools?: ToolDefinition[]
  /** Modify messages (e.g., for context compression) */
  messages?: Message[]
  /** Override instructions */
  instructions?: string
  /** Provider-specific options */
  providerOptions?: Record<string, unknown>
}

// ============================================================================
// Session Management (Devin/Claude v2 pattern)
// ============================================================================

export interface Session {
  id: string
  agentId: string
  status: SessionStatus
  createdAt: Date
  updatedAt: Date
  messages: Message[]
  metadata?: Record<string, unknown>

  /** Devin-specific: knowledge IDs */
  knowledgeIds?: string[]
  /** Devin-specific: attached files */
  attachments?: Attachment[]
  /** Devin-specific: playbook */
  playbookId?: string
}

export type SessionStatus =
  | 'pending'
  | 'running'
  | 'waiting_for_input'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface Attachment {
  id: string
  name: string
  url: string
  mimeType: string
  size: number
}

export interface CreateSessionOptions {
  agentId: string
  initialPrompt?: string
  knowledgeIds?: string[]
  attachments?: File[] | Attachment[]
  metadata?: Record<string, unknown>
  /** Devin-specific */
  idempotent?: boolean
  maxAcuLimit?: number
}

export interface SendMessageOptions {
  sessionId: string
  message: string
  attachments?: File[] | Attachment[]
  metadata?: Record<string, unknown>
}

// ============================================================================
// Voice Agent Types (Vapi/LiveKit pattern)
// ============================================================================

export interface VoiceConfig {
  /** Speech-to-text provider */
  transcriber: TranscriberConfig
  /** Text-to-speech provider */
  voice: TTSConfig
  /** Voice activity detection */
  vad?: VADConfig
  /** Allow user to interrupt */
  bargeIn?: boolean
  /** Silence threshold before turn ends */
  silenceTimeoutMs?: number
}

export interface TranscriberConfig {
  provider: 'deepgram' | 'whisper' | 'azure' | string
  model?: string
  language?: string
  keywords?: string[]
}

export interface TTSConfig {
  provider: 'elevenlabs' | 'azure' | 'playht' | 'openai' | string
  voiceId: string
  speed?: number
  stability?: number
  similarityBoost?: number
}

export interface VADConfig {
  threshold?: number
  minSpeechDurationMs?: number
  maxSpeechDurationMs?: number
  silenceDurationMs?: number
}

// ============================================================================
// Memory/Context (Mastra pattern)
// ============================================================================

export interface MemoryConfig {
  /** Memory store type */
  type: 'ephemeral' | 'persistent' | 'vector'
  /** For persistent: connection config */
  connection?: unknown
  /** For vector: embedding model */
  embedModel?: string
  /** Max context window */
  maxTokens?: number
}

// ============================================================================
// Streaming Types
// ============================================================================

export interface StreamEvent {
  type: StreamEventType
  data: unknown
  timestamp: Date
}

export type StreamEventType =
  | 'text-delta'
  | 'tool-call-start'
  | 'tool-call-delta'
  | 'tool-call-end'
  | 'tool-result'
  | 'step-start'
  | 'step-finish'
  | 'error'
  | 'done'
  // Voice-specific
  | 'transcript-delta'
  | 'speech-start'
  | 'speech-end'
  | 'user-speech-start'
  | 'user-speech-end'

export interface TextDeltaEvent {
  type: 'text-delta'
  textDelta: string
}

export interface ToolCallStartEvent {
  type: 'tool-call-start'
  toolCallId: string
  toolName: string
}

export interface ToolCallDeltaEvent {
  type: 'tool-call-delta'
  toolCallId: string
  argumentsDelta: string
}

export interface ToolCallEndEvent {
  type: 'tool-call-end'
  toolCall: ToolCall
}

export interface ToolResultEvent {
  type: 'tool-result'
  result: ToolResult
}

export interface StepFinishEvent {
  type: 'step-finish'
  step: StepResult
  stepNumber: number
}

export interface ErrorEvent {
  type: 'error'
  error: Error
}

export interface DoneEvent {
  type: 'done'
  finalResult: AgentResult
}

// ============================================================================
// Agent Execution
// ============================================================================

export interface AgentInput {
  /** The prompt or messages to send */
  prompt?: string
  messages?: Message[]
  /** Override tools for this run */
  tools?: ToolDefinition[]
  /** Override stop conditions */
  stopWhen?: StopCondition | StopCondition[]
  /** Abort signal */
  signal?: AbortSignal
  /** Provider-specific options */
  providerOptions?: Record<string, unknown>
}

export interface AgentResult {
  /** Final text output */
  text: string
  /** All tool calls made */
  toolCalls: ToolCall[]
  /** All tool results */
  toolResults: ToolResult[]
  /** All messages in conversation */
  messages: Message[]
  /** Number of steps taken */
  steps: number
  /** Why the agent stopped */
  finishReason: 'stop' | 'tool_calls' | 'max_steps' | 'error' | 'cancelled'
  /** Token usage */
  usage: TokenUsage
}

export interface AgentStreamResult extends AsyncIterable<StreamEvent> {
  /** Promise that resolves to final result */
  result: Promise<AgentResult>
  /** Text promise (resolves when complete) */
  text: Promise<string>
  /** Tool calls promise */
  toolCalls: Promise<ToolCall[]>
  /** Usage promise */
  usage: Promise<TokenUsage>
}

// ============================================================================
// Hooks (Claude SDK pattern)
// ============================================================================

export interface AgentHooks {
  /** Called before a tool is used */
  onPreToolUse?: (toolCall: ToolCall) => Promise<ToolCallDecision>
  /** Called after a tool completes */
  onPostToolUse?: (toolCall: ToolCall, result: ToolResult) => Promise<void>
  /** Called when permission is needed */
  onPermissionRequest?: (request: PermissionRequest) => Promise<boolean>
  /** Called when step starts */
  onStepStart?: (stepNumber: number, state: StepState) => Promise<void>
  /** Called when step finishes */
  onStepFinish?: (step: StepResult, stepNumber: number) => Promise<void>
  /** Called on error */
  onError?: (error: Error) => Promise<void>
}

export type ToolCallDecision =
  | { action: 'allow' }
  | { action: 'deny'; reason: string }
  | { action: 'modify'; arguments: Record<string, unknown> }
  | { action: 'use_cached'; result: unknown }

export interface PermissionRequest {
  type: 'tool_use' | 'file_access' | 'network' | string
  resource: string
  action: string
  metadata?: Record<string, unknown>
}

// ============================================================================
// Multi-Agent (OpenAI handoffs / Claude subagents)
// ============================================================================

export interface HandoffRequest {
  targetAgentId: string
  reason: string
  context: Message[]
  metadata?: Record<string, unknown>
}

export interface SubagentTask {
  prompt: string
  agentConfig?: Partial<AgentConfig>
  timeout?: number
  metadata?: Record<string, unknown>
}

export interface SubagentResult {
  taskId: string
  status: 'completed' | 'failed' | 'timeout'
  result?: AgentResult
  error?: Error
}

// ============================================================================
// Provider Interface
// ============================================================================

export interface AgentProvider {
  readonly name: string
  readonly version: string

  /** Create an agent instance */
  createAgent(config: AgentConfig): Agent

  /** For session-based providers: create a session */
  createSession?(options: CreateSessionOptions): Promise<Session>

  /** For session-based providers: get session */
  getSession?(sessionId: string): Promise<Session | null>

  /** For session-based providers: send message */
  sendMessage?(options: SendMessageOptions): Promise<AgentResult>

  /** For session-based providers: stream message */
  streamMessage?(options: SendMessageOptions): AgentStreamResult

  /** Upload attachment (Devin pattern) */
  uploadAttachment?(file: File): Promise<Attachment>

  /** List available models */
  listModels?(): Promise<string[]>
}

export interface Agent {
  readonly config: AgentConfig
  readonly provider: AgentProvider

  /** Run agent to completion */
  run(input: AgentInput): Promise<AgentResult>

  /** Stream agent execution */
  stream(input: AgentInput): AgentStreamResult

  /** Spawn a subagent (Claude pattern) */
  spawnSubagent?(task: SubagentTask): Promise<SubagentResult>

  /** Hand off to another agent (OpenAI pattern) */
  handoff?(request: HandoffRequest): Promise<AgentResult>
}

// ============================================================================
// Agent Role and Persona Types
// ============================================================================

/**
 * Agent role - the functional area the agent specializes in
 */
export type AgentRole =
  | 'product'
  | 'engineering'
  | 'tech-lead'
  | 'marketing'
  | 'sales'
  | 'qa'
  | 'frontend'
  | 'customer-success'
  | 'finance'
  | 'data'

/**
 * Agent persona - describes the agent's identity and behavior
 */
export interface AgentPersona {
  /** Human-readable name */
  name: string
  /** Role/function of the agent */
  role: AgentRole
  /** Description of the agent */
  description: string
  /** Instructions/system prompt for the agent */
  instructions?: string
  /** Personality traits */
  traits?: string[]
  /** Capabilities the agent has */
  capabilities?: string[]
  /** Guidelines the agent follows */
  guidelines?: string[]
}

/**
 * Named agent personas lookup
 */
export const PERSONAS: Record<string, AgentPersona> = {
  priya: {
    name: 'Priya',
    role: 'product',
    description: 'Product manager - specs, roadmaps, MVP definition',
    instructions: 'Your role is to define products, create specifications, and plan roadmaps.',
  },
  ralph: {
    name: 'Ralph',
    role: 'engineering',
    description: 'Engineering lead - builds code, implements features',
    instructions: 'Your role is to build, implement, and improve code based on specifications.',
  },
  tom: {
    name: 'Tom',
    role: 'tech-lead',
    description: 'Tech Lead - architecture, code review, technical decisions',
    instructions: 'Your role is to review code, make architectural decisions, and ensure quality.',
  },
  mark: {
    name: 'Mark',
    role: 'marketing',
    description: 'Marketing lead - content, launches, announcements',
    instructions: 'Your role is to create content, plan launches, and communicate value.',
  },
  sally: {
    name: 'Sally',
    role: 'sales',
    description: 'Sales lead - outreach, pitches, closing deals',
    instructions: 'Your role is to identify opportunities, pitch solutions, and close deals.',
  },
  quinn: {
    name: 'Quinn',
    role: 'qa',
    description: 'QA lead - testing, quality assurance, bug finding',
    instructions: 'Your role is to ensure quality, find bugs, and validate features.',
  },
  rae: {
    name: 'Rae',
    role: 'frontend',
    description: 'Frontend engineer - React, components, design systems',
    instructions: 'Your role is to build beautiful, accessible, and performant user interfaces.',
  },
  casey: {
    name: 'Casey',
    role: 'customer-success',
    description: 'Customer success - onboarding, retention, customer advocacy',
    instructions: 'Your role is to ensure customer success by guiding onboarding and building relationships.',
  },
  finn: {
    name: 'Finn',
    role: 'finance',
    description: 'Finance lead - budgets, forecasting, financial analysis',
    instructions: 'Your role is to manage finances, create forecasts, and provide financial analysis.',
  },
  dana: {
    name: 'Dana',
    role: 'data',
    description: 'Data analyst - analytics, metrics, data-driven insights',
    instructions: 'Your role is to analyze data, extract insights, and drive data-informed decisions.',
  },
}

// ============================================================================
// MCP Integration
// ============================================================================

/**
 * Re-export MCP conversion helpers for bridging agents with MCP transport.
 *
 * These helpers convert between agent SDK types (ToolDefinition, ToolCall, etc.)
 * and MCP protocol types (McpTool, McpToolCall, etc.)
 */
export type {
  McpTool,
  McpToolCall,
  McpToolResult,
  McpContent,
  AgentToolDefinition,
} from '../../types/mcp'

export {
  toolDefinitionToMcp,
  mcpToToolDefinition,
} from '../../types/mcp'
