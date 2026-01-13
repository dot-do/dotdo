[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / PipelinePromise

# Interface: PipelinePromise\<T\>

Defined in: [workflows/pipeline-promise.ts:132](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/pipeline-promise.ts#L132)

ai-workflows - Pipeline Proxy Foundation

Event-driven domain DSL for durable execution with:
- Pipeline promises for lazy execution
- Property access on unresolved values
- Magic map via record-replay
- Automatic batching of independent operations
- Event subscriptions and scheduling

## Example

```typescript
import { on, every, Domain, when, waitFor, send } from 'dotdo/workflows'

const CRM = Domain('CRM', { createAccount: () => ({}) })

on.Customer.signup(customer => {
  CRM(customer).createAccount()
})

every.Monday.at9am(() => {
  Analytics('sales').weeklyMetrics()
})
```

## Extends

- `PromiseLike`\<`T`\>

## Type Parameters

### T

`T` = `unknown`

## Properties

### \_\_expr

> `readonly` **\_\_expr**: [`PipelineExpression`](../type-aliases/PipelineExpression.md)

Defined in: [workflows/pipeline-promise.ts:133](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/pipeline-promise.ts#L133)

***

### \_\_isPipelinePromise

> `readonly` **\_\_isPipelinePromise**: `true`

Defined in: [workflows/pipeline-promise.ts:134](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/pipeline-promise.ts#L134)
