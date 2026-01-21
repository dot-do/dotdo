# AI Module (@dotdo/ai)

The `@dotdo/ai` module provides a unified AI interface with template literal syntax, multi-provider routing, streaming support, and cost tracking.

## Table of Contents

- [Quick Start](#quick-start)
- [Template Literal API](#template-literal-api)
- [AIPromise Methods](#aipromise-methods)
- [Multi-Provider Routing](#multi-provider-routing)
- [Streaming Responses](#streaming-responses)
- [Cost and Token Tracking](#cost-and-token-tracking)
- [Convenience Functions](#convenience-functions)
- [Configuration](#configuration)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)

## Quick Start

```typescript
import { ai } from '@dotdo/ai'

// Simple template literal usage
const summary = await ai`Summarize this article: ${articleText}`

// With options
const code = await ai`Write a TypeScript function to validate emails`.with({
  model: 'gpt-4',
  temperature: 0.7
})

console.log(code)
```

## Template Literal API

The core of `@dotdo/ai` is the template literal interface. Use the `ai` tag to create AI prompts naturally:

### Basic Usage

```typescript
import { ai } from '@dotdo/ai'

// Simple prompt
const response = await ai`What is the capital of France?`

// With interpolation
const topic = 'quantum computing'
const explanation = await ai`Explain ${topic} in simple terms`

// Multiple interpolations
const language = 'TypeScript'
const task = 'sorting algorithm'
const code = await ai`Write a ${task} in ${language}`
```

### Chaining with .with()

The `.with()` method lets you configure AI parameters:

```typescript
// Specify model
const result = await ai`Generate creative story`.with({
  model: 'claude-opus-4-5'  // Use Claude Opus 4.5
})

// Control temperature (0 = deterministic, 1 = creative)
const formal = await ai`Write a business email`.with({
  temperature: 0.3  // More deterministic
})

const creative = await ai`Write a poem`.with({
  temperature: 0.9  // More creative
})

// Combine options
const response = await ai`Complex task`.with({
  model: 'gpt-4',
  temperature: 0.5
})
```

### Supported Models

| Alias | Full Model Name | Provider | Best For |
|-------|----------------|----------|----------|
| `sonnet` | `claude-3-5-sonnet-20241022` | Anthropic | Default, balanced |
| `claude-opus-4-5` | `claude-opus-4-5-20251101` | Anthropic | Complex reasoning |
| `claude-sonnet-4-5` | `claude-sonnet-4-5-20250929` | Anthropic | Fast, high quality |
| `claude-3.5-haiku` | `claude-3-5-haiku-20241022` | Anthropic | Fast, cost-effective |
| `gpt-4o` | `gpt-4o` | OpenAI | Multimodal, fast |
| `gpt-4o-mini` | `gpt-4o-mini` | OpenAI | Very fast, cheap |
| `gpt-4` | `gpt-4` | OpenAI | High quality |
| `gemini-2.0-flash` | `gemini-2.0-flash-exp` | Google | Very fast |
| `gemini-1.5-pro` | `gemini-1.5-pro` | Google | Long context (2M) |

## AIPromise Methods

The `ai` template returns an `AIPromise` - a Promise extended with AI-specific methods:

### .with(options)

Configure the AI call:

```typescript
const result = await ai`Your prompt`.with({
  model: 'gpt-4',
  temperature: 0.7
})
```

### .$meta

Access metadata about the AI call after completion:

```typescript
const result = await ai`Summarize: ${text}`

console.log(result.$meta)
// {
//   model: 'sonnet',
//   tokens: { input: 150, output: 50 },
//   cost: 0.0006,
//   duration: 1234
// }
```

### .stream()

Get a streaming response for real-time output:

```typescript
const stream = ai`Write a long story`.stream()

for await (const chunk of stream) {
  process.stdout.write(chunk)
}
```

### .json()

Parse the response as JSON:

```typescript
const data = await ai`
  Extract entities from: "${text}"
  Return as JSON: { people: string[], places: string[] }
`.json<{ people: string[], places: string[] }>()

console.log(data.people)  // Type-safe!
```

### .pipe()

Transform results with chained operations:

```typescript
const result = await ai`Generate 5 random words`
  .pipe(text => text.split('\n'))
  .pipe(lines => lines.filter(l => l.trim()))
  .pipe(words => words.map(w => w.toUpperCase()))

console.log(result)  // ['APPLE', 'BANANA', ...]
```

## Multi-Provider Routing

The `Router` class enables intelligent routing across multiple AI providers with fallback, load balancing, and cost optimization.

### Basic Router Setup

```typescript
import { Router, configureProviders } from '@dotdo/ai'

// Quick setup with configureProviders
const router = configureProviders([
  { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
  { provider: 'openai', apiKey: process.env.OPENAI_API_KEY },
  { provider: 'google', apiKey: process.env.GOOGLE_API_KEY }
])

const result = await router.execute('Generate a haiku about coding')
console.log(result.result)
console.log(result.provider)  // Which provider was used
```

### Advanced Router Configuration

```typescript
const router = new Router({
  providers: [
    { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
    { provider: 'openai', apiKey: process.env.OPENAI_API_KEY }
  ],

  // Fallback chain - try providers in order
  fallback: ['anthropic', 'openai', 'google'],

  // Maximum retries per provider
  maxRetries: 3,

  // Load balancing strategy
  loadBalancing: 'least-loaded',  // or 'round-robin', 'random'

  // Cost constraint
  maxCostPerRequest: 0.10
})
```

### Load Balancing Strategies

| Strategy | Description |
|----------|-------------|
| `round-robin` | Rotate through providers sequentially |
| `random` | Random provider selection |
| `least-loaded` | Select provider with fewest active requests |

### Capability-Based Selection

Select models by capability rather than name:

```typescript
const router = new Router()

// Select fastest model
const fastModel = router.selectByCapability('fast')
// Returns claude-3.5-haiku

// Select smartest model
const smartModel = router.selectByCapability('smart')
// Returns claude-opus-4-5

// Select cheapest model
const cheapModel = router.selectByCapability('cheap')
// Returns gemini-1.5-flash
```

### Cost-Constrained Selection

```typescript
const router = new Router({ maxCostPerRequest: 0.05 })

// Selects cheapest model that can handle the task within budget
const model = router.selectModel({
  task: 'summarization',
  tokens: 5000
})

console.log(model.model)           // Selected model name
console.log(model.costPer1kTokens) // Cost per 1K tokens
```

### Health Monitoring

```typescript
const router = new Router({ providers: [...] })

// Check provider health
const health = router.getHealth()
// {
//   anthropic: { healthy: true, lastCheck: 1234567890, consecutiveFailures: 0 },
//   openai: { healthy: false, lastCheck: 1234567800, consecutiveFailures: 3 }
// }

// Get active request counts (for least-loaded balancing)
const activeRequests = router.getActiveRequests()
// { anthropic: 5, openai: 0, google: 2 }
```

## Streaming Responses

For long-form content, use streaming to display output progressively:

### Basic Streaming

```typescript
import { ai } from '@dotdo/ai'

const stream = ai`Write a detailed tutorial on React hooks`.stream()

for await (const chunk of stream) {
  process.stdout.write(chunk)  // Display progressively
}
```

### Stream with Progress

```typescript
import { createStream } from '@dotdo/ai'

const stream = ai`Generate a long story`.stream()

let totalLength = 0
for await (const chunk of stream) {
  totalLength += chunk.length
  console.log(`Received ${totalLength} characters...`)
  // Process chunk
}
```

### Stream to Response (Cloudflare Workers)

```typescript
export default {
  async fetch(request: Request): Promise<Response> {
    const stream = ai`Generate content`.stream()

    return new Response(stream.toReadableStream(), {
      headers: { 'Content-Type': 'text/plain' }
    })
  }
}
```

## Cost and Token Tracking

Track usage for billing and optimization:

### Per-Request Tracking

```typescript
import { ai } from '@dotdo/ai'

const result = await ai`Analyze this document: ${longText}`

const meta = result.$meta
console.log(`Input tokens: ${meta.tokens?.input}`)
console.log(`Output tokens: ${meta.tokens?.output}`)
console.log(`Duration: ${meta.duration}ms`)
```

### Token Counting

Pre-count tokens before making requests:

```typescript
import { countMessageTokens, getModelPricing } from '@dotdo/ai'

const text = 'Your long prompt text here...'
const tokenCount = await countMessageTokens(text, 'gpt-4')

// Get pricing info
const pricing = getModelPricing('gpt-4')
const estimatedCost = (tokenCount / 1000) * pricing.inputPer1k

console.log(`Estimated cost: $${estimatedCost.toFixed(4)}`)
```

### Usage Tracking Module

```typescript
import { UsageTracker } from '@dotdo/ai'

const tracker = new UsageTracker()

// Track a request
tracker.track({
  model: 'claude-3.5-sonnet',
  inputTokens: 1000,
  outputTokens: 500,
  duration: 2000
})

// Get aggregated stats
const stats = tracker.getStats()
console.log(`Total cost: $${stats.totalCost}`)
console.log(`Total requests: ${stats.requestCount}`)
console.log(`Avg latency: ${stats.avgLatency}ms`)
```

## Convenience Functions

Specialized template functions for common tasks:

### write() - Content Generation

```typescript
import { write } from '@dotdo/ai'

const blogPost = await write`a blog post about sustainable technology`

const email = await write`a professional email declining a meeting invitation`.with({
  temperature: 0.3
})
```

### summarize() - Summarization

```typescript
import { summarize } from '@dotdo/ai'

const summary = await summarize`${longArticle}`

const briefing = await summarize`${meetingTranscript} in 3 bullet points`
```

### code() - Code Generation

```typescript
import { code } from '@dotdo/ai'

const sortFunction = await code`a TypeScript function to sort objects by date`

const regex = await code`a regex to validate email addresses`

const component = await code`a React component for a file upload dropzone`
```

## Configuration

### Environment Variables

```bash
# Required for default Anthropic models
ANTHROPIC_API_KEY=sk-ant-...

# Required for OpenAI models
OPENAI_API_KEY=sk-...

# Required for Google models
GOOGLE_API_KEY=...

# Optional: Cloudflare Workers AI
CF_ACCOUNT_ID=...
CF_API_TOKEN=...
```

### Programmatic Configuration

```typescript
import { configureProviders } from '@dotdo/ai'

// Configure at startup
const router = configureProviders([
  {
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-3.5-sonnet'  // Default model for this provider
  },
  {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o'
  }
])
```

## Error Handling

### Provider Errors

```typescript
import { ai, AIError, ProviderError, RateLimitError } from '@dotdo/ai'

try {
  const result = await ai`Generate content`
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log(`Rate limited. Retry after: ${error.retryAfter}s`)
  } else if (error instanceof ProviderError) {
    console.log(`Provider ${error.provider} failed: ${error.message}`)
  } else if (error instanceof AIError) {
    console.log(`AI error: ${error.message}`)
  }
}
```

### Configuration Errors

```typescript
try {
  const result = await ai`Generate content`
} catch (error) {
  if (error.message.includes('API key not configured')) {
    console.log('Please set ANTHROPIC_API_KEY environment variable')
  }
  if (error.message.includes('ai-providers not configured')) {
    console.log('Install ai-providers: npm install ai-providers')
  }
}
```

### Router Fallback Errors

```typescript
const router = new Router({
  providers: [...],
  fallback: ['anthropic', 'openai', 'google']
})

try {
  const result = await router.execute('Generate content')
} catch (error) {
  if (error.message.includes('All providers failed')) {
    console.log('All providers are down or rate limited')
  }
  if (error.message.includes('Max retries exceeded')) {
    console.log('Rate limit persists across retry attempts')
  }
}
```

## Best Practices

### 1. Use the Right Model for the Task

```typescript
// Fast, simple tasks - use cheap/fast models
const label = await ai`Classify sentiment: ${text}`.with({ model: 'claude-3.5-haiku' })

// Complex reasoning - use smart models
const analysis = await ai`Analyze this code for security issues: ${code}`.with({
  model: 'claude-opus-4-5'
})
```

### 2. Configure Fallbacks for Production

```typescript
const router = new Router({
  providers: [
    { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
    { provider: 'openai', apiKey: process.env.OPENAI_API_KEY }
  ],
  fallback: ['anthropic', 'openai'],
  maxRetries: 3
})
```

### 3. Stream Long Responses

```typescript
// Bad: Wait for entire response
const story = await ai`Write a 10,000 word story`

// Good: Stream for better UX
const stream = ai`Write a 10,000 word story`.stream()
for await (const chunk of stream) {
  displayChunk(chunk)
}
```

### 4. Track Costs in Production

```typescript
const result = await ai`Process ${largeDataset}`

// Log costs for monitoring
logger.info('AI request completed', {
  model: result.$meta.model,
  inputTokens: result.$meta.tokens?.input,
  outputTokens: result.$meta.tokens?.output,
  duration: result.$meta.duration
})
```

### 5. Use Structured Output with .json()

```typescript
// Get type-safe structured data
interface Analysis {
  sentiment: 'positive' | 'negative' | 'neutral'
  confidence: number
  keywords: string[]
}

const analysis = await ai`
  Analyze: "${text}"
  Return JSON: { sentiment, confidence (0-1), keywords }
`.json<Analysis>()

// TypeScript knows the shape
console.log(analysis.sentiment)  // Type-safe
```

## File Locations

| File | Description |
|------|-------------|
| `/Users/nathanclevenger/projects/dotdo/ai/template.ts` | Template literal implementation |
| `/Users/nathanclevenger/projects/dotdo/ai/promise.ts` | AIPromise wrapper |
| `/Users/nathanclevenger/projects/dotdo/ai/router.ts` | Multi-provider routing |
| `/Users/nathanclevenger/projects/dotdo/ai/stream.ts` | Streaming support |
| `/Users/nathanclevenger/projects/dotdo/ai/tokens.ts` | Token counting |
| `/Users/nathanclevenger/projects/dotdo/ai/tracking.ts` | Usage tracking |
| `/Users/nathanclevenger/projects/dotdo/ai/index.ts` | Module exports |

## Related Documentation

- [SDK Generation](./SDK_GENERATION.md) - Generate SDKs from API definitions
- [MCP Tools](./MCP_TOOLS.md) - AI agent tool generation
- [Error Handling](./ERROR_HANDLING.md) - Error handling patterns
