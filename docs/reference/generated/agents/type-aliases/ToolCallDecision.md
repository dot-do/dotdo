[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / ToolCallDecision

# Type Alias: ToolCallDecision

> **ToolCallDecision** = \{ `action`: `"allow"`; \} \| \{ `action`: `"deny"`; `reason`: `string`; \} \| \{ `action`: `"modify"`; `arguments`: `Record`\<`string`, `unknown`\>; \} \| \{ `action`: `"use_cached"`; `result`: `unknown`; \}

Defined in: [agents/types.ts:453](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L453)
