/**
 * @dotdo/openai - OpenAI API Compatibility Layer
 *
 * Drop-in replacement for the official OpenAI SDK with edge compatibility.
 * Runs on Cloudflare Workers, Deno, Bun, and Node.js.
 *
 * Features:
 * - Chat completions (GPT-4, GPT-3.5-turbo, etc.)
 * - Embeddings (text-embedding-ada-002, text-embedding-3-small/large)
 * - Function/tool calling
 * - Streaming (SSE)
 * - Full TypeScript support
 *
 * @example Chat Completions
 * ```typescript
 * import OpenAI from '@dotdo/openai'
 *
 * const client = new OpenAI({ apiKey: 'sk-xxx' })
 *
 * const completion = await client.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Hello' }],
 * })
 *
 * console.log(completion.choices[0].message.content)
 * ```
 *
 * @example Embeddings
 * ```typescript
 * const embedding = await client.embeddings.create({
 *   model: 'text-embedding-ada-002',
 *   input: 'Hello world',
 * })
 *
 * console.log(embedding.data[0].embedding) // [0.123, -0.456, ...]
 * ```
 *
 * @example Function Calling
 * ```typescript
 * const completion = await client.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'What is the weather in SF?' }],
 *   tools: [{
 *     type: 'function',
 *     function: {
 *       name: 'get_weather',
 *       description: 'Get weather for a location',
 *       parameters: {
 *         type: 'object',
 *         properties: {
 *           location: { type: 'string' }
 *         },
 *         required: ['location']
 *       }
 *     }
 *   }],
 * })
 *
 * if (completion.choices[0].message.tool_calls) {
 *   const toolCall = completion.choices[0].message.tool_calls[0]
 *   console.log(toolCall.function.name, toolCall.function.arguments)
 * }
 * ```
 *
 * @example Streaming
 * ```typescript
 * const stream = await client.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Tell me a story' }],
 *   stream: true,
 * })
 *
 * for await (const chunk of stream) {
 *   const content = chunk.choices[0]?.delta?.content
 *   if (content) process.stdout.write(content)
 * }
 * ```
 *
 * @see https://platform.openai.com/docs/api-reference
 * @module @dotdo/openai
 */

// Export main client
export { OpenAI, OpenAIError, Stream } from './openai'
export type { OpenAIConfig } from './openai'

// Export AgentRuntime-backed client
export {
  OpenAIWithRuntime,
  createOpenAIWithRuntime,
} from './agent-runtime'
export type { AgentRuntimeOpenAIConfig } from './agent-runtime'

// Export all types
export type {
  // Common
  Usage,

  // Chat completions
  ChatCompletionRole,
  FunctionCall,
  ChatCompletionMessageToolCall,
  ChatCompletionMessageToolCallDelta,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionUserMessageParam,
  ChatCompletionContentPart,
  ChatCompletionAssistantMessageParam,
  ChatCompletionToolMessageParam,
  ChatCompletionFunctionMessageParam,
  ChatCompletionChoice,
  ChatCompletion,
  FunctionDefinition,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
  ChatCompletionFunctionCallOption,
  ChatCompletionCreateParams,

  // Streaming
  ChatCompletionChunkDelta,
  ChatCompletionChunkChoice,
  ChatCompletionChunk,

  // Embeddings
  Embedding,
  EmbeddingCreateParams,
  CreateEmbeddingResponse,

  // Images
  ImageSize,
  ImageQuality,
  ImageStyle,
  ImageResponseFormat,
  ImageCreateParams,
  ImageEditParams,
  ImageVariationParams,
  ImageData,
  ImagesResponse,

  // Models
  Model,
  ModelListResponse,
  ModelDeleteResponse,

  // Errors
  OpenAIAPIError,
  OpenAIErrorResponse,

  // Request options
  RequestOptions,
} from './types'

// Assistants API
export {
  AssistantsClient,
  createAssistantsClient,
  AssistantsAPIError,
} from './assistants'
export type {
  // Assistant types
  Assistant,
  AssistantTool,
  FunctionTool,
  FileSearchConfig,
  ToolResources,
  ResponseFormat,
  CreateAssistantRequest,
  UpdateAssistantRequest,

  // Thread types
  Thread,
  CreateThreadRequest,
  UpdateThreadRequest,

  // Message types
  Message as AssistantMessage,
  MessageContent,
  MessageContentInput,
  Annotation,
  Attachment,
  CreateMessageRequest,
  UpdateMessageRequest,
  ListMessagesParams,

  // Run types
  Run,
  RunStatus,
  RequiredAction,
  ToolCall as AssistantToolCall,
  RunError,
  Usage as AssistantUsage,
  TruncationStrategy,
  ToolChoice,
  CreateRunRequest,
  SubmitToolOutputsRequest,
  ToolOutput,
  CreateThreadAndRunRequest,

  // Run Step types
  RunStep,
  StepDetails,
  RunStepToolCall,
  CodeInterpreterOutput,
  FileSearchResult,

  // List types
  ListResponse,
  ListParams,
  DeleteResponse,

  // Client config
  AssistantsClientConfig,
} from './assistants'

// Default export
export { OpenAI as default } from './openai'
