# @dotdo/integrations

Third-party integration registry for dotdo - standardized interfaces for external services like Stripe, SendGrid, Twilio, S3, and more.

## Features

- **Unified Interface** - Consistent API across all integrations
- **Type-Safe** - Full TypeScript support with strong typing
- **Circuit Breakers** - Built-in resilience for external API calls
- **Webhook Verification** - Secure webhook handling with signature verification
- **Extensible** - Easy to add custom integrations
- **Registry Pattern** - Centralized integration management

## Installation

```bash
npm install @dotdo/integrations
```

## Quick Start

### Using Stripe Integration

```typescript
import {
  integrationRegistry,
  createStripeIntegration,
  type StripeConfig
} from '@dotdo/integrations'

// Register Stripe integration
const stripe = createStripeIntegration({
  apiKey: process.env.STRIPE_SECRET_KEY!,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!
})

integrationRegistry.register('stripe', stripe)

// Use the integration
const integration = integrationRegistry.get('stripe')

// Create a customer
const result = await integration.call('createCustomer', {
  email: 'customer@example.com',
  name: 'Alice Smith'
})

if (result.success) {
  console.log('Customer created:', result.data)
}

// Create a payment intent
const paymentResult = await integration.call('createPaymentIntent', {
  amount: 5000, // $50.00
  currency: 'usd',
  customer: result.data.id
})
```

### Using SendGrid Integration

```typescript
import { createSendGridIntegration } from '@dotdo/integrations'

const sendgrid = createSendGridIntegration({
  apiKey: process.env.SENDGRID_API_KEY!
})

integrationRegistry.register('sendgrid', sendgrid)

// Send an email
const result = await integrationRegistry
  .get('sendgrid')
  .call('sendEmail', {
    to: [{ email: 'user@example.com', name: 'User' }],
    from: { email: 'noreply@example.com', name: 'My App' },
    subject: 'Welcome!',
    html: '<h1>Welcome to our service!</h1>'
  })
```

## Available Integrations

### Payment Processing

#### Stripe

Full Stripe integration with customers, payment intents, and subscriptions.

```typescript
import { createStripeIntegration } from '@dotdo/integrations'

const stripe = createStripeIntegration({
  apiKey: process.env.STRIPE_SECRET_KEY!,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
})

// Available methods:
// - createCustomer(data)
// - getCustomer(id)
// - createPaymentIntent(data)
// - confirmPaymentIntent(id)
// - createSubscription(data)
// - cancelSubscription(id)
```

### Email Services

#### SendGrid

Email delivery with SendGrid.

```typescript
import { createSendGridIntegration } from '@dotdo/integrations'

const sendgrid = createSendGridIntegration({
  apiKey: process.env.SENDGRID_API_KEY!
})

// Available methods:
// - sendEmail(request)
// - addContact(contact)
// - getEmailStats(emailId)
```

### SMS Services

#### Twilio

SMS and voice communication via Twilio.

```typescript
// Coming soon
```

### Storage

#### AWS S3

Object storage with S3-compatible APIs.

```typescript
// Coming soon
```

## Integration Registry

### Registering Integrations

```typescript
import {
  integrationRegistry,
  registerIntegration
} from '@dotdo/integrations'

// Register via helper
registerIntegration('stripe', stripeIntegration)

// Register via registry
integrationRegistry.register('sendgrid', sendgridIntegration, {
  category: 'email',
  tags: ['email', 'transactional']
})
```

### Getting Integrations

```typescript
// Get by name
const stripe = integrationRegistry.get('stripe')

// Check if registered
if (integrationRegistry.has('stripe')) {
  // Use integration
}

// Get all integrations
const all = integrationRegistry.list()

// Get by category
const emailIntegrations = integrationRegistry.list({
  category: 'payment'
})

// Get by tags
const transactional = integrationRegistry.list({
  tags: ['transactional']
})
```

### Unregistering

```typescript
integrationRegistry.unregister('old-integration')
```

## Creating Custom Integrations

### Basic Integration

```typescript
import {
  type Integration,
  type IntegrationConfig,
  successResult,
  errorResult
} from '@dotdo/integrations'

interface MyServiceConfig extends IntegrationConfig {
  apiKey: string
  baseUrl?: string
}

interface MyServiceMethods {
  getData(id: string): Promise<any>
  createRecord(data: any): Promise<any>
}

class MyServiceIntegration implements Integration<MyServiceConfig, MyServiceMethods> {
  name = 'my-service'
  version = '1.0.0'
  category = 'custom' as const

  constructor(private config: MyServiceConfig) {}

  async initialize() {
    // Setup code
  }

  async call(method: keyof MyServiceMethods, ...args: any[]) {
    try {
      if (method === 'getData') {
        const [id] = args
        const data = await this.getData(id)
        return successResult(data)
      }

      if (method === 'createRecord') {
        const [data] = args
        const result = await this.createRecord(data)
        return successResult(result)
      }

      throw new Error(`Unknown method: ${method}`)
    } catch (error) {
      return errorResult(error.message, 'API_ERROR')
    }
  }

  private async getData(id: string) {
    const response = await fetch(`${this.config.baseUrl}/data/${id}`, {
      headers: { 'Authorization': `Bearer ${this.config.apiKey}` }
    })
    return response.json()
  }

  private async createRecord(data: any) {
    const response = await fetch(`${this.config.baseUrl}/records`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    })
    return response.json()
  }

  async healthCheck() {
    try {
      const response = await fetch(`${this.config.baseUrl}/health`)
      return response.ok
    } catch {
      return false
    }
  }

  async handleWebhook(request: Request) {
    // Implement webhook handling
    const body = await request.json()
    return { verified: true, event: body }
  }
}

// Usage
const myService = new MyServiceIntegration({
  apiKey: process.env.MY_SERVICE_KEY!,
  baseUrl: 'https://api.myservice.com'
})

integrationRegistry.register('my-service', myService)
```

