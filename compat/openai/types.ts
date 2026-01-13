/**
 * @dotdo/openai - OpenAI API Types
 *
 * Type definitions compatible with the official OpenAI SDK.
 * @see https://platform.openai.com/docs/api-reference
 */

// =============================================================================
// Common Types
// =============================================================================

/**
 * Usage statistics for API calls
 */
export interface Usage {
  prompt_tokens: number
  completion_tokens?: number
  total_tokens: number
}

// =============================================================================
// Chat Completion Types
// =============================================================================

/**
 * Role of a message in a chat conversation
 */
export type ChatCompletionRole = 'system' | 'user' | 'assistant' | 'tool' | 'function'

/**
 * Function call in a chat message
 */
export interface FunctionCall {
  name: string
  arguments: string
}

/**
 * Tool call in a chat message
 */
export interface ChatCompletionMessageToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

/**
 * Streamed tool call delta
 */
export interface ChatCompletionMessageToolCallDelta {
  index: number
  id?: string
  type?: 'function'
  function?: {
    name?: string
    arguments?: string
  }
}

/**
 * A message in a chat completion
 */
export interface ChatCompletionMessage {
  role: 'assistant'
  content: string | null
  function_call?: FunctionCall
  tool_calls?: ChatCompletionMessageToolCall[]
}

/**
 * Parameters for a message in a chat completion request
 */
export type ChatCompletionMessageParam =
  | ChatCompletionSystemMessageParam
  | ChatCompletionUserMessageParam
  | ChatCompletionAssistantMessageParam
  | ChatCompletionToolMessageParam
  | ChatCompletionFunctionMessageParam

export interface ChatCompletionSystemMessageParam {
  role: 'system'
  content: string
  name?: string
}

export interface ChatCompletionUserMessageParam {
  role: 'user'
  content: string | ChatCompletionContentPart[]
  name?: string
}

export interface ChatCompletionContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: {
    url: string
    detail?: 'auto' | 'low' | 'high'
  }
}

export interface ChatCompletionAssistantMessageParam {
  role: 'assistant'
  content?: string | null
  name?: string
  function_call?: FunctionCall
  tool_calls?: ChatCompletionMessageToolCall[]
}

export interface ChatCompletionToolMessageParam {
  role: 'tool'
  content: string
  tool_call_id: string
}

export interface ChatCompletionFunctionMessageParam {
  role: 'function'
  content: string
  name: string
}

/**
 * A choice in a chat completion response
 */
export interface ChatCompletionChoice {
  index: number
  message: ChatCompletionMessage
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'function_call' | 'content_filter' | null
}

/**
 * Chat completion response
 */
export interface ChatCompletion {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: ChatCompletionChoice[]
  usage?: Usage
  system_fingerprint?: string
}

/**
 * Function definition for legacy function calling
 */
export interface FunctionDefinition {
  name: string
  description?: string
  parameters?: Record<string, unknown>
}

/**
 * Tool definition for tool calling
 */
export interface ChatCompletionTool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

/**
 * Tool choice configuration
 */
export type ChatCompletionToolChoiceOption =
  | 'none'
  | 'auto'
  | 'required'
  | { type: 'function'; function: { name: string } }

/**
 * Function choice configuration (legacy)
 */
export type ChatCompletionFunctionCallOption =
  | 'none'
  | 'auto'
  | { name: string }

/**
 * Chat completion request parameters
 */
export interface ChatCompletionCreateParams {
  model: string
  messages: ChatCompletionMessageParam[]
  temperature?: number
  top_p?: number
  n?: number
  stream?: boolean
  stop?: string | string[] | null
  max_tokens?: number
  presence_penalty?: number
  frequency_penalty?: number
  logit_bias?: Record<string, number>
  user?: string
  tools?: ChatCompletionTool[]
  tool_choice?: ChatCompletionToolChoiceOption
  /** @deprecated Use tools instead */
  functions?: FunctionDefinition[]
  /** @deprecated Use tool_choice instead */
  function_call?: ChatCompletionFunctionCallOption
  response_format?: { type: 'text' | 'json_object' }
  seed?: number
}

// =============================================================================
// Streaming Types
// =============================================================================

/**
 * Delta content in a streaming chunk
 */
export interface ChatCompletionChunkDelta {
  role?: 'assistant'
  content?: string | null
  function_call?: {
    name?: string
    arguments?: string
  }
  tool_calls?: ChatCompletionMessageToolCallDelta[]
}

/**
 * Choice in a streaming chunk
 */
