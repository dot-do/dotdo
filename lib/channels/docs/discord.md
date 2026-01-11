# Discord Channel

Send rich embeds and interactive messages via Discord webhooks. The Discord channel adapter enables human-in-the-loop workflows through Discord's interactive components, including buttons and emoji reactions.

## Installation

```typescript
import {
  DiscordChannel,
  buildEmbed,
  buildActionRow,
} from 'humans.do'

// Or import directly from the module
import {
  DiscordChannel,
  buildEmbed,
  buildActionRow,
} from '@dotdo/lib/channels'
```

## Configuration

Create a Discord channel instance with your webhook URL:

```typescript
const channel = new DiscordChannel({
  webhookUrl: 'https://discord.com/api/webhooks/xxx/yyy',
  botToken: 'Bot xxx', // Optional, required for reaction handling
})
```

### Configuration Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `webhookUrl` | `string` | Yes | Discord webhook URL for sending messages |
| `botToken` | `string` | No | Bot token for advanced features like reaction handling |

### Getting a Webhook URL

1. Open your Discord server settings
2. Navigate to **Integrations** > **Webhooks**
3. Click **New Webhook**
4. Select the target channel and copy the webhook URL

## Building Embeds

Discord embeds are rich message containers that support titles, descriptions, fields, colors, and timestamps.

### Basic Embed

```typescript
import { buildEmbed } from 'humans.do'

const embed = buildEmbed({
  title: 'Approval Required',
  description: 'Please review and approve this request.',
})
```

### Embed with Color

Colors are specified as hexadecimal integers. Discord's brand color (Blurple) is `0x5865F2`.

```typescript
const embed = buildEmbed({
  title: 'Approval Required',
  description: 'Please review and approve this request.',
  color: 0x5865F2, // Blurple
})
```

### Common Discord Colors

| Color | Hex Value | Description |
|-------|-----------|-------------|
| Blurple | `0x5865F2` | Discord brand color |
| Green | `0x57F287` | Success/approval |
| Yellow | `0xFEE75C` | Warning |
| Fuchsia | `0xEB459E` | Highlight |
| Red | `0xED4245` | Error/danger |
| White | `0xFFFFFF` | Neutral |
| Black | `0x23272A` | Dark theme |

### Embed with Fields

Fields display structured metadata in a grid layout. Use `inline: true` to display fields side-by-side.

```typescript
const embed = buildEmbed({
  title: 'Refund Request',
  description: 'A customer has requested a refund.',
  color: 0xFEE75C,
  fields: [
    { name: 'Requester', value: 'john@example.com.ai', inline: true },
    { name: 'Amount', value: '$10,000', inline: true },
    { name: 'Order ID', value: 'ORD-2024-12345', inline: true },
    { name: 'Reason', value: 'Product did not meet expectations.' },
  ],
})
```

### Embed with Timestamp

Add an automatic timestamp to the embed footer:

```typescript
const embed = buildEmbed({
  title: 'System Alert',
  description: 'Database backup completed successfully.',
  color: 0x57F287,
  timestamp: true, // Adds current timestamp
})
```

### Embed Options Reference

```typescript
interface EmbedOptions {
  title: string        // Embed title (max 256 characters)
  description: string  // Embed description (max 4096 characters)
  color?: number       // Embed color as hex integer
  fields?: EmbedField[] // Structured data fields (max 25)
  timestamp?: boolean  // Add current timestamp to footer
}

interface EmbedField {
  name: string    // Field name (max 256 characters)
  value: string   // Field value (max 1024 characters)
  inline?: boolean // Display side-by-side with other inline fields
}
```

### Discord Embed Limits

| Element | Limit |
|---------|-------|
| Title | 256 characters |
| Description | 4,096 characters |
| Fields | 25 per embed |
| Field Name | 256 characters |
| Field Value | 1,024 characters |
| Embeds per message | 10 |
| Total characters | 6,000 across all embeds |

## Building Action Rows

Action rows contain interactive components like buttons. Discord supports up to 5 action rows per message, with up to 5 buttons per row.

