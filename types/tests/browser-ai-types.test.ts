import { describe, it, expect } from 'vitest'

/**
 * Browser & AI Type Tests (RED Phase)
 *
 * These tests verify the Browser, BrowseVerb, and AI types for browser automation
 * and AI gateway integration.
 *
 * Implementation requirements:
 * - Create types/Browser.ts with Browser interface and BrowserConfig
 * - Create types/BrowseVerb.ts with BrowseVerb, BrowseInput, BrowseOutput
 * - Create types/AI.ts with AIProvider, AIConfig, AI_MODELS
 *
 * Reference: Issue dotdo-46xp
 */

// ============================================================================
// Imports - These should fail until types are implemented
// ============================================================================

import type {
  Browser,
  BrowserProvider,
  BrowserStatus,
  BrowserConfig,
} from '../Browser'

import {
  validateBrowserConfig,
} from '../Browser'

import type {
  BrowseVerb,
  BrowseInput,
  BrowseOutput,
  BrowseMode,
} from '../BrowseVerb'

import {
  validateBrowseInput,
} from '../BrowseVerb'

import type {
  AIProvider,
  AIConfig,
} from '../AI'

import {
  AI_MODELS,
  validateAIConfig,
} from '../AI'

// ============================================================================
// Browser Type Tests
// ============================================================================

