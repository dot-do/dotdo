# @dotdo/ai

> AI routing and template literals for Cloudflare Workers

## Stop Wrestling with AI SDKs

You want to add AI to your app. You have a clear vision - summarize this document, generate that code, answer those questions.

But then reality hits:

- **SDK sprawl** - Different APIs for OpenAI, Anthropic, Google, Cloudflare
- **Provider lock-in** - Your app breaks when one provider goes down
- **Token nightmares** - Counting tokens, tracking costs, hitting rate limits
- **Boilerplate hell** - Configuration, error handling, retries, caching... for every single call

What should be one line of code becomes hundreds.

## Just Write AI

```typescript
import { ai } from '@dotdo/ai'

const summary = await ai`Summarize: ${document}`
```

That's it. One line. Works everywhere.

```typescript
// Generate code
const sortFunction = await ai`Write a TypeScript function to sort users by date`

// Analyze data
const insights = await ai`What trends do you see in: ${salesData}`

// Answer questions
const answer = await ai`${question} Based on: ${context}`
```

## Need More Control?

Chain `.with()` to configure any call:

```typescript
const response = await ai`Generate a creative story about ${topic}`
  .with({
    model: 'claude-opus-4.5',
    temperature: 0.9
  })

// Access usage metadata
console.log(response.$meta.tokens)  // { input: 42, output: 256 }
console.log(response.$meta.cost)    // 0.0012
```

## Convenience Functions

Purpose-built functions for common tasks:

```typescript
import { ai, write, summarize, code } from '@dotdo/ai'

// Writing
const blogPost = await write`a blog post about TypeScript best practices`

// Summarization
const brief = await summarize`${longArticle} in 3 bullet points`

// Code generation
const regex = await code`a regex to validate email addresses`
```

## Features

### Template Literals
Write prompts naturally with interpolation. No more string concatenation or prompt builders.

### Multi-Provider Routing
OpenAI, Anthropic, Google, Cloudflare Workers AI - all through one interface. Switch providers by changing a string.

### Automatic Fallbacks
Provider down? Rate limited? The Router automatically fails over to your backup providers.

```typescript
import { Router } from '@dotdo/ai'

const router = new Router({
  providers: [
    { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
    { provider: 'openai', apiKey: process.env.OPENAI_API_KEY },
    { provider: 'google', apiKey: process.env.GOOGLE_API_KEY }
  ],
  fallback: ['anthropic', 'openai', 'google'],
  loadBalancing: 'least-loaded'
})

const result = await router.execute('Generate a haiku about code')
```

### Token Counting & Cost Tracking
Accurate BPE tokenization with tiktoken. Track costs across providers.

```typescript
import { countTokens, estimateCost, UsageTracker } from '@dotdo/ai'

// Count tokens before sending
const tokens = countTokens('Hello, world!', 'gpt-4o')

// Estimate costs
const cost = estimateCost({ input: 1000, output: 500 }, 'claude-sonnet-4')

// Track usage across your app
const tracker = new UsageTracker()
tracker.setBudgetLimit(10.00) // $10 limit
tracker.onBudgetThreshold(0.8, (cost) => {
  console.warn(`Warning: $${cost.toFixed(2)} spent (80% of budget)`)
})
```

### Streaming
Real-time responses with a fluent stream API:

```typescript
const response = ai`Write a story about dragons`

// Stream tokens as they arrive
for await (const chunk of response.stream()) {
  process.stdout.write(chunk)
}

// Transform streams
const uppercased = await response.stream()
  .map(chunk => chunk.toUpperCase())
  .collect()

// Cancel mid-stream
const controller = new AbortController()
setTimeout(() => controller.abort(), 1000)
const stream = response.stream({ signal: controller.signal })
```

### Response Caching
Save money on repeated prompts with built-in caching:

