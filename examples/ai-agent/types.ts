// AI Agent Example - Type definitions

/**
 * An AI conversation session
 */
export interface Conversation {
  $type: 'Conversation'
  title: string
  userId: string
  model: string
  status: 'active' | 'completed' | 'archived'
  messageCount: number
  tokenCount: number
  createdAt: string
  lastMessageAt?: string | undefined
}

/**
 * A message in a conversation
 */
export interface Message {
  $type: 'Message'
  conversationId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolCall?: ToolCall | undefined
  toolResult?: ToolResult | undefined
  tokenCount?: number | undefined
  model?: string | undefined
  finishReason?: string | undefined
  createdAt: string
}

/**
 * A tool that the AI agent can use
 */
export interface Tool {
  $type: 'Tool'
  name: string
  description: string
  parameters: ToolParameter[]
  enabled: boolean
}

/**
 * Tool parameter definition
 */
export interface ToolParameter {
  name: string
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  description: string
  required: boolean
  enum?: string[] | undefined
  default?: unknown
}

/**
 * A tool call made by the AI
 */
export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

/**
 * Result from executing a tool
 */
export interface ToolResult {
  toolCallId: string
  success: boolean
  result?: unknown
  error?: string | undefined
}

/**
 * Agent task - a long-running operation
 */
export interface Task {
  $type: 'Task'
  conversationId: string
  name: string
  description: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number  // 0-100
  steps: TaskStep[]
  result?: unknown
  error?: string | undefined
  startedAt: string
  completedAt?: string | undefined
}

/**
 * A step in a task
 */
export interface TaskStep {
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  startedAt?: string | undefined
  completedAt?: string | undefined
  result?: unknown
  error?: string | undefined
}

/**
 * Memory/knowledge stored by the agent
 */
export interface Memory {
  $type: 'Memory'
  conversationId?: string | undefined  // Optional - can be global or per-conversation
  type: 'fact' | 'preference' | 'context' | 'instruction'
  key: string
  value: string
  confidence: number  // 0-1
  source: string
  createdAt: string
  expiresAt?: string | undefined
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  $type: 'AgentConfig'
  name: string
  systemPrompt: string
  model: string
  temperature: number
  maxTokens: number
  tools: string[]  // Tool names
  memories: boolean
  streaming: boolean
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Chat request
 */
export interface ChatRequest {
  message: string
  conversationId?: string | undefined
  userId?: string | undefined
  model?: string | undefined
  tools?: string[] | undefined
  stream?: boolean | undefined
}

/**
 * Chat response
 */
export interface ChatResponse {
  conversationId: string
  messageId: string
  content: string
  toolCalls?: ToolCall[] | undefined
  finishReason: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  } | undefined
}

/**
 * Tool execution request
 */
export interface ExecuteToolRequest {
  conversationId: string
  toolCall: ToolCall
}

/**
 * Task execution request
 */
export interface ExecuteTaskRequest {
  conversationId: string
  taskName: string
  parameters: Record<string, unknown>
}

// ============================================================================
// Built-in Tool Types
// ============================================================================

/**
 * Web search result
 */
export interface SearchResult {
  title: string
  url: string
  snippet: string
}

/**
 * Calculator result
 */
export interface CalculatorResult {
  expression: string
  result: number
}

/**
 * Weather data
 */
export interface WeatherData {
  location: string
  temperature: number
  conditions: string
  humidity: number
  wind: string
}

/**
 * Note stored by the agent
 */
export interface Note {
  $type: 'Note'
  conversationId: string
  title: string
  content: string
  tags: string[]
  createdAt: string
}
