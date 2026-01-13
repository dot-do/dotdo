[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / CloudflareEnv

# Interface: CloudflareEnv

Defined in: [types/CloudflareBindings.ts:447](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L447)

CloudflareEnv - Unified environment type for all Cloudflare bindings

This interface combines all binding categories into a single type
that can be used across the application. All bindings are optional
to support different deployment configurations.

## Example

```typescript
// In a Worker
export default {
  async fetch(request: Request, env: CloudflareEnv) {
    const kv = env.KV
    const ai = env.AI
    // ...
  }
}

// In a Durable Object
class MyDO extends DurableObject<CloudflareEnv> {
  async fetch(request: Request) {
    const r2 = this.env.R2
    // ...
  }
}
```

## Extends

- [`DurableObjectBindings`](DurableObjectBindings.md).[`StorageBindings`](StorageBindings.md).[`AIBindings`](AIBindings.md).[`MessagingBindings`](MessagingBindings.md).[`AdvancedBindings`](AdvancedBindings.md).[`SecretBindings`](SecretBindings.md)

## Indexable

\[`key`: `string`\]: `unknown`

Index signature for additional custom bindings
Allows type-safe access to environment variables and custom bindings

## Properties

### AGENT?

> `optional` **AGENT**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:47](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L47)

Agent Durable Object namespace for AI agents

#### Inherited from