describe('Browser Type Definition', () => {
  it('should define Browser interface with required fields', () => {
    const browser: Browser = {
      $id: 'https://example.com.ai/browser/abc123',
      $type: 'Browser',
      name: 'My Browser Session',
      status: 'idle',
      provider: 'cloudflare',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    expect(browser.$type).toBe('Browser')
    expect(browser.$id).toBeDefined()
    expect(browser.status).toBe('idle')
    expect(browser.provider).toBe('cloudflare')
  })

  it('should define BrowserProvider union type', () => {
    const providers: BrowserProvider[] = ['cloudflare', 'browserbase']

    expect(providers).toContain('cloudflare')
    expect(providers).toContain('browserbase')
  })

  it('should define BrowserStatus union type', () => {
    const statuses: BrowserStatus[] = ['idle', 'active', 'paused', 'stopped']

    expect(statuses).toContain('idle')
    expect(statuses).toContain('active')
    expect(statuses).toContain('paused')
    expect(statuses).toContain('stopped')
  })

  it('should allow optional currentUrl field', () => {
    const browser: Browser = {
      $id: 'https://example.com.ai/browser/abc123',
      $type: 'Browser',
      name: 'Session',
      status: 'active',
      provider: 'browserbase',
      currentUrl: 'https://google.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    expect(browser.currentUrl).toBe('https://google.com')
  })

  it('should allow optional liveViewUrl field', () => {
    const browser: Browser = {
      $id: 'https://example.com.ai/browser/abc123',
      $type: 'Browser',
      name: 'Session',
      status: 'active',
      provider: 'browserbase',
      liveViewUrl: 'https://live.browserbase.com/session/xyz',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    expect(browser.liveViewUrl).toBe('https://live.browserbase.com/session/xyz')
  })

  it('should allow optional sessionId field', () => {
    const browser: Browser = {
      $id: 'https://example.com.ai/browser/abc123',
      $type: 'Browser',
      name: 'Session',
      status: 'active',
      provider: 'browserbase',
      sessionId: 'sess_12345',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    expect(browser.sessionId).toBe('sess_12345')
  })
})

// ============================================================================
// BrowserConfig Tests
// ============================================================================

describe('BrowserConfig Type', () => {
  it('should define BrowserConfig with optional provider', () => {
    const config: BrowserConfig = {}

    expect(config.provider).toBeUndefined()
  })

  it('should allow provider to be set', () => {
    const config: BrowserConfig = {
      provider: 'cloudflare',
    }

    expect(config.provider).toBe('cloudflare')
  })

  it('should allow liveView option', () => {
    const config: BrowserConfig = {
      provider: 'browserbase',
      liveView: true,
    }

    expect(config.liveView).toBe(true)
  })

  it('should allow stealth option', () => {
    const config: BrowserConfig = {
      stealth: true,
    }

    expect(config.stealth).toBe(true)
  })

  it('should allow viewport configuration', () => {
    const config: BrowserConfig = {
      viewport: { width: 1920, height: 1080 },
    }

    expect(config.viewport?.width).toBe(1920)
    expect(config.viewport?.height).toBe(1080)
  })

  it('should validate BrowserConfig with valid provider', () => {
    const result = validateBrowserConfig({
      provider: 'cloudflare',
      liveView: true,
    })

    expect(result.success).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should reject invalid provider', () => {
    const result = validateBrowserConfig({
      provider: 'invalid-provider' as BrowserProvider,
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'provider' })
    )
  })

  it('should reject invalid viewport dimensions', () => {
    const result = validateBrowserConfig({
      viewport: { width: -100, height: 0 },
    })

    expect(result.success).toBe(false)
    expect(result.errors.some(e => e.field === 'viewport')).toBe(true)
  })
})

// ============================================================================
// BrowseVerb Type Tests
// ============================================================================

describe('BrowseVerb Type Definition', () => {
  it('should define BrowseVerb interface extending Verb', () => {
    const browseVerb: BrowseVerb = {
      verb: 'browse',
      activity: 'browsing',
      event: 'browsed',
      input: {
        mode: 'navigate',
        url: 'https://example.com.ai',
      },
      output: {
        success: true,
      },
    }

    expect(browseVerb.verb).toBe('browse')
    expect(browseVerb.input).toBeDefined()
    expect(browseVerb.output).toBeDefined()
  })

  it('should define BrowseMode union type', () => {
    const modes: BrowseMode[] = ['navigate', 'act', 'extract', 'observe', 'agent']

    expect(modes).toContain('navigate')
    expect(modes).toContain('act')
    expect(modes).toContain('extract')
    expect(modes).toContain('observe')
    expect(modes).toContain('agent')
  })
})

// ============================================================================
// BrowseInput Tests
// ============================================================================

describe('BrowseInput Type', () => {
  it('should require mode field', () => {
    const input: BrowseInput = {
      mode: 'navigate',
    }

    expect(input.mode).toBe('navigate')
  })

  it('should allow optional url field', () => {
    const input: BrowseInput = {
      mode: 'navigate',
      url: 'https://example.com.ai',
    }

    expect(input.url).toBe('https://example.com.ai')
  })

  it('should allow optional instructions field', () => {
    const input: BrowseInput = {
      mode: 'act',
      instructions: 'Click the login button',
    }

    expect(input.instructions).toBe('Click the login button')
  })

  it('should allow optional schema field for extraction', () => {
    const input: BrowseInput = {
      mode: 'extract',
      url: 'https://example.com.ai/products',
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          price: { type: 'number' },
        },
      },
    }

    expect(input.schema).toBeDefined()
  })

  it('should allow optional browser reference', () => {
    const input: BrowseInput = {
      mode: 'agent',
      instructions: 'Fill out the form',
      browser: 'browser-123',
    }

    expect(input.browser).toBe('browser-123')
  })

  it('should validate BrowseInput with navigate mode', () => {
    const result = validateBrowseInput({
      mode: 'navigate',
      url: 'https://example.com.ai',
    })

    expect(result.success).toBe(true)
  })

  it('should require url for navigate mode', () => {
    const result = validateBrowseInput({
      mode: 'navigate',
      // Missing url
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'url' })
    )
  })

  it('should require instructions for act mode', () => {
    const result = validateBrowseInput({
      mode: 'act',
      // Missing instructions
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'instructions' })
    )
  })

  it('should validate url format when provided', () => {
    const result = validateBrowseInput({
      mode: 'navigate',
      url: 'not-a-valid-url',
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'url' })
    )
  })
})

// ============================================================================
// BrowseOutput Tests
// ============================================================================

describe('BrowseOutput Type', () => {
  it('should require success field', () => {
    const output: BrowseOutput = {
      success: true,
    }

    expect(output.success).toBe(true)
  })

  it('should allow optional data field', () => {
    const output: BrowseOutput = {
      success: true,
      data: { title: 'Page Title', items: ['a', 'b', 'c'] },
    }

    expect(output.data).toEqual({ title: 'Page Title', items: ['a', 'b', 'c'] })
  })

  it('should allow optional screenshot field', () => {
    const output: BrowseOutput = {
      success: true,
      screenshot: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...',
    }

    expect(output.screenshot).toBeDefined()
  })

  it('should allow optional error field on failure', () => {
    const output: BrowseOutput = {
      success: false,
      error: 'Navigation timeout exceeded',
    }

    expect(output.success).toBe(false)
    expect(output.error).toBe('Navigation timeout exceeded')
  })

  it('should allow optional currentUrl field', () => {
    const output: BrowseOutput = {
      success: true,
      currentUrl: 'https://example.com.ai/redirected',
    }

    expect(output.currentUrl).toBe('https://example.com.ai/redirected')
  })
})

