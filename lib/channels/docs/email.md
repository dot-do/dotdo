# Email Channel

Send HTML emails with action buttons via SendGrid or Resend. The Email Channel provides mobile-responsive templates for approval workflows and notifications, with built-in webhook handling for tracking user actions.

## Installation

```typescript
import {
  EmailChannel,
  renderApprovalEmail,
  renderNotificationEmail
} from 'humans.do'

// Or import from the channels module directly
import {
  EmailChannel,
  renderApprovalEmail,
  renderNotificationEmail,
  type EmailChannelConfig,
  type EmailPayload,
  type EmailSendResult,
  type EmailWebhook,
  type WebhookResponse,
  type ApprovalEmailOptions,
  type ApprovalEmailResult,
  type NotificationEmailOptions,
} from 'lib/channels'
```

## Configuration

The `EmailChannel` class supports two email providers: **SendGrid** and **Resend**. Both providers use a similar configuration interface.

### SendGrid

```typescript
const channel = new EmailChannel({
  provider: 'sendgrid',
  apiKey: 'SG.xxx',
  from: 'noreply@example.com',
  tracking: { opens: true },
})
```

### Resend

```typescript
const channel = new EmailChannel({
  provider: 'resend',
  apiKey: 're_xxx',
  from: 'noreply@example.com',
})
```

### Configuration Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `provider` | `'sendgrid' \| 'resend'` | Yes | Email service provider |
| `apiKey` | `string` | Yes | API key for the provider |
| `from` | `string` | Yes | Sender email address |
| `tracking` | `{ opens?: boolean }` | No | Tracking settings (SendGrid only) |

## Sending Emails

### Basic Usage

```typescript
const channel = new EmailChannel({
  provider: 'sendgrid',
  apiKey: process.env.SENDGRID_API_KEY,
  from: 'noreply@myapp.com',
})

const result = await channel.send({
  to: 'user@example.com',
  subject: 'Your request was approved',
  message: 'Great news! Your expense report has been approved.',
})

if (result.delivered) {
  console.log('Email sent successfully')
  console.log('Message ID:', result.messageId)
}
```

### Email Payload

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | Yes | Recipient email address |
| `subject` | `string` | Yes | Email subject line |
| `message` | `string` | Yes | Plain text message (used if no HTML provided) |
| `html` | `string` | No | Custom HTML content (overrides auto-generated template) |

### Send Result

| Field | Type | Description |
|-------|------|-------------|
| `delivered` | `boolean` | Whether the email was accepted for delivery |
| `messageId` | `string \| undefined` | Provider-specific message identifier |

## Rendering Emails

The channel provides two built-in template functions for common use cases.

### Approval Emails

Generate emails with Approve/Reject action buttons for human-in-the-loop workflows.

```typescript
import { renderApprovalEmail } from 'humans.do'

// Basic approval email
const html = renderApprovalEmail({
  message: 'Please approve this expense report for $5,000',
  requestId: 'req-abc123',
})

// With metadata table
const html = renderApprovalEmail({
  message: 'Please review and approve this request',
  requestId: 'req-abc123',
  baseUrl: 'https://myapp.com',
  metadata: {
    requester: 'john@example.com',
    amount: '$5,000',
    category: 'Travel',
    date: '2024-01-15',
  },
})

// Get both HTML and plain text versions
const { html, text } = renderApprovalEmail({
  message: 'Approve this purchase order?',
  requestId: 'req-xyz789',
  returnBoth: true,
})
```

#### Approval Email Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `message` | `string` | Yes | Main message content |
| `requestId` | `string` | Yes | Unique identifier for tracking responses |
| `baseUrl` | `string` | No | Base URL for action links (default: `https://app.dotdo.dev`) |
| `metadata` | `Record<string, string>` | No | Key-value pairs displayed in a table |
| `returnBoth` | `boolean` | No | Return both HTML and plain text versions |

#### Generated Action URLs

The approval email generates two action URLs:

- **Approve:** `{baseUrl}/approve/{requestId}?action=approve`
- **Reject:** `{baseUrl}/approve/{requestId}?action=reject`

### Notification Emails

Generate simple notification emails without action buttons.

```typescript
import { renderNotificationEmail } from 'humans.do'

const html = renderNotificationEmail({
  subject: 'Request Approved',
  message: 'Your expense report for $5,000 has been approved and will be processed within 3-5 business days.',
})
```

#### Notification Email Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `subject` | `string` | Yes | Email subject (also used as heading) |
| `message` | `string` | Yes | Message content |

## Mobile Responsiveness

All email templates are designed to be mobile-responsive:

- **Viewport meta tag** for proper scaling on mobile devices
- **Max-width container** (600px) that adapts to smaller screens
- **System font stack** for consistent rendering across platforms
- **Table-based layout** for maximum email client compatibility

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0">
```

The templates use inline styles for compatibility with email clients that strip `<style>` tags.

## HTML Template Structure

### Approval Email Template

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Approval Request</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 20px; font-size: 24px; color: #333;">Approval Request</h1>
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.5; color: #555;">{message}</p>

              <!-- Metadata table (if provided) -->
              <table style="margin: 20px 0; border-collapse: collapse; width: 100%;">
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #eee; color: #666; text-transform: capitalize;">{key}</td>
                  <td style="padding: 8px; border-bottom: 1px solid #eee;">{value}</td>
                </tr>
              </table>

              <!-- Action buttons -->
              <table cellpadding="0" cellspacing="0" style="margin-top: 30px;">
                <tr>
                  <td style="padding-right: 10px;">
                    <a href="{approveUrl}" style="display: inline-block; padding: 12px 24px; background-color: #22c55e; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">Approve</a>
                  </td>
                  <td>
                    <a href="{rejectUrl}" style="display: inline-block; padding: 12px 24px; background-color: #ef4444; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">Reject</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

### Button Styling

| Button | Background | Hex Code |
|--------|------------|----------|
| Approve | Green | `#22c55e` |
| Reject | Red | `#ef4444` |

## Webhook Handling

When users click action buttons in emails, the Email Channel can parse the webhook events to extract the response.

### Handling Click Events

```typescript
const channel = new EmailChannel({
  provider: 'sendgrid',
  apiKey: 'SG.xxx',
  from: 'noreply@example.com',
})

// Webhook payload from email provider
const webhook = {
  event: 'click',
  url: 'https://app.dotdo.dev/approve/req-123?action=approve',
  email: 'manager@example.com',
  timestamp: Date.now(),
}

const response = await channel.handleWebhook(webhook)

console.log(response)
// {
//   action: 'approve',
//   requestId: 'req-123',
//   userId: 'manager@example.com'
// }
```

### Webhook Payload

| Field | Type | Description |
|-------|------|-------------|
| `event` | `string` | Event type (e.g., `'click'`) |
| `url` | `string` | The URL that was clicked |
| `email` | `string` | Recipient's email address |
| `timestamp` | `number` | Optional timestamp of the event |

### Webhook Response

| Field | Type | Description |
|-------|------|-------------|
| `action` | `string` | The action from the URL (`'approve'` or `'reject'`) |
| `requestId` | `string` | The request ID extracted from the URL path |
| `userId` | `string` | The user's email address |

## Provider-Specific Features

### SendGrid

- **Open tracking:** Enable with `tracking: { opens: true }`
- **Message ID:** Available via `x-message-id` response header
- **API Endpoint:** `https://api.sendgrid.com/v3/mail/send`

```typescript
const channel = new EmailChannel({
  provider: 'sendgrid',
  apiKey: process.env.SENDGRID_API_KEY,
  from: 'noreply@example.com',
  tracking: { opens: true },
})
```

### Resend

- **Message ID:** Available in the response body as `id`
- **API Endpoint:** `https://api.resend.com/emails`

```typescript
const channel = new EmailChannel({
  provider: 'resend',
  apiKey: process.env.RESEND_API_KEY,
  from: 'noreply@example.com',
})
```

## Complete Examples

### Expense Approval Workflow

```typescript
import { EmailChannel, renderApprovalEmail } from 'humans.do'

// Configure the channel
const email = new EmailChannel({
  provider: 'sendgrid',
  apiKey: process.env.SENDGRID_API_KEY,
  from: 'workflow@company.com',
  tracking: { opens: true },
})

// Create an approval request
async function requestExpenseApproval(expense: {
  id: string
  submitter: string
  amount: number
  category: string
  manager: string
}) {
  const requestId = `expense-${expense.id}`

  const { html, text } = renderApprovalEmail({
    message: `${expense.submitter} has submitted an expense report that requires your approval.`,
    requestId,
    baseUrl: 'https://expenses.company.com',
    metadata: {
      submitter: expense.submitter,
      amount: `$${expense.amount.toLocaleString()}`,
      category: expense.category,
      'submitted on': new Date().toLocaleDateString(),
    },
    returnBoth: true,
  })

  const result = await email.send({
    to: expense.manager,
    subject: `Expense Approval Required: $${expense.amount}`,
    message: text,
    html,
  })

  return { requestId, delivered: result.delivered }
}

// Handle the response
async function handleApprovalResponse(webhook: EmailWebhook) {
  const response = await email.handleWebhook(webhook)

  if (response.action === 'approve') {
    await processApproval(response.requestId)
    await sendNotification(response.userId, 'Expense approved successfully')
  } else if (response.action === 'reject') {
    await processRejection(response.requestId)
    await sendNotification(response.userId, 'Expense rejected')
  }
}
```

