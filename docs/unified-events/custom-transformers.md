# Custom Transformer Guide

This guide covers how to create custom transformers for the Unified Event system. Transformers convert source-specific event formats into the standardized 165-column `UnifiedEvent` schema.

## Overview

Transformers are pure functions that:
1. Accept a source-specific input format
2. Return one or more `UnifiedEvent` objects
3. Map source fields to the appropriate semantic groups in the unified schema

## Transformer Pattern

### Function Signature

Every transformer follows this pattern:

```typescript
import { createUnifiedEvent } from '../../../types/unified-event'
import type { UnifiedEvent } from '../../../types/unified-event'

export function transformMyEvent(
  input: MyEventInput,
  context?: MyContext
): UnifiedEvent {
  return createUnifiedEvent({
    // Required CoreIdentity fields
    id: generateId(),
    event_type: 'track', // or 'trace', 'metric', 'log', 'cdc', etc.
    event_name: input.eventName,
    ns: context ?? 'default',

    // Map other fields to appropriate semantic groups...
  })
}
```

### Input Format

Define a clear TypeScript interface for your input:

```typescript
/**
 * Input type for your custom events.
 * Document all fields clearly.
 */
export interface MyEventInput {
  /** Event name/action */
  eventName: string
  /** User identifier */
  userId?: string
  /** Event payload */
  data?: Record<string, unknown>
  /** When the event occurred */
  timestamp?: Date | string
}
```

### Output: UnifiedEvent

The output must be a complete `UnifiedEvent` with all 165 columns. The `createUnifiedEvent()` factory function handles this - you provide the fields you care about, and it fills in `null` for everything else.

**Required fields (CoreIdentity):**
- `id` - Unique event identifier (UUID)
- `event_type` - One of: `trace`, `metric`, `log`, `cdc`, `track`, `page`, `vital`, `replay`, `tail`, `snippet`
- `event_name` - Semantic event name (e.g., `user.signup`, `order.completed`)
- `ns` - Namespace identifying the event source

### Pure Function Requirements

Transformers must be **pure functions**:

1. **Deterministic** - Same input always produces same output (except for generated IDs)
2. **No side effects** - No I/O, no mutations, no global state
3. **Stateless** - Each call is independent
4. **Synchronous** - No async operations

```typescript
// GOOD: Pure transformer
export function transformMyEvent(input: MyInput, ns: string): UnifiedEvent {
  return createUnifiedEvent({
    id: crypto.randomUUID(),
    event_type: 'track',
    event_name: input.action,
    ns,
    actor_id: input.userId ?? null,
    timestamp: input.timestamp?.toISOString() ?? null,
  })
}

// BAD: Impure - makes API calls
export async function transformMyEvent(input: MyInput): Promise<UnifiedEvent> {
  const user = await fetchUser(input.userId) // DON'T DO THIS
  // ...
}

// BAD: Impure - mutates input
export function transformMyEvent(input: MyInput): UnifiedEvent {
  input.processed = true // DON'T DO THIS
  // ...
}
```

## Using Shared Utilities

The `db/streams/transformers/shared/` directory contains utility functions for common transformations. Always use these instead of reimplementing.

### extractGeoFromCf()

Extracts geographic information from Cloudflare CF properties:

```typescript
import { extractGeoFromCf, type CfGeoProperties } from './shared'

// Input: Cloudflare CF properties
const cf: CfGeoProperties = {
  colo: 'SJC',
  country: 'US',
  city: 'San Jose',
  region: 'CA',
  timezone: 'America/Los_Angeles',
  asn: 13335,
  asOrganization: 'Cloudflare',
  latitude: '37.3382',
  longitude: '-121.8863',
  postalCode: '95113',
}

// Output: Unified geo fields
const geoFields = extractGeoFromCf(cf)
// {
//   geo_colo: 'SJC',
//   geo_country: 'US',
//   geo_city: 'San Jose',
//   geo_region: 'CA',
//   geo_timezone: 'America/Los_Angeles',
//   geo_asn: 13335,
//   geo_as_org: 'Cloudflare',
//   geo_latitude: 37.3382,
//   geo_longitude: -121.8863,
//   geo_postal: '95113',
// }

// Use in transformer:
return createUnifiedEvent({
  // ... core fields ...
  ...extractGeoFromCf(request.cf),
})
```

