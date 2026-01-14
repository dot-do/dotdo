import { DOBase } from '../DOBase'
import type { Agent } from '@dotdo/digital-workers'

/**
 * AgentDO - Durable Object for AI Agent entities
 * @see https://schema.org.ai/Agent
 */
export class AgentDO extends DOBase {
  static $type = 'https://schema.org.ai/Agent' as const

  // Agent-specific properties
  model?: string
  tools?: string[]
  autonomous?: boolean
}
