[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / WorkflowProxyOptions

# Interface: WorkflowProxyOptions

Defined in: [workflows/pipeline-promise.ts:137](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/pipeline-promise.ts#L137)

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

## Properties

### execute()?

> `optional` **execute**: (`expr`) => `Promise`\<`unknown`\>

Defined in: [workflows/pipeline-promise.ts:139](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/pipeline-promise.ts#L139)

Called when a PipelinePromise is awaited

#### Parameters

##### expr

[`PipelineExpression`](../type-aliases/PipelineExpression.md)

#### Returns

`Promise`\<`unknown`\>

***

### onExecute()?

> `optional` **onExecute**: (`expr`) => `void`

Defined in: [workflows/pipeline-promise.ts:141](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/pipeline-promise.ts#L141)

Called when any domain method is called (for testing)

#### Parameters

##### expr

[`PipelineExpression`](../type-aliases/PipelineExpression.md)

#### Returns

`void`
