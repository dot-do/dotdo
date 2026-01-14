[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / PipelineExpression

# Type Alias: PipelineExpression

> **PipelineExpression** = \{ `args`: `unknown`[]; `context`: `unknown`; `domain`: `string`; `method`: `string`[]; `type`: `"call"`; \} \| \{ `base`: `PipelineExpression`; `property`: `string`; `type`: `"property"`; \} \| \{ `array`: `PipelineExpression`; `mapper`: [`MapperInstruction`](../interfaces/MapperInstruction.md)[]; `type`: `"map"`; \} \| \{ `condition`: `PipelineExpression`; `elseBranch`: `PipelineExpression` \| `null`; `thenBranch`: `PipelineExpression`; `type`: `"conditional"`; \} \| \{ `cases`: `Record`\<`string`, `PipelineExpression`\>; `type`: `"branch"`; `value`: `PipelineExpression`; \} \| \{ `patterns`: `object`[]; `type`: `"match"`; `value`: `PipelineExpression`; \} \| \{ `eventName`: `string`; `options`: \{ `timeout?`: `string`; `type?`: `string`; \}; `type`: `"waitFor"`; \} \| \{ `entity`: `string`; `event`: `string`; `payload`: `unknown`; `type`: `"send"`; \} \| \{ `type`: `"literal"`; `value`: `unknown`; \} \| \{ `path`: `string`[]; `type`: `"placeholder"`; \}

Defined in: [workflows/pipeline-promise.ts:114](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/pipeline-promise.ts#L114)

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