```typescript
import { GenerationCache, EmbeddingCache } from '@dotdo/ai'

// Cache generations
const cache = new GenerationCache({
  defaultTTL: 60 * 60 * 1000,  // 1 hour
  maxSize: 1000                 // LRU eviction
})

// Cache embeddings
const embeddingCache = new EmbeddingCache()
const { hits, misses } = await embeddingCache.getMany(texts, { model: 'text-embedding-3-small' })
```

### Circuit Breaker Pattern
Intelligent failure handling with automatic recovery:

```typescript
import { ProviderFallback } from '@dotdo/ai'

const fallback = new ProviderFallback({
  providers: ['anthropic', 'openai', 'google'],
  maxRetriesPerProvider: 2,
  circuitBreaker: {
    failureThreshold: 3,    // Open circuit after 3 failures
    recoveryTimeout: 60000, // Try again after 1 minute
    successThreshold: 1     // Close circuit after 1 success
  },
  backoff: {
    initialDelay: 1000,
    multiplier: 2,
    maxDelay: 30000,
    jitter: true
  }
})

const { result, provider, attemptCount } = await fallback.execute(
  async (provider) => callProvider(provider, prompt)
)
```

## Installation

```bash
npm install @dotdo/ai
```

### Environment Variables

Configure your API keys:

```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
```

## Model Aliases

Use short aliases for common models:

| Alias | Model |
|-------|-------|
| `opus` | claude-opus-4.5 |
| `sonnet` | claude-sonnet-4.5 |
| `haiku` | claude-3-5-haiku |
| `gpt-4o` | gpt-4o |
| `gpt-4` | gpt-4-turbo |
| `gemini` | gemini-2.0-flash-exp |

```typescript
const fast = await ai`Quick question`.with({ model: 'haiku' })
const smart = await ai`Complex analysis`.with({ model: 'opus' })
```

## API Reference

### Core

| Export | Description |
|--------|-------------|
| `ai` | Template literal function for AI calls |
| `write` | Convenience function for content generation |
| `summarize` | Convenience function for summarization |
| `code` | Convenience function for code generation |

### Routing

| Export | Description |
|--------|-------------|
| `Router` | Multi-provider router with load balancing |
| `configureProviders` | Configure providers for routing |
| `ProviderFallback` | Fallback chain executor with circuit breaker |
| `FallbackError` | Error with detailed failure information |

### Tokens & Costs

| Export | Description |
|--------|-------------|
| `countTokens` | Count tokens in text |
| `countMessageTokens` | Count tokens in message array |
| `estimateCost` | Estimate cost for token usage |
| `getModelPricing` | Get pricing info for a model |
| `UsageTracker` | Track usage across requests |

### Streaming

| Export | Description |
|--------|-------------|
| `createStream` | Create a stream from async iterable |
| `fromArray` | Create a stream from an array |
| `merge` | Merge multiple streams |

### Caching

| Export | Description |
|--------|-------------|
| `MemoryCache` | In-memory cache with TTL and LRU |
| `EmbeddingCache` | Specialized cache for embeddings |
| `GenerationCache` | Specialized cache for generations |
| `withCache` | Wrap any async function with caching |

### Types

| Export | Description |
|--------|-------------|
| `AIPromise` | Promise with `$meta`, `.with()`, `.stream()` |
| `AIMeta` | Metadata (model, tokens, cost, duration) |
| `Provider` | `'openai' \| 'anthropic' \| 'google' \| 'cloudflare'` |
| `Stream` | Async iterable with transformations |

## Submodule Imports

Import specific functionality to reduce bundle size:

```typescript
import { ai } from '@dotdo/ai/template'
import { Router } from '@dotdo/ai/router'
import { countTokens } from '@dotdo/ai/tokens'
import { createStream } from '@dotdo/ai/stream'
import { MemoryCache } from '@dotdo/ai/cache'
import { ProviderFallback } from '@dotdo/ai/fallback'
```

## Related Packages

- **dotdo** - The main dotdo package (re-exports @dotdo/ai)
- **@dotdo/do** - Durable Objects with built-in AI integration
- **@dotdo/api** - Self-describing Hono API with HATEOAS

## License

MIT
