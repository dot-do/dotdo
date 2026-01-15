# forms.example.com.ai

> Own your forms. Own your data. Zero per-submission fees.

Form services charge per submission and lock you into their ecosystem. With dotdo, forms are just Things in your Durable Object. Unlimited submissions. Full data ownership. AI-powered field suggestions.

## Quick Start

```typescript
import { $, ai, DO } from 'dotdo'

// Define your domain
$.defineNoun('Form')
$.defineNoun('Submission')
$.defineVerb('submit')
```

## Form Schema

Forms are Things with fields as nested data:

```typescript
const contactForm = $.createThing('Form', {
  name: 'Contact Us',
  slug: 'contact',
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'email', type: 'email', required: true },
    { name: 'message', type: 'textarea', required: true },
  ]
})

// AI-suggested fields
const surveyFields = await ai`
  Suggest 5 fields for a customer satisfaction survey.
  Return as JSON: [{ name, type, required, options? }]
`
```

## Handling Submissions

```typescript
$.on.Form.submitted(async (event) => {
  const { formId, responses } = event.data

  const submission = $.createThing('Submission', {
    formId,
    responses,
    submittedAt: new Date(),
  })

  // Link submission to form
  $.createAction(formId, 'submit', submission.$id)
})
```

## Promise Pipelining

Promises are stubs. Chain freely, await only when needed.

```typescript
// ❌ Sequential - N round-trips
for (const webhookId of form.webhooks) {
  await $.Webhook(webhookId).deliver(submission)
}

// ✅ Pipelined - fire and forget
form.webhooks.forEach(id => $.Webhook(id).deliver(submission))

// ✅ Pipelined - single round-trip
const fields = await $.Form(formId).getLatestVersion().fields
```

Only `await` at exit points when you need the value. Webhook delivery is a side effect - no result needed, no await needed.

## AI-Powered Validation

```typescript
// Classification
const isValidEmail = await ai.is`Is "${email}" a valid email?`

// Extraction
const entities = await ai.list`Extract dates and names from: "${message}"`

// Generation
const followUp = await ai`Suggest a clarifying question for: "${feedback}"`
```

## Multi-Tenant

Subdomain routing isolates tenant data:

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const tenant = new URL(request.url).hostname.split('.')[0]
    const stub = env.DO.get(env.DO.idFromName(tenant))
    return stub.fetch(request)
  }
}
```

```
acme.forms.example.com    -> DO('acme')
startup.forms.example.com -> DO('startup')
```

## REST API

```bash
GET  /forms                        # List forms
GET  /forms/:slug                  # Get form schema
POST /forms/:slug/submissions      # Submit form
GET  /forms/:slug/submissions      # List submissions
```

## Full Example

```typescript
import { $, ai, DO } from 'dotdo'

export class FormsDO extends DO {
  $

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    this.defineNoun('Form')
    this.defineNoun('Submission')
    this.defineVerb('submit')

    this.$.on.Form.submitted(async (event) => {
      const submission = this.createThing('Submission', {
        formId: event.data.formId,
        responses: event.data.responses,
        submittedAt: new Date(),
      })

      // AI spam detection
      const isSpam = await ai.is`
        Is this submission spam? ${JSON.stringify(event.data.responses)}
      `

      if (isSpam === 'true') {
        this.updateThing(submission.$id, { flagged: true })
      }
    })

    // Daily digest
    this.$.every.day.at('9am')(async () => {
      const yesterday = new Date(Date.now() - 86400000)
      // Process submissions from last 24h
    })
  }
}

export { FormsDO as DO }
```

## Deploy

```bash
npx wrangler deploy
```

Your forms are live at `https://tenant.forms.example.com`.

---

Built with [dotdo](https://github.com/dotdo/dotdo)
