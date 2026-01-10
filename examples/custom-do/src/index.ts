/**
 * Example: Custom DO with your own worker
 *
 * For full control, create your own Hono app and use
 * any combination of dotdo's DO classes.
 */

import { Hono } from 'hono'
import { DO } from 'dotdo'              // Standard DO
import { Worker } from 'dotdo/worker'   // With scheduling
import { Agent } from 'dotdo/agent'     // With AI capabilities

// Your DO classes
export class MyStartup extends DO {
  static readonly $type = 'MyStartup'

  async launch() {
    // Your startup logic
  }
}

export class MyWorker extends Worker {
  static readonly $type = 'MyWorker'

  // Scheduled tasks
  async onSchedule() {
    // Runs on $.every.hour() etc.
  }
}

export class MyAgent extends Agent {
  static readonly $type = 'MyAgent'

  // AI agent with tools
  tools = {
    searchDatabase: async (query: string) => {
      // ...
    },
    sendEmail: async (to: string, subject: string, body: string) => {
      // ...
    },
  }
}

// Custom Hono app - mix and match API styles
const app = new Hono()

// Use HATEOAS for public API
import hateoasApp from 'dotdo/workers/hateoas'
app.route('/api', hateoasApp)

// Use JSON:API for mobile clients
import jsonapiApp from 'dotdo/workers/jsonapi'
app.route('/mobile', jsonapiApp)

// Use simple JSON for internal services
import simpleApp from 'dotdo/workers/simple'
app.route('/internal', simpleApp)

// Custom routes
app.get('/health', (c) => c.json({ status: 'ok' }))

app.post('/webhooks/stripe', async (c) => {
  const event = await c.req.json()
  // Handle Stripe webhook
  return c.json({ received: true })
})

export default app