### Basic Button Row

```typescript
import { buildActionRow } from 'humans.do'

const row = buildActionRow({
  actions: [
    { label: 'Approve', value: 'approve', style: 'success' },
    { label: 'Reject', value: 'reject', style: 'danger' },
  ],
  requestId: 'req-123',
})
```

### Button Styles

Discord provides 5 button styles with distinct visual appearances:

| Style | Value | Color | Use Case |
|-------|-------|-------|----------|
| `primary` | 1 | Blurple | Primary actions |
| `secondary` | 2 | Grey | Secondary actions |
| `success` | 3 | Green | Confirmations, approvals |
| `danger` | 4 | Red | Destructive actions, rejections |
| `link` | 5 | Grey | External URLs (opens in browser) |

### Approval Workflow Buttons

```typescript
const approvalRow = buildActionRow({
  actions: [
    { label: 'Approve', value: 'approve', style: 'success' },
    { label: 'Request Changes', value: 'changes', style: 'secondary' },
    { label: 'Reject', value: 'reject', style: 'danger' },
  ],
  requestId: 'approval-456',
})
```

### Link Buttons

Link buttons navigate users to external URLs. They display a small external link icon.

```typescript
const linkRow = buildActionRow({
  actions: [
    { label: 'View Details', value: 'https://app.dotdo.dev/request/123', style: 'link' },
    { label: 'Documentation', value: 'https://docs.dotdo.dev', style: 'link' },
  ],
  requestId: 'info-789',
})
```

**Note:** Link buttons use `value` as the URL and do not generate a `custom_id`. They cannot be used to track user interactions server-side.

### Mixed Button Types

```typescript
const mixedRow = buildActionRow({
  actions: [
    { label: 'Approve', value: 'approve', style: 'success' },
    { label: 'Reject', value: 'reject', style: 'danger' },
    { label: 'View in Dashboard', value: 'https://app.dotdo.dev/review', style: 'link' },
  ],
  requestId: 'review-001',
})
```

### Action Row Reference

```typescript
interface ActionButton {
  label: string                                          // Button text (max 80 chars)
  value: string                                          // Action value or URL
  style: 'primary' | 'secondary' | 'success' | 'danger' | 'link'
}

interface ActionRowOptions {
  actions: ActionButton[]  // Buttons in this row (max 5)
  requestId: string        // Unique identifier for tracking responses
}
```

### Button Custom IDs

Non-link buttons automatically generate a `custom_id` in the format `{value}_{requestId}`:

```typescript
const row = buildActionRow({
  actions: [{ label: 'Approve', value: 'approve', style: 'success' }],
  requestId: 'req-123',
})

// Generated custom_id: "approve_req-123"
```

This format enables parsing the action and request ID when handling interactions:

```typescript
import { parseActionId } from 'humans.do'

const { action, requestId } = parseActionId('approve_req-123')
// action: 'approve', requestId: 'req-123'
```

## Sending Messages

The `send()` method delivers messages through the Discord webhook.

### Basic Message

```typescript
const channel = new DiscordChannel({
  webhookUrl: 'https://discord.com/api/webhooks/xxx/yyy',
})

const result = await channel.send({
  message: 'New deployment ready for review.',
})

console.log(result.messageId) // Discord message ID
```

### Message with Mentions

Mention users or roles to notify them:

```typescript
await channel.send({
  message: 'Approval needed for production deployment.',
  mentions: ['<@USER_ID>', '<@&ROLE_ID>'],
})
```

#### Mention Formats

| Type | Format | Example |
|------|--------|---------|
| User | `<@USER_ID>` | `<@123456789012345678>` |
| Role | `<@&ROLE_ID>` | `<@&987654321098765432>` |
| Everyone | `@everyone` | `@everyone` |
| Here | `@here` | `@here` (online members only) |

### Message with Embed

