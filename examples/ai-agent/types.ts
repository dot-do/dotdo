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
  lastMessageAt?: string
}

/**
 * A message in a conversation
 */
export interface Message {
  $type: 'Message'
  conversationId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolCall?: ToolCall
  toolResult?: ToolResult
  tokenCount?: number
  model?: string
  finishReason?: string
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
  enum?: string[]
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
  error?: string
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
  error?: string
  startedAt: string
  completedAt?: string
}

/**
 * A step in a task
 */
export interface TaskStep {
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  startedAt?: string
  completedAt?: string
  result?: unknown
  error?: string
}

/**
 * Memory/knowledge stored by the agent
 */
export interface Memory {
  $type: 'Memory'
  conversationId?: string  // Optional - can be global or per-conversation
  type: 'fact' | 'preference' | 'context' | 'instruction'
  key: string
  value: string
  confidence: number  // 0-1
  source: string
  createdAt: string
  expiresAt?: string
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
  conversationId?: string
  userId?: string
  model?: string
  tools?: string[]
  stream?: boolean
}

/**
 * Chat response
 */
export interface ChatResponse {
  conversationId: string
  messageId: string
  content: string
  toolCalls?: ToolCall[]
  finishReason: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
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
