# Slack BlockKit Channel

Send rich interactive messages to Slack with BlockKit formatting. This channel enables human-in-the-loop workflows by presenting approval requests, forms, and custom actions directly in Slack.

## Installation

```typescript
import {
  SlackBlockKitChannel,
  buildApprovalBlocks,
  buildFormBlocks
} from 'humans.do'
```

Or import directly from the channels module:

```typescript
import {
  SlackBlockKitChannel,
  buildApprovalBlocks,
  buildFormBlocks,
  type SlackBlockKitConfig,
  type ApprovalBlocksOptions,
  type FormBlocksOptions,
  type SlackBlock,
  type SlackFormField,
} from 'lib/channels'
```

## Configuration

### Using Webhook URL (Simple)

For simple notification-only use cases, configure with just a webhook URL:

```typescript
const channel = new SlackBlockKitChannel({
  webhookUrl: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX',
})
```

### Using Bot Token (Full API Access)

For full Slack API access including posting to specific channels and receiving message timestamps:

```typescript
const channel = new SlackBlockKitChannel({
  webhookUrl: 'https://hooks.slack.com/services/xxx', // Fallback
  botToken: 'xoxb-your-bot-token-here',
})
```

When `botToken` is provided, the channel uses the Slack Web API (`chat.postMessage`) instead of the incoming webhook, enabling:
- Posting to specific channels by ID
- Receiving the message timestamp (`ts`) for threading or updates
- Full Slack API response data

### Configuration Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `webhookUrl` | `string` | Yes | Slack incoming webhook URL |
| `botToken` | `string` | No | Slack Bot OAuth token (xoxb-xxx) for full API access |

## Building Blocks

The channel provides two helper functions for building common BlockKit layouts.

### Approval Blocks

Use `buildApprovalBlocks()` to create a standard approval request with Approve/Reject buttons:

```typescript
import { buildApprovalBlocks } from 'humans.do'

const blocks = buildApprovalBlocks({
  message: 'Please approve the deployment to production',
  requestId: 'deploy-req-123',
})
```

This generates a message section followed by action buttons:

```
+----------------------------------------+
| Please approve the deployment to       |
| production                             |
|                                        |
| [Approve] [Reject]                     |
+----------------------------------------+
```

#### Default Behavior

When no `actions` array is provided, the function creates default Approve and Reject buttons:

- **Approve**: Primary style (green), action_id: `approve_{requestId}`, value: `approve`
- **Reject**: Danger style (red), action_id: `reject_{requestId}`, value: `reject`

#### Custom Actions

Provide custom actions for more options:

```typescript
const blocks = buildApprovalBlocks({
  message: 'Review required for PR #456: Add new feature',
  requestId: 'pr-review-456',
  actions: [
    { label: 'Approve', value: 'approve', style: 'primary' },
    { label: 'Request Changes', value: 'changes', style: 'danger' },
    { label: 'Comment', value: 'comment' },
  ],
})
```

#### Action Options

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `label` | `string` | Yes | Button text displayed to user |
| `value` | `string` | Yes | Value sent when button is clicked |
| `style` | `'primary' \| 'danger'` | No | Button styling (green or red) |

### Form Blocks

Use `buildFormBlocks()` to create input forms:

```typescript
import { buildFormBlocks } from 'humans.do'

const blocks = buildFormBlocks({
  fields: [
    { name: 'reason', type: 'text', label: 'Reason for Request' },
    { name: 'priority', type: 'select', label: 'Priority', options: ['Low', 'Medium', 'High'] },
  ],
})
```

This generates input blocks for each field:

```
+----------------------------------------+
| Reason for Request                     |
| [________________________]             |
|                                        |
| Priority                               |
| [Select an option       v]             |
+----------------------------------------+
```

#### Field Types

**Text Fields**

```typescript
{
  name: 'feedback',      // Field identifier (used as action_id)
  type: 'text',
  label: 'Your Feedback'
}
```

**Select Fields**

```typescript
{
  name: 'department',
  type: 'select',
  label: 'Department',
  options: ['Engineering', 'Sales', 'Marketing', 'Support']
}
```

