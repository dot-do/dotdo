[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / BaseExecutorOptions

# Interface: BaseExecutorOptions

Defined in: [lib/executors/BaseFunctionExecutor.ts:202](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L202)

## Properties

### env

> **env**: `Record`\<`string`, `unknown`\>

Defined in: [lib/executors/BaseFunctionExecutor.ts:204](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L204)

***

### logger?

> `optional` **logger**: [`FunctionLogger`](FunctionLogger.md)

Defined in: [lib/executors/BaseFunctionExecutor.ts:205](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L205)

***

### middleware?

> `optional` **middleware**: [`ExecutionMiddleware`](../type-aliases/ExecutionMiddleware.md)\<`unknown`, `unknown`\>[]

Defined in: [lib/executors/BaseFunctionExecutor.ts:207](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L207)

***

### onEvent?

> `optional` **onEvent**: [`FunctionEventHandler`](../type-aliases/FunctionEventHandler.md)

Defined in: [lib/executors/BaseFunctionExecutor.ts:206](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L206)

***

### state

> **state**: [`FunctionDurableObjectState`](FunctionDurableObjectState.md)

Defined in: [lib/executors/BaseFunctionExecutor.ts:203](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L203)
