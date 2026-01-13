[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / TimerHandle

# Interface: TimerHandle

Defined in: [workflows/core/workflow-core.ts:59](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L59)

Timer handle returned by createTimer

## Properties

### cancel()

> **cancel**: () => `boolean`

Defined in: [workflows/core/workflow-core.ts:65](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L65)

Cancel the timer

#### Returns

`boolean`

***

### promise

> **promise**: `Promise`\<`void`\>

Defined in: [workflows/core/workflow-core.ts:63](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L63)

Promise that resolves when timer fires

***

### timerId

> **timerId**: `string`

Defined in: [workflows/core/workflow-core.ts:61](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L61)

Unique timer ID
