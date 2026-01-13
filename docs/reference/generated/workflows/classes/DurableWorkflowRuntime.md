[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / DurableWorkflowRuntime

# Class: DurableWorkflowRuntime

Defined in: [workflows/runtime.ts:299](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L299)

Workflow Runtime with durable execution capabilities.

Implements the WorkflowRuntime interface with full support for
step persistence, replay, and configurable retry policies.

## Examples

```typescript
const runtime = new DurableWorkflowRuntime({
  storage: new InMemoryStepStorage(),
  retryPolicy: { maxAttempts: 3 }
})

// Execute steps
runtime.send('event', data)           // Fire-and-forget
await runtime.try('Cache.get', key)   // Single attempt
await runtime.do('Order.create', order) // Durable with retries
```

```typescript
class OrderWorkflow extends DurableObject {
  private runtime: DurableWorkflowRuntime

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.runtime = new DurableWorkflowRuntime({
      storage: new DOStepStorage(ctx.storage)
    })
  }

  async processOrder(order: Order) {
    // These steps are durable - survive DO hibernation
    await this.runtime.do('Inventory.reserve', order.items)
    await this.runtime.do('Payment.charge', order.payment)
    await this.runtime.do('Shipping.create', order.address)
  }
}
```

## Implements

- [`PipelineRuntime`](../interfaces/PipelineRuntime.md)

## Constructors

### Constructor

> **new DurableWorkflowRuntime**(`options`): `DurableWorkflowRuntime`

Defined in: [workflows/runtime.ts:304](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L304)

#### Parameters

##### options

[`RuntimeOptions`](../interfaces/RuntimeOptions.md) = `{}`

#### Returns

`DurableWorkflowRuntime`

## Methods

### do()

> **do**\<`T`\>(`action`, `data`): `Promise`\<`T`\>

Defined in: [workflows/runtime.ts:504](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L504)

Durable execution with retries (blocking, durable)

#### Type Parameters

##### T

`T`

#### Parameters

##### action

`string`

##### data

`unknown`

#### Returns

`Promise`\<`T`\>

***

### executeStep()

> **executeStep**\<`T`\>(`stepId`, `pipeline`, `args`, `mode`): `Promise`\<`T`\>

Defined in: [workflows/runtime.ts:318](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L318)

Execute a step with the specified durability mode

#### Type Parameters

##### T

`T`

#### Parameters

##### stepId

`string`

Unique identifier for this step (hash of path + context)

##### pipeline

[`Pipeline`](../interfaces/Pipeline.md)

Pipeline info (path, context, runtime ref)

##### args

`unknown`[]

Arguments passed to the method

##### mode

[`ExecutionMode`](../type-aliases/ExecutionMode.md) = `'do'`

Execution mode ('send', 'try', 'do')

#### Returns

`Promise`\<`T`\>

#### Implementation of

[`PipelineRuntime`](../interfaces/PipelineRuntime.md).[`executeStep`](../interfaces/PipelineRuntime.md#executestep)

***

### send()

> **send**(`event`, `data`): `void`

Defined in: [workflows/runtime.ts:474](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L474)

Fire-and-forget event emission (non-blocking, non-durable)

#### Parameters

##### event

`string`

##### data

`unknown`

#### Returns

`void`

***

### try()

> **try**\<`T`\>(`action`, `data`): `Promise`\<`T`\>

Defined in: [workflows/runtime.ts:486](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L486)

Quick attempt without durability (blocking, non-durable)

#### Type Parameters

##### T

`T`

#### Parameters

##### action

`string`

##### data

`unknown`

#### Returns

`Promise`\<`T`\>
