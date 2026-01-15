# ai.example.com.ai

AI as simple as string interpolation.

## The Problem

Every AI integration requires SDKs, error handling, retries, response parsing, and cost tracking. You want AI in your app. You get a week of plumbing.

## The Solution

```typescript
import { ai, is, list, code } from 'dotdo'

const summary = await ai`Summarize: ${document}`
```

No SDK. No error handling. No parsing. Just strings in, strings out.

## Template Literals

### `ai` - Generation

```typescript
const tagline = await ai`Write a tagline for ${companyName}`

// Composition (nested AIPromises resolve automatically)
const summary = ai`Summarize: ${document}`
const report = await ai`Create report from: ${summary}`
```

### `is` - Classification

```typescript
const sentiment = await is`${review} positive or negative?`
// => "positive" | "negative"

const priority = await is`${ticket} low, medium, high, or critical?`
// => "low" | "medium" | "high" | "critical"
```

### `list` - Extraction

```typescript
const names = await list`Extract person names from: ${article}`
// => ["Alice", "Bob", "Charlie"]

const items = await list`Extract action items from: ${meetingNotes}`
// => ["Review proposal", "Schedule follow-up"]
```

### `code` - Code Generation

```typescript
const validator = await code`TypeScript function to validate email addresses`
const query = await code`SQL query to find top 10 customers by revenue`
```

## Batch Processing

```typescript
// Simple batch
const summaries = await ai.batch(documents, 'immediate')

// With template function
const sentiments = await ai.batch(
  reviews,
  'flex',
  (review) => is`${review} positive, negative, or neutral?`
)
```

### Batch Modes

| Mode | Cost | Use Case |
|------|------|----------|
| `immediate` | 1x | Real-time responses |
| `flex` | 0.5x | Background processing |
| `deferred` | 0.25x | Bulk analysis |

```typescript
const batch = ai.batch(items, 'deferred')
const status = await ai.batch.status(batch.batchId)
// => "pending" | "processing" | "completed"
```

## Cascade Tiers

```typescript
// Explicit provider
const result = await ai.provider('anthropic')`Complex reasoning task`

// Explicit model
const result = await ai.model('claude-3-opus')`Nuanced analysis`

// Chained
const result = await ai.provider('openai').model('gpt-4-turbo')`Fast generation`
```

Automatic fallback on failure:

```typescript
const ai = createAI({
  fallback: ['openai', 'anthropic'],
})
```

## Budget Tracking

```typescript
ai.budget.limit(100)
console.log(ai.budget.remaining) // => 95
console.log(ai.budget.spent)     // => 5

// Throws AIBudgetExceededError when exceeded
```

## Caching

```typescript
const ai = createAI({
  cache: { enabled: true, ttl: 5 * 60 * 1000, maxSize: 1000 },
})

await ai`Summarize: ${doc}` // API call
await ai`Summarize: ${doc}` // Cached
ai.cache.clear()            // Clear cache
```

## Lazy Evaluation

AIPromises only execute when awaited:

```typescript
const a = ai`Step A`
const b = ai`Step B with ${a}`
const c = ai`Step C with ${b}` // Nothing executed yet

const result = await c // All three execute now

// Cancel before execution
const promise = ai`Expensive operation`
promise.cancel()
```

## Promise Pipelining (Cap'n Web)

True Cap'n Proto-style pipelining: method calls on stubs batch until `await`, then resolve in a single round-trip.

```typescript
// Sequential - N round-trips
for (const doc of documents) {
  await this.Embedding(doc.id).generate(doc.content)
}

// Pipelined - fire and forget (valid for side effects)
documents.forEach(doc => this.Embedding(doc.id).generate(doc.content))

// Pipelined - single round-trip for chained operations
const insights = await this.Document(id).analyze().extractInsights().summarize()
```

`this.Noun(id)` returns a pipelined stub. Fire-and-forget is valid when you don't need the result.

## Real-World Example

```typescript
import { ai, is, list } from 'dotdo'

async function triageTicket(ticket: string) {
  const [priority, category, summary] = await Promise.all([
    is`${ticket} low, medium, high, or critical?`,
    is`${ticket} billing, technical, sales, or general?`,
    ai`Summarize in one sentence: ${ticket}`,
  ])

  const actionItems = await list`Extract action items: ${ticket}`
  return { priority, category, summary, actionItems }
}

// Batch process reviews
const sentiments = await ai.batch(
  reviews,
  'flex',
  (review) => is`${review} positive, negative, or neutral?`
)
```

## Configuration

```typescript
import { createAI } from 'dotdo'

const ai = createAI({
  providers: {
    openai: { apiKey: process.env.OPENAI_API_KEY },
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
  },
  model: 'gpt-4-turbo',
  budget: { limit: 1000 },
  cache: { enabled: true },
  fallback: ['openai', 'anthropic'],
})
```
