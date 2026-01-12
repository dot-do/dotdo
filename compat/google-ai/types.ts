/**
 * @dotdo/google-ai - Google Generative AI Types
 *
 * Type definitions compatible with the official @google/generative-ai SDK.
 * @see https://ai.google.dev/api/rest
 */

// =============================================================================
// Harm Category and Safety Settings
// =============================================================================

/**
 * Harm categories for safety settings
 */
export enum HarmCategory {
  HARM_CATEGORY_UNSPECIFIED = 'HARM_CATEGORY_UNSPECIFIED',
  HARM_CATEGORY_HARASSMENT = 'HARM_CATEGORY_HARASSMENT',
  HARM_CATEGORY_HATE_SPEECH = 'HARM_CATEGORY_HATE_SPEECH',
  HARM_CATEGORY_SEXUALLY_EXPLICIT = 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  HARM_CATEGORY_DANGEROUS_CONTENT = 'HARM_CATEGORY_DANGEROUS_CONTENT',
}

/**
 * Threshold for blocking harmful content
 */
export enum HarmBlockThreshold {
  HARM_BLOCK_THRESHOLD_UNSPECIFIED = 'HARM_BLOCK_THRESHOLD_UNSPECIFIED',
  BLOCK_LOW_AND_ABOVE = 'BLOCK_LOW_AND_ABOVE',
  BLOCK_MEDIUM_AND_ABOVE = 'BLOCK_MEDIUM_AND_ABOVE',
  BLOCK_ONLY_HIGH = 'BLOCK_ONLY_HIGH',
  BLOCK_NONE = 'BLOCK_NONE',
}

/**
 * Probability of harm
 */
