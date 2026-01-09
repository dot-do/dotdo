import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Browse Library - Provider Abstraction Tests
 *
 * These tests verify the Browse library that abstracts browser automation
 * across Cloudflare Browser Rendering and Browserbase providers.
 *
 * TDD Process: RED phase - all tests should fail initially.
 */

// Import the module under test (will fail until implemented)
import { Browse } from '../browse/index'
import type { BrowseSession, BrowseInitConfig } from '../browse/index'

// ============================================================================
// Mock Setup
// ============================================================================

// Mock @cloudflare/puppeteer
vi.mock('@cloudflare/puppeteer', () => ({
  default: {
    launch: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        goto: vi.fn().mockResolvedValue(undefined),
        screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-screenshot')),
        setViewport: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        $: vi.fn().mockResolvedValue({
          screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-element-screenshot')),
        }),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  },
}))

// Mock @browserbasehq/sdk
vi.mock('@browserbasehq/sdk', () => ({
  Browserbase: vi.fn().mockImplementation(() => ({
    sessions: {
      create: vi.fn().mockResolvedValue({
        id: 'mock-session-id',
        connectUrl: 'wss://connect.browserbase.com/mock',
        liveUrl: 'https://live.browserbase.com/mock-session',
      }),
    },
  })),
}))

// Mock puppeteer-core (used by browserbase)
vi.mock('puppeteer-core', () => ({
  default: {
    connect: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        goto: vi.fn().mockResolvedValue(undefined),
        screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-screenshot')),
        setViewport: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  },
}))

// Mock stagehand
vi.mock('@browserbasehq/stagehand', () => ({
  Stagehand: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    page: {
      goto: vi.fn().mockResolvedValue(undefined),
      screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-screenshot')),
      setViewport: vi.fn().mockResolvedValue(undefined),
    },
    act: vi.fn().mockResolvedValue({ success: true, action: 'clicked button' }),
    extract: vi.fn().mockResolvedValue({ title: 'Test Page', items: ['a', 'b'] }),
    observe: vi.fn().mockResolvedValue([
      { action: 'click', selector: 'button.submit', description: 'Submit form' },
      { action: 'type', selector: 'input.email', description: 'Enter email' },
    ]),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))

// ============================================================================
// Browse.init() - Provider Selection Tests
// ============================================================================

describe('Browse.init()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('provider selection', () => {
    it('with cloudflare provider uses @cloudflare/puppeteer', async () => {
      const mockBrowser = { BROWSER: 'mock-cloudflare-binding' }
      const config: BrowseInitConfig = {
        provider: 'cloudflare',
        env: { BROWSER: mockBrowser },
      }

      const session = await Browse.init(config)

      expect(session).toBeDefined()
      expect(session.goto).toBeTypeOf('function')
      expect(session.act).toBeTypeOf('function')
      expect(session.extract).toBeTypeOf('function')
      expect(session.observe).toBeTypeOf('function')
      expect(session.screenshot).toBeTypeOf('function')
      expect(session.close).toBeTypeOf('function')

      // Verify cloudflare/puppeteer was used
      const puppeteer = await import('@cloudflare/puppeteer')
      expect(puppeteer.default.launch).toHaveBeenCalledWith(mockBrowser)
    })

    it('with browserbase provider uses Browserbase SDK', async () => {
      const config: BrowseInitConfig = {
        provider: 'browserbase',
        env: {
          BROWSERBASE_API_KEY: 'test-api-key',
          BROWSERBASE_PROJECT_ID: 'test-project-id',
        },
      }

      const session = await Browse.init(config)

      expect(session).toBeDefined()
      expect(session.goto).toBeTypeOf('function')
      expect(session.act).toBeTypeOf('function')
      expect(session.extract).toBeTypeOf('function')
      expect(session.observe).toBeTypeOf('function')
      expect(session.screenshot).toBeTypeOf('function')
      expect(session.close).toBeTypeOf('function')

      // Verify Browserbase SDK was used
      const { Browserbase } = await import('@browserbasehq/sdk')
      expect(Browserbase).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
      })
    })

    it('returns liveViewUrl for browserbase+liveView', async () => {
      const config: BrowseInitConfig = {
        provider: 'browserbase',
        env: {
          BROWSERBASE_API_KEY: 'test-api-key',
          BROWSERBASE_PROJECT_ID: 'test-project-id',
        },
        liveView: true,
      }

      const session = await Browse.init(config)

      expect(session.liveViewUrl).toBeDefined()
      expect(typeof session.liveViewUrl).toBe('string')
      expect(session.liveViewUrl).toContain('browserbase.com')
    })

    it('defaults to cloudflare provider when none specified', async () => {
      const mockBrowser = { BROWSER: 'mock-binding' }
      const config: BrowseInitConfig = {
        env: { BROWSER: mockBrowser },
      }

      const session = await Browse.init(config)

      expect(session).toBeDefined()
      const puppeteer = await import('@cloudflare/puppeteer')
      expect(puppeteer.default.launch).toHaveBeenCalled()
    })
  })

  describe('configuration', () => {
    it('applies viewport settings', async () => {
      const config: BrowseInitConfig = {
        provider: 'cloudflare',
        env: { BROWSER: 'mock' },
        viewport: { width: 1920, height: 1080 },
      }

      const session = await Browse.init(config)
      expect(session).toBeDefined()
    })

    it('applies stealth mode when enabled', async () => {
      const config: BrowseInitConfig = {
        provider: 'browserbase',
        env: {
          BROWSERBASE_API_KEY: 'test-key',
          BROWSERBASE_PROJECT_ID: 'test-project',
        },
        stealth: true,
      }

      const session = await Browse.init(config)
      expect(session).toBeDefined()
    })
  })
})

