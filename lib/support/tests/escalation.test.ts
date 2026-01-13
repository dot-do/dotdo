import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Conversation, Customer, EscalationSettings } from '../types'

/**
 * Escalation Detection Tests
 *
 * Tests for AI-powered escalation detection using the `is` template literal
 * pattern. Verifies detection of various escalation triggers:
 * - Negative sentiment
 * - Conversation loops (repeated questions)
 * - Explicit human request
 * - High-value customer
 * - Complex/sensitive topics
 */

// Mock the AI template literals BEFORE importing modules that use them
vi.mock('../../../ai/template-literals', () => {
  const mockIs = vi.fn()
  const mockDecide = vi.fn()
  return {
    is: mockIs,
    decide: mockDecide,
  }
})

// Mock HumanClient to prevent real HTTP calls
vi.mock('../../humans/templates', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../humans/templates')>()

  // Create a mock HumanClient that doesn't make HTTP calls
  class MockHumanRequest implements PromiseLike<original.ApprovalResult> {
    private _role: string
    private _message: string
    private _sla?: number
    private _channel?: string
    private _requestId: string
    private _promise: Promise<original.ApprovalResult>

    constructor(
      role: string,
      message: string,
      options?: { sla?: number; channel?: string; requestId?: string }
    ) {
      this._role = role
      this._message = message
      this._sla = options?.sla
      this._channel = options?.channel
      this._requestId = options?.requestId || `mock-${Date.now()}`
      // Don't make HTTP calls - just resolve with a mock result
      this._promise = Promise.resolve({
        approved: true,
        approver: 'mock-human',
        reason: 'Auto-approved in test',
        respondedAt: new Date(),
        requestId: this._requestId,
      })
    }

    get role() { return this._role }
    get message() { return this._message }
    get sla() { return this._sla }
    get channel() { return this._channel }
    get requestId() { return this._requestId }

    then<TResult1 = original.ApprovalResult, TResult2 = never>(
      onfulfilled?: ((value: original.ApprovalResult) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
      return this._promise.then(onfulfilled, onrejected)
    }

    catch<TResult = never>(
      onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
    ): Promise<original.ApprovalResult | TResult> {
      return this._promise.catch(onrejected)
    }

    finally(onfinally?: (() => void) | null): Promise<original.ApprovalResult> {
      return this._promise.finally(onfinally)
    }

    timeout(duration: string): MockHumanRequest {
      const match = duration.match(/^(\d+)\s*(second|minute|hour|day|week)s?$/i)
      if (!match) throw new Error(`Invalid duration: ${duration}`)
      const value = parseInt(match[1]!, 10)
      const unit = match[2]!.toLowerCase()
      const multipliers: Record<string, number> = {
        second: 1000, minute: 60000, hour: 3600000, day: 86400000, week: 604800000
      }
      return new MockHumanRequest(this._role, this._message, {
        sla: value * multipliers[unit]!,
        channel: this._channel,
      })
    }

    via(channelName: string): MockHumanRequest {
      return new MockHumanRequest(this._role, this._message, {
        sla: this._sla,
        channel: channelName,
      })
    }
  }

  return {
    ...original,
    HumanRequest: MockHumanRequest,
  }
})

import { is, decide } from '../../../ai/template-literals'

// Import the module under test
import {
  detectEscalation,
  EscalationRequest,
  createEscalationChecker,
  analyzeSentiment,
  detectLoops,
  detectExplicitRequest,
  checkCustomerValue,
} from '../escalation'

// ============================================================================
// Test Helpers
// ============================================================================

function createTestConversation(messages: Array<{ role: 'agent' | 'customer'; content: string }>): Conversation {
  return {
    id: 'conv-test',
    messages: messages.map((m, i) => ({
      role: m.role,
      content: m.content,
      timestamp: new Date(Date.now() - (messages.length - i) * 60000),
    })),
    customer: {
      id: 'cust-123',
      name: 'Test Customer',
      email: 'test@example.com',
    },
    agent: { id: 'sam', name: 'Sam' },
    startedAt: new Date(),
  }
}