export interface ChatCompletionChunkChoice {
  index: number
  delta: ChatCompletionChunkDelta
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'function_call' | 'content_filter' | null
}

/**
 * Streaming chat completion chunk
 */
export interface ChatCompletionChunk {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: ChatCompletionChunkChoice[]
  system_fingerprint?: string
}

// =============================================================================
// Embedding Types
// =============================================================================

/**
 * Single embedding result
 */
export interface Embedding {
  object: 'embedding'
  index: number
  embedding: number[]
}

/**
 * Embedding creation request parameters
 */
export interface EmbeddingCreateParams {
  model: string
  input: string | string[]
  encoding_format?: 'float' | 'base64'
  dimensions?: number
  user?: string
}

/**
 * Embedding creation response
 */
export interface CreateEmbeddingResponse {
  object: 'list'
  data: Embedding[]
  model: string
  usage: {
    prompt_tokens: number
    total_tokens: number
  }
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * OpenAI API error object
 */
export interface OpenAIAPIError {
  type: string
  message: string
  code?: string
  param?: string
}

/**
 * OpenAI API error response
 */
export interface OpenAIErrorResponse {
  error: OpenAIAPIError
}

// =============================================================================
// Images Types
// =============================================================================

/**
 * Image size options
 */
export type ImageSize = '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792'

/**
 * Image quality options (DALL-E 3 only)
 */
export type ImageQuality = 'standard' | 'hd'

/**
 * Image style options (DALL-E 3 only)
 */
export type ImageStyle = 'vivid' | 'natural'

/**
 * Image response format
 */
export type ImageResponseFormat = 'url' | 'b64_json'

/**
 * Image generation request parameters
 */
export interface ImageCreateParams {
  /** The prompt to generate images from */
  prompt: string
  /** The model to use (dall-e-2 or dall-e-3) */
  model?: 'dall-e-2' | 'dall-e-3'
  /** Number of images to generate (1-10 for dall-e-2, 1 for dall-e-3) */
  n?: number
  /** Image quality (dall-e-3 only) */
  quality?: ImageQuality
  /** Response format */
  response_format?: ImageResponseFormat
  /** Image size */
  size?: ImageSize
  /** Image style (dall-e-3 only) */
  style?: ImageStyle
  /** User identifier for abuse tracking */
  user?: string
}

/**
 * Image edit request parameters
 */
export interface ImageEditParams {
  /** The image to edit (PNG, <4MB, square) */
  image: Blob | File
  /** The prompt describing the edit */
  prompt: string
  /** Mask image indicating areas to edit */
  mask?: Blob | File
  /** The model to use */
  model?: 'dall-e-2'
  /** Number of images to generate */
  n?: number
  /** Response format */
  response_format?: ImageResponseFormat
  /** Image size */
  size?: '256x256' | '512x512' | '1024x1024'
  /** User identifier */
  user?: string
}

/**
 * Image variation request parameters
 */
export interface ImageVariationParams {
  /** The image to generate variations of */
  image: Blob | File
  /** The model to use */
  model?: 'dall-e-2'
  /** Number of variations to generate */
  n?: number
  /** Response format */
  response_format?: ImageResponseFormat
  /** Image size */
  size?: '256x256' | '512x512' | '1024x1024'
  /** User identifier */
  user?: string
}

/**
 * Generated image data
 */
export interface ImageData {
  /** URL of the generated image (when response_format is 'url') */
  url?: string
  /** Base64-encoded image data (when response_format is 'b64_json') */
  b64_json?: string
  /** Revised prompt (dall-e-3 may modify prompts) */
  revised_prompt?: string
}

/**
 * Image generation response
 */
export interface ImagesResponse {
  /** Unix timestamp of creation */
  created: number
  /** Generated images */
  data: ImageData[]
}

// =============================================================================
// Models Types
// =============================================================================

/**
 * Model object
 */
export interface Model {
  /** Model identifier */
  id: string
  /** Object type (always 'model') */
  object: 'model'
  /** Unix timestamp of creation */
  created: number
  /** Model owner */
  owned_by: string
}

/**
 * Model list response
 */
export interface ModelListResponse {
  /** Object type (always 'list') */
  object: 'list'
  /** Available models */
  data: Model[]
}

/**
 * Model deletion response
 */
export interface ModelDeleteResponse {
  id: string
  object: 'model'
  deleted: boolean
}

// =============================================================================
// Request Options
// =============================================================================

/**
 * Per-request options
 */
export interface RequestOptions {
  headers?: Record<string, string>
  signal?: AbortSignal
  timeout?: number
}