### extractHttpContext()

Extracts HTTP request/response context:

```typescript
import { extractHttpContext, type HttpRequest, type HttpResponse } from './shared'

const request: HttpRequest = {
  url: 'https://api.example.com/users?page=1',
  method: 'GET',
  headers: {
    'user-agent': 'Mozilla/5.0...',
    'referer': 'https://example.com/',
    'content-type': 'application/json',
  },
}

const response: HttpResponse = {
  status: 200,
}

const httpFields = extractHttpContext(request, response, 'HTTP/2')
// {
//   http_method: 'GET',
//   http_url: 'https://api.example.com/users?page=1',
//   http_host: 'api.example.com',
//   http_path: '/users',
//   http_query: '?page=1',
//   http_status: 200,
//   http_protocol: 'HTTP/2',
//   http_referrer: 'https://example.com/',
//   http_user_agent: 'Mozilla/5.0...',
//   http_content_type: 'application/json',
// }
```

### deriveOutcome()

Maps status codes and outcomes to unified outcome values:

```typescript
import {
  outcomeFromHttpStatus,
  mapTailOutcome,
  isFailureOutcome,
  type UnifiedOutcome
} from './shared'

// From HTTP status codes
outcomeFromHttpStatus(200)  // 'success'
outcomeFromHttpStatus(404)  // 'error'
outcomeFromHttpStatus(429)  // 'rate_limited'
outcomeFromHttpStatus(504)  // 'timeout'

// From Workers tail outcomes
mapTailOutcome('ok')           // 'success'
mapTailOutcome('exception')    // 'error'
mapTailOutcome('exceededCpu')  // 'exceeded_cpu'
mapTailOutcome('canceled')     // 'canceled'

// Check if outcome is a failure
isFailureOutcome('success')  // false
isFailureOutcome('error')    // true
```

### Additional Shared Utilities

```typescript
// Empty field helpers for when source data is missing
import { emptyGeoFields, emptyHttpFields } from './shared'

// Use when no CF data available
const geoFields = cf ? extractGeoFromCf(cf) : emptyGeoFields()
```

## Example: Creating a Custom Transformer

Let's walk through creating a transformer for a hypothetical webhook event source.

### Step 1: Define the Input Type

```typescript
// db/streams/transformers/webhook.ts

/**
 * Webhook Event Transformer
 *
 * Transforms incoming webhook events to the unified event schema.
 *
 * @module db/streams/transformers/webhook
 */

import { createUnifiedEvent } from '../../../types/unified-event'
import type { UnifiedEvent } from '../../../types/unified-event'
import { extractGeoFromCf, type CfGeoProperties } from './shared'

// ============================================================================
// Input Types
// ============================================================================

/**
 * Webhook event input format.
 * Represents a generic incoming webhook payload.
 */
export interface WebhookEvent {
  /** Unique webhook delivery ID */
  deliveryId: string
  /** Webhook event type (e.g., 'payment.completed') */
  eventType: string
  /** Source system identifier (e.g., 'stripe', 'github') */
  source: string
  /** Event payload data */
  payload: Record<string, unknown>
  /** Timestamp when event was created at source */
  createdAt: string
  /** Optional signature for verification */
  signature?: string
}

/**
 * Context passed to the transformer.
 */
export interface WebhookContext {
  /** Namespace for the event */
  ns: string
  /** Cloudflare CF properties from request */
  cf?: CfGeoProperties
  /** Request headers */
  headers?: Record<string, string>
}
```

### Step 2: Implement the Transformer

