/**
 * Agent Provider Exports
 *
 * All provider implementations for different agent SDKs.
 */

// Vercel AI SDK
export {
  VercelProvider,
  createVercelProvider,
  type VercelProviderOptions,
} from './vercel'

// Claude / Anthropic
export {
  ClaudeProvider,
  createClaudeProvider,
  type ClaudeProviderOptions,
} from './claude'

// OpenAI Agents SDK
export {
  OpenAIProvider,
  createOpenAIProvider,
  type OpenAIProviderOptions,
} from './openai'

// Devin (Cognition)
export {
  DevinProvider,
  createDevinProvider,
  type DevinProviderOptions,
} from './devin'

// Voice Agents (Vapi, LiveKit)
export {
  VapiProvider,
  createVapiProvider,
  type VapiProviderOptions,
  LiveKitProvider,
  createLiveKitProvider,
  type LiveKitProviderOptions,
  type VoiceSession,
  type TranscriptEntry,
  type VoiceEvent,
} from './voice'

// Re-export provider interface
export type { AgentProvider } from '../types'