```typescript
const embed = buildEmbed({
  title: 'Deployment Request',
  description: 'A new version is ready for production.',
  color: 0x5865F2,
  fields: [
    { name: 'Version', value: 'v2.5.0', inline: true },
    { name: 'Environment', value: 'Production', inline: true },
    { name: 'Requester', value: 'alice@company.com' },
  ],
  timestamp: true,
})

await channel.send({
  message: '',
  embeds: [embed],
})
```

### Message with Buttons

```typescript
const embed = buildEmbed({
  title: 'Approval Required',
  description: 'Please approve or reject this deployment.',
  color: 0xFEE75C,
})

const buttons = buildActionRow({
  actions: [
    { label: 'Approve', value: 'approve', style: 'success' },
    { label: 'Reject', value: 'reject', style: 'danger' },
  ],
  requestId: 'deploy-v2.5.0',
})

await channel.send({
  message: '<@&APPROVERS_ROLE>',
  embeds: [embed],
  components: [buttons],
})
```

### Send Payload Reference

```typescript
interface SendPayload {
  message: string           // Text content (can be empty if embeds present)
  mentions?: string[]       // User/role mentions to prepend
  embeds?: DiscordEmbed[]   // Rich embed objects (max 10)
  components?: DiscordActionRow[]  // Interactive component rows (max 5)
}

interface SendResult {
  delivered: boolean  // Whether the message was sent successfully
  messageId: string   // Discord message snowflake ID
}
```

## Handling Reactions

The Discord channel supports emoji reactions as an alternative interaction method.

### Reaction Mapping

The adapter maps common emojis to semantic actions:

| Emoji | Action |
|-------|--------|
| :white_check_mark: | `approve` |
| :x: | `reject` |
| :thumbsup: | `approve` |
| :thumbsdown: | `reject` |

### Processing Reactions

```typescript
const channel = new DiscordChannel({
  webhookUrl: 'https://discord.com/api/webhooks/xxx/yyy',
  botToken: 'Bot xxx', // Required for reaction handling
})

// Handle incoming reaction from Discord webhook
const reaction = {
  emoji: { name: '\u2705' }, // Unicode checkmark
  user_id: '123456789',
  message_id: '987654321',
}

const response = await channel.handleReaction(reaction)
// { action: 'approve', userId: '123456789' }
```

### Reaction Reference

```typescript
interface DiscordReaction {
  emoji: { name: string }  // Emoji name or unicode character
  user_id: string          // Discord user snowflake ID
  message_id: string       // Original message snowflake ID
}

interface ReactionResponse {
  action: string   // Mapped action ('approve', 'reject', 'unknown')
  userId: string   // Discord user ID who reacted
}
```

## Complete Examples

### Human Approval Workflow

```typescript
import {
  DiscordChannel,
  buildEmbed,
  buildActionRow,
} from 'humans.do'

const discord = new DiscordChannel({
  webhookUrl: process.env.DISCORD_WEBHOOK_URL!,
})

async function requestApproval(request: {
  id: string
  title: string
  description: string
  requester: string
  amount: number
}) {
  const embed = buildEmbed({
    title: `Approval: ${request.title}`,
    description: request.description,
    color: 0xFEE75C,
    fields: [
      { name: 'Request ID', value: request.id, inline: true },
      { name: 'Requester', value: request.requester, inline: true },
      { name: 'Amount', value: `$${request.amount.toLocaleString()}`, inline: true },
    ],
    timestamp: true,
  })

  const buttons = buildActionRow({
    actions: [
      { label: 'Approve', value: 'approve', style: 'success' },
      { label: 'Request More Info', value: 'info', style: 'secondary' },
      { label: 'Reject', value: 'reject', style: 'danger' },
      { label: 'View Details', value: `https://app.dotdo.dev/requests/${request.id}`, style: 'link' },
    ],
    requestId: request.id,
  })

  const result = await discord.send({
    message: '<@&APPROVERS>',
    embeds: [embed],
    components: [buttons],
  })

  return result.messageId
}
```

### Deployment Notification

```typescript
import { DiscordChannel, buildEmbed, buildActionRow } from 'humans.do'