```typescript
// ============================================================================
// Main Transformer
// ============================================================================

/**
 * Transforms a webhook event to a UnifiedEvent.
 *
 * @param event - The webhook event to transform
 * @param context - Transform context with namespace and request info
 * @returns A UnifiedEvent with all fields populated
 *
 * @example
 * ```typescript
 * const webhook = {
 *   deliveryId: 'wh_123abc',
 *   eventType: 'payment.completed',
 *   source: 'stripe',
 *   payload: { amount: 9999, currency: 'usd' },
 *   createdAt: '2024-01-15T10:30:00Z',
 * }
 *
 * const event = transformWebhook(webhook, { ns: 'https://app.example.com' })
 * ```
 */
export function transformWebhook(
  event: WebhookEvent,
  context: WebhookContext
): UnifiedEvent {
  // Generate unique event ID
  const id = crypto.randomUUID()

  // Parse timestamp
  const timestamp = new Date(event.createdAt).toISOString()

  // Extract geo if available
  const geoFields = context.cf ? extractGeoFromCf(context.cf) : {}

  return createUnifiedEvent({
    // CoreIdentity (required)
    id,
    event_type: 'track',
    event_name: event.eventType,
    ns: context.ns,

    // CausalityChain
    correlation_id: event.deliveryId,

    // Actor
    actor_type: 'webhook',
    actor_name: event.source,

    // Timing
    timestamp,

    // FlexiblePayloads
    data: event.payload,

    // GeoLocation (spread from shared utility)
    ...geoFields,

    // PartitionInternal
    event_source: event.source,
  })
}
```

### Step 3: Add Batch Transform Support (Optional)

```typescript
/**
 * Batch transforms multiple webhook events.
 *
 * @param events - Array of webhook events
 * @param context - Shared transform context
 * @returns Array of UnifiedEvents
 */
export function transformWebhooks(
  events: WebhookEvent[],
  context: WebhookContext
): UnifiedEvent[] {
  return events.map(event => transformWebhook(event, context))
}
```

### Step 4: Export from Index

Add your transformer to `db/streams/transformers/index.ts`:

```typescript
// Webhook transformer
export {
  transformWebhook,
  transformWebhooks,
  type WebhookEvent,
  type WebhookContext,
} from './webhook'
```

## Testing Transformers

### Test File Structure

