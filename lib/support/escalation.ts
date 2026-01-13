/**
 * AI-Powered Escalation Detection
 *
 * Detects when a support conversation needs human intervention using
 * AI-powered analysis of various escalation triggers:
 * - Negative sentiment
 * - Conversation loops (repeated questions)
 * - Explicit human request ("talk to human")
 * - High-value customer
 * - Complex/sensitive topics
 *
 * @example
 * ```typescript
 * // AI-powered escalation detection
 * const escalate = await is`${conversation} needs human intervention`
 *
 * // Using the support template
 * import { support } from 'humans.do'
 * support`help this frustrated customer`
 * support`urgent billing dispute`.timeout('1 hour')
 * ```
 */

import { is, decide } from '../../ai/template-literals'
import { parseDuration } from '../humans/templates'
import type {
  Conversation,
  Customer,
  EscalationSettings,
  EscalationTriggerType,
} from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for escalation detection
 */
export interface EscalationOptions {
  /** Sensitive topics that should trigger escalation */
  sensitiveTopics?: string[]
  /** Keywords that indicate urgency */
  urgentKeywords?: string[]
  /** Custom escalation settings */
  settings?: EscalationSettings
}

/**
 * Result of sentiment analysis
 */
export interface SentimentResult {
  /** Sentiment score from -1 (negative) to 1 (positive) */
  sentiment: number
  /** Sentiment label */
  label: 'positive' | 'negative' | 'neutral'
}

/**
 * Result of loop detection
 */
export interface LoopResult {
  /** Whether loops were detected */
  hasLoops: boolean
  /** Number of detected loops */
  loopCount: number
}

/**
 * Configuration for EscalationRequest
 */
export interface EscalationRequestConfig {
  /** Whether escalation is needed */
  shouldEscalate: boolean
  /** Which triggers fired */
  triggers: EscalationTriggerType[]
  /** The conversation being analyzed */
  conversation: Conversation
  /** Priority level */
  priority?: 'low' | 'normal' | 'high' | 'urgent'
}

// ============================================================================
// EscalationRequest Class
// ============================================================================

/**
 * Represents an escalation request that can be configured with SLA, role, and channel.
 *
 * Unlike HumanRequest which extends Promise, EscalationRequest is a plain object
 * that holds escalation information. Use the `shouldEscalate` property to check
 * if escalation is needed, and chain `.timeout()`, `.to()`, `.via()` to configure.
 *
 * The `resolve()` method returns a Promise for when async confirmation is needed.
 */
export class EscalationRequest {
  private _shouldEscalate: boolean
  private _triggers: EscalationTriggerType[]
  private _conversation: Conversation
  private _sla?: number
  private _role?: string
  private _channel?: string
  private _priority: 'low' | 'normal' | 'high' | 'urgent'

  constructor(config: EscalationRequestConfig) {
    this._shouldEscalate = config.shouldEscalate
    this._triggers = config.triggers
    this._conversation = config.conversation
    this._priority = config.priority ?? 'normal'
  }

  /**
   * Resolve the escalation request to a boolean.
   * Use this when you need to await the escalation decision.
   */
  resolve(): Promise<boolean> {
    return Promise.resolve(this._shouldEscalate)
  }

  /** Whether escalation is needed */
  get shouldEscalate(): boolean {
    return this._shouldEscalate
  }

  /** The triggers that fired */
  get triggers(): EscalationTriggerType[] {
    return [...this._triggers]
  }

  /** The conversation being analyzed */
  get conversation(): Conversation {
    return this._conversation
  }

  /** SLA timeout in milliseconds */
  get sla(): number | undefined {
    return this._sla
  }

  /** Target role for escalation */
  get role(): string | undefined {
    return this._role
  }

  /** Communication channel */
  get channel(): string | undefined {
    return this._channel
  }

  /** Priority level */
  get priority(): 'low' | 'normal' | 'high' | 'urgent' {
    return this._priority
  }

