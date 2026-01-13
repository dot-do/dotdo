# Channel Adapters

Multi-channel notification adapters for human escalation workflows.

## Overview

The channel system provides a unified interface for sending notifications and receiving responses across multiple platforms. Each channel supports the core send/receive pattern while offering platform-specific features like BlockKit blocks (Slack), embeds (Discord), HTML templates (Email), and real-time MDX content (MDXUI Chat).

## Quick Start

```typescript
import {
  SlackBlockKitChannel,
  DiscordChannel,
  EmailChannel,
  MDXUIChatChannel,
  channelRegistry,
  createChannel
} from '../lib/channels'

// Create channels directly
const slack = new SlackBlockKitChannel({
  webhookUrl: 'https://hooks.slack.com/services/...',
  botToken: 'xoxb-...' // optional, for API calls
})

const discord = new DiscordChannel({
  webhookUrl: 'https://discord.com/api/webhooks/...'
})

const email = new EmailChannel({
  provider: 'sendgrid', // or 'resend'
  apiKey: 'SG.xxx',
  from: 'notifications@yourapp.com'
})

// Or use the factory
const channel = createChannel('slack', { webhookUrl: '...' })
```

## Available Channels

| Channel | Class | Features |
|---------|-------|----------|
| Slack | `SlackBlockKitChannel` | BlockKit blocks, interactive buttons, forms |
| Discord | `DiscordChannel` | Embeds, action buttons, reaction responses |
| Email | `EmailChannel` | HTML templates, SendGrid/Resend providers |
| MDXUI Chat | `MDXUIChatChannel` | Real-time, forms, MDX content, typing indicators |

## Shared Types

All channels use common types from `types.ts`:

```typescript
// Base action for interactive elements
interface Action {
  label: string
  value: string
}

// Extended action with style support
interface StyledAction extends Action {
  style?: 'primary' | 'secondary' | 'success' | 'danger' | 'link'
}

// Response from human interaction
interface HumanResponse {
  action: string
  userId: string
  requestId?: string
  data?: Record<string, unknown>
}

// Channel type identifiers
type ChannelType = 'slack' | 'discord' | 'email' | 'mdxui'
```

## Base Classes

### BaseChannel

Abstract base class providing common functionality:

```typescript
abstract class BaseChannel<TConfig, TPayload, TResult> {
  name: string           // Channel display name
  type: ChannelType      // Channel type identifier

  abstract send(payload: TPayload): Promise<TResult>

  // Utility methods
  protected generateMessageId(): string
  protected withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T>
}
```

### InteractiveBaseChannel

Extended base class for channels supporting interactive responses:

```typescript
abstract class InteractiveBaseChannel<TConfig, TPayload, TResult, TResponse>
  extends BaseChannel<TConfig, TPayload, TResult> {

  abstract waitForResponse(params: { timeout: number }): Promise<TResponse>
}
```

### Utility Functions

Standalone functions for channels that don't extend the base class:

```typescript
import {
  generateMessageId,   // Generate unique msg_timestamp_random IDs
  withTimeout,         // Wrap promises with timeout
  parseActionId,       // Parse "action_requestId" format
  buildActionId        // Build "action_requestId" strings
} from '../lib/channels'

// Parse action IDs from Slack/Discord interactions
const { action, requestId } = parseActionId('approve_req-123')
// => { action: 'approve', requestId: 'req-123' }
```

---

## Slack BlockKit Channel

Full support for Slack's Block Kit, including approval workflows and form inputs.

### Configuration

```typescript
interface SlackBlockKitConfig {
  webhookUrl: string    // Incoming webhook URL
  botToken?: string     // Optional bot token for API calls
}
```

### Sending Messages

```typescript
const slack = new SlackBlockKitChannel({
  webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxx'
})

// Simple message
await slack.send({ message: 'Hello team!' })

// With channel targeting (requires botToken)
await slack.send({
  message: 'Deployment complete',
  channel: '#deployments'
})

// With custom blocks
await slack.send({
  message: 'Approval needed',
  blocks: buildApprovalBlocks({
    message: 'Deploy v2.0 to production?',
    requestId: 'deploy-123',
    actions: [
      { label: 'Approve', value: 'approve', style: 'primary' },
      { label: 'Reject', value: 'reject', style: 'danger' }
    ]
  })
})
```