// ============================================================================
// AI Type Tests
// ============================================================================

describe('AIProvider Type Definition', () => {
  it('should define AIProvider union type with all providers', () => {
    const providers: AIProvider[] = ['workers-ai', 'openai', 'anthropic', 'google']

    expect(providers).toContain('workers-ai')
    expect(providers).toContain('openai')
    expect(providers).toContain('anthropic')
    expect(providers).toContain('google')
  })

  it('should cover all major AI providers', () => {
    // Type-level test - these should compile
    const cloudflare: AIProvider = 'workers-ai'
    const openai: AIProvider = 'openai'
    const anthropic: AIProvider = 'anthropic'
    const google: AIProvider = 'google'

    expect([cloudflare, openai, anthropic, google]).toHaveLength(4)
  })
})

// ============================================================================
// AIConfig Tests
// ============================================================================

describe('AIConfig Type', () => {
  it('should require provider and model fields', () => {
    const config: AIConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    }

    expect(config.provider).toBe('anthropic')
    expect(config.model).toBe('claude-sonnet-4-20250514')
  })

  it('should allow optional gateway field', () => {
    const config: AIConfig = {
      provider: 'openai',
      model: 'gpt-4o',
      gateway: 'my-ai-gateway',
    }

    expect(config.gateway).toBe('my-ai-gateway')
  })

  it('should validate AIConfig with valid provider', () => {
    const result = validateAIConfig({
      provider: 'workers-ai',
      model: '@cf/meta/llama-3.1-70b-instruct',
    })

    expect(result.success).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should reject invalid provider', () => {
    const result = validateAIConfig({
      provider: 'invalid-provider' as AIProvider,
      model: 'some-model',
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'provider' })
    )
  })

  it('should require model field', () => {
    const result = validateAIConfig({
      provider: 'openai',
      model: '',
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'model' })
    )
  })
})

// ============================================================================
// AI_MODELS Constant Tests
// ============================================================================

describe('AI_MODELS Constant', () => {
  it('should export AI_MODELS constant', () => {
    expect(AI_MODELS).toBeDefined()
  })

  it('should have workers-ai models', () => {
    expect(AI_MODELS['workers-ai']).toBeDefined()
    expect(AI_MODELS['workers-ai'].default).toBe('@cf/meta/llama-3.1-70b-instruct')
  })

  it('should have openai models', () => {
    expect(AI_MODELS['openai']).toBeDefined()
    expect(AI_MODELS['openai'].default).toBe('gpt-4o')
  })

  it('should have anthropic models', () => {
    expect(AI_MODELS['anthropic']).toBeDefined()
    expect(AI_MODELS['anthropic'].default).toBe('claude-sonnet-4-20250514')
  })

  it('should have google models', () => {
    expect(AI_MODELS['google']).toBeDefined()
    expect(AI_MODELS['google'].default).toBe('gemini-1.5-pro')
  })

  it('should have embedding model options', () => {
    expect(AI_MODELS['workers-ai'].embedding).toBeDefined()
    expect(AI_MODELS['openai'].embedding).toBeDefined()
  })

  it('should have vision model options where available', () => {
    expect(AI_MODELS['openai'].vision).toBeDefined()
    expect(AI_MODELS['anthropic'].vision).toBeDefined()
  })
})

// ============================================================================
// Integration Tests - Browser + AI
// ============================================================================

describe('Browser + AI Integration', () => {
  it('should support browser agent with AI config', () => {
    const input: BrowseInput = {
      mode: 'agent',
      instructions: 'Search for TypeScript tutorials and extract the top 5 results',
      browser: 'browser-abc',
    }

    const aiConfig: AIConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      gateway: 'my-gateway',
    }

    expect(input.mode).toBe('agent')
    expect(aiConfig.provider).toBe('anthropic')
  })

  it('should support extraction with schema', () => {
    const input: BrowseInput = {
      mode: 'extract',
      url: 'https://news.ycombinator.com',
      schema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            url: { type: 'string' },
            points: { type: 'number' },
          },
        },
      },
    }

    const output: BrowseOutput = {
      success: true,
      data: [
        { title: 'Story 1', url: 'https://...', points: 100 },
        { title: 'Story 2', url: 'https://...', points: 50 },
      ],
    }

    expect(input.mode).toBe('extract')
    expect(Array.isArray(output.data)).toBe(true)
  })
})