  /**
   * Set an SLA timeout for the escalation
   * @param duration Duration string like "1 hour", "30 minutes"
   */
  timeout(duration: string): EscalationRequest {
    const request = new EscalationRequest({
      shouldEscalate: this._shouldEscalate,
      triggers: this._triggers,
      conversation: this._conversation,
      priority: this._priority,
    })
    request._sla = parseDuration(duration)
    request._role = this._role
    request._channel = this._channel
    return request
  }

  /**
   * Route escalation to a specific role
   * @param targetRole Role like "support-lead", "manager"
   */
  to(targetRole: string): EscalationRequest {
    const request = new EscalationRequest({
      shouldEscalate: this._shouldEscalate,
      triggers: this._triggers,
      conversation: this._conversation,
      priority: this._priority,
    })
    request._sla = this._sla
    request._role = targetRole
    request._channel = this._channel
    return request
  }

  /**
   * Set the communication channel
   * @param channelName Channel like "slack", "email"
   */
  via(channelName: string): EscalationRequest {
    const request = new EscalationRequest({
      shouldEscalate: this._shouldEscalate,
      triggers: this._triggers,
      conversation: this._conversation,
      priority: this._priority,
    })
    request._sla = this._sla
    request._role = this._role
    request._channel = channelName
    return request
  }
}

// ============================================================================
// Core Detection Functions
// ============================================================================

/**
 * Analyze the sentiment of a conversation using AI.
 * Only considers customer messages.
 */
export async function analyzeSentiment(conversation: Conversation): Promise<SentimentResult> {
  // Extract only customer messages
  const customerMessages = conversation.messages
    .filter((m) => m.role === 'customer')
    .map((m) => m.content)
    .join('\n')

  if (!customerMessages) {
    return { sentiment: 0, label: 'neutral' }
  }

  // Use AI to classify sentiment
  const sentimentClassifier = decide(['positive', 'negative', 'neutral'])
  const label = await sentimentClassifier`What is the overall sentiment of this customer's messages?\n\n${customerMessages}`

  // Map label to numeric score
  const sentimentScores: Record<string, number> = {
    positive: 0.7,
    negative: -0.7,
    neutral: 0,
  }

  return {
    sentiment: sentimentScores[label] ?? 0,
    label: label as 'positive' | 'negative' | 'neutral',
  }
}

/**
 * Detect conversation loops (repeated questions from customer).
 */
export async function detectLoops(
  conversation: Conversation,
  threshold: number
): Promise<LoopResult> {
  // Extract customer messages
  const customerMessages = conversation.messages
    .filter((m) => m.role === 'customer')
    .map((m) => m.content)

  if (customerMessages.length < 2) {
    return { hasLoops: false, loopCount: 0 }
  }

  // Use AI to detect if customer is repeating themselves
  const messagesText = customerMessages.join('\n---\n')
  const hasRepetition = await is`Is the customer repeating the same question or concern multiple times in these messages?\n\n${messagesText}`

  if (!hasRepetition) {
    return { hasLoops: false, loopCount: 0 }
  }

  // Count potential loops by looking for similar messages
  let loopCount = 0
  for (let i = 1; i < customerMessages.length; i++) {
    const prev = customerMessages[i - 1]!
    const curr = customerMessages[i]!
    const similar = await is`Are these two messages asking about the same thing?\n\nMessage 1: ${prev}\n\nMessage 2: ${curr}`
    if (similar) {
      loopCount++
    }
  }

  return {
    hasLoops: loopCount >= threshold,
    loopCount,
  }
}

/**
 * Detect explicit requests to speak to a human.
 */
export async function detectExplicitRequest(conversation: Conversation): Promise<boolean> {
  // Get the most recent customer messages
  const recentCustomerMessages = conversation.messages
    .filter((m) => m.role === 'customer')
    .slice(-3)
    .map((m) => m.content)
    .join('\n')

  if (!recentCustomerMessages) {
    return false
  }

  // Use AI to detect explicit human request
  return is`Is the customer explicitly asking to speak to a human, representative, manager, or real person?\n\n${recentCustomerMessages}`
}

