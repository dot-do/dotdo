/**
 * Voice Agent Provider
 *
 * Unified voice agent interface supporting:
 * - Vapi (voice AI platform)
 * - LiveKit Agents
 * - Retell AI
 * - Custom voice pipelines
 *
 * Voice agents follow the STT → LLM → TTS pipeline pattern.
 *
 * @see https://docs.vapi.ai
 * @see https://docs.livekit.io/agents
 */

import type {
  AgentProvider,
  AgentConfig,
  Agent,
  Message,
  StepResult,
  ToolDefinition,
  StreamEvent,
  VoiceConfig,
  TranscriberConfig,
  TTSConfig,
  AgentResult,
  AgentStreamResult,
} from '../types'
import { BaseAgent } from '../Agent'
import { zodToJsonSchema, isZodSchema } from '../Tool'

// ============================================================================
// Voice-Specific Types
// ============================================================================

export interface VoiceSession {
  id: string
  status: 'connecting' | 'connected' | 'speaking' | 'listening' | 'ended'
  transcript: TranscriptEntry[]
  metadata?: Record<string, unknown>
}

export interface TranscriptEntry {
  role: 'user' | 'assistant'
  text: string
  timestamp: Date
  confidence?: number
  isFinal: boolean
}

export interface VoiceEvent {
  type:
    | 'session-start'
    | 'session-end'
    | 'user-speech-start'
    | 'user-speech-end'
    | 'transcript-delta'
    | 'transcript-final'
    | 'assistant-speech-start'
    | 'assistant-speech-end'
    | 'tool-call'
    | 'error'
  data: unknown
  timestamp: Date
}

// ============================================================================
// Vapi Provider
// ============================================================================

export interface VapiProviderOptions {
  /** Vapi API key */
  apiKey: string
  /** Default transcriber */
  transcriber?: TranscriberConfig
  /** Default TTS voice */
  voice?: TTSConfig
  /** Default model */
  defaultModel?: string
}

export class VapiProvider implements AgentProvider {
  readonly name = 'vapi'
  readonly version = '1.0'

  private options: VapiProviderOptions

  constructor(options: VapiProviderOptions) {
    this.options = {
      defaultModel: 'gpt-4o',
      transcriber: {
        provider: 'deepgram',
        model: 'nova-2',
        language: 'en',
      },
      voice: {
        provider: 'elevenlabs',
        voiceId: 'rachel',
      },
      ...options,
    }
  }

  createAgent(config: AgentConfig): Agent {
    const voiceConfig: VoiceConfig = config.voice ?? {
      transcriber: this.options.transcriber!,
      voice: this.options.voice!,
      bargeIn: true,
      silenceTimeoutMs: 3000,
    }

    return new VoiceAgent({
      config: {
        ...config,
        model: config.model ?? this.options.defaultModel ?? 'gpt-4o',
        voice: voiceConfig,
      },
      provider: this,
      apiKey: this.options.apiKey,
    })
  }

  async listModels(): Promise<string[]> {
    return ['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet-20241022']
  }
}

// ============================================================================
// Voice Agent Implementation
// ============================================================================

interface VoiceAgentOptions {
  config: AgentConfig
  provider: VapiProvider
  apiKey: string
}

class VoiceAgent implements Agent {
  readonly config: AgentConfig
  readonly provider: AgentProvider
  private apiKey: string
  private session?: VoiceSession

  constructor(options: VoiceAgentOptions) {
    this.config = options.config
    this.provider = options.provider
    this.apiKey = options.apiKey
  }

  /**
   * Run voice agent - connects to a call and processes until complete
   */
  async run(input: { prompt?: string; messages?: Message[] }): Promise<AgentResult> {
    // For voice agents, "run" initiates a session and waits for completion
    const session = await this.startSession()

    // If there's an initial prompt, send it as the first assistant message
    if (input.prompt) {
      await this.speak(input.prompt)
    }

    // Wait for session to complete
    return this.waitForCompletion(session.id)
  }

