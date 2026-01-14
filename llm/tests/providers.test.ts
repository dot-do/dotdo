/**
 * LLM Provider Tests
 *
 * Tests for provider adapters and registry.
 */

import { describe, it, expect } from 'vitest'
import {
  providerRegistry,
  getProvider,
  getAllProviders,
  getAvailableProviders,
  findProviderForModel,
  openaiAdapter,
  anthropicAdapter,
  workersAIAdapter,
  googleAdapter,
  ollamaAdapter,
} from '../providers'
import type { LLMEnv } from '../types'

describe('Provider Registry', () => {
  describe('providerRegistry', () => {
    it('should have all providers registered', () => {
      expect(providerRegistry.size).toBe(5)
      expect(providerRegistry.has('openai')).toBe(true)
      expect(providerRegistry.has('anthropic')).toBe(true)
      expect(providerRegistry.has('google')).toBe(true)
      expect(providerRegistry.has('workers-ai')).toBe(true)
      expect(providerRegistry.has('ollama')).toBe(true)
    })
  })

  describe('getProvider()', () => {
    it('should return OpenAI provider', () => {
      const provider = getProvider('openai')
      expect(provider).toBe(openaiAdapter)
      expect(provider?.name).toBe('openai')
    })

    it('should return Anthropic provider', () => {
      const provider = getProvider('anthropic')
      expect(provider).toBe(anthropicAdapter)
      expect(provider?.name).toBe('anthropic')
    })

    it('should return Google provider', () => {
      const provider = getProvider('google')
      expect(provider).toBe(googleAdapter)
      expect(provider?.name).toBe('google')
    })

    it('should return Workers AI provider', () => {
      const provider = getProvider('workers-ai')
      expect(provider).toBe(workersAIAdapter)
      expect(provider?.name).toBe('workers-ai')
    })

    it('should return Ollama provider', () => {
      const provider = getProvider('ollama')
      expect(provider).toBe(ollamaAdapter)
      expect(provider?.name).toBe('ollama')
    })
  })

  describe('getAllProviders()', () => {
    it('should return all providers', () => {
      const providers = getAllProviders()
      expect(providers.length).toBe(5)
      expect(providers).toContain(openaiAdapter)
      expect(providers).toContain(anthropicAdapter)
      expect(providers).toContain(googleAdapter)
      expect(providers).toContain(workersAIAdapter)
      expect(providers).toContain(ollamaAdapter)
    })
  })

  describe('getAvailableProviders()', () => {
    it('should return empty array when no credentials', () => {
      const providers = getAvailableProviders({})
      expect(providers.length).toBe(0)
    })

    it('should return OpenAI when API key is set', () => {
      const env: LLMEnv = { OPENAI_API_KEY: 'test-key' }
      const providers = getAvailableProviders(env)
      expect(providers).toContain(openaiAdapter)
    })

    it('should return Anthropic when API key is set', () => {
      const env: LLMEnv = { ANTHROPIC_API_KEY: 'test-key' }
      const providers = getAvailableProviders(env)
      expect(providers).toContain(anthropicAdapter)
    })

    it('should return Google when API key is set', () => {
      const env: LLMEnv = { GOOGLE_API_KEY: 'test-key' }
      const providers = getAvailableProviders(env)
      expect(providers).toContain(googleAdapter)
    })

    it('should return Workers AI when binding is set', () => {
      const env: LLMEnv = { AI: { run: async () => ({}) } }
      const providers = getAvailableProviders(env)
      expect(providers).toContain(workersAIAdapter)
    })

    it('should return Ollama when URL is set', () => {
      const env: LLMEnv = { OLLAMA_BASE_URL: 'http://localhost:11434' }
      const providers = getAvailableProviders(env)
      expect(providers).toContain(ollamaAdapter)
    })

    it('should return multiple providers when multiple credentials', () => {
      const env: LLMEnv = {
        OPENAI_API_KEY: 'test-key',
        ANTHROPIC_API_KEY: 'test-key',
        GOOGLE_API_KEY: 'test-key',
      }
      const providers = getAvailableProviders(env)
      expect(providers.length).toBe(3)
    })
  })

  describe('findProviderForModel()', () => {
    it('should find OpenAI provider for gpt models', () => {
      const env: LLMEnv = { OPENAI_API_KEY: 'test-key' }
      const provider = findProviderForModel('gpt-4o', env)
      expect(provider?.name).toBe('openai')
    })

    it('should find Anthropic provider for claude models', () => {
      const env: LLMEnv = { ANTHROPIC_API_KEY: 'test-key' }
      const provider = findProviderForModel('claude-3-5-sonnet', env)
      expect(provider?.name).toBe('anthropic')
    })

    it('should find Google provider for gemini models', () => {
      const env: LLMEnv = { GOOGLE_API_KEY: 'test-key' }
      const provider = findProviderForModel('gemini-1.5-pro', env)
      expect(provider?.name).toBe('google')
    })

    it('should find Workers AI provider for @cf models', () => {
      const env: LLMEnv = { AI: { run: async () => ({}) } }
      const provider = findProviderForModel('@cf/meta/llama-3.1-8b-instruct', env)
      expect(provider?.name).toBe('workers-ai')
    })

    it('should find Ollama provider for llama models', () => {
      const env: LLMEnv = { OLLAMA_BASE_URL: 'http://localhost:11434' }
      const provider = findProviderForModel('llama3.2', env)
      expect(provider?.name).toBe('ollama')
    })

    it('should return undefined when no provider available', () => {
      const provider = findProviderForModel('gpt-4o', {})
      expect(provider).toBeUndefined()
    })

    it('should return first available provider for unknown models', () => {
      const env: LLMEnv = { OPENAI_API_KEY: 'test-key' }
      const provider = findProviderForModel('unknown-model', env)
      expect(provider).toBeDefined()
    })
  })
})

