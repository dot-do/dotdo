[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / StopCondition

# Type Alias: StopCondition

> **StopCondition** = \{ `count`: `number`; `type`: `"stepCount"`; \} \| \{ `toolName`: `string`; `type`: `"hasToolCall"`; \} \| \{ `type`: `"hasText"`; \} \| \{ `check`: (`state`) => `boolean`; `type`: `"custom"`; \}

Defined in: [agents/types.ts:167](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L167)
