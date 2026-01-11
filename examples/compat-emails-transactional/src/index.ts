/**
 * Transactional Email Service
 *
 * SendGrid API. Your infrastructure. Your deliverability.
 *
 * Features:
 * - SendGrid-compatible /v3/mail/send endpoint
 * - Template rendering with dynamic variables
 * - Batch campaigns with automatic suppression
 * - Webhook processing (delivered, bounced, opened, clicked)
 * - Bounce/complaint handling with automatic list hygiene
 * - One-click unsubscribe management
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  createSendGridRouter,
  parseSendGridWebhook,
  parseResendWebhook,
  type WebhookEvent,
} from 'dotdo/compat/emails'
import { EmailDO, type User, type Env } from './EmailDO'

export { EmailDO }

// ============================================================================
// App
// ============================================================================

type HonoEnv = {
  Bindings: Env
  Variables: {
    emailDO: DurableObjectStub<EmailDO>
  }
}

const app = new Hono<HonoEnv>()

// CORS for API access
app.use('*', cors())

// Get DO stub for current tenant
app.use('*', async (c, next) => {
  // Use hostname or path param for multi-tenancy
  const tenant = c.req.header('X-Tenant-ID') || 'default'
  const id = c.env.EMAIL_DO.idFromName(tenant)
  const stub = c.env.EMAIL_DO.get(id) as unknown as DurableObjectStub<EmailDO>
  c.set('emailDO', stub)
  await next()
})

// ============================================================================
// SendGrid Compatible API
// ============================================================================

// Mount SendGrid-compatible routes
app.route('/', createSendGridRouter())

// ============================================================================
// Transactional Email Endpoints
// ============================================================================

/**
 * Send welcome email
 */
app.post('/emails/welcome', async (c) => {
  const user = await c.req.json<User>()
  const result = await c.var.emailDO.sendWelcome(user)

  if (result.success) {
    return c.json({ id: result.id, status: 'sent' }, 202)
  }
  return c.json({ error: 'Failed to send email' }, 500)
})

/**
 * Send password reset email
 */
app.post('/emails/password-reset', async (c) => {
  const { email, reset_url } = await c.req.json<{ email: string; reset_url: string }>()
  const result = await c.var.emailDO.sendPasswordReset(email, reset_url)

  if (result.success) {
    return c.json({ id: result.id, status: 'sent' }, 202)
  }
  return c.json({ error: 'Failed to send email' }, 500)
})

/**
 * Send order confirmation email
 */
app.post('/emails/order-confirmation', async (c) => {
  const { user, order } = await c.req.json<{
    user: User
    order: { id: string; total: string; deliveryDate: string; trackingUrl: string }
  }>()
  const result = await c.var.emailDO.sendOrderConfirmation(user, order)

  if (result.success) {
    return c.json({ id: result.id, status: 'sent' }, 202)
  }
  return c.json({ error: 'Failed to send email' }, 500)
})

/**
 * Send email with custom template
 */
app.post('/emails/send', async (c) => {
  const { to, template_id, data } = await c.req.json<{
    to: string
    template_id: string
    data: Record<string, unknown>
  }>()
  const result = await c.var.emailDO.sendWithTemplate(to, template_id, data)

  if (result.success) {
    return c.json({ id: result.id, status: 'sent' }, 202)
  }
  return c.json({ error: 'Failed to send email' }, 500)
})

// ============================================================================
// Campaign Endpoints
// ============================================================================

/**
 * Create a new campaign
 */
app.post('/campaigns', async (c) => {
  const { name, template_id, recipients } = await c.req.json<{
    name: string
    template_id: string
    recipients: string[]
  }>()

  const campaign = await c.var.emailDO.createCampaign(name, template_id, recipients)
  return c.json(campaign, 201)
})

/**
 * Get campaign by ID
 */
app.get('/campaigns/:id', async (c) => {
  const id = c.req.param('id')
  const campaign = await c.var.emailDO.getCampaign(id)

  if (!campaign) {
    return c.json({ error: 'Campaign not found' }, 404)
  }
  return c.json(campaign)
})

/**
 * Send a campaign
 */