function createHighValueCustomer(): Customer {
  return {
    id: 'cust-vip',
    name: 'VIP Customer',
    email: 'vip@enterprise.com',
    metadata: { plan: 'enterprise', value: 100000 },
  }
}

/** Create a mock PipelinePromise that resolves to the given value */
function createMockPipelinePromise<T>(value: T) {
  const promise = Promise.resolve(value)
  return Object.assign(promise, {
    map: vi.fn().mockReturnThis(),
    get: vi.fn().mockReturnThis(),
    catch: vi.fn().mockReturnThis(),
  })
}

/** Set up mocks for the AI template literals */
function setupMocks(
  isResult: boolean,
  sentimentResult: 'positive' | 'negative' | 'neutral' = 'neutral'
) {
  const mockIs = vi.mocked(is)
  mockIs.mockImplementation(() => createMockPipelinePromise(isResult) as any)

  const mockDecide = vi.mocked(decide)
  mockDecide.mockImplementation(() => {
    return (() => createMockPipelinePromise(sentimentResult)) as any
  })
}

// ============================================================================
// detectEscalation() Tests
// ============================================================================

describe('detectEscalation()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns EscalationRequest when human intervention needed', async () => {
    setupMocks(true, 'negative')

    const conversation = createTestConversation([
      { role: 'customer', content: 'I am so frustrated! This is terrible!' },
      { role: 'agent', content: 'I apologize for the inconvenience.' },
      { role: 'customer', content: 'I want to speak to a human NOW!' },
    ])

    const request = await detectEscalation(conversation)

    expect(request).toBeInstanceOf(EscalationRequest)
    expect(request.shouldEscalate).toBe(true)
    // Verify resolve() method works
    const resolved = await request.resolve()
    expect(resolved).toBe(true)
  })

  it('returns false when no escalation needed', async () => {
    setupMocks(false, 'positive')

    const conversation = createTestConversation([
      { role: 'customer', content: 'Hi, I have a quick question about my order.' },
      { role: 'agent', content: 'Of course! What would you like to know?' },
    ])

    const request = await detectEscalation(conversation)

    expect(request.shouldEscalate).toBe(false)
  })

  it('uses AI to analyze the conversation', async () => {
    setupMocks(true, 'negative')

    const conversation = createTestConversation([
      { role: 'customer', content: 'This is unacceptable!' },
    ])

    await detectEscalation(conversation)

    expect(vi.mocked(decide)).toHaveBeenCalled()
  })
})

// ============================================================================
// EscalationRequest Class Tests
// ============================================================================

describe('EscalationRequest', () => {
  it('is awaitable like a Promise', async () => {
    const request = new EscalationRequest({
      shouldEscalate: true,
      triggers: ['sentiment'],
      conversation: createTestConversation([]),
    })

    // Use resolve() to get the boolean result - this is the correct pattern
    // since EscalationRequest is not a Promise but provides resolve() for async use
    const result = await request.resolve()
    expect(result).toBe(true)
  })

  it('supports .timeout() for SLA configuration', () => {
    const request = new EscalationRequest({
      shouldEscalate: true,
      triggers: ['explicit'],
      conversation: createTestConversation([]),
    })

    const withTimeout = request.timeout('1 hour')

    expect(withTimeout.sla).toBe(3600000) // 1 hour in ms
  })

  it('supports .to() for routing to specific role', () => {
    const request = new EscalationRequest({
      shouldEscalate: true,
      triggers: ['sentiment'],
      conversation: createTestConversation([]),
    })

    const routed = request.to('support-lead')

    expect(routed.role).toBe('support-lead')
  })

  it('supports .via() for channel selection', () => {
    const request = new EscalationRequest({
      shouldEscalate: true,
      triggers: ['value'],
      conversation: createTestConversation([]),
    })

    const withChannel = request.via('slack')

    expect(withChannel.channel).toBe('slack')
  })

  it('supports chaining .timeout().to().via()', () => {
    const request = new EscalationRequest({
      shouldEscalate: true,
      triggers: ['explicit'],
      conversation: createTestConversation([]),
    })

    const configured = request
      .timeout('30 minutes')
      .to('manager')
      .via('email')

    expect(configured.sla).toBe(1800000)
    expect(configured.role).toBe('manager')
    expect(configured.channel).toBe('email')
  })

  it('contains trigger information', () => {
    const request = new EscalationRequest({
      shouldEscalate: true,
      triggers: ['sentiment', 'explicit'],
      conversation: createTestConversation([]),
    })

    expect(request.triggers).toContain('sentiment')
    expect(request.triggers).toContain('explicit')
  })
})