## Circuit Breaker

Built-in circuit breaker for resilient external API calls.

```typescript
import { CircuitBreaker } from '@dotdo/integrations'

const breaker = new CircuitBreaker({
  failureThreshold: 5,      // Open after 5 failures
  resetTimeout: 60000,       // Try again after 1 minute
  monitoringPeriod: 120000   // 2 minute sliding window
})

async function callExternalAPI() {
  return breaker.execute(async () => {
    const response = await fetch('https://api.example.com/data')
    if (!response.ok) throw new Error('API error')
    return response.json()
  })
}

// Check circuit state
console.log(breaker.state) // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
```

## Webhook Verification

Secure webhook handling with signature verification.

```typescript
import { verifyWebhookSignature } from '@dotdo/integrations'

export default {
  async fetch(request: Request, env: Env) {
    if (request.url.endsWith('/webhook/stripe')) {
      const signature = request.headers.get('stripe-signature')!
      const body = await request.text()

      const verified = verifyWebhookSignature({
        body,
        signature,
        secret: env.STRIPE_WEBHOOK_SECRET,
        algorithm: 'sha256'
      })

      if (!verified) {
        return new Response('Invalid signature', { status: 401 })
      }

      // Process webhook
      const event = JSON.parse(body)
      await processStripeEvent(event)

      return new Response('OK')
    }
  }
}
```

## API Reference

### Registry Methods

| Method | Description |
|--------|-------------|
| `register(name, integration, options?)` | Register an integration |
| `get(name)` | Get integration by name |
| `has(name)` | Check if integration exists |
| `unregister(name)` | Unregister integration |
| `list(options?)` | List all integrations |

### Integration Interface

```typescript
interface Integration<TConfig, TMethods> {
  name: string
  version: string
  category: IntegrationCategory
  config: TConfig

  initialize(): Promise<void>
  call(method: keyof TMethods, ...args: any[]): Promise<IntegrationResult>
  healthCheck(): Promise<boolean>
  handleWebhook?(request: Request): Promise<any>
}
```

### Result Types

```typescript
// Success result
const result = successResult(data, { metadata: 'optional' })

// Error result
const error = errorResult('Error message', 'ERROR_CODE')

// Check result
if (result.success) {
  console.log(result.data)
} else {
  console.error(result.error)
}
```

## Configuration

### Environment Variables

```bash
# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# SendGrid
SENDGRID_API_KEY=SG...

# Twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...

# AWS S3
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
```

### In wrangler.toml

```toml
[vars]
INTEGRATION_ENVIRONMENT = "production"

[secrets]
# Add secrets via: wrangler secret put STRIPE_SECRET_KEY
```

## Examples

### Complete Payment Flow

```typescript
import {
  integrationRegistry,
  createStripeIntegration
} from '@dotdo/integrations'

// Setup
const stripe = createStripeIntegration({
  apiKey: env.STRIPE_SECRET_KEY,
  webhookSecret: env.STRIPE_WEBHOOK_SECRET
})
integrationRegistry.register('stripe', stripe)

// Create customer
const customerResult = await stripe.call('createCustomer', {
  email: 'customer@example.com',
  name: 'John Doe'
})

if (!customerResult.success) {
  throw new Error(customerResult.error.message)
}

const customer = customerResult.data

// Create payment intent
const paymentResult = await stripe.call('createPaymentIntent', {
  amount: 10000, // $100.00
  currency: 'usd',
  customer: customer.id,
  payment_method: 'pm_card_visa'
})

// Confirm payment
const confirmResult = await stripe.call('confirmPaymentIntent',
  paymentResult.data.id
)

console.log('Payment status:', confirmResult.data.status)
```

### Email Notification System

```typescript
import { createSendGridIntegration } from '@dotdo/integrations'

const sendgrid = createSendGridIntegration({
  apiKey: env.SENDGRID_API_KEY
})

async function sendWelcomeEmail(user: User) {
  return sendgrid.call('sendEmail', {
    to: [{ email: user.email, name: user.name }],
    from: { email: 'noreply@example.com', name: 'My App' },
    subject: 'Welcome to My App!',
    html: `
      <h1>Welcome ${user.name}!</h1>
      <p>Thanks for signing up.</p>
    `
  })
}

async function sendOrderConfirmation(order: Order) {
  return sendgrid.call('sendEmail', {
    to: [{ email: order.customerEmail }],
    from: { email: 'orders@example.com', name: 'My Store' },
    subject: `Order Confirmation #${order.id}`,
    html: `
      <h1>Order Confirmed</h1>
      <p>Order ID: ${order.id}</p>
      <p>Total: $${order.total}</p>
    `
  })
}
```

## Best Practices

### 1. Use Circuit Breakers

Protect your app from cascading failures:

```typescript
const breaker = new CircuitBreaker({ failureThreshold: 5 })

async function callAPI() {
  return breaker.execute(() => externalAPI.call())
}
```

### 2. Validate Webhooks

Always verify webhook signatures:

```typescript
const verified = verifyWebhookSignature({
  body,
  signature,
  secret: env.WEBHOOK_SECRET
})

if (!verified) {
  return new Response('Unauthorized', { status: 401 })
}
```

### 3. Handle Errors Gracefully

Check result success before using data:

```typescript
const result = await integration.call('method', args)

if (!result.success) {
  logger.error('Integration error', result.error)
  return handleError(result.error)
}

return handleSuccess(result.data)
```

## Related Packages

- [@dotdo/do](/do) - Durable Object base class
- [@dotdo/observability](/observability) - Monitor integration health

## License

MIT