  /**
   * Stream voice agent events
   */
  stream(input: { prompt?: string; messages?: Message[] }): AgentStreamResult {
    const self = this

    let resolveResult: (result: AgentResult) => void
    const resultPromise = new Promise<AgentResult>((resolve) => {
      resolveResult = resolve
    })

    let resolveText: (text: string) => void
    const textPromise = new Promise<string>((resolve) => {
      resolveText = resolve
    })

    const toolCallsPromise = Promise.resolve([])
    const usagePromise = Promise.resolve({ promptTokens: 0, completionTokens: 0, totalTokens: 0 })

    async function* generateEvents(): AsyncGenerator<StreamEvent> {
      const session = await self.startSession()

      yield {
        type: 'speech-start',
        data: { sessionId: session.id },
        timestamp: new Date(),
      }

      if (input.prompt) {
        await self.speak(input.prompt)
        yield {
          type: 'text-delta',
          data: { textDelta: input.prompt },
          timestamp: new Date(),
        }
      }

      // Poll for events (in a real implementation, this would be WebSocket)
      let fullText = ''
      while (session.status !== 'ended') {
        await new Promise((resolve) => setTimeout(resolve, 100))

        // Check for new transcript entries
        for (const entry of session.transcript) {
          if (entry.isFinal) {
            yield {
              type: entry.role === 'user' ? 'user-speech-end' : 'speech-end',
              data: { text: entry.text },
              timestamp: entry.timestamp,
            }
            if (entry.role === 'assistant') {
              fullText += entry.text + ' '
            }
          }
        }
      }

      const result: AgentResult = {
        text: fullText.trim(),
        toolCalls: [],
        toolResults: [],
        messages: session.transcript.map((t) => ({
          role: t.role,
          content: t.text,
        })),
        steps: 1,
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      }

      yield {
        type: 'done',
        data: { finalResult: result },
        timestamp: new Date(),
      }

      resolveResult(result)
      resolveText(fullText.trim())
    }

    return {
      [Symbol.asyncIterator]: generateEvents,
      result: resultPromise,
      text: textPromise,
      toolCalls: toolCallsPromise,
      usage: usagePromise,
    }
  }

  // ============================================================================
  // Voice-Specific Methods
  // ============================================================================

  /**
   * Start a voice session
   */
  async startSession(): Promise<VoiceSession> {
    // Create Vapi assistant configuration
    const assistant = this.buildAssistantConfig()

    // In a real implementation, this would call Vapi API
    // const response = await fetch('https://api.vapi.ai/call/web', { ... })

    this.session = {
      id: `voice-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      status: 'connecting',
      transcript: [],
    }

    return this.session
  }

  /**
   * Speak text to the user
   */
  async speak(text: string): Promise<void> {
    if (!this.session) {
      throw new Error('No active session')
    }

    this.session.transcript.push({
      role: 'assistant',
      text,
      timestamp: new Date(),
      isFinal: true,
    })

    // In real implementation, this would trigger TTS
  }

  /**
   * End the voice session
   */
  async endSession(): Promise<void> {
    if (this.session) {
      this.session.status = 'ended'
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private buildAssistantConfig(): unknown {
    const voice = this.config.voice!

    return {
      name: this.config.name,
      model: {
        provider: 'openai',
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: this.config.instructions,
          },
        ],
        functions: this.config.tools?.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: isZodSchema(tool.inputSchema)
            ? zodToJsonSchema(tool.inputSchema)
            : tool.inputSchema,
        })),
      },
      transcriber: {
        provider: voice.transcriber.provider,
        model: voice.transcriber.model,
        language: voice.transcriber.language,
        keywords: voice.transcriber.keywords,
      },
      voice: {
        provider: voice.voice.provider,
        voiceId: voice.voice.voiceId,
        speed: voice.voice.speed,
        stability: voice.voice.stability,
        similarityBoost: voice.voice.similarityBoost,
      },
      silenceTimeoutSeconds: (voice.silenceTimeoutMs ?? 3000) / 1000,
      endCallOnGoodbye: true,
      recordingEnabled: true,
    }
  }

  private async waitForCompletion(sessionId: string): Promise<AgentResult> {
    // Poll or wait for session to complete
    while (this.session?.status !== 'ended') {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    return {
      text: this.session.transcript
        .filter((t) => t.role === 'assistant')
        .map((t) => t.text)
        .join(' '),
      toolCalls: [],
      toolResults: [],
      messages: this.session.transcript.map((t) => ({
        role: t.role,
        content: t.text,
      })),
      steps: 1,
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }
  }
}

// ============================================================================
// LiveKit Provider
// ============================================================================

export interface LiveKitProviderOptions {
  /** LiveKit server URL */
  serverUrl: string
  /** API key */
  apiKey: string
  /** API secret */
  apiSecret: string
  /** Default model */
  defaultModel?: string
}

export class LiveKitProvider implements AgentProvider {
  readonly name = 'livekit'
  readonly version = '1.0'

  private options: LiveKitProviderOptions

  constructor(options: LiveKitProviderOptions) {
    this.options = {
      defaultModel: 'gpt-4o',
      ...options,
    }
  }

  createAgent(config: AgentConfig): Agent {
    // LiveKit uses a similar pattern but with different underlying infrastructure
    return new BaseAgent({
      config: {
        ...config,
        model: config.model ?? this.options.defaultModel ?? 'gpt-4o',
      },
      provider: this,
      generate: async (messages, cfg) => {
        // LiveKit integration would go here
        return {
          text: '',
          finishReason: 'stop',
        }
      },
    })
  }

  async listModels(): Promise<string[]> {
    return ['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet-20241022']
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createVapiProvider(options: VapiProviderOptions): VapiProvider {
  return new VapiProvider(options)
}

export function createLiveKitProvider(options: LiveKitProviderOptions): LiveKitProvider {
  return new LiveKitProvider(options)
}

export default VapiProvider