### Building Blocks

#### Approval Blocks

```typescript
import { buildApprovalBlocks } from '../lib/channels'

const blocks = buildApprovalBlocks({
  message: 'Refund request for $500',
  requestId: 'refund-456',
  actions: [
    { label: 'Approve', value: 'approve', style: 'primary' },
    { label: 'Reject', value: 'reject', style: 'danger' },
    { label: 'Review', value: 'review' }
  ]
})

// Default actions (if not specified): Approve + Reject buttons
```

#### Form Blocks

```typescript
import { buildFormBlocks } from '../lib/channels'

const blocks = buildFormBlocks({
  fields: [
    { name: 'reason', type: 'text', label: 'Reason' },
    {
      name: 'priority',
      type: 'select',
      label: 'Priority',
      options: ['low', 'medium', 'high']
    }
  ]
})
```

### Handling Interactions

```typescript
// In your webhook handler
const response = await slack.handleInteraction({
  type: 'block_actions',
  user: { id: 'U123', name: 'alice' },
  actions: [{ action_id: 'approve_deploy-123', value: 'approve' }]
})

// => { action: 'approve', userId: 'U123', requestId: 'deploy-123' }
```

---

## Discord Channel

Support for Discord webhooks with embeds and interactive buttons.

### Configuration

```typescript
interface DiscordChannelConfig {
  webhookUrl: string    // Discord webhook URL
  botToken?: string     // Optional for extended features
}
```

### Sending Messages

```typescript
const discord = new DiscordChannel({
  webhookUrl: 'https://discord.com/api/webhooks/xxx/yyy'
})

// Simple message
await discord.send({ message: 'Hello!' })

// With mentions
await discord.send({
  message: 'Deployment complete',
  mentions: ['<@123456789>', '<@role:987654321>']
})

// With embeds and buttons
await discord.send({
  message: 'Approval Required',
  embeds: [buildEmbed({
    title: 'Refund Request',
    description: 'Customer requests $500 refund',
    color: 0x5865F2, // Discord blurple
    fields: [
      { name: 'Customer', value: 'Alice', inline: true },
      { name: 'Amount', value: '$500', inline: true }
    ],
    timestamp: true
  })],
  components: [buildActionRow({
    requestId: 'refund-789',
    actions: [
      { label: 'Approve', value: 'approve', style: 'success' },
      { label: 'Reject', value: 'reject', style: 'danger' },
      { label: 'View Details', value: 'https://app.example.com.ai/refund/789', style: 'link' }
    ]
  })]
})
```

### Building Components

#### Embeds

```typescript
import { buildEmbed } from '../lib/channels'

const embed = buildEmbed({
  title: 'Deploy to Production',
  description: 'Version 2.0.0 is ready',
  color: 0x00FF00,      // Green
  fields: [
    { name: 'Branch', value: 'main', inline: true },
    { name: 'Commits', value: '15', inline: true }
  ],
  timestamp: true       // Adds current ISO timestamp
})
```

#### Action Rows

```typescript
import { buildActionRow } from '../lib/channels'

const actionRow = buildActionRow({
  requestId: 'deploy-001',
  actions: [
    { label: 'Approve', value: 'approve', style: 'primary' },
    { label: 'Reject', value: 'reject', style: 'secondary' },
    { label: 'More Info', value: 'https://example.com.ai', style: 'link' }
  ]
})
```

Button styles map to Discord's numeric values:
- `primary` (1) - Blurple
- `secondary` (2) - Grey
- `success` (3) - Green
- `danger` (4) - Red
- `link` (5) - Grey with link icon

### Handling Reactions

```typescript
const response = await discord.handleReaction({
  emoji: { name: '\u2705' }, // checkmark
  user_id: '123456789',
  message_id: '987654321'
})

// => { action: 'approve', userId: '123456789' }
```

