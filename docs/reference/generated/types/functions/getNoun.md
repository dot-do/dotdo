[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / getNoun

# Function: getNoun()

> **getNoun**\<`K`\>(`ctx`, `noun`): (`id`) => [`DomainProxy`](../interfaces/DomainProxy.md)

Defined in: [types/WorkflowContext.ts:166](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L166)

Safely access a noun from WorkflowContext with type narrowing

## Type Parameters

### K

`K` *extends* keyof [`NounRegistry`](../interfaces/NounRegistry.md)

## Parameters

### ctx

[`WorkflowContext`](../interfaces/WorkflowContext.md)

### noun

`K`

## Returns

> (`id`): [`DomainProxy`](../interfaces/DomainProxy.md)

### Parameters

#### id

`string`

### Returns

[`DomainProxy`](../interfaces/DomainProxy.md)

## Example

```typescript
const customerAccessor = getNoun($, 'Customer')
const proxy = customerAccessor('cust-123')
```