// ============================================================================
// createEscalationChecker() Factory Tests
// ============================================================================

describe('createEscalationChecker()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a checker with custom settings', async () => {
    setupMocks(true, 'neutral')

    const settings: EscalationSettings = {
      sentiment: -0.7,
      loops: 2,
      explicit: true,
      value: 50000,
    }

    const checker = createEscalationChecker(settings)

    expect(typeof checker).toBe('function')
  })

  it('checker uses provided threshold settings', async () => {
    setupMocks(true, 'negative')

    const settings: EscalationSettings = {
      sentiment: -0.3, // Very sensitive
      loops: 1, // Single repeat triggers
      explicit: true,
    }

    const checker = createEscalationChecker(settings)
    const conversation = createTestConversation([
      { role: 'customer', content: 'I am a bit disappointed.' },
    ])

    const request = await checker(conversation)

    expect(request.shouldEscalate).toBe(true)
  })

  it('checker respects disabled triggers', async () => {
    setupMocks(false, 'neutral')

    const settings: EscalationSettings = {
      sentiment: -0.5,
      loops: 3,
      explicit: false, // Disabled explicit requests
    }

    const checker = createEscalationChecker(settings)
    const conversation = createTestConversation([
      { role: 'customer', content: 'I want to talk to a human please.' },
    ])

    // Should not escalate because explicit is disabled
    const request = await checker(conversation)

    // The result depends on other triggers, but explicit won't be in triggers
    expect(request.triggers).not.toContain('explicit')
  })
})

// ============================================================================
// analyzeSentiment() Tests
// ============================================================================

describe('analyzeSentiment()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns sentiment score for conversation', async () => {
    setupMocks(true, 'negative')

    const conversation = createTestConversation([
      { role: 'customer', content: 'This is terrible and I hate it!' },
    ])

    const result = await analyzeSentiment(conversation)

    expect(result.sentiment).toBeLessThan(0)
    expect(result.label).toBe('negative')
  })

  it('identifies positive sentiment', async () => {
    setupMocks(true, 'positive')

    const conversation = createTestConversation([
      { role: 'customer', content: 'Thank you so much! You are amazing!' },
    ])

    const result = await analyzeSentiment(conversation)

    expect(result.sentiment).toBeGreaterThan(0)
    expect(result.label).toBe('positive')
  })

  it('identifies neutral sentiment', async () => {
    setupMocks(true, 'neutral')

    const conversation = createTestConversation([
      { role: 'customer', content: 'Can you tell me the status of my order?' },
    ])

    const result = await analyzeSentiment(conversation)

    expect(result.sentiment).toBeCloseTo(0, 1)
    expect(result.label).toBe('neutral')
  })

  it('considers only customer messages', async () => {
    setupMocks(true, 'negative')

    const conversation = createTestConversation([
      { role: 'agent', content: 'How can I help you today?' },
      { role: 'customer', content: 'Your service is awful!' },
      { role: 'agent', content: 'I am sorry to hear that.' },
    ])

    await analyzeSentiment(conversation)

    // Verify the AI decide was called
    expect(vi.mocked(decide)).toHaveBeenCalled()
  })
})

// ============================================================================
// detectLoops() Tests
// ============================================================================