/**
 * Check if customer value exceeds threshold.
 */
export function checkCustomerValue(customer: Customer, threshold: number): boolean {
  // Check explicit value metadata
  const customerValue = customer.metadata?.value as number | undefined
  if (customerValue !== undefined && customerValue >= threshold) {
    return true
  }

  // Check for enterprise plan as high value indicator
  const plan = customer.metadata?.plan as string | undefined
  if (plan === 'enterprise') {
    return true
  }

  return false
}

/**
 * Check for sensitive or urgent topics in the conversation.
 */
async function checkSensitiveTopics(
  conversation: Conversation,
  sensitiveTopics: string[],
  urgentKeywords: string[]
): Promise<{ isSensitive: boolean; isUrgent: boolean }> {
  const allMessages = conversation.messages.map((m) => m.content).join(' ').toLowerCase()

  // Check for urgent keywords
  const isUrgent = urgentKeywords.some((keyword) => allMessages.includes(keyword.toLowerCase()))

  // Check for sensitive topics
  const isSensitive = sensitiveTopics.some((topic) => allMessages.includes(topic.toLowerCase()))

  return { isSensitive, isUrgent }
}

// ============================================================================
// Main Detection Function
// ============================================================================

/**
 * Detect if a conversation needs human escalation.
 *
 * Analyzes multiple triggers:
 * - Negative sentiment
 * - Conversation loops
 * - Explicit human request
 * - High-value customer
 * - Sensitive/urgent topics
 *
 * @param conversation The conversation to analyze
 * @param options Optional configuration
 * @returns EscalationRequest that can be awaited and configured
 */
export async function detectEscalation(
  conversation: Conversation,
  options: EscalationOptions = {}
): Promise<EscalationRequest> {
  const triggers: EscalationTriggerType[] = []
  let priority: 'low' | 'normal' | 'high' | 'urgent' = 'normal'

  const settings: EscalationSettings = options.settings ?? {
    sentiment: -0.5,
    loops: 3,
    explicit: true,
    value: 10000,
  }

  // Check sentiment
  const sentimentResult = await analyzeSentiment(conversation)
  if (sentimentResult.sentiment <= settings.sentiment) {
    triggers.push('sentiment')
    if (sentimentResult.sentiment <= -0.8) {
      priority = 'high'
    }
  }

  // Check for loops
  const loopResult = await detectLoops(conversation, settings.loops)
  if (loopResult.hasLoops) {
    triggers.push('loops')
  }

  // Check for explicit human request
  if (settings.explicit) {
    const explicit = await detectExplicitRequest(conversation)
    if (explicit) {
      triggers.push('explicit')
      priority = priority === 'urgent' ? 'urgent' : 'high'
    }
  }

  // Check customer value
  if (settings.value !== undefined) {
    const isHighValue = checkCustomerValue(conversation.customer, settings.value)
    if (isHighValue) {
      triggers.push('value')
    }
  }

  // Check sensitive/urgent topics
  if (options.sensitiveTopics?.length || options.urgentKeywords?.length) {
    const { isSensitive, isUrgent } = await checkSensitiveTopics(
      conversation,
      options.sensitiveTopics ?? [],
      options.urgentKeywords ?? []
    )

    if (isSensitive && !triggers.includes('sentiment')) {
      // Sensitive topics contribute to escalation via sentiment trigger
      triggers.push('sentiment')
    }

    if (isUrgent) {
      priority = 'urgent'
    }
  }

  const shouldEscalate = triggers.length > 0

  return new EscalationRequest({
    shouldEscalate,
    triggers,
    conversation,
    priority,
  })
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a configured escalation checker with custom settings.
 *
 * @param settings Escalation thresholds and configuration
 * @returns A function that checks conversations for escalation
 */
export function createEscalationChecker(
  settings: EscalationSettings
): (conversation: Conversation, options?: EscalationOptions) => Promise<EscalationRequest> {
  return async (conversation: Conversation, options: EscalationOptions = {}) => {
    return detectEscalation(conversation, {
      ...options,
      settings,
    })
  }
}