const discord = new DiscordChannel({
  webhookUrl: process.env.DISCORD_WEBHOOK_URL!,
})

async function notifyDeployment(deployment: {
  version: string
  environment: string
  services: string[]
  deployer: string
}) {
  const embed = buildEmbed({
    title: 'Deployment in Progress',
    description: `Deploying **${deployment.version}** to **${deployment.environment}**`,
    color: 0x5865F2,
    fields: [
      { name: 'Services', value: deployment.services.join(', ') },
      { name: 'Deployed By', value: deployment.deployer, inline: true },
      { name: 'Environment', value: deployment.environment, inline: true },
    ],
    timestamp: true,
  })

  const buttons = buildActionRow({
    actions: [
      { label: 'View Logs', value: 'https://logs.dotdo.dev/deployments', style: 'link' },
      { label: 'Rollback', value: 'rollback', style: 'danger' },
    ],
    requestId: `deploy-${deployment.version}`,
  })

  await discord.send({
    message: '<@&DEVOPS>',
    embeds: [embed],
    components: [buttons],
  })
}
```

### Alert System

```typescript
import { DiscordChannel, buildEmbed, buildActionRow } from 'humans.do'

const discord = new DiscordChannel({
  webhookUrl: process.env.DISCORD_ALERTS_WEBHOOK!,
})

async function sendAlert(alert: {
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string
  service: string
  incidentId: string
}) {
  const colors = {
    info: 0x5865F2,
    warning: 0xFEE75C,
    critical: 0xED4245,
  }

  const embed = buildEmbed({
    title: `[${alert.severity.toUpperCase()}] ${alert.title}`,
    description: alert.message,
    color: colors[alert.severity],
    fields: [
      { name: 'Service', value: alert.service, inline: true },
      { name: 'Incident ID', value: alert.incidentId, inline: true },
    ],
    timestamp: true,
  })

  const buttons = buildActionRow({
    actions: [
      { label: 'Acknowledge', value: 'ack', style: 'primary' },
      { label: 'Escalate', value: 'escalate', style: 'danger' },
      { label: 'View Dashboard', value: `https://status.dotdo.dev/incidents/${alert.incidentId}`, style: 'link' },
    ],
    requestId: alert.incidentId,
  })

  const mentions = alert.severity === 'critical' ? ['@here'] : []

  await discord.send({
    message: mentions.join(' '),
    embeds: [embed],
    components: [buttons],
  })
}
```

### Multi-Embed Message

```typescript
import { DiscordChannel, buildEmbed } from 'humans.do'

const discord = new DiscordChannel({
  webhookUrl: process.env.DISCORD_WEBHOOK_URL!,
})

async function sendDailyReport(report: {
  date: string
  metrics: { name: string; value: string }[]
  incidents: { title: string; status: string }[]
}) {
  const summaryEmbed = buildEmbed({
    title: `Daily Report - ${report.date}`,
    description: 'Overview of system health and key metrics.',
    color: 0x5865F2,
    timestamp: true,
  })

  const metricsEmbed = buildEmbed({
    title: 'Key Metrics',
    description: 'Performance metrics for the past 24 hours.',
    color: 0x57F287,
    fields: report.metrics.map(m => ({
      name: m.name,
      value: m.value,
      inline: true,
    })),
  })

  const incidentsEmbed = buildEmbed({
    title: 'Incidents',
    description: report.incidents.length === 0
      ? 'No incidents reported.'
      : 'The following incidents occurred:',
    color: report.incidents.length > 0 ? 0xFEE75C : 0x57F287,
    fields: report.incidents.map(i => ({
      name: i.title,
      value: `Status: ${i.status}`,
    })),
  })

  await discord.send({
    message: '',
    embeds: [summaryEmbed, metricsEmbed, incidentsEmbed],
  })
}
```

## API Reference

### DiscordChannel

```typescript
class DiscordChannel {
  constructor(config: DiscordChannelConfig)