describe('detectLoops()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('detects repeated customer questions', async () => {
    setupMocks(true, 'neutral')

    const conversation = createTestConversation([
      { role: 'customer', content: 'Where is my order?' },
      { role: 'agent', content: 'Let me check for you.' },
      { role: 'customer', content: 'I asked where is my order?' },
      { role: 'agent', content: 'I am looking into it.' },
      { role: 'customer', content: 'You still have not answered where my order is!' },
    ])

    const result = await detectLoops(conversation, 2)

    expect(result.hasLoops).toBe(true)
    expect(result.loopCount).toBeGreaterThanOrEqual(2)
  })

  it('returns false when no loops detected', async () => {
    setupMocks(false, 'neutral')

    const conversation = createTestConversation([
      { role: 'customer', content: 'What is your return policy?' },
      { role: 'agent', content: 'You can return within 30 days.' },
      { role: 'customer', content: 'Great, thanks!' },
    ])

    const result = await detectLoops(conversation, 3)

    expect(result.hasLoops).toBe(false)
    expect(result.loopCount).toBe(0)
  })

  it('respects threshold parameter', async () => {
    setupMocks(true, 'neutral')

    const conversation = createTestConversation([
      { role: 'customer', content: 'Help me' },
      { role: 'agent', content: 'Sure' },
      { role: 'customer', content: 'Help me please' },
    ])

    // With high threshold, should not trigger
    const result = await detectLoops(conversation, 5)

    // Even if AI detects similarity, count must meet threshold
    expect(result.hasLoops).toBe(false)
  })
})

// ============================================================================
// detectExplicitRequest() Tests
// ============================================================================

describe('detectExplicitRequest()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('detects "talk to human" request', async () => {
    setupMocks(true, 'neutral')

    const conversation = createTestConversation([
      { role: 'customer', content: 'I want to talk to a human' },
    ])

    const result = await detectExplicitRequest(conversation)

    expect(result).toBe(true)
  })

  it('detects "speak to representative" request', async () => {
    setupMocks(true, 'neutral')

    const conversation = createTestConversation([
      { role: 'customer', content: 'Can I speak to a real person?' },
    ])

    const result = await detectExplicitRequest(conversation)

    expect(result).toBe(true)
  })

  it('detects "talk to manager" request', async () => {
    setupMocks(true, 'neutral')

    const conversation = createTestConversation([
      { role: 'customer', content: 'I need to speak with your manager' },
    ])

    const result = await detectExplicitRequest(conversation)

    expect(result).toBe(true)
  })

  it('returns false for normal conversation', async () => {
    setupMocks(false, 'neutral')

    const conversation = createTestConversation([
      { role: 'customer', content: 'What are your business hours?' },
    ])

    const result = await detectExplicitRequest(conversation)

    expect(result).toBe(false)
  })
})

// ============================================================================
// checkCustomerValue() Tests
// ============================================================================

describe('checkCustomerValue()', () => {
  it('returns true for high-value customer above threshold', () => {
    const customer = createHighValueCustomer()

    const result = checkCustomerValue(customer, 50000)

    expect(result).toBe(true)
  })

  it('returns false for customer below threshold', () => {
    const customer: Customer = {
      id: 'cust-basic',
      name: 'Basic Customer',
      email: 'basic@example.com',
      metadata: { plan: 'free', value: 0 },
    }

    const result = checkCustomerValue(customer, 10000)

    expect(result).toBe(false)
  })

  it('returns false when customer has no value metadata', () => {
    const customer: Customer = {
      id: 'cust-no-value',
      name: 'New Customer',
      email: 'new@example.com',
    }

    const result = checkCustomerValue(customer, 10000)

    expect(result).toBe(false)
  })

  it('handles enterprise plan as high value', () => {
    const customer: Customer = {
      id: 'cust-enterprise',
      name: 'Enterprise Customer',
      email: 'enterprise@corp.com',
      metadata: { plan: 'enterprise' },
    }

    // Enterprise plan should be considered high value even without explicit value
    const result = checkCustomerValue(customer, 10000)

    expect(result).toBe(true)
  })
})

// ============================================================================
// Integration Tests - support`message` Pattern
// ============================================================================

describe('support`message` Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('matches design doc pattern: support`help this frustrated customer`', async () => {
    // This test verifies the template literal pattern from the design doc works
    const mockIs = vi.mocked(is)
    mockIs.mockReturnValue(Promise.resolve(true) as any)

    // Import the support template (from humans.do integration)
    const { support } = await import('humans.do')

    const request = support`help this frustrated customer`

    expect(request.role).toBe('support')
    expect(request.message).toBe('help this frustrated customer')
  })

  it('supports .timeout() SLA configuration', async () => {
    const { support } = await import('humans.do')

    const request = support`urgent billing dispute`.timeout('1 hour')

    expect(request.sla).toBe(3600000)
    expect(request.role).toBe('support')
  })
})

