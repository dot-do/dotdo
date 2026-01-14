[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / CachedStepResult

# Type Alias: CachedStepResult\<T\>

> **CachedStepResult**\<`T`\> = \{ `status`: `"success"`; `value`: `T`; \} \| \{ `error`: `Error`; `status`: `"error"`; \}

Defined in: [workflows/core/workflow-core-storage.ts:50](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L50)

Cached step result (discriminated union for type safety)

## Type Parameters

### T

`T` = `unknown`
