/**
 * Topic-Based Routing Module
 *
 * Routes support conversations to appropriate agents based on detected topics.
 * Supports keyword-based detection by default with optional AI-based detection.
 */

import type { Agent, Conversation, SupportConfig } from './types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of topic detection
 */
export interface TopicDetectionResult {
  /** Detected topic name, or null if no topic detected */
  topic: string | null
  /** Confidence score from 0 to 1 */
  confidence: number
}

/**
 * Topic detector function signature
 * Can be keyword-based (sync) or AI-based (async)
 */
export type TopicDetector = (conversation: Conversation) => Promise<TopicDetectionResult>

/**
 * Result of routing a conversation to an agent
 */
export interface RouterResult {
  /** The agent to route the conversation to */
  agent: Agent
  /** The detected topic, if any */
  topic?: string | null
  /** Confidence score of the topic detection (0-1) */
  confidence: number
  /** Reason for the routing decision */
  reason?: string
  /** Whether the confidence was below the threshold */
  belowThreshold?: boolean
}

/**
 * Options for creating a router
 */
export interface RouterOptions {
  /** Custom topic detector (defaults to keyword-based) */
  detector?: TopicDetector
  /** Minimum confidence threshold for topic routing (0-1, default: 0.5) */
  confidenceThreshold?: number
}

/**
 * Router interface for routing conversations to agents
 */
export interface Router {
  /** Route a conversation to an appropriate agent */
  route(conversation: Conversation): Promise<RouterResult>
}

/**
 * AI classifier interface for topic detection
 * Compatible with WorkersAI and other AI providers
 */
export interface AIClassifier {
  /** Generate text from a prompt */
  generateText(prompt: string, options?: { systemPrompt?: string }): Promise<{ text: string }>
}

/**
 * Options for creating an AI topic detector
 */
export interface AITopicDetectorOptions {
  /** List of valid topics to classify into */
  topics?: string[]
  /** System prompt override */
  systemPrompt?: string
}

// ============================================================================
// KEYWORD DETECTION
// ============================================================================

/**
 * Topic keyword mappings for keyword-based detection
 */
const TOPIC_KEYWORDS: Record<string, string[]> = {
  billing: [
    'invoice',
    'payment',
    'charge',
    'refund',
    'subscription',
    'bill',
    'receipt',
    'price',
    'cost',
    'fee',
    'credit',
    'debit',
    'account balance',
    'overdue',
    'transaction',
  ],
  technical: [
    'api',
    'error',
    'bug',
    'crash',
    'broken',
    'issue',
    'problem',
    'not working',
    'integration',
    'code',
    'endpoint',
    'request',
    'response',
    '500',
    '404',
    '401',
    'timeout',
    'connection',
    'server',
    'database',
    'deploy',
    'production',
    'debug',
  ],
  sales: [
    'upgrade',
    'plan',
    'enterprise',
    'demo',
    'trial',
    'pricing',
    'quote',
    'discount',
    'contract',
    'license',
    'purchase',
    'buy',
    'team size',
    'features',
    'compare',
  ],
}

/**
 * Default keyword-based topic detector
 */
function createKeywordDetector(): TopicDetector {
  return async (conversation: Conversation): Promise<TopicDetectionResult> => {
    // Combine all customer messages, with more weight on recent ones
    const messages = conversation.messages.filter((m) => m.role === 'customer')

    if (messages.length === 0) {
      return { topic: null, confidence: 0 }
    }

    // Calculate scores for each topic
    const scores: Record<string, number> = {}

    messages.forEach((message, index) => {
      const content = message.content.toLowerCase()
      // More recent messages get higher weight (1.0 to 2.0)
      const recencyWeight = 1 + (index / messages.length)

      for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
        if (!scores[topic]) {
          scores[topic] = 0
        }

        for (const keyword of keywords) {
          if (content.includes(keyword.toLowerCase())) {
            scores[topic] += recencyWeight
          }
        }
      }
    })

    // Find the topic with the highest score
    let bestTopic: string | null = null
    let bestScore = 0

    for (const [topic, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score
        bestTopic = topic
      }
    }

    if (!bestTopic || bestScore === 0) {
      return { topic: null, confidence: 0 }
    }

    // Normalize confidence (cap at 1.0)
    // Even a single keyword match should give reasonable confidence
    // Score of 1 = 0.6 confidence, score of 2 = 0.8, score of 3+ = 1.0
    const confidence = Math.min(1, 0.4 + (bestScore * 0.2))

    return { topic: bestTopic, confidence }
  }
}