### Multi-Provider Setup

```typescript
import { EmailChannel, createChannel } from 'humans.do'

// Create channels for different purposes
const transactional = new EmailChannel({
  provider: 'sendgrid',
  apiKey: process.env.SENDGRID_API_KEY,
  from: 'noreply@company.com',
})

const marketing = new EmailChannel({
  provider: 'resend',
  apiKey: process.env.RESEND_API_KEY,
  from: 'hello@company.com',
})

// Or use the channel registry
const emailChannel = createChannel('email', {
  provider: 'sendgrid',
  apiKey: process.env.SENDGRID_API_KEY,
  from: 'noreply@company.com',
})
```

### Integration with Human-in-the-Loop

```typescript
import { EmailChannel } from 'humans.do'
import { legal, ceo } from 'humans.do'

const email = new EmailChannel({
  provider: 'sendgrid',
  apiKey: process.env.SENDGRID_API_KEY,
  from: 'workflow@company.com',
})

// Define an escalation that uses email
const contractEscalation = this.HumanFunction({
  trigger: 'contract > $100000',
  role: 'legal-counsel',
  channel: email,
  sla: '24 hours',
})

// Request CEO approval via email
const approved = await ceo`approve the $1M partnership deal`
```

## API Reference

### EmailChannel

```typescript
class EmailChannel {
  constructor(config: EmailChannelConfig)
  send(payload: EmailPayload): Promise<EmailSendResult>
  handleWebhook(webhook: EmailWebhook): Promise<WebhookResponse>
}
```

### EmailChannelConfig

```typescript
interface EmailChannelConfig {
  provider: 'sendgrid' | 'resend'
  apiKey: string
  from: string
  tracking?: { opens?: boolean }
}
```

### EmailPayload

```typescript
interface EmailPayload {
  message: string
  to: string
  subject: string
  html?: string
}
```

### EmailSendResult

```typescript
interface EmailSendResult {
  delivered: boolean
  messageId?: string
}
```

### EmailWebhook

```typescript
interface EmailWebhook {
  event: string
  url: string
  email: string
  timestamp?: number
}
```

### WebhookResponse

```typescript
interface WebhookResponse {
  action: string
  requestId: string
  userId: string
}
```

### ApprovalEmailOptions

```typescript
interface ApprovalEmailOptions {
  message: string
  requestId: string
  baseUrl?: string
  metadata?: Record<string, string>
  returnBoth?: boolean
}
```

### ApprovalEmailResult

```typescript
interface ApprovalEmailResult {
  html: string
  text: string
}
```

### NotificationEmailOptions

```typescript
interface NotificationEmailOptions {
  subject: string
  message: string
}
```

### Standalone Functions

```typescript
function renderApprovalEmail(options: ApprovalEmailOptions): string | ApprovalEmailResult
function renderNotificationEmail(options: NotificationEmailOptions): string
```

## Error Handling

The `send()` method handles errors gracefully:

- Returns `{ delivered: true }` for test API keys (`SG.xxx`, `re_xxx`)
- Returns `{ delivered: true }` if network requests fail (for test environments)
- Throws an error for unsupported providers

```typescript
try {
  const result = await channel.send({
    to: 'user@example.com',
    subject: 'Test',
    message: 'Hello',
  })

  if (!result.delivered) {
    console.error('Email was not delivered')
  }
} catch (error) {
  if (error.message.includes('Unsupported email provider')) {
    console.error('Invalid provider configuration')
  }
}
```

## Best Practices

1. **Use environment variables** for API keys, never hardcode them
2. **Generate unique request IDs** for each approval request to enable tracking
3. **Set appropriate base URLs** for production vs development environments
4. **Include relevant metadata** to give approvers context without leaving the email
5. **Implement webhook endpoints** to handle user responses in real-time
6. **Use the `returnBoth` option** to provide plain text fallbacks for accessibility
7. **Test with placeholder keys** (`SG.xxx`, `re_xxx`) during development

## See Also

- [Slack BlockKit Channel](./slack-blockkit.md) - Interactive messages with Block Kit
- [Discord Channel](./discord.md) - Embeds and buttons for Discord
- [MDXUI Chat Channel](./mdxui-chat.md) - Real-time chat interface
- [Channel Types Reference](./types.md) - Shared type definitions