Create tests at `db/streams/transformers/tests/webhook.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import type { UnifiedEvent } from '../../../../types/unified-event'

// ============================================================================
// Types (mirror the expected interface)
// ============================================================================

interface WebhookEvent {
  deliveryId: string
  eventType: string
  source: string
  payload: Record<string, unknown>
  createdAt: string
  signature?: string
}

interface WebhookContext {
  ns: string
  cf?: Record<string, unknown>
}

// ============================================================================
// Dynamic Import for RED Phase TDD
// ============================================================================

let transformWebhook: ((event: WebhookEvent, ctx: WebhookContext) => UnifiedEvent) | undefined

beforeAll(async () => {
  try {
    const module = await import('../webhook')
    transformWebhook = module.transformWebhook
  } catch {
    // Module doesn't exist yet - tests will fail with clear messages
  }
})

// ============================================================================
// Tests
// ============================================================================

describe('Webhook Transformer', () => {
  describe('exports', () => {
    it('exports transformWebhook function', () => {
      expect(transformWebhook).toBeDefined()
      expect(typeof transformWebhook).toBe('function')
    })
  })

  describe('CoreIdentity mapping', () => {
    it('generates unique id', () => {
      expect(transformWebhook).toBeDefined()

      const event: WebhookEvent = {
        deliveryId: 'wh_123',
        eventType: 'test.event',
        source: 'test',
        payload: {},
        createdAt: '2024-01-15T10:00:00Z',
      }

      const result = transformWebhook!(event, { ns: 'https://test.ns' })

      expect(result.id).toBeDefined()
      expect(typeof result.id).toBe('string')
      expect(result.id.length).toBeGreaterThan(0)
    })

    it('sets event_type to track', () => {
      expect(transformWebhook).toBeDefined()

      const event: WebhookEvent = {
        deliveryId: 'wh_123',
        eventType: 'payment.completed',
        source: 'stripe',
        payload: {},
        createdAt: '2024-01-15T10:00:00Z',
      }

      const result = transformWebhook!(event, { ns: 'https://test.ns' })

      expect(result.event_type).toBe('track')
    })

    it('maps eventType to event_name', () => {
      expect(transformWebhook).toBeDefined()

      const event: WebhookEvent = {
        deliveryId: 'wh_123',
        eventType: 'order.shipped',
        source: 'shopify',
        payload: {},
        createdAt: '2024-01-15T10:00:00Z',
      }

      const result = transformWebhook!(event, { ns: 'https://test.ns' })

      expect(result.event_name).toBe('order.shipped')
    })

    it('sets ns from context', () => {
      expect(transformWebhook).toBeDefined()

      const event: WebhookEvent = {
        deliveryId: 'wh_123',
        eventType: 'test.event',
        source: 'test',
        payload: {},
        createdAt: '2024-01-15T10:00:00Z',
      }

      const result = transformWebhook!(event, { ns: 'https://my-app.example.com' })

      expect(result.ns).toBe('https://my-app.example.com')
    })
  })

  describe('CausalityChain mapping', () => {
    it('maps deliveryId to correlation_id', () => {
      expect(transformWebhook).toBeDefined()

      const event: WebhookEvent = {
        deliveryId: 'wh_abc123xyz',
        eventType: 'test.event',
        source: 'test',
        payload: {},
        createdAt: '2024-01-15T10:00:00Z',
      }

      const result = transformWebhook!(event, { ns: 'https://test.ns' })

      expect(result.correlation_id).toBe('wh_abc123xyz')
    })
  })

  describe('Actor mapping', () => {
    it('sets actor_type to webhook', () => {
      expect(transformWebhook).toBeDefined()

      const event: WebhookEvent = {
        deliveryId: 'wh_123',
        eventType: 'test.event',
        source: 'github',
        payload: {},
        createdAt: '2024-01-15T10:00:00Z',
      }

      const result = transformWebhook!(event, { ns: 'https://test.ns' })

      expect(result.actor_type).toBe('webhook')
    })

    it('maps source to actor_name', () => {
      expect(transformWebhook).toBeDefined()

      const event: WebhookEvent = {
        deliveryId: 'wh_123',
        eventType: 'test.event',
        source: 'stripe',
        payload: {},
        createdAt: '2024-01-15T10:00:00Z',
      }

      const result = transformWebhook!(event, { ns: 'https://test.ns' })

      expect(result.actor_name).toBe('stripe')
    })
  })

  describe('Timing mapping', () => {
    it('maps createdAt to timestamp', () => {
      expect(transformWebhook).toBeDefined()

      const event: WebhookEvent = {
        deliveryId: 'wh_123',
        eventType: 'test.event',
        source: 'test',
        payload: {},
        createdAt: '2024-01-15T10:30:45.123Z',
      }

      const result = transformWebhook!(event, { ns: 'https://test.ns' })

      expect(result.timestamp).toBe('2024-01-15T10:30:45.123Z')
    })
  })

  describe('Payload mapping', () => {
    it('maps payload to data', () => {
      expect(transformWebhook).toBeDefined()

      const event: WebhookEvent = {
        deliveryId: 'wh_123',
        eventType: 'payment.completed',
        source: 'stripe',
        payload: {
          amount: 9999,
          currency: 'usd',
          customer_id: 'cus_abc123',
        },
        createdAt: '2024-01-15T10:00:00Z',
      }

      const result = transformWebhook!(event, { ns: 'https://test.ns' })

      expect(result.data).toEqual({
        amount: 9999,
        currency: 'usd',
        customer_id: 'cus_abc123',
      })
    })

    it('handles empty payload', () => {
      expect(transformWebhook).toBeDefined()

      const event: WebhookEvent = {
        deliveryId: 'wh_123',
        eventType: 'ping',
        source: 'test',
        payload: {},
        createdAt: '2024-01-15T10:00:00Z',
      }

      const result = transformWebhook!(event, { ns: 'https://test.ns' })

      expect(result.data).toEqual({})
    })
  })

  describe('event_source mapping', () => {
    it('maps source to event_source', () => {
      expect(transformWebhook).toBeDefined()

      const event: WebhookEvent = {
        deliveryId: 'wh_123',
        eventType: 'test.event',
        source: 'github',
        payload: {},
        createdAt: '2024-01-15T10:00:00Z',
      }

      const result = transformWebhook!(event, { ns: 'https://test.ns' })

      expect(result.event_source).toBe('github')
    })
  })
})

describe('Edge Cases', () => {
  it('generates unique ids for each call', () => {
    expect(transformWebhook).toBeDefined()

    const event: WebhookEvent = {
      deliveryId: 'wh_123',
      eventType: 'test.event',
      source: 'test',
      payload: {},
      createdAt: '2024-01-15T10:00:00Z',
    }

    const result1 = transformWebhook!(event, { ns: 'https://test.ns' })
    const result2 = transformWebhook!(event, { ns: 'https://test.ns' })

    expect(result1.id).not.toBe(result2.id)
  })

  it('handles complex nested payloads', () => {
    expect(transformWebhook).toBeDefined()

    const event: WebhookEvent = {
      deliveryId: 'wh_123',
      eventType: 'order.completed',
      source: 'shopify',
      payload: {
        order: {
          id: 'ord_123',
          items: [
            { sku: 'SKU-001', quantity: 2 },
            { sku: 'SKU-002', quantity: 1 },
          ],
          totals: {
            subtotal: 10000,
            tax: 800,
            total: 10800,
          },
        },
      },
      createdAt: '2024-01-15T10:00:00Z',
    }

    const result = transformWebhook!(event, { ns: 'https://test.ns' })

    expect(result.data).toEqual(event.payload)
  })
})

describe('Complete Event Transformation', () => {
  it('transforms complete webhook to UnifiedEvent', () => {
    expect(transformWebhook).toBeDefined()

    const event: WebhookEvent = {
      deliveryId: 'wh_complete_test',
      eventType: 'subscription.renewed',
      source: 'stripe',
      payload: {
        subscription_id: 'sub_abc123',
        plan: 'pro',
        amount: 4999,
      },
      createdAt: '2024-01-15T14:30:00.000Z',
    }

    const result = transformWebhook!(event, { ns: 'https://billing.example.com' })

    // Verify all expected fields
    expect(result.id).toBeDefined()
    expect(result.event_type).toBe('track')
    expect(result.event_name).toBe('subscription.renewed')
    expect(result.ns).toBe('https://billing.example.com')
    expect(result.correlation_id).toBe('wh_complete_test')
    expect(result.actor_type).toBe('webhook')
    expect(result.actor_name).toBe('stripe')
    expect(result.timestamp).toBe('2024-01-15T14:30:00.000Z')
    expect(result.data).toEqual({
      subscription_id: 'sub_abc123',
      plan: 'pro',
      amount: 4999,
    })
    expect(result.event_source).toBe('stripe')

    // Verify optional fields are null
    expect(result.trace_id).toBeNull()
    expect(result.span_id).toBeNull()
    expect(result.actor_id).toBeNull()
    expect(result.http_method).toBeNull()
  })
})
```