describe('OpenAI Adapter', () => {
  describe('canHandle()', () => {
    it('should handle gpt-4o', () => {
      expect(openaiAdapter.canHandle('gpt-4o')).toBe(true)
    })

    it('should handle gpt-4o-mini', () => {
      expect(openaiAdapter.canHandle('gpt-4o-mini')).toBe(true)
    })

    it('should handle gpt-3.5-turbo', () => {
      expect(openaiAdapter.canHandle('gpt-3.5-turbo')).toBe(true)
    })

    it('should handle o1', () => {
      expect(openaiAdapter.canHandle('o1')).toBe(true)
    })

    it('should not handle claude models', () => {
      expect(openaiAdapter.canHandle('claude-3-5-sonnet')).toBe(false)
    })
  })

  describe('listModels()', () => {
    it('should return known OpenAI models', () => {
      const models = openaiAdapter.listModels()
      expect(models).toContain('gpt-4o')
      expect(models).toContain('gpt-4o-mini')
      expect(models).toContain('gpt-3.5-turbo')
      expect(models).toContain('o1')
    })
  })
})

describe('Anthropic Adapter', () => {
  describe('canHandle()', () => {
    it('should handle claude-3-5-sonnet', () => {
      expect(anthropicAdapter.canHandle('claude-3-5-sonnet')).toBe(true)
    })

    it('should handle claude-sonnet-4', () => {
      expect(anthropicAdapter.canHandle('claude-sonnet-4')).toBe(true)
    })

    it('should handle claude-3-opus', () => {
      expect(anthropicAdapter.canHandle('claude-3-opus')).toBe(true)
    })

    it('should not handle gpt models', () => {
      expect(anthropicAdapter.canHandle('gpt-4o')).toBe(false)
    })
  })

  describe('listModels()', () => {
    it('should return known Anthropic models', () => {
      const models = anthropicAdapter.listModels()
      expect(models).toContain('claude-3-5-sonnet-20241022')
      expect(models).toContain('claude-sonnet-4-20250514')
      expect(models).toContain('claude-opus-4-20250514')
    })
  })
})

describe('Google Adapter', () => {
  describe('canHandle()', () => {
    it('should handle gemini-1.5-pro', () => {
      expect(googleAdapter.canHandle('gemini-1.5-pro')).toBe(true)
    })

    it('should handle gemini-1.5-flash', () => {
      expect(googleAdapter.canHandle('gemini-1.5-flash')).toBe(true)
    })

    it('should not handle gpt models', () => {
      expect(googleAdapter.canHandle('gpt-4o')).toBe(false)
    })
  })

  describe('listModels()', () => {
    it('should return known Google models', () => {
      const models = googleAdapter.listModels()
      expect(models).toContain('gemini-1.5-pro')
      expect(models).toContain('gemini-1.5-flash')
    })
  })
})

describe('Workers AI Adapter', () => {
  describe('canHandle()', () => {
    it('should handle @cf/ prefixed models', () => {
      expect(workersAIAdapter.canHandle('@cf/meta/llama-3.1-8b-instruct')).toBe(true)
    })

    it('should handle llama models', () => {
      expect(workersAIAdapter.canHandle('llama')).toBe(true)
    })

    it('should handle mistral models', () => {
      expect(workersAIAdapter.canHandle('mistral')).toBe(true)
    })

    it('should not handle gpt models', () => {
      expect(workersAIAdapter.canHandle('gpt-4o')).toBe(false)
    })
  })

  describe('listModels()', () => {
    it('should return known Workers AI models', () => {
      const models = workersAIAdapter.listModels()
      expect(models).toContain('@cf/meta/llama-3.1-70b-instruct')
      expect(models).toContain('@cf/meta/llama-3.1-8b-instruct')
    })
  })
})

describe('Ollama Adapter', () => {
  describe('canHandle()', () => {
    it('should handle llama3 models', () => {
      expect(ollamaAdapter.canHandle('llama3.2')).toBe(true)
    })

    it('should handle mistral', () => {
      expect(ollamaAdapter.canHandle('mistral')).toBe(true)
    })

    it('should handle "local" keyword', () => {
      expect(ollamaAdapter.canHandle('local')).toBe(true)
    })

    it('should not handle gpt models specifically', () => {
      // Ollama can technically handle gpt as a local model name
      // but our canHandle checks for ollama-specific keywords
      expect(ollamaAdapter.canHandle('gpt-4o')).toBe(false)
    })
  })

  describe('listModels()', () => {
    it('should return known Ollama models', () => {
      const models = ollamaAdapter.listModels()
      expect(models).toContain('llama3.2')
      expect(models).toContain('mistral')
      expect(models).toContain('codellama')
    })
  })
})