#### FormField Interface

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | `string` | Yes | Field identifier (becomes action_id) |
| `type` | `'text' \| 'select'` | Yes | Input type |
| `label` | `string` | Yes | Label displayed above the field |
| `options` | `string[]` | No | Options for select fields |

## Sending Messages

Use the `send()` method to post messages to Slack:

### Basic Message with Default Blocks

```typescript
const channel = new SlackBlockKitChannel({
  webhookUrl: 'https://hooks.slack.com/services/xxx',
})

const result = await channel.send({
  message: 'Deployment approval needed',
})

console.log(result.delivered) // true if successful
```

### Message with Custom Blocks

```typescript
const blocks = buildApprovalBlocks({
  message: '*Refund Request*\nAmount: $150\nCustomer: John Doe',
  requestId: 'refund-001',
  actions: [
    { label: 'Approve Refund', value: 'approve', style: 'primary' },
    { label: 'Deny', value: 'deny', style: 'danger' },
    { label: 'Request More Info', value: 'info' },
  ],
})

const result = await channel.send({
  message: 'Refund request for review',
  blocks,
})
```

### Posting to Specific Channel (Bot Token Required)

```typescript
const channel = new SlackBlockKitChannel({
  webhookUrl: 'https://hooks.slack.com/services/xxx',
  botToken: 'xoxb-your-bot-token',
})

const result = await channel.send({
  message: 'New approval request',
  channel: 'C0123456789', // Channel ID
  blocks: buildApprovalBlocks({
    message: 'Please review this request',
    requestId: 'req-789',
  }),
})

// When using botToken, you get the message timestamp
console.log(result.ts) // '1234567890.123456'
```

### Send Payload Options

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `message` | `string` | Yes | Fallback text (shown in notifications) |
| `channel` | `string` | No | Channel ID (requires botToken) |
| `blocks` | `SlackBlock[]` | No | BlockKit blocks (defaults to approval blocks) |

### Send Result

| Property | Type | Description |
|----------|------|-------------|
| `delivered` | `boolean` | Whether the message was successfully sent |
| `ts` | `string \| undefined` | Message timestamp (only with botToken) |

## Handling Interactions

When users click buttons in your Slack messages, Slack sends an interaction payload to your configured Request URL. Use `handleInteraction()` to parse these payloads:

```typescript
// In your interaction endpoint handler
app.post('/slack/interactions', async (c) => {
  const payload = JSON.parse(c.req.body.payload)

  const channel = new SlackBlockKitChannel({
    webhookUrl: 'https://hooks.slack.com/services/xxx',
  })

  const result = await channel.handleInteraction(payload)

  console.log(result.action)    // 'approve' or 'reject'
  console.log(result.userId)    // 'U0123456789'
  console.log(result.requestId) // 'deploy-req-123'

  // Handle the action
  if (result.action === 'approve') {
    await deployToProduction(result.requestId)
  }

  return c.json({ ok: true })
})
```

### Interaction Payload Structure

The method expects a Slack interaction payload with:

```typescript
{
  type: 'block_actions',
  user: {
    id: 'U0123456789',
    name: 'john.doe'
  },
  actions: [
    {
      action_id: 'approve_deploy-req-123',
      value: 'approve'
    }
  ]
}
```

### Interaction Result

| Property | Type | Description |
|----------|------|-------------|
| `action` | `string` | The action value (e.g., 'approve', 'reject') |
| `userId` | `string` | Slack user ID who clicked the button |
| `requestId` | `string \| undefined` | Request ID extracted from action_id |

### Action ID Format

Action IDs follow the format `{action}_{requestId}`:

- `approve_req-123` parses to `{ action: 'approve', requestId: 'req-123' }`
- `reject_deploy-456` parses to `{ action: 'reject', requestId: 'deploy-456' }`

## Complete Examples

### Simple Approval Request

```typescript
import { SlackBlockKitChannel, buildApprovalBlocks } from 'humans.do'

async function requestDeploymentApproval(deploymentId: string, environment: string) {
  const channel = new SlackBlockKitChannel({
    webhookUrl: process.env.SLACK_WEBHOOK_URL!,
  })

  const blocks = buildApprovalBlocks({
    message: `*Deployment Request*\n\nEnvironment: \`${environment}\`\nDeployment ID: \`${deploymentId}\`\n\nPlease review and approve to proceed.`,
    requestId: deploymentId,
  })

  const result = await channel.send({
    message: `Deployment approval needed for ${environment}`,
    blocks,
  })

  if (!result.delivered) {
    throw new Error('Failed to send Slack notification')
  }

  return { sent: true, deploymentId }
}
```

### Form with Multiple Fields

```typescript
import { SlackBlockKitChannel, buildFormBlocks, buildApprovalBlocks } from 'humans.do'

