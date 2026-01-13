[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / MapperInstruction

# Interface: MapperInstruction

Defined in: [workflows/pipeline-promise.ts:126](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/pipeline-promise.ts#L126)

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

### inputPaths

> **inputPaths**: `string`[][]

Defined in: [workflows/pipeline-promise.ts:129](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/pipeline-promise.ts#L129)

***

### operation

> **operation**: `"property"` \| `"call"`

Defined in: [workflows/pipeline-promise.ts:127](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/pipeline-promise.ts#L127)

***

### path

> **path**: `string`[]

Defined in: [workflows/pipeline-promise.ts:128](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/pipeline-promise.ts#L128)