// ============================================================================
// ROUTER FACTORY
// ============================================================================

/**
 * Creates a topic-based router from a SupportConfig
 *
 * @param config - Support configuration with default agent and topic mappings
 * @param options - Optional router configuration
 * @returns Router instance
 *
 * @example
 * ```typescript
 * const router = createRouter({
 *   default: sam,
 *   topics: {
 *     billing: finn,
 *     technical: ralph,
 *     sales: sally,
 *   },
 *   escalation: { sentiment: -0.5, loops: 3, explicit: true },
 * })
 *
 * const result = await router.route(conversation)
 * // result.agent is the agent to handle the conversation
 * ```
 */
export function createRouter(config: SupportConfig, options: RouterOptions = {}): Router {
  const detector = options.detector ?? createKeywordDetector()
  const confidenceThreshold = options.confidenceThreshold ?? 0.5

  return {
    async route(conversation: Conversation): Promise<RouterResult> {
      const detection = await detector(conversation)

      // No topic detected
      if (!detection.topic) {
        return {
          agent: config.default,
          topic: detection.topic,
          confidence: detection.confidence,
          reason: 'No topic detected, routing to default agent',
        }
      }

      // Check if topic has a mapped agent
      const topicAgent = config.topics[detection.topic]

      if (!topicAgent) {
        return {
          agent: config.default,
          topic: detection.topic,
          confidence: detection.confidence,
          reason: `Topic "${detection.topic}" has no assigned agent, routing to default`,
        }
      }

      // Check confidence threshold
      if (detection.confidence < confidenceThreshold) {
        return {
          agent: config.default,
          topic: detection.topic,
          confidence: detection.confidence,
          reason: `Confidence (${detection.confidence.toFixed(2)}) below threshold (${confidenceThreshold}), routing to default`,
          belowThreshold: true,
        }
      }

      return {
        agent: topicAgent,
        topic: detection.topic,
        confidence: detection.confidence,
        reason: `Routed to ${topicAgent.name} for topic "${detection.topic}" with confidence ${detection.confidence.toFixed(2)}`,
      }
    },
  }
}

// ============================================================================
// AI TOPIC DETECTOR FACTORY
// ============================================================================

/**
 * Default topics for AI classification
 */
const DEFAULT_TOPICS = ['billing', 'technical', 'sales', 'general']

/**
 * Creates an AI-powered topic detector using any AI provider
 *
 * @param ai - AI classifier instance (e.g., WorkersAI)
 * @param options - Optional configuration
 * @returns TopicDetector function
 *
 * @example
 * ```typescript
 * const ai = new WorkersAI(env)
 * const detector = createAITopicDetector(ai, {
 *   topics: ['billing', 'technical', 'sales'],
 * })
 *
 * const router = createRouter(config, { detector })
 * ```
 */
export function createAITopicDetector(
  ai: AIClassifier,
  options: AITopicDetectorOptions = {}
): TopicDetector {
  const topics = options.topics ?? DEFAULT_TOPICS

  const systemPrompt = options.systemPrompt ?? `You are a support message classifier. Classify the customer's message into one of these topics: ${topics.join(', ')}.

Respond ONLY with valid JSON in this exact format:
{"topic": "topic_name", "confidence": 0.0}

Where:
- topic: one of the allowed topics, or null if unclear
- confidence: a number from 0 to 1 indicating classification confidence

Do not include any other text, explanations, or markdown.`

  return async (conversation: Conversation): Promise<TopicDetectionResult> => {
    // Build the conversation context for classification
    const customerMessages = conversation.messages
      .filter((m) => m.role === 'customer')
      .map((m) => m.content)
      .join('\n')

    if (!customerMessages.trim()) {
      return { topic: null, confidence: 0 }
    }

    const prompt = `Classify this customer message:\n\n${customerMessages}`

    try {
      const response = await ai.generateText(prompt, { systemPrompt })

      // Parse the AI response
      const parsed = parseAIResponse(response.text)

      return {
        topic: parsed.topic,
        confidence: parsed.confidence,
      }
    } catch {
      // Return null topic on AI errors
      return { topic: null, confidence: 0 }
    }
  }
}

/**
 * Parse AI response JSON, handling various formats
 */
function parseAIResponse(text: string): { topic: string | null; confidence: number } {
  try {
    // Try to find JSON in the response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { topic: null, confidence: 0 }
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      topic?: string | null
      confidence?: number
    }

    return {
      topic: parsed.topic ?? null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    }
  } catch {
    return { topic: null, confidence: 0 }
  }
}