async function requestExpenseApproval(expense: {
  amount: number
  category: string
  submitter: string
}) {
  const channel = new SlackBlockKitChannel({
    webhookUrl: process.env.SLACK_WEBHOOK_URL!,
  })

  // Combine approval message with form fields
  const approvalBlocks = buildApprovalBlocks({
    message: `*Expense Report Submitted*\n\nSubmitter: ${expense.submitter}\nAmount: $${expense.amount}\nCategory: ${expense.category}`,
    requestId: `exp-${Date.now()}`,
    actions: [
      { label: 'Approve', value: 'approve', style: 'primary' },
      { label: 'Reject', value: 'reject', style: 'danger' },
      { label: 'Need More Info', value: 'more-info' },
    ],
  })

  await channel.send({
    message: `Expense report from ${expense.submitter}`,
    blocks: approvalBlocks,
  })
}
```

### Custom Actions with Multiple Options

```typescript
import { SlackBlockKitChannel, buildApprovalBlocks } from 'humans.do'

async function requestPRReview(pr: {
  number: number
  title: string
  author: string
  url: string
}) {
  const channel = new SlackBlockKitChannel({
    webhookUrl: process.env.SLACK_WEBHOOK_URL!,
    botToken: process.env.SLACK_BOT_TOKEN,
  })

  const blocks = buildApprovalBlocks({
    message: `*Pull Request Review Requested*\n\n<${pr.url}|#${pr.number}: ${pr.title}>\nAuthor: ${pr.author}`,
    requestId: `pr-${pr.number}`,
    actions: [
      { label: 'Approve', value: 'approve', style: 'primary' },
      { label: 'Request Changes', value: 'request-changes', style: 'danger' },
      { label: 'Add Comment', value: 'comment' },
      { label: 'View PR', value: 'view' },
    ],
  })

  const result = await channel.send({
    message: `PR review needed: ${pr.title}`,
    channel: 'C0123456789', // #code-reviews channel
    blocks,
  })

  return { messageTs: result.ts }
}
```

### Complete Interaction Handler

```typescript
import { Hono } from 'hono'
import { SlackBlockKitChannel } from 'humans.do'

const app = new Hono()

app.post('/slack/interactions', async (c) => {
  // Slack sends interaction payloads as form-encoded with a 'payload' field
  const formData = await c.req.formData()
  const payloadString = formData.get('payload') as string
  const payload = JSON.parse(payloadString)

  const channel = new SlackBlockKitChannel({
    webhookUrl: process.env.SLACK_WEBHOOK_URL!,
  })

  try {
    const { action, userId, requestId } = await channel.handleInteraction(payload)

    // Route based on action
    switch (action) {
      case 'approve':
        await handleApproval(requestId!, userId)
        return c.json({
          response_type: 'in_channel',
          text: `Request ${requestId} approved by <@${userId}>`,
        })

      case 'reject':
        await handleRejection(requestId!, userId)
        return c.json({
          response_type: 'in_channel',
          text: `Request ${requestId} rejected by <@${userId}>`,
        })

      case 'more-info':
        await requestMoreInfo(requestId!, userId)
        return c.json({
          response_type: 'ephemeral',
          text: 'A request for more information has been sent.',
        })

      default:
        return c.json({
          response_type: 'ephemeral',
          text: `Unknown action: ${action}`,
        })
    }
  } catch (error) {
    console.error('Interaction handling failed:', error)
    return c.json({
      response_type: 'ephemeral',
      text: 'An error occurred processing your request.',
    })
  }
})

async function handleApproval(requestId: string, userId: string) {
  // Implement approval logic
}

async function handleRejection(requestId: string, userId: string) {
  // Implement rejection logic
}

async function requestMoreInfo(requestId: string, userId: string) {
  // Implement more info request logic
}
```

### Using with Channel Registry

```typescript
import { createChannel } from 'lib/channels'