// ============================================================================
// BrowseSession.goto() - Navigation Tests
// ============================================================================

describe('BrowseSession.goto()', () => {
  let session: BrowseSession

  beforeEach(async () => {
    vi.clearAllMocks()
    session = await Browse.init({
      provider: 'cloudflare',
      env: { BROWSER: 'mock' },
    })
  })

  afterEach(async () => {
    await session.close()
  })

  it('navigates to URL', async () => {
    const url = 'https://example.com'

    await session.goto(url)

    // Verify page navigation occurred
    // The actual verification depends on implementation
    // but the method should complete without error
    expect(true).toBe(true)
  })

  it('handles URL with path and query params', async () => {
    const url = 'https://example.com/page?foo=bar&baz=qux'

    await session.goto(url)

    expect(true).toBe(true)
  })

  it('throws on invalid URL', async () => {
    await expect(session.goto('not-a-valid-url')).rejects.toThrow()
  })
})

// ============================================================================
// BrowseSession.act() - AI Action Tests
// ============================================================================

describe('BrowseSession.act()', () => {
  let session: BrowseSession

  beforeEach(async () => {
    vi.clearAllMocks()
    session = await Browse.init({
      provider: 'cloudflare',
      env: { BROWSER: 'mock' },
    })
  })

  afterEach(async () => {
    await session.close()
  })

  it('executes via Stagehand', async () => {
    const instruction = 'Click the submit button'

    const result = await session.act(instruction)

    expect(result).toBeDefined()
    expect(result.success).toBe(true)
  })

  it('returns action result with details', async () => {
    const instruction = 'Fill in the email field with test@example.com'

    const result = await session.act(instruction)

    expect(result).toHaveProperty('success')
    expect(result).toHaveProperty('action')
  })

  it('handles complex multi-step instructions', async () => {
    const instruction = 'Search for "vitest" and click the first result'

    const result = await session.act(instruction)

    expect(result).toBeDefined()
  })
})

// ============================================================================
// BrowseSession.extract() - Data Extraction Tests
// ============================================================================

describe('BrowseSession.extract()', () => {
  let session: BrowseSession

  beforeEach(async () => {
    vi.clearAllMocks()
    session = await Browse.init({
      provider: 'cloudflare',
      env: { BROWSER: 'mock' },
    })
  })

  afterEach(async () => {
    await session.close()
  })

  it('returns typed data', async () => {
    const instruction = 'Extract the page title and all list items'

    const result = await session.extract<{ title: string; items: string[] }>(instruction)

    expect(result).toBeDefined()
    expect(result.title).toBeTypeOf('string')
    expect(Array.isArray(result.items)).toBe(true)
  })

  it('accepts optional schema for validation', async () => {
    const instruction = 'Extract product information'
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        price: { type: 'number' },
      },
    }

    const result = await session.extract(instruction, schema)

    expect(result).toBeDefined()
  })

  it('extracts structured data from page', async () => {
    const instruction = 'Get all navigation links'

    const result = await session.extract<{ links: string[] }>(instruction)

    expect(result).toBeDefined()
  })
})

