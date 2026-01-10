/**
 * humans.do Package Entry Point
 *
 * Provides human-in-the-loop functionality for dotdo workflows:
 * - Role templates (ceo, legal, cfo, etc.) with template literal syntax
 * - Human proxy for $.human.* context API
 * - User proxy for $.user.* context API
 * - Channel adapters (Slack, Discord, Email, MDXUI Chat)
 *
 * @module humans.do
 */

// ============================================================================
// ROLE TEMPLATES
// ============================================================================

export {
  ceo,
  legal,
  cfo,
  cto,
  hr,
  support,
  manager,
  createHumanTemplate,
  HumanRequest,
  type HumanTemplate,
} from './templates'

// ============================================================================
// HUMAN PROXY ($.human.*)
// ============================================================================

export {
  createHumanProxy,
  type HumanProxyConfig,
  type HumanProxyContext,
  type ApprovalOptions,
  type AskOptions,
  type ReviewOptions,
  type ApprovalResult,
  type ReviewResult,
  type SLAConfig,
  type EscalationConfig,
  type NotificationChannel,
  HumanTimeoutError,
  HumanEscalationError,
  HumanNotificationError,
} from '../../workflows/context/human'

// Re-export HumanRequest type from human.ts for types that reference it
export type { HumanRequest as HumanRequestType } from '../../workflows/context/human'

// ============================================================================
// USER PROXY ($.user.*)
// ============================================================================

export {
  createUserProxy,
  type UserProxyConfig,
  type UserProxyContext,
  type ConfirmOptions,
  type PromptOptions,
  type SelectOptions,
  type ChatConversation,
} from '../../workflows/context/user'

// ============================================================================
// HUMANFUNCTION
// ============================================================================

/**
 * HumanFunction - Declarative human-in-the-loop configuration
 *
 * Used for complex approval workflows with triggers, routing, and SLAs:
 *
 * ```typescript
 * escalation = this.HumanFunction({
 *   trigger: 'refund > $10000',
 *   role: 'senior-accountant',
 *   sla: '4 hours',
 * })
 * ```
 */
export interface HumanFunctionConfig {
  /** Trigger condition expression */
  trigger?: string
  /** Role to route to */
  role: string
  /** SLA duration string */
  sla?: string
  /** Escalation path */
  escalate?: string
  /** Notification channels */
  notify?: string[]
}

export class HumanFunction {
  public config: HumanFunctionConfig

  constructor(config: HumanFunctionConfig) {
    this.config = config
  }

  /**
   * Evaluate whether the trigger condition matches
   */
  shouldTrigger(_context: Record<string, unknown>): boolean {
    // In real implementation, would evaluate the trigger expression
    return true
  }

  /**
   * Execute the human function
   */
  async execute(_context: Record<string, unknown>): Promise<boolean> {
    // In real implementation, would send to Human DO
    return true
  }
}

// ============================================================================
// CHANNEL ADAPTERS
// ============================================================================

// Slack BlockKit
export { SlackBlockKitChannel, buildApprovalBlocks, buildFormBlocks } from '../channels/slack-blockkit'

// Discord
export { DiscordChannel, buildEmbed, buildActionRow } from '../channels/discord'

// Email
export { EmailChannel, renderApprovalEmail, renderNotificationEmail } from '../channels/email'

// MDXUI Chat
export { MDXUIChatChannel, ChatConversation as ChatConversationClass } from '../channels/mdxui-chat'

// ============================================================================
// TYPE EXPORTS (as runtime values for compatibility)
// ============================================================================

/**
 * HumanResponse type marker
 * Used for type compatibility in tests
 */
export const HumanResponse = {} as {
  approved: boolean
  respondedBy?: string
  respondedAt?: string
}

/**
 * ChannelConfig type marker
 * Used for type compatibility in tests
 */
export const ChannelConfig = {} as {
  type: 'slack' | 'discord' | 'email' | 'mdxui'
  [key: string]: unknown
}
