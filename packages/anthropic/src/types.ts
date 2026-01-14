/**
 * @dotdo/anthropic - Type Definitions
 *
 * TypeScript types for Anthropic API compatibility layer.
 * Matches the @anthropic-ai/sdk interface.
 *
 * @module @dotdo/anthropic/types
 */

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Anthropic client configuration options
 */
export interface AnthropicConfig {
  /** API key for authentication */
  apiKey: string
  /** Maximum number of retries (default: 2) */
  maxRetries?: number
  /** Request timeout in milliseconds (default: 600000) */
  timeout?: number
  /** Custom fetch implementation */
  fetch?: typeof fetch
  /** Base URL override (default: https://api.anthropic.com) */
  baseURL?: string
  /** Default headers to include in all requests */
  defaultHeaders?: Record<string, string>
  /** API version (default: 2023-06-01) */
  apiVersion?: string
}

// =============================================================================
// Message Types
// =============================================================================

/**
 * A message in a conversation
 */
export interface Message {
  /** Unique message identifier */
  id: string
  /** Object type, always 'message' */
  type: 'message'
  /** Role of the message author */
  role: 'assistant'
  /** Content blocks in the message */
  content: ContentBlock[]
  /** Model that generated the message */
  model: string
  /** Reason the model stopped generating */
  stop_reason: StopReason | null
  /** Stop sequence that caused the model to stop, if applicable */
  stop_sequence: string | null
  /** Token usage information */
  usage: Usage
}

/**
 * Token usage information
 */
export interface Usage {
  /** Number of input tokens */
  input_tokens: number
  /** Number of output tokens */
  output_tokens: number
}

/**
 * Reason the model stopped generating
 */
export type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use'

// =============================================================================
// Content Block Types
// =============================================================================

/**
 * A content block in a message
 */
export type ContentBlock = TextBlock | ToolUseBlock

/**
 * A text content block
 */
export interface TextBlock {
  type: 'text'
  text: string
}

/**
 * A tool use content block
 */
export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

/**
 * A tool result content block (for user messages)
 */
export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string | ContentBlock[]
  is_error?: boolean
}

/**
 * An image content block
 */
export interface ImageBlock {
  type: 'image'
  source: {
    type: 'base64'
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
    data: string
  }
}

/**
 * User message content types
 */
export type UserContentBlock = TextBlock | ImageBlock | ToolResultBlock

// =============================================================================
// Message Input Types
// =============================================================================

/**
 * A message in the conversation (input)
 */
export interface MessageParam {
  role: 'user' | 'assistant'
  content: string | ContentBlock[] | UserContentBlock[]
}

/**
 * Parameters for creating a message
 */
export interface MessageCreateParams {
  /** Model to use */
  model: string
  /** Maximum tokens to generate */
  max_tokens: number
  /** Messages in the conversation */
  messages: MessageParam[]
  /** System prompt */
  system?: string
  /** Temperature for sampling (0-1) */
  temperature?: number
  /** Nucleus sampling parameter */
  top_p?: number
  /** Top-k sampling parameter */
  top_k?: number
  /** Stop sequences */
  stop_sequences?: string[]
  /** Whether to stream the response */
  stream?: boolean
  /** Tools available to the model */
  tools?: Tool[]
  /** Tool choice configuration */
  tool_choice?: ToolChoice
  /** Request metadata */
  metadata?: MessageMetadata
}

/**
 * Parameters for creating a message (non-streaming)
 */
export interface MessageCreateParamsNonStreaming extends MessageCreateParams {
  stream?: false
}

/**
 * Parameters for creating a message (streaming)
 */
export interface MessageCreateParamsStreaming extends MessageCreateParams {
  stream: true
}

/**
 * Request metadata
 */
export interface MessageMetadata {
  /** User ID for tracking */
  user_id?: string
}

// =============================================================================
// Tool Types
// =============================================================================

/**
 * A tool definition
 */
export interface Tool {
  /** Tool name */
  name: string
  /** Tool description */
  description: string
  /** JSON Schema for tool input */
  input_schema: ToolInputSchema
}

/**
 * JSON Schema for tool input
 */
export interface ToolInputSchema {
  type: 'object'
  properties: Record<string, ToolPropertySchema>
  required?: string[]
}

/**
 * JSON Schema for a tool property
 */
export interface ToolPropertySchema {
  type: string
  description?: string
  enum?: string[]
  items?: ToolPropertySchema
  properties?: Record<string, ToolPropertySchema>
  required?: string[]
}

/**
 * Tool choice configuration
 */
export type ToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'tool'; name: string }

// =============================================================================
// Streaming Types
// =============================================================================

/**
 * Base stream event type
 */
export type MessageStreamEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | PingEvent

/**
 * Message start event
 */
export interface MessageStartEvent {
  type: 'message_start'
  message: Message
}

/**
 * Content block start event
 */
export interface ContentBlockStartEvent {
  type: 'content_block_start'
  index: number
  content_block: ContentBlock | PartialToolUseBlock
}

/**
 * Partial tool use block (for streaming)
 */
export interface PartialToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

/**
 * Content block delta event
 */
export interface ContentBlockDeltaEvent {
  type: 'content_block_delta'
  index: number
  delta: TextDelta | InputJsonDelta
}

/**
 * Text delta
 */
export interface TextDelta {
  type: 'text_delta'
  text: string
}

/**
 * Input JSON delta (for tool use streaming)
 */
export interface InputJsonDelta {
  type: 'input_json_delta'
  partial_json: string
}

/**
 * Content block stop event
 */
export interface ContentBlockStopEvent {
  type: 'content_block_stop'
  index: number
}

/**
 * Message delta event
 */
export interface MessageDeltaEvent {
  type: 'message_delta'
  delta: {
    stop_reason: StopReason | null
    stop_sequence: string | null
  }
  usage: {
    output_tokens: number
  }
}

/**
 * Message stop event
 */
export interface MessageStopEvent {
  type: 'message_stop'
}

/**
 * Ping event (for keepalive)
 */
export interface PingEvent {
  type: 'ping'
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Anthropic API error types
 */
export type AnthropicErrorType =
  | 'api_error'
  | 'authentication_error'
  | 'invalid_request_error'
  | 'not_found_error'
  | 'overloaded_error'
  | 'permission_error'
  | 'rate_limit_error'

/**
 * Anthropic API error response
 */
export interface AnthropicErrorResponse {
  type: 'error'
  error: {
    type: AnthropicErrorType
    message: string
  }
}

// =============================================================================
// Stream Interface
// =============================================================================

/**
 * Async iterable stream with helper methods
 */
export interface MessageStream extends AsyncIterable<MessageStreamEvent> {
  /** Get accumulated text from all text content blocks */
  getText(): string
  /** Get the final assembled message */
  getFinalMessage(): Message
}