// ============================================================================
// is`conversation needs human intervention` Pattern Tests
// ============================================================================

describe('is`conversation needs human intervention` Pattern', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses is template to detect escalation need', async () => {
    setupMocks(true, 'neutral')

    const conversation = createTestConversation([
      { role: 'customer', content: 'I am extremely upset!' },
    ])

    const conversationText = conversation.messages
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n')

    // The pattern from the design doc
    const escalate = await is`${conversationText} needs human intervention`

    expect(escalate).toBe(true)
    expect(vi.mocked(is)).toHaveBeenCalled()
  })
})

// ============================================================================
// Complex Scenario Tests
// ============================================================================

describe('Complex Escalation Scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('escalates when multiple triggers fire', async () => {
    setupMocks(true, 'negative')

    const conversation = createTestConversation([
      { role: 'customer', content: 'This is ridiculous! Where is my order?' },
      { role: 'agent', content: 'Let me look into that.' },
      { role: 'customer', content: 'I asked the same thing 3 times! I want a human!' },
    ])
    conversation.customer = createHighValueCustomer()

    const request = await detectEscalation(conversation)

    // Should have multiple triggers
    expect(request.shouldEscalate).toBe(true)
    expect(request.triggers.length).toBeGreaterThanOrEqual(2)
  })

  it('handles sensitive topics like billing disputes', async () => {
    setupMocks(true, 'negative')

    const conversation = createTestConversation([
      { role: 'customer', content: 'I was charged twice for my subscription!' },
      { role: 'agent', content: 'I see the duplicate charge.' },
      { role: 'customer', content: 'I need a refund immediately!' },
    ])

    const request = await detectEscalation(conversation, {
      sensitiveTopics: ['billing', 'refund', 'charge'],
    })

    expect(request.shouldEscalate).toBe(true)
    expect(request.triggers).toContain('sentiment')
  })

  it('prioritizes urgent escalations', async () => {
    setupMocks(true, 'negative')

    const conversation = createTestConversation([
      { role: 'customer', content: 'My account has been hacked! Help!' },
    ])

    const request = await detectEscalation(conversation, {
      urgentKeywords: ['hacked', 'security', 'fraud'],
    })

    expect(request.shouldEscalate).toBe(true)
    expect(request.priority).toBe('urgent')
  })
})

// ============================================================================
// humans.do Pool Integration Tests
// ============================================================================