Supported emoji mappings:
- `\u2705` (checkmark) / `\uD83D\uDC4D` (thumbs up) -> `approve`
- `\u274C` (cross) / `\uD83D\uDC4E` (thumbs down) -> `reject`

---

## Email Channel

HTML email templates with SendGrid and Resend provider support.

### Configuration

```typescript
interface EmailChannelConfig {
  provider: 'sendgrid' | 'resend'
  apiKey: string
  from: string
  tracking?: { opens?: boolean }  // SendGrid only
}
```

### Sending Emails

```typescript
const email = new EmailChannel({
  provider: 'sendgrid',
  apiKey: 'SG.xxx',
  from: 'notifications@yourapp.com',
  tracking: { opens: true }
})

// Notification email
await email.send({
  to: 'alice@example.com.ai',
  subject: 'Deployment Complete',
  message: 'Version 2.0 deployed successfully'
})

// With custom HTML
await email.send({
  to: 'bob@example.com.ai',
  subject: 'Weekly Report',
  message: 'See attached',
  html: '<h1>Custom HTML</h1>'
})
```

### Email Templates

#### Approval Email

```typescript
import { renderApprovalEmail } from '../lib/channels'

// Returns HTML string
const html = renderApprovalEmail({
  message: 'Customer requests refund of $500',
  requestId: 'refund-123',
  baseUrl: 'https://app.yourapp.com', // default: https://app.dotdo.dev
  metadata: {
    customer: 'Alice',
    amount: '$500',
    reason: 'Product defect'
  }
})

// Or get both HTML and plain text
const { html, text } = renderApprovalEmail({
  message: 'Approval needed',
  requestId: 'req-456',
  returnBoth: true
}) as { html: string; text: string }
```

The approval email includes styled Approve/Reject buttons that link to:
- `{baseUrl}/approve/{requestId}?action=approve`
- `{baseUrl}/approve/{requestId}?action=reject`

#### Notification Email

```typescript
import { renderNotificationEmail } from '../lib/channels'

const html = renderNotificationEmail({
  subject: 'Task Completed',
  message: 'Your export is ready for download'
})
```

### Handling Webhooks

```typescript
// When user clicks email link, handle the webhook
const response = await email.handleWebhook({
  event: 'click',
  url: 'https://app.yourapp.com/approve/req-123?action=approve',
  email: 'alice@example.com.ai'
})

// => { action: 'approve', requestId: 'req-123', userId: 'alice@example.com.ai' }
```

---

## MDXUI Chat Channel

Real-time chat interactions through Durable Objects, supporting MDX content and forms.

### Configuration

```typescript
interface MDXUIChatConfig {
  env: {
    USER_DO: UserDOBinding  // Durable Object namespace binding
  }
  realtime?: boolean        // Enable real-time features
}

interface UserDOBinding {
  idFromName(name: string): { toString(): string }
  get(id: { toString(): string }): {
    fetch(request: Request): Promise<Response>
  }
}
```

### Basic Usage

```typescript
const chat = new MDXUIChatChannel({
  env: { USER_DO: env.USER_DO },
  realtime: true
})

// Check realtime support
console.log(chat.supportsRealtime) // true

// Send a message
await chat.send({
  userId: 'user-123',
  message: 'Your order has shipped!'
})

// Send with MDX content
await chat.send({
  userId: 'user-123',
  message: 'Review the changes',
  mdxContent: `
    ## Code Review

    <CodeBlock language="typescript">
    const x = 1
    </CodeBlock>

    <Button onClick={() => approve()}>Approve</Button>
  `
})
```

### Waiting for Responses

```typescript
// Send and wait for user response
await chat.send({
  userId: 'user-123',
  message: 'Approve this deployment?'
})

const response = await chat.waitForResponse({ timeout: 60000 })
// => { action: 'approve', data: {} }
```

### Typing Indicators

```typescript
// Fire-and-forget typing indicator
await chat.sendTypingIndicator('user-123')
```

### Chat Conversations

For managing multi-turn conversations with actions and forms:

