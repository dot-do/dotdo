[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / InMemoryStepStorage

# Class: InMemoryStepStorage

Defined in: [workflows/runtime.ts:230](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L230)

Simple in-memory storage for step results.

Provides a Map-based implementation of StepStorage for testing
or non-persistent workflows. Data is lost when the process exits.

## Examples

```typescript
const storage = new InMemoryStepStorage()
const runtime = createWorkflowRuntime({ storage })

// Run tests...

// Clear between tests
storage.clear()
```

```typescript
const storage = new InMemoryStepStorage()
const runtime = createWorkflowRuntime({ storage })

await runtime.do('Order.create', orderData)

// Check what was stored
const steps = await storage.list()
console.log(steps)
// [{ stepId: 'Order.create:...', status: 'completed', result: {...} }]
```

## Implements

- [`StepStorage`](../interfaces/StepStorage.md)

## Constructors

### Constructor

> **new InMemoryStepStorage**(): `InMemoryStepStorage`

#### Returns

`InMemoryStepStorage`

## Methods

### clear()

> **clear**(): `void`

Defined in: [workflows/runtime.ts:250](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L250)

Clear all stored results (for testing)

#### Returns

`void`

***

### delete()

> **delete**(`stepId`): `Promise`\<`void`\>

Defined in: [workflows/runtime.ts:241](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L241)

#### Parameters

##### stepId

`string`

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`StepStorage`](../interfaces/StepStorage.md).[`delete`](../interfaces/StepStorage.md#delete)

***

### get()

> **get**(`stepId`): `Promise`\<[`StepResult`](../interfaces/StepResult.md) \| `undefined`\>

Defined in: [workflows/runtime.ts:233](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L233)

#### Parameters

##### stepId

`string`

#### Returns

`Promise`\<[`StepResult`](../interfaces/StepResult.md) \| `undefined`\>

#### Implementation of

[`StepStorage`](../interfaces/StepStorage.md).[`get`](../interfaces/StepStorage.md#get)

***

### list()

> **list**(): `Promise`\<[`StepResult`](../interfaces/StepResult.md)[]\>

Defined in: [workflows/runtime.ts:245](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L245)

#### Returns

`Promise`\<[`StepResult`](../interfaces/StepResult.md)[]\>

#### Implementation of

[`StepStorage`](../interfaces/StepStorage.md).[`list`](../interfaces/StepStorage.md#list)

***

### set()

> **set**(`stepId`, `result`): `Promise`\<`void`\>

Defined in: [workflows/runtime.ts:237](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L237)

#### Parameters

##### stepId

`string`

##### result

[`StepResult`](../interfaces/StepResult.md)

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`StepStorage`](../interfaces/StepStorage.md).[`set`](../interfaces/StepStorage.md#set)
