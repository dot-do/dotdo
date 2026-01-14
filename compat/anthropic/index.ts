/**
 * @dotdo/anthropic - Anthropic API Compatibility Layer
 *
 * Drop-in replacement for @anthropic-ai/sdk with edge compatibility.
 * Provides Messages API, tool use, and streaming support.
 *
 * @example
 * ```typescript
 * import Anthropic from '@dotdo/anthropic'
 *
 * const client = new Anthropic({ apiKey: 'sk-ant-xxx' })
 *
 * // Basic message
 * const message = await client.messages.create({
 *   model: 'claude-3-sonnet-20240229',
 *   max_tokens: 1024,
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * })
 *
 * // With tools
 * const toolMessage = await client.messages.create({
 *   model: 'claude-3-sonnet-20240229',
 *   max_tokens: 1024,
 *   tools: [{
 *     name: 'get_weather',
 *     description: 'Get weather for a location',
 *     input_schema: {
 *       type: 'object',
 *       properties: { location: { type: 'string' } },
 *       required: ['location'],
 *     },
 *   }],
 *   messages: [{ role: 'user', content: 'What is the weather in SF?' }],
 * })
 *
 * // Streaming
 * const stream = await client.messages.create({
 *   model: 'claude-3-sonnet-20240229',
 *   max_tokens: 1024,
 *   messages: [{ role: 'user', content: 'Hello!' }],
 *   stream: true,
 * })
 * for await (const event of stream) {
 *   console.log(event)
 * }
 * ```
 *
 * @module @dotdo/anthropic
 */

// Export main client
export { Anthropic, AnthropicError, default } from './anthropic'

// Export types
export type {
  // Config
  AnthropicConfig,
  // Messages
  Message,
  MessageParam,
  MessageCreateParams,
  MessageCreateParamsNonStreaming,
  MessageCreateParamsStreaming,
  MessageMetadata,
  Usage,
  StopReason,
  // Content blocks
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ImageBlock,
  UserContentBlock,
  // Tools
  Tool,
  ToolInputSchema,
  ToolPropertySchema,
  ToolChoice,
  // Streaming
  MessageStream,
  MessageStreamEvent,
  MessageStartEvent,
  ContentBlockStartEvent,
  ContentBlockDeltaEvent,
  ContentBlockStopEvent,
  MessageDeltaEvent,
  MessageStopEvent,
  PingEvent,
  TextDelta,
  InputJsonDelta,
  PartialToolUseBlock,
  // Errors
  AnthropicErrorType,
  AnthropicErrorResponse,
} from './types'
