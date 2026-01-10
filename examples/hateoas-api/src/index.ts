/**
 * Example: HATEOAS API with dotdo
 *
 * Server: apis.vin-style clickable REST API
 * Client: RPC with promise pipelining
 *
 * Server Response (GET /my-startup/):
 * {
 *   "api": { "$context": "https://my-startup.example.com" },
 *   "discover": { "Customer": "/Customer/", "Order": "/Order/" },
 *   "actions": { "rpc": { "method": "POST", "href": "/rpc" } }
 * }
 *
 * Client Usage:
 * ```typescript
 * import { $Context } from 'dotdo'
 * const $ = $Context('https://my-startup.example.com')
 * await $.Customer('alice').update({ name: 'Alice' })
 * ```
 */

import { DO } from 'dotdo'

export class MyStartup extends DO {
  static readonly $type = 'MyStartup'

  // Your business logic here
  async onCustomerSignup(customer: { email: string; name: string }) {
    // Create the customer
    await this.$.things.create({
      $type: 'Customer',
      $id: customer.email,
      name: customer.name,
      signedUpAt: new Date(),
    })

    // Send welcome email
    await this.$.do(async () => {
      await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.env.SENDGRID_KEY}` },
        body: JSON.stringify({
          to: customer.email,
          subject: 'Welcome!',
          text: `Hi ${customer.name}, welcome to our platform!`,
        }),
      })
    })
  }
}

// Re-export the HATEOAS worker as default
export { default } from 'dotdo/workers/hateoas'
