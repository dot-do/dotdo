/**
 * Slack BlockKit Channel Adapter
 */

import type { StyledAction, HumanResponse } from './types'
import { parseActionId } from './base'

export interface ApprovalBlocksOptions {
  message: string
  requestId: string
  actions?: Array<{ label: string; value: string; style?: 'primary' | 'danger' }>
}

export interface FormField {
  name: string
  type: 'text' | 'select'
  label: string
  options?: string[]
}

export interface FormBlocksOptions {
  fields: FormField[]
}

export interface SlackBlockKitConfig {
  webhookUrl: string
  botToken?: string
}

export interface SlackBlock {
  type: string
  text?: { type: string; text: string }
  elements?: Array<{
    type: string
    text?: { type: string; text: string }
    style?: string
    action_id?: string
    value?: string
  }>
  element?: {
    type: string
    action_id?: string
    options?: Array<{ text: { type: string; text: string }; value: string }>
  }
  label?: { type: string; text: string }
}

export function buildApprovalBlocks(options: ApprovalBlocksOptions): SlackBlock[] {
  const { message, requestId, actions } = options

  // Section block with message
  const sectionBlock: SlackBlock = {
    type: 'section',
    text: { type: 'mrkdwn', text: message },
  }

  // Build button elements
  const buttonElements = actions
    ? actions.map(action => ({
        type: 'button' as const,
        text: { type: 'plain_text', text: action.label },
        action_id: `${action.value}_${requestId}`,
        value: action.value,
        ...(action.style && { style: action.style }),
      }))
    : [
        {
          type: 'button' as const,
          text: { type: 'plain_text', text: 'Approve' },
          style: 'primary',
          action_id: `approve_${requestId}`,
          value: 'approve',
        },
        {
          type: 'button' as const,
          text: { type: 'plain_text', text: 'Reject' },
          style: 'danger',
          action_id: `reject_${requestId}`,
          value: 'reject',
        },
      ]

  // Actions block with buttons
  const actionsBlock: SlackBlock = {
    type: 'actions',
    elements: buttonElements,
  }

  return [sectionBlock, actionsBlock]
}

export function buildFormBlocks(options: FormBlocksOptions): SlackBlock[] {
  const { fields } = options

  return fields.map(field => {
    if (field.type === 'text') {
      return {
        type: 'input',
        element: {
          type: 'plain_text_input',
          action_id: field.name,
        },
        label: { type: 'plain_text', text: field.label },
      }
    } else if (field.type === 'select') {
      return {
        type: 'input',
        element: {
          type: 'static_select',
          action_id: field.name,
          options: (field.options || []).map(opt => ({
            text: { type: 'plain_text', text: opt },
            value: opt,
          })),
        },
        label: { type: 'plain_text', text: field.label },
      }
    }
    throw new Error(`Unknown field type: ${field.type}`)
  })
}

export class SlackBlockKitChannel {
  constructor(private config: SlackBlockKitConfig) {}

  async send(payload: { message: string; channel?: string; blocks?: SlackBlock[] }): Promise<{ delivered: boolean; ts?: string }> {
    const { message, channel, blocks } = payload

    const body = {
      text: message,
      channel,
      blocks: blocks || buildApprovalBlocks({ message, requestId: 'default' }),
    }

    const url = this.config.botToken
      ? 'https://slack.com/api/chat.postMessage'
      : this.config.webhookUrl

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.config.botToken) {
      headers['Authorization'] = `Bearer ${this.config.botToken}`
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    const data = await response.json() as { ok?: boolean; ts?: string }

    return {
      delivered: data.ok ?? true,
      ts: data.ts,
    }
  }

  async handleInteraction(payload: {
    type: string
    user: { id: string; name: string }
    actions: Array<{ action_id: string; value: string }>
  }): Promise<{ action: string; userId: string; requestId?: string }> {
    const { user, actions } = payload

    if (!actions || actions.length === 0) {
      throw new Error('No actions in payload')
    }

    const actionId = actions[0].action_id
    // Parse action_id format: "action_requestId" (e.g., "approve_req-123")
    const { action, requestId } = parseActionId(actionId)

    return {
      action,
      userId: user.id,
      requestId,
    }
  }
}