// ============================================================================
// BrowseSession.observe() - Action Observation Tests
// ============================================================================

describe('BrowseSession.observe()', () => {
  let session: BrowseSession

  beforeEach(async () => {
    vi.clearAllMocks()
    session = await Browse.init({
      provider: 'cloudflare',
      env: { BROWSER: 'mock' },
    })
  })

  afterEach(async () => {
    await session.close()
  })

  it('returns available actions', async () => {
    const result = await session.observe()

    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns actions with descriptions', async () => {
    const result = await session.observe()

    expect(result[0]).toHaveProperty('action')
    expect(result[0]).toHaveProperty('description')
  })

  it('accepts optional instruction to filter actions', async () => {
    const instruction = 'Find all clickable buttons'

    const result = await session.observe(instruction)

    expect(Array.isArray(result)).toBe(true)
  })
})

// ============================================================================
// BrowseSession.screenshot() - Screenshot Tests
// ============================================================================

describe('BrowseSession.screenshot()', () => {
  let session: BrowseSession

  beforeEach(async () => {
    vi.clearAllMocks()
    session = await Browse.init({
      provider: 'cloudflare',
      env: { BROWSER: 'mock' },
    })
  })

  afterEach(async () => {
    await session.close()
  })

  it('returns base64 buffer', async () => {
    const result = await session.screenshot()

    expect(typeof result).toBe('string')
    // Base64 strings only contain alphanumeric, +, /, and = characters
    expect(result).toMatch(/^[A-Za-z0-9+/=]+$/)
  })

  it('accepts options for full page screenshot', async () => {
    const result = await session.screenshot({ fullPage: true })

    expect(typeof result).toBe('string')
  })

  it('accepts options for specific element', async () => {
    const result = await session.screenshot({ selector: '#main-content' })

    expect(typeof result).toBe('string')
  })

  it('accepts quality option for JPEG', async () => {
    const result = await session.screenshot({ type: 'jpeg', quality: 80 })

    expect(typeof result).toBe('string')
  })
})

// ============================================================================
// BrowseSession.close() - Session Teardown Tests
// ============================================================================

describe('BrowseSession.close()', () => {
  it('tears down session', async () => {
    const session = await Browse.init({
      provider: 'cloudflare',
      env: { BROWSER: 'mock' },
    })

    await expect(session.close()).resolves.not.toThrow()
  })

  it('can be called multiple times safely', async () => {
    const session = await Browse.init({
      provider: 'cloudflare',
      env: { BROWSER: 'mock' },
    })

    await session.close()
    await expect(session.close()).resolves.not.toThrow()
  })

  it('releases browser resources', async () => {
    const session = await Browse.init({
      provider: 'browserbase',
      env: {
        BROWSERBASE_API_KEY: 'test-key',
        BROWSERBASE_PROJECT_ID: 'test-project',
      },
    })

    await session.close()

    // Attempting to use session after close should fail gracefully
    // Implementation may throw or return error
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws on missing BROWSER binding for cloudflare', async () => {
    const config: BrowseInitConfig = {
      provider: 'cloudflare',
      env: {}, // No BROWSER binding
    }

    await expect(Browse.init(config)).rejects.toThrow()
  })

  it('throws on missing API key for browserbase', async () => {
    const config: BrowseInitConfig = {
      provider: 'browserbase',
      env: {}, // No credentials
    }

    await expect(Browse.init(config)).rejects.toThrow()
  })

  it('throws on invalid provider', async () => {
    const config = {
      provider: 'invalid-provider' as any,
      env: {},
    }

    await expect(Browse.init(config)).rejects.toThrow()
  })
})

// ============================================================================
// Type Exports Tests
// ============================================================================

describe('Type Exports', () => {
  it('exports BrowseSession interface', () => {
    // This is a compile-time check - if types are exported correctly,
    // the test file will compile
    const session: BrowseSession | null = null
    expect(session).toBeNull()
  })

  it('exports BrowseInitConfig interface', () => {
    const config: BrowseInitConfig = {
      provider: 'cloudflare',
    }
    expect(config.provider).toBe('cloudflare')
  })
})
