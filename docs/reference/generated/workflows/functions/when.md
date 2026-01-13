[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / when

# Function: when()

> **when**\<`TThen`, `TElse`\>(`condition`, `branches`): [`PipelinePromise`](../interfaces/PipelinePromise.md)\<`unknown`\>

Defined in: [workflows/on.ts:715](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/on.ts#L715)

Declarative conditional for workflow branching.

Creates a pipeline expression that evaluates the condition and executes
the appropriate branch. Works with both pipeline promises and literal values.

## Type Parameters

### TThen

`TThen`

Return type of the then branch

### TElse

`TElse` = `never`

Return type of the else branch (default: never)

## Parameters

### condition

`unknown`

Condition to evaluate (can be a PipelinePromise or literal)

### branches

Object containing `then` and optional `else` branch functions

#### else?

() => `TElse`

#### then

() => `TThen`

## Returns

[`PipelinePromise`](../interfaces/PipelinePromise.md)\<`unknown`\>

PipelinePromise representing the conditional expression

## Examples

```typescript
const result = when(order.total > 100, {
  then: () => applyDiscount(order, 0.1),
  else: () => order
})
```

```typescript
const status = $.Inventory(product).check()

const result = when(status.available, {
  then: () => $.Order(order).fulfill(),
  else: () => $.Order(order).backorder()
})
```

```typescript
when(user.isVIP, {
  then: () => send.Notification.vipWelcome({ userId: user.id })
})
```
