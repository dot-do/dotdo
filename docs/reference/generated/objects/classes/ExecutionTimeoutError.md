[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / ExecutionTimeoutError

# Class: ExecutionTimeoutError

Defined in: [lib/executors/BaseFunctionExecutor.ts:23](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L23)

BaseFunctionExecutor

Abstract base class that extracts common execution patterns from:
- CodeFunctionExecutor
- GenerativeFunctionExecutor
- AgenticFunctionExecutor
- HumanFunctionExecutor

Provides shared functionality for:
- Retry logic with configurable backoff strategies
- Event emission
- State management
- Logging
- Metrics tracking
- Middleware pipeline

## Extends

- `Error`

## Constructors

### Constructor

> **new ExecutionTimeoutError**(`message`): `ExecutionTimeoutError`

Defined in: [lib/executors/BaseFunctionExecutor.ts:24](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L24)

#### Parameters

##### message

`string`

#### Returns

`ExecutionTimeoutError`

#### Overrides

`Error.constructor`
