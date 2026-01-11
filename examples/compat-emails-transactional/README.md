# Transactional Email

**SendGrid API. Your infrastructure. Your deliverability.**

```typescript
import { MailService } from '@dotdo/emails'

export class EmailDO extends DO {
  private mail = new MailService(this.ctx)

  async sendWelcome(user: User) {
    return this.mail.send({
      to: user.email,
      from: 'hello@example.com',
      templateId: 'welcome',
      dynamicTemplateData: { name: user.name }
    })
  }

  $.on.Email.bounced(async (event) => {
    await this.handleBounce(event.data.email)
  })
}
```

**Templates. Tracking. Zero per-email costs.**

---

## Features

- SendGrid-compatible `/v3/mail/send` endpoint
- Template rendering with Handlebars-style variables
- Batch campaigns with recipient management
- Real-time webhook processing (delivered, bounced, opened, clicked)
- Automatic bounce/complaint suppression
- One-click unsubscribe (RFC 8058 compliant)
- Multi-provider failover (MailChannels, Resend, SendGrid)

## Quick Start

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Deploy
npm run deploy
```

## API Reference

### Transactional Emails

```bash
# Send welcome email
curl -X POST http://localhost:8787/emails/welcome \
  -H "Content-Type: application/json" \
  -d '{
    "id": "user-123",
    "email": "jane@example.com",
    "name": "Jane"
  }'

# Send password reset
curl -X POST http://localhost:8787/emails/password-reset \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jane@example.com",
    "reset_url": "https://example.com/reset?token=abc123"
  }'

# Send with custom template
curl -X POST http://localhost:8787/emails/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "jane@example.com",
    "template_id": "order-confirmation",
    "data": {
      "name": "Jane",
      "order_id": "ORD-12345",
      "total": "$99.00",
      "delivery_date": "January 15, 2026",
      "tracking_url": "https://example.com/track/12345"
    }
  }'
```

### SendGrid-Compatible Endpoint

```bash
# Use existing SendGrid client code
curl -X POST http://localhost:8787/v3/mail/send \
  -H "Authorization: Bearer SG.xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "personalizations": [{
      "to": [{"email": "user@example.com", "name": "User"}],
      "dynamic_template_data": {"name": "User"}
    }],
    "from": {"email": "noreply@example.com", "name": "Company"},
    "subject": "Hello!",
    "content": [{"type": "text/html", "value": "<p>Hello {{name}}!</p>"}]
  }'
```

### Batch Campaigns

```bash
# Create campaign
curl -X POST http://localhost:8787/campaigns \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Product Launch",
    "template_id": "notification",
    "recipients": ["user1@example.com", "user2@example.com", "user3@example.com"]
  }'

# Send campaign
curl -X POST http://localhost:8787/campaigns/{id}/send \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Exciting News!",
    "title": "We just launched",
    "message": "Check out our new product!"
  }'
```

### Templates

```bash
# List templates
curl http://localhost:8787/templates

# Create/update template
curl -X PUT http://localhost:8787/templates/promo \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Promotional Email",
    "subject": "{{discount}}% Off Everything!",
    "html": "<h1>Save {{discount}}%</h1><p>Use code: {{code}}</p>",
    "text": "Save {{discount}}%! Use code: {{code}}",
    "variables": ["discount", "code"]
  }'
```

### Suppression & Unsubscribe

```bash
# Get suppression list
curl http://localhost:8787/suppression

# Add to suppression
curl -X POST http://localhost:8787/suppression \
  -H "Content-Type: application/json" \
  -d '{"email": "bounced@example.com", "reason": "bounce"}'

# Unsubscribe link (for email footers)
# GET /unsubscribe?email=user@example.com&list=marketing

# One-click unsubscribe (RFC 8058)
# POST /unsubscribe
```

### Email Logs & Stats

```bash
# Get email logs
curl "http://localhost:8787/logs?status=bounced&limit=50"

# Get statistics
curl http://localhost:8787/stats
# Returns: { total, sent, delivered, opened, clicked, bounced, failed, open_rate, click_rate, bounce_rate }
```

## Webhooks

### Receiving Events

Configure your email provider to send webhooks to:

- **SendGrid**: `POST /webhooks/sendgrid`
- **Resend**: `POST /webhooks/resend`
- **Auto-detect**: `POST /webhooks/events`

### Forwarding Events

Register webhook subscriptions to forward events to your services:

```bash
curl -X POST http://localhost:8787/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-app.com/email-events",
    "events": ["delivered", "bounced", "opened", "clicked", "complained"],
    "secret": "your-hmac-secret"
  }'
```

## Configuration

Set environment variables in `wrangler.jsonc`:

```jsonc
{
  "vars": {
    "FROM_EMAIL": "noreply@example.com",
    "FROM_NAME": "Example Company",
    "RESEND_API_KEY": "re_xxx",      // Optional: Resend provider
    "SENDGRID_API_KEY": "SG.xxx"     // Optional: SendGrid provider
  }
}
```

## Template Variables

Templates use Handlebars-style syntax:

```html
<p>Hello {{name}}!</p>

{{#if has_order}}
  <p>Your order #{{order_id}} is confirmed.</p>
{{/if}}

{{#each items}}
  <li>{{this.name}} - {{this.price}}</li>
{{/each}}
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   Your App      │────▶│   Email DO      │
└─────────────────┘     └────────┬────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  MailChannels   │     │     Resend      │     │    SendGrid     │
│   (free tier)   │     │   (fallback)    │     │   (fallback)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

- **Zero per-email costs** with MailChannels (included with Workers)
- **Automatic failover** to Resend or SendGrid if configured
- **SQLite storage** for templates, logs, and suppression lists

---

Built with [dotdo](https://dotdo.dev) | Powered by [@dotdo/emails](https://github.com/dotdo-dev/dotdo/tree/main/compat/emails)
