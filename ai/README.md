# @dotdo/ai

> AI template literals with multi-provider routing

[![npm version](https://img.shields.io/npm/v/@dotdo/ai.svg)](https://www.npmjs.com/package/@dotdo/ai)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

## The Problem

Adding AI to your app is harder than it should be:

- **SDK sprawl** - Different APIs for OpenAI, Anthropic, Google, Cloudflare
- **Provider lock-in** - Your app breaks when one provider goes down or rate limits you
- **Token nightmares** - Counting tokens, tracking costs, hitting rate limits
- **Boilerplate hell** - Configuration, error handling, retries, caching... for every call

What should be one line of code becomes hundreds.

## The Solution

Just write AI:

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

## Quick Start

### Installation

```bash
npm install @dotdo/ai
```

### Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
```

### Basic Usage

```typescript
import { ai } from '@dotdo/ai'

// Simple prompts
const response = await ai`Explain quantum computing in simple terms`

// With variables
const summary = await ai`Summarize this article: ${articleText}`

// Access metadata
console.log(response.$meta.tokens)  // { input: 42, output: 256 }
console.log(response.$meta.cost)    // 0.0012
```

## Features

### Template Literals

Write prompts naturally with interpolation:

```typescript
const review = await ai`
  Review this code for bugs and security issues:

  ${codeSnippet}

  Focus on: ${focusAreas.join(', ')}
`
```

### Model Selection

Use `.with()` to configure any call:

```typescript
const creative = await ai`Generate a creative story about ${topic}`
  .with({
    model: 'claude-opus-4.5',
    temperature: 0.9
  })

const fast = await ai`Quick question`.with({ model: 'haiku' })
```

### Convenience Functions

Purpose-built functions for common tasks:

```typescript
import { write, summarize, code } from '@dotdo/ai'

// Writing
const blogPost = await write`a blog post about TypeScript best practices`

// Summarization
const brief = await summarize`${longArticle} in 3 bullet points`

// Code generation
const regex = await code`a regex to validate email addresses`
```

### Multi-Provider Routing

Automatic failover across providers:

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

### Streaming

Real-time responses:

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
```

### Token Counting and Cost Tracking

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

### Response Caching

Save money on repeated prompts:

```typescript
import { GenerationCache, EmbeddingCache } from '@dotdo/ai'

// Cache generations
const cache = new GenerationCache({
  defaultTTL: 60 * 60 * 1000,  // 1 hour
  maxSize: 1000                 // LRU eviction
})

// Cache embeddings
const embeddingCache = new EmbeddingCache()
```

### Circuit Breaker

Intelligent failure handling:

```typescript
import { ProviderFallback } from '@dotdo/ai'

const fallback = new ProviderFallback({
  providers: ['anthropic', 'openai', 'google'],
  maxRetriesPerProvider: 2,
  circuitBreaker: {
    failureThreshold: 3,    // Open after 3 failures
    recoveryTimeout: 60000, // Try again after 1 minute
    successThreshold: 1     // Close after 1 success
  }
})

const { result, provider, attemptCount } = await fallback.execute(
  async (provider) => callProvider(provider, prompt)
)
```

## API Reference

### Core Exports

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
| `ProviderFallback` | Fallback chain with circuit breaker |
| `configureProviders` | Configure provider credentials |

### Tokens and Costs

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
| `createStream` | Create stream from async iterable |
| `fromArray` | Create stream from array |
| `merge` | Merge multiple streams |

### Caching

| Export | Description |
|--------|-------------|
| `MemoryCache` | In-memory cache with TTL and LRU |
| `EmbeddingCache` | Specialized cache for embeddings |
| `GenerationCache` | Specialized cache for generations |
| `withCache` | Wrap async function with caching |

### Model Aliases

| Alias | Model |
|-------|-------|
| `opus` | claude-opus-4.5 |
| `sonnet` | claude-sonnet-4.5 |
| `haiku` | claude-3-5-haiku |
| `gpt-4o` | gpt-4o |
| `gpt-4` | gpt-4-turbo |
| `gemini` | gemini-2.0-flash-exp |

## Examples

### Chat Application

```typescript
import { ai } from '@dotdo/ai'

const messages: Message[] = []

async function chat(userMessage: string) {
  messages.push({ role: 'user', content: userMessage })

  const response = await ai`
    You are a helpful assistant.

    Conversation history:
    ${messages.map(m => `${m.role}: ${m.content}`).join('\n')}

    Respond to the user's latest message.
  `

  messages.push({ role: 'assistant', content: response })
  return response
}
```

### Code Review Bot

```typescript
import { ai, code } from '@dotdo/ai'

async function reviewPR(diff: string) {
  const review = await ai`
    Review this code diff for:
    - Bugs and potential issues
    - Security vulnerabilities
    - Performance concerns
    - Code style improvements

    ${diff}

    Provide specific, actionable feedback.
  `.with({ model: 'opus' })

  return review
}
```

### Document Processing

```typescript
import { ai, summarize } from '@dotdo/ai'

async function processDocument(doc: string) {
  // Quick summary
  const summary = await summarize`${doc} in 3 bullet points`

  // Extract entities
  const entities = await ai`
    Extract all named entities (people, companies, locations) from:
    ${doc}
    Return as JSON array.
  `.with({ model: 'haiku' })

  return { summary, entities: JSON.parse(entities) }
}
```

## Related Packages

| Package | Description |
|---------|-------------|
| [@dotdo/do](/do) | Durable Object with AI integration |
| [@dotdo/api](/api) | Self-describing Hono API |
| [@dotdo/mcp](/mcp) | Model Context Protocol tools |

## License

MIT