### Common Test Assertions

Test these categories for every transformer:

1. **Export verification** - Function is exported correctly
2. **CoreIdentity** - `id`, `event_type`, `event_name`, `ns` are set correctly
3. **Field mappings** - Each source field maps to the right unified field
4. **Null handling** - Optional fields are `null` when not provided
5. **Edge cases** - Empty inputs, special characters, very large payloads
6. **Complete transformation** - Full end-to-end test with all fields

### Running Tests

```bash
# Run transformer tests
npx vitest run db/streams/transformers/tests/webhook.test.ts

# Run all transformer tests
npx vitest run db/streams/transformers/tests/

# Watch mode during development
npx vitest db/streams/transformers/tests/webhook.test.ts
```

## Registering Transformers

### Adding to the Registry

Register your transformer in `db/streams/transformers/registry.ts`:

```typescript
// Import your transformer
import { transformWebhook, type WebhookEvent, type WebhookContext } from './webhook'

// Register with metadata
registry.register<WebhookEvent, WebhookContext>(
  'webhook',  // Unique transformer name
  transformWebhook,
  {
    name: 'Webhook Events',
    description: 'Transforms generic webhook events to UnifiedEvent',
    source: 'webhook',
    eventType: 'track',
    multipleOutputs: false,
  }
)
```

### Transformer Metadata

The `TransformerMeta` interface requires:

```typescript
interface TransformerMeta {
  /** Human-readable name */
  name: string
  /** Description of what the transformer does */
  description: string
  /** Event source system (e.g., 'otel', 'segment', 'webhook') */
  source: string
  /** Target event_type in UnifiedEvent */
  eventType: string
  /** Whether the transformer can return multiple events */
  multipleOutputs: boolean
}
```

### Using the Registry

Once registered, transformers can be invoked dynamically:

```typescript
import { registry } from 'db/streams/transformers'

// Transform using registry
const event = registry.transform('webhook', webhookPayload, context)

// Check if transformer exists
if (registry.has('webhook')) {
  // ...
}

// List all transformers
const names = registry.list() // ['otel-span', 'segment-track', 'webhook', ...]

// List by source
const otelTransformers = registry.listBySource('otel') // ['otel-span', 'otel-log', 'otel-metric']

// Transform to array (useful for transformers that return multiple events)
const events = registry.transformToArray('otel-metric', metricData, resource)
```

### Auto-Discovery Pattern

For larger codebases, you can implement auto-discovery by using a naming convention:

```typescript
// Each transformer file exports a standard registration object
export const registration = {
  name: 'webhook',
  transformer: transformWebhook,
  meta: {
    name: 'Webhook Events',
    description: 'Transforms generic webhook events',
    source: 'webhook',
    eventType: 'track',
    multipleOutputs: false,
  },
}
```

## Best Practices

### 1. Use Semantic Event Names

Choose event names that clearly describe the action:

```typescript
// GOOD: Semantic, descriptive
event_name: 'user.signup'
event_name: 'order.completed'
event_name: 'payment.failed'

// BAD: Generic, unclear
event_name: 'event1'
event_name: 'data'
event_name: 'webhook'
```

### 2. Preserve Original Data

Store the full original payload in `data` or `properties`:

```typescript
return createUnifiedEvent({
  // ... mapped fields ...

  // Preserve full payload for debugging/analysis
  data: input.payload,
})
```

### 3. Handle Missing Fields Gracefully

Use nullish coalescing to handle missing data:

```typescript
return createUnifiedEvent({
  actor_id: input.userId ?? null,
  timestamp: input.timestamp ? new Date(input.timestamp).toISOString() : null,
})
```

### 4. Document Field Mappings

Add a module docstring documenting all field mappings:

```typescript
/**
 * Webhook Event Transformer
 *
 * Field mappings:
 * - deliveryId -> correlation_id
 * - eventType -> event_name
 * - source -> actor_name, event_source
 * - payload -> data
 * - createdAt -> timestamp
 *
 * @module db/streams/transformers/webhook
 */
```

### 5. Validate Critical Fields

Add runtime validation for critical fields:

```typescript
export function transformWebhook(event: WebhookEvent, context: WebhookContext): UnifiedEvent {
  if (!event.eventType) {
    throw new Error('eventType is required')
  }
  if (!context.ns) {
    throw new Error('namespace (ns) is required in context')
  }

  // ... transformation logic
}
```

## Reference

### Available Semantic Groups

The UnifiedEvent schema has 23 semantic groups:

| Group | Fields | Purpose |
|-------|--------|---------|
| CoreIdentity | 4 | Required event identification |
| CausalityChain | 11 | Distributed tracing context |
| Actor | 4 | Who triggered the event |
| Resource | 5 | What was acted upon |
| Timing | 6 | When things happened |
| Outcome | 6 | Success/failure status |
| HttpContext | 12 | HTTP request/response details |
| GeoLocation | 10 | Geographic information |
| ClientDevice | 11 | Browser/device info |
| ServiceInfra | 13 | Service deployment context |
| DatabaseCdc | 10 | Database change capture |
| MessagingQueue | 5 | Message broker operations |
| Rpc | 4 | RPC call details |
| WebMarketing | 10 | UTM/campaign tracking |
| WebVitals | 7 | Performance metrics |
| SessionReplay | 5 | Session replay data |
| OtelMetrics | 10 | OpenTelemetry metrics |
| Logging | 4 | Structured logging |
| DoSpecific | 7 | Durable Object context |
| BusinessEpcis | 5 | Business process tracking |
| SnippetProxy | 13 | Browser timing data |
| FlexiblePayloads | 6 | Custom JSON data |
| PartitionInternal | 7 | Internal metadata |

### Related Files

- `/types/unified-event.ts` - Full schema definition
- `/db/streams/transformers/shared/` - Shared utilities
- `/db/streams/transformers/registry.ts` - Transformer registry
- `/db/streams/transformers/tests/` - Test examples
- `/db/streams/transformers/index.ts` - All transformer exports