export enum HarmProbability {
  HARM_PROBABILITY_UNSPECIFIED = 'HARM_PROBABILITY_UNSPECIFIED',
  NEGLIGIBLE = 'NEGLIGIBLE',
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

/**
 * Safety setting for a category
 */
export interface SafetySetting {
  category: HarmCategory
  threshold: HarmBlockThreshold
}

/**
 * Safety rating for content
 */
export interface SafetyRating {
  category: HarmCategory
  probability: HarmProbability | string
  blocked?: boolean
}

// =============================================================================
// Content Parts
// =============================================================================

/**
 * Text part in content
 */
export interface TextPart {
  text: string
}

/**
 * Inline data (e.g., image bytes)
 */
export interface InlineDataPart {
  inlineData: {
    mimeType: string
    data: string // base64 encoded
  }
}

/**
 * File data reference
 */
export interface FileDataPart {
  fileData: {
    mimeType: string
    fileUri: string
  }
}

/**
 * Function call from the model
 */
export interface FunctionCallPart {
  functionCall: {
    name: string
    args: Record<string, unknown>
  }
}

/**
 * Function response to provide to the model
 */
export interface FunctionResponsePart {
  functionResponse: {
    name: string
    response: Record<string, unknown>
  }
}

/**
 * Union of all possible parts
 */
export type Part =
  | TextPart
  | InlineDataPart
  | FileDataPart
  | FunctionCallPart
  | FunctionResponsePart

// =============================================================================
// Content
// =============================================================================

/**
 * Role in a conversation
 */
export type Role = 'user' | 'model' | 'function'

/**
 * Content message with role and parts
 */
export interface Content {
  role: Role
  parts: Part[]
}

// =============================================================================
// Generation Configuration
// =============================================================================

/**
 * Configuration for content generation
 */
export interface GenerationConfig {
  /** Temperature for randomness (0.0-1.0) */
  temperature?: number
  /** Top-P for nucleus sampling */
  topP?: number
  /** Top-K for token selection */
  topK?: number
  /** Maximum number of output tokens */
  maxOutputTokens?: number
  /** Number of candidates to generate */
  candidateCount?: number
  /** Stop sequences to end generation */
  stopSequences?: string[]
  /** Response MIME type */
  responseMimeType?: string
}

// =============================================================================
// Function/Tool Declarations
// =============================================================================

/**
 * Schema for function parameters
 */
export interface FunctionDeclarationSchema {
  type: string
  properties?: Record<string, FunctionDeclarationSchemaProperty>
  required?: string[]
  description?: string
}

/**
 * Property in function declaration schema
 */
export interface FunctionDeclarationSchemaProperty {
  type: string
  description?: string
  enum?: string[]
  items?: FunctionDeclarationSchemaProperty
  properties?: Record<string, FunctionDeclarationSchemaProperty>
}

/**
 * Declaration of a function the model can call
 */
export interface FunctionDeclaration {
  name: string
  description?: string
  parameters?: FunctionDeclarationSchema
}

/**
 * Tool containing function declarations
 */
export interface Tool {
  functionDeclarations?: FunctionDeclaration[]
}

/**
 * Tool configuration
 */
export interface ToolConfig {
  functionCallingConfig?: {
    mode?: 'AUTO' | 'ANY' | 'NONE'
    allowedFunctionNames?: string[]
  }
}

// =============================================================================
// Response Types
// =============================================================================

/**
 * Finish reason for generation
 */
export type FinishReason =
  | 'FINISH_REASON_UNSPECIFIED'
  | 'STOP'
  | 'MAX_TOKENS'
  | 'SAFETY'
  | 'RECITATION'
  | 'OTHER'

/**
 * Usage metadata for token counts
 */
export interface UsageMetadata {
  promptTokenCount: number
  candidatesTokenCount: number
  totalTokenCount: number
}

/**
 * Candidate response from the model
 */
export interface Candidate {
  content: Content
  finishReason?: FinishReason
  index: number
  safetyRatings?: SafetyRating[]
}

/**
 * Response from generateContent
 */
export interface GenerateContentResponse {
  candidates?: Candidate[]
  promptFeedback?: {
    blockReason?: string
    safetyRatings?: SafetyRating[]
  }
  usageMetadata?: UsageMetadata
  /** Extract text from response */
  text: () => string
}

/**
 * Result wrapper for generateContent
 */
export interface GenerateContentResult {
  response: GenerateContentResponse
}

/**
 * Streaming result for generateContentStream
 */
export interface GenerateContentStreamResult {
  stream: AsyncIterable<GenerateContentResponse>
  response: Promise<GenerateContentResponse>
}

// =============================================================================
// Embedding Types
// =============================================================================

/**
 * Embedding values
 */
export interface ContentEmbedding {
  values: number[]
}

/**
 * Result from embedContent
 */
export interface EmbedContentResult {
  embedding: ContentEmbedding
}

/**
 * Request for batch embedding
 */
export interface EmbedContentRequest {
  content: Content
  taskType?: string
  title?: string
}

/**
 * Result from batchEmbedContents
 */
export interface BatchEmbedContentsResult {
  embeddings: ContentEmbedding[]
}

// =============================================================================
// Count Tokens Types
// =============================================================================

/**
 * Result from countTokens
 */
export interface CountTokensResult {
  totalTokens: number
}

// =============================================================================
// Request Types
// =============================================================================

/**
 * Request parameters for generateContent
 */
export interface GenerateContentRequest {
  contents: Content[]
  generationConfig?: GenerationConfig
  safetySettings?: SafetySetting[]
  tools?: Tool[]
  toolConfig?: ToolConfig
}

/**
 * Parameters for starting a chat session
 */
export interface StartChatParams {
  history?: Content[]
  generationConfig?: GenerationConfig
  safetySettings?: SafetySetting[]
  tools?: Tool[]
  toolConfig?: ToolConfig
}

// =============================================================================
// Model Parameters
// =============================================================================

/**
 * Parameters for getting a generative model
 */
export interface ModelParams {
  model: string
  generationConfig?: GenerationConfig
  safetySettings?: SafetySetting[]
  tools?: Tool[]
  toolConfig?: ToolConfig
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Google AI API error object
 */
export interface GoogleAIError {
  code: number
  message: string
  status: string
}

/**
 * Google AI API error response
 */
export interface GoogleAIErrorResponse {
  error: GoogleAIError
}

// =============================================================================
// Request Options
// =============================================================================

/**
 * Per-request options
 */
export interface RequestOptions {
  timeout?: number
  signal?: AbortSignal
}
