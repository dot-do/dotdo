[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / Schema

# Type Alias: Schema\<T\>

> **Schema**\<`T`\> = `z.ZodType`\<`T`\> \| [`JsonSchema`](../interfaces/JsonSchema.md) \| \{ `properties`: `Record`\<`string`, `unknown`\>; `type`: `"object"`; \}

Defined in: [agents/types.ts:22](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L22)

Schema definition - supports Zod, JSON Schema, or raw objects

## Type Parameters

### T

`T` = `unknown`
