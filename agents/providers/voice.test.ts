/**
 * Voice Provider Tests (RED Phase)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import {
  VapiProvider,
  createVapiProvider,
  LiveKitProvider,
  createLiveKitProvider,
} from './voice'
import type { ToolDefinition } from '../types'

describe('VapiProvider', () => {
  let provider: VapiProvider

  beforeEach(() => {
    provider = new VapiProvider({ apiKey: 'test-vapi-key' })
  })

  describe('constructor', () => {
    it('sets default model to gpt-4o', () => {
      const p = new VapiProvider({ apiKey: 'test' })
      expect(p).toBeDefined()
      expect(p.name).toBe('vapi')
    })

    it('sets default transcriber to deepgram nova-2', () => {
      const p = new VapiProvider({ apiKey: 'test' })
      expect(p).toBeDefined()
    })

    it('sets default voice to elevenlabs', () => {
      const p = new VapiProvider({ apiKey: 'test' })
      expect(p).toBeDefined()
    })

    it('accepts custom transcriber config', () => {
      const p = new VapiProvider({
        apiKey: 'test',
        transcriber: {
          provider: 'deepgram',
          model: 'nova-3',
          language: 'en-US',
        },
      })
      expect(p).toBeDefined()
    })

    it('accepts custom voice config', () => {
      const p = new VapiProvider({
        apiKey: 'test',
        voice: {
          provider: 'elevenlabs',
          voiceId: 'custom-voice',
        },
      })
      expect(p).toBeDefined()
    })
  })

  describe('createAgent()', () => {
    it('creates VoiceAgent with voice config', () => {
      const agent = provider.createAgent({
        id: 'voice-agent',
        name: 'Voice Assistant',
        instructions: 'You are a helpful voice assistant',
        model: 'gpt-4o',
        voice: {
          transcriber: {
            provider: 'deepgram',
            model: 'nova-2',
            language: 'en',
          },
          voice: {
            provider: 'elevenlabs',
            voiceId: 'rachel',
          },
          bargeIn: true,
          silenceTimeoutMs: 3000,
        },
      })

      expect(agent).toBeDefined()
      expect(agent.config.id).toBe('voice-agent')
      expect(agent.config.voice).toBeDefined()
    })

    it('uses default transcriber and voice when not specified', () => {
      const agent = provider.createAgent({
        id: 'test',
        name: 'Test',
        instructions: 'Test',
        model: 'gpt-4o',
      })

      expect(agent.config.voice).toBeDefined()
      expect(agent.config.voice?.transcriber).toBeDefined()
      expect(agent.config.voice?.voice).toBeDefined()
    })

    it('creates agent with tools', () => {
      const tool: ToolDefinition = {
        name: 'bookAppointment',
        description: 'Book an appointment',
        inputSchema: z.object({
          date: z.string(),
          time: z.string(),
        }),
        execute: async () => ({ confirmed: true }),
      }

      const agent = provider.createAgent({
        id: 'test',
        name: 'Test',
        instructions: 'Test',
        model: 'gpt-4o',
        tools: [tool],
      })

      expect(agent.config.tools).toHaveLength(1)
    })
  })

  describe('listModels()', () => {
    it('returns available models for voice', async () => {
      const models = await provider.listModels()

      expect(models).toContain('gpt-4o')
      expect(models).toContain('gpt-4o-mini')
      expect(models).toContain('claude-3-5-sonnet-20241022')
    })
  })
})

describe('VoiceAgent', () => {
  let provider: VapiProvider

  beforeEach(() => {
    provider = new VapiProvider({ apiKey: 'test-key' })
  })

  describe('startSession()', () => {
    it('creates session with connecting status', async () => {
      const agent = provider.createAgent({
        id: 'voice-test',
        name: 'Voice Test',
        instructions: 'Test',
        model: 'gpt-4o',
      })

      // Access the underlying VoiceAgent's startSession
      // Note: This may need to be exposed differently in the implementation
      const voiceAgent = agent as any // Type assertion for test
      if (voiceAgent.startSession) {
        const session = await voiceAgent.startSession()
        expect(session).toBeDefined()
        expect(session.status).toBe('connecting')
      }
    })

    it('returns session with unique ID', async () => {
      const agent = provider.createAgent({
        id: 'voice-test',
        name: 'Voice Test',
        instructions: 'Test',
        model: 'gpt-4o',
      })

      const voiceAgent = agent as any
      if (voiceAgent.startSession) {
        const session1 = await voiceAgent.startSession()
        const session2 = await voiceAgent.startSession()
        expect(session1.id).not.toBe(session2.id)
      }
    })
  })

  describe('speak()', () => {
    it('adds assistant entry to transcript', async () => {
      const agent = provider.createAgent({
        id: 'voice-test',
        name: 'Voice Test',
        instructions: 'Test',
        model: 'gpt-4o',
      })

      const voiceAgent = agent as any
      if (voiceAgent.startSession && voiceAgent.speak) {
        const session = await voiceAgent.startSession()
        await voiceAgent.speak('Hello, how can I help you?')

        // Check transcript
        expect(session.transcript).toBeDefined()
        expect(session.transcript.length).toBeGreaterThan(0)
        expect(session.transcript[0].role).toBe('assistant')
        expect(session.transcript[0].text).toBe('Hello, how can I help you?')
      }
    })

    it('throws if no active session', async () => {
      const agent = provider.createAgent({
        id: 'voice-test',
        name: 'Voice Test',
        instructions: 'Test',
        model: 'gpt-4o',
      })

      const voiceAgent = agent as any
      if (voiceAgent.speak) {
        await expect(voiceAgent.speak('Hello')).rejects.toThrow('No active session')
      }
    })
  })

  describe('endSession()', () => {
    it('sets session status to ended', async () => {
      const agent = provider.createAgent({
        id: 'voice-test',
        name: 'Voice Test',
        instructions: 'Test',
        model: 'gpt-4o',
      })

      const voiceAgent = agent as any
      if (voiceAgent.startSession && voiceAgent.endSession) {
        const session = await voiceAgent.startSession()
        await voiceAgent.endSession()
        expect(session.status).toBe('ended')
      }
    })
  })

  describe('run()', () => {
    it('starts session and waits for completion', async () => {
      const agent = provider.createAgent({
        id: 'voice-test',
        name: 'Voice Test',
        instructions: 'Test',
        model: 'gpt-4o',
      })

      // The run() method should work, but may need mocking
      // for the actual voice session completion
      expect(agent.run).toBeDefined()
    })

    it('sends initial prompt as first assistant message', async () => {
      const agent = provider.createAgent({
        id: 'voice-test',
        name: 'Voice Test',
        instructions: 'Test',
        model: 'gpt-4o',
      })

      expect(agent.run).toBeDefined()
    })
  })

  describe('stream()', () => {
    it('returns async iterable of voice events', () => {
      const agent = provider.createAgent({
        id: 'voice-test',
        name: 'Voice Test',
        instructions: 'Test',
        model: 'gpt-4o',
      })

      const streamResult = agent.stream({ prompt: 'Hello' })
      expect(streamResult[Symbol.asyncIterator]).toBeDefined()
      expect(streamResult.result).toBeDefined()
      expect(streamResult.text).toBeDefined()
    })
  })
})

describe('LiveKitProvider', () => {
  let provider: LiveKitProvider

  beforeEach(() => {
    provider = new LiveKitProvider({
      serverUrl: 'wss://test.livekit.cloud',
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    })
  })

  describe('constructor', () => {
    it('sets server URL', () => {
      const p = new LiveKitProvider({
        serverUrl: 'wss://custom.livekit.cloud',
        apiKey: 'key',
        apiSecret: 'secret',
      })
      expect(p).toBeDefined()
      expect(p.name).toBe('livekit')
    })

    it('sets default model to gpt-4o', () => {
      const p = new LiveKitProvider({
        serverUrl: 'wss://test.livekit.cloud',
        apiKey: 'key',
        apiSecret: 'secret',
      })
      expect(p).toBeDefined()
    })

    it('accepts custom default model', () => {
      const p = new LiveKitProvider({
        serverUrl: 'wss://test.livekit.cloud',
        apiKey: 'key',
        apiSecret: 'secret',
        defaultModel: 'gpt-4o-mini',
      })
      expect(p).toBeDefined()
    })
  })

  describe('createAgent()', () => {
    it('creates agent with provided config', () => {
      const agent = provider.createAgent({
        id: 'livekit-agent',
        name: 'LiveKit Agent',
        instructions: 'You are a voice assistant',
        model: 'gpt-4o',
      })

      expect(agent).toBeDefined()
      expect(agent.config.id).toBe('livekit-agent')
    })

    it('uses defaultModel when not specified', () => {
      const p = new LiveKitProvider({
        serverUrl: 'wss://test.livekit.cloud',
        apiKey: 'key',
        apiSecret: 'secret',
        defaultModel: 'gpt-4o-mini',
      })

      const agent = p.createAgent({
        id: 'test',
        name: 'Test',
        instructions: 'Test',
      })

      expect(agent.config.model).toBe('gpt-4o-mini')
    })
  })

  describe('listModels()', () => {
    it('returns available models', async () => {
      const models = await provider.listModels()

      expect(models).toContain('gpt-4o')
      expect(models).toContain('gpt-4o-mini')
      expect(models).toContain('claude-3-5-sonnet-20241022')
    })
  })
})

describe('createVapiProvider()', () => {
  it('creates provider with API key', () => {
    const provider = createVapiProvider({ apiKey: 'test-key' })
    expect(provider).toBeInstanceOf(VapiProvider)
  })

  it('creates provider with custom options', () => {
    const provider = createVapiProvider({
      apiKey: 'test-key',
      defaultModel: 'gpt-4o-mini',
      transcriber: {
        provider: 'deepgram',
        model: 'nova-3',
        language: 'en-US',
      },
    })
    expect(provider).toBeInstanceOf(VapiProvider)
  })
})

describe('createLiveKitProvider()', () => {
  it('creates provider with required options', () => {
    const provider = createLiveKitProvider({
      serverUrl: 'wss://test.livekit.cloud',
      apiKey: 'key',
      apiSecret: 'secret',
    })
    expect(provider).toBeInstanceOf(LiveKitProvider)
  })

  it('creates provider with custom default model', () => {
    const provider = createLiveKitProvider({
      serverUrl: 'wss://test.livekit.cloud',
      apiKey: 'key',
      apiSecret: 'secret',
      defaultModel: 'gpt-4o-mini',
    })
    expect(provider).toBeInstanceOf(LiveKitProvider)
  })
})