app.post('/campaigns/:id/send', async (c) => {
  const id = c.req.param('id')
  const data = await c.req.json<Record<string, unknown>>()

  try {
    const result = await c.var.emailDO.sendCampaign(id, data)
    return c.json({
      status: 'sent',
      sent: result.sent,
      failed: result.failed,
    })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})

// ============================================================================
// Webhook Endpoints
// ============================================================================

/**
 * Receive SendGrid webhook events
 */
app.post('/webhooks/sendgrid', async (c) => {
  const body = await c.req.json()
  const events = parseSendGridWebhook(body as unknown[])

  for (const event of events) {
    await processWebhookEvent(c.var.emailDO, event)
  }

  return c.body(null, 200)
})

/**
 * Receive Resend webhook events
 */
app.post('/webhooks/resend', async (c) => {
  const body = await c.req.json()
  const event = parseResendWebhook(body)

  if (event) {
    await processWebhookEvent(c.var.emailDO, event)
  }

  return c.body(null, 200)
})

/**
 * Generic webhook endpoint (auto-detect format)
 */
app.post('/webhooks/events', async (c) => {
  const body = await c.req.json()

  // Try to detect format
  if (Array.isArray(body)) {
    // SendGrid format
    const events = parseSendGridWebhook(body as unknown[])
    for (const event of events) {
      await processWebhookEvent(c.var.emailDO, event)
    }
  } else if (body.type && body.data) {
    // Resend format
    const event = parseResendWebhook(body)
    if (event) {
      await processWebhookEvent(c.var.emailDO, event)
    }
  }

  return c.body(null, 200)
})

async function processWebhookEvent(
  emailDO: DurableObjectStub<EmailDO>,
  event: WebhookEvent
): Promise<void> {
  switch (event.type) {
    case 'delivered':
      await emailDO.handleDelivered(event)
      break
    case 'bounced':
      await emailDO.handleBounce(event)
      break
    case 'opened':
      await emailDO.handleOpened(event)
      break
    case 'clicked':
      await emailDO.handleClicked(event)
      break
    case 'complained':
      await emailDO.handleComplaint(event)
      break
  }
}

// ============================================================================
// Suppression & Unsubscribe Endpoints
// ============================================================================

/**
 * Get suppression list
 */
app.get('/suppression', async (c) => {
  const list = await c.var.emailDO.getSuppressionList()
  return c.json({ data: list })
})

/**
 * Add to suppression list
 */
app.post('/suppression', async (c) => {
  const { email, reason } = await c.req.json<{ email: string; reason: 'bounce' | 'complaint' | 'unsubscribe' }>()
  await c.var.emailDO.addToSuppression(email, reason)
  return c.json({ status: 'added' }, 201)
})

/**
 * Remove from suppression list
 */
app.delete('/suppression/:email', async (c) => {
  const email = c.req.param('email')
  await c.var.emailDO.removeFromSuppression(email)
  return c.body(null, 204)
})

/**
 * Unsubscribe endpoint (for email links)
 */
app.get('/unsubscribe', async (c) => {
  const email = c.req.query('email')
  const list = c.req.query('list') || 'all'

  if (!email) {
    return c.html('<h1>Invalid unsubscribe link</h1>', 400)
  }

  await c.var.emailDO.unsubscribe(email, [list])

  return c.html(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribed</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 40px; text-align: center; }
    h1 { color: #333; }
    p { color: #666; }
    a { color: #2563eb; }
  </style>
</head>
<body>
  <h1>You've been unsubscribed</h1>
  <p>You will no longer receive ${list === 'all' ? 'emails' : list + ' emails'} from us.</p>
  <p><a href="/resubscribe?email=${encodeURIComponent(email)}">Changed your mind? Resubscribe</a></p>
</body>
</html>
  `)
})

/**
 * One-click unsubscribe (RFC 8058)
 */
app.post('/unsubscribe', async (c) => {
  const body = await c.req.parseBody()
  const email = (body['List-Unsubscribe'] as string) || c.req.query('email')

  if (!email) {
    return c.body(null, 400)
  }

  await c.var.emailDO.unsubscribe(email, ['all'])
  return c.body(null, 200)
})

/**
 * Resubscribe endpoint
 */
app.get('/resubscribe', async (c) => {
  const email = c.req.query('email')

  if (!email) {
    return c.html('<h1>Invalid resubscribe link</h1>', 400)
  }

  await c.var.emailDO.resubscribe(email)

  return c.html(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Resubscribed</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 40px; text-align: center; }
    h1 { color: #333; }
    p { color: #666; }
  </style>
</head>
<body>
  <h1>Welcome back!</h1>
  <p>You've been resubscribed to our emails.</p>
</body>
</html>
  `)
})

// ============================================================================
// Template Management
// ============================================================================

/**
 * List templates
 */
app.get('/templates', async (c) => {
  const templates = await c.var.emailDO.listTemplates()
  return c.json({ data: templates })
})

/**
 * Get template by ID
 */
app.get('/templates/:id', async (c) => {
  const id = c.req.param('id')
  const template = await c.var.emailDO.getTemplate(id)

  if (!template) {
    return c.json({ error: 'Template not found' }, 404)
  }
  return c.json(template)
})

/**
 * Create or update template
 */
app.put('/templates/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{
    name: string
    subject: string
    html: string
    text?: string
    variables?: string[]
  }>()

  await c.var.emailDO.upsertTemplate({
    id,
    ...body,
  })

  return c.json({ id, status: 'saved' })
})

/**
 * Delete template
 */
app.delete('/templates/:id', async (c) => {
  const id = c.req.param('id')
  await c.var.emailDO.deleteTemplate(id)
  return c.body(null, 204)
})

// ============================================================================
// Email Logs & Stats
// ============================================================================

/**
 * Get email logs
 */
app.get('/logs', async (c) => {
  const status = c.req.query('status')
  const recipient = c.req.query('recipient')
  const limit = parseInt(c.req.query('limit') || '50')
  const offset = parseInt(c.req.query('offset') || '0')

  const logs = await c.var.emailDO.getEmailLogs({
    status,
    recipient,
    limit,
    offset,
  })

  return c.json({ data: logs })
})

/**
 * Get email statistics
 */
app.get('/stats', async (c) => {
  const stats = await c.var.emailDO.getStats()
  return c.json(stats)
})

// ============================================================================
// Health Check
// ============================================================================

app.get('/health', (c) => c.json({ status: 'ok' }))

export default app