[`DurableObjectBindings`](DurableObjectBindings.md).[`AGENT`](DurableObjectBindings.md#agent)

***

### AI?

> `optional` **AI**: `Ai`\<`AiModels`\>

Defined in: [types/CloudflareBindings.ts:198](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L198)

Workers AI binding for inference

Supports models:
- Text: @cf/meta/llama-3.1-70b-instruct, @cf/meta/llama-3.1-8b-instruct
- Embeddings: @cf/baai/bge-base-en-v1.5
- Images: @cf/black-forest-labs/flux-1-schnell
- Speech: @cf/openai/whisper

#### See

https://developers.cloudflare.com/workers-ai/

#### Inherited from

[`AIBindings`](AIBindings.md).[`AI`](AIBindings.md#ai)

***

### AI\_GATEWAY?

> `optional` **AI\_GATEWAY**: `object`

Defined in: [types/CloudflareBindings.ts:216](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L216)

AI Gateway binding for unified AI access

Provides routing, caching, and observability for AI requests.

#### See

https://developers.cloudflare.com/ai-gateway/

#### Inherited from

[`AIBindings`](AIBindings.md).[`AI_GATEWAY`](AIBindings.md#ai_gateway)

***

### ANALYTICS?

> `optional` **ANALYTICS**: `AnalyticsEngineDataset`

Defined in: [types/CloudflareBindings.ts:367](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L367)

Analytics Engine dataset binding

#### See

https://developers.cloudflare.com/analytics/analytics-engine/

#### Inherited from

[`AdvancedBindings`](AdvancedBindings.md).[`ANALYTICS`](AdvancedBindings.md#analytics)

***

### ANALYTICS\_DB?

> `optional` **ANALYTICS\_DB**: `D1Database`

Defined in: [types/CloudflareBindings.ts:168](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L168)

Analytics D1 database for read-heavy queries

#### Inherited from

[`StorageBindings`](StorageBindings.md).[`ANALYTICS_DB`](StorageBindings.md#analytics_db)

***

### ARCHIVES?

> `optional` **ARCHIVES**: `R2Bucket`

Defined in: [types/CloudflareBindings.ts:145](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L145)

Archives R2 bucket for historical data

#### Inherited from

[`StorageBindings`](StorageBindings.md).[`ARCHIVES`](StorageBindings.md#archives)

***

### ASSETS?

> `optional` **ASSETS**: `object`

Defined in: [types/CloudflareBindings.ts:353](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L353)

Static assets fetcher

#### Inherited from

[`AdvancedBindings`](AdvancedBindings.md).[`ASSETS`](AdvancedBindings.md#assets)

***

### BROWSER?

> `optional` **BROWSER**: `object`

Defined in: [types/CloudflareBindings.ts:343](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L343)

Browser Rendering API binding

#### See

https://developers.cloudflare.com/browser-rendering/

#### Inherited from

[`AdvancedBindings`](AdvancedBindings.md).[`BROWSER`](AdvancedBindings.md#browser)

***

### BROWSER\_DO?

> `optional` **BROWSER\_DO**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:37](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L37)

Browser automation Durable Object namespace

#### See

Browser

#### Inherited from

[`DurableObjectBindings`](DurableObjectBindings.md).[`BROWSER_DO`](DurableObjectBindings.md#browser_do)

***

### BROWSERBASE\_API\_KEY?

> `optional` **BROWSERBASE\_API\_KEY**: `string`

Defined in: [types/CloudflareBindings.ts:408](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L408)

Browserbase API key for browser automation

#### Inherited from

[`SecretBindings`](SecretBindings.md).[`BROWSERBASE_API_KEY`](SecretBindings.md#browserbase_api_key)

***

### BROWSERBASE\_PROJECT\_ID?

> `optional` **BROWSERBASE\_PROJECT\_ID**: `string`

Defined in: [types/CloudflareBindings.ts:413](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L413)

Browserbase project ID

#### Inherited from

[`SecretBindings`](SecretBindings.md).[`BROWSERBASE_PROJECT_ID`](SecretBindings.md#browserbase_project_id)

***

### CACHE?

> `optional` **CACHE**: `KVNamespace`\<`string`\>

Defined in: [types/CloudflareBindings.ts:126](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L126)

Cache KV namespace for expensive computations

#### Inherited from

[`StorageBindings`](StorageBindings.md).[`CACHE`](StorageBindings.md#cache)

***

### DB?

> `optional` **DB**: `D1Database`

Defined in: [types/CloudflareBindings.ts:163](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L163)

Primary D1 database for global data

#### Inherited from

[`StorageBindings`](StorageBindings.md).[`DB`](StorageBindings.md#db)

***

### ~~DLQ?~~

> `optional` **DLQ**: `Queue`\<`unknown`\>

Defined in: [types/CloudflareBindings.ts:272](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L272)

#### Deprecated

Use DLQ_QUEUE instead
Legacy binding for backward compatibility

#### Inherited from

[`MessagingBindings`](MessagingBindings.md).[`DLQ`](MessagingBindings.md#dlq)

***

### DLQ\_QUEUE?

> `optional` **DLQ\_QUEUE**: `Queue`\<`unknown`\>

Defined in: [types/CloudflareBindings.ts:260](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L260)

Dead letter queue for failed messages
Queue: dotdo-dlq

#### Inherited from

[`MessagingBindings`](MessagingBindings.md).[`DLQ_QUEUE`](MessagingBindings.md#dlq_queue)

***

### DO?

> `optional` **DO**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:31](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L31)

Main Durable Object namespace for Things

#### See

ThingsDO

#### Inherited from

[`DurableObjectBindings`](DurableObjectBindings.md).[`DO`](DurableObjectBindings.md#do)

***

### EVENTS\_QUEUE?

> `optional` **EVENTS\_QUEUE**: `Queue`\<`unknown`\>

Defined in: [types/CloudflareBindings.ts:242](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L242)

Events queue for domain event delivery
Queue: dotdo-events

#### Inherited from

[`MessagingBindings`](MessagingBindings.md).[`EVENTS_QUEUE`](MessagingBindings.md#events_queue)

***

### HYPERDRIVE?

> `optional` **HYPERDRIVE**: `Hyperdrive`

Defined in: [types/CloudflareBindings.ts:317](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L317)

Hyperdrive connection to external database

#### See

https://developers.cloudflare.com/hyperdrive/

#### Inherited from

[`AdvancedBindings`](AdvancedBindings.md).[`HYPERDRIVE`](AdvancedBindings.md#hyperdrive)

***

### ICEBERG\_METADATA?

> `optional` **ICEBERG\_METADATA**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:87](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L87)

Iceberg Metadata Durable Object namespace for partition planning

#### See

IcebergMetadataDO

#### Inherited from

[`DurableObjectBindings`](DurableObjectBindings.md).[`ICEBERG_METADATA`](DurableObjectBindings.md#iceberg_metadata)

***

### IDENTITY\_DO?

> `optional` **IDENTITY\_DO**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:70](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L70)

Identity Durable Object namespace (id.org.ai)

#### Inherited from

[`DurableObjectBindings`](DurableObjectBindings.md).[`IDENTITY_DO`](DurableObjectBindings.md#identity_do)

***

### INTEGRATIONS\_DO?

> `optional` **INTEGRATIONS\_DO**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:59](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L59)

Integrations Durable Object namespace for OAuth and webhooks

#### See

IntegrationsDO

#### Inherited from

[`DurableObjectBindings`](DurableObjectBindings.md).[`INTEGRATIONS_DO`](DurableObjectBindings.md#integrations_do)

***

### JOBS\_QUEUE?

> `optional` **JOBS\_QUEUE**: `Queue`\<`unknown`\>

Defined in: [types/CloudflareBindings.ts:248](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L248)

Jobs queue for background task processing
Queue: dotdo-jobs

#### Inherited from

[`MessagingBindings`](MessagingBindings.md).[`JOBS_QUEUE`](MessagingBindings.md#jobs_queue)

***

### KV?

> `optional` **KV**: `KVNamespace`\<`string`\>

Defined in: [types/CloudflareBindings.ts:116](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L116)

Primary KV namespace for application data
Used for sessions, API key caching, rate limit state

#### Inherited from

[`StorageBindings`](StorageBindings.md).[`KV`](StorageBindings.md#kv)

***

### OBS\_BROADCASTER?

> `optional` **OBS\_BROADCASTER**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:98](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L98)

Observability Broadcaster Durable Object namespace

#### Inherited from

[`DurableObjectBindings`](DurableObjectBindings.md).[`OBS_BROADCASTER`](DurableObjectBindings.md#obs_broadcaster)

***

### PAYMENTS\_DO?

> `optional` **PAYMENTS\_DO**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:75](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L75)

Payments Durable Object namespace (payments.do)

#### Inherited from

[`DurableObjectBindings`](DurableObjectBindings.md).[`PAYMENTS_DO`](DurableObjectBindings.md#payments_do)

***

### PIPELINE?

> `optional` **PIPELINE**: [`Pipeline`](Pipeline.md)

Defined in: [types/CloudflareBindings.ts:282](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L282)

Primary pipeline for event streaming

#### Inherited from

[`MessagingBindings`](MessagingBindings.md).[`PIPELINE`](MessagingBindings.md#pipeline)

***

### PLATFORM\_FEE\_PERCENT?

> `optional` **PLATFORM\_FEE\_PERCENT**: `string`

Defined in: [types/CloudflareBindings.ts:403](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L403)

Platform fee percentage for payments

#### Inherited from

[`SecretBindings`](SecretBindings.md).[`PLATFORM_FEE_PERCENT`](SecretBindings.md#platform_fee_percent)

***

### ~~QUEUE?~~

> `optional` **QUEUE**: `Queue`\<`unknown`\>

Defined in: [types/CloudflareBindings.ts:266](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L266)

#### Deprecated

Use EVENTS_QUEUE instead
Legacy binding for backward compatibility

#### Inherited from

[`MessagingBindings`](MessagingBindings.md).[`QUEUE`](MessagingBindings.md#queue)

***

### R2?

> `optional` **R2**: `R2Bucket`

Defined in: [types/CloudflareBindings.ts:140](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L140)

Primary R2 bucket for application data
Used for compact() archives, file uploads, Iceberg tables

#### Inherited from

[`StorageBindings`](StorageBindings.md).[`R2`](StorageBindings.md#r2)

***

### RATE\_LIMIT?

> `optional` **RATE\_LIMIT**: `RateLimit`

Defined in: [types/CloudflareBindings.ts:329](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L329)

Rate limiter binding

#### Inherited from

[`AdvancedBindings`](AdvancedBindings.md).[`RATE_LIMIT`](AdvancedBindings.md#rate_limit)

***

### SANDBOX\_DO?

> `optional` **SANDBOX\_DO**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:65](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L65)

Sandbox Durable Object namespace for code execution

#### See

SandboxDO

#### Inherited from

[`DurableObjectBindings`](DurableObjectBindings.md).[`SANDBOX_DO`](DurableObjectBindings.md#sandbox_do)

***

### STRIPE\_SECRET\_KEY?

> `optional` **STRIPE\_SECRET\_KEY**: `string`

Defined in: [types/CloudflareBindings.ts:393](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L393)

Stripe secret key for payments

#### Inherited from

[`SecretBindings`](SecretBindings.md).[`STRIPE_SECRET_KEY`](SecretBindings.md#stripe_secret_key)

***

### STRIPE\_WEBHOOK\_SECRET?

> `optional` **STRIPE\_WEBHOOK\_SECRET**: `string`

Defined in: [types/CloudflareBindings.ts:398](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L398)

Stripe webhook secret for verification

#### Inherited from

[`SecretBindings`](SecretBindings.md).[`STRIPE_WEBHOOK_SECRET`](SecretBindings.md#stripe_webhook_secret)

***

### TEST\_DO?

> `optional` **TEST\_DO**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:42](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L42)

Test Durable Object namespace (dev/test only)

#### Inherited from

[`DurableObjectBindings`](DurableObjectBindings.md).[`TEST_DO`](DurableObjectBindings.md#test_do)

***

### TEST\_KV?

> `optional` **TEST\_KV**: `KVNamespace`\<`string`\>

Defined in: [types/CloudflareBindings.ts:121](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L121)

Test KV namespace (dev/test only)

#### Inherited from

[`StorageBindings`](StorageBindings.md).[`TEST_KV`](StorageBindings.md#test_kv)

***

### UPLOADS?

> `optional` **UPLOADS**: `R2Bucket`

Defined in: [types/CloudflareBindings.ts:150](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L150)

Uploads R2 bucket for user file uploads

#### Inherited from

[`StorageBindings`](StorageBindings.md).[`UPLOADS`](StorageBindings.md#uploads)

***

### VECTOR\_SHARD?

> `optional` **VECTOR\_SHARD**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:93](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L93)

Vector Shard Durable Object namespace for similarity search

#### See

VectorShardDO

#### Inherited from

[`DurableObjectBindings`](DurableObjectBindings.md).[`VECTOR_SHARD`](DurableObjectBindings.md#vector_shard)

***

### VECTORS?

> `optional` **VECTORS**: `VectorizeIndex`

Defined in: [types/CloudflareBindings.ts:207](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L207)

Vectorize index for semantic search

Provides vector similarity search for embeddings.

#### See

https://developers.cloudflare.com/vectorize/

#### Inherited from

[`AIBindings`](AIBindings.md).[`VECTORS`](AIBindings.md#vectors)

***

### WEBHOOKS\_QUEUE?

> `optional` **WEBHOOKS\_QUEUE**: `Queue`\<`unknown`\>

Defined in: [types/CloudflareBindings.ts:254](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L254)

Webhooks queue for external delivery
Queue: dotdo-webhooks

#### Inherited from

[`MessagingBindings`](MessagingBindings.md).[`WEBHOOKS_QUEUE`](MessagingBindings.md#webhooks_queue)

***

### ~~WORKFLOW?~~

> `optional` **WORKFLOW**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:81](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L81)

Legacy: Workflow binding (deprecated, use WORKFLOW_DO)

#### Deprecated

Use WORKFLOW_DO instead

#### Inherited from

[`DurableObjectBindings`](DurableObjectBindings.md).[`WORKFLOW`](DurableObjectBindings.md#workflow)

***

### WORKFLOW\_DO?

> `optional` **WORKFLOW\_DO**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:53](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L53)

Workflow Durable Object namespace for durable execution

#### See

Workflow

#### Inherited from

[`DurableObjectBindings`](DurableObjectBindings.md).[`WORKFLOW_DO`](DurableObjectBindings.md#workflow_do)
