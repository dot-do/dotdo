/**
 * @dotdo/google-ai - Google Generative AI Compatibility Layer
 *
 * Drop-in replacement for @google/generative-ai with edge compatibility.
 * Runs on Cloudflare Workers, Deno, Bun, and Node.js.
 *
 * Features:
 * - Generate Content (text generation with prompts)
 * - Chat (multi-turn conversations)
 * - Embeddings (text embeddings)
 * - Function Calling (tool/function definitions)
 * - Streaming (streaming responses)
 * - Safety Settings (content moderation)
 *
 * @example Generate Content
 * ```typescript
 * import { GoogleGenerativeAI } from '@dotdo/google-ai'
 *
 * const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY)
 *
 * const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
 * const result = await model.generateContent('Write a story about a robot')
 * console.log(result.response.text())
 * ```
 *
 * @example Chat
 * ```typescript
 * const chat = model.startChat({
 *   history: [
 *     { role: 'user', parts: [{ text: 'Hello' }] },
 *     { role: 'model', parts: [{ text: 'Hi! How can I help?' }] },
 *   ],
 * })
 * const response = await chat.sendMessage('What is 2+2?')
 * console.log(response.response.text())
 * ```
 *
 * @example Streaming
 * ```typescript
 * const streamResult = await model.generateContentStream('Tell me a joke')
 * for await (const chunk of streamResult.stream) {
 *   console.log(chunk.text())
 * }
 * ```
 *
 * @example Embeddings
 * ```typescript
 * const embeddingModel = genAI.getGenerativeModel({ model: 'embedding-001' })
 * const result = await embeddingModel.embedContent('Hello world')
 * console.log(result.embedding.values)
 * ```
 *
 * @example Function Calling
 * ```typescript
 * const model = genAI.getGenerativeModel({
 *   model: 'gemini-pro',
 *   tools: [{
 *     functionDeclarations: [{
 *       name: 'getWeather',
 *       description: 'Get weather for a location',
 *       parameters: {
 *         type: 'object',
 *         properties: { location: { type: 'string' } },
 *         required: ['location'],
 *       },
 *     }],
 *   }],
 * })
 * ```
 *
 * @example Safety Settings
 * ```typescript
 * import { HarmCategory, HarmBlockThreshold } from '@dotdo/google-ai'
 *
 * const model = genAI.getGenerativeModel({
 *   model: 'gemini-pro',
 *   safetySettings: [{
 *     category: HarmCategory.HARM_CATEGORY_HARASSMENT,
 *     threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
 *   }],
 * })
 * ```
 *
 * @see https://ai.google.dev/api/rest
 * @module @dotdo/google-ai
 */

// Export main client and classes
export {
  GoogleGenerativeAI,
  GoogleGenerativeAIError,
  GenerativeModel,
  ChatSession,
} from './client'

export type { GoogleGenerativeAIConfig } from './client'

// Export enums
export { HarmCategory, HarmBlockThreshold, HarmProbability } from './types'

// Export all types
export type {
  // Safety
  SafetySetting,
  SafetyRating,

  // Content Parts
  Part,
  TextPart,
  InlineDataPart,
  FileDataPart,
  FunctionCallPart,
  FunctionResponsePart,

  // Content
  Role,
  Content,

  // Configuration
  GenerationConfig,
  FunctionDeclarationSchema,
  FunctionDeclarationSchemaProperty,
  FunctionDeclaration,
  Tool,
  ToolConfig,
  ModelParams,
  StartChatParams,

  // Request Types
  GenerateContentRequest,
  EmbedContentRequest,

  // Response Types
  FinishReason,
  UsageMetadata,
  Candidate,
  GenerateContentResponse,
  GenerateContentResult,
  GenerateContentStreamResult,
  ContentEmbedding,
  EmbedContentResult,
  BatchEmbedContentsResult,
  CountTokensResult,

  // Error Types
  GoogleAIError,
  GoogleAIErrorResponse,

  // Request Options
  RequestOptions,
} from './types'

// Default export
export { GoogleGenerativeAI as default } from './client'