// Create channel using the registry
const slack = createChannel('slack', {
  webhookUrl: process.env.SLACK_WEBHOOK_URL!,
  botToken: process.env.SLACK_BOT_TOKEN,
})

await slack.send({
  message: 'Hello from the channel registry!',
})
```

## API Reference

### SlackBlockKitChannel

Main class for sending BlockKit messages to Slack.

#### Constructor

```typescript
new SlackBlockKitChannel(config: SlackBlockKitConfig)
```

**SlackBlockKitConfig:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `webhookUrl` | `string` | Yes | Slack incoming webhook URL |
| `botToken` | `string` | No | Slack Bot OAuth token for Web API access |

#### Methods

**`send(payload)`**

Send a message to Slack.

```typescript
send(payload: {
  message: string
  channel?: string
  blocks?: SlackBlock[]
}): Promise<{ delivered: boolean; ts?: string }>
```

**`handleInteraction(payload)`**

Parse a Slack interaction payload.

```typescript
handleInteraction(payload: {
  type: string
  user: { id: string; name: string }
  actions: Array<{ action_id: string; value: string }>
}): Promise<{ action: string; userId: string; requestId?: string }>
```

---

### buildApprovalBlocks(options)

Build BlockKit blocks for an approval request.

```typescript
buildApprovalBlocks(options: ApprovalBlocksOptions): SlackBlock[]
```

**ApprovalBlocksOptions:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `message` | `string` | Yes | Message text (supports mrkdwn) |
| `requestId` | `string` | Yes | Unique request identifier |
| `actions` | `Array<{ label, value, style? }>` | No | Custom action buttons |

**Returns:** Array of SlackBlock objects (section + actions)

---

### buildFormBlocks(options)

Build BlockKit input blocks for forms.

```typescript
buildFormBlocks(options: FormBlocksOptions): SlackBlock[]
```

**FormBlocksOptions:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `fields` | `FormField[]` | Yes | Array of form field definitions |

**FormField:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | `string` | Yes | Field identifier |
| `type` | `'text' \| 'select'` | Yes | Input type |
| `label` | `string` | Yes | Field label |
| `options` | `string[]` | No | Options for select fields |

**Returns:** Array of SlackBlock input blocks

---

### SlackBlock

BlockKit block structure.

```typescript
interface SlackBlock {
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
```

## Error Handling

### Send Errors

The `send()` method catches fetch errors and returns `{ delivered: false }`:

```typescript
const result = await channel.send({ message: 'Test' })

if (!result.delivered) {
  // Handle delivery failure
  console.error('Failed to send Slack message')
}
```

### Interaction Errors

The `handleInteraction()` method throws when no actions are present:

```typescript
try {
  const result = await channel.handleInteraction(payload)
} catch (error) {
  if (error.message === 'No actions in payload') {
    // Handle missing actions
  }
}
```

### Form Field Errors

`buildFormBlocks()` throws for unknown field types:

```typescript
try {
  const blocks = buildFormBlocks({
    fields: [{ name: 'x', type: 'unknown' as any, label: 'X' }]
  })
} catch (error) {
  // Error: Unknown field type: unknown
}
```

## Best Practices

1. **Always include fallback text**: The `message` field is shown in notifications and accessibility tools.

2. **Use meaningful request IDs**: Include entity identifiers for easy correlation (e.g., `deploy-${deploymentId}`).

3. **Handle all actions**: Always implement handlers for every action you define.

4. **Use mrkdwn formatting**: Slack's mrkdwn supports `*bold*`, `_italic_`, `` `code` ``, and `<url|text>` links.

5. **Consider ephemeral responses**: Use `response_type: 'ephemeral'` for confirmations that only the clicking user should see.

6. **Store the message timestamp**: When using `botToken`, save `result.ts` for threading or message updates.

## See Also

- [Slack Block Kit Builder](https://app.slack.com/block-kit-builder)
- [Slack Incoming Webhooks](https://api.slack.com/messaging/webhooks)
- [Slack Interactive Messages](https://api.slack.com/messaging/interactivity)
- [Discord Channel](./discord.md) - Alternative for Discord-based workflows
- [Email Channel](./email.md) - For email-based approvals