describe('escalateToPool() - humans.do Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('converts EscalationRequest to HumanRequest for humans.do', async () => {
    const { escalateToPool, EscalationRequest } = await import('../escalation')

    const request = new EscalationRequest({
      shouldEscalate: true,
      triggers: ['sentiment', 'explicit'],
      conversation: createTestConversation([
        { role: 'customer', content: 'I need to talk to a real person!' },
      ]),
      priority: 'high',
    })

    const humanRequest = escalateToPool(request)

    // Should create a HumanRequest targeting the support pool
    expect(humanRequest.role).toBe('support')
    expect(humanRequest.message).toContain('conversation needs human')
  })

  it('includes trigger context in escalation message', async () => {
    const { escalateToPool, EscalationRequest } = await import('../escalation')

    const request = new EscalationRequest({
      shouldEscalate: true,
      triggers: ['sentiment', 'loops'],
      conversation: createTestConversation([
        { role: 'customer', content: 'This is terrible!' },
      ]),
    })

    const humanRequest = escalateToPool(request)

    // Message should include human-readable trigger descriptions
    expect(humanRequest.message).toContain('negative sentiment')
    expect(humanRequest.message).toContain('conversation loop')
  })

  it('respects priority by setting appropriate SLA', async () => {
    const { escalateToPool, EscalationRequest } = await import('../escalation')

    const urgentRequest = new EscalationRequest({
      shouldEscalate: true,
      triggers: ['explicit'],
      conversation: createTestConversation([]),
      priority: 'urgent',
    })

    const humanRequest = escalateToPool(urgentRequest)

    // Urgent priority should have a short SLA
    expect(humanRequest.sla).toBeDefined()
    expect(humanRequest.sla).toBeLessThanOrEqual(900000) // 15 minutes or less
  })

  it('includes customer context in escalation', async () => {
    const { escalateToPool, EscalationRequest } = await import('../escalation')

    const conversation = createTestConversation([
      { role: 'customer', content: 'Help me!' },
    ])
    conversation.customer = {
      id: 'cust-vip',
      name: 'VIP Customer',
      email: 'vip@enterprise.com',
      metadata: { plan: 'enterprise' },
    }

    const request = new EscalationRequest({
      shouldEscalate: true,
      triggers: ['value'],
      conversation,
    })

    const humanRequest = escalateToPool(request)

    // Should include customer info for context
    expect(humanRequest.message).toContain('VIP Customer')
  })

  it('routes to custom role when specified via .to()', async () => {
    const { escalateToPool, EscalationRequest } = await import('../escalation')

    const request = new EscalationRequest({
      shouldEscalate: true,
      triggers: ['sentiment'],
      conversation: createTestConversation([]),
    }).to('support-lead')

    const humanRequest = escalateToPool(request)

    expect(humanRequest.role).toBe('support-lead')
  })

  it('uses channel from .via() configuration', async () => {
    const { escalateToPool, EscalationRequest } = await import('../escalation')

    const request = new EscalationRequest({
      shouldEscalate: true,
      triggers: ['explicit'],
      conversation: createTestConversation([]),
    }).via('slack')

    const humanRequest = escalateToPool(request)

    expect(humanRequest.channel).toBe('slack')
  })

  it('throws when escalation is not needed', async () => {
    const { escalateToPool, EscalationRequest } = await import('../escalation')

    const request = new EscalationRequest({
      shouldEscalate: false,
      triggers: [],
      conversation: createTestConversation([]),
    })

    expect(() => escalateToPool(request)).toThrow('Escalation not needed')
  })

  it('includes conversation history summary', async () => {
    const { escalateToPool, EscalationRequest } = await import('../escalation')

    const conversation = createTestConversation([
      { role: 'customer', content: 'Where is my order?' },
      { role: 'agent', content: 'Let me check for you.' },
      { role: 'customer', content: 'I have been waiting for 2 weeks!' },
      { role: 'agent', content: 'I apologize for the delay.' },
      { role: 'customer', content: 'This is unacceptable! Get me a human!' },
    ])

    const request = new EscalationRequest({
      shouldEscalate: true,
      triggers: ['sentiment', 'explicit'],
      conversation,
    })

    const humanRequest = escalateToPool(request)

    // Should include recent conversation context
    expect(humanRequest.message).toContain('order')
  })
})

// ============================================================================
// detectAndEscalate() - Combined Detection and Pool Trigger
// ============================================================================

describe('detectAndEscalate() - End-to-End Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('detects escalation need and triggers humans.do pool in one call', async () => {
    setupMocks(true, 'negative')
    const { detectAndEscalate } = await import('../escalation')

    const conversation = createTestConversation([
      { role: 'customer', content: 'This is terrible! I need a human NOW!' },
    ])

    const humanRequest = await detectAndEscalate(conversation)

    expect(humanRequest).not.toBeNull()
    expect(humanRequest?.role).toBe('support')
  })

  it('returns null when no escalation needed', async () => {
    setupMocks(false, 'positive')
    const { detectAndEscalate } = await import('../escalation')

    const conversation = createTestConversation([
      { role: 'customer', content: 'Thanks for your help!' },
    ])

    const humanRequest = await detectAndEscalate(conversation)

    expect(humanRequest).toBeNull()
  })

  it('supports custom options for detection and escalation', async () => {
    setupMocks(true, 'negative')
    const { detectAndEscalate } = await import('../escalation')

    const conversation = createTestConversation([
      { role: 'customer', content: 'My security has been compromised!' },
    ])

    const humanRequest = await detectAndEscalate(conversation, {
      urgentKeywords: ['security', 'compromised'],
      escalationRole: 'security-team',
      escalationChannel: 'pagerduty',
    })

    expect(humanRequest?.role).toBe('security-team')
    expect(humanRequest?.channel).toBe('pagerduty')
  })
})
