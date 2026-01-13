[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / OptionsForType

# Type Alias: OptionsForType\<T\>

> **OptionsForType**\<`T`\> = `T` *extends* `"code"` ? [`CodeOptions`](../interfaces/CodeOptions.md) : `T` *extends* `"generative"` ? [`GenerativeOptions`](../interfaces/GenerativeOptions.md) : `T` *extends* `"agentic"` ? [`AgenticOptions`](../interfaces/AgenticOptions.md) : `T` *extends* `"human"` ? [`HumanOptions`](../interfaces/HumanOptions.md) : [`BaseExecutorOptions`](../interfaces/BaseExecutorOptions.md)

Defined in: [types/AIFunction.ts:954](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L954)

Get the options type for a function type

## Type Parameters

### T

`T` *extends* [`FunctionType`](FunctionType.md)