```typescript
import { ChatConversation } from '../lib/channels'

const conversation = new ChatConversation({
  userId: 'user-123',
  initialMessage: 'How can I help you today?',
  actions: [
    { label: 'Check Status', value: 'status' },
    { label: 'Get Help', value: 'help' }
  ],
  form: {
    fields: [
      { name: 'query', type: 'text', label: 'Search' },
      { name: 'urgent', type: 'boolean', label: 'Urgent?' }
    ]
  }
})

// Access messages
console.log(conversation.messages)
// => [{ role: 'assistant', content: '...', actions: [...], form: {...} }]

// Add user response
conversation.addMessage({ role: 'user', content: 'Check my order' })
```

---

## Channel Registry

The global registry provides factory methods for creating channels by type.

### Using the Registry

```typescript
import { channelRegistry, createChannel } from '../lib/channels'

// Check available types
channelRegistry.types() // => ['slack', 'discord', 'email', 'mdxui']

// Check if type is registered
channelRegistry.has('slack') // => true

// Get constructor
const SlackConstructor = channelRegistry.get('slack')

// Create instance (type-safe overloads)
const slack = channelRegistry.create('slack', { webhookUrl: '...' })
const discord = channelRegistry.create('discord', { webhookUrl: '...' })
const email = channelRegistry.create('email', { provider: 'sendgrid', apiKey: '...', from: '...' })

// Or use the convenience function
const channel = createChannel('slack', { webhookUrl: '...' })
```

### Registering Custom Channels

```typescript
import { channelRegistry, type ChannelType } from '../lib/channels'

class CustomChannel {
  constructor(config: { endpoint: string }) {}
  async send(payload: { message: string }) {
    return { delivered: true }
  }
}

// Register (note: type assertion needed for custom types)
channelRegistry.register('custom' as ChannelType, CustomChannel as any)
```

---

## Integration with Human Escalation

Channels integrate with dotdo's human escalation system:

```typescript
import { ceo } from 'humans.do'
import { SlackBlockKitChannel, EmailChannel } from '../lib/channels'

// Configure escalation channels
const escalation = this.HumanFunction({
  trigger: 'refund > $10000',
  role: 'senior-accountant',
  sla: '4 hours',
  channels: [
    new SlackBlockKitChannel({ webhookUrl: '...' }),
    new EmailChannel({ provider: 'sendgrid', apiKey: '...', from: '...' })
  ]
})

// Or use with tagged template literals
const approved = await ceo`approve the partnership deal worth $${amount}`
```

---

## Type Exports

All types are exported from the main index:

```typescript
import type {
  // Shared types
  Action,
  StyledAction,
  NotificationPayload,
  NotificationResult,
  HumanResponse,
  ChannelType,

  // Slack types
  SlackBlockKitConfig,
  SlackBlock,
  SlackFormField,
  ApprovalBlocksOptions,
  FormBlocksOptions,

  // Discord types
  DiscordChannelConfig,
  DiscordEmbed,
  DiscordButton,
  DiscordActionRow,
  EmbedOptions,
  ActionRowOptions,
  DiscordSendPayload,
  DiscordSendResult,
  DiscordReaction,
  ReactionResponse,

  // Email types
  EmailChannelConfig,
  EmailPayload,
  EmailSendResult,
  EmailWebhook,
  WebhookResponse,
  ApprovalEmailOptions,
  NotificationEmailOptions,

  // MDXUI types
  MDXUIChatConfig,
  MDXUISendPayload,
  UserDOBinding,
  ChatAction,
  ChatFormField,
  ChatMessage,
  ChatConversationOptions,
  WaitForResponseParams,
  UserResponse,

  // Registry types
  ChannelConstructor,
  ChannelInstance,
  ChannelConfigFor,
} from '../lib/channels'
```

## Related Documentation

- [Human Escalation](/docs/humans/escalation) - User-facing documentation for triggers, roles, SLAs, and channel configuration
- [Approval Workflows](/docs/humans/approval-workflows) - Human-in-the-loop approval patterns
- [Agent System](/docs/agents/) - AI agents and human escalation integration