  /**
   * Send a message through the Discord webhook
   */
  send(payload: SendPayload): Promise<SendResult>

  /**
   * Handle an incoming emoji reaction
   */
  handleReaction(reaction: DiscordReaction): Promise<ReactionResponse>
}
```

### buildEmbed

```typescript
function buildEmbed(options: EmbedOptions): DiscordEmbed
```

Creates a Discord embed object from the provided options.

### buildActionRow

```typescript
function buildActionRow(options: ActionRowOptions): DiscordActionRow
```

Creates an action row containing interactive buttons.

### parseActionId

```typescript
function parseActionId(actionId: string): { action: string; requestId?: string }
```

Parses a custom_id string into its action and requestId components.

### buildActionId

```typescript
function buildActionId(action: string, requestId: string): string
```

Combines an action and requestId into a custom_id string.

## Type Definitions

### DiscordChannelConfig

```typescript
interface DiscordChannelConfig {
  webhookUrl: string  // Discord webhook URL
  botToken?: string   // Optional bot token for advanced features
}
```

### EmbedOptions

```typescript
interface EmbedOptions {
  title: string
  description: string
  color?: number
  fields?: EmbedField[]
  timestamp?: boolean
}
```

### EmbedField

```typescript
interface EmbedField {
  name: string
  value: string
  inline?: boolean
}
```

### DiscordEmbed

```typescript
interface DiscordEmbed {
  title: string
  description: string
  color?: number
  fields?: EmbedField[]
  timestamp?: string
}
```

### ActionButton

```typescript
interface ActionButton {
  label: string
  value: string
  style: 'primary' | 'secondary' | 'success' | 'danger' | 'link'
}
```

### ActionRowOptions

```typescript
interface ActionRowOptions {
  actions: ActionButton[]
  requestId: string
}
```

### DiscordButton

```typescript
interface DiscordButton {
  type: 2              // Button component type
  label: string
  style: number        // 1-5 corresponding to style names
  custom_id?: string   // For non-link buttons
  url?: string         // For link buttons
}
```

### DiscordActionRow

```typescript
interface DiscordActionRow {
  type: 1                    // Action row component type
  components: DiscordButton[]
}
```

### SendPayload

```typescript
interface SendPayload {
  message: string
  mentions?: string[]
  embeds?: DiscordEmbed[]
  components?: DiscordActionRow[]
}
```

### SendResult

```typescript
interface SendResult {
  delivered: boolean
  messageId: string
}
```

### DiscordReaction

```typescript
interface DiscordReaction {
  emoji: { name: string }
  user_id: string
  message_id: string
}
```

### ReactionResponse

```typescript
interface ReactionResponse {
  action: string
  userId: string
}
```

## Best Practices

### Message Design

1. **Use embeds for structured content** - Embeds are more readable than plain text for complex information
2. **Limit inline fields** - Use 2-3 inline fields per row for optimal display
3. **Color-code by severity** - Use consistent colors (green for success, yellow for warning, red for danger)
4. **Include timestamps** - Helps users understand when events occurred

### Button Design

1. **Limit to 5 buttons per row** - Discord's maximum
2. **Order by importance** - Primary action first, destructive actions last
3. **Use appropriate styles** - Match button color to action intent
4. **Include escape hatches** - Provide "View Details" or "More Info" options

### Mentions

1. **Use role mentions for teams** - More maintainable than individual user mentions
2. **Use @here sparingly** - Only for time-sensitive alerts
3. **Avoid @everyone** - Reserve for critical announcements

### Error Handling

```typescript
try {
  const result = await channel.send(payload)
  if (!result.delivered) {
    console.error('Message delivery failed')
  }
} catch (error) {
  console.error('Discord webhook error:', error)
  // Implement retry logic or fallback channel
}
```

## Related

- [Slack Channel](./slack-blockkit.md) - Slack Block Kit integration
- [Email Channel](./email.md) - Email notification channel
- [MDXUI Chat](./mdxui-chat.md) - Real-time chat interface
- [Channel Types](./types.md) - Shared type definitions
